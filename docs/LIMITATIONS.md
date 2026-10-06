# Limitations

What the plugin does not do, and why. A limitation that is documented is a design
boundary; one that is not is a bug report waiting to happen.

## The filesystem substrate (`wsl-fs`)

The file tools run on one substrate: the resident in-distro agent, on ext4 —
reads, writes and identities happen where the files live. The former
Windows-side share backend (`substrate: "share"`) is retired: a profile still
carrying the value is refused at boot with the migration, and no file tool
crosses the 9p share. What to know about the one substrate there is:

- **A new file publishes with mode 0600.** That is the host backend's own POSIX
  publication semantics (a private 0600 staging file, renamed into place), which
  a Linux-host DSH session has always had; the share dropped mode sets and took
  the umask default instead, and that behaviour is gone with the share.
  Overwrites and edits keep the original bits. Run `chmod` (or ask the model to)
  when a new file must be executable.
- **When the agent is out, file operations fail closed.** The distro stopped, or
  the resident crashed past its one rebuild: `FS_IO_ERROR` naming the substrate,
  with the recovery path in the message. There is no fallback I/O to degrade
  into — deliberately; the old failure message pointed at the share, and the
  share is what this plugin exists to keep the model off.
- **The mutation guard survives to the write.** `createIfAbsent` publishes with
  a no-replace link inside the distro, which closes the check-then-write window
  for creates outright. An overwrite or edit carries the version it was based
  on into the write op, and the agent re-verifies it against a fresh stat one
  syscall before the rename: a concurrent writer wins and the stale write
  refuses with `FS_STALE_VERSION`. The residual stat-then-rename pair is the
  same sliver a Linux-host session's own rename has.
- **A write is durable against process death, not machine death.** The
  publication fsyncs the staged file before its atomic rename, but the
  containing directory is not fsynced afterwards: a kernel panic or power loss
  immediately after a successful write can lose the rename, and the file
  reverts to its pre-write content. The peer backend fsyncs its staged file the
  same way, but neither fsyncs the containing directory — the exposure is the
  peer's too, and it stays short of a crash-consistent store.
- **A Linux filename containing a backslash cannot be addressed.** The UNC
  display form (`\\wsl.localhost\<distro>\...`) is the file's identity
  everywhere - the session header, the GUI, the caches - and the backslash is
  the UNC's separator, so `a\b.ts` in the distro round-trips to `a/b.ts`: the
  tools would silently address a different path. This is the coordinate
  system's own limit — a backslash-delimited identity cannot spell a name
  containing a backslash — not a defect of the substrate; a rename away from
  backslash names is the workaround.
