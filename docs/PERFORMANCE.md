# Performance: ext4 agent vs the 9p share

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
wall times and queue metrics but does not enforce latency budgets. The GUI-preview
probe reports p50/p95/max and fails when its budgets are exceeded.

## What is not measured

- End-to-end GUI paint time (the browser and the service's own work are out of
  scope for these probes).
- 9p numbers for large files or many small files; A6 compared shell and native
  agents, not the Windows-side 9p share.
- Physical aarch64 WSL latency (the native 18-check suite runs under qemu in
  CI; that is functional correctness, not a host-round-trip measurement).
