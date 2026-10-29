# Roadmap 1.0: the WSL plugin the DSH ecosystem should have

Status: working plan, last refreshed 2026-10-30 against `0.15.0`.
The 0.12.0 baseline that motivated the plan is kept below as history.
Audience: maintainers and contributors. This is a plan, not a release promise.
The short version: **from "the only WSL plugin" to "the default WSL plugin"** —
first run works, every distro and workspace is served by its own environment,
every DSH surface has a story, and every claim has a test or a probe.

## 0. 核心价值（需求裁决标准）

本插件只做两件事，其余一切都是为这两件事服务的适配：

1. **原生 Linux 工具链，LLM 生成的质量更高。** 模型在正确的生态里生成与执行——bash 而非 PowerShell、GNU 工具链、项目真实的构建系统。凡能让 distro 内工具链更完整、对模型更可见的，直接服务此价值（doctor 工具链检查、bootstrap-import、六发行版矩阵）。
2. **避开 Windows 与 WSL 的跨环境文件操作，大幅提升性能。** 每一次跨 9p/UNC 边界的文件操作都是性能税。凡消除或减少跨界往返的，直接服务此价值（picker 的 agent 化、#31 批量读、workspace-changes 的 git 经 `ctx.subprocess` 在 distro 内原生运行——已与上游实现对账）。

任何新提案先用这两条裁决：不服务者不进路线图。

## 1. What "must-have" means

"Best" is not "most features". It is five acceptance lines:

1. **Five-minute first run.** On a clean Windows 11 + WSL 2 + Ubuntu machine,
   the first command runs in the right directory, in the right distro, under
   the sandbox, within five minutes (p50; p90 within fifteen).
2. **Any distro, any workspace.** Opening a folder in distro A runs in distro A
   even when distro B is the WSL default; two distros can run concurrently
   without crossing streams.
3. **Full surface coverage.** Shell, files, search, git, terminal, picker, GUI
   previews, ports and `@` references do not fall back to 9p for a WSL
   workspace. Where an upstream seam is missing, the gap is named and measured.
4. **Explainable failure.** Every refusal has a code and a remedy; no silent
   wrong-tree execution and no fail-open.
5. **Sustainable.** Every public promise is covered by a unit test or a
   real-machine probe; aarch64 is executed, not only built; documentation has
   no known stale claim.

North-star metrics:

| Metric | Target |
|---|---|
| Tier 1 first-run success | >= 95% |
| Time to first successful WSL command | p50 <= 5 min, p90 <= 15 min |
| Real-machine probe suite | 100% on Tier 1, nightly |
| Known documentation drift | 0 |

## 2. Where 0.15.0 stands

> WSL-101 landed on 2026-10-19: the distro follows the workspace and the
> per-distro caches are in place. 0.15.0 (2026-10-27) shipped the compatibility
> matrix, container legs, qemu aarch64, doctor, preset helper, and
> `interopVisibility`. The table that *motivated* the plan is frozen as the
> 0.12.0 baseline; the 0.15.0 row is what a reader should act on.

### 0.15.0 (current)

| Area | Strong today | Remaining gap |
|---|---|---|
| Execution | Native agent default; systemd session scope; `distro: auto` coordinate routing; concurrent distros | Physical aarch64 WSL (out of scope); non-systemd real-machine session probe unrun |
| Files | ext4 substrate, root-plane `fs-routing` in unit+coverage, kernel-enforced confined writes | GUI previews still extra agent round trips (measured, deferred); `@` completion still 9p until the upstream seam |
| Sandbox | `bubblewrap`, fail-closed, `enforcement: partial`, `interopVisibility` / `maskWindowsDrive` | Interop is not closable from a plugin key; distro `[interop] enabled=false` remains the full closure |
| Onboarding | `doctor`, `bootstrap` / `bootstrap-import`, session preflight, `profile-preset` helper | Clean-machine first-run timing still unmeasured; session UI has no toast seam |
| Configuration | Every shipped key documented; nested `preset-wsl` rows edited through the helper | An id patch of `wsl-shell` / `wsl-fs` still only warns |
| Quality | Unit files including `fs-routing`; coverage 85/84/70; qemu aarch64 18-check; five-family container agent; COMPATIBILITY.md | Nightly `probes` job is GitHub-hosted `windows-latest` (skips without WSL); physical aarch64 out of scope |
| Ecosystem | npm package, bundle patch, bilingual locale, issue templates | Upstream seams remain: `ensureSession` monkey patch, argv-shape search interception, missing `FileReferenceTraversal` |

### 0.12.0 baseline (historical)

| Area | Strong then | Gap that motivated the plan |
|---|---|---|
| Execution | Native agent is the default; systemd session scope; background processes survive | Distro pinned by configuration; non-default workspace hit the cross-distro guard |
| Files | ext4 substrate, root-plane `fs-routing`, kernel-enforced confined writes | GUI extra round trips; `@` completion through 9p |
| Sandbox | `bubblewrap`, fail-closed, honest `enforcement: partial`, `maskWindowsDrive` | systemd and Linger unchecked by diagnose/bootstrap |
| Onboarding | `bootstrap`, `diagnose`, session-start preflight | No single doctor; preflight only probed bwrap; preset override trap |
| Configuration | Every shipped key documented | Nested `preset-wsl` rows; an id patch warned and changed nothing |
| Quality | 33 unit-test files, 12 real-machine probes, build/type/coverage gates | Probes manual; aarch64 build-only; `fs-routing` outside `test:unit` / `test:coverage` |
| Ecosystem | npm package, bundle patch, bilingual locale | Fragile upstream seams (same three as today) |

