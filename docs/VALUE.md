# dsh-plugin-wsl-env value proposition

[中文](VALUE.zh.md)

This page answers one question only: **why it is worth installing this plugin to work on WSL projects with DeepSeek Harness on Windows.**
Features, installation, and per-item behavior are covered in [README](../README.md) and [ARCHITECTURE.md](ARCHITECTURE.md); this page discusses benefits, costs, and applicable boundaries.
Every claim here points to evidence that can be reviewed in the repository; the baseline is v0.22.0 (2026-11-08). Earlier entries were introduced on the v0.9.0 baseline, and versions, tool surface, and the gate chain were reviewed on 2026-11-09.

> **In one sentence**: it turns a WSL distribution into the real execution environment of a DSH session — commands, files, terminals, and the directory picker all complete inside the distribution,
> while DSH's permission model and the distribution's bubblewrap sandbox are preserved; it installs no service of its own into the distribution and opens no port.

## 1. Without it, three mismatches

DSH is a Windows desktop app, and the project lives on WSL's ext4. Without integration, three things are misaligned at once:

| Mismatch | Concrete symptom | Consequence |
|---|---|---|
| Location | The app only understands `\\wsl.localhost\<distro>\...`, while tools expect `/home/...` | Paths must be translated back and forth; the 9p share is noticeably slow with many small files; symlinks and permission bits are no longer faithful across the share layer |
| Environment | Commands execute on the Windows side | The distribution's `PATH`, `nvm`, `cargo`, `pyenv`, rc configuration, and native `rg` are all unusable; scripts either cannot find an interpreter or silently use a different binary |
| Security | The Windows sandbox's restricted token cannot reach WSL (`wsl.exe` returns `Wsl/E_ACCESSDENIED`) | Usually you can only choose one of "can operate on WSL" and "commands have boundaries" |

Available options each have a cost: installing the whole CLI inside WSL is cleanest, but DSH is a desktop app and cannot be moved there; desktop remote (VS Code Remote-WSL, ZCode and similar) is mature, but requires placing a service directory in the distribution, opening a port, and commands have no sandbox; doing nothing leaves the three mismatches above.
This plugin fills the combination beyond those three: **the app stays on Windows, the execution world moves into the distribution, and the boundary stays outside the command.**

## 2. Six sources of value

### Value 1: the first command is already in the right environment

**Mechanism.** When a session opens a distribution directory, `auto-preset` automatically attaches the `wsl` preset; `wsl-shell` executes `wsl.exe --exec <shell> -lc <cmd>` using the login shell configured for the distribution (it does not hard-code bash). `PATH`, version managers, and rc files therefore all take effect.

**Perceivable difference.** There is nothing to `source` first, and no need to tell the model the paths of `nvm`/`pyenv` by hand. When the model says "run the tests", it uses the same `node`, `pnpm`, and `cargo` you would use in that terminal. The first command is already correct; there is no "warm up the environment with one command first" step.

