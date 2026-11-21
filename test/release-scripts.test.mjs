/**
 * The release chain's scripts: the tag/version gate, the changelog section
 * extractor, the coverage gate, and the test watchdog.
 *
 * These run before any publish and shape what gets released. A silent bug in
 * one of them ships the wrong version, empty release notes, a passing coverage
 * gate over an unmeasured module, or a hung CI run. Until now none had a test:
 * a release-workflow failure was the first evidence.
 *
 * The scripts are spawned as processes, exactly as CI calls them; fixtures are
 * the repo's real package.json/CHANGELOG for the tag and section checks, and a
 * fake coverage table plus fake commands for the gate and the watchdog.
 *
 *   node test/release-scripts.test.mjs
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = join(ROOT, "scripts");
const SCRATCH = join(ROOT, "test", "probe", ".scratch");
mkdirSync(SCRATCH, { recursive: true });
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const ALLOWLIST = JSON.parse(readFileSync(join(ROOT, "test", "coverage-allowlist.json"), "utf8")).modules ?? {};
/** Modules the gate must see: every lib/*.js that is not allowlisted. */
const MEASURED = readdirSync(join(ROOT, "lib"))
  .filter((name) => name.endsWith(".js") && !(name in ALLOWLIST))
  .sort();

/**
 * Run one release script.
 * @param {string} script - the script basename under scripts/.
 * @param {string[]} args - its arguments.
 * @param {Record<string, string>} [env] - environment overrides.
 * @returns the completed child.
 */
const run = (script, args, env = {}) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
  encoding: "utf8",
  timeout: 60_000,
  // A CI runner sets GITHUB_STEP_SUMMARY; the gate would write there from
  // these fake runs, so the checks that do not test the summary blank it.
  env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env },
});

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through `runCheck`.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

// ── check-release-tag ────────────────────────────────────────────────────────

check("check-release-tag accepts the matching tag and rejects every other", () => {
  const good = run("check-release-tag.mjs", [`v${PKG.version}`]);
  assert.equal(good.status, 0, good.stderr);
  assert.ok(good.stdout.includes(`PASS  tag v${PKG.version} matches`), good.stdout);

  const wrong = run("check-release-tag.mjs", ["v0.0.1"]);
  assert.equal(wrong.status, 1, "a mismatched tag exits 1");
  assert.match(wrong.stderr, /does not match package\.json version/);

  const bare = run("check-release-tag.mjs", [PKG.version]);
  assert.equal(bare.status, 1, "the tag must carry the v prefix");

  const none = run("check-release-tag.mjs", []);
  assert.equal(none.status, 2, "no tag is a usage error");
  assert.match(none.stderr, /usage: node scripts\/check-release-tag\.mjs/);
});

// ── changelog-section ────────────────────────────────────────────────────────

check("changelog-section prints the version's body without the heading", () => {
  const out = run("changelog-section.mjs", []);
  assert.equal(out.status, 0, out.stderr);
  assert.ok(out.stdout.trim().length > 0, "the current version's notes are non-empty");
  assert.ok(!out.stdout.startsWith("## ["), "gh release create carries the title; the body never repeats the heading");

  const explicit = run("changelog-section.mjs", [PKG.version]);
  assert.equal(explicit.status, 0);
  assert.equal(explicit.stdout.trim(), out.stdout.trim(), "an explicit version selects the same section");
});

check("changelog-section accepts the Unreleased section", () => {
  const out = run("changelog-section.mjs", ["Unreleased"]);
  // The section may be empty between releases; the selection itself must work.
  assert.equal(out.status, 0, out.stderr);
});

check("changelog-section fails a version without a section", () => {
  const out = run("changelog-section.mjs", ["99.99.99"]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /CHANGELOG\.md has no "## \[99\.99\.99\]" section/);
});

check("changelog-section writes --out and reports the result", () => {
  const outPath = join("test", "probe", ".scratch", `release-notes-${process.pid}.md`);
  const file = join(ROOT, outPath);
  try {
    const written = run("changelog-section.mjs", ["--out", outPath, PKG.version]);
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stdout, /PASS  wrote .* from CHANGELOG\.md ## \[/);
    const body = readFileSync(file, "utf8");
    const printed = run("changelog-section.mjs", [PKG.version]);
    assert.equal(body.trim(), printed.stdout.trim(), "the file carries the printed section");
  } finally {
    rmSync(file, { force: true });
  }
});

// ── test-watchdog ────────────────────────────────────────────────────────────

check("test-watchdog passes the command's exit status through", () => {
  const child = run("test-watchdog.mjs", ["--", process.execPath, "-e", "process.exit(7)"]);
  assert.equal(child.status, 7);
});

check("test-watchdog refuses a missing command and an invalid deadline", () => {
  const none = run("test-watchdog.mjs", []);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no command given/);

  const bad = run("test-watchdog.mjs", ["--timeout", "soon", "--", process.execPath, "-e", "0"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /invalid timeout/);
});

