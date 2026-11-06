# Pain journal — the value-signal log

Status: living log, started 2026-11-06.
Rule: one line per incident, at the moment it happens. A pain that recurs is a
feature candidate; a pain seen once is noise. No solution proposals in the log
— solutions are decided at triage, not at capture.

## Format

```
- YYYY-MM-DD | surface (shell/fs/search/git/terminal/picker/@/GUI/install) | what happened | seconds or minutes lost | recurs? (count)
```

## Log

- 2026-11-06 | session | long agent tasks are hostage to the desktop window:
  the maintainer wants "close the UI, the agent keeps working; reopen and
  reattach". **Measured the same day (two-probe experiment):** window close
  keeps everything alive (tray-resident process, Host, distro children — a
  setsid-detached distro process survived the whole cycle); the kill lands at
  **reopen**, when the session is re-adopted: the session's managed background
  jobs take SIGTERM at reattach (17:40:58 kill vs ~17:41:00 reopen; the
  detached control kept running). Verdict: upstream session-adoption bug —
  jobs are designed to outlive turns but die at reattach, contradicting the
  app's own "running tasks will not be interrupted" promise. Owner: upstream.
  Plugin innocent (transport chain survived). | each killed task: lost work |
  recurs: every task in flight at reopen
- 2026-11-06 | @ | triage observation, not an incident: `@` completion latency
- 2026-11-06 | @ | triage observation, not an incident: `@` completion latency
  is acceptable in real use — the human scanning the candidate list dominates
  the 9p walk (84.7 ms vs 1.5 ms). Recorded as the counter-example that killed
  the "per-file watch events" and "seam push" candidates.

## Triage — the three questions

A candidate leaves this log only by answering all three, with evidence:

1. **谁在痛？** A user, the maintainer in real use, or only the roadmap's
   inferred gap? (The last one is not a pain.)
2. **痛的量级相对人的时间尺度是多少？** Seconds against a build, or against a
   keystroke? The @ triage is the model: a 56× machine ratio vanished against
   human list-scanning time.
3. **不做会怎样？** If "nothing observable", that IS the answer.

The same questions rank candidates: the one with the most human-time lost per
week wins the next feature slot. Internal quality work (refactors, coverage)
does not enter this queue — it has its own budget and never competes with a
logged pain.

## Killed / shelved candidates (with reasons, so nothing is re-litigated)

| Candidate | Date | Reason | Reopen trigger |
|---|---|---|---|
| Per-file watch events | 2026-11-06 | fs.watch callback has no payload; the only consumer stats the target once per invalidation (2.7 ms p95). Source audit, promotion-map.md §5 + appendix B | upstream adds an event payload to the fs.watch contract |
| `@` seam active upstream push | 2026-11-06 | maintainer observation: latency acceptable, human is the bottleneck (UPSTREAM-FILE-REFERENCE-SEAM.md) | a logged pain names `@`; or the canary reports the seam landed (then it is a wire-up, not a push) |
| Clean-machine first-run timing | 2026-11-06 | execution conditions absent on this machine (configured environment, single distro); measurement, not a feature | a resettable clean Windows+WSL environment, or the 1.0 release pre-gate |
