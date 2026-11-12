import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runCopiedInteropChecks, runInteropChecks } from "./probe/interop-shell-probe.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Run the real probe launcher with a controlled harness process.
 * @param {{report?: string, stale?: string, exit?: number}} options - Harness outcome.
 */
function runProbe(options) {
  const dir = mkdtempSync(join(tmpdir(), "wsl-probe-runner-"));
  try {
    mkdirSync(join(dir, "profile"));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "profile", "cordis.patch.yml"), "");
    copyFileSync(join(root, "test", "probe", "run.sh"), join(dir, "run.sh"));
    writeFileSync(join(dir, "env.sh"), 'PROFILE="$HERE/profile"\nAPP="$HERE/app"\nCLI=cli\nUNC=unc\nwrite_overlay() { echo overlay; }\n');
    writeFileSync(join(dir, "sync-to-windows.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "sync-to-windows.sh"), 0o755);
    const app = join(dir, "app", "DeepSeek Harness.exe");
    writeFileSync(app, '#!/bin/sh\nif [ "$WRITE_REPORT" = yes ]; then printf "%s\\n" "$PROBE_REPORT_TEXT" > "$REPORT_PATH"; fi\nexit "$HARNESS_STATUS"\n');
    chmodSync(app, 0o755);
    const report = join(dir, "fs-probe.txt");
    if (options.stale !== undefined) writeFileSync(report, options.stale);
    return spawnSync("bash", [join(dir, "run.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        REPORT_PATH: report,
        PROBE_REPORT_TEXT: options.report ?? "",
        WRITE_REPORT: options.report === undefined ? "no" : "yes",
        HARNESS_STATUS: String(options.exit ?? 0),
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const shellTest = process.platform === "win32" ? test.skip : test;

shellTest("filesystem launcher succeeds only for a fresh successful report", () => {
  const result = runProbe({ report: "PASS  create\n\nRESULT: all steps passed" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT: all steps passed/);
});

shellTest("filesystem launcher fails when a report records failed steps", () => {
  const result = runProbe({ report: "FAIL  create\n\nRESULT: 1 step(s) failed" });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /FAIL  create/);
});

shellTest("filesystem launcher rejects a stale success report when the harness writes nothing", () => {
  const result = runProbe({ stale: "RESULT: all steps passed\n" });
  assert.equal(result.status, 1, result.stdout);
});

shellTest("filesystem launcher fails when the harness exits unsuccessfully", () => {
  const result = runProbe({ report: "RESULT: all steps passed", exit: 7 });
  assert.equal(result.status, 7, result.stdout);
});

shellTest("filesystem launcher rejects an incomplete or contradictory report", () => {
  for (const report of ["PASS  create", "FAIL  create\nRESULT: all steps passed"]) {
    const result = runProbe({ report });
    assert.equal(result.status, 1, result.stdout);
  }
});

/**
 * Run the interop matrix launcher with a simulated harness.
 * @param {{outcome?: string, stale?: string}} options - Simulated report outcome.
 */
function runInteropProbe(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wsl-interop-runner-"));
  try {
    mkdirSync(join(dir, "profile"));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "profile", "cordis.patch.yml"), "");
    copyFileSync(join(root, "test", "probe", "interop-shell.sh"), join(dir, "interop-shell.sh"));
    writeFileSync(join(dir, "env.sh"), 'PROFILE="$HERE/profile"\nAPP="$HERE/app"\nCLI=cli\nUNC=unc\nDISTRO=ubuntu\nDSH_WSL_ENV_HOME="$HERE"\nwrite_overlay() { echo "$2"; }\n');
    writeFileSync(join(dir, "sync-to-windows.sh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "sync-to-windows.sh"), 0o755);
    const app = join(dir, "app", "DeepSeek Harness.exe");
    writeFileSync(app, `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = --patch ]; then overlay="$2"; break; fi
  shift
done
case "$overlay" in
  *resident-visible*) mode=resident; mask=visible ;;
  *resident-masked*) mode=resident; mask=masked ;;
  *oneshot-visible*) mode=oneshot; mask=visible ;;
  *oneshot-masked*) mode=oneshot; mask=masked ;;
  *) exit 9 ;;
esac
case "$TEST_OUTCOME" in
  missing) exit 0 ;;
  late-missing) if [ "$mask" = masked ]; then exit 0; fi; printf 'INTEROPPROBE RESULT: pass %s %s\\n' "$mode" "$mask" > "$REPORT_PATH" ;;
  bad) printf 'INTEROPPROBE FAIL simulated failure\\nINTEROPPROBE RESULT: pass %s %s\\n' "$mode" "$mask" > "$REPORT_PATH" ;;
  wrong) printf 'INTEROPPROBE RESULT: pass wrong wrong\\n' > "$REPORT_PATH" ;;
  exit) exit 7 ;;
  *) printf 'INTEROPPROBE RESULT: pass %s %s\\n' "$mode" "$mask" > "$REPORT_PATH" ;;
esac
`);
    chmodSync(app, 0o755);
    const report = join(dir, "interop-shell-report.txt");
    if (options.stale !== undefined) writeFileSync(report, options.stale);
    return spawnSync("bash", [join(dir, "interop-shell.sh")], {
      encoding: "utf8",
      env: { ...process.env, REPORT_PATH: report, TEST_OUTCOME: options.outcome ?? "pass" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

shellTest("interop launcher runs all four path and mask combinations", () => {
  const result = runInteropProbe();
  assert.equal(result.status, 0, result.stderr);
  for (const mode of ["resident", "oneshot"]) {
    for (const mask of ["visible", "masked"]) assert.match(result.stdout, new RegExp(`RESULT: pass ${mode} ${mask}`));
  }
});

shellTest("interop launcher rejects missing, stale, contradictory, and mismatched reports", () => {
  for (const outcome of ["missing", "late-missing", "bad", "wrong"]) {
    const result = runInteropProbe({ outcome, stale: "INTEROPPROBE RESULT: pass resident visible\n" });
    assert.notEqual(result.status, 0, `${outcome} was accepted`);
  }
});

shellTest("interop launcher fails when the harness exits unsuccessfully", () => {
  const result = runInteropProbe({ outcome: "exit" });
  assert.notEqual(result.status, 0);
});

/**
 * @param {{mode: "resident" | "oneshot", mask: "visible" | "masked", scope?: string, escaped?: boolean, baseline?: boolean, pathVisible?: boolean, enforcement?: string, verifyCommand?: boolean}} options - Simulated execution.
 */
async function checkInterop(options) {
  const dir = mkdtempSync(join(tmpdir(), "wsl-interop-check-"));
  const marker = join(dir, "marker.txt");
  try {
    return await runInteropChecks(async (command, policy) => {
      const baseline = policy === "danger-full-access";
      const existence = command.startsWith("test ! -e ");
      if (options.verifyCommand && !existence) assert.match(command, /\/c echo DSH_INTEROP_PROBE '>' '/);
      const launch = baseline ? options.baseline !== false : options.escaped ?? options.mask === "visible";
      if (!existence && launch) writeFileSync(marker, "DSH_INTEROP_PROBE\r\n");
      return {
        exitCode: existence ? options.pathVisible ? 1 : 0 : launch ? 0 : 1,
        sandbox: baseline ? undefined : {
          mode: "workspace-write",
          enforcement: options.enforcement ?? "partial",
          windowsDrive: options.mask,
          sessionScope: options.scope ?? (options.mode === "resident" ? "session" : "per-command"),
        },
      };
    }, options, marker);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("interop checks accept the intended path and mask combinations", async () => {
  for (const mode of ["resident", "oneshot"]) {
    for (const mask of ["visible", "masked"]) {
      const typedMode = /** @type {"resident" | "oneshot"} */ (mode);
      const typedMask = /** @type {"visible" | "masked"} */ (mask);
      assert.deepEqual(await checkInterop({ mode: typedMode, mask: typedMask }), []);
    }
  }
});

test("interop checks reject fallback and missing evidence", async () => {
  assert.notDeepEqual(await checkInterop({ mode: "resident", mask: "visible", scope: "per-command" }), []);
  assert.notDeepEqual(await checkInterop({ mode: "oneshot", mask: "visible", escaped: false }), []);
  assert.notDeepEqual(await checkInterop({ mode: "oneshot", mask: "masked", baseline: false }), []);
  assert.notDeepEqual(await checkInterop({ mode: "oneshot", mask: "masked", pathVisible: true }), []);
  assert.notDeepEqual(await checkInterop({ mode: "oneshot", mask: "masked", escaped: true }), []);
  assert.notDeepEqual(await checkInterop({ mode: "resident", mask: "visible", enforcement: "full" }), []);
});

test("interop launch passes redirection and the Windows path as separate arguments", async () => {
  assert.deepEqual(await checkInterop({ mode: "resident", mask: "visible", verifyCommand: true }), []);
});

/**
 * @param {{mode: "resident" | "oneshot", mask: "visible" | "masked", setup?: boolean, baseline?: boolean, escaped?: boolean, marker?: boolean, markerValue?: string, enforcement?: string, scope?: string}} options - Simulated execution.
 */
async function checkCopiedInterop(options) {
  const dir = mkdtempSync(join(tmpdir(), "wsl-interop-copy-check-"));
  const marker = join(dir, "marker.txt");
  try {
    return await runCopiedInteropChecks(async (command, policy) => {
      if (command.startsWith("cp -- ")) {
        assert.equal(policy, "danger-full-access");
        assert.match(command, /\/mnt\/c\/Windows\/System32\/cmd\.exe/);
        assert.ok(command.includes(`/tmp/probe workspace/copied-cmd-${options.mode}-${options.mask}.exe`));
        return { exitCode: options.setup === false ? 1 : 0 };
      }
      assert.ok(command.startsWith(`'/tmp/probe workspace/copied-cmd-${options.mode}-${options.mask}.exe' /d /v:off /c echo DSH_INTEROP_PROBE '>' '`));
      const baseline = policy === "danger-full-access";
      const launch = baseline ? options.baseline !== false : options.escaped !== false;
      if (launch && (baseline || options.marker !== false)) writeFileSync(marker, baseline ? "DSH_INTEROP_PROBE\r\n" : options.markerValue ?? "DSH_INTEROP_PROBE\r\n");
      return {
        exitCode: launch ? 0 : 1,
        sandbox: baseline ? undefined : {
          mode: "workspace-write",
          enforcement: options.enforcement ?? "partial",
          windowsDrive: options.mask,
          sessionScope: options.scope ?? (options.mode === "resident" ? "session" : "per-command"),
        },
      };
    }, { ...options, workspaceRoot: "/tmp/probe workspace" }, marker);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("copied interop verifies escape in both execution paths with and without the drive mask", async () => {
  for (const mode of ["resident", "oneshot"]) {
    for (const mask of ["visible", "masked"]) {
      const typedMode = /** @type {"resident" | "oneshot"} */ (mode);
      const typedMask = /** @type {"visible" | "masked"} */ (mask);
      assert.deepEqual(await checkCopiedInterop({ mode: typedMode, mask: typedMask }), []);
    }
  }
});

test("copied interop uses a distinct executable for each matrix leg", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wsl-interop-copy-matrix-"));
  const paths = new Set();
  try {
    for (const mode of ["resident", "oneshot"]) {
      for (const mask of ["visible", "masked"]) {
        const marker = join(dir, `${mode}-${mask}.txt`);
        const typedMode = /** @type {"resident" | "oneshot"} */ (mode);
        const typedMask = /** @type {"visible" | "masked"} */ (mask);
        const result = await runCopiedInteropChecks(async (command, policy) => {
          if (command.startsWith("cp -- ")) {
            const match = command.match(/^cp -- '[^']+' '([^']+)'/);
            assert.ok(match);
            assert.ok(match[1]);
            if (paths.has(match[1])) return { exitCode: 1 };
            paths.add(match[1]);
            return { exitCode: 0 };
          }
          writeFileSync(marker, "DSH_INTEROP_PROBE\r\n");
          return {
            exitCode: 0,
            sandbox: policy === "danger-full-access" ? undefined : {
              mode: "workspace-write", enforcement: "partial", windowsDrive: mask,
              sessionScope: mode === "resident" ? "session" : "per-command",
            },
          };
        }, { mode: typedMode, mask: typedMask, workspaceRoot: "/tmp/workspace" }, marker);
        assert.deepEqual(result, []);
      }
    }
    assert.equal(paths.size, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copied interop rejects failed setup, unavailable baseline, blocked launch, and incorrect sandbox facts", async () => {
  const config = /** @type {const} */ ({ mode: "resident", mask: "masked" });
  for (const options of [{ setup: false }, { baseline: false }, { escaped: false }, { marker: false }, { markerValue: "incorrect" }, { enforcement: "full" }, { scope: "per-command" }]) {
    assert.notDeepEqual(await checkCopiedInterop({ ...config, ...options }), []);
  }
});

/**
 * Run the suite summarizer against synthetic results.
 * @param {string} suite - Comma-separated expected probe names.
 * @param {string | undefined} results - Tab-separated results-file contents.
 */
function summarize(suite, results) {
  const dir = mkdtempSync(join(tmpdir(), "wsl-probe-summary-"));
  try {
    const resultsPath = join(dir, "results.txt");
    if (results !== undefined) writeFileSync(resultsPath, results);
    return spawnSync("node", [join(root, "test", "probe", "summarize-probes.mjs"), "--suite", suite, resultsPath], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

shellTest("summarizer reports a full pass only when every suite entry passed", () => {
  const result = summarize("a.sh,b.sh", "PASS\ta.sh\nPASS\tb.sh\n");
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /pass 2, fail 0, skipped 0, not run 0/);
  assert.match(result.stdout, /FULL PASS/);
});

shellTest("summarizer keeps failures and skips distinguishable", () => {
  const result = summarize("a.sh,b.sh,c.sh,d.sh", "PASS\ta.sh\nFAIL\tb.sh\t3\nSKIP\tc.sh\tbwrap missing\n");
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /pass 1, fail 1, skipped 1, not run 1/);
  assert.match(result.stdout, /skipped — bwrap missing/);
  assert.match(result.stdout, /NOT RUN  d\.sh/);
  assert.match(result.stdout, /INCOMPLETE RUN: 1 probe\(s\) failed/);
});

shellTest("summarizer refuses a full pass over skips or unattempted probes", () => {
  const cases = /** @type {[string, string | undefined][]} */ ([
    ["a.sh,b.sh", "PASS\ta.sh\nSKIP\tb.sh\tnode missing\n"],
    ["a.sh,b.sh", "PASS\ta.sh\n"],
    ["a.sh", undefined],
  ]);
  for (const [suite, results] of cases) {
    const result = summarize(suite, results);
    assert.equal(result.status, 2, `${suite}: ${result.stdout}`);
    assert.match(result.stdout, /did not fully run/);
  }
});

shellTest("summarizer treats a missing results file as nothing ran", () => {
  const result = summarize("a.sh", undefined);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /not run 1/);
});

/**
 * Run the real suite runner against fake probes via the offline overrides.
 * @param {{probes?: {name: string, body?: string}[]}} options - Fake suite; bodies default to exit 0.
 */
function runSuite(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wsl-probe-suite-"));
  try {
    mkdirSync(dir, { recursive: true });
    const probes = options.probes ?? [{ name: "p0.sh" }, { name: "p1.sh" }];
    for (const probe of probes) {
      const path = join(dir, probe.name);
      writeFileSync(path, `#!/usr/bin/env bash\n${probe.body ?? "exit 0"}\n`);
      chmodSync(path, 0o755);
    }
    return spawnSync("bash", [join(root, "test", "probe", "run-all-when-closed.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        WSL_PROBE_SUITE: probes.map((probe) => probe.name).join(" "),
        WSL_PROBE_DIR: dir,
        WSL_PROBE_SKIP_WAIT: "1",
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

shellTest("suite runner exits 0 and reports a full pass when every probe passes", () => {
  const result = runSuite();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /probe suite: 2 probes — pass 2, fail 0, skipped 0, not run 0/);
  assert.match(result.stderr, /FULL PASS/);
});

shellTest("suite runner exits 1 with failures distinguishable from the summary", () => {
  const result = runSuite({ probes: [{ name: "a.sh" }, { name: "b.sh", body: "echo boom >&2; exit 3" }] });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /pass 1, fail 1/);
  assert.match(result.stderr, /INCOMPLETE RUN: 1 probe\(s\) failed/);
  // The per-probe verdict with its status lives in the run's stdout/log.
  assert.match(result.stdout, /FAIL  b\.sh \(status 3\)/);
});

shellTest("suite runner records a failed prerequisite as a skip, not a pass or a failure", () => {
  const result = runSuite({
    probes: [
      { name: "a.sh", body: "# prereq: echo no bwrap here >&2; exit 1\nexit 0" },
      { name: "b.sh" },
    ],
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /pass 1, fail 0, skipped 1, not run 0/);
  assert.match(result.stderr, /SKIP  a\.sh\tskipped — no bwrap here/);
  assert.match(result.stderr, /did not fully run/);
});

shellTest("a prereq-bearing probe that satisfies its prerequisite still runs and passes", () => {
  const result = runSuite({
    probes: [{ name: "a.sh", body: "# prereq: true\nexit 0" }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /pass 1, fail 0, skipped 0, not run 0/);
});

/**
 * Run the open-in-app probe against a simulated runtime mirror and app archive.
 * @param {{bridge?: "full" | "module" | "patch" | "none", archive?: "upstream" | "patched" | "partial" | "broken" | "unknown" | "missing"}} [options] - bridge completeness and archive state.
 */
function runOpenInAppProbe({ bridge = "full", archive = "broken" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "wsl-open-in-app-probe-"));
  try {
    copyFileSync(join(root, "test", "probe", "open-in-app-patch.sh"), join(dir, "open-in-app-patch.sh"));
    writeFileSync(join(dir, "env.sh"), 'APP="$HERE/app"\nDST="$HERE/runtime"\n');
    if (bridge !== "none") {
      mkdirSync(join(dir, "runtime", "lib"), { recursive: true });
      writeFileSync(
        join(dir, "runtime", "lib", "open-in-app.js"),
        bridge === "patch" ? "" : "export function launchEnvironment() { return {}; }\n",
      );
      writeFileSync(
        join(dir, "runtime", "cordis.patch.yml"),
        bridge === "module" ? "" : "- id: wsl-open-in-app\n",
      );
    }
    if (archive !== "missing") {
      mkdirSync(join(dir, "app", "resources"), { recursive: true });
      const bodies = {
        upstream: "delete env.ELECTRON_RUN_AS_NODE\n",
        patched: "clearedElectronFlag\neditorRemoteUri\n",
        partial: "clearedElectronFlag\n",
        broken: "launchDetachedApp\n",
        unknown: "some future launcher\n",
      };
      writeFileSync(join(dir, "app", "resources", "app.asar"), bodies[archive]);
    }
    return spawnSync("bash", [join(dir, "open-in-app-patch.sh")], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

shellTest("open-in-app probe passes on the plugin bridge even when the archive is unpatched", () => {
  const broken = runOpenInAppProbe({ archive: "broken" });
  assert.equal(broken.status, 0, broken.stderr);
  assert.match(broken.stdout, /plugin bridge installed/);
  assert.match(broken.stdout, /shipped "Open in app" item still fails/);

  const upstream = runOpenInAppProbe({ archive: "upstream" });
  assert.equal(upstream.status, 0, upstream.stderr);
  assert.match(upstream.stdout, /also clears the flag upstream/);

  const patched = runOpenInAppProbe({ archive: "patched" });
  assert.equal(patched.status, 0, patched.stderr);
  assert.match(patched.stdout, /optional local archive patch/);
});

shellTest("open-in-app probe does not accept half a bridge", () => {
  for (const bridge of /** @type {Array<"module" | "patch">} */ (["module", "patch"])) {
    const result = runOpenInAppProbe({ bridge, archive: "broken" });
    assert.equal(result.status, 1, `${bridge} alone must not count as the bridge: ${result.stdout}`);
    assert.match(result.stdout, /no plugin bridge/);
  }
});

shellTest("open-in-app probe accepts an upstream fix or a complete historical patch without the bridge", () => {
  const upstream = runOpenInAppProbe({ bridge: "none", archive: "upstream" });
  assert.equal(upstream.status, 0, upstream.stderr);
  assert.match(upstream.stdout, /clears the flag upstream \(plugin bridge not found\)/);

  const patched = runOpenInAppProbe({ bridge: "none", archive: "patched" });
  assert.equal(patched.status, 0, patched.stderr);
  assert.match(patched.stdout, /historical local archive patch present/);
});

shellTest("open-in-app probe fails closed on a partial patch, a broken launcher, or an unknown layout", () => {
  const partial = runOpenInAppProbe({ bridge: "none", archive: "partial" });
  assert.equal(partial.status, 1, partial.stdout);
  assert.match(partial.stdout, /partial historical archive patch/);
  assert.match(partial.stdout, /update\/sync the plugin/);

  const broken = runOpenInAppProbe({ bridge: "none", archive: "broken" });
  assert.equal(broken.status, 1, broken.stdout);
  assert.match(broken.stdout, /no plugin bridge and the shipped launcher does not clear/);
  assert.match(broken.stdout, /do not patch app\.asar/);

  const unknown = runOpenInAppProbe({ bridge: "none", archive: "unknown" });
  assert.equal(unknown.status, 2, unknown.stdout);
  assert.match(unknown.stdout, /layout changed/);

  const missing = runOpenInAppProbe({ bridge: "none", archive: "missing" });
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /no app archive/);
});
