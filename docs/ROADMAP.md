# Roadmap

The native in-distro agent is the default session-runtime backend since 0.10.0
([ADR 0002](adr/0002-native-agent.md)). This plan was updated after the A6 FS
measurement; the numbers are in the ADR's
[FS queue measurement](adr/0002-native-agent.md#fs-queue-measurement-a6-2026-10-18)
section.

## Done

| Step | Outcome |
|---|---|
| A1 | `wsl-shell.agentBackend` (`auto`/`native`/`shell`): the native session-runtime agent, the shell fallback, the strict `native` mode |
| A2 | packaged static-musl `agent/native/linux-x86_64` and `linux-aarch64` binaries, selected by the distro's `uname -m`; the dev override |
| A3 | the native HELLO carries `/proc/self/exe`'s sha256; the host binds it with `expectedDigest` |
| A4 | the native-session probe (scope, EXEC, FS, KILL, digest, teardown, 8/8) in the real-machine suite; the warm-cache and stdin-EPIPE fixes |
| A5 | the native agent is the documented default; 0.10.0 published (npm + GitHub Release) |
| A6 | `WslAgent.metrics()` and `test/probe/fs-queue.mjs`; the shared shell read agent is the measured batch bottleneck |

## Next

### A7 — native shared read agent (v5)

The shared unconfined read agent is the only remaining measured bottleneck
(16 concurrent reads 342-614 ms, queue up to 583 ms, versus native FS execution
0.2-0.3 ms). A7 swaps its shell for the native binary (v5) while keeping the
shell as the fallback:

- **selection:** the same `agentBackend` semantics — `auto` prepares the
  packaged binary for the distro's architecture, `native` refuses instead of
  falling back, `shell` forces the shell; the dev override still wins;
- **preparation:** `ensureNativeBackend` once per distro (cache/digest/exec
  probe); the `WslAgent` with `expectedDigest` and `signalable: false`; on a
  preparation or HELLO failure the shell agent serves the reads — fail-open to
  the shell, never fail-closed;
- **surface:** the same six v5 FS ops and `dsh-fs` side channel; the
  `fs-substrate`/`DistroFs` parse is unchanged; the A2 differential covers the
  records;
- **acceptance:** `test/probe/fs-queue.mjs` shows 16 concurrent reads in
  ~12-20 ms (from 342-614 ms) and the single op ~22 ms (from 37.5 ms); with the
  native source removed the shell fallback still passes.

### A8 — aarch64 functional validation

The aarch64 binary is built by CI but never executed there. Run the 18-check
spike suite and the native-session probe on real aarch64 WSL or qemu; record
the result in the ADR.

### A9 — maintenance

- Release A7 as a minor (0.11.0) through the tag workflow;
- `pnpm run sync:windows` after each release, then restart the app;
- keep the probes and the documentation current.

## Deferred

- **v6 (FS concurrency / ERR frames / per-request env).** The A6 measurement
  shows the lock-removal gain is marginal (~7.7 -> ~5 ms per 16 writes, ~12.2
  -> ~8 ms per 16 reads). Revisit only if the native shared v5 still queues
  measurably or the ERR/env framing is needed for another reason.
- **Event stream.** No current consumer: the `fs.watch` contract is coarse and
  the inotify watcher satisfies it; terminal activity and ports poll.
- **Shell retirement.** Not planned. The shell agent remains the fallback and
  the shared read path until A7 lands, and the protocol/script stays supported.

## Not planned

- Streaming command output (the harness has no consumer for it).
- A per-subagent agent: subagents share the session runtime by workspace and
  policy; separate runtimes only if a measurable need appears.

## Decision rules

A step moves out of Deferred only with a measurement or a concrete consumer,
not because the protocol makes it possible. A7 itself is conditional on the
batch-read demand (the GUI file tree, parallel subagents) being real; the
single-op latency is the ~22 ms host round trip, not the FS backend.
