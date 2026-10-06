# Architecture

This file describes the plugin as it is today. It covers what the code does and
where each piece lives. The reasoning behind the design, including the designs that
were rejected, is recorded in [`CHANGELOG.md`](../CHANGELOG.md) and in
[`archive/engineering-record.zh.md`](archive/engineering-record.zh.md).

## What "provider" means here

DSH exposes its capabilities as services. The model-facing tools (`bash`, `read`,
`write`, `edit`, `glob`, `grep`) consume those services. They never touch a
filesystem or a shell directly.

This plugin supplies WSL-backed implementations of three of them, takes over two
root-plane services, and adds three smaller integrations.

## The three service providers

| Service | Class | File | What it does |
|---|---|---|---|
| `ctx.shell` | `WslShellExecutor` | [`lib/index.js`](../lib/index.js) | Runs each command in the distro's login shell over the resident in-distro agent (the default), wrapped in a distro-side `bwrap` sandbox; while the agent is out, or with `agent: false`, the same command falls back to one `wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>` process. |
| `ctx.fs` | `WslFileSystem` | [`lib/index.js`](../lib/index.js) | Serves the file tools from real distro files on the resident in-distro agent, on ext4 — the former Windows-side share substrate is retired (see below). |
| `ctx.subprocess` | `WslSubprocessRuntime` | [`lib/subprocess.js`](../lib/subprocess.js) | Opens the GUI terminal inside the distro, in the session workspace, and rewrites the file-search and git-snapshot spawns into the distro (see below). |

`WslShellExecutor` extends the shipped `LocalBashExecutor`, and `WslFileSystem`
extends the shipped `LocalFileSystem`. Only the parts that need a distro are
overridden.

## The two root-plane takeovers

Two of the shipped services are session-less — the GUI file tree and the root
`ctx.fs` — so they cannot be served from an agent preset. The layer replaces
their shipped rows outright, with subclasses that route by coordinate:

| Service | Class | File | What it does |
|---|---|---|---|
| `ctx.workspaceFiles` | `WorkspaceFilesWsl` | [`lib/workspace-files-wsl.js`](../lib/workspace-files-wsl.js) | The GUI file tree and previews for a `\\wsl.localhost\<distro>` workspace, served from inside the distro over the resident agent instead of Windows-side 9P walks. Extends the shipped service: a distro UNC routes distro-side, a drive path calls `super`, and the watch stream delegates unchanged — so replacing the row is safe for Windows-folder sessions too. Replaces the shipped `workspace-files` row. |
| `ctx.fs` (root plane) | `WslRoutingFileSystem` | [`lib/fs-routing.js`](../lib/fs-routing.js) | The root filesystem, routed by coordinate: a distro UNC identity is served by the resident agent (real watch events, ext4 reads), a drive path stays host-native. Replaces the shipped `fs-sandbox` row, whose write fence has no root-plane consumers — the model's writes ride the preset filesystems. [`root-fs-routing.md`](root-fs-routing.md) is the design. |

Both routes are composition-level for the mirror-image reason the terminal is
(see below): no session identity reaches them. Each takeover is a top-level
`disabled:` entry targeting the shipped row plus a bare `insert:` list holding
the replacement — because a `disabled` written *inside* an insert list is not a
patch but a duplicate-id data row, and a nested `insert:` is never interpreted at
all. [`cordis.patch.yml`](../cordis.patch.yml) carries the full row list, and
`test/composition.test.mjs` runs the file through the real patch algorithm to
keep the shape honest.

One further module ships built but deliberately unwired:
[`lib/file-reference-wsl.js`](../lib/file-reference-wsl.js), the distro-side
traversal strategy for `@` completion. It is built and tested, but **not** wired
into `cordis.patch.yml` — the seam it consumes is an upstream proposal
([`upstream/rfc-wsl-workspaces.md`](upstream/rfc-wsl-workspaces.md)), and
reaching the funnels without it would mean subclassing past module-internal
functions.

## The three smaller integrations

