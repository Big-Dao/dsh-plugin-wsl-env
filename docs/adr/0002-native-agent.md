# ADR 0002 — Native in-distro agent (design)

- **Status:** proposed — design + stage-2 spike (EXEC/KILL/concurrency, the
  FS surface, the version/permission matrix, and the opt-in host
  copy/verify + session-runtime factory done; packaging/musl/default rollout
  pending); implementation still deferred until a trigger in
  [When to build it](#when-to-build-it) fires
- **Date:** 2026-10-18
- **Related:** [ADR 0001](0001-session-scoped-sandbox.md) (session runtime),
  `agent/wsl-agent.sh`, `src/agent.ts`, `src/agent-protocol.ts`

## Context

The resident peer inside the distro is a POSIX shell script,
`agent/wsl-agent.sh`. It speaks protocol v5 over the `wsl.exe` stdio pipe:
line-oriented, `|`-separated, base64 payloads, `HELLO`/`PING`/`SHUTDOWN`/
`KILL`/`SETENV`/`EXEC`/`FS`. It is the single owner of commands and the
filesystem substrate; the session runtime (ADR 0001) runs one instance per
session/policy under a systemd user scope.

The script has served well and is covered by `agent.test.mjs`, the protocol
tests, and the real-machine probes. Its hard edges are real though:

1. **Serial requests.** The stdin loop reads one frame, runs it to completion,
   then reads the next. Commands and confined file writes share the session
   runtime agent, so an `npm run build` blocks an editor save on the same
   session. Reads use the separate plain agent, but writes do not.
2. **Cancellation needs a second transport.** While the shell is blocked in
   `wait`, a `KILL` line sits in the pipe. The host spawns a second `wsl.exe`
   and sends `USR1` to the `HELLO` pid; inside a PID namespace that is
   impossible, so confined residents are not signalable at all.
3. **Capture is shell machinery.** Bounded capture is a FIFO plus a `dd`
   reader, a one-second kill grace, and a watchdog; it works, but it is the
   least obvious code in the repository and every edge case costs a probe.
4. **Protocol evolution is constrained.** FS failures ride a `dsh-fs|reason|
   base64` line on stderr, because a POSIX sh response line has no structured
   error slot. New features (event streaming, concurrent FS, per-request
   environment) would stretch base64-over-sh further.
5. **Lockstep releases.** Host and script must ship the same v5. A stale
   deployed script is refused by digest, which is correct but means every
   protocol change is a synchronized deploy and an app restart.

This ADR designs the native replacement without committing to build it now.
The decision to defer is deliberate: the shell agent is correct enough, and a
binary adds build, distribution, architecture and supply-chain costs that must
be paid before the first user-visible win.

## Goals

- **Concurrency.** Multiple `EXEC`/`FS` requests in flight, each with its own
  id, output buffers, deadline and process group; a long command no longer
  blocks a write.
- **Precise cancellation.** `KILL` is read by the event loop while the command
  runs; the request's process group is signalled directly. No `USR1`, no second
  `wsl.exe`, no `signalable` special case.
- **Native capture.** `pipe` + bounded buffers per request; no FIFO, no `dd`,
  no kill grace. Truncation is a byte count, not a shell heuristic.
- **Structured errors.** FS refusals become `ERR|id|reason|message` frames; the
  stderr side channel is retired in the protocol version that introduces them.
- **A path to events.** A native agent can host inotify and stream watch
  events to the host later, instead of the separate watcher process.
- **Same security boundary.** The agent still executes exactly the argv the
  host wrapped in `bwrap`; confinement, the session scope and the FS fence are
  unchanged.

## Non-goals

- Replacing `wsl.exe` as the transport, `bwrap` as the sandbox, the systemd
  user scope as the session lifetime, or the host-side FS fence.
- A Windows-side native component. The host remains Node.
- Building the agent from source on the user's machine. The distro is not
  required to have a compiler.
- Retiring the shell agent. It remains the portable fallback (and the only
  agent on architectures without a shipped binary).
- File watching, port scanning or terminal streaming in the first native
  version; those stay where they are until the event path exists.

## Options

### Language

| Option | Strengths | Costs |
|---|---|---|
| **Rust** (recommended) | static musl binary, no GC, strong parsing, precise process-group/timer control; the host protocol is simple to mirror | cross-compile toolchain in CI; slightly slower iteration |
| **Go** | easiest cross-compilation, static binary, simple concurrency | larger binary, GC pauses (irrelevant at this scale), fewer compile-time guarantees for the parser |
| **C** | smallest, universally available | no memory safety; the parser and frame lifetimes become manual; not worth it for this project |

The recommendation is Rust with `x86_64-unknown-linux-musl` and
`aarch64-unknown-linux-musl`, built in CI from a committed `Cargo.lock`.

### Distribution

| Option | Verdict |
|---|---|
| **Prebuilt binaries in the npm package**, one per Linux arch (recommended) | no network at runtime, pinned by the host, offline-installable; the package grows by a few MB per arch |
| Download on first use | rejected: a plugin install must not fetch and execute a remote binary |
| Build on first use in the distro | rejected: requires a compiler and network; the plugin's premise is no in-distro install |
| Ship only the shell | current state; acceptable until a trigger fires |

The binary runs from a **copy in the distro**, not from `/mnt/c`: DrvFs is
often mounted `noexec`, and executing from the share couples the agent's
lifetime to the Windows path. The host copies
`agent/native/linux-<arch>/dsh-wsl-agent` from the plugin package to
`~/.cache/dsh-wsl/agent/<sha256>/dsh-wsl-agent`, verifies the digest, marks it
executable, and caches per digest. The session runtime's `--ro-bind /` makes
the copy readable; `temp` is not used, so the binary survives scope restarts.

### Protocol

Start from **v5 compatibility for the spike**, then introduce **v6** for the
features that require it:

- **v5 native** (spike): the same `HELLO|wsl-agent|5|<digest>|<pid>` and the
  same frames; the host's existing codecs and the existing `agent.test.mjs`
  run unchanged. This proves the parser, exec, capture and FS ops. The digest
  is the binary's sha256.
- **v6** (the concurrency release):
  - `HELLO|wsl-agent|6|<sha256>|<pid>|<impl>` with `impl = native|shell`.
  - FS errors in `ERR|id|reason|b64 message`; the `dsh-fs|` stderr line is no
    longer produced by the native agent.
  - Drop `SETENV` as a sticky global (or keep it only for the single-request
    compatibility path): with concurrent requests a sticky environment is a
    race. Environment travels on the request (a count + base64 key/value
    lines) or is fixed by the `HELLO` process environment plus the host's
    bwrap wrapper.
  - `KILL|id` is handled by the event loop; the host stops spawning the
    `USR1` helper for native agents.
  - Optional `ACK`/`RES` streaming for large outputs is a later revision; the
    first v6 keeps one RES per request.
- Concurrency limits: a small per-agent cap (e.g. 8 in flight), a queue, and
  per-path serialization for FS writes so two writers do not race inside the
  agent. The host's per-target substrate lock already serializes its own
  operations; the agent's lock is defense in depth.

Handshake identity: the host accepts `wsl-agent|5` for the shell and
`wsl-agent|6|native` for the binary; the digest is checked against the file
the host shipped (script or binary). A mismatch refuses with the existing
"resync" remedy, never silently runs a stale peer.

## Process model

One process per agent, an event loop over stdin plus child pipes and timers:

- `EXEC`/`FS` frames are decoded, validated and queued; the event loop
  acknowledges them (`ACK|id`) and spawns each request's process group (or
  performs the FS syscalls directly for `stat`/`read`/`write`).
