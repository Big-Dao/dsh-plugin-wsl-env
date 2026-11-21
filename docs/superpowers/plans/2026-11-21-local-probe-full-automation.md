# Local Probe Full Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm run probe:all-closed` detach a complete 19-probe run, close ordinary local Harness processes, and produce fail-loud evidence without a manual app quit.

**Architecture:** Keep process detection and suite execution in `test/probe/run-all-when-closed.sh`; add a foreground/detached launcher split, reuse the existing result summarizer, and change only the package probe entry and bilingual documentation.

**Tech Stack:** Bash, PowerShell/WSL interop, `taskkill.exe`, `tasklist.exe`, Node probe summarizer, Node test runner.

## Global Constraints

- Use the existing `test/probe/run-all-when-closed.sh` as the only suite runner.
- `pnpm run probe:all-closed` must default to `--include-fs`.
- Ordinary Harness processes close automatically; stale `--profile wslfs` probe processes abort the run instead of being killed.
- `WSL_PROBE_SKIP_WAIT=1` remains the test/offline bypass.
- Failure, skip, stale state, and missing evidence remain distinct and nonpassing.
- Keep the existing 19-probe suite and `summarize-probes.mjs` contract.

---

### Task 1: Add the failing auto-close runner test

**Files:**
- Modify: `test/probe-runner.test.mjs:347-408`
- Test: `test/probe-runner.test.mjs`

**Interfaces:**
- Consumes fake `tasklist.exe`, `taskkill.exe`, and `powershell.exe` commands.
- Produces the test assertion that ordinary app PIDs are passed to `taskkill.exe`.

- [ ] **Step 1: Extend the fake Windows interop so ordinary PIDs are distinguishable from stale PIDs**

Replace the fake `powershell.exe` definition in the auto-close test with:

```bash
if [ "$*" = *"notlike '*--profile wslfs'*"* ]; then
  printf '4242\n'
fi
exit 0
```

This models one ordinary app PID. The stale-PID call uses `-like '*--profile wslfs*'` and returns no PID.

- [ ] **Step 2: Assert the taskkill PID and suite pass**

Keep the existing test and assert:

```js
assert.equal(result.status, 0, result.stderr);
assert.equal(readFileSync(marker, "utf8").includes("/PID 4242"), true);
```

- [ ] **Step 3: Run only the red test**

Run:

```bash
node --test --test-name-pattern='suite runner closes ordinary Harness processes' test/probe-runner.test.mjs
```

Expected: FAIL because no taskkill marker is written.

- [ ] **Step 4: Commit the test**

```bash
git add test/probe-runner.test.mjs
git -c commit.gpgsign=false commit -m "test(probe): require local app auto-close"
```

### Task 2: Implement ordinary app shutdown and stale-state abort

**Files:**
- Modify: `test/probe/run-all-when-closed.sh`
- Test: `test/probe-runner.test.mjs`

**Interfaces:**
- `ordinary_harness_pids()` returns app PIDs excluding `--profile wslfs` probe PIDs.
- `stale_probe_pids()` returns stale probe PIDs.
- `finish()` remains the only summary and exit path.

- [ ] **Step 1: Add ordinary PID discovery beside stale PID discovery**

```bash
ordinary_harness_pids() {
  powershell.exe -NoProfile -Command \
    "Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Where-Object { `$null -eq `$_.CommandLine -or `$_.CommandLine -notlike '*--profile wslfs*' } | Select-Object -ExpandProperty ProcessId" \
    2>/dev/null | tr -d '\0\r' || true
}
```

- [ ] **Step 2: Close ordinary PIDs before waiting**

Before the existing wait loop, and only outside `WSL_PROBE_SKIP_WAIT=1` and `--wait-only`:

```bash
STALE="$(stale_probe_pids)"
if [ -n "$STALE" ]; then
  echo "stale probe instance(s) are still up; refusing to close or run:" >&2
  printf '  taskkill.exe /PID %s /F\n' $STALE >&2
  finish
fi

for pid in $(ordinary_harness_pids); do
  if ! taskkill.exe /PID "$pid" /T /F >/dev/null 2>&1; then
    echo "failed to terminate Harness PID $pid" >&2
    finish
  fi
