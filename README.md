# dsh-plugin-wsl-env

**English** · [中文](docs/README.zh.md)

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that runs a session inside a WSL 2 distribution on Windows.

The harness process stays on Windows. Commands, file operations, the folder picker and the GUI terminal use the distro. No helper service or daemon is installed, no port is opened, and confined commands run under `bubblewrap`.

Windows + WSL 2 only.

**New here?** Start with [docs/QUICKSTART.md](docs/QUICKSTART.md) — prerequisites, recipes and the compatibility table.

## Why this plugin

A Windows coding tool that works on WSL projects has three options: run the whole tool inside the distro, connect to a helper server inside the distro, or let the plugin provide the distro environment. This plugin is the third option. One workflow covers both kinds of session, with the distro's real tools and the command sandbox intact.

- **Real Linux environment.** Commands run in the distro's own login shell. Its `PATH`, `nvm`, `cargo`, `pyenv` and rc files apply. File tools access distro paths through an in-distro agent; the backing filesystem depends on the path.
- **No service in the distro.** There is no helper server, no daemon and no listening port. The only persisted artifact is a content-addressed copy of the native agent in `~/.cache/dsh-wsl/agent/`.
- **Sandboxed by default.** Confined commands run under `bubblewrap` inside the distro. If `bubblewrap` is missing, the command fails; it does not run unconfined.
- **Per-session.** A session opened on a distro folder gets the distro environment. A session opened on a Windows folder keeps the normal Windows tools. Both can run in one harness process.
- **Integrated with the GUI.** The folder picker lists installed distros, the terminal opens a shell in the distro, and the model can see listening ports.

### Why Linux, not PowerShell

Most coding agents learn from Linux-first material, and most open-source toolchains are built and tested on Linux first. Asking an agent to work through a Windows shell adds a translation layer on every call:

- **Training prior.** Examples, CI scripts, Dockerfiles and most public answers use POSIX shells and GNU tools. A model's first instinct is `bash`, not PowerShell.
- **Toolchain support.** Node, Python, Rust, Go, C/C++ and most build systems are validated on Linux first. Windows support is often a port with different quoting, paths, line endings and file locking.
- **Shell semantics.** PowerShell and `cmd` differ from POSIX in quoting, escaping, pipelines, environment variables, exit codes and path separators. Mixing the two produces errors that look like model mistakes.
- **Environment drift.** Windows setups vary by PowerShell version, execution policy, PATH and installed tools. Linux environments are easier to reproduce and containerize.

The result is more failed commands, more retries and more time spent on syntax instead of the task. Generated code is affected too: shell snippets, build commands and CI-style one-liners are usually written for POSIX, and the distro is where they run unchanged. A real Linux login shell removes that translation layer. Modern PowerShell and Windows-native toolchains narrow the gap, but the default prior and most project scripts still assume POSIX.

This plugin keeps the GUI on Windows and moves only the execution environment into the distro, so the agent gets the shell that its training and the toolchain both assume.

## How it compares

| | Desktop remote (VS Code, ZCode) | This plugin |
|---|---|---|
| Inside the distro | a helper server | one cached agent binary |
| Network | a listening port | none |
| Command sandbox | none | `bubblewrap` |
| Removal | delete the server | delete the cache |

A desktop remote reconnects faster and is more mature. A CLI agent installed inside WSL is simpler if it covers your work. This plugin is for the case where the harness stays on Windows and commands must be sandboxed.

## Requirements

- Windows 10 or 11 with WSL 2 and at least one distro.
- `bubblewrap` in the distro. It is required.
- systemd in the distro for the default session sandbox: set `[boot] systemd=true` in `/etc/wsl.conf`, restart WSL, then run `loginctl enable-linger "$USER"` once. Without systemd, set `sessionSandbox: false` on both `wsl-shell` and `wsl-fs`.
- Optional: `ripgrep` for search, `git` for change snapshots, `inotify-tools` for file watching.

No Node.js is required inside the distro.

## Install

Run these commands in a Windows terminal:

```powershell
dsh wsl --from-default-profile web --dump-config   # create the profile
dsh plugin --profile wsl add dsh-plugin-wsl-env    # install the plugin and its settings
dsh --profile wsl --dump-config                    # verify: prints "# == dsh-plugin-wsl-env"
dsh --profile wsl                                  # start
```