**Evidence.** [README "Using it"](../README.md#using-it); `test/shell.test.mjs`, `test/preset-choice.test.mjs`; `pnpm run probe:sandbox-shell`.

### Value 2: files are the distribution's real files

**Mechanism.** Reads, writes, and searches land on ext4 through a resident agent: native symlinks, native mode bits, and the distribution's own `rg`. The GUI file tree and preview are likewise served from inside the distribution. Search arguments are forwarded verbatim to the distribution's `rg`; results, output format, and exit code are rg's own, and the directory's `.gitignore` is honored.

**Perceivable difference.** `chmod +x`, `ln -s`, git hooks, and tools dispatched by content behave as they do on a Linux host; `glob`/`grep` no longer cross the slow 9p bridge, nor use the Windows-side copy of rg to read Linux directories. `/home/you/x` in the folder and `\\wsl.localhost\ubuntu\home\you\x` in the GUI are the same file, not copies.

**Evidence.** [ARCHITECTURE "The filesystem substrate"](ARCHITECTURE.md#the-filesystem-substrate), [LIMITATIONS](LIMITATIONS.md); `test/search-route.test.mjs`, `test/search-exec.test.mjs`, `test/fs-substrate.test.mjs`; `pnpm run probe:substrate` (8/8). Known limits are in section 4: new files 0600, filenames containing backslashes, watch using polling.

### Value 3: the sandbox is the default, and failure is loud

**Mechanism.** A session's restricted commands run through a `bubblewrap` mount profile inside the same systemd user scope (background processes, a real `/tmp`, visible to `ps`), and the scope stops when the session ends; the three permission tiers (`read-only` / `workspace-write` / `danger-full-access`) take effect tier by tier; file writes are checked against the same policy, and writes under restricted policies are additionally rejected by the kernel inside the bwrap configuration. When no usable bwrap exists, the command reports `SANDBOX_UNAVAILABLE` instead of running outside the sandbox.

**Perceivable difference.** Restricted commands and writes are bound by the workspace policy, but this is not complete isolation: Windows interop and other routes can still cross the Linux-side write boundary. When denied, the model receives an offer to "retry with just enough permission", not a direct request for `danger-full-access`. Auditing yields the mode actually enforced at the time and the denial reason; in configurations that explicitly pin a distribution, file tools reject cross-distribution paths with `FS_OUTSIDE_DISTRO`, and widening permissions does not lift it.

**Honest boundary.** Reporting is `enforcement: partial`, because processes inside the distribution can still launch Windows programs through interop; `maskWindowsDrive` narrows this hole (`/mnt` disappears from the restricted view), but binfmt dispatches by content, so it is still not closed; fully disabling it requires `[interop] enabled=false` at the distribution level. The plugin does not describe partial enforcement as full.

**Evidence.** [ARCHITECTURE "Sandbox"](ARCHITECTURE.md#sandbox), [SECURITY](../SECURITY.md); `test/sandbox.test.mjs`, `test/fs-decisions.test.mjs`; `pnpm run probe:sandbox`, `pnpm run probe:sandbox-off`.

### Value 4: one process, two kinds of session, the same toolbox

**Mechanism.** The composition layer routes by path coordinate: distribution UNC paths go to the agent implementation, and drive-letter paths stay with the host backend; the GUI terminal routes by session — WSL directory sessions get the distribution shell, Windows directory sessions still get PowerShell; `wsl-shell`/`wsl-fs` are mounted at the preset layer, so the environment takes effect per session.

**Perceivable difference.** There is no separate app or profile for WSL, and no need to switch the whole app into "WSL mode". In the same window, a session that opens a Windows folder is unaffected, while a session that opens `\\wsl.localhost\...` automatically enters the distribution. Changing projects is just changing the open folder. This matters especially on the model side: the plugin adds exactly one model tool, `wsl_doctor` (plus the `/wsl-doctor` command); every other existing tool keeps its name, parameters, and return semantics — only the world it actually acts on changes.

**Evidence.** [README "Architecture"](../README.md#architecture), [docs/root-fs-routing.md](root-fs-routing.md); `test/composition.test.mjs`, `test/terminal.test.mjs`, `test/fs.boot.test.mjs`.

### Value 5: no service installed, no port opened, no residue

**Mechanism.** No service is installed in the distribution, and no port is listening; the plugin replaces DSH's service implementations and adds the `wsl_doctor` tool and the `/wsl-doctor` command. File operations and commands go through a resident agent cached per distribution — it is a transport layer, not a registered system service, and the agent script verifies sha256 during the handshake.

**Perceivable difference.** No extra directories such as `~/.vscode-server` appear, no conflict with local ports arises, and after uninstalling there is no server-side directory in the distribution left to clean up by hand. After a WSL upgrade or a distribution restart, the next call rebuilds the transport; only if the agent dies while "a request is in flight" can it exhaust its one rebuild allowance (see [LIMITATIONS](LIMITATIONS.md)) — a declared boundary, not the everyday path.

**Note the distinction.** "No service installed" is not "zero dependencies": bubblewrap is a hard dependency of the default path; the session runtime also requires systemd as PID 1 and the user manager to have `enable-linger` applied (a transient scope, not an installed resident service). ripgrep, git, and inotify-tools are checked by `pnpm run bootstrap`. The plugin does not bundle these tools, nor does it install a resident service in the distribution.

**Evidence.** [README "How it compares"](../README.md#how-it-compares); `agent/wsl-agent.sh`, `test/agent.test.mjs`; `scripts/bootstrap.sh`.

### Value 6: the model gets facts, not guesses

**Mechanism.** The session environment exposes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL`, `DSH_WSL_HOME`, and `DSH_WSL_PORTS` to the model; ports refresh on a cadence of about 10 seconds. Error codes are classified by their thrower (`FS_OUTSIDE_DISTRO`, `SANDBOX_UNAVAILABLE`, `FS_STALE_VERSION`, and so on), each stating who denied and how to resolve it. If tools are missing when a session opens, it gives the installation command for that distribution directly.

**Perceivable difference.** The model can name the exact address of the dev server it started (WSL2 forwards localhost to Windows, so a browser can open it directly); path denials, missing sandboxes, and stale files each have their own code, so troubleshooting does not begin by guessing from "the command failed". What this reduces is round trips, not merely how nice the error message looks.

**Evidence.** [ARCHITECTURE "Error codes"](ARCHITECTURE.md#error-codes), [README "Troubleshooting"](../README.md#troubleshooting); `test/ports.test.mjs`, `test/preflight.test.mjs`, `test/terminal.test.mjs`.

## 3. Value comparison with alternatives

| | No integration (open UNC on the Windows side) | Desktop remote (VS Code Remote-WSL, etc.) | Install the CLI inside WSL | This plugin |
|---|---|---|---|---|
| Command environment | Windows | Distribution | Distribution | Distribution |
| File semantics | 9p share, slow and loses POSIX details | Native inside the distribution | Native inside the distribution | Native inside the distribution (ext4) |
| Command sandbox | Windows sandbox cannot reach WSL | None | Depends on the CLI | In-distribution bubblewrap + systemd session scope |
| In-distribution install | None | One service directory | The whole tool | No own service (depends on system tools) |
| Port | None | Listens on one port | None | None |
| Uninstall residue | None | Manually delete the service directory | Delete the tool | None |
| Applicability | Can accept slowness and loss of semantics | Use VS Code / the corresponding desktop client | The tool can be moved entirely into WSL | Windows + DSH GUI + WSL2 |

**Say plainly where others are stronger.** Reopening a workspace in desktop remote is instantaneous, and the service is always resident; VS Code's remote has years of production hardening. A CLI installed inside WSL needs no bridge at all. This plugin does not try to win on those dimensions; it solves one combination: **DSH on Windows, the project in WSL, and commands that must be sandboxed.**

## 4. Costs, boundaries, and non-applicability

Value is benefit minus cost. The following should be known before installation:

- **bubblewrap is a hard dependency.** Without it the default path fails every restricted command (deliberate fail-closed); restricted file writes need it too. The session runtime also requires systemd as PID 1 and the user manager to have `enable-linger` applied; a failed preflight is refused with a repair command. `pnpm run bootstrap <distro>` checks and prints install commands.
- **enforcement is partial.** Interop lets processes inside the distribution launch Windows programs. `maskWindowsDrive` only narrows it; completely closing it requires `[interop] enabled=false` in `wsl.conf`. For scenarios that require "absolute isolation from the Windows side as well", this plugin cannot deliver.
- **Two `/tmp`s.** Under `workspace-write`, commands in the session runtime and file tools use the distribution's real `/tmp`; with the session runtime off, commands use a private tmpfs while file tools still use the real `/tmp`, and the two cannot see each other. Files crossing the boundary must go through the session workspace.
- **watch prefers inotify and falls back to polling.** For unbounded directories with `inotify-tools` installed, it uses recursive inotify, coalescing at 0.5s into coarse invalidation; for file targets, depth-limited directories, or missing tools it falls back to polling, and extreme cases such as in-place `cp -p` or unpacking that restores directory mtimes can still be missed.
- **Filenames containing backslashes cannot be addressed**, because the UNC display form is the identity. Renaming is the only workaround.
- **New files publish as 0600** (the host backend's publishing semantics); `chmod` yourself when they must be executable. Published writes survive process death, but the parent directory is not fsynced, so a machine crash may lose the rename.
- **Platform and versions.** Windows + WSL2 only; Node `^22.19.0 || >=24.0.0`; DSH peer versions declare a floor, development dependencies are pinned exactly, and upgrades must be re-validated.
- **Not suitable for.** Workflows whose CLI can be installed entirely inside WSL; editor remote capabilities (IntelliSense, debugger, extensions); enterprise-grade strong isolation or multi-tenancy; projects mainly on a Windows drive (the plugin works, but the value is not there).

These are not a "will be fixed later" list but design boundaries: each one states its reason in [LIMITATIONS.md](LIMITATIONS.md). **Writing the boundaries clearly is itself a value** — it keeps "not done" from being misread as "already done".

## 5. How the value is proven

| Level | Evidence |
|---|---|
| Every commit | `pnpm test`: style, relative links, requirement references, documentation consistency, syntax, byte-for-byte build consistency, `tsc --noEmit`, all unit tests pass |
| Coverage | `pnpm run test:coverage`, thresholds 85/84/70 (lines/branches/functions) |
| Real machine | Probe suite (`test/probe/run-all-when-closed.sh --include-fs`), including sandbox boundary demonstrations, agent/one-shot dual-path cross-checks, the filesystem substrate, terminal, and picker |
| CI | Node 22 / 24 × Linux / Windows run `pnpm test`; coverage on Node 24 |
| Upstream seams | peer pins compared byte for byte, [PEER-PARITY.md](PEER-PARITY.md), [upstream/promotion-map.md](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/upstream/promotion-map.md) |
| Behavior commitments | 28 registered requirements (R1–R28) and the traceability matrix in [REQUIREMENTS.zh.md](REQUIREMENTS.zh.md) |

The real-machine probe is a manual step (hosted runners have no WSL distribution); this is a recorded verification gap (OI-2 in REQUIREMENTS), not a hidden omission.

## 6. Decision rules

**Install it if all of the following hold:**

1. You use the DeepSeek Harness GUI on Windows;
2. The project is on the ext4 of a WSL2 distribution, and you want the model to work with Linux paths;
3. You want commands to have boundaries, and you accept installing bubblewrap for that.

**Do not install it if any of the following holds:**

- Your workflow is a CLI that can be installed entirely inside WSL — installing it there directly is simpler;
- You need editor-level remote capabilities (debugging, IntelliSense, extensions);
- You need absolute isolation from Windows interop as well;
- Your project is mainly on a Windows drive, and you do not need a Linux toolchain.

## 7. Evidence index

| What you want to know | Where to look |
|---|---|
| Features, installation, configuration | [README](../README.md) / [Chinese README](README.zh.md) |
| How the pieces are mounted, path coordinates, sandbox design | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What it does not do, and why | [LIMITATIONS.md](LIMITATIONS.md) |
| Every configuration key | [CONFIGURATION.md](CONFIGURATION.md) |
| Parity audit against VS Code Remote-WSL | [PARITY.md](PARITY.md) |
| Byte-for-byte contract with upstream fsio | [PEER-PARITY.md](PEER-PARITY.md) |
| Security boundaries and reporting channel | [SECURITY.md](../SECURITY.md) |
