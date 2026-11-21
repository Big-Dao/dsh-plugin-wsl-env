# Enterprise Probe Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Add official-package candidate and post-release smoke gates around the existing pinned-source WSL gate.

**Architecture:** Keep `cloud-wsl-gate.yml` as the source compatibility authority. Add a reusable Windows official-package smoke script and static contracts, then require candidate smoke before publishing and add an exact-version post-release smoke job.

**Tech Stack:** GitHub Actions, PowerShell, Node 24, npm, Electron Desktop, WSL 2, Ubuntu 24.04, bubblewrap.

## Global Constraints

- Keep the existing source compatibility gate; do not replace it with official-package testing.
- Candidate smoke must use an official Harness installer and an exact plugin candidate tarball.
- Publishing stable or `next` must depend on candidate smoke success.
- Post-release smoke must resolve `dsh-plugin-wsl-env@<exact-version>`, never `latest`.
- Fail on `SKIP`, `FAIL`, or `NOT RUN`.
- Upload logs and result files while excluding credentials and personal data.
- Keep static workflow tests as drift checks, not runtime evidence.

---

### Task 1: Add official Desktop package discovery and smoke contracts

**Files:**
- Create: `scripts/official-harness-smoke.mjs`
- Create: `scripts/official-harness-smoke.ps1`
- Create: `test/official-harness-smoke.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DSH_OFFICIAL_HARNESS_VERSION`, `DSH_PLUGIN_PACKAGE_TARBALL`, `DSH_WSL_ENV_DISTRO`, and `DSH_WSL_ENV_PROFILE`.
- Produces: a `0` exit after Desktop/plugin/WSL smoke succeeds; a nonzero exit with diagnostic logs otherwise.
- Candidate package identity is the candidate npm tarball integrity.
- Published package identity is `dsh-plugin-wsl-env@<exact-version>` integrity.

- [ ] **Step 1: Write the failing static test**

Add tests that require `official-harness-smoke.ps1` and
`official-harness-smoke.mjs` to be referenced by package scripts and that require
exact package identity fields:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
assert.equal(
  packageJson.scripts["smoke:official-harness"],
  "node scripts/official-harness-smoke.mjs",
);