- `KILL|id` and the per-request deadline signal the group: `TERM`, then
  `KILL` after a fixed grace; the event loop keeps serving other requests.
- stdout/stderr pipes are drained into per-request bounded buffers; the RES
  line carries the exit code, both buffers and the cut flags.
- stdin EOF, `SHUTDOWN` or a fatal IO error runs the same cleanup as today:
  kill in-flight groups, remove staging directories, exit 0.
- The agent is the session scope's main process. The scope's cgroup still
  reaps background processes at session end; the agent adds no new lifecycle.
- FS operations use syscalls (stat/lstat/readlink/read/write, atomic rename);
  no `sh`, `base64`, `stat`, `find` subprocesses. The write path keeps the
  no-replace and expected-version semantics the host fence relies on, and the
  same staging-directory cleanup for killed writes.

## Host integration

- `agent-shared.ts` / the session runtime's factory chooses the backend:
  - native when a binary for the distro architecture is present in the
    package and the copy/verify succeeds;
  - the shell otherwise.
- A config key (`agentBackend?: "auto" | "native" | "shell"`, default `auto`)
  keeps a one-session escape hatch during rollout.
- The copy/verify step is host-side JavaScript over `wsl.exe --exec` (read the
  Windows file through `/mnt/c`, write with `dd`/`cat` to the cache path,
  sha256sum, chmod); it is cached by digest, so the cost is once per version
  per distro user.
- `WslAgent` already carries ids, pending requests, `HELLO` digest checks and
  the lease; the native agent reuses that surface. The `USR1`/`signalable`
  path becomes a shell-only detail; native agents are cancelled by frame.
- The FS substrate's `DistroFs` maps `ERR|id|reason` to `FsCodedError` for
  v6; v5 native keeps the stderr path so the existing tests are unchanged.

## Security

- The binary is committed/built by CI, baked into the npm package, and pinned
  by sha256 in the host; it is never downloaded at runtime.
- The protocol parser is fuzzed (frames, base64, path lengths, counts) and
  never invokes a shell for request content. `EXEC` argv is the host's argv;
  the agent does not interpret it.
- The agent runs as the distro user, inside the same bwrap mount profile and
  systemd scope; it has no privilege the shell agent did not have.
- The copy path is the user's cache, owned by the user; a world-writable
  directory is refused; the digest is re-checked before exec.

## Testing

- **Protocol suite**: the existing `agent-protocol` unit tests stay authoritative
  for both codecs; v6 adds error/env/encoding cases.
