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

**Not implemented:** `FS` frames (they are consumed and refused). The shell's
FS record formats, atomic publication and expected-version guard are the next
stage; this spike does not touch the shipped FS path.

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

- 9/9 checks: HELLO, PING, EXEC (exit + both streams), SETENV (later commands
  only), concurrent EXECs (the short one settles first), KILL (no second
  `wsl.exe`, no full wait), timeout (group killed promptly), output cap (cut
  and the pipe still drained), and a shell-agent differential for EXEC.
- Release binary: 634 KB; the crate builds in ~2 s with no dependencies.
- The shell agent remains the shipped peer; nothing here is wired into
  `agent-shared.ts`, the session runtime, or the CLI.