Install `bubblewrap` before the first command:

```powershell
wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap
```

From a checkout, `pnpm run doctor` is the one-command environment check: Windows/WSL versions, the distro and its shell, bubblewrap usability, systemd / the user manager / Linger, the optional tools, peer versions, the agent cache, a fresh-agent handshake, stale session scopes and the known profile-patch trap. Each failure prints one copy-paste remedy; `--json` is for scripts, and `--fix` sweeps stale scopes (package installation needs `--fix --install` and an explicit confirmation). `pnpm run diagnose` is its read-only alias. `pnpm run bootstrap <distro>` remains the narrower tool-install helper.

Upgrade by running the `add` command again. Uninstall with `dsh plugin --profile wsl remove dsh-plugin-wsl-env`; the agent cache under `~/.cache/dsh-wsl` can then be deleted. If you added a local `workspace-files-wsl` workaround to your profile to restore previews, remove it after upgrading: the plugin no longer mounts that row.

## Using it

Open a distro folder as the workspace, for example `\\wsl.localhost\ubuntu\home\you\project`.

- Opening a folder in any distro runs there, even when it is not WSL's default.
- Commands run in the distro's login shell. `/home/you/x` and `\\wsl.localhost\ubuntu\home\you\x` are the same file.
- **New terminal** opens a shell in the same distro and directory.
- The model sees listening ports and can return the URL of a dev server. WSL 2 forwards localhost to Windows.
- The Permissions selector offers `read-only`, `workspace-write` (default) and `danger-full-access`. Only `danger-full-access` runs without the sandbox.

## Configure

Settings live on named rows in `$DSH_HOME/profiles/<name>/cordis.patch.yml`. The main values:

| Row | Key | Default | Purpose |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | distro mode; empty/`auto` follows the workspace, `default` forces WSL's default |
| | `sandbox` | `true` | confine commands with `bubblewrap` |
| | `sessionSandbox` | `true` | run the session's commands in one systemd user scope |
| | `agentBackend` | `auto` | `auto`, `native` or `shell` for the in-distro agent |
| | `maskWindowsDrive` | `false` | hide `/mnt` from confined commands |
| `wsl-fs` | `distro` | `''` | distro mode; empty/`auto` follows each target path |
| | `restrictToDistro` | `true` | under a fixed distro, refuse paths that belong to another distro |
| | `sandbox` | `true` | check confined writes against the policy |
| | `sessionSandbox` | `true` | run confined writes in the session runtime |
| | `substrate` | `agent` | in-distro agent; `share` is rejected at startup |
| `directory-picker-wsl` | `includeHostHome` | `true` | also list the Windows home directory |
| `subprocess-wsl` | `distro` | `''` | distro mode; empty/`auto` follows the launch directory |

`wsl-shell` and `wsl-fs` are inside the shipped `wsl` preset, so overriding them by id does not work. Override the whole `preset-wsl` row instead; [docs/CONFIGURATION.md](docs/CONFIGURATION.md) has the recipe and the remaining keys. [`cordis.patch.yml`](cordis.patch.yml) is the commented reference for every shipped value.

## Architecture

One harness process can serve Windows-folder and distro-folder sessions at the same time. Services attach at two levels:

```text
app level (one per process)
├─ directory-picker-wsl, workspace-files, subprocess-wsl
├─ fs-routing: root filesystem routed by path
└─ auto-preset: binds the wsl preset when a session opens a distro folder

wsl preset (per session)
├─ wsl-shell: commands
└─ wsl-fs: file operations
```

- `wsl-shell` runs commands through one resident agent inside a systemd user scope. The agent is the packaged static-musl `dsh-wsl-agent` for the distro's architecture (`x86_64` or `aarch64`), with the shell agent as fallback. Each command runs in the login shell under a `bubblewrap` mount profile. The scope outlives the command, so background servers survive and `ps` sees the session. With `sessionSandbox: false`, the agent stays per distro and each command gets its own profile.
- `wsl-fs` serves reads and writes through the same in-distro agent. Confined writes run in a long-lived agent whose mount profile matches the policy, so the kernel enforces the write boundary. There is no host-side file fallback: if the agent is unavailable, file operations fail.
- The GUI file tree and previews are the shipped `workspace-files` row, not a plugin replacement: its client half is the browser `file` provider. It reads WSL paths through the routed root filesystem, so it stays distro-side, at the cost of a few extra agent round trips.
- App-level services route by path. A distro UNC path goes to the distro; a Windows drive path stays on the host. See [docs/root-fs-routing.md](docs/root-fs-routing.md).

