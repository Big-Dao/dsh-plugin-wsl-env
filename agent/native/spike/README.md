# Native agent spike (ADR 0002, stage 2)

This crate is a **spike**, not the shipped agent. It exists to answer two
questions with real code before any production work:

1. Can a native event loop keep one request running while another settles
   (the shell agent's serial write stall)?
2. Can `KILL` and the in-distro timeout take a request's whole process group
   without a second `wsl.exe` or `USR1`?

## Scope

Implemented: `HELLO`, `PING`, `SHUTDOWN`, `SETENV`, `EXEC`, `KILL` — v5
frames, per-request ids, `ACK`/`RES`, output caps, per-request process groups.

Also implemented: `FS` `stat`, `lstat`, `read`, `write` (mode, no-replace,
replace, expected-version re-check, staging + fsync + atomic publication),
`list` and `realpath` (including the nearest-existing-ancestor walk and the
`..`-in-missing-suffix refusal). A failed FS op writes the
`dsh-fs|reason|base64` side channel as the first line of the **RES stderr**,
which is where the host's `DistroFs` reads it. FS ops are serialized inside
the agent (the v5 error channel is process-global); `EXEC`s run concurrently
with them.

**Not implemented:** the host copy/verify/backend wiring and musl/cross-arch
builds. This spike does not touch the shipped FS path.

## Build and run

The crate is std-only (no crates, no network). Keep Cargo's state out of the
read-only parts of the distro when building inside a session:

```sh
CARGO_HOME="$PWD/.cargo-home" \
CARGO_TARGET_DIR="$PWD/agent/native/spike/target" \
cargo build --release --manifest-path agent/native/spike/Cargo.toml

node agent/native/spike/test.mjs
```

The test is not part of `pnpm test`: it needs the built binary.

## Result (2026-10-18, x86_64-unknown-linux-gnu, release)

- 16/16 checks: HELLO, PING, EXEC (exit + both streams), SETENV (later
  commands only), concurrent EXECs (the short one settles first), KILL (no
  second `wsl.exe`, no full wait), timeout (group killed promptly), output cap
  (cut and the pipe still drained), FS stat/lstat/read matching the shell
  agent, no-replace write + refusal, the missing-path side channel, FS list
  and realpath matching the shell, the dot-dot refusal, the expected-version
  replace/stale path, a setuid mode, and a shell-agent differential for EXEC.
- Release binary: 634 KB; the crate builds in ~2 s with no dependencies.
- The shell agent remains the shipped peer; nothing here is wired into
  `agent-shared.ts`, the session runtime, or the CLI.
