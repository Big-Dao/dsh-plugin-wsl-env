# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The reasoning and the measurements behind each entry are in
[README.zh.md](README.zh.md); the section numbers below point at the record.

## [Unreleased]

### Added

- **Distro-side sandboxing** (`lib/sandbox.js`, and `sandbox: true` on both
  providers): WSL commands are now confined instead of running unconfined. The
  Windows ACL runner can never reach WSL — its restricted token fails `wsl.exe`
  with `Wsl/E_ACCESSDENIED` — so the confinement is built on the host and
  executed *inside* the distro: `wsl.exe … --exec bwrap --ro-bind / / --dev /dev
  --unshare-pid --proc /proc --die-with-parent [--tmpfs /tmp --bind <workspace>
  <workspace>] -- <shell> -lc <cmd>`. The profile arguments, the denial dialect
  (`read-only file system`) and the runner-failure rules mirror
  `@deepseek-ai/dsh-sandbox-local`'s Linux rung, so a denial reads the same
  whether the command ran on a Linux host or in a distro. `WslShellExecutor` and
  `WslFileSystem` advertise the mode through their `sandboxMode` capability fact,
  which brings back the Permissions selector and the denied→escalate flow
  (`danger-full-access` skips the wrap entirely). Enforcement is reported as
  **`partial`**, not `full`: a distro process can still execute a Windows binary
  through interop, which bubblewrap does not govern — measured, not assumed, by
  the probe below. Without `bubblewrap` in the distro the providers fail closed
  with `SANDBOX_UNAVAILABLE`; `sandbox: false` restores the old posture and
  removes the capability fact with it.
- Sandbox probes. `test/probe/sandbox.sh` (`npm run probe:sandbox`) needs no
  harness: it applies the exact profile arguments and asserts what bubblewrap
  governs — a write outside the workspace refused with EROFS, an ephemeral
  sandbox `/tmp`, a read-only `/mnt/c`, and the interop escape, recorded as
  `INFO` because a Linux sandbox cannot govern a Windows process.
  `test/probe/sandbox-shell.sh` (`npm run probe:sandbox-shell`) boots the
  throwaway profile with the executor mounted and drives the same three modes
  through `ctx.shell`, asserting the result's `denied`/`enforcement` facts.
- `WslSubprocessRuntime` (`ctx.subprocess`, subpath
  `dsh-plugin-wsl-env/subprocess`): the GUI's right-sidebar terminal window now
  opens a shell *inside the distro*, in the Session workspace, instead of
  `cmd.exe` in a UNC directory. It is a `LocalSubprocessRuntime` subclass whose
  only override is `spawnTerminal`, so every ordinary command, the host ripgrep
  search and every other subprocess consumer keeps the shipped implementation.
  The `wsl.exe` launch is rewritten to `wsl.exe -d <distro> --cd <linux dir>`,
  with the request's `DSH_*` facts forwarded through `WSLENV`, and the distro's
  own login shell is left to `wsl.exe` unless the provider pins one.
- Terminal probe (`test/probe/terminal.sh`, `npm run probe:terminal`): boots the
  throwaway Web profile with the provider in place, asks for the same
  `spawnTerminal` request the GUI makes, and asserts the distro, the translated
  initial directory, and the forwarded `DSH_SESSION_ID`.

### Changed

- `WslFileSystem` fences its mutations by `ctx.sandboxPolicy`: `writeText` and
  `editText` check the policy before any I/O, re-resolve the target so the checked
  identity is the mutated one, refuse `read-only` and anything outside the
  writable roots with `FS_SANDBOX_DENIED`, and refuse nothing at all under
  `danger-full-access`. The writable roots are the workspace plus the temp area of
  the world that workspace lives in — a distro workspace grants the distro's
  `/tmp`, a Windows-folder workspace keeps upstream's `/tmp` + `os.tmpdir()`.
  `@deepseek-ai/dsh-sandbox` returns as a peer: the plugin imports the shared
  `canonicalPath`/`writableRoots` and the runner-failure/diagnostic classifiers
  rather than restating them.
