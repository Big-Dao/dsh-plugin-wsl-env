# Architecture

This file describes the plugin as it is today. It covers what the code does and
where each piece lives. The reasoning behind the design, including the designs that
were rejected, is recorded in [`CHANGELOG.md`](../CHANGELOG.md) and in
[`archive/engineering-record.zh.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/archive/engineering-record.zh.md).

## What "provider" means here

DSH exposes its capabilities as services. The model-facing tools (`bash`, `read`,
`write`, `edit`, `glob`, `grep`) consume those services. They never touch a
filesystem or a shell directly.

This plugin supplies WSL-backed implementations of three of them, replaces three
app-level rows (`subprocess`, `fs-sandbox`, `directory-picker`), and adds the
smaller integrations listed below.

## The three service providers

| Service | Class | File | What it does |
|---|---|---|---|
| `ctx.shell` | `WslShellExecutor` | [`lib/wsl-shell.js`](../lib/wsl-shell.js) | Runs each command in the distro's login shell over the resident in-distro agent (the default), wrapped in a distro-side `bwrap` sandbox; while the agent is out, or with `agent: false`, the same command falls back to one `wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>` process. |
| `ctx.fs` | `WslFileSystem` | [`lib/wsl-filesystem.js`](../lib/wsl-filesystem.js) | Serves WSL-routed file operations through the resident in-distro agent; the former Windows-side share substrate is retired (see below). |
| `ctx.subprocess` | `WslSubprocessRuntime` | [`lib/subprocess.js`](../lib/subprocess.js) | Opens the GUI terminal inside the distro, in the session workspace, and rewrites the file-search and git-snapshot spawns into the distro (see below). |

`WslShellExecutor` extends the shipped `LocalBashExecutor`, and `WslFileSystem`
extends the shipped `LocalFileSystem`. Only the parts that need a distro are
overridden.

## The root-plane filesystem takeover

The root `ctx.fs` is session-less, so it cannot be served from an agent preset.
The layer replaces its shipped row outright with a subclass that routes by
coordinate:

| Service | Class | File | What it does |
|---|---|---|---|
| `ctx.fs` (root plane) | `WslRoutingFileSystem` | [`lib/fs-routing.js`](../lib/fs-routing.js) | The root filesystem, routed by coordinate: a distro UNC identity is served inside the distro (inotify where available, polling otherwise), a drive path stays host-native. Replaces the shipped `fs-sandbox` row, whose write fence has no root-plane consumers — the model's writes ride the preset filesystems. [`root-fs-routing.md`](root-fs-routing.md) is the design. |

The GUI file tree and previews keep the shipped `workspace-files` row. Its
client half is the browser `file` resource provider the Sidebar previews need,
so replacing the row with a server-only subclass would drop it; the shipped
service reads WSL paths through the routed root filesystem instead. The cost is
extra `ctx.fs` round trips per listing, `stat` or page read (see
[LIMITATIONS](LIMITATIONS.md)).

The takeover is composition-level for the mirror-image reason the terminal is
(see below): no session identity reaches the root filesystem. It is a top-level
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
([`upstream/rfc-wsl-workspaces.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/upstream/rfc-wsl-workspaces.md)), and
reaching the funnels without it would mean subclassing past module-internal
functions.

## The smaller integrations