const script = readFileSync(
  new URL("../scripts/official-harness-smoke.mjs", import.meta.url),
  "utf8",
);
assert.match(script, /DSH_OFFICIAL_HARNESS_VERSION/);
assert.match(script, /DSH_PLUGIN_PACKAGE_TARBALL/);
assert.match(script, /dsh-plugin-wsl-env@/);
assert.doesNotMatch(script, /npm install dsh-plugin-wsl-env$/m);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test test/official-harness-smoke.test.mjs
```

Expected: FAIL because package scripts and smoke files do not exist.

- [ ] **Step 3: Add the package script and smoke Node entrypoint**

Add this script entry to `package.json`:

```json
"smoke:official-harness": "node scripts/official-harness-smoke.mjs"
```

Create `scripts/official-harness-smoke.mjs` that validates required environment
variables, resolves the official Harness installer asset from
`deepseek-ai/deepseek-harness@<DSH_OFFICIAL_HARNESS_VERSION>`, records package
identity and integrity, starts PowerShell with
`scripts/official-harness-smoke.ps1`, forwards its exit code, and writes
`test/probe/.scratch/official-harness-smoke.results` with
`PASS`, `FAIL`, `SKIP`, or `NOT RUN` rows.

- [ ] **Step 4: Add the PowerShell official-package smoke**

Create `scripts/official-harness-smoke.ps1` that:

1. validates that both required environment variables are set;
2. downloads the selected official Windows installer and its checksum;
3. verifies checksum content when an official checksum asset exists;
4. installs the official Desktop app into an isolated runner directory;
5. invokes the bundled `dsh.cmd` plugin add command with the candidate tarball;
6. verifies `dsh-plugin-wsl-env` appears in `--dump-config`;
7. starts Desktop with `--no-sandbox --disable-gpu --no-open`;
8. waits for the web endpoint and stops the app;
9. runs one WSL command and one workspace file operation;
10. writes the pass/fail result file and uploads never include secrets.

- [ ] **Step 5: Run the focused test**

Run:

```bash
node --test test/official-harness-smoke.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/official-harness-smoke.mjs scripts/official-harness-smoke.ps1 test/official-harness-smoke.test.mjs
git -c commit.gpgsign=false commit -m "test(ci): add official harness package smoke"
```

### Task 2: Add the release candidate smoke gate

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `test/release-scripts.test.mjs`
- Modify: `docs/RELEASING.md`

**Interfaces:**
- Consumes: the exact tagged commit and `package.json.version`.
- Produces: `candidate-package-smoke` as a required prerequisite for `publish`.
- Candidate tarball identity is the `npm pack --json` integrity.

- [ ] **Step 1: Write the failing release workflow test**

Add assertions to `test/release-scripts.test.mjs` that require the workflow to:

```js
assert.match(release, /candidate-package-smoke/);
assert.match(release, /official-harness-smoke/);
assert.match(release, /npm pack --json/);
assert.match(release, /needs:\s*\[?candidate-package-smoke/);
assert.match(release, /package@\$version/);
assert.doesNotMatch(release, /npm install dsh-plugin-wsl-env\s*$/m);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test test/release-scripts.test.mjs
```

Expected: FAIL because candidate smoke is absent.

- [ ] **Step 3: Add the candidate smoke job**

Add a `candidate-package-smoke` job on `windows-latest` before `publish`.
The job checks out the tag, sets Node and pnpm, runs `npm pack --json` without
publishing, passes the generated tarball to
`pnpm run smoke:official-harness`, and uploads the official smoke logs.

Make `publish` consume the job result:

```yaml
publish:
  needs:
    - candidate-package-smoke
```

Run the smoke against pinned `DSH_OFFICIAL_HARNESS_VERSION`, which must match
the peer/Harness compatibility floor declared in `docs/PEER-PARITY.md`.

- [ ] **Step 4: Document publish dependency**

Add to `docs/RELEASING.md` that stable publishing is blocked until the
candidate official-package smoke succeeds and that failed evidence is retained
as a release artifact.

- [ ] **Step 5: Run tests**

Run:

```bash
node --test test/release-scripts.test.mjs test/official-harness-smoke.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml test/release-scripts.test.mjs docs/RELEASING.md
git -c commit.gpgsign=false commit -m "ci(release): require candidate package smoke"
```

### Task 3: Add post-release official-package verification

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `test/release-scripts.test.mjs`
- Modify: `docs/RELEASING.md`

**Interfaces:**
- Consumes: the exact registry package version and registry integrity.
- Produces: `post-release-package-smoke` evidence and a visible Release warning on failure.
- Exact package resolution: `dsh-plugin-wsl-env@<version>`.

- [ ] **Step 1: Write the failing test**

Add assertions that require:

```js
assert.match(release, /post-release-package-smoke/);
assert.match(release, /npm view "dsh-plugin-wsl-env@\$version" dist\.integrity/);
assert.match(release, /dsh-plugin-wsl-env@\$version/);
assert.match(release, /GitHub Release warning|issue/);
assert.doesNotMatch(release, /dsh-plugin-wsl-env@latest/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test test/release-scripts.test.mjs
```

Expected: FAIL because post-release smoke is absent.

- [ ] **Step 3: Add the post-release job**

Add `post-release-package-smoke` on `windows-latest` after registry verification
and GitHub Release creation or with `needs: publish`.

The job:

1. reads `package.json.version`;
2. polls `dsh-plugin-wsl-env@<version>` until registry metadata is available;
3. installs that exact package;
4. runs `pnpm run smoke:official-harness`;
5. compares registry integrity with the package tarball integrity;
6. uploads versioned evidence.

Do not use `latest`, floating dist tags, or an unqualified package name.

- [ ] **Step 4: Publish failures visibly**

On smoke failure, create or update a GitHub issue and append a warning to the
release notes. Never represent the package as healthy or silently claim success.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml test/release-scripts.test.mjs docs/RELEASING.md
git -c commit.gpgsign=false commit -m "ci(release): verify published official package"
```

### Task 4: Document and complete the gate

**Files:**
- Modify: `docs/RELEASING.md`
- Create: `docs/RELEASING.zh.md`
- Modify: `docs/DOCUMENTATION-MAP.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the approved enterprise gate design.
- Produces: bilingual release instructions and a changelog entry.

- [ ] **Step 1: Update the release checklist**

Add three gates to `docs/RELEASING.md`:

```text
Source gate: every PR/main run
Candidate gate: every tag before publish
Post-release gate: every stable/next tag after registry propagation
```

State that source evidence does not substitute for official-package evidence.

- [ ] **Step 2: Add the Chinese release guide**

Mirror the English checklist in `docs/RELEASING.zh.md`, keeping the file pair
synchronized.

- [ ] **Step 3: Update documentation ownership**

Add the enterprise gate design and implementation plan to
`docs/DOCUMENTATION-MAP.md`, with the implementation plan marked as operational
history rather than normative behavior.

- [ ] **Step 4: Add the changelog entry**

Add a fixed change under `## [Unreleased]`:

```markdown
- **Release workflows now gate publication and post-release verification
  through official-package smoke evidence.** The existing source compatibility
  gate remains authoritative for full Windows/WSL probe coverage.
```

- [ ] **Step 5: Run the complete gate**

Run:

```bash
pnpm test
pnpm run test:coverage
pnpm run test:browser
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md docs/RELEASING.md docs/RELEASING.zh.md docs/DOCUMENTATION-MAP.md
git -c commit.gpgsign=false commit -m "docs(release): document official package gates"
```