The remaining gap after 0.15.0 is **upstream seams, honest probe collection,
and 1.0 empirical legs** (clean-machine timing, 30 days without a P0) — not
the 0.12.0 productization list.

## 3. Design principles

1. **Coordinate routing over per-profile pinning.** A path already names its
   distro. The environment should follow that coordinate; an explicit pin
   remains an override, not the default mental model.
2. **Explicit over implicit, but not silent.** A fallback must be reported in
   the result. A failure must name the remedy. Never turn an unsupported case
   into a wrong-tree success.
3. **No new service, no listening port.** The resident agent remains a
   transport, not a daemon. Uninstall must stay "remove the cache".
4. **Measure before optimizing.** v6 FS concurrency and speculative caches wait
   for a measured consumer. The A6/A7 numbers are the model: fix the measured
   bottleneck, not the imagined one.
5. **Upstream-ready, not upstream-dependent.** The plugin must remain fully
   usable if upstream never accepts a seam. Promotion work is packaging and
   proof, not a blocking dependency.
6. **Every promise has a test or a probe.** A behavior that cannot be verified
   is either documented as an explicit boundary or not shipped.

## 4. Workstreams

| Workstream | Question it answers |
|---|---|
| **A. Zero-friction onboarding** | Can a new user get from install to a working command without reading the whole manual? |
| **B. Coordinate-correct multi-distro** | Does the environment follow the workspace, including multiple distros at once? |
| **C. Full-surface coverage** | Do all DSH consumers of a WSL workspace stay inside the distro? |
| **D. Trust, performance, reliability** | When something breaks, is it visible, recoverable and fast enough? |
| **E. Ecosystem presence** | Is this the obvious, documented, supportable choice in the DSH ecosystem? |

## 5. Phases

### P0 — make "it works" true (0-4 weeks)

| ID | Outcome | Acceptance gate | Size |
|---|---|---|---|
| P0.1 | `distro: auto` coordinate routing across shell, fs, terminal, shell-env and the session runtime | Default Ubuntu + Debian workspace runs in Debian; two distro sessions concurrent; explicit pin still wins; cross-distro paths still refuse | L |
| P0.2 | One `doctor`/`setup` path covering bwrap, systemd, Linger, optional tools, peers and config | Clean Win11 + Ubuntu passes in five minutes; missing bwrap, non-systemd, stopped distro and wrong peer each produce a copy-paste remedy | M |
| P0.3 | Safe `preset-wsl` override helper and validation | Changing `sessionSandbox` or `distro` works in one step; an invalid nested patch fails loudly instead of warning | M |
| P0.4 | Documentation and gate hygiene | The three known drifts are fixed; `fs-routing` enters the test lists; `probe:fs-routing` exists; links resolve | S |
| P0.5 | Preflight visible before the first command | A missing bwrap or systemd/Linger is visible in the session UI, not only in `logger.warn` | M |

P0 is not a performance phase. It is the difference between "the plugin is
correct once configured" and "the plugin is correct on first contact".

### P1 — make "every day" complete (1-3 months)

| ID | Outcome | Acceptance gate | Size |
|---|---|---|---|
| P1.1 | `sessionSandbox: auto` for distros without systemd | Non-systemd distro runs the first command under per-command bwrap and reports the narrower scope; explicit `true` still refuses | M |
| P1.2 | Compatibility matrix and real validation | Tier 1 (Ubuntu/Debian, systemd, x86_64) green; aarch64 spike runs under qemu; Tier 2 status documented | L |
| P1.3 | Install/upgrade/uninstall E2E | Temporary `DSH_HOME`, packed tarball, `dsh plugin add`, `--dump-config`, remove; upgrade from the previous minor | M |
| P1.4 | `@` references seam | Measure the 9p cost; land the upstream `FileReferenceTraversal` seam or a declared, tested fallback | L |
| P1.5 | LSP provider spike | A documented plan and prototype for `ctx.lsp` over fs + subprocess, conditional on the desktop composition mounting LSP | M |
| P1.6 | GUI preview performance | Baseline measured; p95 <= 1s/MiB for a representative page; v6 only if the measurement justifies it | M |
| P1.7 | Agent recovery and status | In-flight death recovers within 2s or fails with a named state; `doctor`/status shows agent and scope health | M |
| P1.8 | Security posture | Strict preset documented and probed; interop visibility/mask matrix; no claim beyond `partial` | S |
| P1.9 | Peer upgrade canary | A scheduled check against the latest DSH line reports breakage before users do | S |

### P2 — make it the ecosystem default (3-6 months)

| ID | Outcome | Acceptance gate | Size |
|---|---|---|---|
| P2.1 | Upstream promotion pack | Package layout, real-composition boot test, RFCs and PR-ready seams; the plugin still works if none land | L |
| P2.2 | Discoverability | A docs site or one-page entry, compatibility page, demo, recipes; marketplace directory if DSH has one | M |
| P2.3 | Community and support | Feature-request and setup-report templates, public roadmap, predictable release cadence, triage target | S |
| P2.4 | 1.0 readiness | Config schema frozen, migration/deprecation policy, Tier 1 green, aarch64 executed, no P0 bugs for 30 days | M |

## 6. Ninety-day sequence