| Subpath | Class or name | File | What it does |
|---|---|---|---|
| `dsh-plugin-wsl-env/picker` | `WslDirectoryPicker` | [`lib/picker.js`](../lib/picker.js) | The folder picker's two worlds: a category root with a Windows branch (starting at the drives) and a WSL branch (one row per installed distro); distro levels list from inside the distro (the resident's `find`, one-shot `wsl.exe` when it is out). |
| `dsh-plugin-wsl-env/auto-preset` | `auto-preset` | [`lib/auto-preset.js`](../lib/auto-preset.js) | Binds the `wsl` agent preset when a new session's workspace is inside a distro. |
| `dsh-plugin-wsl-env/shell-env` | `wsl-shell-env` | [`lib/shell-env.js`](../lib/shell-env.js) | Contributes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL`, `DSH_WSL_HOME` and `DSH_WSL_PORTS` to the managed `DSH_*` namespace, choosing the session workspace's distro (default/pinned facts are probed at mount; other distros are warmed when their session appears). The port list is a snapshot per active distro, refreshed every `portsRefreshMs` (10000 by default), so a server started moments ago may not be listed yet. |
| `dsh-plugin-wsl-env/preflight` | `wsl-preflight` | [`lib/preflight.js`](../lib/preflight.js) | Runs the environment advisory at session start — and, with `startup: true` (the default), once at plugin load — surfacing the doctor-style verdict as a non-gating warning. |
| `dsh-plugin-wsl-env/update-check` | `wsl-update-check` | [`lib/update-check.js`](../lib/update-check.js) | Asks the app's plugin manager about a newer stable release about once a day and carries the fact in `DSH_WSL_PLUGIN_UPDATE`; never fetches on its own. |
| `dsh-plugin-wsl-env/cwd-prompt` | `wsl-cwd-prompt` | [`lib/cwd-prompt.js`](../lib/cwd-prompt.js) | Rewrites the runtime context's working-directory entry to the distro's POSIX form. |
| `dsh-plugin-wsl-env/cwd-prompt-tool` | `wsl-cwd-prompt-tool` | [`lib/cwd-prompt-tool.js`](../lib/cwd-prompt-tool.js) | Serves the model's read/`cd` tool with the same semantics the harness ships, rewriting the returned `cwd` to the distro's POSIX form. |
| `dsh-plugin-wsl-env/wsl-doctor-tool` | `wsl-doctor-tool` | [`lib/wsl-doctor-tool.js`](../lib/wsl-doctor-tool.js) | The `wsl_doctor` model tool: the doctor in-process (merging the live resident's state), scoped by `depth`/`section`, rendered as the itemized digest. |
| `dsh-plugin-wsl-env/wsl-doctor-command` | `wsl-doctor-command` | [`lib/wsl-doctor-command.js`](../lib/wsl-doctor-command.js) | The `/wsl-doctor` UI command: spawns the standalone doctor CLI as a host subprocess and renders the same digest detached from model history. |
| `dsh-plugin-wsl-env/status` | `wsl-status` | [`lib/status.js`](../lib/status.js) | The sidebar panel's route (`GET /api/wsl-env/status`): lists the installed distros and runs one distro's quick doctor; `POST` on the same route runs the full doctor with `--fix-owned` (labeled repair when stale scopes or a broken agent cache are repairable, a full check otherwise; both re-verified). Answered over the Host connection's authenticated exact-Fetch channel; the last result per distro is persisted under `$DSH_HOME/cache/dsh-plugin-wsl-env/status.json` and stored results for running distros are refreshed in the background. |
| `dsh-plugin-wsl-env` (bare name) | `wsl-env-client-host` | [`lib/client-host.js`](../lib/client-host.js) | The deliberate no-op host half whose bare-name mount lets the web client roster serve `./client`: the sidebar's WSL environment panel and the post-add access-mode prompt. |

Three path and interop helpers import no DSH package.
[`lib/paths.js`](../lib/paths.js) translates paths.
[`lib/listing.js`](../lib/listing.js) builds directory listings and breadcrumbs.
[`lib/wsl.js`](../lib/wsl.js) holds the `wsl.exe` interop primitives.

[`lib/provider-common.js`](../lib/provider-common.js) is provider glue rather
than a peer-free helper: it imports `@deepseek-ai/dsh-sandbox` and shares distro
resolution, home caching, runtime selection and writable-root translation
between the shell and filesystem providers.

## How the pieces are mounted

[`cordis.patch.yml`](../cordis.patch.yml) is the bundle layer. It is a top-level
YAML array of patch entries, and `dsh plugin --profile <name> add
dsh-plugin-wsl-env` applies it as one layer on the CLI distribution; the
desktop app applies the same bundle through its sidebar **Plugins** page
(**Add plugin**) and records it in the profile's `dsh.profile.bundles`.

The environment is per session, not per process:

| Row | Mounted | Why there |
|---|---|---|
| `wsl-shell`, `wsl-fs` | inside `preset-wsl`, an agent preset with isolate realms | so one process can serve a Windows workspace and a distro workspace at the same time |
| `subprocess-wsl` | at the app level, called the composition; the shipped `subprocess` row is disabled | because no session identity reaches the terminal controller, see below |
| `workspace-files` | shipped, not replaced | its client half is the browser `file` resource provider the Sidebar previews need; it reads WSL paths through the routed root filesystem |
| `fs-routing` | at the app level; the shipped `fs-sandbox` row is disabled | the root `ctx.fs` is session-less, and its write fence has no root-plane consumers |
| `directory-picker-wsl`, `wsl-shell-env`, `auto-preset`, `wsl-preflight`, `wsl-update-check`, `wsl-cwd-prompt`, `wsl-cwd-prompt-tool`, `wsl-doctor-command`, `wsl-status`, `wsl-env-client-host` | at the app level | they answer questions that are not scoped to a single preset; `shell-env` resolves its facts per session workspace, and the advisory/diagnosis rows must answer even when a session never opens |
| `wsl-doctor-tool` | inside `preset-wsl` (model-facing) | the tool surface follows the preset: a session on a Windows folder keeps the shipped tools |

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
launches into the distro — the file-search tool's packaged ripgrep and git
snapshot commands (each agent-first on the warm resident — protocol v6 carries
a git call's stdin, and a one-shot call costs ~230 ms of `wsl.exe` startup
against the resident's ~2 ms — with the one-shot `wsl.exe --exec` handle as
the fallback when the agent is out). When the HOST has no git,
`resolveExecutable` answers git with a distro sentinel path, and the snapshot
command's discovery call (`rev-parse --show-toplevel ...`) routes too, its
absolute-path output translated back into UNC form — so full WSL change review
works without Windows git. Both spawn decisions are pure coordinate functions
(`lib/search-route.js`, `lib/git-route.js`); every other `spawn()` — including
the one-shot fallback's own `wsl.exe -lc <command>` (the default agent path
carries the command over the resident instead of spawning) — reaches the shipped
implementation untouched, as do the pwsh executor and the LSP host.

The terminal's execution world follows the session (`hostSessions`, default on):
a WSL-folder session runs the distro shell, a Windows-folder session runs
`powershell.exe` in its own directory. What still follows the app configuration
is the shell menu's DEFAULT entry and its title, both derived from the
composition's single `WSL` shell profile — so a new tab reads `WSL` whatever it
runs, including a host session's PowerShell. The menu also lists host
candidates (`powershell`, `cmd`; `wsl.exe` dedupes into the default), and a
manually selected shell is titled after itself. See [LIMITATIONS.md](LIMITATIONS.md) and
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

- **Reads, writes, identities** run through the resident on the filesystem
  backing the distro path, typically ext4 for distro-owned files. Symlink and
  mode behavior also depends on that filesystem; identities use distro-side
  `realpath` and publication uses the kernel's rename or link.
- **Guarded writes** carry their intent to the publication: a `createIfAbsent`
  publishes with a no-replace link, closing the check-then-write window for
  creates outright; an overwrite, edit, patch, delete or move carries its
  expected version into the operation and the agent re-verifies it before the
  rename or removal (`moveFile` checks both endpoints). A mismatch returns
  `FS_STALE_VERSION`, but a change after that check can still be overwritten.
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
  [--tmpfs /tmp --bind <workspace> <workspace> [--bind <root> <root> ...]]  [--tmpfs /mnt]  --  <shell> -lc <cmd>
```