- The README's "one constraint that shapes everything" section is gone: it said
  the plugin inherits `sandboxMode === undefined`, which is no longer true. The
  replacement states the mechanism (Linux bubblewrap inside the distro), the mode
  table, the `partial` enforcement and its interop cause, the `bubblewrap`
  requirement and the fail-closed behaviour.
- An empty `cwd` now means **the distro user's home** in both WSL providers,
  instead of the host path the shipped default resolves to. `WslFileSystem`'s
  default was `process.cwd()` — a Windows directory no `wsl.exe --cd` accepts —
  and `cordis.patch.yml` papered over it with the author's own `/home/andy`, a
  value that is wrong on every other machine. `WslShellExecutor.resolve()` keeps
  the seam's synchronous contract (`ctx.shell.execute(ctx.shell.resolve(…))` is
  called with no `await` in between) and marks the case with an empty `workdir`;
  `execute()` fills it from the distro's `$HOME`, one cached `wsl.exe` query per
  provider instance. Only relative input consults the base at all, so an
  absolute path never pays for the query, and `DSH_WSL_HOME` now takes the POSIX
  home directly (`linuxHomePath`) instead of converting the world path back. The
  `wslfs` probe follows: its profile no longer pins a `cwd`, and `fs-probe.mjs`
  resolves a relative name and asserts it lands under the home the distro itself
  reports — which is the only place that fallback was reachable at all, since the
  tool layer always passes an absolute Session directory.
- The package is now a DSH **bundle**, so installing it applies the layer instead
  of merely dropping code into a profile. `package.json` declares
  `dsh.bundle.patch` → `./cordis.patch.yml`, which is the declaration
  `dsh plugin --profile <name> add dsh-plugin-wsl-env` reads; `private: true` is
  gone (npm refuses to publish it otherwise), and `repository`/`homepage`/`bugs`
  now point at the GitHub repository. The package is plain JS with no
  dependencies, so a published install needs no `allowBuilds` permission and no
  build step. README's Install section follows: create the profile from the Web
  template, `dsh plugin … add`, then `--dump-config`.
- `cordis.patch.yml` is now only the plugin's own layer. The four machine-local
  rows it used to carry — `agent-default-model`, `ui-settings-account`,
  `ui-chat`, `ui-settings` — moved to
  [examples/profile.cordis.patch.yml](examples/profile.cordis.patch.yml), which
  documents what a reader's own `$DSH_HOME/profiles/<name>/cordis.patch.yml` is
  for and what a by-id row override looks like.
- The terminal is bound at the **composition** level, not in the `wsl` preset.
  `dsh-api-terminal-controller` resolves its execution world with
  `agent.ctx.get("subprocess")`, and an Agent's context is created by the agent
  loop under the root realm (`createScope(loopCtx, …)`, `loopCtx` = the
  root-mounted `ctx.agents`), while a preset's isolate realms belong to
  `dsh-agent-preset-registry`'s own context (`createScope(this.owner, …)`). A
  `subprocess` provider inside `preset-wsl` is therefore invisible to the
  terminal window — the registry's `agentPresets.serviceFor(agent, name)` is the
  sanctioned channel for that gap, and the controller does not use it.
  `cordis.patch.yml` consequently disables the shipped `subprocess` row and
  inserts this provider, and configures `terminal-controller` with
  `shell: { path: wsl.exe, name: WSL }` and `shellCandidates: []`.
- `@deepseek-ai/dsh-subprocess-local` is now a declared peer. A linked plugin's
  bare imports are routed through its `peerDependencies` by the runtime's
  resolution interception, so an undeclared peer is not merely untidy — the
  module fails to import with `failed to import`.
- The README is now **current state only**. The five sections describing designs
  that this one replaced — the per-process `DSH_WSL` switch and the three
  abandoned tool-naming routes — moved to
  [docs/archive/design-history.zh.md](docs/archive/design-history.zh.md), which
  keeps their original numbering and records where each conclusion lives now.
  The README renumbered accordingly; its §0.1 explains the split. The one part of
  the old desktop section that is still current (regenerating the generated
  `preset-wsl` block after an app upgrade) stayed, as §13.9.