check("test-watchdog interrupts a command that outlives the deadline", () => {
  const started = Date.now();
  const hung = run("test-watchdog.mjs", ["--timeout", "150", "--", process.execPath, "-e", "setInterval(() => {}, 1000)"]);
  const elapsed = Date.now() - started;
  assert.equal(hung.status, 124, hung.stderr);
  assert.match(hung.stderr, /no completion within 150 ms/);
  assert.ok(elapsed < 15_000, `the watchdog settled (${elapsed}ms)`);

  const eq = run("test-watchdog.mjs", ["--timeout=150", "--", process.execPath, "-e", "setInterval(() => {}, 1000)"]);
  assert.equal(eq.status, 124, "the --timeout=<ms> spelling is accepted");
});

check("test-watchdog forwards a caller's signal to the command", async () => {
  if (process.platform === "win32") {
    console.log("      (skip: POSIX signal forwarding)");
    return;
  }
  /** @type {import("node:child_process").ChildProcess} */
  const child = spawn(process.execPath, [join(SCRIPTS, "test-watchdog.mjs"), "--", process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "ignore", "ignore"] });
  const exited = new Promise((resolvePromise) => { child.on("exit", (code, signal) => resolvePromise({ code, signal })); });
  await new Promise((resolvePromise) => { setTimeout(resolvePromise, 200); });
  child.kill("SIGTERM");
  const result = await Promise.race([
    exited,
    new Promise((resolvePromise) => { setTimeout(() => resolvePromise("still running"), 8_000); }),
  ]);
  assert.notEqual(result, "still running", "the watchdog forwards the signal and exits");
  if (result !== "still running") assert.notEqual(result.code, 0, "the interrupted command does not read as success");
});

// ── coverage-gate ────────────────────────────────────────────────────────────

/**
 * One fake coverage command printing the given table.
 * @param {string[]} lines - the table rows.
 * @returns {string[]} the coverage-gate command tail.
 */
const fakeCoverage = (lines) => [process.execPath, "-e", `process.stdout.write(${JSON.stringify(`${lines.join("\n")}\n`)})`];

/** A complete, passing table for every measured module. */
const PASSING_TABLE = MEASURED.map((name) => `ℹ  ${name} | 100.00 | 100.00 | 100.00 |`);

check("coverage-gate accepts a complete table and writes no summary without one", () => {
  const out = run("coverage-gate.mjs", ["--", ...fakeCoverage(PASSING_TABLE)]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /every shipped module is measured or allowlisted/);
  assert.match(out.stdout, new RegExp(`${MEASURED.length} of ${MEASURED.length + Object.keys(ALLOWLIST).length} shipped module\\(s\\) measured, ${Object.keys(ALLOWLIST).length} allowlisted`));
});

check("coverage-gate fails a module below the per-module floors", () => {
  const broken = PASSING_TABLE.map((line, index) => index === 0 ? line.replace(/100\.00 \| 100\.00 \| 100\.00/, "10.00 | 10.00 | 10.00") : line);
  const out = run("coverage-gate.mjs", ["--", ...fakeCoverage(broken)]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /FAIL/);
  assert.match(out.stderr, new RegExp(`${MEASURED[0]}: line 10\\.00% < 85% floor`));
});

check("coverage-gate fails a shipped module the run never measured", () => {
  const omitted = PASSING_TABLE.slice(1);
  const out = run("coverage-gate.mjs", ["--", ...fakeCoverage(omitted)]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, new RegExp(`${MEASURED[0]}: not measured`));
});

check("coverage-gate passes a failing command's exit status through", () => {
  const out = run("coverage-gate.mjs", ["--", process.execPath, "-e", "process.exit(3)"]);
  assert.equal(out.status, 3, "the command's own verdict is not buried");
});

check("coverage-gate refuses no command and an empty report", () => {
  const none = run("coverage-gate.mjs", []);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no command given/);

  const empty = run("coverage-gate.mjs", ["--", process.execPath, "-e", "process.stdout.write('nothing here\\n')"]);
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /no coverage rows found/);
});

check("coverage-gate publishes the table to GITHUB_STEP_SUMMARY", () => {
  const summary = join(SCRATCH, `coverage-summary-${process.pid}.md`);
  try {
    const out = run("coverage-gate.mjs", ["--", ...fakeCoverage(PASSING_TABLE)], { GITHUB_STEP_SUMMARY: summary });
    assert.equal(out.status, 0, out.stderr);
    const text = readFileSync(summary, "utf8");
    assert.match(text, /\| module \| lines % \| branches % \| functions % \|/);
    assert.match(text, /all floors met/);
  } finally {
    rmSync(summary, { force: true });
  }
});

