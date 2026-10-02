# Limitations

What the plugin does not do, and why. A limitation that is documented is a design
boundary; one that is not is a bug report waiting to happen.

- **The sandbox does not govern WSL interop.** A confined command can still run a
  Windows program, which escapes the Linux-side boundary. The plugin reports this as
  `enforcement: partial`. See [ARCHITECTURE.md](ARCHITECTURE.md#reported-enforcement).
- **`bubblewrap` must be installed**, or both providers fail immediately. The
  usability probe's verdict is cached for the app process's lifetime, so
  installing bubblewrap after the app started takes a restart to be noticed.
- `workspace-write` binds the workspace root as writable, and bubblewrap refuses a
  bind whose source directory does not exist. If a session's workspace directory is
  deleted, commands fail with a runner error; the plugin does not recreate the
  directory.
- New files get the distro's umask default (0644). A `chmod` from the Windows side on
  a share path is silently ignored; overwrites and edits keep the original permission
  bits. Run `chmod +x` inside the distro when you need an executable.
- The check before a write is "check, then write", which is not atomic. This backend
  checks the caller's guard itself, because the Windows backend publishes a guarded
  new file with a hard link, and the share does not support hard links. This is the
  race that `dsh-fs-sandbox` already documents.
- `watch()` (file change monitoring) is not provided. Watching a 9p share is
  unreliable, so the plugin refuses instead of arming it.
- `glob` and `grep` use the Windows-side ripgrep over the share: correct results, but
  not fast, and `.gitignore` is interpreted with Windows rules. `editText` reads the
  whole file into memory before writing it back.
- The terminal belongs to the whole app, not to one session. A session opened on a
  Windows folder still gets the distro terminal, starting in `/mnt/<drive>/...`, and
  its shell menu is deliberately reduced to the one configured profile.
- Terminal activity reporting stops at `wsl.exe`, so the controller never reclaims
  these terminals when they are idle.