- Static review: the manifest now says only what the shipped code does.
  - `main` pointed at `lib/index.js` while `exports["."]` resolved to
    `lib/shell.js`. Only the latter exposes a default export, so a tool that
    read `main` instead of `exports` got a module with no plugin in it.
  - `lib/index.js` re-exported path helpers that nothing could reach: the
    `exports` map does not expose `lib/index.js`, and the helpers already have
    their own `./paths` and `./wsl` subpaths.
  - Dropped an unused `ENV_OVERRIDES` import.

### Known limitations

- The sandbox does not govern WSL interop: a confined distro command can still
  execute a Windows binary from `/mnt/c`, and that process runs outside
  bubblewrap under the ordinary Windows token. Enforcement is therefore reported
  as `partial`, and `npm run probe:sandbox` re-measures the escape. Closing it
  would mean denying execution under `/mnt`, which breaks `/mnt/c/…` Sessions.
- `bubblewrap` must be installed in the distro, and both providers **fail
  closed** without it (`SANDBOX_UNAVAILABLE` rather than a silent unconfined
  run). `sandbox: false` is the documented opt-out. A `workspace-write` profile
  also refuses to bind a workspace root that does not exist, so a Session whose
  workspace directory was deleted reports a runner diagnostic instead of being
  recreated.
- The GUI terminal is an interactive shell and is not wrapped in the sandbox,
  exactly like the shipped terminal provider.
- The runtime mirror's destination lies outside every Session workspace, so the
  sync step of `npm run probe` (and of a manual `sync-to-windows.sh`) needs an
  approved `danger-full-access` escalation when an agent runs it.
- The terminal follows the composition, not the Session: a Session whose
  workspace is a Windows folder gets the same distro terminal, started in that
  folder as `/mnt/<drive>/…`.
- Terminal activity reporting stops at `wsl.exe`, so the controller's unattended
  idle reclamation never fires for these terminals; close the tab to release the
  process.

### Removed

- Three peer declarations this plugin neither imports nor injects:
  `@deepseek-ai/dsh-sandbox`, `@deepseek-ai/dsh-shell` and
  `@deepseek-ai/dsh-tools`. They were required by the abandoned tool-renaming
  designs (archive §15/§18), which could only stub the sandbox symbols locally
  (archive §15.5). The remaining set is checkable in one command —
  `grep -rho 'from "@deepseek-ai/[^"]*"' lib/ | sort -u` — plus
  `@deepseek-ai/dsh-subprocess` (the service `static inject` requires) and
  `@deepseek-ai/cordis`, which every DSH plugin declares.
  (`@deepseek-ai/dsh-sandbox` came back in this same release: the distro-side
  sandbox imports `canonicalPath`/`writableRoots` and the runner diagnostics, so
  the declaration is earned again rather than vestigial — and that same check is
  what surfaced it, by listing the package this entry had removed.)

### Fixed

- `lib/listing.js` built breadcrumbs with the platform-default
  `dirname`/`basename` from `node:path` rather than the `win32` flavour its own
  comments describe. On Linux — where the CI runners run, and where this
  checkout itself lives — a UNC path parses as a single opaque POSIX segment,
  so the ancestry chain collapsed to `['.', <whole path>]` and three
  `test/listing.test.mjs` checks failed. The helpers serve Windows paths only;
  they now call `win32.dirname`/`win32.basename` explicitly, and the suite
  passes on Linux again.

Documentation that a reader would have acted on, and that was no longer true:

