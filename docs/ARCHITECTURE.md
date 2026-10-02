# Architecture

This file describes the plugin as it is today. It covers what the code does and
where each piece lives. The reasoning behind the design, including the designs that
were rejected, is recorded in [`CHANGELOG.md`](../CHANGELOG.md) and in
[`archive/engineering-record.zh.md`](archive/engineering-record.zh.md).

## What "provider" means here

DSH exposes its capabilities as services. The model-facing tools (`bash`, `read`,
`write`, `edit`, `glob`, `grep`) consume those services. They never touch a
filesystem or a shell directly.

This plugin supplies WSL-backed implementations of three of them, plus three
smaller integrations.

## The three service providers

| Service | Class | File | What it does |
|---|---|---|---|
| `ctx.shell` | `WslShellExecutor` | [`lib/index.js`](../lib/index.js) | Runs each command as `wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>`, wrapped in a distro-side `bwrap` sandbox. |
| `ctx.fs` | `WslFileSystem` | [`lib/index.js`](../lib/index.js) | Maps Linux paths onto the distro's UNC share, so the host filesystem stack and the packaged ripgrep work on real distro files. |
| `ctx.subprocess` | `WslSubprocessRuntime` | [`lib/subprocess.js`](../lib/subprocess.js) | Opens the GUI terminal inside the distro, in the session workspace. |

`WslShellExecutor` extends the shipped `LocalBashExecutor`, and `WslFileSystem`
extends the shipped `LocalFileSystem`. Only the parts that need a distro are
overridden.

## The three smaller integrations

