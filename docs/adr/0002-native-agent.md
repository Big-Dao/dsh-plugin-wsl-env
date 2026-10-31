# ADR 0002 — Native in-distro agent (design)

- **Status:** accepted — the native agent is the default session-runtime
  backend (`agentBackend: auto` + the packaged static-musl binary for the
  distro's architecture), with the shipped shell agent as the fallback and the
  `native`/`shell` overrides. The concurrency/KILL/FS surface, the copy/verify,
  the HELLO digest, the packaged x86_64/aarch64 binaries and the real-machine
  probe are in place. **A7 is in place** (the shared reads are native); **A8
  is in place** (aarch64 18-check under qemu-user in CI; physical aarch64 WSL
  is out of scope); **v6 is deferred** — the measured lock-removal gain is
  marginal, and A7 removed the shared-shell batch bottleneck
- **Date:** 2026-10-18
- **Related:** [ADR 0001](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/adr/0001-session-scoped-sandbox.md) (session runtime),
  `agent/wsl-agent.sh`, `src/agent.ts`, `src/agent-protocol.ts`

## Context

This section records the shell-only baseline and original design motivation.
The status and migration sections describe what was subsequently shipped;
v6 structured errors and concurrent FS remain deferred.

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

The original design deferred implementation because a binary adds build,
distribution, architecture and supply-chain costs. Subsequent measurements
justified shipping the native agent as described below.

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
   `agent/native/spike` (18/18 manual checks, ~673 KB release binary). The
   host wiring, the packaged static-musl x86_64/aarch64 binaries and the
   default rollout are in place; v6 remains deferred. aarch64 runs under
   qemu in CI (A8).
3. **v6 (deferred).** The A6 measurement shows the lock-removal gain is
   marginal (~2-3 ms per 16 ops) and the shared shell read agent is the batch
   bottleneck. v6 stays unimplemented; A7 addresses the measured bottleneck
   instead. Revisit v6 only if the native shared v5 still queues measurably or
   the ERR/env framing is needed for another reason.
4. **Host integration (partial).** The copy/verify, the session-runtime factory,
   the `wsl-shell.agentBackend` selection, the packaged static-musl x86_64 and
   aarch64 binaries (`agent/native/linux-<arch>/dsh-wsl-agent`, selected by the
   distro's `uname -m`) and the running-binary HELLO digest are in place. The
   native-session probe (8/8: scope, EXEC, FS, KILL, digest, teardown) is in
   the real-machine suite; the default rollout is 0.10.0.
5. **Enabled by default** on x86_64 and aarch64 (0.10.0); the shell fallback
   and the flag stay. Retiring the shell is not planned; the shell remains the
   fallback and the shared read path until A7.
6. **Native shared read agent (A7, done).** The shared unconfined read agent
   selects the native binary (v5) with the shell as fallback; the A6 probe is
   the acceptance measurement (~30x on batch reads).
7. **aarch64 functional validation (A8, done).** The CI `native packages` job
   runs the 18-check suite under qemu-user against the freshly built aarch64
   musl binary and the committed `agent/native/linux-aarch64/dsh-wsl-agent`.
   Physical aarch64 WSL is out of scope ([COMPATIBILITY.md](../COMPATIBILITY.md)).

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
18/18: HELLO with the running binary's sha256; PING; EXEC exit/streams; SETENV; two concurrent EXECs with the
short one settling first; KILL without a second `wsl.exe`; a 200 ms timeout
killing the group promptly; the EXEC timeout unit (a 2 s budget does not kill
a 300 ms command — an earlier millisecond reading killed every longer
command); a capped output that is cut while the pipe is still drained; FS
stat/lstat/read matching the shell agent; a no-replace write and its refusal;
the missing-path side channel; FS list/realpath matching the shell; the
dot-dot refusal; the expected-version replace/stale path; a setuid mode; and a
shell-agent differential for the EXEC shape. The release binary is ~673 KB on
x86_64-unknown-linux-gnu and builds in ~2 s with no dependencies.

What this proves: the event loop removes the shell's serial-request stall and
the `USR1`/second-transport cancellation shape is unnecessary, and the core
FS surface (stat/lstat/read/write/list/realpath, version re-check, modes) can
be reproduced in the native process. What it does not prove: a native-session
probe on physical aarch64 WSL (qemu covers the 18-check suite in CI), v6
concurrency/env framing, or the event stream. The host copy/verify, the
session-runtime factory, the packaged binaries and the default are in place;
the shell agent remains the fallback and the shipped peer.

## FS queue measurement (A6, 2026-10-18)

`test/probe/fs-queue.mjs` measures both FS agents on the live machine
(x86_64, 16 concurrent requests per row):

| path | wall | queue max | per-op exec |
|---|---|---|---|
| shared shell `stat` | 342 ms | 324 ms | ~20 ms |
| shared shell `read` | 418 ms | 387 ms | ~25 ms |
| shared shell `list` | 614 ms | 583 ms | ~37 ms |
| native `write` | 7.7 ms | 6.6 ms | 0.3 ms |
| native `read` | 12.2 ms | 9.4 ms | 0.2 ms |
| native `EXEC` (50 ms each) | 88 ms | 7.5 ms | 5.5 ms |

The **shared shell read agent is the batch-read bottleneck**: its serial loop
turns 16 concurrent reads into 342-614 ms with queue waits up to 583 ms. Native
FS execution is 0.2-0.3 ms; the sequential per-op is dominated by the ~22 ms
host round trip (the shell's sequential stat is 37.5 ms, the native's 22 ms).

**v6's lock removal is marginal**: it would take 16 native writes from 7.7 ms
to roughly 5 ms and 16 reads from 12.2 ms to roughly 8 ms. The high-value next
step is the **native shared read agent (v5)** — same packaged binary and
protocol, the shell as fallback, roughly 30x on batch reads — not v6. The
single-op latency (~22 ms) is the transport, not the FS backend.

## Why it was built

Built in 0.10.0. The triggers that fired were the long-build/FS-serialization
pressure and the opportunity to make the session runtime native without
changing the shipped shell contract; the shell agent remains the fallback. The
conditions below are kept as the record of the decision:

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
- Per-request environment: the v5 host prefixes each command with `env`, so
  its variables do not mutate the agent. The low-level `SETENV` frame remains
  sticky for protocol compatibility; a future v6 can remove it.
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
