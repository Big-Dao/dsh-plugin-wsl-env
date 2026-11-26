# Limitations

[中文](LIMITATIONS.zh.md)

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
  rebuild enters bounded revival (2/4/8 s) for three attempts; the fourth death
  is permanent until the app restarts. There is no fallback I/O — deliberately.
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
- **The shell agent's tool floor is GNU.** It needs coreutils, GNU `find`
  (`-printf`), `realpath` and `od`; a minimal BusyBox image (Alpine without
  `findutils`) fails its FSB stat/list with `find: unrecognized: -printf`. The
  packaged native agent, which `auto` prefers, does not need those tools —
  install `findutils` only when pinning `agentBackend: shell`.

- **A Linux filename containing a backslash cannot be addressed** — the backslash is
  the UNC separator, so `a\b.ts` round-trips to `a/b.ts`. Rename away from backslash
  names; this is the coordinate system's own limit.
- **Confined writes run on their own bwrap-confined resident** — kernel-enforced,
  refusing outside the workspace with `FS_SANDBOX_DENIED`. Costs: `bubblewrap`
  required; a policy change pays one agent startup; a write granted to `/tmp` lands
  in the distro's real `/tmp`.
- **`glob`/`grep` run the distro's rg**; a distro without rg fails the search
  with exit 127, naming the program and the install remedy below — no silent
  fallback, and not an opaque provider error; a missing working directory
  fails explicitly too (rg's error code 2, because `1` means "no matches").
  Commands and the resident agent both inherit `wsl.exe`'s default PATH, so a
  user-local install under `~/.local/bin` is invisible — install it
  system-wide, or somewhere on that PATH. Install: `wsl.exe -d <distro> -u root -- sh -c "apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap git ripgrep inotify-tools"`
  (or the detected family's spelling). `--install` runs it
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
- **The native agent is demoted only on evidence, and tried again** — there is
  one shared agent instance per distro, and it recovers through its own rebuild
  and revival budget rather than being replaced. The reads move to the shell
  agent only when the native entry fails a start and the shell entry then
  starts on the same distro, and native is tried again after five minutes. A
  distro that is down fails both entries alike, which is not held against the
  native one; a failed preparation (copy, digest, execute check) is not
  remembered as a verdict either — the next start prepares again.

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

## Bundled skills

`preset-wsl` keeps the row set of the app's own standard mode, and its
`skill-filesystem` row carries the upstream `customSkillDirs` unchanged: the
`skills` directory the agent preset package ships inside the app's
installation. That directory is on the host, while this preset's filesystem is
the distro's:

- **Bundled skills are read through the distro's `/mnt/<drive>/…`**: `wsl-fs`
  maps a host drive path to the distro's mount point and the resident agent
  reads it (measured 2026-11-24: an unpacked host directory resolves and
  lists). A distro that mounts its drives elsewhere (`automount.root` in
  `/etc/wsl.conf`) cannot read them.
- **A WSL session on the Desktop package has no bundled skills**: the app's
  `node_modules` live inside the `app.asar` archive, `/mnt/c/…/app.asar/…` is
  not a directory inside the distro, and `wsl-fs` refuses it with
  `FS_NOT_DIRECTORY` (measured 2026-11-24). The skill provider treats such a
  root as absent and skips it, so the bundled `dsh-doc` never reaches the tool
  surface, while the other skill roots (the project's and the user's
  directories) are unaffected. The host mode reads the archive through the app
  process and has no such limit.

## The sandbox

- **The one-shot fallback has only the host deadline** — a killed `wsl.exe` does not
  relay the kill into the distro, so the Linux process tree can outlive the call.
  Prefer `agent: true` and the session runtime for long commands.
- **A command in flight when the resident is lost is not run again** — a command the
  resident never took (dead, backing off, handshake failed) falls back to the one-shot
  `wsl.exe`. When the resident dies while a command is running, the command may
  already have taken effect: it fails as "state is unknown", with the advice to
  inspect the distro first, and is not executed a second time on the one-shot path.
- **Batch reads share one native agent per distro** (16 concurrent calls in
  2.4-4.1 ms; first call pays ~70 ms preparation).
- **aarch64 runs under qemu in CI only** (no Windows-on-ARM machine in reach —
  [COMPATIBILITY.md](COMPATIBILITY.md#scope-decisions)). `auto` still selects the
  packaged binary; `native` refuses on preparation failure; `shell` forces the shell
  agent.
- **The hosted cloud WSL gate runs the full probe suite as the distro's root
  user** — `.github/workflows/cloud-wsl-gate.yml` executes
  `run-all-when-closed.sh` through `-u root` and enables linger for root only. A
  real deployment uses an ordinary distro user: the unprivileged user namespace,
  the user-level systemd manager and its linger are a different path, so passing
  as root does not prove the non-root path. That path stays with the
  maintainer-run real-machine probes; this gate does not claim to cover it
  (#88).
- **The session runtime needs systemd and a lingering user manager** — refused on the
  first command with the remedy otherwise; `sessionSandbox` set to `auto`
  (per-command without systemd) or `false` keeps the old per-command shape.
  A hard app crash can leave a stale `dsh-wsl-*.scope`; the
  preflight sweeps stale scopes on the next WSL session (never another live
  session's).
- **A session runtime is released with the session's agent** — when the agent is
  disposed (upstream's `agent/disposed`), both providers drop their references
  for that session, the scope stops, and the background processes inside it are
  reaped. The current harness (≤ 0.2.2-rc.5) does not dispose an agent when a
  session view is closed — agents live until the app exits — so until then every
  session that ran a command keeps one runtime. A fallback sweep underneath ends
  a session whose runtimes have been quiet for ten minutes with no live agent
  behind them (or that never named a session); a live session's runtime has no
  idle limit.
- **The sandbox does not govern WSL interop** — reported as `enforcement: partial`.
  `maskWindowsDrive` and `interopVisibility` narrow `/mnt` but are not a closure;
  even `interopVisibility: "disabled"` only produces the `wsl.conf`
  `[interop] enabled=false` remedy (printed by `doctor`) — the distro-level
  setting must still be applied manually.
  [ARCHITECTURE.md](ARCHITECTURE.md#reported-enforcement).
- **The mount profile does not govern process authority** — a confined command
  can still reach sockets outside the fence: the user systemd manager (the
  documented escape), the system bus, and container daemons; a PE copied into
  the workspace can also start a Windows process through interop. The confined
  rows' `socketIsolation: "session-bus"` binds `/dev/null` over
  `$XDG_RUNTIME_DIR/bus` and `$XDG_RUNTIME_DIR/systemd/private`; `"strict"`
  adds `/run/dbus/system_bus_socket`, the container sockets the distro user
  can reach, and a tmpfs over `/run/WSL` (the interop transport), so a copied
  PE fails at `connect`. The default is `off`; the masks are a narrowing, not
  a closure (same-user `/proc` and other IPC remain; the distro-wide interop
  switch is still `[interop] enabled=false`), and `enforcement` stays
  `partial`. `strict` breaks `systemctl --user`, D-Bus, container clients and
  Windows-program launches inside confined commands. Verified by
  `pnpm run probe:sandbox`.
- **`bubblewrap` must be installed**, or both providers fail with the install
  command; a session-start preflight surfaces the same text as an advisory warning.
- **`workspace-write` does not grant the package-manager caches under `$HOME`
  by default** — npm's `~/.npm`, pnpm's store and cargo's `~/.cargo/registry`
  live outside the workspace, so installing a dependency that is not already
  cached fails with `EROFS`. Grant them explicitly with `writableRoots` (see
  [CONFIGURATION](CONFIGURATION.md#toolchain-caches-and-extra-writable-roots));
  executable content in a granted directory can be used by a later build, so
  this narrows the sandbox rather than turning it off, and `enforcement` stays
  `partial`. Entries must be existing physical directories; entries already
  covered by the workspace, `/tmp` or `/dev/shm`, or nested inside another
  grant, are not bound.
- **Message localization is partial by design** — the preflight verdicts, `bwrap`
  remedies and distro/workdir errors follow the app's Language setting
  ([CONFIGURATION.md](CONFIGURATION.md#message-language)); the `FS_*` refusal texts
  in `fs-decisions` and the fsio replica stay byte-identical English because the
  tool layer matches on those strings. The standalone `scripts/doctor.mjs`
  localizes only its fixed skeleton — verdict, marks, summary, hints — through
  its own catalogs, detected from the Windows locale (`--locale <tag>` /
  `DSH_WSL_DOCTOR_LOCALE` override); per-check titles, details and remedies
  stay English because remedies carry copy-paste commands, and `--json` stays
  language-independent.
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
  stays in the app log. A resident that is dead fails the merged check and the
  report's verdict follows; a resident that recovered keeps the fresh probe's
  verdict, and when the reads are not on the native agent the merged detail
  says why.
- **`dsh-wsl-*.scope` counts are point-in-time**; `--fix` runs the preflight's sweep.
- **The doctor's `git.win-safe` probe reports the Windows git trust through interop
  `git.exe`** — the `safe.directory` whitelist that WSL change review needs when
  Windows git is installed (see Terminals below).

## The doctor's verdict and remedy boundary

The doctor's `verdict` answers under the effective configuration (the profile
layers the app loads, overlaid on the shipped preset) — but it is a verdict
about the machine and the configuration, not about a session: the
**policy**- and **data**-class error codes (see
[DIAGNOSTICS.md](DIAGNOSTICS.md#the-map)) are per-call decisions the doctor
cannot predict, and `ready` does not promise them away.

**`/wsl-doctor` without a resolvable distro still sweeps the configuration.**
The command names the distro from the session's working directory; a session on
a Windows folder, or one whose cwd cannot resolve, leaves the target to the
effective configuration, and the shipped `auto` probes every installed distro —
measured at ~4 minutes for eight on the development machine, against seconds
for a scoped run. Pass `--distro <name>` when that is not what you want (the
CLI's `--all` says the same thing explicitly). The handler bounds an unresolved
run at 60 s (a resolved one at 120 s) so it settles with the narrowing hint
instead of leaving the card "executing" for the dispatcher's whole budget.

The sidebar's stored result is a record of the last run, not a live verdict:
its timestamp and source say which run it is, and a probe is never started for
a stopped distro in the background. The doctor reads and reports; it never
rewrites user- or distro-owned files.
`.wslconfig`, `/etc/wsl.conf`, a WSL1 conversion and distro installation are
remedy-only — the remedy text carries the exact command — and the fixable set
is limited to what is safe and reversible (stale scopes, the plugin-owned
agent cache, the optional packages behind `--install` plus a confirmation, and
the Windows git safe.directory whitelist behind the same gate). `--fix-owned`
narrows a repair to the plugin-owned two (stale scopes and the cache); the
sidebar's **修复插件状态** action is exactly that run, while full diagnosis
itself is read-only. It can never install a package or write Windows-owned
configuration, and it never implies that a remedy-only warning is auto-fixable.
The verdict never upgrades the
sandbox's security statement: `enforcement: partial` is untouched.

## Session-start advisories

- **There is no session-UI notice seam in DSH 0.2.1.** A blocked `wsl-preflight`
  verdict goes to the host log and the session's runtime context (model-visible
  next assembly) — advisory only, never installing or cancelling. A ready
  verdict is log-only: "the prerequisite is usable" is not a model action. The
  upstream ask: [UPSTREAM-SESSION-NOTICE.md](UPSTREAM-SESSION-NOTICE.md).
- **The runtime-context entry is a repeated snapshot, not a dismissible
  notification.** Removing the `wsl-preflight` row silences the probe entirely.
  A blocked message marks its remedy as operator action to ask the user about;
  ready verdicts are not sent.
- **The access-mode reminder is plugin-owned UI, not a notice seam.** It renders
  in the composer dock when the client's session list carries the `agentPreset`
  projection; the `auto-preset` settings row supplies the target preset and the
  recorded directories, and an unreadable or throwing row falls back to `wsl`
  with no recorded directories — a visible warning, never silence. It never
  infers an environment from the path alone. Without the web client (CLI,
  headless) the same state reaches the operator only through the log, and the
  model through the runtime-context entry.
- **The creation-time preset binding depends on the host's private controller
  shape.** `auto-preset` wraps `sessionController.agents.createSession` so a
  distro workspace's first mount is already the WSL preset; 0.2.1 replaced the
  older `ensureSession(sessionId, cwd, …, presetId)` frame with that request
  object. If a future host changes it again, the wrapper goes inactive: sessions
  still adopt the WSL preset after creation through `agent/created`, but a first
  turn that starts inside that window can run on the host environment (the
  Windows ACL sandbox cannot carry a `\\wsl.localhost` path). The mount warns,
  and the doctor's `session.preset-seam` row reports active/inactive — in the
  in-app surfaces only, because the standalone CLI cannot see host-process state.

## Ports

- **The port poller keeps the resident agent warm for the distros in use** — it
  refreshes every `portsRefreshMs` (10 s by default) while a live session works
  in a distro, and stops with the last of them, which is when the agent can
  idle out. Each round asks WSL which distros are running first: a stopped
  distro is not probed (the probe would boot it) and `DSH_WSL_PORTS` reads
  empty for it. Raising `portsRefreshMs` past the agent's idle timeout brings
  idle shutdown forward, at the cost of staler port facts.

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
- **A distro without a system git never disguises change review as "no
  changes"**: a snapshot call fails with exit 127, naming git, the agent
  PATH's user-local blind spot (`~/.local/bin` is invisible), and the
  bootstrap remedy; a missing snapshot directory fails in git's own dialect —
  `fatal: cannot change to ...` at exit 128 — instead of returning an empty
  result. The one-shot fallback translates the same relay lines
  (`execvpe(git) failed`, `chdir(...) failed`) the same way.
- **A multi-directory `GIT_*` value is translated, not skipped — and a
  Windows-form list comes out wrong.** The translation applies the single-value
  translator to every `GIT_*` value unchecked, so a list folds onto the first
  drive's mount (`C:\a;D:\b` becomes `/mnt/c/a;D:/b`); only a POSIX-form colon
  list (`/a:/b`) passes through verbatim (no current caller sets a list).
- **A NEW tab's title reads `WSL`** whatever it runs — the controller stamps
  `title: shell.name` from the composition's profile only after `spawnTerminal`
  has returned, after the provider's rewrite has already run, and it never reads
  back the program the launch really started (the spawn spec carries no
  display-name field), so a plugin cannot correct the default
  ([UPSTREAM-TERMINAL-TITLE.md](UPSTREAM-TERMINAL-TITLE.md)). The menu ships
  host candidates (`powershell`, `cmd`): a manually selected shell is titled
  after itself; double-click rename also works.
- **Distro terminals ARE reclaimed when idle** — the handle counts the marked
  processes through the resident agent (exactly one at its prompt = `idle`; a nested
  shell or an `ssh-agent` from startup files reads `busy` by design). Threshold: the
  controller's `unattendedTimeoutMs` (2 h). `terminalIdleReclaim: false` restores
  close-by-hand. Windows-folder host terminals keep the shipped no-reclamation
  behaviour.

## Enabling the plugin on a running profile

- **A live enable of this bundle defers the takeover until the outgoing
  provider releases, instead of failing.** The three root-plane takeovers
  (`subprocess`, `fs`, `directoryPicker`) replace shipped services under the
  same names. When the previous provision is still registered during a live
  recomposition, the plugin's rows stay ACTIVE and register after
  `internal/service` reports the slot released (`src/service-takeover.ts`), so
  cordis's duplicate-service error no longer fails the enable. The shipped
  provider keeps serving until then; `/wsl-doctor`'s `providers.takeover` row
  names it. If a dependent never releases, restarting the app completes the
  takeover (the cold composition is correct). Mechanism and repro:
  [UPSTREAM-SERVICE-SWAP.md](UPSTREAM-SERVICE-SWAP.md).
- **Upgrading through the plugin manager no longer rolls back; the takeover may
  wait for a restart.** With HMR, `updateBundle` calls `removeBundle` before
  installing the target. The moment the old layer is removed, this patch's
  takeover entries (`- id: subprocess` / `disabled: true`, …) disappear with
  it and the shipped rows re-activate; when the incoming layer arrives, this
  plugin's rows find the slots occupied and wait for the release, so the
  manager sees a success and keeps the target version. If a shipped provider is
  never released (a dependent outlives the recomposition), the takeover
  completes at the next restart, and `providers.takeover` names the shipped
  provider meanwhile. The host-side remove→install window remains an upstream
  issue ([deepseek-harness#12510](https://github.com/deepseek-ai/deepseek-harness/discussions/12510))
  that can still fail other bundles; this plugin no longer triggers a rollback.
  [#39](https://github.com/Big-Dao/dsh-plugin-wsl-env/issues/39) records the
  actual `0.24.0 → 0.26.2` behavior.
- **The panel's one-click upgrade needs a host plugin-manager with
  `updateBundle`, and it is never automatic.** A linked checkout or a package
  without a registry source is refused by the host as `not-updatable`; the
  panel still shows the installed version and points at the Plugins page. The
  check itself is read-only (`listVersions`); only the panel's explicit POST
  calls `updateBundle`. The host may answer `restart-required` (no HMR, or a
  host-module change) or roll back a failed target, and the panel reports both.
  If the host process restarts or the connection drops during the update, the
  browser can lose the response even though the install committed — reload the
  page and read the version card before retrying.

## Host "Open in app"

- **The plugin's "Open in VS Code (WSL)" menu item works; the shipped "Open in
  app" item still does not.** The `wsl-open-in-app` row scrubs the **editor
  child's** environment with the host `scrubbedParentEnv()` rule — keys
  matching `KEY`/`PASSWORD`/`SECRET`/`TOKEN` (case-insensitive) and the `DSH_*`
  namespace — and drops `ELECTRON_RUN_AS_NODE`, so VS Code starts as an
  application; the route converts a WSL UNC workspace to its
  `vscode-remote` URI and the editor lands in Remote-WSL. The scrub is
  deliberately child-scoped: deleting the name from the Host process
  environment breaks Node-mode helpers such as the Windows Job runner. The
  shipped item keeps inheriting the flag and still fails; that half belongs
  upstream: [UPSTREAM-OPEN-IN-APP.md](UPSTREAM-OPEN-IN-APP.md). Nothing patches
  `app.asar`, so an app upgrade cannot drop the plugin's half.
- **WSL files open again, but relative Markdown images no longer render in the
  WSL preview.** The router's `processPath` now answers in UNC host spelling —
  the shape `session.openWorkspacePath` / `workspacePathApplications` verify
  (issue #37) — and the client's `fileMediaUrl` rejects a `\\`-prefixed path, so
  a Markdown preview's relative image does not resolve. Chat images already had
  that gap (the Session cwd is UNC). The same spelling is why the GUI change
  feed, `stat.absolutePath`, and the preview header's path label carry UNC.

## Sidebar terminal font

- **The terminal font is a DSH user setting, not a plugin setting.** On
  `0.2.2-rc.2` the sidebar terminal renders `ui-theme.terminalFontFamily` (an
  empty value falls back to the built-in `ui-monospace`/Consolas stack), and
  that field lives in the profile's `cordis.patch.yml`. Set it once in
  **Settings → General → Fonts → terminal font** rather than hand-editing the
  profile; a hand-added row is lost when Desktop's fatal recovery renames the
  profile patch to a `.bak-*` sibling. If the choice must survive that recovery,
  mirror the complete `ui-theme` row in `$DSH_HOME/cordis.patch.yml` — the
  home-level layer is not renamed, and a patch replaces the row's whole config,
  so restate every field you keep. The plugin does not own renderer typography
  and never writes this setting.
