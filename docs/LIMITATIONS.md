# Limitations

What the plugin does not do, and why. A limitation that is documented is a design
boundary; one that is not is a bug report waiting to happen.

## The filesystem substrate (`wsl-fs` `substrate`)

`substrate: "agent"` (the default) serves the file tools through the resident
in-distro agent, on ext4. `substrate: "share"` is the opt-out: the Windows-side
host stack over the distro's 9p share. What differs:

- **A new file publishes with mode 0600 on the agent substrate.** That is the
  host backend's own POSIX publication semantics (a private 0600 staging file,
  renamed into place), which a Linux-host DSH session has always had. The share
  substrate was the outlier: the share drops mode sets, so new files took the
  distro's umask default (0644). Overwrites and edits keep the original bits on
  both substrates. Run `chmod` (or ask the model to) when a new file must be
  executable.
- **There is no silent fallback to the share.** When the agent substrate's
  resident process is out — the distro stopped, or the agent crashed past its
  one rebuild — file operations fail with `FS_IO_ERROR` naming the substrate,
  rather than quietly degrading to share semantics that cannot follow symlinks
  or keep mode bits. The share substrate dies with the distro anyway; the
  agent only adds its own failure mode, which is the one honest way to fail.
- **The mutation guard survives to the write.** `createIfAbsent` publishes with
  a no-replace link inside the distro, which closes the check-then-write window
  for creates outright. An overwrite or edit carries the version it was based
  on into the write op, and the agent re-verifies it against a fresh stat one
  syscall before the rename: a concurrent writer wins and the stale write
  refuses with `FS_STALE_VERSION`. That narrows the share's window from a host
  round trip to kernel-adjacent — the residual stat-then-rename pair is the
  same sliver a Linux-host session's own rename has.
- **Stage two routes mutations through a confined resident.** A write or edit
  under a confined policy runs on its own long-lived agent, spawned inside the
  bwrap profile that binds exactly what the mode grants — so the kernel, not
  just the host-side check, refuses a write outside the workspace, and the
  refusal carries `FS_SANDBOX_DENIED` (the command path's dialect). Costs to
  know: `bubblewrap` becomes required for confined writes (a distro without it
  refuses them with the bootstrap command, rather than downgrading); a policy
  change addresses a different resident, so the first write after switching the
  Permissions selector pays one agent startup; and a write the policy grants to
  the distro's `/tmp` lands in the confined mount's tmpfs, not the real `/tmp`
  — the same hand-off rule as the commands' `/tmp`: pass files through the
  session workspace.
- **`resolveSymlinks` is not consulted.** The share cannot traverse Linux
  symlinks, so the share substrate retries missing reads through the distro's
  canonical path; the agent substrate never misses them, so the config key has
  no effect there.
- **`glob` and `grep` are unchanged on both substrates.** They are tool-layer
  searches running the packaged Windows ripgrep against the share — correct
  results, slow, and `.gitignore` interpreted with Windows rules. Bringing them
  in-distro is future work, not part of the substrate switch.
- **`watch()` is the same poll loop on both substrates** (a `find -newer` scan
  inside the distro), so the coarse-invalidation caveats below apply equally.
  An inotify backend is planned, not shipped.

Everything below applies to the share substrate unless it says otherwise.

- **The sandbox does not govern WSL interop.** A confined command can still run a
  Windows program, which escapes the Linux-side boundary. The plugin reports this as
  `enforcement: partial`. See [ARCHITECTURE.md](ARCHITECTURE.md#reported-enforcement).
- **`bubblewrap` must be installed**, or both providers fail immediately. The
  usability probe re-runs after a failure, so installing bubblewrap while the app
  runs is believed on the next command; only a success is cached.
- **A confined command's `/tmp` is not the write tool's `/tmp`.** `workspace-write`
  mounts a fresh tmpfs at `/tmp` for the command — that is what makes it ephemeral —
  while the file tools' fence grants the distro's *real* `/tmp`. Both are writable, so
  neither side is refused, but a file the write tool puts in `/tmp` is invisible to
  `bash` and vice versa. Hand a file between them through the session workspace.
- A distro that is stopped or unregistered while the app runs leaves the UNC share
  unreachable: the shell tools report `wsl.exe`'s `WSL_E_*` code with the reason, but
  the file tools can only report a file-level error, because the share itself is
  gone.
- `workspace-write` binds the workspace root as writable, and bubblewrap refuses a
  bind whose source directory does not exist, so a session whose workspace directory was
  deleted fails with a runner error; the plugin does not recreate it. A workdir that
  does not exist — a configured `cwd` pointing at a deleted directory, for instance — is
  a separate case and is now reported as an error naming that directory, because
  `wsl.exe` would otherwise run the command in `/` and exit 0.
- New files get the distro's umask default (0644). A `chmod` from the Windows side on
  a share path is silently ignored; overwrites and edits keep the original permission
  bits. Run `chmod +x` inside the distro when you need an executable.
- The check before a write is "check, then write", which is not atomic. This backend
  checks the caller's guard itself, because the Windows backend publishes a guarded
  new file with a hard link, and the share does not support hard links. This is the
  race that `dsh-fs-sandbox` already documents.
- `watch()` observes from inside the distro (a `find -newer` poll loop, see
  `lib/watcher.js`), so events are coarse invalidation, not per-file notifications,
  and they arrive on the poll cadence, not instantly. A file created with an mtime
  older than the watcher's stamp (`cp -p`, `tar -x`) is not seen until something
  else touches the tree. Watching a 9p share from the Windows side remains
  unsupported — the loop runs where the kernel can actually report change.
- `glob` and `grep` use the Windows-side ripgrep over the share: correct results, but
  not fast, and `.gitignore` is interpreted with Windows rules. `editText` reads the
  whole file into memory before writing it back.
- Terminal routing is per-session by workspace coordinates (`subprocess-wsl.hostSessions`,
  default on): a WSL-folder session gets the distro shell, a Windows-folder session gets
  `powershell.exe` in its own directory. The shell MENU remains the single configured
  profile, and a directory-less launch still lands in the distro.
- Terminal activity reporting stops at `wsl.exe`, so the controller never reclaims
  these terminals when they are idle.
