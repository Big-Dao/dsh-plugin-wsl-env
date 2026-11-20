# GitHub-hosted Windows + WSL Probe Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the hosted Windows WSL gate so it prepares and runs the complete closed-app real-machine probe suite.

**Architecture:** Keep all platform setup and evidence collection in `.github/workflows/cloud-wsl-gate.yml`; add static workflow assertions in `test/cloud-wsl-gate.test.mjs`; invoke the existing `run-all-when-closed.sh --include-fs` runner only after the Desktop process is stopped.

**Tech Stack:** GitHub Actions, PowerShell, Bash, WSL, Ubuntu 24.04, Debian, Node 24, bubblewrap, existing DSH probe scripts.

## Global Constraints

- The hosted gate runs on `windows-latest`.
- The probe suite is `test/probe/run-all-when-closed.sh --include-fs`.
- PASS is real only when every suite entry passes; SKIP, FAIL and NOT RUN fail the suite contract.
- Probe scripts already present must not be reimplemented or replaced.
- No secrets or authenticated model account are required.
- Evidence logs and results remain uploaded with `if: always()`.

---

### Task 1: Add failing hosted-suite workflow assertions

**Files:**
- Modify: `test/cloud-wsl-gate.test.mjs`
- Test: `test/cloud-wsl-gate.test.mjs`

**Interfaces:**
- Consumes: the workflow text in `.github/workflows/cloud-wsl-gate.yml`.
- Produces: static assertions that prevent a future workflow from claiming hosted probe success without setup and suite execution.

- [ ] **Step 1: Add assertions for hosted probe setup and execution**

Append checks that require all of these workflow facts:

```js
assert.match(workflow, /wslfs-profile\.patch\.yml/);
assert.match(workflow, /Debian/);
assert.match(workflow, /fnm install 24\.9\.0/);
assert.match(workflow, /run-all-when-closed\.sh --include-fs/);
assert.match(workflow, /test\/probe\/\.scratch\/full-probe\.\*\.log/);
assert.match(workflow, /test\/probe\/\.scratch\/full-probe\.\*\.results/);
```

- [ ] **Step 2: Run the test and verify it fails before implementation**

Run:

```bash
node --test test/cloud-wsl-gate.test.mjs
```

Expected: FAIL because the workflow does not yet contain the probe setup or suite runner.

- [ ] **Step 3: Commit the test change before workflow implementation**

Run:

```bash
git add test/cloud-wsl-gate.test.mjs
git -c commit.gpgsign=false commit -m "test(ci): assert hosted probe suite gate"
```

### Task 2: Prepare systemd and a second hosted distro

**Files:**
- Modify: `.github/workflows/cloud-wsl-gate.yml`
- Test: `test/cloud-wsl-gate.test.mjs`

**Interfaces:**
- Consumes: the Ubuntu 24.04 distro installed in the existing gate.
- Produces: systemd-enabled Ubuntu and an installed Debian distro available for `two-distro.sh`.

- [ ] **Step 1: Configure Ubuntu systemd before package installation**

In `Install Ubuntu 24.04 and bwrap`, write `/etc/wsl.conf` and shut WSL down:

```pwsh
& wsl.exe -d Ubuntu-24.04 -u root --exec bash -lc "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf"
if ($LASTEXITCODE -ne 0) { throw "Ubuntu systemd configuration failed: exit=$LASTEXITCODE" }
& wsl.exe --shutdown
if ($LASTEXITCODE -ne 0) { throw "WSL shutdown failed before probe setup: exit=$LASTEXITCODE" }
& wsl.exe --set-default Ubuntu-24.04
& wsl.exe -d Ubuntu-24.04 -u root --exec apt-get update
& wsl.exe -d Ubuntu-24.04 -u root --exec apt-get install -y --no-install-recommends bubblewrap git ca-certificates curl build-essential
```

- [ ] **Step 2: Install Debian 12 as the second probe distro**

Use a separate step or the same installation step:

