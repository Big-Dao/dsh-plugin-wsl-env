# dsh-plugin-wsl-env

**English** · [中文](docs/README.zh.md)

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](LICENSE)

This plugin lets [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) use a WSL distro as its working environment: commands run inside the distro, the model's file tools read and write real distro files, the folder picker can open a distro folder, and the GUI terminal opens inside the distro.

**Windows + WSL2 only.** One install command, no dependencies of its own. The environment applies per session, so a session on a Windows folder keeps its normal Windows environment.

[Install](#install) · [Using it](#using-it) · [Configure](#configure) · [Recipes](#recipes) · [Architecture](#architecture) · [Sandbox](#sandbox) ·
[Troubleshooting](#troubleshooting) · [Development](#development) · [Documentation](#documentation)

## Install

Run these four commands in a Windows terminal:

```powershell
dsh wsl --from-default-profile web --dump-config   # 1. create the profile from the Web template
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 2. install the code and its configuration layer
dsh --profile wsl --dump-config                    # 3. compose only, no boot (the fast check)
dsh --profile wsl                                  # 4. run
```

Step 3 should print a layer named `# == dsh-plugin-wsl-env`, and `- id: terminal-controller` should now carry `shell: { path: wsl.exe, name: WSL }`. The package is a DSH bundle, so step 2 applies [`cordis.patch.yml`](cordis.patch.yml) as a configuration layer; nothing is merged by hand.

**Before the first command, give the distro bubblewrap.** Every command runs confined by [bubblewrap](#sandbox), which most distros do not preinstall, and without it every command fails closed — by design, never unconfined:

```powershell
wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap    # Debian/Ubuntu
```

From a checkout of this plugin, `pnpm run bootstrap -- <distro>` checks all four tools the plugin uses (bubblewrap, ripgrep, git, inotify-tools) and prints the install command for the distro's own package family; add `--install` to run it. A skipped step announces itself: when a distro session opens, the plugin probes bubblewrap and warns with the exact remedy — the first command never has to be the discovery moment.

Then open a folder under `\\wsl.localhost\<distro>\...` in the GUI. The picker lists every installed distro at its root level, and **New terminal** opens a shell in the distro.

Uninstall: `dsh plugin --profile wsl remove dsh-plugin-wsl-env`. Upgrade: run the same `add` command again.

> **Changed anything under `lib/`? Sync the mirror, then restart the app.** The app loads the Windows-side runtime mirror, so run `pnpm run sync:windows` first — a restart without the sync just reloads the old code; a running process also caches ES modules. See [Development](#development).

## Using it

Open `\\wsl.localhost\ubuntu\home\you\project` as the workspace, then ask the model "what kernel am I on, and what is in `/etc/os-release`?". It runs `uname -r` and reads that file inside the distro. Nothing goes through `/mnt/c`, and no files are copied.

- **A distro folder gets the distro environment automatically.** The `wsl` preset is bound while the session is created, so the first tool call is already correct.
- **Commands** run inside the distro in your login shell, so your `PATH`, `nvm`, `cargo`, `pyenv` and rc files apply; the shell is not hardcoded to bash. The default is the resident in-distro agent — one long-lived process per distro; while it is out (or with `agent: false`) the same command falls back to one `wsl.exe -d <distro> --cd <linux dir> --exec <your login shell> -lc <command>` process.
- **Files are the distro's real files.** `/home/you/x` and `\\wsl.localhost\ubuntu\home\you\x` are the same file, and `/mnt/c/...` reaches the Windows disk.
- **The terminal** (right sidebar, then *New terminal*) opens a shell inside the distro, in the session's folder.
- **Port visibility.** The model sees which ports have a listener inside the distro (`DSH_WSL_PORTS`, refreshed about every 10 s), so it can hand you the exact URL of a dev server it just started; WSL2's localhost forwarding makes it reachable from Windows directly.
- **The model sees its shell environment.** The plugin registers `DSH_WSL_DISTRO`, `DSH_WSL_SHELL`, `DSH_WSL_HOME` and the port snapshot `DSH_WSL_PORTS` in the managed `DSH_*` namespace.
- **Permissions work as on a Linux host.** The Permissions selector switches between `read-only`, `workspace-write` (the default) and `danger-full-access`. A refused command or write comes back with an offer to retry it once with the narrowest wider mode that suffices; if you approve, that one call runs in the approved mode — from `read-only` that is usually `workspace-write`, still inside the sandbox, and only an escalation to `danger-full-access` runs without one.

## Configure

Override a row by id in `$DSH_HOME/profiles/<name>/cordis.patch.yml`. The keys worth knowing:

| Row | Key | Default | Meaning |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | distro name; empty means WSL's default distro |
| | `sandbox` | `true` | confine commands with `bubblewrap`; `false` disables the sandbox |
| `wsl-fs` | `distro` | `''` | as above |
| | `restrictToDistro` | `true` | refuse a path in **another distro**'s share; `/mnt/c` is inside this distro and is not affected. Refused with `FS_OUTSIDE_DISTRO`, which is not a sandbox denial and cannot be lifted by wider permissions |
| | `sandbox` | `true` | check `writeText` and `editText` against the policy |
| | `substrate` | `agent` | which I/O substrate serves the file tools. Only the resident in-distro agent remains: reads, writes and identities run on ext4 (native symlinks and mode bits; the write guard survives to publication, kernel-enforced under a confined policy). The former `"share"` opt-out — the Windows-side host stack over the 9p share — is refused at boot; no file tool crosses the share |
| `directory-picker-wsl` | `includeHostHome` | `true` | also list the Windows home directory |
| `subprocess-wsl` | `distro` | `''` | which distro the GUI terminal opens in |

`wsl-shell` and `wsl-fs` are the two rows a by-id patch **cannot** reach: they are plugins of the `wsl` agent preset, nested inside the `preset-wsl` row's `config.plugins`, so `- id: wsl-shell` in your layer changes nothing — the loader only warns `patch: entry "wsl-shell" not found` and the shipped value stays in force. Override the `preset-wsl` row as a whole instead; [docs/CONFIGURATION.md](docs/CONFIGURATION.md#overriding-the-rows-inside-preset-wsl) has the recipe.

[`cordis.patch.yml`](cordis.patch.yml) is the commented reference for every shipped value. [docs/CONFIGURATION.md](docs/CONFIGURATION.md) lists the rest, including `shell`, `loginShell`, `cwd`, `timeoutMs`, `preferredDistro` and `maxEntries`; [examples/profile.cordis.patch.yml](examples/profile.cordis.patch.yml) is a machine-local layer to copy from.

## Recipes

- **Git credential sharing**: let git inside the distro use the Windows-side Git
  Credential Manager — `git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"`
  (adjust the path to your Windows Git install).
- **Paths and performance**: the model sees and operates on Linux paths
  (`/home/...`) on the distro's own ext4. `/mnt/c` reaches the Windows disk over
  9p — noticeably slow for many small files; keep heavy-IO projects on the
  distro filesystem. `pnpm run bootstrap -- <distro>` also reports whether
  ripgrep, git and inotifywait (the search, snapshot and watch backends) are in place.
- **WSLENV passthrough**: WSL imports only the variables listed in `WSLENV`.
  This plugin admits the managed `DSH_*` namespace by prefix, translating the
  two Windows-path ones (`DSH_HOME`, `DSH_PROFILE_DIR`) with `/p`. `PATH` is
  deliberately never forwarded — it would shadow the distro's own PATH.

## Architecture

One DSH process serves both kinds of session at once — a workspace on a Windows folder, and a workspace inside the distro — because its providers mount at two levels:

```text
composition (app level, one per process)
├─ subprocess-wsl        the GUI terminal's execution world
│                          WSL-folder session     → the distro shell, in the session's Linux directory
│                          Windows-folder session → powershell.exe, in the session's Windows directory
├─ directory-picker-wsl  installed distros listed beside the Windows home
├─ workspace-files-wsl   the GUI file tree and previews of a distro workspace, served from inside it
├─ fs-routing            the root filesystem, routed by coordinate
│                          distro UNC → the resident agent; a drive path → the host backend
├─ wsl-shell-env         the DSH_WSL_DISTRO / _SHELL / _HOME / _PORTS facts the model sees
└─ auto-preset           binds the wsl preset when a session opens a distro folder

preset-wsl (the wsl agent preset; its services run in isolate realms)
├─ wsl-shell   ctx.shell — wsl.exe --exec <login shell>, confined by bubblewrap inside the distro
└─ wsl-fs      ctx.fs    — real distro files on the resident agent substrate (ext4)
```

**Why two levels.** `wsl-shell` and `wsl-fs` live inside the `wsl` agent preset, which `auto-preset` binds whenever a session's workspace is inside the distro: a Windows-folder session keeps the stock providers, a distro session gets the WSL ones — the environment is a property of the session, not of the process. The terminal controller is the exception: it resolves its execution world through the root context, which never sees a preset's isolate realms, so `subprocess-wsl` sits at the composition level instead. `workspace-files-wsl` and `fs-routing` are composition-level for the mirror-image reason: the GUI file tree and the root `ctx.fs` are session-less, so they cannot be served from a preset. They replace the shipped `workspace-files` and root `fs-sandbox` rows outright; [docs/root-fs-routing.md](docs/root-fs-routing.md) is the design of the root-plane routing.

**Commands and files.** By default a command runs over the resident in-distro agent — one long-lived process per distro, which carries the cwd as part of the request instead of a per-command `--cd`. What it runs is the same `<login shell> -lc <cmd>` inside a distro-side bubblewrap profile assembled with the same arguments as DSH's own Linux runner, so confinement semantics and error messages match a Linux host; while the agent is out, or with `agent: false`, the command falls back to one `wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>` process. The file tools read and write real distro files on the resident in-distro agent — reads, writes and identities run on ext4 with native symlinks and mode bits — and the file-search spawn is rewritten the same way: a search over a distro workspace runs the distro's own `rg` (`wsl.exe --exec`), never the Windows binary over the 9p share. Writes are checked against the same policy the command sandbox enforces.

## Sandbox

Commands are confined by `bubblewrap` inside the distro, and file writes are checked against the same policy. The Windows ACL sandbox cannot be used here: its restricted token cannot reach WSL at all.

| Mode | What a command inside the distro can do |
|---|---|
| `read-only` | read the whole distro; a fresh `/dev` is mounted writable, so `/dev/null` and `/dev/shm` work, and nothing else does |
| `workspace-write` | the above, plus the session workspace is writable and `/tmp` is a temporary mount |
| `danger-full-access` | no sandbox; used for an approved wider-permission request |

**`bubblewrap` is required, and it fails closed.** Without it every confined command reports `SANDBOX_UNAVAILABLE` instead of running unconfined. To opt out, set `sandbox: false` on the row that owns the operation — `wsl-shell` for commands, `wsl-fs` for the write fence, and the top-level `fs-routing` row for its own copy. Note that the two preset rows are reached through `preset-wsl`, not by id (see [Configure](#configure)). The tool layer then tells the model these operations have no sandbox.

**The reported enforcement is `partial`, not `full`.** A process inside the distro can still run a Windows program through WSL interop, for example `/mnt/c/.../*.exe`, and bubblewrap does not govern it. `pnpm run probe:sandbox` demonstrates the boundary on your machine. `maskWindowsDrive: true` on the `wsl-shell`, `wsl-fs` and `fs-routing` rows narrows it — the confined profile shadows `/mnt` with an empty tmpfs, so the drive's files cannot be read or exfiltrated and its executables cannot be launched — but does not close it: a command can still write an executable into the workspace and run it, so enforcement stays `partial`. The complete closure is distro-level, `[interop] enabled=false` in `wsl.conf` (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md)).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#sandbox) for the design, and [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for everything the plugin does not do.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| every command reports `SANDBOX_UNAVAILABLE` | `bubblewrap` is missing from the distro, or present but unusable — the error text distinguishes the two and carries the matching remedy | follow the remedy in the error, or set `sandbox: false` on `wsl-shell` (commands) and `wsl-fs` (writes) — see [Configure](#configure) for how to reach those rows |
| a command or write is refused outside the session folder | expected behaviour of `workspace-write` | accept the wider-permission offer, or open a session on the folder you need |
| writes are refused even inside the workspace | the session is in `read-only` mode | switch the Permissions selector |
| `dsh plugin add` prints no confirmation that a layer was added | the dependency is already installed and the bundle list is unchanged, so `add` reconciles to the same manifest without reporting anything — that is the success path, not a failure | nothing to do; the layer is already in place, and `dsh --profile wsl --dump-config` still shows `# == dsh-plugin-wsl-env` |
| the terminal still opens `cmd.exe` | the `terminal-controller` row from the layer did not apply | check that `dsh --profile wsl --dump-config` shows `shell: { path: wsl.exe, name: WSL }` |
| changes to `lib/` have no effect | the app loads the Windows-side runtime mirror, and a running process also caches ES modules | run `pnpm run sync:windows` to bring the mirror up to date, then restart the app |
| `link:\\wsl.localhost\...` leaves a broken symlink | pnpm cannot link a UNC path | link a Windows path instead; developing inside the distro needs the runtime mirror, see [Development](#development) |
| `glob` and `grep` are slow | a distro search without rg inside the distro falls back to rg's own "command not found"; a Windows-folder search is native and unaffected | run `pnpm run bootstrap -- <distro> --install` (installs ripgrep); distro searches always run the distro's rg — they never walk the 9p share |
| the terminal reports `unknown` activity | only while the resident agent is out — distro terminals are observed from inside the distro (a `DSH_TERMINAL_ID` marker scanned in `/proc`: a shell alone is `idle`, a shell running anything is `busy`) | check the distro is running; idle terminals are reclaimed automatically after the controller's unattended timeout (2 h by default), and `terminalIdleReclaim: false` restores the close-by-hand posture |
| a result names an `FS_*` code | the code says what refused it, and what clears it | see the error-code table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#error-codes) |

## Development

```bash
pnpm run build                # compile src/ into lib/ (the artifact is committed; rebuild after editing src/)
pnpm test                     # style checks, syntax pass, build consistency, type check, and unit tests
pnpm run sync:windows         # mirror the checkout onto the Windows-side copy the app loads (after any lib/ change, then restart the app)
pnpm run test:coverage        # the unit tests with coverage thresholds (Node 22.8+)
pnpm run diagnose             # read-only diagnostic report for a bug issue: versions, tools, bwrap probe
pnpm run bootstrap -- <distro> # check the four distro tools; add --install to install what is missing
pnpm run probe:sandbox        # measure inside the distro what bubblewrap does and does not confine
pnpm run probe                # filesystem probe against a real distro (Windows + WSL only)
pnpm run probe:sandbox-shell  # boot a real harness and drive the confined executor
pnpm run probe:terminal       # open a PTY through the terminal provider
pnpm run probe:substrate      # drive the agent filesystem substrate over a real wsl.exe transport (from inside the distro)
pnpm run probe:watch          # arm the in-distro watcher over a real directory (from inside the distro)
pnpm run probe:agent          # the resident-vs-one-shot fallback parity legs (from inside the distro)
pnpm run probe:exec           # the agent-backed execution handle: timeout, kill, cwd failure (from inside the distro)
pnpm run probe:missing-wsl    # boot a profile whose wslPath cannot start (Windows + WSL only)
pnpm run probe:picker         # list the picker's root level, refusals and its cap (Windows + WSL only)
pnpm run probe:mode           # which POSIX-mode facts survive the share (needs a Windows node and an installed harness; opens no profile)
pnpm run probe:sandbox-off    # prove sandbox: false unconfines both providers (Windows + WSL only)
```

The app loads the Windows-side runtime mirror, not the repository checkout: after changing anything under `lib/`, run `pnpm run sync:windows` before restarting the app — otherwise the restart just reloads the old code. `pnpm run build` regenerates `lib/` from `src/`; the artifact is committed, and the build-freshness check inside `pnpm test` verifies it.

One `pnpm install` reproduces the pinned development dependencies before the first run: the tests import pinned `@deepseek-ai/*` packages (the composition and boot tests exercise the loader's real patch algorithm), while the runtime package itself still ships zero dependencies. pnpm is resolved through the `packageManager` field, so any corepack-enabled Node works. CI runs `pnpm test` on Node 22 and 24, on Linux and Windows, and `pnpm run test:coverage` on Node 24; `engines` matches the harness host's own floor (`^22.19.0 || >=24.0.0`).

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the file layout, the mounting, and the sandbox design. [CONTRIBUTING.md](CONTRIBUTING.md) has the development loop, the runtime mirror, the full gate list, and what has been verified.

## Documentation

| Document | What it covers |
|---|---|
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | every configuration key, and how to override it |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | providers, mounting, path coordinates, sandbox, test layers, file layout |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | what the plugin does not do, and why |
| [CONTRIBUTING.md](CONTRIBUTING.md) | the development loop, gates, conventions, verification |
| [SECURITY.md](SECURITY.md) | reporting a vulnerability privately |
| [SUPPORT.md](SUPPORT.md) | supported versions, and where to ask |
| [docs/RELEASING.md](docs/RELEASING.md) | the release checklist |
| [docs/archive/README.en.md](docs/archive/README.en.md) | English index of the archived engineering record |

## License

MIT. See [LICENSE](LICENSE).
