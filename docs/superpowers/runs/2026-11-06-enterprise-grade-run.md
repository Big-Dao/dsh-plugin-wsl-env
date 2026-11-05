# Enterprise-grade run record — 2026-11-06 (second run)

Plan: docs/superpowers/plans/2026-11-06-enterprise-grade-plan.md. Three
parallel audits (code/architecture, docs/config-surface, CI/engineering)
fed a fifteen-item queue (E1-E15); branch `auto-run/2026-11-06`, stacking
on the first run's 17 commits.

| Task | Result | Commit | Evidence |
|---|---|---|---|
| E1 CI supply chain | done | 769431b | install flag in all 5 steps; fork gate on the self-hosted legs; canary SHA-pinned + concurrency; exposure documented |
| E2/E3 package surface | done | 918439a | ./index export; FS_PATCH_MISMATCH/FS_SAME_TARGET catalogued; REQUIREMENTS header honest (packaging test drove the resolution) |
| E4 distro resolution | done | d8d6bcd | 3 copies → resolveOperationDistro; lazy-probe property documented |
| E5 dormant API | done | b7788ff | runInDistro + toLinuxPath's distro option removed; REVIEW dead-code tail closed |
| E6 error dialects | done | 87a94da | picker quoting (6 sites), native prepare prefix, checklist dialect |
| E7 type cycle | done | 85a42c0 | ResolvedTarget owns its layer; fsio⇄substrate circle gone |
| E8 one-shot split | done | abe2fce | 250 lines → prepare/stamp/settle; provider pins byte-for-byte |
| E9 shell agent hardening | done | 2115127 | every numeric frame field guarded; malformed read window = protocol refusal; honest header; divergence 7 |
| E10 module tags | done | 2a1c4fc | 38 tags name the real package |
| E11 fake consolidation | skipped | — | the 7 fakes differ by design (different response matrices); the shared part is 4 lines of staging — consolidation cost > drift-resilience gain |
| E12 docs batch | done | f807182 | zh parity (shell row, README links/rows/doctor, section order), doctor in diagnose/ARCHITECTURE, MIGRATION citations, CHANGELOG --wsl, README rows + docs/API.md, PR count 17 |
| E13 CI batch | done | b499a26 | pnpm cache on the 3 installing jobs; gate writes $GITHUB_STEP_SUMMARY; persist-credentials off everywhere; prerelease --tag next; registry verification machine-checked |
| E14 gates/hygiene | done | d0a24b6 | test-list sync gate; docs-manifest converse gate (curated exceptions named); RUN-LOG ignored; binaries binary; floors/pinning honest in 3 docs |
| E15 wrap-up | done | this commit | final gates below; backlog below |

Final gates: pnpm test 64/64 files; coverage lines 99.25 / branches 88.54 /
functions 95.57 (gate 85/84/70); style 11/11 (two new gates); links green.

Findings worth keeping:
- The packaging test settled the REQUIREMENTS manifest question empirically
  (shipped docs link into it — the header claim changed, not the manifest).
- V8's block coverage misreports async-try blocks and some direct arms; the
  raw-ranges dump against a single process is the way to verify a gap is real.
- The self-hosted runner label collision is documented with the durable fix
  (a dedicated label); the fork gate is the interim mitigation.

Backlog for the next run: agent.ts's remaining >110-line methods (track,
handleLine, constructor — same decomposition pattern as executeOneShot);
the remaining coverage arms (fs-routing's host fallbacks, preflight's
logger arms, fs-substrate, git-route, file-reference-wsl); the real-machine
probe RUNS (two-distro.sh, agent-restart.sh, suite of 17 — harness closed);
the native binary's fsync/validation parity at its next build; the npm-publish
environment's required reviewers (GitHub settings).