## Sandbox

| Mode | What a command can do |
|---|---|
| `read-only` | read the whole distro; a fresh `/dev` is mounted, nothing else is writable |
| `workspace-write` | the above, plus the session workspace; `/tmp` is the distro's real `/tmp` with the session runtime |
| `danger-full-access` | no sandbox |

With `sessionSandbox: false`, a `workspace-write` command gets a private `/tmp` instead of the distro's real one. `read-only` does not mount a writable `/tmp`.

`bubblewrap` is required. If it is missing or broken, confined commands report `SANDBOX_UNAVAILABLE` and do not run. Setting `sandbox: false` on the owning row disables confinement; the model is told that the operation is unsandboxed.

Enforcement is reported as `partial`. A command inside the distro can still start a Windows executable through `/mnt/c`, and `bubblewrap` cannot control Windows processes. `maskWindowsDrive: true` hides `/mnt` from the confined view unless overridden by `interopVisibility: visible`; this narrows the hole but does not close it. Disabling WSL interop requires a separate distro-level change: set `[interop] enabled=false` in `/etc/wsl.conf`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#sandbox) and [SECURITY.md](SECURITY.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| every command reports `SANDBOX_UNAVAILABLE` | install `bubblewrap` in the distro, or set `sandbox: false` |
| the session refuses before the first command | run `pnpm run doctor`; enable systemd and linger, or set `sessionSandbox: false` on `wsl-shell` and `wsl-fs` |
| `glob` and `grep` are slow in the distro | run `pnpm run bootstrap <distro>` and use its printed install command to install `ripgrep` |
| `dsh plugin add` prints nothing | the plugin is already installed; this is success |
| a profile patch for `wsl-shell`/`wsl-fs` changes nothing | those rows are nested inside `preset-wsl`. Run `pnpm run preset --check <patch>`; it fails with the complete block to paste |
| changes under `lib/` have no effect | run `pnpm run sync:windows`, then restart the app |

More error codes and refusals are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#error-codes). Everything the plugin does not do is in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Development

```bash
pnpm install           # development dependencies
pnpm run build         # compile src/ into lib/ (lib/ is committed)
pnpm test              # style, syntax, build consistency, types, unit tests
pnpm run test:coverage # unit tests with coverage thresholds
pnpm run sync:windows  # update the Windows-side copy the app loads
```

The toolchain follows the harness host: Node `^22.19.0 || >=24.0.0`. `src/` is TypeScript; `lib/` is generated and must stay in sync. The app loads a Windows-side copy of `lib/`, so run `sync:windows` and restart the app after a build.

Real-machine probes run on Windows + WSL only. See [CONTRIBUTING.md](CONTRIBUTING.md) and `test/probe/`.

## Documentation

| Document | Content |
|---|---|
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | first run, recipes, compatibility |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | ext4 agent vs 9p, measured latency, how to reproduce |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | every configuration key and how to override it |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | services, path routing, sandbox, error codes |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | what the plugin does not do |
| [docs/ROADMAP.md](docs/ROADMAP.md) | current plan and deferred work |
| [docs/ROADMAP-1.0.md](docs/ROADMAP-1.0.md) | the 1.0 and ecosystem plan |
| [docs/VALUE.zh.md](docs/VALUE.zh.md) | value and trade-offs in Chinese |
| [CONTRIBUTING.md](CONTRIBUTING.md) | development loop, gates, probes |
| [SECURITY.md](SECURITY.md) | private vulnerability reporting |
| [SUPPORT.md](SUPPORT.md) | supported versions and support channels |
| [docs/RELEASING.md](docs/RELEASING.md) | release checklist |

## License

MIT. See [LICENSE](LICENSE).
