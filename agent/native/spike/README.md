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

## Host wiring (opt-in, session runtime only)

`wsl-shell.agentBackend: auto` (the shipped default) selects the native agent
when a verified source exists; `native` requires it; `shell` forces the shell
agent. The source is the packaged binary at
`agent/native/linux-<arch>/dsh-wsl-agent` (x86_64 today; the musl and aarch64
builds are next), or the `DSH_WSL_AGENT_NATIVE` development override. The host
reads the binary for the distro's `uname -m`, sha256s it, copies it into
`~/.cache/dsh-wsl/agent/<sha>/`, verifies the digest, and executes it once under
`</dev/null` to catch a libc mismatch before selecting it. The host sha256s the file, checks the distro architecture,
streams it into `~/.cache/dsh-wsl/agent/<sha>/dsh-wsl-agent` (never executes
from `/mnt/c`), verifies the distro-side digest, and hands the Linux path to
the session-runtime factory. The factory spawns the binary instead of
`sh wsl-agent.sh`, with USR1 disabled (the native reads KILL frames) and no
expected digest (the spike's HELLO digest is empty).

The shared per-distro agent (unconfined FS reads), the one-shot fallback and
the `agent: false` path stay on the shell agent; an unset variable or a failed
copy keeps the shell session runtime. Only x86_64 is accepted today.

```sh
node scripts/native-wiring-check.mjs
```

The check copies the built spike, acquires a real session runtime, runs one
EXEC and one FS stat through the native entry, and releases the scope. The
shipped default remains the shell agent; packaging/musl/default rollout is the
next stage.

## Result (2026-10-18, x86_64-unknown-linux-gnu, release)

- 17/17 checks: HELLO, PING, EXEC (exit + both streams), SETENV (later
  commands only), concurrent EXECs (the short one settles first), KILL (no
  second `wsl.exe`, no full wait), timeout (group killed promptly), the EXEC
  timeout unit (a 2 s budget does not kill a 300 ms command), output cap
  (cut and the pipe still drained), FS stat/lstat/read matching the shell
  agent, no-replace write + refusal, the missing-path side channel, FS list
  and realpath matching the shell, the dot-dot refusal, the expected-version
  replace/stale path, a setuid mode, and a shell-agent differential for EXEC.
- Release binary: ~673 KB; the crate builds in ~2 s with no dependencies.
- The shell agent remains the shipped peer. The host wiring above is opt-in;
  packaging (per-arch binaries), musl/cross-arch builds and the default
  rollout are still pending.