By default the profile wraps the session's resident agent ONCE, under
`systemd-run --user --scope`, and the command argv is the shell line itself:
`bwrap … --die-with-parent --bind /tmp /tmp --bind <workspace> <workspace> -- sh agent.sh`.
There is no `--unshare-pid` and no per-command tmpfs, so background processes
survive, `/tmp` is the distro's real `/tmp`, and `ps` sees the session. The
per-command argv above is what `sessionSandbox: false` (and the one-shot
fallback) still runs.

These are the same arguments DSH's Linux runner uses (`dsh-sandbox-local`), so the
behaviour and the error messages match a Linux host. The function
`bwrapProfileArgs` in [`lib/bwrap.js`](../lib/bwrap.js) builds them — the
peer-free builder every confinement site composes from. The trailing
`[--tmpfs /mnt]` is the `maskWindowsDrive` option: when it is on, the Windows
drive is shadowed by an empty tmpfs in every confined profile, so its files
cannot be read or exfiltrated and its executables cannot be launched through
interop. The option is off by default; [CONFIGURATION.md](CONFIGURATION.md) lists
the row keys, and `lib/sandbox-core.js` states its honest ceiling.

The optional `--bind <root> <root>` pairs come from the row's `writableRoots`
and the shared policy's `additionalWritableRoots`. `lib/writable-roots.js`
resolves them (`~` expansion, UNC/Linux spelling), drops entries already
writable under the workspace, `/tmp` or `/dev/shm` and entries nested inside
another grant, then checks once per process that each remaining root is an
existing physical directory. The same effective list goes into the command
profile, the confined-write resident and the session runtime — and into their
cache keys, because the mount table is fixed for an agent's lifetime.