| Week | Focus | Output |
|---|---|---|
| 1-2 | Baseline and hygiene | Ten clean-machine timings; P0.4; doctor specification |
| 3-6 | Multi-distro | P0.1 implementation, unit tests, two-distro probe, migration note |
| 7-8 | First-run loop | P0.2, P0.3, P0.5 |
| 9-10 | Compatibility and proof | P1.2, P1.3, nightly probe runner |
| 11-12 | Surface and performance | P1.4/P1.5 spike, P1.6 baseline, P1.7 fault injection |
| 13+ | Ecosystem and 1.0 | P2.1-P2.4, release gates |

The sequence assumes one maintainer-equivalent. P0 is not cuttable; P1 items
may move if the compatibility matrix exposes a higher-severity failure.

## 7. Metrics

| Metric | Current | Target | How measured |
|---|---|---|---|
| Time to first command | Not systematically measured | p50 <= 5 min, p90 <= 15 min | Ten clean-machine runs |
| Tier 1 first-run success | Not measured | >= 95% | Compatibility matrix |
| Real-machine probes | 14; nightly job on hosted `windows-latest` skips without WSL | 100% on a Windows+WSL runner | Dispatch or a self-hosted runner that actually has WSL |
| FS single-op p95 | ~22ms host round trip | <= 30ms | `fs-queue.mjs` |
| 16 concurrent reads p95 | 2.4-8.2ms | <= 20ms | `fs-queue.mjs` |
| GUI preview p95 | Backend 63.5 ms/MiB (service round trips on top) | <= 1s/MiB | `probe:gui-preview` |
| Agent recovery | One rebuild | < 2s | Fault injection |
| Documentation drift | Closed 2026-10-30 (aarch64 qemu, 0.15 baseline, WSL-202 boxes) | 0 | Release checklist |
| Release cadence | Ad hoc | Every 2-4 weeks | Calendar |
| Adoption (lagging) | Not established | +50% per quarter | npm download stats |

No default telemetry. Facts come from `doctor --json`, issue templates and
probe reports.

## 8. Risks, non-goals and decision rules

| Risk | Mitigation |
|---|---|
| Upstream never lands a seam | Keep the plugin independent; promotion work is packaging and proof, not a dependency |
| Multi-distro refactor destabilizes routing | Introduce `distro: auto` behind tests; keep explicit pins; run two-distro probes before release |
| `sessionSandbox: auto` hides a semantic change | Still use bwrap; report the scope mode in the result; explicit `true` keeps the strict behavior |
| Real-machine CI is unavailable | Self-hosted Windows nightly; qemu for the aarch64 binary; manual suite before release |
| Solo maintenance and bus factor | Freeze scope for 1.0; document every seam; keep the issue templates and probes current |
| Security overclaim | Keep `enforcement: partial`; the strict preset narrows, never closes, the interop hole |
| GUI regression repeats | Never replace the shipped `workspace-files` row again; only route and optimize |

**Non-goals:** WSL 1, macOS/Linux hosts, a bundled daemon or listening port,
full isolation from Windows interop, uniform support for every distro, an
editor/LSP rewrite without an upstream seam, and default telemetry.

**Decision rules:**

- A P1 item moves only with a measured need or a concrete consumer.
- A compatibility claim enters the matrix only with a test or a probe.
- A security statement never exceeds what the sandbox actually enforces.
- A release does not ship without the P0 gates; a native change also needs the
  aarch64 spike.

## 9. Issue-ready breakdown