| Subpath | Class or name | File | What it does |
|---|---|---|---|
| `dsh-plugin-wsl-env/picker` | `WslDirectoryPicker` | [`lib/picker.js`](../lib/picker.js) | Adds the installed distros to the folder picker, next to the Windows home directory, and lists distro levels from inside the distro (the resident's `ls`, one-shot `wsl.exe` when it is out). |
| `dsh-plugin-wsl-env/auto-preset` | `auto-preset` | [`lib/auto-preset.js`](../lib/auto-preset.js) | Binds the `wsl` agent preset when a new session's workspace is inside a distro. |
| `dsh-plugin-wsl-env/shell-env` | `wsl-shell-env` | [`lib/shell-env.js`](../lib/shell-env.js) | Contributes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL`, `DSH_WSL_HOME` and `DSH_WSL_PORTS` to the managed `DSH_*` namespace. The port list is a snapshot, refreshed every `portsRefreshMs` (10000 by default), so a server started moments ago may not be listed yet. |

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
| `subprocess-wsl` | at the app level, called the composition; the shipped `subprocess` row is disabled | because no session identity reaches the terminal controller, see below |
| `workspace-files-wsl` | at the app level; the shipped `workspace-files` row is disabled | the GUI file tree is session-less, so it cannot be served from a preset |
| `fs-routing` | at the app level; the shipped `fs-sandbox` row is disabled | the root `ctx.fs` is session-less, and its write fence has no root-plane consumers |
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
overrides two methods: `spawnTerminal` rewrites a `wsl.exe` launch into
`wsl.exe -d <distro> --cd <linux dir>`, and `spawn()` rewrites two kinds of
launches into the distro — the file-search tool's packaged ripgrep (agent-first,
with the one-shot `wsl.exe --exec` handle as the fallback when the agent is out)
and git snapshot commands. Both spawn decisions are pure coordinate functions
(`lib/search-route.js`, `lib/git-route.js`); every other `spawn()` — including
the one-shot fallback's own `wsl.exe -lc <command>` (the default agent path
carries the command over the resident instead of spawning) — reaches the shipped
implementation untouched, as do the pwsh executor and the LSP host.

The terminal's execution world follows the session (`hostSessions`, default on):
a WSL-folder session runs the distro shell, a Windows-folder session runs
`powershell.exe` in its own directory. What still follows the app configuration
is the shell menu and the tab title, both derived from the composition's single
`WSL` shell profile — so a host session's tab reads `WSL` over a PowerShell
process. See [LIMITATIONS.md](LIMITATIONS.md) and
[UPSTREAM-TERMINAL-TITLE.md](UPSTREAM-TERMINAL-TITLE.md).

## Path coordinates

Three coordinate systems appear in the code:

| System | Example | Used by |
|---|---|---|
| Linux inside the distro | `/home/you/proj/a.ts` | commands, `ctx.shell` |
| The distro's UNC share | `\\wsl.localhost\ubuntu\home\you\proj\a.ts` | the harness's path identities (`ctx.fs` target keys), the picker and terminal routing — a coordinate, not an I/O path: no file tool reads or writes through the share |
| The Windows filesystem | `C:\Users\you\...`, or `/mnt/c/Users/you/...` from inside | sessions opened on a Windows folder |

[`lib/paths.js`](../lib/paths.js) converts between them. It is pure: it imports no
DSH package and performs no I/O. Its containment helpers decide whether a target
path sits under a writable root. The filesystem fence uses them.

## The filesystem substrate

`wsl-fs` serves `ctx.fs` on one I/O substrate: the resident in-distro agent.
The former Windows-side share backend (`substrate: "share"`) is retired — a
profile carrying the value is refused at boot, and no file tool crosses the
9p share. The substrate's facts:

- **Reads, writes, identities** run on ext4 through the resident; symlinks and
  mode bits are native (every identity is a distro-side `realpath`; the
  publication rename is the kernel's).
- **Guarded writes** carry their intent to the publication: a `createIfAbsent`
  publishes with a no-replace link, closing the check-then-write window for
  creates outright; an overwrite or edit carries its version into the write op
  and the agent re-verifies it one syscall before the rename — a concurrent
  writer wins, the stale write refuses with `FS_STALE_VERSION`.
- **Kernel enforcement** is stage two: a mutation runs on a confined resident —
  one long-lived agent per (distro, policy), whose bwrap profile binds exactly
  what the mode grants — so the kernel refuses what the check would have, and a
  check bug cannot become a write outside the workspace. Escalated writes
  (`danger-full-access`) ride the plain resident. A kernel refusal carries
  `FS_SANDBOX_DENIED`, the same dialect as the command path.
- **New files** publish 0600 — the host backend's own POSIX publication
  semantics, as on a Linux host.
- **Agent outage** fails closed: `FS_IO_ERROR` naming the substrate and the
  recovery path. There is no fallback I/O; a distro without usable bwrap
  refuses confined mutations with the bootstrap command, the same closed
  failure the command path has.

Writes fence with the same host-side policy the command path's sandbox
describes — `WslFileSystem.checkedTarget`, over the same writable list; the
command path itself is confined by the distro-side profile and never calls it —
and the substrate does not change what `sandboxMode` reports. The wire protocol
the substrate speaks is documented in
[`agent/wsl-agent.sh`](../agent/wsl-agent.sh); the orchestration layers are
[`lib/fsio-agent.js`](../lib/fsio-agent.js) (fsio's mechanics over the FS
frames), [`lib/fs-substrate.js`](../lib/fs-substrate.js) (the provider-shaped
operations, including the write/edit guard orchestration), and
[`lib/fsio-text.js`](../lib/fsio-text.js) (the pure text mechanics, replicated
from upstream pending the export proposed in
[UPSTREAM-FSIO-EXPORT.md](UPSTREAM-FSIO-EXPORT.md)).

## Sandbox

### Why the Windows runner cannot be used

On Windows, DSH confines commands with `dsh-sandbox-windows-acl`. It uses a
restricted, low-integrity Windows token and a write allowlist.

That token cannot reach WSL. `wsl.exe` fails with `Wsl/E_ACCESSDENIED`, and
`\\wsl.localhost\<distro>` reports access denied. Both work normally outside the
sandbox.

### What the plugin does instead

The plugin builds a `bubblewrap` profile on the Windows side and hands the
resulting argv to the distro — over the resident agent by default, or to
`wsl.exe --exec` on the one-shot fallback. The confinement is created inside the
distro, and the argv is the same either way:

```text
wsl.exe -d <distro> --cd <linux dir> --exec bwrap \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp --bind <workspace> <workspace>]  [--tmpfs /mnt]  --  <shell> -lc <cmd>
```

These are the same arguments DSH's Linux runner uses (`dsh-sandbox-local`), so the
behaviour and the error messages match a Linux host. The function
`bwrapProfileArgs` in [`lib/bwrap.js`](../lib/bwrap.js) builds them — the
peer-free builder every confinement site composes from. The trailing
`[--tmpfs /mnt]` is the `maskWindowsDrive` option: when it is on, the Windows
drive is shadowed by an empty tmpfs in every confined profile, so its files
cannot be read or exfiltrated and its executables cannot be launched through
interop. The option is off by default; [CONFIGURATION.md](CONFIGURATION.md) lists
the row keys, and `lib/sandbox-core.js` states its honest ceiling.

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

`maskWindowsDrive` is the one mitigation the profile can offer, and it is a
narrowing rather than a closure: it takes the drive's data and its executables
off the table, but `binfmt` interop dispatches on file *content*, so a command
that can write the workspace can still write a PE there and have it launched as
a Windows process. Either way the provider reports `partial` — the complete
closure is distro-level (`[interop] enabled=false` in `wsl.conf`). The mask is
reported on the result's sandbox fact as `windowsDrive: "masked"` (or
`"visible"`), but that is this plugin's own extra field: the pinned harness's
sandbox type and its model-facing notes carry `mode`, `denied`, `enforcement` and
`runnerFailed` only, so the field reaches the result and the tests, not the
model.

`pnpm run probe:sandbox` demonstrates the boundary on your machine and records it as
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
failures are named as well. Every `FsError` code the plugin itself raises appears
below — a model sees the code, and a reader asking what refused them finds it here.
Codes the shipped host stack raises behind a drive path pass through
`lib/fs-routing.js` unchanged and are the peer's, not this table's; the GUI file
tree's own wire refusals are a separate dialect, listed after the table.

| Code | Raised by | Meaning | What clears it |
|---|---|---|---|
| `SANDBOX_UNAVAILABLE` | `WslSandbox.confine` | the requested mode cannot be enforced: no usable `bwrap` in the distro | install `bubblewrap` there (a failed probe is re-run, so no restart is needed), or set `sandbox: false` |
| `FS_SANDBOX_DENIED` | `WslFileSystem.checkedTarget`, and `lib/fsio-agent.js` (a write the confined resident's mount table refused, classified from the kernel's `read-only file system`) | the file-effect policy refused the write: `read-only`, or a target outside the writable roots — or the kernel refused it at the resident's profile | a wider permission for that one call, or a session workspace that contains the target |
| `FS_OUTSIDE_DISTRO` | `WslFileSystem.worldPath` | `restrictToDistro` is on and the path names **another distro**'s share — a configuration fence, not a sandbox decision | open a session in that distro, or set `restrictToDistro: false`. A wider permission does **not** lift it |
| `FS_NOT_OBSERVED` | `lib/fs-substrate.js` (`writeText`; the agent's `exists` conclusion, mapped in `lib/fsio-agent.js`) | a guarded create (`createIfAbsent`) targeted a file that exists and had not been read first | read the file, then overwrite with the version guard or edit it |
| `FS_STALE_VERSION` | `lib/fs-substrate.js` (`writeText`, `editText`; the agent's `stale` conclusion, mapped in `lib/fsio-agent.js`) | the version the caller holds no longer matches: the file changed, or is gone | read it again and retry with the fresh version |
| `FS_IO_ERROR` | the filesystem stack: `lib/fs-decisions.js` (the substrate is unavailable), `lib/fsio-agent.js` (a `perm`/`loop`/`io` reason or a malformed record), `lib/index.js` (a path that cannot be mapped, or a `SandboxUnavailableError`), and `WslFileSystem.watch` | the catch-all I/O failure — most often the resident agent is out or the distro returned an I/O error, the "agent outage fails closed" case above. A watch target outside the pinned distro is the narrow one | get the resident back (check `wsl.exe -l -v`, then restart the session); for a watch, aim it at a distro path — the watch itself runs where the files live (`lib/watcher.js`) |
| `FS_NOT_FOUND` | `lib/fsio-agent.js` and `lib/fs-substrate.js` (the agent's `notfound`/`notdir` conclusion, an empty path, or a missing edit target), and the host filesystem stack behind a drive path | the path does not exist — the ordinary answer | — |
| `FS_NOT_REGULAR_FILE` | `lib/fsio-agent.js`, `lib/fs-substrate.js` | the target is not a regular file where one is required: a directory, symlink or device on a read, or a non-file target on a write | point the call at a regular file |
| `FS_NOT_DIRECTORY` | `lib/fsio-agent.js` (`listChildren`) | the target is not a directory, so there are no children to list | list a directory |
| `FS_NOT_TEXT` | `lib/fsio-agent.js`, `lib/fsio-text.js` | the content is not UTF-8 text: a NUL sample (binary) or a decode failure | not a policy refusal — read text, or use a command for binary content |
| `FS_TOO_LARGE` | `lib/fsio-agent.js` | the content exceeds the byte cap the caller's operation carries | read a byte range (`WslFileSystem.readByteRange`) instead of the whole file, or raise the cap |
| `FS_ABORTED` | `lib/fsio-agent.js`, `lib/fsio-text.js` | the caller's signal was aborted before or during the operation | not a refusal — the caller cancelled; a fresh call clears it |
| `FS_EDIT_NOT_FOUND` | `lib/fsio-text.js` (`applyLiteralEdit`) | `old_string` was empty, or matched nothing in the file | give an `old_string` the file actually contains |
| `FS_AMBIGUOUS_EDIT` | `lib/fsio-text.js` (`applyLiteralEdit`) | `old_string` matched more than once and `replace_all` was not set | make `old_string` unique, or set `replace_all` |

The GUI file tree speaks a second dialect. `WorkspaceFilesWsl` refuses through the
typert wire's `RemoteError`s, not `FsError`s, so its codes are not in the table
above: `workspace-file/not-found`, `workspace-file/outside-workspace`,
`workspace-file/not-directory`, `workspace-file/not-regular-file`,
`workspace-file/not-text`, and `workspace-file/too-large` (one code for both the
full-file cap and the byte-window cap), plus `gateway/bad-request` for a malformed
page request (a non-integer offset, or a limit above `maxLines`). A drive-path
workspace calls the shipped service and gets the peer's own answers instead.

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
step with the checkout, and `pnpm run sync:windows` runs that script.

## Test layers

| Layer | Location | Needs a harness |
|---|---|---|
| Style and packaging checks | [`test/style.mjs`](../test/style.mjs) | no |
| Syntax pass | [`test/syntax.mjs`](../test/syntax.mjs) | no |
| Build consistency | [`test/build-freshness.mjs`](../test/build-freshness.mjs) | no; it re-runs the real build and byte-compares the committed `lib/`, so it also catches an orphan there |
| Type check | `tsc --noEmit` over `test/**` and `types/*.d.ts` (`src/` is checked by the build itself) | no |
| Unit tests | `test/*.test.mjs` | no |
| Sandbox probe | [`test/probe/sandbox.sh`](../test/probe/sandbox.sh) | no; it applies the profile arguments directly |
| Harness probes | [`test/probe/run.sh`](../test/probe/run.sh), `terminal.sh`, `sandbox-shell.sh`, `picker.sh`, `missing-wsl.sh`, `sandbox-off.sh` | yes: Windows, WSL2, a mounted profile, and a linked checkout |
| Distro probes | [`test/probe/substrate.sh`](../test/probe/substrate.sh), `watch.sh`, `agent.sh`, `exec.sh` | Windows and WSL2, but no harness boot and no profile: they run from a distro terminal with Node available, reaching `wsl.exe` through interop |
| Host probe | [`test/probe/mode.sh`](../test/probe/mode.sh) | Windows Node, no harness |
| Probe plugins | the `*-probe.mjs` and `*-probe.yml` files in `test/probe/` | loaded by the scripts above |

`pnpm test` runs the first five rows in order: `lint:style`, `test:syntax`,
`lint:build`, `lint:types`, `test:unit`.
[`test/probe/run-all-when-closed.sh`](../test/probe/run-all-when-closed.sh)
waits for the app to exit and then runs the whole real-machine suite once —
`--include-fs` prepends `run.sh`.

The unit tests come in two kinds: most import only Node builtins, while
[`test/composition.test.mjs`](../test/composition.test.mjs),
[`test/fs.boot.test.mjs`](../test/fs.boot.test.mjs),
[`test/fsio-agent.test.mjs`](../test/fsio-agent.test.mjs),
[`test/provider.test.mjs`](../test/provider.test.mjs) and
[`test/workspace-files-wsl.test.mjs`](../test/workspace-files-wsl.test.mjs) import
pinned `@deepseek-ai/*` development dependencies (the composition and boot tests run
the loader's real patch algorithm). One `pnpm install` reproduces that tree before
the first run; the runtime package itself still ships zero dependencies. CI runs
`pnpm test` on Linux and Windows, on Node 22 and 24, and `pnpm run test:coverage` on
Node 24 only — the threshold flags need Node 22.8. Node 20 is absent on purpose:
`engines` requires `^22.19.0 || >=24.0.0`, the harness host's own floor. The harness
probes are a manual step, because a hosted runner has no WSL distro and no profile to
mount.

The probe scripts share [`test/probe/env.sh`](../test/probe/env.sh), which derives
the Windows user, the distro name and the UNC spelling of the checkout from the
machine, and [`test/probe/env.mjs`](../test/probe/env.mjs) for the Node-side probes.
No probe carries a user name, and the YAML overlays are templates with `@NAME@`
placeholders that the scripts substitute into generated copies.

## File layout

`lib/` is generated output: every module's source is `src/<name>.ts`, and
`pnpm run build` emits `lib/<name>.js` plus its `lib/<name>.d.ts`. Never edit
`lib/` by hand — `lint:build` fails when the committed bytes drift from a real
build, and it also fails on an orphan in either direction.

```text
src/<name>.ts         the sources — edit THESE; each builds to lib/<name>.{js,d.ts}
agent/wsl-agent.sh    the resident in-distro agent (POSIX sh, coreutils only)
cordis.patch.yml      the bundle configuration layer (dsh.bundle), commented
examples/             one machine-local profile layer, for comparison
locale/               the Plugins-page display metadata (title/description)
scripts/              the build (build.mjs), the release helpers
                      (check-release-tag.mjs, changelog-section.mjs), and the
                      distro-side bootstrap installer (bootstrap.sh)
test/                 unit tests, the style/build/type gates, and the probes
docs/                 this file, the configuration and limitation references,
                      the release checklist, and the archived designs
```

The modules, in alphabetical order:

```text
src/agent-confined.ts        the confined residents' factory (one per policy)
src/agent-errors.ts          the error a resident outage rejects with
src/agent-exec.ts            the agent-backed shell execution handle
src/agent-protocol.ts        the wire protocol codecs (pure)
src/agent-shared.ts          the per-distro resident shared by every provider
src/agent.ts                 the resident in-distro agent's host side
src/auto-preset.ts           per-session environment selection
src/bwrap.ts                 the bwrap command line every confinement site
                             assembles (no imports, so a bare checkout can
                             assert it)
src/file-reference-wsl.ts    the distro-side `@`-completion traversal — built,
                             tested, not yet wired (see above)
src/fs.ts                    the ctx.fs subpath entry point
src/fs-decisions.ts          the filesystem provider's policy decisions (pure,
                             unit-testable in a bare checkout)
src/fs-routing.ts            WslRoutingFileSystem, the root-plane ctx.fs
src/fs-substrate.ts          the agent substrate's provider-shaped operations
src/fsio-agent.ts            fsio's mechanics over the agent's FS frames
src/fsio-text.ts             the peer's pure text mechanics, replicated pending
                             the upstream fsio export (UPSTREAM-FSIO-EXPORT.md)
src/git-route.ts             which git spawns belong inside the distro (pure)
src/index.ts                 WslShellExecutor (ctx.shell) and WslFileSystem (ctx.fs)
src/listing.ts               pure directory listing and breadcrumb helpers
src/paths.ts                 pure conversion between the three path formats
src/picker.ts                WslDirectoryPicker (ctx.directoryPicker)
src/ports.ts                 the listening-port snapshot behind DSH_WSL_PORTS
src/preset-choice.ts         whether a new session adopts the WSL preset (pure)
src/probe-cache.ts           which probe verdicts may be remembered (pure)
src/sandbox.ts               the distro-side bwrap confinement shared by both
                             providers, bound to the peer's failure type
src/sandbox-core.ts          the probe-and-confinement core, free of DSH peers
src/search-exec.ts           the agent-backed execution handle for a search
src/search-route.ts          which execution world a search spawn belongs to (pure)
src/shell.ts                 the ctx.shell subpath entry point
src/shell-env.ts             registers the DSH_WSL_* environment variables
src/subprocess.ts            WslSubprocessRuntime (ctx.subprocess), the GUI
                             terminal window
src/terminal-activity.ts     the distro-side activity probe for idle terminal
                             reclamation
src/terminal-route.ts        which execution world a terminal launch belongs to (pure)
src/watcher.ts               in-distro file watching for WslFileSystem.watch
src/workspace-files-route.ts pure builders and parsers for the routed
                             workspace-files service
src/workspace-files-wsl.ts   WorkspaceFilesWsl (ctx.workspaceFiles), the GUI
                             file tree and previews
src/wsl.ts                   wsl.exe interop primitives (no DSH imports)
```

`package.json` publishes a subset of this tree: the `files` list is the contract, and
`pnpm run lint:style` fails if an entry stops matching tracked content.

## Where the reasoning lives

- [`CHANGELOG.md`](../CHANGELOG.md) records what changed in each release. It also
  names the documentation a reader would have acted on that is no longer true.
- [`REQUIREMENTS.zh.md`](REQUIREMENTS.zh.md) is the requirements register: every
  documented behaviour commitment numbered, with where it is specified and what
  verifies it, plus the open items (Chinese, maintainer-facing, not packaged).
- [`archive/engineering-record.zh.md`](archive/engineering-record.zh.md) is the
  full engineering record, in Chinese: measured contracts, debugging rounds, and
  the conclusions as they stood then.
- [`archive/README.md`](archive/README.md) and
  [`archive/README.en.md`](archive/README.en.md) are two English indexes of the
  same three archived files, the second so a reader who does not read Chinese can
  still tell what is there; the records themselves are Chinese.
- [`README.md`](../README.md) is the only statement of current state.
