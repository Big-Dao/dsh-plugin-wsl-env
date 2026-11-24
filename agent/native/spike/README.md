# Native agent spike (ADR 0002, stage 2)

This crate is a **spike**, not the shipped agent. It exists to answer two
questions with real code before any production work:

1. Can a native event loop keep one request running while another settles
   (the shell agent's serial write stall)?
2. Can `KILL` and the in-distro timeout take a request's whole process group
   without a second `wsl.exe` or `USR1`?

## Scope

Implemented: `HELLO`, `PING`, `SHUTDOWN`, `SETENV`, `EXEC`, `KILL` — v7
frames, per-request ids, `ACK`/`RES`, output caps, per-request process groups,
capability advertisement (`conc,batch`).

Also implemented: `FS` `stat`, `lstat`, `read`, `write` (mode, no-replace,
replace, expected-version re-check, staging + fsync + atomic publication),
`list`, `realpath` (including the nearest-existing-ancestor walk and the
`..`-in-missing-suffix refusal), and v7's `delete`/`move`; the `FSB` batch
frame; failed FS ops answer with the structured `FSERR|id|reason|base64`
line. Mutations (`write`, `delete`, `move`, and a batch holding one) are
serialized by `fs_lock`; reads take no lock, the `ACK` reports the dequeue
before any lock, and `EXEC`s run concurrently with all of them. A `move` on
one filesystem is a `rename`; staging directories follow the shell agent's
`.<base>.<pid>.<token>.tmpdir` and a write sweeps the ones whose creator is
gone.

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

Without `musl-tools` and `cargo-zigbuild` the toolchain's own musl objects
link the same static binaries (`link-self-contained=yes`; the aarch64 target
needs a linker that accepts its objects):

```sh
CARGO_HOME="$PWD/.cargo-home" \
CARGO_TARGET_DIR="$PWD/agent/native/spike/target" \
RUSTFLAGS="-C link-self-contained=yes" \
cargo build --release --target x86_64-unknown-linux-musl --manifest-path agent/native/spike/Cargo.toml

RUSTFLAGS="-C link-self-contained=yes -C linker=aarch64-linux-gnu-gcc" \
cargo build --release --target aarch64-unknown-linux-musl --manifest-path agent/native/spike/Cargo.toml

DSH_NATIVE_TEST_RUNNER=qemu-aarch64 node agent/native/spike/test.mjs agent/native/spike/target/aarch64-unknown-linux-musl/release/dsh-wsl-agent-spike
```

The CI `native-package` job remains the release path's producer; a locally
linked binary is functionally verified by the same suites, not
byte-identical to it.

## Hardening (2026-11-24, #74 and #78)

The suite is now 35 checks. Added, each red against the previous binary:

- a stdin payload past the pipe buffers feeds an echoing child (`cat` with
  2 MiB; 1.25 MiB deadlocked before) and a payload the child never reads
  does not hold the request — the feed runs on its own thread, after the
  output readers;
- a read-only op does not wait behind a blocked mutation — `fs_lock` is for
  mutations only, and the `ACK` precedes it;
- a listing under churn keeps answering — an entry whose `lstat` answers
  `ENOENT` is skipped;
- a timed-out command gets the cancel path's TERM grace to clean up (the
  deadline used to `KILL` after 100 ms);
- a move on one filesystem is a rename — the same inode, nothing staged —
  the no-replace guard is `renameat2(RENAME_NOREPLACE)`, and across
  filesystems the copy is the move;
- a write sweeps the staging directories of dead creators only — the name
  is the shell agent's `.<base>.<pid>.<token>.tmpdir`, so either agent's
  sweep recognises the other's leftovers; a live creator's, another
  target's, and a look-alike directory are kept.

The "cancelled queued write" check now queues its write behind a batch that
holds a mutation, since a read no longer holds the lock it used to wait on.

## Host wiring (default for the session runtime)

`wsl-shell.agentBackend: auto` (the shipped default) selects the native agent
when a verified source exists; `native` requires it; `shell` forces the shell
agent. The source is the packaged static-musl binary at
`agent/native/linux-<arch>/dsh-wsl-agent` (x86_64 and aarch64; one static binary
runs on glibc and musl distros), or the `DSH_WSL_AGENT_NATIVE` development
override. The host
reads the binary for the distro's `uname -m`, sha256s it, copies it into
`~/.cache/dsh-wsl/agent/<sha>/`, verifies the digest, and executes it once under
`</dev/null` to catch a libc mismatch before selecting it. The host sha256s the file, checks the distro architecture,
streams it into `~/.cache/dsh-wsl/agent/<sha>/dsh-wsl-agent` (never executes
from `/mnt/c`), verifies the distro-side digest, and hands the Linux path to
the session-runtime factory. The factory spawns the binary instead of
`sh wsl-agent.sh`, with USR1 disabled (the native reads KILL frames). The
native's HELLO carries the sha256 of `/proc/self/exe`, and the host passes the
digest it copied as `expectedDigest`, so a swapped binary fails the handshake.

The shared per-distro agent (unconfined FS reads), the one-shot fallback and
the `agent: false` path stay on the shell agent; an unset variable or a failed
copy keeps the shell session runtime. Only x86_64 is accepted today.

```sh
node scripts/native-wiring-check.mjs
```

The check copies the built spike, acquires a real session runtime, runs one
EXEC and one FS stat through the native entry, and releases the scope. The
native agent is the default session-runtime backend; the shell agent is the
fallback and `agentBackend: shell` forces it.

## Result (2026-10-18, x86_64-unknown-linux-gnu, release)

- 18/18 checks: HELLO (including the binary's sha256 digest), PING, EXEC (exit + both streams), SETENV (later
  commands only), concurrent EXECs (the short one settles first), KILL (no
  second `wsl.exe`, no full wait), timeout (group killed promptly), the EXEC
  timeout unit (a 2 s budget does not kill a 300 ms command), output cap
  (cut and the pipe still drained), FS stat/lstat/read matching the shell
  agent, no-replace write + refusal, the missing-path side channel, FS list
  and realpath matching the shell, the dot-dot refusal, the expected-version
  replace/stale path, a setuid mode, and a shell-agent differential for EXEC.
- Release binaries: static musl, ~621 KB (x86_64) and ~523 KB (aarch64);
  the crate builds in ~2 s with no dependencies.
- The shell agent remains the shipped peer and the fallback. The packaged
  static-musl x86_64/aarch64 binaries are the default; both are executed in
  CI — the aarch64 binary runs the full 18-check suite under qemu-user
  (user-mode emulation suffices: the static musl binary and the v5 frames are
  host-OS-free, and `/proc/self/exe` resolves to the target under qemu, so the
  HELLO digest binding holds). Real aarch64 hardware is out of scope by
  decision (2026-10-27) — qemu is the verification boundary — and v6 (FS
  concurrency/ERR frames) is future work.
