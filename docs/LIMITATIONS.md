# Limitations

*A Chinese translation lives at [LIMITATIONS.zh](LIMITATIONS.zh.md); the English version is authoritative.*

What the plugin does not do, and why. A limitation that is documented is a design
boundary; one that is not is a bug report waiting to happen. Each entry states the
limit and the remedy; the reasoning lives in [ARCHITECTURE.md](ARCHITECTURE.md) and
the documents it links.

## The filesystem substrate (`wsl-fs`)

One substrate: the resident in-distro agent (ext4 for distro files). The retired
Windows-side share backend (`substrate: "share"`) is refused at boot; WSL-routed
operations never use the 9p share.

- **A new file publishes with mode 0600.** Overwrites and edits keep the original
  bits; `chmod` when a new file must be executable.
- **When the agent is out, file operations fail closed** — `FS_IO_ERROR` naming the
  substrate, with the recovery path. One crash rides a single rebuild; a spent
  rebuild enters bounded revival (2/4/8 s); three deaths are permanent until the app
  restarts. There is no fallback I/O — deliberately.
- **The mutation guard is not atomic compare-and-swap.** Creates use a no-replace
  link; overwrites re-verify the version before the rename. A mismatch returns
  `FS_STALE_VERSION`, but a change between check and rename can still be overwritten.
- **A cancelled write can have an unknown outcome** — inspect the file before
  retrying.
- **A successful write is as crash-durable as the platform's `sync -d`.** The
  staged file is synced, and the containing directory is fsynced best effort
  after the rename (shell agent). The native agent keeps its file-level
  `sync_all` only — see the peer-parity divergence note. A filesystem that
  refuses a directory fsync keeps the peer's own promise.
- **A Linux filename containing a backslash cannot be addressed** — the backslash is
  the UNC separator, so `a\b.ts` round-trips to `a/b.ts`. Rename away from backslash
  names; this is the coordinate system's own limit.
- **Confined writes run on their own bwrap-confined resident** — kernel-enforced,
  refusing outside the workspace with `FS_SANDBOX_DENIED`. Costs: `bubblewrap`
  required; a policy change pays one agent startup; a write granted to `/tmp` lands
  in the distro's real `/tmp`.