- **Stage two routes mutations through a confined resident.** A write or edit
  under a confined policy runs on its own long-lived agent, spawned inside the
  bwrap profile that binds exactly what the mode grants — so the kernel, not
  just the host-side check, refuses a write outside the workspace, and the
  refusal carries `FS_SANDBOX_DENIED` (the command path's dialect). Costs to
  know: `bubblewrap` becomes required for confined writes (a distro without it
  refuses them with the bootstrap command, rather than downgrading); a policy
  change addresses a different resident, so the first write after switching the
  Permissions selector pays one agent startup; and a write the policy grants to
  the distro's `/tmp` lands in the distro's real `/tmp`, because the
  file-writes resident binds it read-write — where the read tools, the plain
  resident and the user's own shell all see it. The ephemeral tmpfs belongs to
  the command side alone, so a file handed over from a command still goes
  through the session workspace.
- **`glob` and `grep` run the distro's own rg** (`lib/search-route.js`): the
  tool's arguments are forwarded verbatim, so results, output format and exit
  codes are rg's own — at ext4 speed, with the distro's `.gitignore` rules.
  A distro without rg fails the search outright: exit 127, with the message
  from the exec launcher and never from rg itself (which is the missing
  program) — `setsid: failed to execute rg: No such file or directory` where
  the distro has `setsid`, the script shell's `rg: not found` where it does
  not. The install command `scripts/bootstrap.sh` prints — `wsl.exe -d <distro>
  -u root -- apt-get install -y bubblewrap git ripgrep inotify-tools`, or the
  detected family's spelling — installs it. `--install` runs that command only
  when `bubblewrap` itself is missing, so a distro that has bwrap but not rg
  needs the printed line run by hand. A search whose directory is a Windows
  folder keeps the host binary, which is native there.
- **`watch()` is one poll loop** (a `find -newer` scan inside the distro), so
  the coarse-invalidation caveats below apply. An inotify backend is planned,
  not shipped.
- **A confined command's `/tmp` is not the write tool's `/tmp`.** `workspace-write`
  mounts a fresh tmpfs at `/tmp` for the command — that is what makes it ephemeral —
  while the file tools' fence grants the distro's *real* `/tmp`. Both are writable, so
  neither side is refused, but a file the write tool puts in `/tmp` is invisible to
  `bash` and vice versa. Hand a file between them through the session workspace.
- A distro that is stopped or unregistered while the app runs takes the file
  tools' substrate with it: reads and writes report the substrate-unavailable
  error naming the cause. A death with nothing in flight costs nothing — the
  next call starts a fresh transport, so a distro that comes back is served
  again. A death with a request in flight spends the resident's one permitted
  rebuild, and when that rebuild cannot complete — the distro is still down, or
  gone — the resident is permanently out: every later file operation fails the
  same way until the app restarts.
- `watch()` observes from inside the distro (a `find -newer` poll loop, see
  `lib/watcher.js`), so events are coarse invalidation, not per-file notifications,
  and they arrive on the poll cadence, not instantly. A creation is seen even when
  the new file's own mtime is old: creating it bumps the containing directory's
  mtime, and the scan includes the watched directory itself (deletions are seen the
  same way). What escapes the stamp is a change that leaves every scanned mtime
  older than it — an in-place `cp -p` onto an existing file (new content, a
  copied-back mtime), or a `tar -x` whose archive restores the containing
  directory's own mtime. Watching a 9p share from the Windows side remains
  unsupported — the loop runs where the kernel can actually report change.
- `editText` reads the whole file into memory before writing it back.

## The sandbox

- **The sandbox does not govern WSL interop.** A confined command can still run a
  Windows program, which escapes the Linux-side boundary. The plugin reports this as
  `enforcement: partial`. See [ARCHITECTURE.md](ARCHITECTURE.md#reported-enforcement).
  The `maskWindowsDrive` key on `wsl-shell`, `wsl-fs` and `fs-routing` narrows the
  hole: the confined profile shadows `/mnt` with an empty tmpfs, so the drive's files
  cannot be read or exfiltrated and its executables cannot be launched. It is not a
  closure — a command that can write the workspace can write an executable there and
  run it (binfmt interop dispatches on file content, not location) — so enforcement
  stays `partial`, the result's sandbox fact reports `windowsDrive: "masked"`, and
  the only complete closure remains distro-level (`[interop] enabled=false` in
  `wsl.conf`).
- **`bubblewrap` must be installed**, or both providers fail immediately. The
  usability probe re-runs after a failure, so installing bubblewrap while the app
  runs is believed on the next command; only a success is cached. The refusal
  classifies the probe's failure — missing versus present-but-failing — and the
  direct install command follows the distro's package family; a probe failure
  with no recognisable shape falls back to the install remedy with the raw
  output quoted. A session-start preflight (`wsl-preflight`) surfaces the same
  text as a warning; it is advisory and never installs.
- `workspace-write` binds the workspace root as writable, and bubblewrap refuses a
  bind whose source directory does not exist, so a session whose workspace directory was
  deleted fails with a runner error; the plugin does not recreate it. A workdir that
  does not exist — a configured `cwd` pointing at a deleted directory, for instance — is
  a separate case and is now reported as an error naming that directory, because
  `wsl.exe` would otherwise run the command in `/` and exit 0.

## Ports

- **The port poller keeps the resident agent permanently warm.** The
  `DSH_WSL_PORTS` snapshot refreshes through the shared resident agent every
  `portsRefreshMs` (10 s by default, well inside the agent's idle timeout), so
  while the app runs the agent never idles out: one `wsl.exe` and one
  in-distro agent process stay resident per pinned distro even with no command
  in flight. Raising `portsRefreshMs` past the agent's idle timeout restores
  idle shutdown, at the cost of staler port facts.

## The directory picker

- The directory picker lists distro levels from inside the distro — the
  resident's `ls -1ALp` in one round trip, a one-shot `wsl.exe --exec ls` when
  it is out, never the 9p walk the host used to pay per entry. The listing is
  line-parsed and only a line that ends in `/` becomes a row, so a directory
  name containing a newline cannot be listed correctly: `ls` emits `a\nb` as
  the two lines `a` and `b/`, and the picker offers the single row `b` at
  `<parent>/b` — the part after the newline, a different directory or none at
  all. A name that ends in a newline yields no row at all: the split leaves one
  segment without a trailing `/` and one empty name, and the parser keeps
  neither. `/` cannot appear in a name, so nothing else can split one.

## Terminals

- Terminal routing is per-session by workspace coordinates (`subprocess-wsl.hostSessions`,
  default on): a WSL-folder session gets the distro shell, a Windows-folder session gets
  `powershell.exe` in its own directory. The shell MENU remains the single configured
  profile, and a directory-less launch still lands in the distro.
- A host session's TAB TITLE still reads `WSL`, the composition's shell profile
  name, over a PowerShell process. The controller titles a tab from that profile
  before the provider rewrites the launch, and a plugin cannot correct it: a
  patch layer asserts rather than renames a row's module, and the row's id is
  load-bearing for the web composition (disabling it fails web boot with
  "waiting for service: webTerminals"). The full account and the proposed
  upstream change are in [UPSTREAM-TERMINAL-TITLE.md](UPSTREAM-TERMINAL-TITLE.md).
  Meanwhile, double-click a tab's title to rename it, or add `shellCandidates`
  to the `terminal-controller` row in your own profile layer — a manually
  selected shell is titled after itself.
- Distro terminals ARE reclaimed when idle — the observation is distro-side:
  each terminal is launched with a `DSH_TERMINAL_ID` marker, and the handle's
  `inspectActivity` counts the marked processes through the resident agent
  (`lib/terminal-activity.js`). Exactly one (the shell at its prompt) is
  `idle`; more than one (a command, a pipeline, a nested shell) is `busy`;
  `unknown` — the agent out, the distro stopped — pauses reclamation, because
  a probe that cannot answer must not authorize a close. Consequences to
  know: a nested shell keeps the terminal busy by design (closing it would
  lose that shell), so does any process the shell's startup files spawn with
  the inherited marker (an `ssh-agent` launched in `.bashrc` reads as busy);
  the idle threshold is the controller's `unattendedTimeoutMs` (2 h by
  default); and the host-side shell-activity integration is still not armed
  for these launches — `wsl.exe` on win32 fails its gate — which is why the
  observation is a scan rather than shell cooperation. `terminalIdleReclaim:
  false` on the `subprocess-wsl` row restores close-by-hand: the launch then
  carries no `DSH_TERMINAL_ID` marker, and the handle keeps the shipped
  `unknown` activity, which never accumulates idle.
- Windows-folder host terminals (the `powershell.exe` branch) keep the shipped
  behaviour: `unknown` activity, no reclamation.
