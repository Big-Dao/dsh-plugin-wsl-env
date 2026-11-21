# Local Probe Full Automation

Date: 2026-11-21

## Goal

Make the local real-machine probe suite a one-command operation:

```bash
pnpm run probe:all-closed
```

The command launches a detached suite worker, closes the ordinary running
DeepSeek Harness app, waits until Windows reports the app gone, and runs the
complete suite with `--include-fs`.

## Scope

This design changes only the local closed-app probe launcher and its
documentation. It does not change probe classifications, individual probe
scripts, the hosted Cloud WSL Gate, or the unit/browser test suites.

## Behavior

1. `probe:all-closed` defaults to the complete 19-probe suite.
2. The foreground launcher creates one shared log and results file in
   `test/probe/.scratch`, prints their paths, and starts the suite in a
   detached distro process.
3. The detached worker checks for app processes through Windows interop.
4. The worker refuses to run if a stale probe instance is still present.
   Stale probe instances are Harness processes launched with `--profile wslfs`.
5. Ordinary Harness processes are terminated with
   `taskkill.exe /PID <pid> /T /F`.
6. The worker polls Windows process state. App closure is accepted only after a
   successful process listing with no matching app process.
7. A failed `taskkill`, unreachable `tasklist`, stale probe instance, or
   timeout aborts the suite and writes NOT-RUN evidence through the existing
   summarizer.
8. `WSL_PROBE_SKIP_WAIT=1` remains an offline/test-only bypass. It skips app
   discovery and process termination, as it does today.

## Interfaces

- Public package command:
  `pnpm run probe:all-closed`
- Public suite runner:
  `test/probe/run-all-when-closed.sh [--include-fs] [--wait-only]`
- Internal detached mode:
  `WSL_PROBE_WORKER=1`
- Shared evidence:
  `WSL_PROBE_LOG`
  `WSL_PROBE_RESULTS`

`--wait-only` preserves the previous manual-close workflow for maintainers who
explicitly choose it. The default is automatic close.

## Failure Contract

The suite remains governed by `summarize-probes.mjs`:

- 19 PASS and 0 FAIL/SKIP/NOT RUN: FULL PASS.
- Any failure or skip: nonzero and incomplete.
- Missing or unreachable app-state evidence is not converted into PASS.
- Stale probe instances are never mistaken for the app the user requested to
  close.

## Testing

Add runner tests that use fake Windows interop binaries:

- ordinary Harness process: `taskkill` is invoked and the suite starts after
  process listing becomes empty;
- stale probe instance: no `taskkill` call is made and the suite is aborted;
- unreachable `tasklist`: suite evidence is incomplete and the runner does not
  guess that the app is closed;
- package command: `probe:all-closed` selects `--include-fs`;
- detached mode: the foreground launcher prints evidence paths and invokes a
  worker, while the worker is responsible for closing and running.

## Non-goals

- Restarting the Harness app after the suite.
- Closing every Electron process or arbitrary Windows process names.
- Replacing individual probe scripts.
- Scheduling or unattended nightly execution.
