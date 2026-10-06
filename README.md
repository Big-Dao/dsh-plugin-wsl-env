# dsh-plugin-wsl-env

**English** · [中文](docs/README.zh.md)

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](LICENSE)

This plugin lets [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) work inside a WSL distro. The model's commands run there. Its file tools read and write the real distro files. The folder picker can open a distro folder, and the GUI terminal opens a shell inside it.

**Windows + WSL2 only.** One install command, no dependencies of its own. The environment is chosen per session: a session on a Windows folder keeps the normal Windows tools.

[Install](#install) · [Using it](#using-it) · [How it compares](#how-it-compares) · [Configure](#configure) · [Recipes](#recipes) · [Architecture](#architecture) · [Sandbox](#sandbox) ·
[Troubleshooting](#troubleshooting) · [Development](#development) · [Documentation](#documentation)

## Install

Run these four commands in a Windows terminal:

```powershell
dsh wsl --from-default-profile web --dump-config   # 1. create a profile (a named set of dsh settings) from the Web template
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 2. install the plugin and its settings
dsh --profile wsl --dump-config                    # 3. a quick check: see the merged settings without starting the app
dsh --profile wsl                                  # 4. run
```

Step 3 should print a line `# == dsh-plugin-wsl-env`. That line is the plugin's settings arriving in your profile. The plugin ships its own settings, so step 2 wires everything in automatically — there is nothing to merge by hand.

**Before the first command, give the distro bubblewrap.** Every command runs inside a bubblewrap sandbox, and most distros do not have bubblewrap preinstalled. Without it, every command fails instead of running unsandboxed:

```powershell
wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap    # Debian/Ubuntu
```

From a plugin checkout, `pnpm run bootstrap -- <distro>` checks the four tools the plugin uses (bubblewrap, ripgrep, git, inotify-tools) and prints the install command for the distro's package manager; `--install` runs it. If this step is skipped, the session reports the missing package with the exact install command when it opens.

Then open a folder like `\\wsl.localhost\<distro>\...` in the GUI. The folder picker lists every installed distro, and **New terminal** opens a shell inside the distro.

Uninstall: `dsh plugin --profile wsl remove dsh-plugin-wsl-env`. Upgrade: run the same `add` command again.

> **Changed anything under `lib/`? Sync the Windows-side copy, then restart the app.** The app loads the Windows-side copy of the code, so run `pnpm run sync:windows` first. A restart without the sync just reloads the old code, and a running process also caches modules. See [Development](#development).

## Using it

Open a distro folder as the workspace — for example `\\wsl.localhost\ubuntu\home\you\project` — and ask the model "what kernel am I on, and what is in `/etc/os-release`?". It runs `uname -r` and reads that file inside the distro. Nothing is copied, and nothing crosses `/mnt/c`.

- **A distro folder gets the distro environment.** When a session opens a distro folder, it is automatically given the WSL environment. The very first command is already right.
- **Commands run where you expect.** They run inside the distro, in your own login shell — so your `PATH`, `nvm`, `cargo`, `pyenv` and rc files all apply. The shell comes from the distro's configuration; it is not hardcoded to bash.
- **Files are the real files.** `/home/you/x` and `\\wsl.localhost\ubuntu\home\you\x` are the same file. `/mnt/c/...` reaches the Windows disk as usual.
- **The terminal too.** Right sidebar, *New terminal*: a shell inside the distro, in the session's folder.
- **Port visibility.** The model sees which ports are listening inside the distro (refreshed about every 10 seconds) and can return the exact URL of a dev server it starts. WSL2 forwards localhost to Windows, so the URL opens in the browser directly.
- **Permissions work like on a Linux host.** The Permissions selector offers `read-only`, `workspace-write` (the default) and `danger-full-access`. When something is refused, the model is offered one retry with the smallest permission that would work. Only `danger-full-access` runs without the sandbox.

## How it compares

Three ways for a Windows coding tool to work on a WSL project:

1. **Install the tool inside WSL.** Codex CLI, Claude Code and ZCode CLI all recommend this, and they are right — it is the simplest path when a CLI tool covers your work. It needs the whole tool to live inside WSL. DeepSeek Harness cannot, so it needs one of the next two.
2. **Connect from a desktop app.** VS Code (Remote-WSL, and its open-source mirror [open-remote-wsl](https://github.com/jeanp413/open-remote-wsl)) and agent desktops like [ZCode](https://github.com/zai-org/ZCode) keep the app on Windows and set up a helper server inside the distro. Battle-tested. The cost: a server folder (`~/.vscode-server`, `~/.zcode/server`), a port, and no sandbox for commands.
3. **This plugin.** The harness stays on Windows. Nothing is installed in the distro, no port is opened, and commands run inside a bubblewrap sandbox. If something is missing, the session says what to install the moment it opens.

| | Option 2 (desktop remote) | Option 3 (this plugin) |
|---|---|---|
| installed in the distro | a server folder | nothing |
| opens a port | yes | no |
| command sandbox | none | bubblewrap |
| after uninstall | remove the server manually | nothing left |
| after a WSL upgrade | server may need repair | the next command recovers automatically |

**Where the others win.** A desktop remote re-opens a workspace instantly — its server stays warm — and VS Code's remote has years of hardening behind it. A CLI inside WSL needs none of this. This plugin is for one case: DeepSeek Harness on Windows, working on WSL projects, with commands sandboxed.

## Configure

Each setting lives on a named row. To change one, add a row with the same id to `$DSH_HOME/profiles/<name>/cordis.patch.yml` (`$DSH_HOME` is DSH's settings folder). The keys worth knowing:

| Row | Key | Default | Meaning |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | which distro to use; empty means WSL's default distro |
| | `sandbox` | `true` | run commands inside the `bubblewrap` sandbox; `false` turns it off |
| `wsl-fs` | `distro` | `''` | same as above |
| | `restrictToDistro` | `true` | refuse paths that belong to a **different** distro. (`/mnt/c` belongs to this distro, so it is not affected.) The refusal is `FS_OUTSIDE_DISTRO`; wider permissions cannot lift it |
| | `sandbox` | `true` | check file writes against the same policy |
| | `substrate` | `agent` | how file operations reach the distro. Only one value remains: the in-distro agent, so reads and writes run on the distro's own filesystem, with native symlinks and permissions. The former `"share"` option used the 9p share and is rejected at startup |
| `directory-picker-wsl` | `includeHostHome` | `true` | also list the Windows home directory in the picker |
| `subprocess-wsl` | `distro` | `''` | which distro the GUI terminal opens in |

`wsl-shell` and `wsl-fs` cannot be reached by adding `- id: wsl-shell` to your override file: they live inside the `wsl` preset's own settings (a preset is a named environment DSH can give a session), so the loader only warns `patch: entry "wsl-shell" not found` and the shipped value stays in force. To change them, copy and override the whole `preset-wsl` row — [docs/CONFIGURATION.md](docs/CONFIGURATION.md#overriding-the-rows-inside-preset-wsl) has the recipe.

[`cordis.patch.yml`](cordis.patch.yml) is the commented reference for every value the plugin ships. [docs/CONFIGURATION.md](docs/CONFIGURATION.md) lists the rest — `shell`, `loginShell`, `cwd`, `timeoutMs`, `preferredDistro`, `maxEntries` — and [examples/profile.cordis.patch.yml](examples/profile.cordis.patch.yml) is a settings file you can copy and edit.

## Recipes

- **Use your Windows git credentials inside the distro**: `git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"` (adjust the path to where your Windows Git is installed). After this, `git push` inside the distro uses the same saved credentials as Windows.
- **Keep projects on the distro's own disk.** The model works on Linux paths (`/home/...`) on the distro's own disk, which is fast. It can still reach Windows files through `/mnt/c`, but that bridge is slow when many small files are involved. `pnpm run bootstrap -- <distro>` tells you whether ripgrep, git and inotifywait — used for search and file watching — are installed.
- **Environment variables**: WSL only forwards the variables named in `WSLENV`. This plugin forwards its own `DSH_*` values, and translates the two that hold Windows paths (`DSH_HOME`, `DSH_PROFILE_DIR`) into Linux paths. Your `PATH` is never forwarded — forwarding it would hide the distro's own PATH.

## Architecture

One DSH process can serve both kinds of session at the same time: a session on a Windows folder, and a session inside the distro. The plugin's parts attach at two levels, because some things belong to one session and some belong to the whole app:

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

preset-wsl (the wsl agent preset; its settings are separate from the app's)
├─ wsl-shell   ctx.shell — wsl.exe --exec <login shell>, confined by bubblewrap inside the distro
└─ wsl-fs      ctx.fs    — real distro files on the resident agent substrate (ext4)
```

**Why two levels.** The `wsl` preset holds `wsl-shell` and `wsl-fs`, the two things that differ per session. When a session opens a distro folder, `auto-preset` gives that session the preset; a Windows-folder session keeps the normal Windows tools. One environment per session, in one process. The GUI terminal is the exception: it reads its shell from the app level, which never sees a preset, so `subprocess-wsl` is mounted at the app level. The GUI file tree and the root filesystem have the same shape of problem — every session uses them, so no single preset can own them — and `workspace-files-wsl` and `fs-routing` sit at the app level for that reason. They replace two shipped rows; [docs/root-fs-routing.md](docs/root-fs-routing.md) has the routing design.

**How a command runs.** A command normally runs on a resident agent process inside the distro — one per distro. The agent executes it in your login shell, inside a bubblewrap sandbox, and returns the output. If the agent is unavailable (or you set `agent: false`), the same command runs through a fresh `wsl.exe` process instead — same result, slightly slower.

**How file operations run.** Reads, writes and searches also happen inside the distro, on its own filesystem, with the distro's own tools. A search over a distro workspace runs the distro's `rg`, never the Windows binary over the 9p share. File writes are checked against the same policy the command sandbox enforces.

## Sandbox

Commands run inside a `bubblewrap` sandbox in the distro, and file writes are checked against the same policy. The Windows sandbox cannot be used here: its restricted account cannot reach WSL at all.

| Mode | What a command inside the distro can do |
|---|---|
| `read-only` | read the whole distro. A fresh `/dev` is mounted so `/dev/null` and `/dev/shm` work; nothing else is writable |
| `workspace-write` | all of the above, plus the session workspace is writable and `/tmp` is a temporary mount |
| `danger-full-access` | no sandbox; used when you approve a wider-permission request |

**bubblewrap is required, and the plugin fails closed.** Without it, every confined command reports `SANDBOX_UNAVAILABLE` — the command does not run unsandboxed. To turn the sandbox off, set `sandbox: false` on the row that owns the operation: `wsl-shell` for commands, `wsl-fs` for file writes, and the top-level `fs-routing` row for writes to the app's own filesystem. (The two preset rows are reached through `preset-wsl` — see [Configure](#configure).) The model is then told that these operations have no sandbox.

**Known limits.** A command inside the distro can still start a Windows program (anything under `/mnt/c/.../*.exe`), and bubblewrap does not watch Windows programs. `pnpm run probe:sandbox` demonstrates this boundary on your machine. Setting `maskWindowsDrive: true` on the three rows narrows it: `/mnt` disappears from the command's view, so the drive's files cannot be read and its programs cannot be started. It does not close the hole completely — a command could still copy a Windows program into the workspace and run it — so the report stays `partial`. The only complete fix is in the distro itself: `[interop] enabled=false` in `wsl.conf` (see [docs/CONFIGURATION.md](docs/CONFIGURATION.md)).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#sandbox) for the design, and [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for everything the plugin does not do.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| every command reports `SANDBOX_UNAVAILABLE` | `bubblewrap` is missing from the distro, or present but broken — the error text tells you which one it is and what to do | follow the fix in the error, or set `sandbox: false` on `wsl-shell` (commands) and `wsl-fs` (writes) — see [Configure](#configure) for how to reach those rows |
| a command or write is refused outside the session folder | expected: `workspace-write` only allows writes in the session folder | accept the wider-permission offer, or open the session on the folder you need |
| writes are refused even inside the workspace | the session is in `read-only` mode | switch the Permissions selector |
| `dsh plugin add` prints no confirmation that anything was added | the plugin is already installed, so there is nothing new to report — this is success, not failure | nothing to do: the settings are already in place, and `dsh --profile wsl --dump-config` still shows `# == dsh-plugin-wsl-env` |
| the terminal still opens `cmd.exe` | the `terminal-controller` row from the plugin's settings did not apply | check that `dsh --profile wsl --dump-config` shows `shell: { path: wsl.exe, name: WSL }` |
| changes to `lib/` have no effect | the app runs a Windows-side copy of the code, and a running process also caches modules | run `pnpm run sync:windows` to update the copy, then restart the app |
| `link:\\wsl.localhost\...` leaves a broken symlink | pnpm cannot link a UNC path | link a Windows path instead; developing inside the distro needs the Windows-side copy, see [Development](#development) |
| `glob` and `grep` are slow | searches inside the distro need `rg` installed in the distro; Windows-folder searches are unaffected | run `pnpm run bootstrap -- <distro> --install` (installs ripgrep); distro searches always run the distro's rg — they never cross the slow bridge |
| the terminal reports `unknown` activity | only while the in-distro agent is temporarily unavailable — distro terminals are watched from inside the distro (a `DSH_TERMINAL_ID` marker scanned in `/proc`: a shell alone is `idle`, a shell running anything is `busy`) | check the distro is running; idle terminals are closed automatically after the controller's idle timeout (2 h by default), and `terminalIdleReclaim: false` turns the auto-close off |
| a result names an `FS_*` code | the code says what refused it, and what clears it | see the error-code table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#error-codes) |

## Development

```bash
pnpm run build                # compile src/ into lib/ (the built files are committed; rebuild after editing src/)
pnpm test                     # style checks, syntax pass, build consistency, type check, and unit tests
pnpm run sync:windows         # copy the checkout onto the Windows-side copy the app loads (after any lib/ change, then restart the app)
pnpm run test:coverage        # the unit tests with coverage thresholds (Node 22.8+)
pnpm run diagnose             # read-only diagnostic report for a bug issue: versions, tools, bwrap probe
pnpm run bootstrap -- <distro> # check the four distro tools; add --install to install what is missing
pnpm run probe:sandbox        # measure inside the distro what bubblewrap does and does not confine
pnpm run probe                # filesystem probe against a real distro (Windows + WSL only)
pnpm run probe:sandbox-shell  # boot a real harness and drive the confined executor
pnpm run probe:terminal       # open a PTY through the terminal provider
pnpm run probe:substrate      # drive the agent filesystem over a real wsl.exe transport (from inside the distro)
pnpm run probe:watch          # arm the in-distro watcher over a real directory (from inside the distro)
pnpm run probe:agent          # compare the resident path against the fallback path (from inside the distro)
pnpm run probe:exec           # the agent-backed execution: timeout, kill, cwd failure (from inside the distro)
pnpm run probe:missing-wsl    # boot a profile whose wslPath cannot start (Windows + WSL only)
pnpm run probe:picker         # list the picker's root level, refusals and its cap (Windows + WSL only)
pnpm run probe:mode           # which POSIX-mode facts survive the share (needs a Windows node and an installed harness; opens no profile)
pnpm run probe:sandbox-off    # prove sandbox: false unconfines both providers (Windows + WSL only)
```

The app runs a Windows-side copy of the code, not your checkout. After changing anything under `lib/`, run `pnpm run sync:windows` before restarting the app — otherwise the restart just loads the old code. `pnpm run build` regenerates `lib/` from `src/`; the built files are committed, and `pnpm test` checks that they match.

Run `pnpm install` once to get the development dependencies. The tests use the pinned `@deepseek-ai/*` packages; the plugin itself ships none. CI runs the tests on Node 22 and 24, on Linux and Windows, and coverage on Node 24.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the file layout, how the parts attach, and the sandbox design. [CONTRIBUTING.md](CONTRIBUTING.md) has the development loop, the Windows-side copy, the full gate list, and what has been verified.

## Documentation

| Document | What it covers |
|---|---|
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | every configuration key, and how to override it |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | the plugin's parts and how they attach, path coordinates, the sandbox, testing, file layout |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | what the plugin does not do, and why |
| [CONTRIBUTING.md](CONTRIBUTING.md) | the development loop, gates, conventions, verification |
| [SECURITY.md](SECURITY.md) | reporting a vulnerability privately |
| [SUPPORT.md](SUPPORT.md) | supported versions, and where to ask |
| [docs/RELEASING.md](docs/RELEASING.md) | the release checklist |
| [docs/archive/README.en.md](docs/archive/README.en.md) | English index of the archived engineering record |

## License

MIT. See [LICENSE](LICENSE).