```pwsh
& wsl.exe --install -d Debian --no-launch --web-download
if ($LASTEXITCODE -ne 0) { throw "Debian install failed: exit=$LASTEXITCODE" }
& wsl.exe -d Debian -u root --exec apt-get update
if ($LASTEXITCODE -ne 0) { throw "Debian apt update failed: exit=$LASTEXITCODE" }
& wsl.exe -d Debian -u root --exec apt-get install -y --no-install-recommends git ca-certificates curl
if ($LASTEXITCODE -ne 0) { throw "Debian package install failed: exit=$LASTEXITCODE" }
```

- [ ] **Step 3: Run static workflow assertions**

Run:

```bash
node --test test/cloud-wsl-gate.test.mjs
```

Expected: PASS only after the static assertions for Debian and probe setup are implemented in the workflow.

- [ ] **Step 4: Commit environment preparation**

```bash
git add .github/workflows/cloud-wsl-gate.yml test/cloud-wsl-gate.test.mjs
git -c commit.gpgsign=false commit -m "test(ci): prepare hosted probe distros"
```

### Task 3: Install Node 24 and prepare the wslfs runtime

**Files:**
- Modify: `.github/workflows/cloud-wsl-gate.yml`
- Test: `test/cloud-wsl-gate.test.mjs`

**Interfaces:**
- Consumes: Ubuntu 24.04, the Desktop `DESKTOP_DSH`, and the plugin checkout.
- Produces: a `wslfs` profile, a Windows runtime mirror, fnm Node 24, and all `DSH_WSL_ENV_*` probe facts.

- [ ] **Step 1: Install fnm and Node 24.9.0 in Ubuntu**

Add a PowerShell step that calls WSL:

```bash
set -eu
export FNM_DIR="$HOME/.local/share/fnm"
curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
"$FNM_DIR/fnm" install 24.9.0
"$FNM_DIR/fnm" use 24.9.0
eval "$("$FNM_DIR/fnm" env --shell bash)"
node --version
```

- [ ] **Step 2: Create the Windows runtime mirror**

In PowerShell:

```pwsh
$mirror = Join-Path $env:GITHUB_WORKSPACE "cloud-windows-mirror"
New-Item -ItemType Directory -Force -Path $mirror | Out-Null
& robocopy (Join-Path $env:GITHUB_WORKSPACE "plugin") $mirror /E /XD .git node_modules test\probe\.scratch .v2c .video_agent
if ($LASTEXITCODE -gt 7) { throw "runtime mirror copy failed: exit=$LASTEXITCODE" }
```

The source checkout is `GITHUB_WORKSPACE\plugin`; the destination must differ from the source and remain writable.

- [ ] **Step 3: Create the wslfs profile and copy the probe patch**

In PowerShell, use `DESKTOP_DSH`:

```pwsh
& "$env:DESKTOP_DSH" wslfs --from-default-profile web --dump-config
& "$env:DESKTOP_DSH" plugin --profile wslfs add "link:$mirror"
Copy-Item "$env:GITHUB_WORKSPACE\plugin\test\probe\wslfs-profile.patch.yml" `
  "$dshHome\profiles\wslfs\cordis.patch.yml"