| Mode | What a command inside the distro can do |
|---|---|
| `read-only` | read the whole distro; a fresh `/dev` is mounted writable, so `/dev/null` and `/dev/shm` work, and nothing else does |
| `workspace-write` | the above, plus the session workspace and any explicitly granted roots are writable; `/tmp` is the distro's real `/tmp` in the session runtime, and a fresh tmpfs in the per-command profile (`sessionSandbox: false`) |
| `danger-full-access` | no sandbox; used for an approved wider-permission request |

`WslFileSystem` checks writes against the same policy and the same writable list,
with one deliberate translation: for a session inside a distro the temp root is the
distro's own `/tmp`, and the Windows temp directory is *not* granted, because it lies
outside the execution world the policy describes. That avoids a mismatch where `bash`
could write `/tmp` but the write tool could not. In the per-command profile
(`sessionSandbox: false`) the two `/tmp`s are different directories — the
command's is a fresh tmpfs; the shipped session runtime shares the distro's real
`/tmp` — see [LIMITATIONS.md](LIMITATIONS.md). The provider's mutation surface is
`writeText`, `editText`, `patchText`, `deleteFile` and `moveFile`; each runs
through `checkedTarget`, so the fence covers every mutation the provider can
serve. Both providers report their mode through `sandboxMode`. The tool layer
and the Permissions selector read that value.

### Reported enforcement

`WslSandbox` reports `enforcement: partial`, not `full`. A process inside the
distro can still run a Windows program through WSL interop, for example
`/mnt/c/.../*.exe`. Bubblewrap does not govern that process.

`maskWindowsDrive` or the `masked` and `disabled` `interopVisibility` stances
shadow `/mnt` in confined commands, a narrowing rather than a closure. Other
mounts and unrestricted file reads are not covered by the mask, and `binfmt`
interop dispatches on file *content*, so a command
that can write the workspace can still write a PE there and have it launched as
a Windows process. Either way the provider reports `partial`. Disabling WSL
interop requires a separate distro-level change (`[interop] enabled=false` in
`wsl.conf`); the `disabled` stance does not make that change. The mask is
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
service is the shipped `workspace-files` row, so its wire refusals are the peer's
own dialect, described after the table.