done
```

- [ ] **Step 3: Add a bounded auto-close wait**

Keep the successful-listing + no-match rule. Add 12 failed or still-running 5-second ticks. If tasklist remains unreachable or an app process remains after timeout, call `finish()` instead of starting probes.

- [ ] **Step 4: Run the red test green**

Run:

```bash
node --test --test-name-pattern='suite runner closes ordinary Harness processes' test/probe-runner.test.mjs
```

Expected: PASS and marker contains `/PID 4242 /T /F`.

- [ ] **Step 5: Run probe runner tests**

Run:

```bash
node --test test/probe-runner.test.mjs
```

Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add test/probe-runner.test.mjs test/probe/run-all-when-closed.sh
git -c commit.gpgsign=false commit -m "feat(probe): close Harness automatically on local suite launch"
```

### Task 3: Add detached foreground launcher

**Files:**
- Modify: `test/probe/run-all-when-closed.sh`
- Modify: `package.json:232`
- Test: `test/probe-runner.test.mjs`

**Interfaces:**
- Public command: `pnpm run probe:all-closed`
- Public wait-only option: `--wait-only`
- Internal worker: `WSL_PROBE_WORKER=1`
- Shared worker paths: `WSL_PROBE_LOG` and `WSL_PROBE_RESULTS`

- [ ] **Step 1: Add the detached launcher test**

In `test/probe-runner.test.mjs`, add static assertions plus a package read:

```js
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
assert.match(pkg.scripts["probe:all-closed"], /--include-fs/);

const runner = readFileSync(resolve(ROOT, "test/probe/run-all-when-closed.sh"), "utf8");
assert.match(runner, /setsid/);
assert.match(runner, /WSL_PROBE_WORKER/);
assert.match(runner, /--wait-only/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test --test-name-pattern='package and runner expose detached local automation' test/probe-runner.test.mjs
```

Expected: FAIL because the package/script contract is not present.

- [ ] **Step 3: Parse public arguments**

At the top of the runner, replace the single `--include-fs` branch with argument parsing:

```bash
INCLUDE_FS=0
WAIT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --include-fs) INCLUDE_FS=1 ;;
    --wait-only) WAIT_ONLY=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
```

- [ ] **Step 4: Make package command request the complete suite**

In `package.json`:

```json
"probe:all-closed": "bash test/probe/run-all-when-closed.sh --include-fs"
```

- [ ] **Step 5: Add foreground detached worker spawn**

After creating `LOG` and `RESULTS` but before app polling:

```bash
if [ "${WSL_PROBE_WORKER:-}" != "1" ] &&
   [ "${WSL_PROBE_SKIP_WAIT:-}" != "1" ] &&
   [ "$WAIT_ONLY" != "1" ]; then
  export WSL_PROBE_WORKER=1
  export WSL_PROBE_LOG="$LOG"
  export WSL_PROBE_RESULTS="$RESULTS"
  echo "detached local probe worker; log: $LOG" >&2
  echo "results: $RESULTS" >&2
  setsid env WSL_PROBE_WORKER=1 WSL_PROBE_LOG="$LOG" WSL_PROBE_RESULTS="$RESULTS" \
    bash "$HERE/run-all-when-closed.sh" --include-fs </dev/null >>"$LOG" 2>&1 &
  exit 0
fi
```

For a worker, use the existing `LOG` and `RESULTS` environment values instead of creating new files.

- [ ] **Step 6: Run green tests**

Run:

```bash
node --test test/probe-runner.test.mjs
```

Expected: detached contract and auto-close tests pass.

- [ ] **Step 7: Commit**

```bash
git add test/probe-runner.test.mjs test/probe/run-all-when-closed.sh package.json
git -c commit.gpgsign=false commit -m "feat(probe): launch local suite in a detached worker"
```

### Task 4: Document and verify local full automation

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `CONTRIBUTING.zh.md`
- Modify: `docs/DOCUMENTATION-MAP.md`
- Modify: `docs/MIGRATION.md`
- Modify: `docs/MIGRATION.zh.md`
- Test: `pnpm test`

**Interfaces:**
- Maintainer-facing command and two alternatives:
  `pnpm run probe:all-closed`
  `... --wait-only`

- [ ] **Step 1: Replace manual-close wording**

State that the default package command closes ordinary Harness processes and
detaches the 19-probe worker. State that `--wait-only` is the explicit
manual-close compatibility mode.

- [ ] **Step 2: Mirror bilingual documentation**

Keep English and Chinese sections section-for-section.

- [ ] **Step 3: Run targeted tests**

```bash
node --test test/probe-runner.test.mjs
pnpm test
```

- [ ] **Step 4: Commit documentation**

```bash
git add CONTRIBUTING.md CONTRIBUTING.zh.md docs/DOCUMENTATION-MAP.md docs/MIGRATION.md docs/MIGRATION.zh.md
git -c commit.gpgsign=false commit -m "docs(probe): document local full probe automation"
```