```

The profile creation must check `LASTEXITCODE` after each command.

- [ ] **Step 4: Run static assertions**

Run:

```bash
node --test test/cloud-wsl-gate.test.mjs
```

Expected: PASS for the Node and wslfs setup contract.

- [ ] **Step 5: Commit probe runtime preparation**

```bash
git add .github/workflows/cloud-wsl-gate.yml test/cloud-wsl-gate.test.mjs
git -c commit.gpgsign=false commit -m "test(ci): prepare hosted wslfs probe runtime"
```

### Task 4: Stop Desktop and run the closed-app probe suite

**Files:**
- Modify: `.github/workflows/cloud-wsl-gate.yml`
- Test: `test/cloud-wsl-gate.test.mjs`

**Interfaces:**
- Consumes: the ready Desktop process, the wslfs profile, Node 24, and both distros.
- Produces: a suite log, suite results, existing probe reports, and a fail-loud GitHub job exit.

- [ ] **Step 1: Make readiness launch leave no app process before probe execution**

The existing launch step already stops the process in `finally`. Add an explicit hosted probe step after it:

```pwsh
$desktopProcesses = Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'"
if ($desktopProcesses) {
  throw "DeepSeek Harness is still running before hosted probes"
}
```

- [ ] **Step 2: Invoke the authoritative suite from Ubuntu**

Use the WSL POSIX workspace translation and execute the suite:

```bash
set -euo pipefail
cd "$DSH_WSL_ENV_WORKSPACE_LINUX"
export DSH_WSL_ENV_DISTRO="${WSL_DISTRO_NAME:-Ubuntu-24.04}"
export DSH_WSL_ENV_PROFILE="$WIN_PROFILE/profiles/wslfs"
export DSH_WSL_ENV_RUNTIME_COPY="$WIN_MIRROR"
export DSH_WSL_ENV_CLI="$WIN_APP/resources/runtime/cli/bin/dsh.cmd"
export WSLENV="${WSLENV:+$WSLENV:}ELECTRON_RUN_AS_NODE"
bash test/probe/run-all-when-closed.sh --include-fs
```

The actual workflow must translate Windows profile, mirror, app and workspace paths inside WSL and must run from the Ubuntu distro.

- [ ] **Step 3: Upload suite evidence always**

Extend the existing artifact step:

```yaml
path: |
  cloud-desktop-profile.txt
  cloud-desktop.stdout.log
  cloud-desktop.stderr.log
  test/probe/.scratch/full-probe.*.log
  test/probe/.scratch/full-probe.*.results
  test/probe/*-report.txt
if-no-files-found: warn
```

- [ ] **Step 4: Run static assertions**

Run:

```bash
node --test test/cloud-wsl-gate.test.mjs
```

Expected: PASS for suite invocation and artifact globs.

- [ ] **Step 5: Commit the suite execution**

```bash
git add .github/workflows/cloud-wsl-gate.yml test/cloud-wsl-gate.test.mjs
git -c commit.gpgsign=false commit -m "test(ci): run full probes in hosted Windows WSL gate"
```

### Task 5: Update hosted-gate documentation

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `CONTRIBUTING.zh.md`
- Modify: `docs/DOCUMENTATION-MAP.md`
- Test: `pnpm test`

- [ ] **Step 1: Replace the hosted runner limitation text**

In [CONTRIBUTING.md](../../../CONTRIBUTING.md), state that `.github/workflows/cloud-wsl-gate.yml` now runs the Desktop gate plus the closed-app suite on hosted `windows-latest` and that a full pass requires no SKIP or NOT RUN entries.

- [ ] **Step 2: Mirror the text in CONTRIBUTING.zh.md**

Keep the English and Chinese sections section-for-section.

- [ ] **Step 3: Update the documentation map**

State that the cloud gate is an end-to-end hosted probe baseline rather than a basic desktop-only smoke gate.

- [ ] **Step 4: Run documentation and full checks**

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit documentation**

```bash
git add CONTRIBUTING.md CONTRIBUTING.zh.md docs/DOCUMENTATION-MAP.md
git -c commit.gpgsign=false commit -m "docs: document hosted Windows WSL probe gate"
```

### Task 6: Run the hosted gate and verify evidence

**Files:**
- No source files created by this task.
- Workflow run: `.github/workflows/cloud-wsl-gate.yml`

- [ ] **Step 1: Push the implementation branch and open or update PR #58**

```bash
git push origin test/cloud-harness-gate
```

- [ ] **Step 2: Dispatch or wait for the pull-request Cloud WSL Gate run**

Expected: the run reaches and passes `Prepare hosted probe suite` and `Run hosted probe suite`.

- [ ] **Step 3: Download evidence**

Confirm:

- full-probe log exists;
- full-probe results exists;
- suite summary contains `FULL PASS`;
- no `SKIP` or `NOT RUN` line exists;
- `run.sh` and the probe reports are present.

- [ ] **Step 4: Stop at the first real failure**

If the run fails, extract the failing probe name and harness log, fix only that root cause, rerun, and repeat until the hosted suite passes.