| Code | Raised by | Meaning | What clears it |
|---|---|---|---|
| `SANDBOX_UNAVAILABLE` | `WslSandbox.confine` | the requested mode cannot be enforced: no usable `bwrap` in the distro | install `bubblewrap` there (a failed probe is re-run, so no restart is needed), or set `sandbox: false` |
| `SANDBOX_INVALID_ROOT` | `effectiveWritableRoots` (both providers) | an entry in `writableRoots` or `additionalWritableRoots` is malformed, names another world, or fails the one-time physical-directory check | fix the entry; create the directory inside the distro first, use an absolute Linux path or `~/...`, and use the physical directory rather than a symlink |
| `FS_SANDBOX_DENIED` | `WslFileSystem.checkedTarget`, and `lib/fsio-agent.js` (a write the confined resident's mount table refused, classified from the kernel's `read-only file system`) | the file-effect policy refused the write: `read-only`, or a target outside the writable roots — or the kernel refused it at the resident's profile | a wider permission for that one call, or a session workspace that contains the target |
| `FS_OUTSIDE_DISTRO` | `WslFileSystem.worldPath` | `distro` is fixed (`default` or a name), `restrictToDistro` is on, and the path names **another distro**'s share — a configuration fence, not a sandbox decision. With `distro: ''`/`auto` a UNC target is served by its own distro, so the fence has nothing foreign to refuse | set `distro` to `''`/`auto` (the default), or open a session in that distro. A wider permission does **not** lift it |
| `FS_NOT_OBSERVED` | `lib/fs-substrate.js` (`writeText`; the agent's `exists` conclusion, mapped in `lib/fsio-agent.js`) | a guarded create (`createIfAbsent`) targeted a file that exists and had not been read first | read the file, then overwrite with the version guard or edit it |
| `FS_STALE_VERSION` | `lib/fs-substrate.js` (`writeText`, `editText`; the agent's `stale` conclusion, mapped in `lib/fsio-agent.js`) | the version the caller holds no longer matches: the file changed, or is gone | read it again and retry with the fresh version |
| `FS_IO_ERROR` | the filesystem stack: `lib/fs-decisions.js` (the substrate is unavailable), `lib/fsio-agent.js` (a `perm`/`loop`/`io` reason or a malformed record), `lib/wsl-filesystem.js` (a path that cannot be mapped, or a `SandboxUnavailableError`), and `WslFileSystem.watch` | the catch-all I/O failure — most often the resident agent is out or the distro returned an I/O error, the "agent outage fails closed" case above. A watch target outside the selected distro is the narrow one | get the resident back (check `wsl.exe -l -v`, then restart the session); for a watch, aim it at a distro path — the watch itself runs where the files live (`lib/watcher.js`) |
| `FS_NOT_FOUND` | `lib/fsio-agent.js` and `lib/fs-substrate.js` (the agent's `notfound`/`notdir` conclusion, an empty path, or a missing edit target), and the host filesystem stack behind a drive path | the path does not exist — the ordinary answer | — |
| `FS_NOT_REGULAR_FILE` | `lib/fsio-agent.js`, `lib/fs-substrate.js` | the target is not a regular file where one is required: a directory, symlink or device on a read, or a non-file target on a write | point the call at a regular file |
| `FS_NOT_DIRECTORY` | `lib/fsio-agent.js` (`listChildren`) | the target is not a directory, so there are no children to list | list a directory |
| `FS_NOT_TEXT` | `lib/fsio-agent.js`, `lib/fsio-text.js` | the content is not UTF-8 text: a NUL sample (binary) or a decode failure | not a policy refusal — read text, or use a command for binary content |
| `FS_TOO_LARGE` | `lib/fsio-agent.js` | the content exceeds the byte cap the caller's operation carries | read a byte range (`WslFileSystem.readByteRange`) instead of the whole file, or raise the cap |
| `FS_ABORTED` | `lib/fsio-agent.js`, `lib/fsio-text.js` | the caller's signal was aborted before or during the operation | not a refusal — the caller cancelled; a fresh call clears it |
| `FS_EDIT_NOT_FOUND` | `lib/fsio-text.js` (`applyLiteralEdit`) | `old_string` was empty, or matched nothing in the file | give an `old_string` the file actually contains |
| `FS_AMBIGUOUS_EDIT` | `lib/fsio-text.js` (`applyLiteralEdit`) | `old_string` matched more than once and `replace_all` was not set | make `old_string` unique, or set `replace_all` |
| `FS_PATCH_MISMATCH` | `lib/fs-substrate.js` (`patchText`; the agent's record dialect, `docs/AGENT-PROTOCOL-V7.md`) | a hunk's `oldLines` no longer match the file at the lines the hunks name — the text drifted between the caller's read and the patch | re-read the file and rebuild the hunks against the fresh text |
| `FS_SAME_TARGET` | `lib/fs-substrate.js` (`moveFile`) | `moveFile`'s source and destination resolve to the same file | give two distinct paths, or drop the call |

The GUI file service keeps the shipped `workspace-files` row, so its wire
refusals are the peer's `workspace-file/*` dialect (plus `gateway/bad-request`
for a malformed page request), not this plugin's `FsError` codes. The plugin
supplies the routed `ctx.fs`; an agent outage reaches the service as
`FS_IO_ERROR` and the peer maps it.

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
[`test/probe/sync-to-windows.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/sync-to-windows.sh) keeps it in
step with the checkout, and `pnpm run sync:windows` runs that script.

## Test layers

| Layer | Location | Needs a harness |
|---|---|---|
| Style and packaging checks | [`test/style.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/style.mjs) | no |
| Syntax pass | [`test/syntax.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/syntax.mjs) | no |
| Build consistency | [`test/build-freshness.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/build-freshness.mjs) | no; it re-runs the real build and byte-compares the committed `lib/`, so it also catches an orphan there |
| Type check | `tsc --noEmit` over `test/**` and `types/*.d.ts` (`src/` is checked by the build itself) | no |
| Unit tests | `test/*.test.mjs` | no |
| Requirements matrix | [`scripts/check-requirements.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/scripts/check-requirements.mjs) | no; every cited test must exist and stay wired |
| Doc consistency | [`scripts/check-doc-consistency.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/scripts/check-doc-consistency.mjs) | no; repeated facts, doctor surface and bilingual pair completeness |
| Sandbox probe | [`test/probe/sandbox.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/sandbox.sh) | no; it applies the profile arguments directly |
| Harness probes | [`test/probe/run.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/run.sh), `terminal.sh`, `sandbox-shell.sh`, `interop-shell.sh`, `picker.sh`, `fs-routing.sh`, `missing-wsl.sh`, `sandbox-off.sh`, `native-session.sh` | yes: Windows, WSL2, a mounted profile, and a linked checkout |
| Distro probes | [`test/probe/substrate.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/substrate.sh), `watch.sh`, `agent.sh`, `exec.sh`, `session-sandbox.sh`, `gui-preview.sh`, `file-reference-9p.sh` | Windows and WSL2, but no harness boot and no profile: they run from a distro terminal with Node available, reaching `wsl.exe` through interop |
| Host probe | [`test/probe/mode.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/mode.sh) | Windows Node, no harness |
| Probe plugins | the `*-probe.mjs` and `*-probe.yml` files in `test/probe/` (plus standalone measurers such as `gui-preview.mjs`, `native-session.mjs`, `fs-probe.mjs`, `fs-queue.mjs`) | loaded or invoked by the scripts above |

`pnpm test` runs `lint:style`, `lint:links`, `lint:requirements`, `lint:docs`,
`test:syntax`, `lint:build`, `lint:types` and `test:unit`, in that order.
[`test/probe/run-all-when-closed.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/run-all-when-closed.sh)
waits for the app to exit and then runs the whole real-machine suite once —
`--include-fs` prepends `run.sh`.

The unit tests come in two kinds: most import only Node builtins, while
[`test/composition.test.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/composition.test.mjs),
[`test/fs.boot.test.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/fs.boot.test.mjs),
[`test/fsio-agent.test.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/fsio-agent.test.mjs) and
[`test/provider.test.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/provider.test.mjs) import
pinned `@deepseek-ai/*` development dependencies (the composition and boot tests run
the loader's real patch algorithm). One `pnpm install` reproduces that tree before
the first run; the runtime package itself still ships zero dependencies. CI runs
`pnpm test` on Linux and Windows, on Node 22 and 24, and `pnpm run test:coverage` on
Node 24 only — the threshold flags need Node 22.8. Node 20 is absent on purpose:
`engines` requires `^22.19.0 || >=24.0.0`, the harness host's own floor. The harness
probes are a manual step, because a hosted runner has no WSL distro and no profile to
mount.

The probe scripts share [`test/probe/env.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/env.sh), which derives
the Windows user, the distro name and the UNC spelling of the checkout from the
machine, and [`test/probe/env.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/env.mjs) for the Node-side probes.
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
src/client-host.ts           the bare-name host half — a deliberate no-op that
                             anchors the browser client
src/cwd-prompt.ts            rewrites the runtime context's working directory
                             to the distro's POSIX form
src/cwd-prompt-tool.ts       serves the model's read/cd tool with distro-POSIX
                             cwd output
src/distro-route.ts          the pure distro-mode selector (pinned / workspace /
                             default) shared by shell, fs, preflight and env
src/doctor-live.ts           merges the live resident's status into a collected
                             doctor report
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
src/git-exec.ts              the agent-backed execution handle for the
                             git-snapshot spawn
src/git-route.ts             which git spawns belong inside the distro (pure)
src/index.ts                 public provider exports
src/wsl-shell.ts             WslShellExecutor (ctx.shell)
src/wsl-filesystem.ts        WslFileSystem (ctx.fs)
src/doctor-report.ts         in-process doctor collector used by the tool
src/provider-common.ts       distro, home, runtime and writable-root helpers
src/listing.ts               pure directory listing and breadcrumb helpers
src/messages.ts              the en/zh message catalogs and the host-locale wiring
src/native-agent.ts          native binary selection and preparation
src/paths.ts                 pure conversion between the three path formats
src/picker.ts                WslDirectoryPicker (ctx.directoryPicker)
src/ports.ts                 the listening-port snapshot behind DSH_WSL_PORTS
src/preflight.ts             session-start environment advisories
src/preset-choice.ts         whether a new session adopts the WSL preset (pure)
src/probe-cache.ts           which probe verdicts may be remembered (pure)
src/sandbox.ts               the distro-side bwrap confinement shared by both
                             providers, bound to the peer's failure type
src/sandbox-core.ts          the probe-and-confinement core, free of DSH peers
src/search-exec.ts           the agent-backed execution handle for a search
src/search-route.ts          which execution world a search spawn belongs to (pure)
src/session-runtime.ts       shared session runtime and agent lifecycle
src/session-scope.ts         systemd scope creation and cleanup
src/shell.ts                 the ctx.shell subpath entry point
src/shell-env.ts             registers the DSH_WSL_* environment variables
src/subprocess.ts            WslSubprocessRuntime (ctx.subprocess), the GUI
                             terminal window
src/terminal-activity.ts     the distro-side activity probe for idle terminal
                             reclamation
src/terminal-route.ts        which execution world a terminal launch belongs to (pure)
src/update-check.ts          the once-a-day update notice (fact store +
                             host-delegated check)
src/watcher.ts               in-distro file watching for WslFileSystem.watch
src/status.ts                the panel's route (distro list, one distro's
                             quick doctor, and the --fix-owned repair over /api)
src/wsl-doctor-command.ts    the `/wsl-doctor` UI command row (spawns the
                             standalone doctor CLI)
src/wsl-doctor-tool.ts       the `wsl_doctor` model tool row (in-process diagnosis)
src/wsl.ts                   wsl.exe interop primitives (no DSH imports)
```

`package.json` publishes a subset of this tree: the `files` list is the contract, and
`pnpm run lint:style` fails if an entry stops matching tracked content.

## Where the reasoning lives

- [`CHANGELOG.md`](../CHANGELOG.md) records what changed in each release. It also
  names the documentation a reader would have acted on that is no longer true.
- [`REQUIREMENTS.zh.md`](REQUIREMENTS.zh.md) is the requirements register: every
  documented behaviour commitment numbered, with where it is specified and what
  verifies it, plus the open items (Chinese, maintainer-facing, shipped in the
  npm package).
- [`archive/engineering-record.zh.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/archive/engineering-record.zh.md) is the
  full engineering record, in Chinese: measured contracts, debugging rounds, and
  the conclusions as they stood then.
- [`archive/README.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/archive/README.md) and
  [`archive/README.en.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/archive/README.en.md) are two English indexes of the
  same three archived files, the second so a reader who does not read Chinese can
  still tell what is there; the records themselves are Chinese.
- [`README.md`](../README.md) and [`docs/README.zh.md`](README.zh.md) are the
  current-state statement; the Chinese README is authoritative and the English
  file is its translation (see the documentation map).

## Diagnostics

`pnpm run doctor` (and `pnpm run diagnose`) is the operator-facing entry
point over everything above: it probes the Windows/WSL versions, the distro
and its shell, bubblewrap, systemd/Linger, the peer floor, a fresh agent
handshake and the stale session scopes, and reports the versioned
`doctorReport` structure (`scripts/doctor.mjs`, `lib/doctor-live.js`) with a
remedy per failure. The same report answers through three surfaces: this
standalone CLI (peer-free by design, so it starts when the plugin's own
runtime is broken), the `/wsl-doctor` UI command (spawns the CLI host-side,
renders detached from model history), and the `wsl_doctor` model tool
(in-process, merging the live resident's state through `lib/doctor-live.js`).
The sidebar panel renders the quick digest and posts the repair action the
same way (`--fix-owned`: plugin-owned state only). A run can be scoped (`--quick`, `--sections <csv>` on the CLI; `depth` /
`section` on the tool), and the report itemizes every check grouped by
distro. See [DIAGNOSTICS.md](DIAGNOSTICS.md) for the surfaces and the
verdict contract.
