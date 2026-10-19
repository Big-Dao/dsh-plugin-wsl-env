# Performance: ext4 agent vs the 9p share

The plugin's reason to exist is not only correctness: a WSL workspace served
through the Windows 9p share is measurably slower than the same files read on
the distro's ext4 through the resident agent. This page records the measurements
and how to reproduce them; it does not extrapolate beyond them.

## The two substrates

| | 9p share (`\\wsl.localhost\...`) | This plugin |
|---|---|---|
| File I/O | host stack crosses the VM boundary per operation | resident agent serves reads/writes on ext4 inside the distro |
| Change feed | polling the share | inotify inside the distro (`watchMaxDepth: 0`) |
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
| 16 concurrent shared reads | 342–614 ms (queue up to 583 ms) | **2.4–4.1 ms** after A7, first start ~70 ms once | [ADR 0002 fs queue](adr/0002-native-agent.md#fs-queue-measurement-a6-2026-10-18) |
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

Both need a working distro and Node; neither boots the harness. The probes print
the raw samples' p50/p95/max and fail when a budget is exceeded, so a regression
is a red probe rather than a claim in prose.

## What is not measured

- End-to-end GUI paint time (the browser and the service's own work are out of
  scope for these probes).
- 9p numbers for large files or many small files beyond the A6 sample above;
  the A6 measurement is the recorded baseline, not a re-runnable benchmark.
- aarch64; the binary is built but not executed in CI.
