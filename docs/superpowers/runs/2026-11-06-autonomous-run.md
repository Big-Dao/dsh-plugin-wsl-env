# Autonomous run log — 2026-11-06

Plan: docs/superpowers/plans/2026-11-06-autonomous-dev-test-plan.md (75cb833).
Worktree: /home/andy/Projects/dsh/plugins/wsl-env-auto-run, branch auto-run/2026-11-06.
Budget start (epoch): 1793897172. Budget: >= 4h wall clock.

| Task | Result | Commit | Gate numbers | Notes |
|---|---|---|---|---|
| T6 | done (bounded) | 3a52f77, 0849d3d | git-exec branches 77.78→89.66%, terminal-route 100/100/100; paths/wsl arms; aggregate branches 88.08→88.42% | git handle's pre-abort/no-signal/early-reader/no-delegate arms; routing's absent-cwd and bare-relative fallbacks; bare-UNC, drive-path and relative toLinuxPath arms; drive-root separator boundary; runCapture's denied/unstartable/abort hints. Skipped with cause: preflight's logger arms (bounded scope; gate already met) |
| T6 续 | done | 6753070, 10705a9 | session-runtime branches 87.88→91.89%; native-agent branches 91.67%; aggregate branches 88.42→88.52% | shell fallback construction, probe's remedy-bearing refusal, default stop's best effort; copy failure names stderr, empty cache path is undefined |
| T7 | done | 7072af7 | pnpm test 64/64; agent-fs-script 20 checks drive both publish paths through the new line | dir-entry fsync after the publish rename (REVIEW still-open 1): `sync -d` best effort, divergence 6 in PEER-PARITY, LIMITATIONS(+zh) reworded, native binary intentionally untouched |
| T8 | done | f6061c8 | bash -n, node --check, probe-runner offline green; suite 15→16 | two-distro.sh + probe mjs + overlay authored (WSL-101): auto-mode shell, sequential/concurrent/burst legs, prereq skips <2 distros. NOT RUN — needs harness closed + two distros |
| T9 | done | afd7827 | bash -n, node --check; suite 16→17 | agent-restart.sh + probe mjs + overlay authored (WSL-207): warm, pkill, recover through the one rebuild; the kill leg's own outcome accepted either way. NOT RUN — needs harness closed |
| T10+T11 | done | 83f0bff, def672a | style 9/9, links green | suite-start scratch sweep (>1 day) + probe:clean/probe:all-closed npm scripts; doctor wording records WSL-313's live-status fold-in; versionOf docstring claims stat-identity granularity (REVIEW 7) |
| T12 | done | de7db00 | links green | ROADMAP-1.0 header refreshed against 0.18.0; Files row credits the FSB batch; WSL-207 status paragraph records doctorReport's live fold-in |
| T13 | done | 90715bb | links green | online check 2026-11-06: upstream v0.2.2-rc.1 (11-04) is current; #10263 open/no response; FileReferenceTraversal in open RFC #10264; terminal-title #8769 unchanged — dated into three UPSTREAM-*.md docs |
| T14 | done | this commit | final: pnpm test 64/64; coverage lines 99.17 / branches 88.52 / funcs 95.32 | run log finalized; backlog below |

## Summary

