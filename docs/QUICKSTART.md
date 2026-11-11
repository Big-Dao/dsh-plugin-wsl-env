# Quickstart

*The Chinese version ([QUICKSTART.zh](QUICKSTART.zh.md)) is authoritative; this page is its English translation.*

Steps from a Windows + WSL 2 machine to a working WSL session.
This page is the entry point; every claim links to the document that owns it.

## 0. Do you need this plugin?

If the harness can run inside the distro, installing the CLI there
(`npm install -g @deepseek-ai/dsh`) and skipping this plugin is simpler — the
[README's decision table](../README.md#do-i-need-this-plugin) has the cases.
The rest of this page assumes the desktop app stays on Windows and this plugin
supplies the WSL environment.

## 1. Prerequisites

| Need | How to check | If missing |
|---|---|---|
| Windows 10/11 with WSL 2 | `wsl.exe -l -v` shows `VERSION 2` | `wsl.exe --install` |
| A distro | one line in the list above | `wsl.exe --install -d Ubuntu` |
| `bubblewrap` | `wsl.exe -d <distro> -- which bwrap` | `wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap` |
| systemd + Linger (for the session runtime) | `node <plugin>/scripts/doctor.mjs` (installed) or `pnpm run doctor` (checkout) | `[boot] systemd=true` in `/etc/wsl.conf`, `wsl --shutdown`, then `loginctl enable-linger "$USER"`; or set `sessionSandbox: auto`/`false` |
| Node `^22.19.0` or `>=24.0.0` | only needed for source/development work | not needed inside the distro to use the published plugin |

No terminal at hand? Several ways without one: the sidebar's **WSL
environment** panel runs a quick doctor check per distro, listing the badge,
numbered failing items and warnings, and offers the full run labeled **修复** for the plugin-owned state when such a
finding exists (stale scopes and a broken agent cache), **完整检查** otherwise; typing `/wsl-doctor [quick|full|<section>]`
in the composer also runs host-side and renders in the UI — no model turn, no
tokens; in a session, ask for a diagnosis and the model runs the `wsl_doctor`
tool (mounted by this plugin), the verdict landing in the transcript; and the
session-start preflight logs the same verdict on every session start, and adds
it to the session's context only when blocked.
`DSH_WSL_DOCTOR` additionally carries a ready-to-run command for the doctor
script itself (`sh -c "$DSH_WSL_DOCTOR --json"`).

The doctor (`scripts/doctor.mjs`, or `pnpm run doctor` from a checkout) checks
the environment and ends in a verdict: `ready` means every check that run
covered passed — not a promise about a later command; `blocked` names the exact
checks to fix, each with a copy-paste remedy. It reads the distro's WSL mode
from `wsl.exe -l -v` itself, so no separate version check is needed. Doctor is
read-only unless you pass `--fix`
(the stale-scope sweep and a broken agent cache, both re-verified; the Windows
git trust after a confirmation) or `--fix --install` (packages, after a
confirmation); `--fix-owned` restricts a fix run to the plugin-owned state
(the panel's repair action); `--bundle <path>` writes
the diagnostic file a setup report attaches (`--redact` strips the paths
from it). A run can be scoped — `--quick` probes the first-command
prerequisites only (~10 s), `--sections <list>` (comma-separated) runs the
named sections — or widened with `--all` to every installed distro; the
report itemizes every check with an explicit status marker, grouped by
distro. The fixed skeleton renders in the host's language
(`--locale <tag>` or `DSH_WSL_DOCTOR_LOCALE` overrides the detection).

## 2. Install

The desktop app has no `dsh` command; open **Plugins** in the sidebar, choose
**Add plugin**, and enter the exact package name `dsh-plugin-wsl-env`. That
writes the profile's `package.json` and its `dsh.profile.bundles` entry.

With the CLI distribution (`dsh` on `PATH`), from Windows PowerShell:

```powershell
dsh plugin --profile <profile> add dsh-plugin-wsl-env
# if it resolves to a stale version (same-day registry metadata cache), pin it:
# dsh plugin --profile <profile> add dsh-plugin-wsl-env@<latest>
dsh --profile <profile> --dump-config      # the plugin rows must be there
```

For a profile that already overrides the preset, keep the override as the full
`preset-wsl` block — `pnpm run preset --check <patch>` fails loudly when a layer
targets `wsl-shell`/`wsl-fs` by id.

## 3. Open a WSL workspace

Start the desktop app the way its Start-menu shortcut does: `DeepSeek Harness.exe`,
no arguments — it opens the profile the app is configured with (the Plugins page
writes into that one). (CLI distribution: `dsh --profile <profile>` boots a
profile of that name.)

In the GUI, open a folder through the picker (`\\wsl.localhost\<distro>\home\<you>\proj`)
or an UNC path directly. The session's commands, file tools, terminal and previews
all run in that distro; a Windows folder keeps the normal Windows environment.

The sidebar's **WSL environment** panel is the diagnostic page: it lists the
installed distros, runs one distro's quick doctor check on demand (showing
whether bwrap, systemd and Linger are in place), and offers **修复** on a checked
row as a full doctor with `--fix-owned` — labeled **修复** when a finding is
repairable (a stale session scope or a broken agent cache) and **完整检查**
otherwise; the row also shows when the check ran, its source (manual, or the
page-load background refresh), and its result structure (pass/warn/fail/info/
skip, plus the per-section tallies). The last result survives a page reload
from the local store, and a stored result for a running distro is re-checked
in the background on load. The run sweeps the scopes and purges the cache when they need it,
then re-verifies; every other warning keeps its manual remedy, and the action
never installs packages or rewrites Windows-owned configuration (a check boots
a stopped distro, so either action only runs on a click). Workspaces still open through **Add workspace**; selecting a folder inside a
distro through the picker makes the app ask once how to open it: **Remote
WSL** (the default — commands, files and the terminal all run in the distro) or
**Windows access** (the folder as an ordinary Windows share over 9p, without the
Linux toolchain). The choice is recorded in the `auto-preset` row's
`windowsWorkspaces` and applies to later sessions in that workspace too.
Two distros can be open at once, each with its own environment.

### Open the workspace in VS Code (Remote-WSL)

Opening the WSL folder as a Windows UNC share works but is the degraded mode:
files cross 9p, the terminal is PowerShell, extensions run on Windows. The full
integration is VS Code's Remote-WSL — the server runs inside the distro, the
integrated terminal is the distro shell, and file operations are local ext4:

```powershell
# from the plugin checkout:
scripts/open-wsl-vscode.ps1 -Path "\\wsl.localhost\ubuntu\home\me\proj"
# or by hand:
code --folder-uri "vscode-remote://wsl+ubuntu/home/me/proj"
```

Requires the `code` shim on PATH (VS Code installer adds it) and the
Remote-WSL extension.

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

First-write note: the sandbox asks for permission before a write the session
policy has not granted — the prompt names the command and the target, and
allowing it once is safe. Enabling `loginctl enable-linger <user>` inside the
distro prevents the repeat prompts a non-lingering user manager causes.

The probe below runs the shipped kernel-enforced bwrap profiles live — writes
inside the workspace land, tested writes outside are refused with `EROFS`, and
the strict profile hides `/mnt` entirely
([`test/probe/sandbox.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/sandbox.sh)):

This is partial isolation, not a Windows security boundary: Windows interop
can still launch executables outside `/mnt`. See [LIMITATIONS.md](LIMITATIONS.md).

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

On a cold cache or a new dependency, `workspace-write` blocks the
`~/.npm`/pnpm-store writes (`EROFS`). Configure the same `writableRoots` list on
`wsl-shell` and `wsl-fs` (e.g. `~/.npm`, `~/.cache`, `~/.local/share/pnpm`);
see [CONFIGURATION](CONFIGURATION.md#toolchain-caches-and-extra-writable-roots).

The server's port can appear in `DSH_WSL_PORTS` after a successful snapshot
(refreshed every 10 s by default); open a forwarded port from Windows at
`http://localhost:<port>`.

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

The module cache normally lives under the distro user's `$GOPATH`; its actual
location and backing filesystem depend on the Go environment and mounts.

### Monorepo

Open the repository root as the workspace. Each package's commands run from the
same distro; `pnpm -r`, `turbo`, `nx` and `make` see one Linux filesystem. The
file watcher uses inotify for unbounded directories when `inotifywait` is
available; otherwise it falls back to polling. If a change is missed, see the
watcher bounds in [CONFIGURATION.md](CONFIGURATION.md).

## Compatibility

Honest status, not a promise. "Probed" means a real-machine run is recorded in
this repository; "target" means the design supports it but the leg has not been
executed here.

| Tier | Configuration | Status |
|---|---|---|
| 1 | Ubuntu / Debian, systemd, x86_64 | Probed. Debian harness-level probes pass against a `wslfs-debian` profile (2026-10-26). |
| 2 | Fedora, openSUSE, Arch, Alpine; aarch64 native agent | Distro matrix in [COMPATIBILITY.md](COMPATIBILITY.md). aarch64 18-check runs under qemu in CI; physical aarch64 WSL is out of scope. |
| Unsupported | WSL 1, Linux/macOS hosts, Windows without WSL 2 | Not supported; the plugin attaches to `wsl.exe` |

With `sessionSandbox: auto` a distro without systemd/Linger still gets the
per-command `bubblewrap` sandbox and the result reports the narrower scope;
`true` refuses. See [CONFIGURATION.md](CONFIGURATION.md#sandbox-and-preflight) for
the sandbox trade-offs and [PERFORMANCE.md](PERFORMANCE.md) for the measured
latency.

## Demo

The screenshots above show the picker, terminal, preview and sandbox probe.
There is no GIF yet. The [Troubleshooting table](../README.md#troubleshooting)
and the probe output (`pnpm run probe:sandbox`, `pnpm run probe:gui-preview`)
provide reproducible evidence; the remaining demo work is tracked in
[ROADMAP-1.0.md](ROADMAP-1.0.md#wsl-302--discoverability-and-docs-entry).