- **`glob`/`grep` run the distro's rg**; a distro without rg fails the search
  (exit 127). Install: `wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap
  git ripgrep inotify-tools` (or the detected family's spelling). `--install` runs it
  only for a missing `bubblewrap`.
- **`watch()` is coarse invalidation, not per-file notifications**: inotify events
  coalesced to 0.5 s, or a `find -newer` poll loop otherwise. The polling path misses
  an in-place `cp -p` or a `tar -x` that restores older mtimes; a FILE target watches
  an `mtime:size` fingerprint. 9p watching from Windows stays unsupported.
- **With `sessionSandbox: false`, a confined command's `/tmp` differs from the write
  tools' `/tmp`** — hand files over through the session workspace. The shipped
  preset (`sessionSandbox: true`) shares one real `/tmp` and has no such split.
- `editText` reads the whole file into memory before writing it back.
- A distro that dies with a request in flight spends the resident's one rebuild;
  still down, the resident stays out until the app restarts.

## The GUI workspace-files service

- The GUI file tree and previews use the shipped `workspace-files` row, reading WSL
  paths through the routed root filesystem — deliberately not replaced (a server-only
  takeover would drop the browser `file` provider the Sidebar previews need).
- **Expect extra round trips** (roughly 4-6 per listing/stat/page; measured p95:
  `stat` 2.7 ms, `listDir` 5.1 ms, 1 MiB read 63.5 ms/MiB — 2026-10-19,
  [probe](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/gui-preview.sh)).
  The model's own file operations are unaffected.
- `fs-routing` is the seam: disabling it restores the host 9p-backed root filesystem.
  The shipped row's caps can be overridden on the `workspace-files` row.

## `@` completion

- **`@` references walk the 9p share** (~56× slower than ext4 on a probed tree,
  2026-10-19). The distro-side traversal is built but not mounted — it needs the
  upstream `FileReferenceTraversal` seam:
  [UPSTREAM-FILE-REFERENCE-SEAM.md](UPSTREAM-FILE-REFERENCE-SEAM.md).

## The sandbox

- **The one-shot fallback has only the host deadline** — a killed `wsl.exe` does not
  relay the kill into the distro, so the Linux process tree can outlive the call.
  Prefer `agent: true` and the session runtime for long commands.
- **Batch reads share one native agent per distro** (16 concurrent calls in
  2.4-4.1 ms; first call pays ~70 ms preparation).
- **aarch64 runs under qemu in CI only** (no Windows-on-ARM machine in reach —
  [COMPATIBILITY.md](COMPATIBILITY.md#scope-decisions)). `auto` still selects the
  packaged binary; `native` refuses on preparation failure; `shell` forces the shell
  agent.
- **The session runtime needs systemd and a lingering user manager** — refused on the
  first command with the remedy otherwise; `sessionSandbox: false` keeps the old
  per-command shape. A hard app crash can leave a stale `dsh-wsl-*.scope`; the
  preflight sweeps stale scopes on the next WSL session (never another live
  session's).
- **The sandbox does not govern WSL interop** — reported as `enforcement: partial`.
  `maskWindowsDrive` and `interopVisibility` narrow `/mnt` but are not a closure;
  even `interopVisibility: "disabled"` only produces the `wsl.conf`
  `[interop] enabled=false` remedy (printed by `doctor`) — the distro-level
  setting must still be applied manually.
  [ARCHITECTURE.md](ARCHITECTURE.md#reported-enforcement).
- **`bubblewrap` must be installed**, or both providers fail with the install
  command; a session-start preflight surfaces the same text as an advisory warning.
- **Message localization is partial by design** — the preflight verdicts, `bwrap`
  remedies and distro/workdir errors follow the app's Language setting
  ([CONFIGURATION.md](CONFIGURATION.md#message-language)); the `FS_*` refusal texts
  in `fs-decisions` and the fsio replica stay byte-identical English because the
  tool layer matches on those strings, and the standalone `scripts/doctor.mjs`
  always prints English because it runs outside the app and cannot read the
  host's locale preference. A remedy composed at probe time keeps the language
  the probe ran in until that probe runs again.
- A workspace directory deleted mid-session fails with a runner error; the plugin
  does not recreate it. A configured `cwd` that does not exist is reported as an
  error naming the directory.

## Shell startup semantics (`wsl-shell`)

Commands run as `<shell> -lc <command>` — login (profile scripts sourced, so version
managers work) and **non-interactive** (no prompt/plugin output in the model's
streams). With `loginShell: false` the login flag is dropped (`<shell> -c <command>`).

`<shell>` is the distro user's login shell (`getent passwd`, then `$SHELL`). When
both probes fail — a cold distro, a flaky first `wsl.exe` call, a musl distro
without `getent` — the command **errors out** instead of silently running under
bash; the failure is not cached, so a retry re-probes. Set `shell:` to an
absolute path to pin one.

- **`~/.zshrc` / `~/.bashrc` are never read.** Move machine-level PATH setup
  (`fnm`, nvm, cargo) into `~/.zprofile` or `~/.zshenv`; keep prompts and completion
  in the rc file.
- **fnm's multishell PATH cannot form inside the sandbox** (`/run` is read-only) —
  use the fallback recipe in
  [Configuration](CONFIGURATION.md#zshfnm-recipe-for-model-run-commands).

## Agent diagnostics

- **The doctor's `agent.handshake` probes a fresh resident**, not the live one —
  a running resident's own view is folded in where a shared agent exists
  (`doctorReport` merges `WslAgent.status()` via `mergeLiveResidentStatus`,
  0.18.0), but the CLI's handshake check still names its probe source
  (`probed: a fresh resident`); without an app-side call the `lastError`
  stays in the app log.
- **`dsh-wsl-*.scope` counts are point-in-time**; `--fix` runs the preflight's sweep.
- **The doctor's `git.win-safe` probe reports the Windows git trust through interop
  `git.exe`** — the `safe.directory` whitelist that WSL change review needs when
  Windows git is installed (see Terminals below).

## Session-start advisories

- **There is no session-UI notice seam in DSH 0.2.1.** `wsl-preflight` failures go
  to the host log and the session's runtime context (model-visible next assembly) —
  advisory only, never installing or cancelling. The upstream ask:
  [UPSTREAM-SESSION-NOTICE.md](UPSTREAM-SESSION-NOTICE.md).
- **The runtime-context entry is a repeated snapshot, not a dismissible
  notification.** Removing the `wsl-preflight` row silences the probe entirely.

## Ports

- **The port poller keeps the resident agent permanently warm** per active distro
  (refresh 10 s). Raising `portsRefreshMs` past the agent's idle timeout restores
  idle shutdown, at the cost of staler port facts.

## The directory picker

- Distro levels list from inside the distro in one round trip (NUL-separated, so
  newline-bearing directory names list exactly — WSL-306); a one-shot `wsl.exe --exec
  find` when the resident is out.

## Terminals

- Terminal routing is per-session by workspace coordinates: a WSL-folder session gets
  the distro shell, a Windows-folder session gets `powershell.exe` in its own
  directory. The shell MENU's default entry stays the configured profile; a
  directory-less launch lands in the distro.
- **Windows git must trust the share** (`safe.directory`), or WSL workspaces'
  changed-files cards silently disappear (the discovery call answers
  `detected dubious ownership`). One-time remedy on Windows:
  `git config --global --add safe.directory "//wsl.localhost/*"`, then restart the
  app. Two alternatives: the doctor's `git.win-safe` probe reports the state, and a
  machine **without** Windows git needs nothing — the provider routes discovery into
  the distro and translates the output into UNC form.
- **Colon-separated multi-directory `GIT_*` values pass through untranslated.**
  The git environment translation rewrites single Windows directory values; a
  colon-separated list (no current caller sets one) is forwarded as-is.
- **A NEW tab's title reads `WSL`** whatever it runs — the controller titles from the
  composition's profile before the provider rewrites the launch, and a plugin cannot
  correct the default ([UPSTREAM-TERMINAL-TITLE.md](UPSTREAM-TERMINAL-TITLE.md)).
  The menu ships host candidates (`powershell`, `cmd`): a manually selected shell is
  titled after itself; double-click rename also works.
- **Distro terminals ARE reclaimed when idle** — the handle counts the marked
  processes through the resident agent (exactly one at its prompt = `idle`; a nested
  shell or an `ssh-agent` from startup files reads `busy` by design). Threshold: the
  controller's `unattendedTimeoutMs` (2 h). `terminalIdleReclaim: false` restores
  close-by-hand. Windows-folder host terminals keep the shipped no-reclamation
  behaviour.

## Enabling the plugin on a running profile

- **A GUI enable of this bundle can fail on a busy profile, and a restart
  applies it.** The three root-plane takeovers (`subprocess`, `fs`,
  `directoryPicker`) replace shipped services under the same names. On
  app `0.2.2-rc.1` (cordis 4.1.0), a disposing provider keeps its service
  registration until every dependent releases, so the replacements
  collide with the shipped providers while sessions are live and the
  enable reports them as failed. The selection is persisted either way;
  **restarting the app loads the plugin** (the cold composition is
  correct). Closing sessions before enabling usually lets the hot path
  succeed — with no dependents the shipped providers release inside the
  recomposition. Mechanism and repro:
  [UPSTREAM-SERVICE-SWAP.md](UPSTREAM-SERVICE-SWAP.md).

## Host "Open in app"

- **Opening VS Code from "Open in app" can fail independently of this plugin** — the
  Host runs with `ELECTRON_RUN_AS_NODE=1`, which the launcher inherits, so
  `Code.exe` starts as Node and exits 1. Not owned by this repository:
  [UPSTREAM-OPEN-IN-APP.md](UPSTREAM-OPEN-IN-APP.md).