check("release publish requires the candidate official-harness package smoke", () => {
  const release = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.match(release, /candidate-package-smoke/);
  assert.match(release, /official-harness-smoke/);
  assert.match(release, /npm pack --json/);
  assert.match(release, /needs:\s*\[?\s*(-\s*)?candidate-package-smoke/);
  assert.match(release, /include-hidden-files:\s*true/);
  assert.match(release, /if-no-files-found:\s*error/);
  assert.match(release, /tarball-integrity:\s*\$\{\{\s*steps\.pack\.outputs\.integrity/);
  assert.match(release, /needs\.pack-candidate\.outputs\.tarball-name/);
  assert.match(release, /integrity mismatch: .*CANDIDATE_INTEGRITY/);
  assert.match(release, /name: candidate-package/);
  assert.match(release, /download-artifact/);
  assert.match(release, /npm publish "\.\/\$CANDIDATE_FILE" --provenance --access public/);
  assert.equal((release.match(/npm pack --json --ignore-scripts/g) ?? []).length, 1, "the candidate is packed exactly once");
  // The tarball is packed on Linux so the shipped shell scripts keep their
  // executable bits; a Windows filesystem cannot represent them (#69).
  const packJob = release.slice(release.indexOf("  pack-candidate:"), release.indexOf("  candidate-package-smoke:"));
  assert.match(packJob, /runs-on: ubuntu-latest/);
  assert.match(packJob, /contents: read/);
  assert.doesNotMatch(packJob, /id-token: write/);
  // The pack and smoke jobs publish nothing, so they need no write access.
  const smokeJob = release.slice(release.indexOf("  candidate-package-smoke:"), release.indexOf("  publish:"));
  assert.match(smokeJob, /contents: read/);
  // A dispatch run is the candidate smoke's dry run: publish and post-release
  // only run for a tag push, and the tag checks only run then too.
  assert.match(release, /workflow_dispatch/);
  for (const job of ["publish", "post-release-package-smoke"]) {
    const body = release.slice(release.indexOf(`  ${job}:`));
    const gate = body.slice(0, body.indexOf("needs:"));
    assert.match(gate, /github\.event_name == 'push'/, `${job} is tag-push-only`);
  }
  // The pack job gates its tag check for dispatch runs; publish's is covered by
  // the job-level push gate above.
  const packBody = release.slice(release.indexOf("  pack-candidate:"), release.indexOf("  candidate-package-smoke:"));
  const packTagCheck = packBody.indexOf("run: node scripts/check-release-tag.mjs");
  const packGate = packBody.indexOf("if: github.event_name == 'push'");
  assert.ok(packGate > 0 && packGate < packTagCheck, "the pack job gates its tag check for dispatch runs");
  for (const job of ["candidate-package-smoke", "post-release-package-smoke"]) {
    const body = release.slice(release.indexOf(`  ${job}:`));
    const provision = body.indexOf("uses: ./.github/actions/provision-wsl");
    assert.ok(provision > 0 && provision < body.indexOf("pnpm run smoke:official-harness"), `${job} provisions WSL before the smoke`);
  }
  assert.match(release, /package@\$version/);
  assert.doesNotMatch(release, /npm install dsh-plugin-wsl-env\s*$/m);
  // The provisioning contract lives in the composite action both jobs share.
  const action = readFileSync(join(ROOT, ".github", "actions", "provision-wsl", "action.yml"), "utf8");
  for (const needle of [
    "systemd=true",
    "--shutdown",
    '"--set-default", $distro',
    '"bubblewrap", "dbus", "git", "ca-certificates", "curl", "build-essential"',
    '"enable-linger", "root"',
    "inputs.distro",
    // Hosted-runner WSL provisioning hangs (runs 44916280237, 44920649147):
    // every call runs under a watchdog with a retry.
    "Wait-Job $job -Timeout $timeoutSec",
  ]) {
    assert.ok(action.includes(needle), `provisioning action includes ${needle}`);
  }
});

check("official smoke script wires an isolated profile and the exact tarball", () => {
  const ps = readFileSync(join(ROOT, "scripts", "official-harness-smoke.ps1"), "utf8");
  for (const needle of ["$env:DSH_HOME", "$env:WSLENV", "--from-default-profile", "\"web\"", "\"plugin\", \"--profile\", $profileName, \"add\", \"file:$tarball\"", "--dump-config", "--no-open"]) {
    assert.ok(ps.includes(needle), `smoke script contains ${needle}`);
  }
  assert.ok(!/installed (plugin )?version/i.test(ps), "no installed-version claim without evidence");
});

check("release verifies the published official package after publishing", () => {
  const release = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
  assert.match(release, /post-release-package-smoke/);
  assert.match(release, /npm view "dsh-plugin-wsl-env@\$version" dist\.integrity/);
  assert.match(release, /dsh-plugin-wsl-env@\$version/);
  assert.match(release, /GitHub Release warning|issue/);
  assert.doesNotMatch(release, /dsh-plugin-wsl-env@latest/);
});

let failed = 0;
for (const [name, fn] of checks) await runCheck(name, fn);
failed = checks.length - passed;
console.log(`\n${passed}/${checks.length} release-script checks pass`);
if (failed > 0) process.exitCode = 1;