The blocks below were filed as GitHub issues #5-#22 on 2026-10-19. The
acceptance list in each issue is the contract; filter by priority:
[P0](https://github.com/Big-Dao/dsh-plugin-wsl-env/issues?q=is%3Aissue+label%3Apriority%3AP0),
[P1](https://github.com/Big-Dao/dsh-plugin-wsl-env/issues?q=is%3Aissue+label%3Apriority%3AP1),
[P2](https://github.com/Big-Dao/dsh-plugin-wsl-env/issues?q=is%3Aissue+label%3Apriority%3AP2).

### WSL-101 — Multi-distro coordinate routing

**Status:** implemented in the working tree (2026-10-19); unit-covered, with the
real-machine two-distro probe still to run.

**Priority:** P0 · **Size:** L · **Labels:** `area:multi-distro`,
`type:feature`, `priority:P0`

**Why:** The picker lists every distro, but the preset pins one. A workspace in
another distro is refused instead of served.

**Acceptance:**

- [ ] `distro: "auto"` resolves the distro from the workspace UNC; an explicit
      name still pins; `"default"` forces the WSL default.
- [ ] `wsl-shell`, `wsl-fs`, `fs-routing`, `subprocess-wsl` and `shell-env`
      all follow the same coordinate rule.
- [ ] The shared agent and session runtime are keyed by distro; two distros run
      concurrently.
- [ ] A workspace in its own distro never raises `FS_OUTSIDE_DISTRO`; another
      distro's path still does.
- [ ] Migration note documents the `""`/`auto`/`default` semantics.

**Tests/probes:** unit tests for the resolver; two-distro real-machine probe;
cross-distro refusal leg; composition test through the service proxy.

**Depends on:** none.

### WSL-102 — Doctor and one-command setup

**Status:** implemented (2026-10-19): [`scripts/doctor.mjs`](../scripts/doctor.mjs)
is the one-command check, exposed as `pnpm run doctor`; `diagnose` is its
read-only alias (`--read-only` refuses `--fix`/`--install`). The unit suite runs
the doctor as a subprocess against a fake `wsl.exe`/`cmd.exe` on PATH: a healthy
machine, missing bubblewrap, no systemd, a stopped distro and stale scopes are
each asserted end to end. The clean-machine five-minute stopwatch has not been
run (this machine has one, already-configured distro); it stays on the release
checklist.

**Priority:** P0 · **Size:** M · **Labels:** `area:onboarding`,
`type:feature`, `priority:P0`

**Why:** The default path has two prerequisites (bwrap, systemd/Linger) and the
current diagnostics do not cover the second.

**Acceptance:**

- [x] One command reports Windows/WSL versions, distro, shell, bwrap
      usability, systemd PID 1, `systemd-run`, Linger, rg/git/inotifywait,
      peer version, agent cache and stale scopes.
- [x] Human-readable output and `--json`; each failure includes one
      copy-paste remedy.
- [x] `--fix` performs only safe actions; package installation requires
      explicit confirmation and never runs silently.
- [x] Missing bwrap, non-systemd, stopped distro and wrong peer are each
      classified (fake-`wsl.exe` tests).
- [ ] Clean Win11 + Ubuntu first run is <= 5 minutes (release checklist; not
      run on this single configured machine).

**Tests/probes:** process-level tests against fake `wsl.exe` outputs
([`test/doctor.test.mjs`](../test/doctor.test.mjs)); real-machine run on the
Tier 1 image; `diagnose` remains a read-only alias.

**Depends on:** none.

### WSL-103 — Preset override guardrail

**Priority:** P0 · **Size:** M · **Labels:** `area:configuration`,
`type:feature`, `priority:P0`

**Status:** implemented (2026-10-19): [`scripts/profile-preset.mjs`](../scripts/profile-preset.mjs)
(`pnpm run preset`) prints the complete `preset-wsl` row, applies `--distro`,
`--session-sandbox`, `--sandbox`, `--mask-windows-drive` and `--agent-backend`,
and writes a profile layer with `--out`. `--check` fails on a top-level
`- id: wsl-shell`/`wsl-fs` entry and prints the exact block to paste. The unit
suite compares the printed block byte-for-byte with the shipped row the app
loads and exercises every CLI path.

**Why:** `wsl-shell` and `wsl-fs` are nested inside `preset-wsl`; an id patch
logs a warning and does nothing, which is the worst kind of configuration
failure.

**Acceptance:**

- [x] A helper prints the complete, copy-paste `preset-wsl` block for the
      installed version.
- [x] The helper can apply a small set of common edits (`distro`,
      `sessionSandbox`, `sandbox`, `maskWindowsDrive`, `agentBackend`).
- [x] An invalid nested patch fails with a message that includes the exact
      block to paste; no silent no-op.
- [x] The helper is covered by a unit test and documented in CONFIGURATION.

**Tests/probes:** generated YAML compared byte-for-byte against the shipped
block (the row the real composition loads); the CLI's print/write/check paths
run in [`test/profile-preset.test.mjs`](../test/profile-preset.test.mjs).

**Depends on:** none.

### WSL-104 — Documentation and gate hygiene

**Status:** implemented (2026-10-19): the three drifts are fixed, `fs-routing`
and `distro-route` are in both test lists, `scripts/check-links.mjs` gates
relative links from `pnpm test`, and `probe:fs-routing` is written and wired
into the real-machine suite. The routing probe has not been executed yet (it
needs the app closed); its first run stays on the release checklist.

**Priority:** P0 · **Size:** S · **Labels:** `area:docs`, `area:quality`,
`priority:P0`

**Why:** Three user-visible claims are stale, and `fs-routing` is outside the
test lists despite the repository's own rule.

**Acceptance:**

- [x] `VALUE.zh` no longer says watch is polling-only; `PARITY` no longer says
      "a poll, not inotify"; the `cordis.patch.yml` substrate comment no
      longer calls `share` an opt-out.
- [x] `test/fs-routing.test.mjs` is in `test:unit` and `test:coverage`.
- [x] A `probe:fs-routing` exists and is wired into the real-machine suite
      (first execution pending: the suite needs the app closed).
- [x] Markdown links resolve (`scripts/check-links.mjs`, in `pnpm test`);
      version references in the roadmap/docs are checked at release time.

**Tests/probes:** `pnpm test`, `pnpm run test:coverage`, `probe:fs-routing`.

**Depends on:** none.

### WSL-105 — Visible preflight and systemd/Linger coverage

**Priority:** P0 · **Size:** M · **Labels:** `area:onboarding`,
`area:sandbox`, `priority:P0`

**Status:** implemented (2026-10-19): `wsl-preflight` runs the shared
session-runtime probe after the bwrap probe and warns with the existing
remedy for `no-systemd`, `no-user-manager`, `no-systemd-run` and `no-linger`
(`sessionSandbox: false` on the row skips the session half). The advisory is
logged **and** published as a session-scoped `wsl-preflight` runtime-context
entry, so it is visible in the session transcript rather than only in the app
log. DSH 0.2.1 has no toast/banner seam; the exact ask is written up (not yet
filed — no issue channel here) in
[UPSTREAM-SESSION-NOTICE.md](UPSTREAM-SESSION-NOTICE.md), and
[LIMITATIONS.md](LIMITATIONS.md#session-start-advisories) records the boundary.
Unit coverage drives every probe verdict through a fake `wsl.exe`; the
real-machine missing-bwrap and non-systemd legs are still manual.

**Why:** The session-start preflight currently only probes bwrap and writes to
`logger.warn`; the other default prerequisite is discovered at the first
command.

**Acceptance:**

- [x] The preflight checks bwrap, systemd PID 1, `systemd-run` and Linger.
- [x] The warning is visibly attached to the session through the
      runtime-context entry (not only logs).
- [ ] A GUI notice/banner renders it: filed upstream as
      [#10263](https://github.com/deepseek-ai/deepseek-harness/discussions/10263);
      until a seam lands, the advisory stays in the log and runtime context.
- [x] The warning never installs anything and never changes fail-closed
      behavior.
- [x] A session with a usable environment produces no warning.

**Tests/probes:** preflight unit tests with fake probe output (every verdict);
real-machine missing-bwrap and non-systemd sessions.

**Depends on:** WSL-102 for the shared probe logic; UI seam may be upstream.

### WSL-201 — `sessionSandbox: auto`

**Priority:** P1 · **Size:** M · **Labels:** `area:sandbox`,
`type:feature`, `priority:P1`

**Status:** implemented (2026-10-19): `sessionSandbox` accepts `true`, `false`
or `"auto"` on both `wsl-shell` and `wsl-fs`. `auto` probes the session runtime
and, when the platform cannot host it, falls back to the per-command `bwrap`
profile — still confined — and the command result reports
`sessionScope: "session" | "per-command"`. A failed `auto` verdict is re-probed
at most once a minute, so following the remedy upgrades without a restart.
`true` still refuses with the preflight remedy; `false` is unchanged. Unit
tests cover auto-usable, auto-fallback (shell and fs) and the `true` refusal;
the non-systemd real-machine leg has not been run (this machine has systemd and
only one distro).

**Why:** systemd is a hard default prerequisite. A distro without it should
still get a safe, sandboxed first command instead of a refusal.

**Acceptance:**

- [x] `sessionSandbox: auto` uses the scope when systemd and Linger are
      available, otherwise falls back to per-command bwrap and reports the
      narrower scope.
- [x] `true` still refuses with the existing remedy; `false` is unchanged.
- [x] The result exposes whether the scope was active (`sessionScope`);
      CONFIGURATION explains the `/tmp` and background-process difference.
- [x] The fallback never runs unconfined.

**Tests/probes:** `test/provider.test.mjs` (auto-usable, auto-fallback for the
shell and the filesystem, the `true` refusal); a non-systemd distro real-machine
probe remains unrun (no non-systemd distro here).

**Depends on:** WSL-102, WSL-105.

### WSL-202 — Compatibility matrix and aarch64

**Priority:** P1 · **Size:** L · **Labels:** `area:compatibility`,
`area:quality`, `priority:P1`

**Status:** implemented (0.15.0 / 2026-10-27) except the scope decisions in
[COMPATIBILITY.md](COMPATIBILITY.md#scope-decisions): physical aarch64 WSL and
a separate Windows 10 matrix are out of scope; the non-systemd real WSL
terminal-session legs remain unrun (Alpine is covered for the in-distro
suite and `sessionSandbox: auto`).

**Why:** The support matrix used to be prose, and the aarch64 binary was built
but never executed.

**Acceptance:**

- [x] Tier 1 and Tier 2 are defined and tested on x86_64 WSL2 / Windows 11:
      Ubuntu, Debian stable, Fedora, Arch, Alpine (musl), openSUSE; systemd
      and non-systemd (Alpine). Evidence: [COMPATIBILITY.md](COMPATIBILITY.md).
- [x] The native 18-check suite runs for aarch64 under qemu in CI (built
      artifact and committed `linux-aarch64` binary).
- [x] The shell agent runs in Linux containers for the non-Ubuntu families
      (`agent-containers` job, 35/35).
- [x] The support table states "supported", "partial" and "unsupported" with
      evidence (COMPATIBILITY.md). Physical aarch64 and Windows 10 are
      documented as out of scope rather than untested claims.

**Tests/probes:** container matrix, qemu spike, COMPATIBILITY.md; nightly
`probes` job is GitHub-hosted `windows-latest` and skips without WSL.

**Depends on:** WSL-201 for non-systemd; WSL-203 for packaging.

### WSL-203 — Install/upgrade/uninstall E2E

**Priority:** P1 · **Size:** M · **Labels:** `area:release`,
`area:quality`, `priority:P1`

**Status:** implemented (2026-10-19): [`test/e2e/install.sh`](../test/e2e/install.sh)
(`pnpm run e2e:install`) packs the tree, creates a fresh `DSH_HOME` under
`%TEMP%`, initializes a profile from the shipped `web` template, installs the
tarball, asserts `--dump-config` composes the plugin rows with no skipped-patch
warnings, removes it and asserts every row is gone. With network it also
installs the previous minor (0.11.0), plants a marker in the profile layer,
upgrades to the packed version, and asserts the marker survives, the installed
version is current, and the installed CHANGELOG carries the migration note.
The run passed 10/10 on this machine (the app may stay running: plugin
management is local). [`test/packaging.test.mjs`](../test/packaging.test.mjs)
guards the packed file list in `pnpm test`. A self-hosted Windows runner job is
still unconfigured; the local command is the documented path.

**Why:** The install path is manual and has no automated guard; an upgrade can
silently leave an obsolete workaround behind.

**Acceptance:**

- [x] A script creates a temporary `DSH_HOME`, installs a packed tarball,
      checks `--dump-config`, removes the plugin and asserts cleanup.
- [x] Upgrading from the previous minor preserves the profile and prints the
      migration note (asserted against the installed CHANGELOG).
- [x] The E2E runs via a documented local command (`pnpm run e2e:install`);
      the self-hosted runner job remains to be wired.

**Tests/probes:** bash E2E (`test/e2e/install.sh`), packaging test
(`test/packaging.test.mjs`), release checklist.

**Depends on:** none.

### WSL-204 — `@` references seam

**Priority:** P1 · **Size:** L · **Labels:** `area:file-reference`,
`type:feature`, `priority:P1`

**Status:** measured and deferred (2026-10-19):
[UPSTREAM-FILE-REFERENCE-SEAM.md](UPSTREAM-FILE-REFERENCE-SEAM.md) records the
cost (20 dirs / 520 files: 9p walk median 84.7 ms vs ext4 1.5 ms, ~56×; 9p
samples 63–192 ms) measured by `pnpm run probe:file-reference`. The seam
contract (three functions, Dirent/error/coordinate semantics) is already
written in [rfc-wsl-workspaces.md](upstream/rfc-wsl-workspaces.md); the
consumer [`src/file-reference-wsl.ts`](../src/file-reference-wsl.ts) is built
and unit-tested but deliberately unwired. The fallback is to keep the 9p walk
until upstream exposes the funnel; the trigger and the follow-up probe are
recorded.

**Why:** `@` completion still walks the 9p share; the WSL traversal module is
built but unwired.

**Acceptance:**

- [x] The 9p cost is measured on a representative tree (84.7 ms vs 1.5 ms).
- [x] The upstream `FileReferenceTraversal` seam is proposed with the three
      function contract and the coordinate/error semantics.
- [x] The seam did not land, so the limitation is stated with the measured cost
      and a fallback decision (keep the 9p walk; wire on the trigger).

**Tests/probes:** `probe:file-reference` (9p-vs-ext4 walk);
`test/file-reference-wsl.test.mjs` (the consumer); no live completion probe
until the seam exists.

**Depends on:** upstream seam; no hard block for 1.0 if documented.

### WSL-205 — LSP provider spike

**Priority:** P1 · **Size:** M · **Labels:** `area:lsp`, `type:research`,
`priority:P1`

**Status:** researched and deferred (2026-10-19):
[UPSTREAM-LSP-SEAM.md](UPSTREAM-LSP-SEAM.md) records that `dsh-lsp`,
`dsh-lsp-stdio` and `dsh-tool-lsp` exist in the harness but are **not** mounted
in the `0.2.1-rc.2` base composition (verified against the app's bundled
`dsh-base/cordis.patch.yml`). The stdio provider injects `fs` + `subprocess` and
assumes one execution world; a WSL session's `ctx.fs` is the distro's while
`ctx.subprocess` is the host's, so the gap is a preset-scoped subprocess
provider plus URI/path translation. The prototype is deferred with an explicit
trigger (the composition mounts the seam, or upstream adds the provider seam).

**Why:** The desktop composition does not mount LSP today, but the WSL family
would be the natural place to provide it.

**Acceptance:**

- [x] Document whether the current DSH line mounts `ctx.lsp` and what a
      WSL-backed provider would need (paired fs + subprocess).
- [x] A prototype proves the shape or is explicitly deferred with a trigger.
- [x] No user-facing claim until the composition actually mounts it.

**Tests/probes:** composition inspection (documented in UPSTREAM-LSP-SEAM.md);
no prototype while the trigger is unmet.

**Depends on:** upstream composition; not a 1.0 blocker.

### WSL-206 — GUI preview performance

**Priority:** P1 · **Size:** M · **Labels:** `area:performance`,
`area:gui`, `priority:P1`

**Status:** implemented (2026-10-19): [`test/probe/gui-preview.sh`](../test/probe/gui-preview.sh)
(`pnpm run probe:gui-preview`) measures the three routed backend operations a
preview pays — `stat`, `listDir`, and a 1 MiB `readByteRange` — with p50/p95 and
budgets (stat 100 ms, listing 500 ms, page 1 s/MiB). Measured on this machine
(20 iterations): stat p95 2.7 ms, listDir p95 5.1 ms, 1 MiB page read p95
63.5 ms/MiB. The service's own round trips are not part of this number; they
stack on top, and the earlier "four to six" remains the qualitative shape. No
optimization is justified; the shipped `workspace-files` row is untouched, so
there is no speculative v6.

**Why:** The 0.12.0 correction restored previews at the cost of four to six
agent round trips. Correctness first, but the latency needs a measured budget.

**Acceptance:**

- [x] A probe measures listing, stat and page-read latency for a representative
      tree and a 1 MiB file.
- [x] p95 <= 1s/MiB for the page read (63.5 ms/MiB); listings within the agreed
      budget (5.1 ms).
- [x] Any optimization is justified by the probe; no speculative v6.
- [x] The shipped `workspace-files` row is not replaced again.

**Tests/probes:** `test/probe/gui-preview.sh` (new); `fs-queue.mjs` for the
agent queue; the service-level round-trip count remains qualitative.

**Depends on:** WSL-101 for per-distro routing.

### WSL-207 — Agent recovery and status

**Priority:** P1 · **Size:** M · **Labels:** `area:reliability`,
`type:feature`, `priority:P1`

**Status:** implemented (2026-10-19): a resident that spends its one rebuild
enters a bounded revival (2/4/8 s backoff, one fresh transport and one rebuild
per attempt); after three deaths the refusal is permanent and names the restart
remedy. `WslAgent.status()` exposes state, pid, lastError, deaths and pending.
`pnpm run doctor` now probes a fresh shell resident (`agent.handshake`: pid,
protocol, script digest) and still reports the agent cache and live/stale
`dsh-wsl-*.scope` counts. The live app resident's last error has no IPC channel
to the doctor, so the doctor reports its own probe failure and the app log
keeps the live last error — documented in LIMITATIONS.

**Why:** An in-flight agent death can take the filesystem substrate out until
the app restarts; users experience "everything suddenly fails".

**Acceptance:**

- [x] A failed agent is re-established on the next call with bounded backoff,
      or fails with a named state and a restart remedy.
- [x] A status/doctor view reports the agent, scope and last error (doctor:
      fresh-agent handshake + scopes + probe error; `status()`: live snapshot;
      the live resident's last error stays in the app log).
- [x] Fault injection covers in-flight EXEC, FS read and FS write.
- [x] Recovery does not replay mutation frames.

**Tests/probes:** `test/agent.test.mjs` (revival, budget exhaustion, status,
EXEC/read/write fault injection); `test/doctor.test.mjs` (handshake, digest
mismatch); a real-machine kill/restart probe is still unrun.

**Depends on:** WSL-102 for status output.

### WSL-208 — Security strict profile and interop matrix

**Priority:** P1 · **Size:** S · **Labels:** `area:security`,
`area:docs`, `priority:P1`

**Status:** implemented except the distro-disabled leg (2026-10-19):
[CONFIGURATION](../docs/CONFIGURATION.md#the-strict-profile) documents the strict
profile, its trade-offs and the visible/masked/disabled matrix;
`pnpm run probe:sandbox` now also runs the masked profile (14 expectations:
`/mnt` hidden, the Windows binary unreachable, the workspace still writable). The
visible leg's INFO still records the interop escape, and the `partial`
enforcement fact is untouched. The disabled leg (`[interop] enabled=false` +
`wsl --shutdown`) needs a distro-level change and is documented but not probed
automatically.

**Why:** The sandbox is honest about `partial`, but users need a clear "strict"
configuration and evidence for each interop state.

**Acceptance:**

- [x] A documented strict preset (`maskWindowsDrive: true`, `sandbox: true`)
      with its trade-offs.
- [x] A probe matrix covers interop visible and masked on a real machine; the
      disabled leg is documented and marked manual (needs a distro-level change).
- [x] No document claims full isolation; the `partial` fact is unchanged.
- [x] The strict preset is covered by a sandbox probe (`probe:sandbox`).

**Tests/probes:** `probe:sandbox` (visible + masked); the disabled leg is a
manual distro-level check recorded in CONFIGURATION.

**Depends on:** none.

### WSL-209 — Peer upgrade canary

**Priority:** P1 · **Size:** S · **Labels:** `area:release`,
`area:compatibility`, `priority:P1`

**Status:** implemented (2026-10-19): `.github/workflows/peer-canary.yml` runs
weekly and on demand; `scripts/peer-canary.mjs` resolves the `next` dist-tag for
every pinned peer, compares it with the pins, and (on a moved line) installs the
tagged peers into a scratch copy and runs `pnpm test` plus the composition boot
test. The summary table goes to `$GITHUB_STEP_SUMMARY` and a failed upgrade fails
the run with the delta. `SUPPORT.md` points the supported-version row at that
summary. Local `--check` on this machine resolved the line with no delta; the
workflow itself has not run in this environment (no Actions runner here), and
opening an issue on a red run was left out because the workflow has no issue
permission — the failing run plus its delta is the signal.

**Why:** The peer pins are exact; a DSH release can break the plugin before a
user reports it.

**Acceptance:**

- [x] A scheduled workflow checks the latest `@deepseek-ai/dsh-*` line,
      installs it in a scratch tree and runs `pnpm test` plus the composition
      boot test.
- [x] A failure fails the scheduled run with the exact version delta (step
      summary + failing step; no auto-filed issue).
- [x] The supported-version table is updated from the result (`SUPPORT.md`
      points at the canary summary).

**Tests/probes:** `.github/workflows/peer-canary.yml`;
`test/peer-canary.test.mjs`; composition test.

**Depends on:** none.

### WSL-301 — Upstream promotion pack

**Priority:** P2 · **Size:** L · **Labels:** `area:upstream`,
`type:research`, `priority:P2`

**Why:** The plugin is standalone, but upstream seams would remove the most
fragile parts.

**Status:** packaging plan written (2026-10-19):
[docs/upstream/promotion-pack.md](upstream/promotion-pack.md) records the
`packages/wsl/*` layout (ten capability packages plus a thin integration
package, each with its existing tests), the seam/RFC index with the current
state of each seam, what `test/composition.test.mjs` boots today and the gaps a
real-composition boot test would close, and the install proof
(`e2e:install`, CI on both platforms). The LSP pair is explicitly deferred
(`UPSTREAM-LSP-SEAM.md`), so the "RFCs/prototypes for all four seams" item is
satisfied for three and documented as deferred for LSP.

**Acceptance:**

- [x] A `packages/wsl`-shaped layout is documented, with the package-level
      test split and real-composition boot test (the current one; gaps listed).
- [x] RFCs/prototypes exist for the session environment resolver
      (promotion-map), the `FileReferenceTraversal` seam (RFC addendum ① plus the
      built consumer), the search provider (promotion-map), and the LSP pair
      (deferred note with trigger).
- [x] The plugin remains installable and green with none of them accepted
      (`e2e:install` 10/10; CI green on both platforms).

**Tests/probes:** `test/composition.test.mjs`; `test/e2e/install.sh`;
`docs/upstream/promotion-pack.md`.

**Depends on:** WSL-101, WSL-204, WSL-205.

### WSL-302 — Discoverability and docs entry

**Priority:** P2 · **Size:** M · **Labels:** `area:docs`,
`area:community`, `priority:P2`

**Status:** implemented except the visual demo (2026-10-19):
[docs/QUICKSTART.md](QUICKSTART.md) is the one-page entry (prerequisites,
install, first session, recipes for Node/Python/Rust/Go and a monorepo, an
honest Tier 1/Tier 2 table); [docs/PERFORMANCE.md](PERFORMANCE.md) is the
9p-vs-agent page with the A6/A7 numbers and the GUI-preview baseline, and
`pnpm run probe:gui-preview` / `fs-queue.mjs` reproduce the latter. No GIF or
screenshot exists yet (capturing the GUI is not something this repository has
recorded), so that acceptance item is explicitly open. No DSH plugin
marketplace was identified, so nothing was submitted.

**Why:** "Best" also means easy to find and evaluate.

**Acceptance:**

- [x] A one-page entry with a five-minute quickstart, compatibility table and
      screenshots (text only; screenshots are the open item).
- [ ] A demo or GIF showing the picker, terminal, preview and sandbox fact
      (not produced; recorded here and in QUICKSTART).
- [x] Recipes for Node, Python, Rust/Go and a monorepo; a 9p-vs-plugin
      benchmark page.
- [ ] The DSH plugin directory/marketplace is updated if one exists (none
      identified).

**Tests/probes:** `pnpm run lint:links`; the quickstart's commands are the
documented Tier 1 path, not executed by CI.

**Depends on:** WSL-102, WSL-202.

### WSL-303 — Community and support loop

**Priority:** P2 · **Size:** S · **Labels:** `area:community`,
`priority:P2`

**Status:** implemented (2026-10-19): `.github/ISSUE_TEMPLATE/` now carries a
feature-request form, a setup-report form that **requires** the `doctor --json`
output, and a chooser config (blank issues disabled; private security and
quickstart links). `SUPPORT.md` documents the public roadmap, the
three-business-day P1 triage target and the two-to-four-week release cadence;
the `good first issue` label already exists, and `CONTRIBUTING.md` lists the
usual shapes and how to claim one.

**Acceptance:**

- [x] Feature-request and setup-report issue templates; setup reports ask for
      `doctor --json`.
- [x] Public roadmap and a predictable release cadence (ROADMAP-1.0 + SUPPORT).
- [x] Triage target for P1 issues (three days, best effort).
- [x] A "good first issue" label and a contributor path for probes/docs.

**Tests/probes:** `pnpm run lint:links`; a process check in the release review.

**Depends on:** WSL-102.

### WSL-304 — 1.0 readiness

**Priority:** P2 · **Size:** M · **Labels:** `area:release`,
`priority:P2`

**Status:** policy subset implemented (2026-10-19): [MIGRATION.md](MIGRATION.md)
records the configuration freeze (new keys are minors with preserving defaults,
removals need a boot-time refusal, meaning changes need a migration note; exact
peer pins are tested by the canary), the deprecation path with the
`substrate: "share"` and `distro: ''` cases, and the release-gate table with the
manual legs marked unrun. RELEASING and SUPPORT link it. The empirical legs
(clean-machine first-run timing, 30 days without a P0) and the final `1.0.0`
release notes remain open. The Tier 1 matrix and aarch64 qemu execution
closed in 0.15.0.

**Acceptance:**

- [x] Configuration schema frozen; new keys require a minor.
- [x] Migration and deprecation policy documented.
- [x] Tier 1 matrix green and aarch64 executed under qemu (0.15.0);
      install E2E is 10/10. Physical aarch64 WSL is out of scope.
- [ ] No P0 bugs for 30 days; clean-machine first-run timing still unrun.
- [ ] `1.0.0` release notes list the supported matrix and the known
      limitations (COMPATIBILITY.md + LIMITATIONS.md are the draft).

**Tests/probes:** [MIGRATION.md](MIGRATION.md#gates-a-release-must-clear);
release gate; full probe suite.

**Depends on:** WSL-101, WSL-102, WSL-202, WSL-203.

## 10. Release gates

A release is ready when:

1. `pnpm test` and `pnpm run test:coverage` pass.
2. The real-machine suite passes on the Tier 1 image.
3. A native-agent change also passes the aarch64 spike.
4. The supported-version table and the changelog are updated.
5. No known documentation drift and no open P0 issue.

A 1.0 release additionally requires the WSL-304 checklist.

## Evidence and related documents

- Current architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Known boundaries: [LIMITATIONS.md](LIMITATIONS.md)
- Current technical roadmap: [ROADMAP.md](ROADMAP.md)
- Requirements traceability: [REQUIREMENTS.zh.md](REQUIREMENTS.zh.md)
- Upstream mapping: [upstream/promotion-map.md](upstream/promotion-map.md)
- Real-machine suite: [`test/probe/run-all-when-closed.sh`](../test/probe/run-all-when-closed.sh)
