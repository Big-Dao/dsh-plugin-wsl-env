# Doctor real-machine run — 2026-11-07

Status: dated record of the WSL-316 closed-loop verification executed from the
WSL side (the maintainer's machine, `0.19.0` + the WSL-316 batch at
`035e2da`). Read-only doctor runs; no app involvement, so no probe-suite
closure was needed. The app-closed suite legs and the GUI-session leg remain
on the maintainer checklist (issue #35).

## Run 1 — 151 s sequential, four findings

`node scripts/doctor.mjs --json --bundle /tmp/doctor-real-bundle.json`
against nine registered distros (shipped `distro: ''` = auto → every
installed distro). Verdict `blocked`; the blockers were the finding:

1. **FSB batch records are one-based** (`OK 1|…`, `OK 2|…`): the smoke leg
   failed a *correct* substrate — the assertion (and the fake) counted from
   zero. Fixed in `035e2da`.
2. **WSL 3.x prints the default marker before the name** (`* ubuntu`); the
   parser only read the 2.x trailing star, so `distro.wsl-mode` reported
   every distro unreadable. Fixed in `035e2da`.
3. **Cross-distro honesty**: run from the ubuntu checkout, the doctor cannot
   probe another distro's agent (the script lives in ubuntu's ext4), and
   "agent exited before its HELLO" was a lie about a broken install. The
   handshake now probes the script's readability in the target first and
   reports `info` with the way out; the smoke legs skip with a story that
   matches. Fixed in `035e2da`.
4. **The A5 measurement was real**: nine independent distros cost 151 s
   sequentially. The collection now runs three distros at a time
   (`mapWithConcurrency`, input order preserved).

## Run 2 — 133 s with concurrency 3, the closed loop green where it can be

Same command at `035e2da`. Per-distro wall clocks ballooned under the
concurrent `wsl.exe` fan-out (ubuntu 10 s → 43 s), so the net gain is ~13%,
not the theoretical third — the dominant cost is per-probe `wsl.exe`
latency, which the concurrency cannot remove. Kept: bounded fan-out is the
right shape and ordered output is preserved.

Results that matter:

- **ubuntu: `ready`, blockers none, and all three smoke legs green** —
  `functional.exec` (one EXEC frame, `uname -m` answered over the round
  trip), `functional.fs` (one FSB stat+list batch, temp dir removed),
  `functional.sandbox` (a write inside the granted root ran; a write to
  `/etc` was refused by the shipped fence). This is the closed loop's
  green path, executed.
- **`distro.wsl-mode` ok on all eight reachable distros** (the marker fix).
- **The other seven distros report their true machine state**: alpine-bt,
  Alpine-Test and archlinux lack systemd (session prerequisites fail, and
  the doctor says so with the `[boot] systemd=true` remedy); Debian and
  FedoraLinux-44 lack Linger; openSUSE-Tumbleweed and debian-bt are `ready`
  with the agent legs honestly skipped (the script is not readable from this
  side). The overall verdict is `blocked` because five of the eight *are*.
- **The real-data checks answered with real facts on ubuntu**: `.wslconfig`
  parsed through cmd.exe; `/etc/wsl.conf` cross-checks matched the runtime
  (`[boot] systemd=true`, interop on, automount root `/mnt`); the disk at
  27%; the clock within 0 s; DNS resolving (an IPv6 answer, honestly
  reported); the update check reached the registry.

## What remains (maintainer checklist, issue #35)

- The app-closed probe suite (`test/probe/run-all-when-closed.sh
  --include-fs`) — needs the DSH app quit to tray-first.
- The GUI-session leg: doctor `ready` → open a real desktop session in a
  WSL workspace → first command succeeds in the right distro under the
  expected scope. Then the reverse: remove bubblewrap → doctor names the
  blocker with its remedy → restore → `ready` again.
