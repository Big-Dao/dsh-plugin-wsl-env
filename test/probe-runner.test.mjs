import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
