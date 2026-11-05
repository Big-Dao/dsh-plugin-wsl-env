# Agent protocol v7 — design note (WSL-312)

Status: accepted · Supersedes: the v6 increment's unclaimed FS part ·
Author: the plugin maintainers · Date: 2026-11-05

## What v7 is

Protocol v6 (0.17.0) took the EXEC stdin-payload increment; the FS half of
WSL-312 was deferred. v7 is the FS half, plus the substrate for the peer's
new `patchText` / `deleteFile` / `moveFile` operations. One revision, one
negotiation rule, four capabilities.

## What ships

| Capability | Wire | Native agent | Shell agent | Host |
|---|---|---|---|---|
| Capability advertisement | HELLO gains a 6th field | `conc,batch` | `batch` | capability-aware FS scheduling |
| Structured FS errors | new `FSERR\|id\|reason\|b64 message` line | yes | yes | direct FsError mapping (the `dsh-fs\|…` stderr-line sniffing stays as a fallback for older agents) |
| Batched FS reads | new `FSB\|id\|timeout\|nops` frame, `OP\|op\|nargs` op specs follow | sequential under `fs_lock`, one RES | sequential in one worker, one RES | GUI-preview-shaped page reads in one round trip |
| `delete` / `move` FS ops | new op names in the FS frame vocabulary | yes | yes | guarded, mapped to `FsDeleteOutcome` / `FsMoveOutcome` |
| `patchText` | **no wire change** — host-side hunk application + a guarded `replace` write | n/a | n/a | hunks applied in-process via `@deepseek-ai/dsh-fs-patch` (a new peer dependency, the peer's own `applyHunks` — perfect error parity, `FS_PATCH_MISMATCH` free) |

`PROTOCOL_VERSION` becomes 7. `@deepseek-ai/dsh-fs-patch@0.2.2-rc.1` is added
to `peerDependencies` (the host imports `applyHunks` at runtime) and pinned in
`devDependencies`.

## Negotiation rule (unchanged in spirit, sharpened)

The version in HELLO is the AGENT's floor for the frames it accepts: a v7
agent parses every v5/v6 frame forever. The HOST decides what it may send:

- a host sends `FSB` / `FSERR`-expecting frames only against `HELLO ≥ 7`;
- a v6 host (an older mirror) against a v7 agent sees `HELLO|…|6` never —
  wait, the agent reports its own version. The rule that matters: **the host
  gates new frames on `HELLO.version ≥ 7`, and the doctor's handshake reports
  the negotiated pair**. A half-synced mirror (agent 6, host 7) therefore
  degrades to v6 behaviour instead of desyncing — the digest check still
  catches script drift, and version mismatch is the same recoverable state it
  is today (rebuild once, then one-shot fallback).

Concurrency capability is negotiated separately, because the two backends
honestly differ:

- `conc` — the agent runs FS ops concurrently and may answer out of order
  (the native agent already does: worker threads + `fs_lock` on mutations).
- `batch` — the agent accepts `FSB` (any backend; a batch is sequential
  inside one worker, which is exactly why it is safe everywhere).
- The SHELL agent does **not** advertise `conc`: its read loop is serial and
  POSIX sh gives no safe way to interleave 1 MB base64 lines on one pipe.
  The host therefore serializes single FS frames against `batch`-only agents
  and may pipeline them against `conc` agents. Batched reads — the actual
  GUI-preview win — work on both backends.

## Frame details

### HELLO v7

```
HELLO|wsl-agent|7|<sha256>|<pid>|<caps>
```

`caps` is a comma-separated token list (`conc`, `batch`). Absent or empty
(a v6 peer, a fake) means no capabilities — the host behaves exactly as
today. The host-side parser keeps accepting 5-field HELLOs.

### FSERR

```
FSERR|<id>|<reason>|<b64 message>
```

Emitted by both agents wherever an FS op fails (replacing the
`dsh-fs|reason|b64` first-stderr-line convention, which stays parsed as a
fallback). The host maps `reason` → `FsErrorCode` directly; `reason`
vocabulary is the existing `notfound notdir perm loop exists stale io
protocol` set.

### FSB — batched FS

```
FSB|<id>|<timeout seconds|0>|<n ops>
OP|<op>|<n args>
<b64 arg>…
OP|…
```

One `ACK`, then ONE `RES|<id>|0|<b64 payload>` where the payload is the
concatenated per-op records:

```
OK <i>|<b64 payload>
BAD <i>|<reason>|<b64 message>
```

Ops run in order in ONE worker; a failed op records `BAD` and continues with
the next (a batch is a set of independent reads, not a transaction). Payloads
are the op's normal stdout (stat record, list records, read bytes). The
per-op exit is visible per record, so the host can retry one member
individually.

### `delete` / `move` FS ops

```
delete  <path> <expected version|->
move    <src path> <dst path> <dst mode|-> <dst publish replace|no-replace> <src expected version|-> <dst expected version|->
```

Both reuse the write machinery's guards: version re-verification against a
fresh stat before the destructive step, staging + atomic publish for the
destination (`no-replace` = hard-link no-replace, `exists` refusal on a
concurrent creator), source removal after destination publication. A failed
source removal after a published destination is reported in the payload
(`sourceDeleted=false` plus the failure record) — the two-effect shape of the
peer's `FsMoveOutcome`, honestly preserved.

## `patchText` — why there is no frame

Hunks are JSON-serializable, but hunk APPLICATION belongs to
`@deepseek-ai/dsh-fs-patch`'s `applyHunks` — the peer's own matcher, whose
`FS_PATCH_MISMATCH` dialect (`hunk at patch line N (stage) does not match`)
this plugin must reproduce verbatim to stay in parity. Reimplementing it in
awk or Rust is a permanent second source of truth for the subtleties
(anchors, EOF-candidate retries, trailing-sentinel handling). So v7 does it
the parity way:

1. host `read`s the file (one round trip — batchable with the stat next to
   it),
2. applies `applyHunks` in-process (`FS_PATCH_MISMATCH` on failure, verbatim
   dialect),
3. issues a guarded `replace` write with the original version (one round
   trip).

Two round trips, zero new wire semantics, zero second implementation. The
`dsh-fs-patch` peer floor is `0.2.2-rc.1`, the same line the plugin already
targets.

## What breaks

Nothing for a correct peer. The compatibility matrix:

| host \ agent | 6 | 7 |
|---|---|---|
| v6 host (old mirror) | today | sends no v7 frames; HELLO extra field ignored |
| v7 host | no `FSB`/`FSERR`/`delete`/`move` (version-gated); parity gap stays | everything |

The host-side risk is bounded by the same rebuild-once-then-one-shot ladder
the executor already runs on any handshake mismatch.

## Acceptance mapping

- design note — this file.
- batched-read benchmark — `test/probe/gui-preview-batch.sh`: stat+list+read page
  shape, FSB vs five individual frames, both backends. Measured 2026-11-05 on
  `ubuntu` (five runs each, two samples): native (the shipped default)
  **4.4–7.4 → 1.9–2.1 ms/view (2.3–3.5x)**; shell backend 1.0–1.2x — its
  per-op cost is coreutils forks, not transport round trips, so batching
  there is a wash (the fork cost dominates either shape).
- lockstep — `agent/native/spike/test.mjs` gains v7 frames against the
  native binary; `test/agent-fs-script.test.mjs` gains them against the
  shell script; the doctor's handshake reports the negotiated version and
  capabilities; `PROTOCOL_VERSION = 7`.
- substrate — `fsio-agent`/`fs-substrate` serve `patchText`/`deleteFile`/
  `moveFile` for real; the composition tests flip from refusal to behaviour;
  `docs/PEER-PARITY.md`'s declared-gap section becomes an implementation
  record.