- README.zh.md §2.1 and §3.4 still conclude that "any WSL plugin must run on a
  non-sandboxing provider" and that both providers report `sandboxMode:
  undefined` (§9's recorded self-check prints exactly that). The Windows ACL
  constraint in §2.1 holds and is unchanged; the *conclusion* it drew about our
  own confinement does not, because the sandbox now runs inside the distro. Those
  sections state the superseded posture and should be read against the README's
  "Sandboxing" section.
- §9.6 and §10.5 claimed the `wsl` and `wsltest` profiles were still available,
  and §13.6 said the same about `envweb`. All three are gone.
- The desktop section documented the superseded `build-desktop-patch.mjs`
  regeneration flow instead of `build-preset-wsl.mjs`.
- §15.5 answered "nothing to do after an app upgrade" while the desktop section
  said the generated preset copy has to be regenerated.
- References to `dsh-wsl-research/` now say it is a machine-local directory that
  is not part of the repository.

## [0.1.0] - 2026-10-02

First working release: a WSL distro can be opened, browsed and worked in from a
DeepSeek Harness session, with both capability seams served from the distro.

### Added

- `WslShellExecutor` (`ctx.shell`): runs every command inside the distro as
  `wsl.exe -d <distro> --cd <linux dir> --exec <shell> -lc <cmd>`, where the
  shell is the distro user's login shell rather than a hardcoded bash. (§3, §12)
- `WslFileSystem` (`ctx.fs`): maps Linux paths onto the distro's UNC share so the
  host fs stack — including the packaged ripgrep — operates on real distro files,
  with Linux paths as the model-facing `displayPath` and the UNC path as the
  opaque `targetKey`. (§3)
- Symlinked paths resolve by asking the distro for `readlink -f` and retrying
  once, which is what makes `/etc/os-release`, `/bin` and `/lib` readable over a
  share that cannot traverse POSIX symlinks. (§10.4)
- `WslDirectoryPicker` (`ctx.directoryPicker`): lists Windows home and every
  installed distro at the root level, so the shipped GUI dialog becomes the
  single workspace picker for host and distro folders alike. It reports
  `kind: 'browse'` — a third kind would invalidate the three Remote verbs that
  require it. (§8)
- `auto-preset`: binds the `wsl` agent preset when a new session's workspace is
  inside a distro, inside the `ensureSession` frame so the very first mount is
  already correct and the host ACL sandbox never touches a 9p path. (§13, §15)
- `shell-env`: contributes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL` and `DSH_WSL_HOME`
  to the managed `DSH_*` namespace, so the model can read the real environment
  instead of inferring it from a tool name. (§14)
- Behavioural probe harness under `test/probe/`, with two throwaway profiles and
  a negative-control run. (§16.5)

### Fixed

- `wsl.exe` was handed the command without `--exec`, so the distro's default
  shell expanded it once first: `$x`, `$?`, `$(...)`, `${...}` and backticks were
  silently eaten. (§11)
- The shell was hardcoded to bash, discarding the PATH and rc setup of a user
  whose login shell is zsh, fish or dash. (§12)
- Guarded creation (`createIfAbsent`) failed with `FS_IO_ERROR`, because the host
  backend publishes it with a hard link and the share rejects hard links with
  `ENOTSUP`; the guard is now checked by this backend and publication is a plain
  rename. (§2.2)
- The managed `DSH_*` namespace never reached the distro. WSL imports only the
  names listed in `WSLENV`, and the executor forwarded a fixed allowlist; it now
  forwards the whole prefix, and marks the two Windows-path facts `DSH_HOME` and
  `DSH_PROFILE_DIR` with `/p` so the distro sees `/mnt/c/...`. (§14.7)
- **Every write to an existing file, and therefore every edit, failed** with
  `EIO: GetFileSecurityW EIO (Win32 1)`. `dsh-fs-local` takes a Windows branch
  whenever the destination exists — to inherit the replaced file's DACL — and a
  9p share carries no Windows security descriptor. Publication now uses the POSIX
  path. (§16)
- Overwriting or editing a file silently dropped its POSIX mode, so editing a
  script made it non-executable: the share ignores a host-side `chmod`, and a
  host-side `stat` always reports 0666. The target's real mode is now copied onto
  the staged temp file inside the distro, where a rename preserves it. (§16.3)

### Known limitations

See [README.zh.md §7](README.zh.md) for the full list, including the 9p
performance caveat, unsupported `watch()`, and the missing executable bit on
freshly created files.