- **Agent suite**: `agent.test.mjs` parameterized over `{ shell, native }`.
  The shell tests already drive the real script on Linux; the native tests do
  the same with the built binary.
- **Differential matrix**: every frame shape and failure mode run against both
  agents, comparing exit codes, stdout/stderr bytes, cut flags and FS errors
  (allowing the v5→v6 error-channel difference where expected).
- **Concurrency suite** (new): two EXECs; EXEC + FS write; KILL one request
  while another runs; timeout one; verify the untouched request's result.
- **Probes**: the real-machine suite and the session runtime; the FS-first
  session; a long command with a concurrent write (the shell's known stall is
  the native agent's acceptance test).
- **Fuzzing**: the frame decoder and the path/args validation.

## Migration

1. **Design (this ADR).** No code.
2. **Spike (partial).** HELLO/PING/SETENV/EXEC/KILL, per-request process
   groups, the FS surface and the expected-version/mode matrix are done in
   `agent/native/spike` (16/16 manual checks, 634 KB release binary). The host
   wiring and musl/cross-arch builds remain.
3. **Differential + concurrency.** Full matrix; v6 error/env framing; the
   concurrent write acceptance test.
4. **Host integration (partial).** The `DSH_WSL_AGENT_NATIVE` copy/verify and
   session-runtime factory are in place. Packaging the per-arch binaries, the
   `agentBackend` flag and the probes remain.
5. **Enable by default** on x64 (aarch64 after a CI build leg); keep the shell
   fallback and the flag. Only then consider retiring the shell.

## Spike result (stage 2, partial)

`agent/native/spike/` is a std-only Rust crate that implements `HELLO`,
`PING`, `SHUTDOWN`, `SETENV`, `EXEC` and `KILL` with per-request process
groups and bounded capture, plus `FS` `stat`/`lstat`/`read`/`write` (mode,
no-replace, replace, expected-version re-check, staging + fsync + atomic
publication) and `list`/`realpath` (nearest-existing-ancestor walk, dot-dot
refusal). The `dsh-fs` side channel rides the RES stderr. FS operations are
serialized inside the agent for the v5 error channel; EXECs run concurrently
with them.

`agent/native/spike/test.mjs` (run manually against the built binary) passes
16/16: HELLO; PING; EXEC exit/streams; SETENV; two concurrent EXECs with the
short one settling first; KILL without a second `wsl.exe`; a 200 ms timeout
killing the group promptly; a capped output that is cut while the pipe is
still drained; FS stat/lstat/read matching the shell agent; a no-replace write
and its refusal; the missing-path side channel; and a shell-agent differential
for the EXEC shape. The release binary is 634 KB on
x86_64-unknown-linux-gnu and builds in ~2 s with no dependencies.

What this proves: the event loop removes the shell's serial-request stall and
the `USR1`/second-transport cancellation shape is unnecessary, and the core
FS surface (stat/lstat/read/write/list/realpath, version re-check, modes) can
be reproduced in the native process. What it does not prove: musl/cross-arch
builds, v6 concurrency/env framing, or the host copy/verify/backend
integration. None of this is wired into the shipped plugin.

## When to build it

Not now. Revisit when one of these is true:

- A long build reliably blocks model file writes often enough to be a reported
  problem (the shell's serial loop).
- A feature genuinely needs the event loop: in-agent inotify/event streaming,
  concurrent FS, per-request environment, output streaming.
- The shell agent causes a second maintenance incident (a capture/cancel edge
  the probes did not cover).
- The distribution cost falls (e.g. the release pipeline already ships
  per-arch binaries and provenance).

Until then the shell agent is the honest, dependency-free choice; the
limitations in `docs/LIMITATIONS.md` remain the declared boundary.

## Consequences

- **Staying with the shell:** no binary supply chain; the serial write stall,
  the `USR1` cancellation shape and the shell capture machinery remain; every
  protocol change stays a lockstep host+script release.
- **Going native:** concurrency and precise cancellation, simpler capture and
  structured errors; in exchange for per-arch binaries, a copy/verify step, a
  v6 protocol migration, a dual-implementation test matrix, and a larger
  security review surface.

## Open questions

- v6 JSON instead of line/base64? The line protocol is proven and the host
  parser is small; JSON would need a sh-free host but is easier to extend.
  The spike should decide after measuring the v5-native parser work.
- Per-request environment vs a fixed agent environment: the host's bwrap
  wrapper already sets the command's environment; `SETENV` is used for sticky
  facts. Concurrency makes sticky state suspect; likely per-request in v6.
- FS path locking and concurrent write semantics (same path, two requests):
  the host's per-target lock is the current answer; does the agent need its
  own?
- Output streaming for very large captures: RES-only keeps MAX_FRAME_BYTES;
  a chunked revision is later.
- ARM64 CI capacity; the aarch64 binary could ship after the x64 default.
- Whether the native agent hosts the watcher/inotify and the port scan, or
  keeps those as separate host-driven paths.
- Binary size/package impact; whether both arches ship in one npm tarball or
  the package selects at install.
