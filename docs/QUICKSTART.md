# Quickstart

Five minutes from a clean Windows + WSL 2 machine to a working WSL session.
This page is the entry point; every claim links to the document that owns it.

## 1. Prerequisites

| Need | How to check | If missing |
|---|---|---|
| Windows 10/11 with WSL 2 | `wsl.exe -l -v` shows `VERSION 2` | `wsl.exe --install` |
| A distro | one line in the list above | `wsl.exe --install -d Ubuntu` |
| `bubblewrap` | `wsl.exe -d <distro> -- which bwrap` | `wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap` |
| systemd + Linger (for the session runtime) | `node <plugin>/scripts/doctor.mjs` (installed) or `pnpm run doctor` (checkout) | `[boot] systemd=true` in `/etc/wsl.conf`, `wsl --shutdown`, then `loginctl enable-linger "$USER"`; or set `sessionSandbox: auto`/`false` |
| Node 22.19+ or 24 | only needed for source/development work | not needed to use the published plugin |

The doctor (`scripts/doctor.mjs`, or `pnpm run doctor` from a checkout) covers all
of the above in one pass and prints a copy-paste remedy per failure. It is read-only unless you pass `--fix` (stale scopes) or
`--fix --install` (packages, after a confirmation).

## 2. Install

From a Windows PowerShell where the DSH CLI is available:

```powershell
dsh plugin --profile <profile> add dsh-plugin-wsl-env
dsh --profile <profile> --dump-config      # the plugin rows must be there
```

For a profile that already overrides the preset, keep the override as the full
`preset-wsl` block — `pnpm run preset --check <patch>` fails loudly when a layer
targets `wsl-shell`/`wsl-fs` by id.

## 3. Open a WSL workspace

In the GUI, open a folder through the picker (`\\wsl.localhost\<distro>\home\<you>\proj`)
or an UNC path directly. The session's commands, file tools, terminal and previews
all run in that distro; a Windows folder keeps the normal Windows environment.
Two distros can be open at once, each with its own environment.

![The directory picker listing a WSL distro's folders](screenshots/picker.png)

The terminal panel runs in the same distro — `uname -a` answers with the
distro's kernel, not Windows':

![The GUI terminal running inside the distro](screenshots/terminal.png)

And the Sidebar's preview renders WSL files in place:

![The GUI preview rendering a WSL file](screenshots/preview.png)

## 4. Verify

Ask for a command, e.g. `pwd && uname -a`. Expected: the Linux path and the
distro kernel. If the first command fails, the error names the remedy; the
[doctor](CONFIGURATION.md) and the [Troubleshooting table](../README.md#troubleshooting)
cover the common cases.

The sandbox is enforced by the kernel, not a promise: the probe below runs the
shipped bwrap profiles live — writes inside the workspace land, writes outside
are refused with `EROFS`, and the strict profile hides `/mnt` entirely
([`test/probe/sandbox.sh`](../test/probe/sandbox.sh)):

![The sandbox probe: every expectation holds, the kernel refuses what the profile does not grant](screenshots/sandbox.png)

## Recipes

Commands run in the model's session, inside the distro, from the workspace root.

### Node / TypeScript

```bash
node -v && pnpm -v
pnpm install
pnpm test
pnpm dev            # a dev server survives the command that started it with sessionSandbox: true
```

The server's port appears in `DSH_WSL_PORTS` on the next snapshot (10 s by
default); open it from Windows at `http://localhost:<port>`.

### Python

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m pytest
```

Use the distro's interpreter, not a Windows one: the session's `python3` is the
one on the distro `PATH` (pyenv/conda shims included).

### Rust

```bash
cargo build --release
cargo test
```

Targets are compiled natively for the distro's architecture (x86_64 or aarch64);
do not reuse Windows `target/` directories.

### Go

```bash
go build ./...
go test ./...
```

The module cache lives in the distro's `$GOPATH`, so builds stay on ext4.

### Monorepo

Open the repository root as the workspace. Each package's commands run from the
same distro; `pnpm -r`, `turbo`, `nx` and `make` see one Linux filesystem. The
file watcher uses inotify inside the distro (`watchMaxDepth: 0`). If a change is
missed, see the watcher bounds in [CONFIGURATION.md](CONFIGURATION.md).

## Compatibility

Honest status, not a promise. "Probed" means a real-machine run is recorded in
this repository; "target" means the design supports it but the leg has not been
executed here.

| Tier | Configuration | Status |
|---|---|---|
| 1 | Ubuntu 24.04 or Debian 12, systemd, x86_64 | Probed on Ubuntu (the project's development machine; the real-machine suite is manual). Debian is a Tier 1 target, probe pending |
| 2 | Other systemd distros, aarch64 | The aarch64 native binary is built by CI but not executed here; aarch64 WSL or qemu is the pending leg |
| Unsupported | WSL 1, Linux/macOS hosts, Windows without WSL 2 | Not supported; the plugin attaches to `wsl.exe` |

With `sessionSandbox: auto` a distro without systemd/Linger still gets the
per-command `bubblewrap` sandbox and the result reports the narrower scope;
`true` refuses. See [CONFIGURATION.md](CONFIGURATION.md#the-strict-profile) for
the sandbox trade-offs and [PERFORMANCE.md](PERFORMANCE.md) for the measured
latency.

## Demo

There is no GIF or screenshot in this repository yet: producing one needs a
capture of the GUI, which this project has not recorded. The
[Troubleshooting table](../README.md#troubleshooting) and the probe output
(`pnpm run probe:sandbox`, `pnpm run probe:gui-preview`) are the reproducible
evidence in the meantime; the absence is recorded in
[ROADMAP-1.0.md](ROADMAP-1.0.md#wsl-302--discoverability-and-docs-entry).
