# Upstream report: background jobs are killed at session re-adoption

Status: **filed upstream as
[#12433](https://github.com/deepseek-ai/deepseek-harness/discussions/12433)
(2026-11-06; General category — the repository disables issues).** Evidence
complete. Target: the DeepSeek Harness repository; #10263 is the precedent for
session-surface asks.

## Symptom

Close the desktop app window while a background job is in flight, wait, reopen:
the session's history and conversation state survive (persistence works, the
reopened page shows the same conversation), but the in-flight background job
has been killed with SIGTERM. The app's own first-hide notice promises
"正在运行的任务不会中断" — the promise is broken by the reopen, not the close.

## Evidence (2026-11-06, real machine, Windows 11 + WSL2, desktop app)

Two-probe experiment. Probe A: harness background jobs (1 Hz heartbeat
appending timestamps, plus a 150 s sleep writing a marker). Probe B: a
`setsid`-detached process inside the same WSL distro, outside the session's
managed process tree, as a control. The maintainer closed the window with the
X button (tray icon stayed — process resident), waited ~2 minutes, reopened.

| Observation | Value |
|---|---|
| Managed job lifetime | died at reattach: probe A kill at +119 s (close ≈ +5 s, reopen ≈ +120 s); probe A2 kill at 17:40:58 with reopen ≈ 17:41:00 |
| Kill detail | bare `signal: SIGTERM` — producer facts only, no kill reason recorded |
| Detached control | survived the whole close/reopen cycle, still ticking minutes later |
| Host process identity | never restarted — the WSL plugin's Host-level singleton resident agent (started 16:33:37, before all probes) is the same instance serving after reopen |
| Distro children of the app | inotify watch loop started 16:59:13 also survived both cycles |
| Session state | conversation context fully intact after reopen |

Conclusion: window close kills nothing (the tray-residency promise is kept);
the SIGTERM lands at session re-adoption, scoped to the session's managed
process tree; the Host, the plugin substrate, and unmanaged distro processes
are untouched.

## Source-level chain (dsh `v0.2.2-rc.1` line)

1. Window close is hide-only: `apps/desktop/src/main.ts` — "Closing hides: the
   page and the Host keep running, and the next show resumes the same
   document." Matches the tray observation.
2. Managed background shells die at composition teardown:
   `packages/shell/bash-local/src/index.ts` — "still-running background process
   stays managed (killed and joined at composition teardown) even across an
   executor reload", with managed-range SIGTERM→SIGKILL escalation. Matches the
   bare producer-facts kill detail.
3. The disposal path: `session/disposed` → `machine.cancel({ kind: 'disposed' })`
   → `machine.scope.dispose()` (`packages/core/agent-loop/src/index.ts`) →
   cordis scope teardown → the bash provider's managed-range kill. So a session
   scope disposal necessarily kills in-flight managed background jobs.
4. The Host did not restart (singleton evidence above), so the disposal was
   emitted by the living Host during re-admission.

## The reload signal

Design says the next show "resumes the same document". Observed otherwise: the
session's per-turn runtime metadata carried the browser time zone on every turn
before the close, and `unavailable` on every turn after the reopen — the client
did not resume the same document; it booted fresh. Combined with the collision
boundaries in `packages/core/session/src/index.ts` (`enter()` refuses to
overwrite a live store entry; resume dedupes concurrent resumes in
`packages/api/session-controller/src/agent.ts`), the intended semantics is
clearly reuse of the live session. The fresh boot instead ends up disposing the
live session scope and rebuilding it — which is what kills the jobs.

## Reproduction

1. Open a session, start a background job that runs for minutes (e.g. `sleep
   300; date > /tmp/marker`), confirm it is running.
2. Close the app window with X (tray stays).
3. Wait ~2 minutes, reopen the window, return to the same session.
4. The job reports `killed, signal: SIGTERM`; the marker is never written.
   Session history is intact, which is the contradiction: persistence was
   considered worth preserving, the work was not.

## Expected

Re-adoption reuses the live session scope (as `enter()`/resume-dedup intend);
in-flight background jobs continue across hide/reopen. Alternatively, if
disposal on fresh boot is intended, the hide notice must stop promising that
running tasks will not be interrupted.

## Notes

- The WSL plugin (dsh-plugin-wsl-env) is not involved: its transport chain and
  Host-level singletons survived, and the control process rode the same
  wsl.exe path while escaping the kill.
- Happy to test a fix or provide more instrumentation on this machine.