| Subpath | Class or name | File | What it does |
|---|---|---|---|
| `dsh-plugin-wsl-env/picker` | `WslDirectoryPicker` | [`lib/picker.js`](../lib/picker.js) | Adds the installed distros to the folder picker, next to the Windows home directory. |
| `dsh-plugin-wsl-env/auto-preset` | `auto-preset` | [`lib/auto-preset.js`](../lib/auto-preset.js) | Binds the `wsl` agent preset when a new session's workspace is inside a distro. |
| `dsh-plugin-wsl-env/shell-env` | `wsl-shell-env` | [`lib/shell-env.js`](../lib/shell-env.js) | Contributes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL`, and `DSH_WSL_HOME` to the managed `DSH_*` namespace. |

Three modules support them and import no DSH package.
[`lib/paths.js`](../lib/paths.js) translates paths.
[`lib/listing.js`](../lib/listing.js) builds directory listings and breadcrumbs.
[`lib/wsl.js`](../lib/wsl.js) holds the `wsl.exe` interop primitives.

## How the pieces are mounted

[`cordis.patch.yml`](../cordis.patch.yml) is the bundle layer. It is a top-level
YAML array of patch entries, and `dsh plugin --profile <name> add
dsh-plugin-wsl-env` applies it as one layer.

The environment is per session, not per process:

| Row | Mounted | Why there |
|---|---|---|
| `wsl-shell`, `wsl-fs` | inside `preset-wsl`, an agent preset with isolate realms | so one process can serve a Windows workspace and a distro workspace at the same time |
| `subprocess-wsl` | at the app level, called the composition | because no session identity reaches the terminal controller, see below |
| `directory-picker-wsl`, `wsl-shell-env`, `auto-preset` | at the app level | they answer questions that are not scoped to a session |

The preset mount requires the isolate realms. Without them the registry rejects the
providers with `Preset services require isolate realms: shell, fs`.

### Why the terminal provider is app-level

An agent preset runs its services in an isolate realm. The preset registry creates
that realm under its own context, with `createScope(this.owner, ...)`. The agent
loop creates the Agent context under the root realm, with
`createScope(loopCtx, ...)`.

The terminal controller resolves its execution world with
`agent.ctx.get("subprocess")`, which looks in the second tree. A provider mounted in
the first tree is therefore invisible to it. The registry ships
`agentPresets.serviceFor(agent, name)` for this gap, and the terminal controller
does not use it.

So the layer disables the shipped `subprocess` row and inserts
`dsh-plugin-wsl-env/subprocess` in its place at the app level. The subclass
overrides `spawnTerminal` only. Ordinary `spawn()`, the host ripgrep search, the
pwsh executor, and the LSP host reach the shipped implementation unchanged.

The cost is that the terminal follows the app configuration, not the session. A
session opened on a Windows folder still gets a distro terminal, started in
`/mnt/<drive>/...`.

## Path coordinates

Three coordinate systems appear in the code:

| System | Example | Used by |
|---|---|---|
| Linux inside the distro | `/home/you/proj/a.ts` | commands, `ctx.shell` |
| The distro's UNC share | `\\wsl.localhost\ubuntu\home\you\proj\a.ts` | the host filesystem stack, `ctx.fs` |
| The Windows filesystem | `C:\Users\you\...`, or `/mnt/c/Users/you/...` from inside | sessions opened on a Windows folder |

[`lib/paths.js`](../lib/paths.js) converts between them. It is pure: it imports no
DSH package and performs no I/O. Its containment helpers decide whether a target
path sits under a writable root. The filesystem fence uses them.

## Sandbox

### Why the Windows runner cannot be used

On Windows, DSH confines commands with `dsh-sandbox-windows-acl`. It uses a
restricted, low-integrity Windows token and a write allowlist.

That token cannot reach WSL. `wsl.exe` fails with `Wsl/E_ACCESSDENIED`, and
`\\wsl.localhost\<distro>` reports access denied. Both work normally outside the
sandbox.

### What the plugin does instead

The plugin builds a `bubblewrap` profile on the Windows side and passes it to
`wsl.exe --exec`. The confinement is created inside the distro:

```text
wsl.exe -d <distro> --cd <linux dir> --exec bwrap \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp --bind <workspace> <workspace>]  --  <shell> -lc <cmd>
```

These are the same arguments DSH's Linux runner uses (`dsh-sandbox-local`), so the
behaviour and the error messages match a Linux host. The function
`bwrapProfileArgs` in [`lib/sandbox.js`](../lib/sandbox.js) builds them.

| Mode | What a command inside the distro can do |
|---|---|
| `read-only` | read the whole distro; a fresh `/dev` is mounted writable, so `/dev/null` and `/dev/shm` work, and nothing else does |
| `workspace-write` | the above, plus the session workspace is writable and `/tmp` is a temporary mount |
| `danger-full-access` | no sandbox; used for an approved wider-permission request |

`WslFileSystem` checks writes against the same policy and the same writable list,
with one deliberate translation: for a session inside a distro the temp root is the
distro's own `/tmp`, and the Windows temp directory is *not* granted, because it lies
outside the execution world the policy describes. That avoids a mismatch where `bash`
could write `/tmp` but the write tool could not. The two `/tmp`s are still different
directories — the command's is a fresh tmpfs — see [LIMITATIONS.md](LIMITATIONS.md). The fence is complete for the model's reach: `writeText` and `editText` are
the only mutation calls the model-facing file tools make on the filesystem seam,
so checking those two checks everything the model can mutate. Both providers
report their mode through `sandboxMode`. The tool layer and the Permissions
selector read that value.

### Reported enforcement

`WslSandbox` reports `enforcement: partial`, not `full`. A process inside the
distro can still run a Windows program through WSL interop, for example
`/mnt/c/.../*.exe`. Bubblewrap does not govern that process.

`npm run probe:sandbox` demonstrates the boundary on your machine and records it as
`INFO`.

### Failure mode

The providers fail closed. Without a usable `bwrap` in the distro, `WslSandbox`
throws `SandboxUnavailableError`, and every confined command reports
`SANDBOX_UNAVAILABLE`. Nothing runs unconfined and silently. The string
`read-only file system` is classified as a denial, so the tool layer can offer the
wider-permission path.

A failed probe is **not** remembered: only a success is cached for the process
lifetime, so a `bubblewrap` installed while the app runs is believed on the next
command. See [`lib/probe-cache.js`](../lib/probe-cache.js).

A command that never started because the distro itself is missing, stopped or
unregistered is reported separately: `wsl.exe` puts a `WSL_E_*` code on stdout with
an empty stderr, and `WslShellExecutor` turns that into an error naming the distro
and the remedy instead of a bare non-zero exit. It is deliberately not a sandbox
code, because a wider permission cannot create a distro.

Set `sandbox: false` on either provider to opt out. Commands then run unconfined,
and `sandboxMode` returns `undefined`.

## Error codes

The plugin raises `FsError`s with a code the tool layer maps, and `wsl.exe`'s own
failures are named as well. A model sees the code; a reader asking what refused them
finds it here.

| Code | Raised by | Meaning | What clears it |
|---|---|---|---|
| `SANDBOX_UNAVAILABLE` | `WslSandbox.confine` | the requested mode cannot be enforced: no usable `bwrap` in the distro | install `bubblewrap` there (a failed probe is re-run, so no restart is needed), or set `sandbox: false` |
| `FS_SANDBOX_DENIED` | `WslFileSystem.checkedTarget` | the file-effect policy refused the write: `read-only`, or a target outside the writable roots | a wider permission for that one call, or a session workspace that contains the target |
| `FS_OUTSIDE_DISTRO` | `WslFileSystem.worldPath` | `restrictToDistro` is on and the path names **another distro**'s share — a configuration fence, not a sandbox decision | open a session in that distro, or set `restrictToDistro: false`. A wider permission does **not** lift it |
| `FS_NOT_OBSERVED` | `WslFileSystem.assertGuard` | a guarded create (`createIfAbsent`) targeted a file that exists and had not been read first | read the file, then overwrite with the version guard or edit it |
| `FS_STALE_VERSION` | `WslFileSystem.assertGuard` | the version the caller holds no longer matches: the file changed, or is gone | read it again and retry with the fresh version |
| `FS_IO_ERROR` | `WslFileSystem.watch` | `watch()` is refused, because a 9p share cannot be watched reliably | poll, or watch from inside the distro |
| `FS_NOT_FOUND` | the host filesystem stack | the path does not exist — the ordinary answer, passed through | — |

Two failures come from `wsl.exe` itself rather than from a code of ours, and both used
to be invisible:

| Failure | How it arrives | What the plugin does |
|---|---|---|
| the distro is missing, stopped or unregistered | a `Wsl/Service/WSL_E_*` code on **stdout**, UTF-16 on some builds, with an empty stderr and exit 255 | `WslShellExecutor` reads the code with the NULs stripped and fails with the distro name and the remedy. Deliberately not a sandbox code: a wider permission cannot create a distro |
| the working directory cannot be entered | a relay line on stderr, exit **0**, and the command runs in `/` | `WslShellExecutor` fails with the directory and the fallback, instead of reporting a success that acted on the wrong tree |


What the model actually sees on a filesystem denial is two lines the tool layer
prepends: `[sandbox: file access denied under <mode> mode]`, then
`[sandbox: escalation available — retry this exact operation once with
sandbox_permissions (the narrowest wider mode that suffices) + justification; the
approval prompt asks the user]`. A code that is not `FS_SANDBOX_DENIED` gets neither
line — which is the reason `FS_OUTSIDE_DISTRO` has its own code.

## The runtime mirror

The checkout lives inside the distro. A DSH profile can only link a Windows path,
and pnpm rewrites `link:\\wsl.localhost\...` into a broken
`/wsl.localhost/...` symlink. The harness therefore cannot load the plugin from a
distro checkout.

The Windows copy at `default-workspace/dsh-plugin-wsl` is a runtime mirror.
[`test/probe/sync-to-windows.sh`](../test/probe/sync-to-windows.sh) keeps it in
step with the checkout, and `npm run sync:windows` runs that script.

## Test layers

| Layer | Location | Needs a harness |
|---|---|---|
| Style and packaging checks | [`test/style.mjs`](../test/style.mjs) | no |
| Syntax pass | [`test/syntax.mjs`](../test/syntax.mjs) | no |
| Unit tests | `test/*.test.mjs` | no |
| Sandbox probe | [`test/probe/sandbox.sh`](../test/probe/sandbox.sh) | no; it applies the profile arguments directly |
| Harness probes | [`test/probe/run.sh`](../test/probe/run.sh), `terminal.sh`, `sandbox-shell.sh`, `picker.sh`, `missing-wsl.sh`, `sandbox-off.sh` | yes: Windows, WSL2, a mounted profile, and a linked checkout |
| Host probes | [`test/probe/mode.sh`](../test/probe/mode.sh) | Windows Node, no harness |
| Probe plugins | the `*-probe.mjs` and `*-probe.yml` files in `test/probe/` | loaded by the scripts above |

The unit tests import only Node builtins, so they run on any platform. CI runs them
on Linux and Windows, on Node 20, 22 and 24. The harness probes are a manual step,
because a hosted runner has no WSL distro and no profile to mount.

The probe scripts share [`test/probe/env.sh`](../test/probe/env.sh), which derives
the Windows user, the distro name and the UNC spelling of the checkout from the
machine, and [`test/probe/env.mjs`](../test/probe/env.mjs) for the Node-side probes.
No probe carries a user name, and the YAML overlays are templates with `@NAME@`
placeholders that the scripts substitute into generated copies.

## File layout

```text
lib/paths.js        pure conversion between the three path formats
lib/wsl.js          wsl.exe interop primitives (no DSH imports)
lib/listing.js      pure directory listing and breadcrumb helpers (no DSH imports)
lib/index.js        WslShellExecutor (ctx.shell) and WslFileSystem (ctx.fs)
lib/sandbox.js      the distro-side bwrap confinement shared by both providers
lib/picker.js       WslDirectoryPicker (ctx.directoryPicker)
lib/subprocess.js   WslSubprocessRuntime (ctx.subprocess), the terminal window
lib/auto-preset.js  per-session environment selection
lib/shell-env.js    registers the DSH_WSL_* environment variables
lib/{shell,fs}.js   one-line subpath entry points
cordis.patch.yml    the bundle configuration layer (dsh.bundle), commented
examples/           one machine-local profile layer, for comparison
scripts/            release helpers, used by the release workflow
test/               unit tests, the style gate, and the behaviour probes
docs/               this file, the configuration and limitation references, the
                    release checklist, and the archived designs
```

`package.json` publishes a subset of this tree: the `files` list is the contract, and
`npm run lint:style` fails if an entry stops matching tracked content.

## Where the reasoning lives

- [`CHANGELOG.md`](../CHANGELOG.md) records what changed in each release. It also
  names the documentation a reader would have acted on that is no longer true.
- [`archive/engineering-record.zh.md`](archive/engineering-record.zh.md) is the
  full engineering record, in Chinese: measured contracts, debugging rounds, and
  the conclusions as they stood then.
- [`archive/README.md`](archive/README.md) indexes the archived material in
  Chinese, and [`archive/README.en.md`](archive/README.en.md) is the English index.
- [`README.md`](../README.md) is the only statement of current state.
