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

Then open a folder under `\\wsl.localhost\<distro>\...` in the GUI. The picker lists every installed distro at its root level, and **New terminal** opens a shell in the distro.

You also need **bubblewrap inside the distro**: run `npm run bootstrap -- <distro> --install` (drop `--install` for a read-only check), or paste `wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap`. Without it every command fails closed, see [Sandbox](#sandbox).

Uninstall: `dsh plugin --profile wsl remove dsh-plugin-wsl-env`. Upgrade: run the same `add` command again.

> **Changed anything under `lib/`? Restart the app.** A running process caches ES modules and keeps the old code otherwise.

## Using it

Open `\\wsl.localhost\ubuntu\home\you\project` as the workspace, then ask the model "what kernel am I on, and what is in `/etc/os-release`?". It runs `uname -r` and reads that file inside the distro. Nothing goes through `/mnt/c`, and no files are copied.

- **A distro folder gets the distro environment automatically.** The `wsl` preset is bound while the session is created, so the first tool call is already correct.
- **Commands** run as `wsl.exe -d <distro> --cd <linux dir> --exec <your login shell> -lc <command>`, so your `PATH`, `nvm`, `cargo`, `pyenv` and rc files apply. The shell is not hardcoded to bash.
- **Files are the distro's real files.** `/home/you/x` and `\\wsl.localhost\ubuntu\home\you\x` are the same file, and `/mnt/c/...` reaches the Windows disk.
- **The terminal** (right sidebar, then *New terminal*) opens a shell inside the distro, in the session's folder.
- **Port visibility.** The model sees which ports have a listener inside the distro (`DSH_WSL_PORTS`, refreshed about every 10 s), so it can hand you the exact URL of a dev server it just started; WSL2's localhost forwarding makes it reachable from Windows directly.
- **The model sees its shell environment.** The plugin registers `DSH_WSL_DISTRO`, `DSH_WSL_SHELL` and `DSH_WSL_HOME` in the managed `DSH_*` namespace.
- **Permissions work as on a Linux host.** The Permissions selector switches between `read-only`, `workspace-write` (the default) and `danger-full-access`. A refused command or write comes back with an offer to run it with wider permissions; if you approve, that one call runs without the sandbox.

## Configure

Override a row by id in `$DSH_HOME/profiles/<name>/cordis.patch.yml`. The keys worth knowing:

| Row | Key | Default | Meaning |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | distro name; empty means WSL's default distro |
| | `sandbox` | `true` | confine commands with `bubblewrap`; `false` disables the sandbox |
| `wsl-fs` | `distro` | `''` | as above |
| | `restrictToDistro` | `true` | refuse a path in **another distro**'s share; `/mnt/c` is inside this distro and is not affected. Refused with `FS_OUTSIDE_DISTRO`, which is not a sandbox denial and cannot be lifted by wider permissions |
| | `sandbox` | `true` | check `writeText` and `editText` against the policy |
| | `substrate` | `agent` | which I/O substrate serves the file tools: `agent` — the resident in-distro agent, where reads, writes and identities run on ext4 (native symlinks and mode bits; the write guard survives to publication, kernel-enforced under a confined policy); `share` — the opt-out: the Windows-side host stack over the 9p share. Both fence writes with the same policy; see [LIMITATIONS.md](docs/LIMITATIONS.md) for what changes |
| `directory-picker-wsl` | `includeHostHome` | `true` | also list the Windows home directory |
| `subprocess-wsl` | `distro` | `''` | which distro the GUI terminal opens in |

[`cordis.patch.yml`](cordis.patch.yml) is the commented reference for every shipped value. [docs/CONFIGURATION.md](docs/CONFIGURATION.md) lists the rest, including `shell`, `loginShell`, `cwd`, `timeoutMs`, `resolveSymlinks`, `preferredDistro` and `maxEntries`; [examples/profile.cordis.patch.yml](examples/profile.cordis.patch.yml) is a machine-local layer to copy from.

## Recipes

- **Git credential sharing**: let git inside the distro use the Windows-side Git
  Credential Manager — `git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"`
  (adjust the path to your Windows Git install; WSL2's localhost forwarding is
  platform behaviour, so ports a dev server listens on inside the distro are
  reachable from Windows directly).
- **Paths and performance**: the model sees and operates on Linux paths
  (`/home/...`) on the distro's own ext4. `/mnt/c` reaches the Windows disk over
  9p — noticeably slow for many small files; keep heavy-IO projects on the
  distro filesystem. `npm run bootstrap -- <distro>` also reports whether
  ripgrep and inotifywait (the search and watch backends) are in place.
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
├─ wsl-shell-env         the DSH_WSL_DISTRO / _SHELL / _HOME / _PORTS facts the model sees
└─ auto-preset           binds the wsl preset when a session opens a distro folder

preset-wsl (the wsl agent preset; its services run in isolate realms)
├─ wsl-shell   ctx.shell — wsl.exe --exec <login shell>, confined by bubblewrap inside the distro
└─ wsl-fs      ctx.fs    — real distro files; agent substrate on ext4, or the 9p share
```

**Why two levels.** `wsl-shell` and `wsl-fs` live inside the `wsl` agent preset, which `auto-preset` binds whenever a session's workspace is inside the distro: a Windows-folder session keeps the stock providers, a distro session gets the WSL ones — the environment is a property of the session, not of the process. The terminal controller is the exception: it resolves its execution world through the root context, which never sees a preset's isolate realms, so `subprocess-wsl` sits at the composition level instead.

**Commands and files.** A command runs as `wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>` inside a distro-side bubblewrap profile assembled with the same arguments as DSH's own Linux runner, so confinement semantics and error messages match a Linux host. The file tools read and write real distro files on one of two substrates: the default `agent` — a resident in-distro process, where reads, writes and identities run on ext4 with native symlinks and mode bits — or `share`, the opt-out: the Windows-side host stack over the 9p share. Both check writes against the same policy the command sandbox enforces.

## Sandbox

Commands are confined by `bubblewrap` inside the distro, and file writes are checked against the same policy. The Windows ACL sandbox cannot be used here: its restricted token cannot reach WSL at all.

| Mode | What a command inside the distro can do |
|---|---|
| `read-only` | read the whole distro; a fresh `/dev` is mounted writable, so `/dev/null` and `/dev/shm` work, and nothing else does |
| `workspace-write` | the above, plus the session workspace is writable and `/tmp` is a temporary mount |
| `danger-full-access` | no sandbox; used for an approved wider-permission request |

**`bubblewrap` is required, and it fails closed.** Without it every confined command reports `SANDBOX_UNAVAILABLE` instead of running unconfined. Set `sandbox: false` on either provider to opt out; the tool layer then tells the model these operations have no sandbox.

**The reported enforcement is `partial`, not `full`.** A process inside the distro can still run a Windows program through WSL interop, for example `/mnt/c/.../*.exe`, and bubblewrap does not govern it. `npm run probe:sandbox` demonstrates the boundary on your machine.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#sandbox) for the design, and [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for everything the plugin does not do.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| every command reports `SANDBOX_UNAVAILABLE` | `bubblewrap` is not installed in the distro | run `npm run bootstrap -- <distro> --install`, or set `sandbox: false` on both providers |
| a command or write is refused outside the session folder | expected behaviour of `workspace-write` | accept the wider-permission offer, or open a session on the folder you need |
| writes are refused even inside the workspace | the session is in `read-only` mode | switch the Permissions selector |
| `dsh plugin add` warns that no layer was activated | the dependency was already installed, so `add` had nothing to record | run `dsh plugin --profile wsl remove dsh-plugin-wsl-env`, then add it again |
| the terminal still opens `cmd.exe` | the `terminal-controller` row from the layer did not apply | check that `dsh --profile wsl --dump-config` shows `shell: { path: wsl.exe, name: WSL }` |
| changes to `lib/` have no effect | ES module cache | restart the app |
| `link:\\wsl.localhost\...` leaves a broken symlink | pnpm cannot link a UNC path | link a Windows path instead; developing inside the distro needs the runtime mirror, see [Development](#development) |
| `glob` and `grep` are slow | the Windows-side ripgrep walks the 9p share | expected; narrow the path, or use `bash` to call tools inside the distro |
| the terminal reports `unknown` activity | shell integration only covers `bash`/`zsh` started directly on a POSIX host | close the tab to release the process; idle reclamation does not run for these terminals |
| a result names an `FS_*` code | the code says what refused it, and what clears it | see the error-code table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#error-codes) |

## Development

```bash
npm test                     # style and packaging checks, syntax check, unit tests
npm run test:coverage        # the unit tests with coverage thresholds (Node 22.8+)
npm run probe:sandbox        # measure inside the distro what bubblewrap does and does not confine
npm run probe                # filesystem probe against a real distro (Windows + WSL only)
npm run probe:sandbox-shell  # boot a real harness and drive the confined executor
npm run probe:terminal       # open a PTY through the terminal provider
npm run probe:substrate      # drive the agent filesystem substrate over a real wsl.exe transport (from inside the distro)
npm run probe:missing-wsl    # boot a profile whose wslPath cannot start (Windows + WSL only)
npm run probe:picker         # list the picker's root level, refusals and its cap (Windows + WSL only)
npm run probe:mode           # which POSIX-mode facts survive the share (Windows node only)
npm run probe:sandbox-off    # prove sandbox: false unconfines both providers (Windows + WSL only)
```

There is nothing to install first: the package has no dependencies, and every module under test imports only Node builtins. CI runs `npm test` on Node 20, 22 and 24, on Linux and Windows, and `npm run test:coverage` on Node 24.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the file layout, the mounting, and the sandbox design. [CONTRIBUTING.md](CONTRIBUTING.md) has the development loop, the full gate list, and what has been verified.

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
