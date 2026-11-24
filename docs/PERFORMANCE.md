# Performance: ext4 agent vs the 9p share

[中文](PERFORMANCE.zh.md)

The plugin's reason to exist is not only correctness: a WSL workspace served
through the Windows 9p share is measurably slower than the same files read on
the distro's ext4 through the resident agent. This page records the measurements
and how to reproduce them; it does not extrapolate beyond them.

## The two substrates

| | 9p share (`\\wsl.localhost\...`) | This plugin |
|---|---|---|
| File I/O | host stack crosses the VM boundary per operation | resident agent serves reads/writes inside the distro, on the target's backing filesystem |
| Change feed | polling the share | inotify for unbounded directories when available, polling otherwise |
| Commands | host process | distro login shell through `wsl.exe` |

The plugin's root filesystem routes every WSL path to the distro backend
(`fs-routing`), so the GUI file tree, previews and the model's file tools all
use the agent path. The design and its trade-offs are in
[root-fs-routing.md](root-fs-routing.md); the known limits are in
[LIMITATIONS.md](LIMITATIONS.md).

## Measured numbers

Machine: Windows 11 + WSL 2, Ubuntu, x86_64, the project's development machine.
Absolute numbers are machine-dependent; the ratio and the budgets are the point.

| Scenario | 9p share | Agent (ext4) | Source |
|---|---|---|---|
| 16 concurrent shared reads, shell agent vs native agent | — | shell: 342–614 ms (queue up to 583 ms); native: **2.4–4.1 ms** after A7, first start ~70 ms once | [ADR 0002 fs queue](adr/0002-native-agent.md#fs-queue-measurement-a6-2026-10-18) |
| Single FS op (host round trip) | — | p95 ≈ 22 ms | [ROADMAP-1.0.md](ROADMAP-1.0.md#7-metrics) |
| GUI-preview backend: `stat` | — | p95 **2.7 ms** | `pnpm run probe:gui-preview` (20 iterations, 2026-10-19) |
| GUI-preview backend: listing | — | p95 **5.1 ms** | same |
| GUI-preview backend: 1 MiB page | — | p95 **63.5 ms/MiB** | same |
| Whole-file read of 1 MiB (native agent) | — | median **15.0 ms** (26.6 ms with the read window inside the batched frame) | #76, 2026-11-24 |
| Parsing one 16 MiB response frame (arriving in 64 KiB chunks) | — | **83 ms** of the host event loop (2678 ms when every chunk re-joined one growing string) | same, host side only |
| Listing a directory of 200 symlinks | — | median **6.1 ms** (136.3 ms with two round trips per link) | same |
| A 64–256 KiB stdin payload through `wsl.exe` (native agent) | — | median **18–67 ms** (114–117 ms as one write) | #86, 2026-11-24, Windows host Node |

The first three rows dated 2026-11-24 were measured on WSL 2 Ubuntu x86_64
with the native agent started directly inside the distro (no `wsl.exe` hop), as
the median of 15 runs; the numbers in parentheses are the previous code on the
same machine. They stand for three structural costs — a read payload
base64-encoded twice inside a batched frame, a whole frame re-joined and
re-scanned on every chunk, and two round trips per symlink — so what went away
is the term that grew with the square of the size, not merely a constant.

The stdin row was measured on the same machine from Node v24.17 on the Windows
host, through `wsl.exe`, as time to result. A frame above one pipe buffer
(64 KiB) written as one `write()` cost a fixed ~100 ms before the resident had
the rest of it — its own `ACK` was what arrived late — while the same binary
started directly inside the distro answered a 68 KiB payload in 14 ms. The
piece size is not the cause (the same bytes written back to back as several
pieces pay it too), nor is the reader (`cat` and a line-at-a-time reader see
68 KiB in under 5 ms); what removes the cost is a timer turn between the
pieces. Frames between 64 KiB and 512 KiB now go out in pieces; larger ones
stay one write (a 512 KiB payload: 123 ms as one write, 144 ms pieced). A
timer turn costs about 10 ms on a Windows host, so it is paid only inside the
band where the measurement says it wins.

The GUI-preview number covers the routed backend operations a preview pays.
The shipped `workspace-files` service adds its own calls on top; that service
shape stays qualitative in [LIMITATIONS.md](LIMITATIONS.md). The 1 s/MiB budget
has a wide margin, so no further optimization (the deferred v6 FS concurrency)
is justified by these measurements.

## Reproduce

Inside the distro, with the checkout:

```bash
pnpm run probe:gui-preview        # stat / listDir / 1 MiB page read, p50/p95
node test/probe/fs-queue.mjs      # the agent queue, sequential vs concurrent, with per-op latency
```

Both need WSL interop, a working distro and Node; neither boots the harness.
The queue measurement also needs systemd and a usable native binary; it prints
wall times and queue metrics but does not enforce latency budgets. It prints
one `stdin write` row per payload size; the step that row is about shows only
when the probe runs from Node on the Windows host — inside the distro the
pieces are written just the same, but one write never paid it there. The GUI-preview
probe reports p50/p95/max and fails when its budgets are exceeded.

## What is not measured

- End-to-end GUI paint time (the browser and the service's own work are out of
  scope for these probes).
- 9p numbers for large files or many small files; A6 compared shell and native
  agents, not the Windows-side 9p share.
- Physical aarch64 WSL latency (the native 18-check suite runs under qemu in
  CI; that is functional correctness, not a host-round-trip measurement).
