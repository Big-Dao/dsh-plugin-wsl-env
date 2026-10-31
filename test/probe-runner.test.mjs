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