- 16 commits on `auto-run/2026-11-06` (75cb833 plan → 10705a9), all local, none pushed.
- Wall clock: ~78 minutes for the whole queue (estimates were budget ceilings).
- Coverage: branches 84.14% → 88.52% (+4.38pp), lines 96.75% → 99.17%, functions 91.76% → 95.32%. Gate 85/84/70 — headroom +3.5pp branches.
- Development: directory-entry durability (REVIEW#1) landed in the shell agent; two acceptance probes authored (WSL-101, WSL-207); ROADMAP-1.0 refreshed against 0.18.0; upstream seams verified online.
- One process slip, self-corrected: T8 was committed once while the chain was red (a `;` vs `&&` mistake in the compound command); the type error was fixed and the commit amended within the same run. No red tree persisted.

## Backlog for the next run (verified, not done here)

- Coverage: fs-routing 83.10% (the host-plane fallback arms of patchText/deleteFile need the host machinery or a stubbed super), preflight 81.13% (logger arms: an inject-throwing agent, a failing sweep), fs-substrate 86.90% (407-408, 445-446, 451-455, 477-483), git-route 86.11%, file-reference-wsl 86.36% (177-179, 297-299), watcher 237's sibling arms. Diminishing returns: aggregate is 4.5pp over the gate.
- Real-machine probe RUNS (manual gate, harness closed): the whole suite (now 17), especially two-distro.sh and agent-restart.sh on a two-distro machine; the 2026-11-05 record's operator rules apply (`wsl --shutdown` first).
- Non-systemd real-machine legs (WSL-201/208): need a non-systemd distro and a distro-level interop change.
- Native agent's dir-fsync parity: rebuild the binary with the same `sync -d` posture when a binary build is acceptable (toolchain present; deliberately not done unattended).
- The nightly `probes` CI job / self-hosted Windows runner (ROADMAP-1.0 WSL-203): infra decisions, human-gated.

| T0 | done | — (no commit) | pnpm test 64/64 files, 0 fail; coverage lines 96.75 / branches 84.14 / funcs 91.76 | worktree + install (1.5s, shared store); baseline archived in /tmp/t0-*.log, numbers recorded here |
| T1 | done | c8e8aaa | shell-env.js branches 50→84.75%, funcs 45.45→91.67%, lines 75.61→96.10%; aggregate branches 84.14→85.19%; pnpm test 64/64 | staged fake wsl.exe answers fact probes; resident spawn fails closed. Finding: apply()'s `distros = [await defaultDistro()]` success arm is unreachable (defaultDistro reads the same `-l -q` source as listDistros — empty list always throws); recorded, not changed (behavior change is out of a coverage task's scope) |
| T2 | done | 5e964fe | index.js branches 74.03→79.48%; aggregate branches 85.19→86.12%; 66/66 provider checks; chain 64/64 | one-shot/agent decorate failure arms, SpawnError retry, per-distro shell probe success arm, probed home behind empty workdir, distroFor default fallback. Note: the runner-spawn classifier stats the caller's spawn workdir — that check uses a real host directory where a UNC reads unusable on POSIX |
| T3 | done | 3dbc98b | index.js lines 100%, branches 79.48→83.82%; aggregate branches 86.12→87.05%; 76/76 provider checks | v7 mutation wrappers, per-distro substrate/agent caches, resolve/lstat accept+refusal+mount arms, probed-home relative base, distroForPath/distroForPolicy fallbacks, host-root writable roots. Finding: V8 reports `try { … return await … }` blocks as count=0 even when they demonstrably execute — async-try coverage artifact; the real remaining arms (mount road, distro fallback) are covered |
| T4 | done | b8cdddc | fsio-agent.js lines 100%, branches 76.54→83.82%; aggregate branches 87.05→87.65%; 43 fsio-agent checks; chain 64/64 | non-batch read road (frame stat, chunk loop, loop-overflow TOO_LARGE behind the stat gate), batch road's non-notfound refusal + full-chunk continuation + missing stat record, listChildren's five record shapes, fail's structured-reason arms, readTextForDiff's catch degrade. Finding: readWholeBytes gates on the stat record's size first — the loop's overflow arm only fires when the file grows mid-read |
| T5 | done | d1bbb4d | watcher.js lines 100%, branches 92.86%; agent-shared.js lines 100%, branches 81.82%, funcs 100%; aggregate branches 87.65→88.08%, funcs 94.92% | watcher's stderr-tail and close-waits-for-exit arms via a scripted child; the shared agent's native prepare armed by a fake wsl.exe that answers uname and runs the cache install locally with HOME in a scratch dir |
