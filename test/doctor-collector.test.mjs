/**
 * The doctor collector's bounded transport: deadline, output cap, abort and
 * the drain window after the child exits.
 *
 * `doctorReport` spawns the standalone doctor CLI; a hung or runaway doctor
 * used to be indistinguishable from a slow one before the collector grew
 * these bounds. The in-app `wsl_doctor` tool and `/wsl-doctor` both await this
 * path, so a missing bound wedges a tool call, not just a diagnostic. The
 * checks here run fake doctor scripts — no distro, no real doctor — and
 * assert that every failure is named and settles on time.
 *
 *   node test/doctor-collector.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorReport } from "../lib/doctor-report.js";
import { runDoctorProcess } from "../lib/doctor-process.js";

const scratch = mkdtempSync(join(tmpdir(), "dsh-doctor-collector-"));
const REPORT = JSON.stringify({ schemaVersion: 2, checks: [], summary: {} });

/**
 * Write one fake doctor script and return its path.
 * @param {string} name - the fixture file name.
 * @param {string} body - the script body (ES module).
 * @returns {string} the absolute script path.
 */
function fakeDoctor(name, body) {
  const path = join(scratch, name);
  writeFileSync(path, body);
  return path;
}

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

check("a doctor that never exits is killed at the deadline and named", async () => {
  const script = fakeDoctor("hang.mjs", "setInterval(() => {}, 1000);\n");
  const started = Date.now();
  await assert.rejects(
    () => doctorReport("ubuntu", { doctorPath: script, timeoutMs: 150 }),
    /doctor run failed: timed out after 150ms/,
    "the deadline is the named cause",
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `the collector settled promptly (${elapsed}ms)`);
});

check("a multi-byte code point split across chunks is reassembled", async () => {
  // The command runner used to decode each chunk with toString("utf8"); a
  // UTF-8 sequence split at a chunk boundary became replacement characters.
  // The shared collector decodes through StringDecoder (setEncoding), which
  // holds the partial sequence until the rest arrives.
  const script = fakeDoctor("split.mjs", `
const bytes = Buffer.from("报告");
process.stdout.write(bytes.subarray(0, 1));
setTimeout(() => { process.stdout.write(bytes.subarray(1)); process.exit(0); }, 20);
`);
  const run = await runDoctorProcess([script], { timeoutMs: 10_000 });
  assert.equal(run.stdout, "报告");
  assert.equal(run.timedOut, false);
});

check("a runaway stream is capped, killed and named", async () => {
  // > DOCTOR_OUTPUT_LIMIT_BYTES (4 MiB); the collector kills on crossing it.
  const script = fakeDoctor("flood.mjs", `process.stdout.write("x".repeat(5 * 1024 * 1024));\nsetInterval(() => {}, 1000);\n`);
  const started = Date.now();
  await assert.rejects(
    () => doctorReport("ubuntu", { doctorPath: script, timeoutMs: 10_000 }),
    /doctor run failed: produced more than 4194304 bytes/,
    "the output cap is the named cause, not the deadline",
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `the cap settles the run (${elapsed}ms)`);
});

check("the caller's abort is carried as its own failure", async () => {
  const script = fakeDoctor("abort.mjs", "setInterval(() => {}, 1000);\n");
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(
    () => doctorReport("ubuntu", { doctorPath: script, timeoutMs: 10_000, signal: controller.signal }),
    /doctor run failed: doctor run aborted/,
    "an abort reads as cancellation, not as a deadline",
  );
});

check("a valid report settles at exit instead of waiting for the pipes", async () => {
  const script = fakeDoctor("quick.mjs", `process.stdout.write(${JSON.stringify(REPORT)});\n`);
  const started = Date.now();
  const report = await doctorReport("ubuntu", { doctorPath: script, timeoutMs: 10_000 });
  const elapsed = Date.now() - started;
  assert.equal(report.schemaVersion, 2, "the report is parsed");
  assert.ok(elapsed < 2000, `a quick doctor does not wait for the deadline (${elapsed}ms)`);
});

check("a grandchild holding the pipes cannot stall the collector", async () => {
  // The parent reports and exits; the detached grandchild inherits the pipes
  // and stays alive. The collector must settle on exit + the drain window.
  const script = fakeDoctor("leaky.mjs", [
    `import { spawn } from "node:child_process";`,
    `process.stdout.write(${JSON.stringify(REPORT)});`,
    `const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], { detached: true, stdio: ["ignore", "inherit", "inherit"] });`,
    `child.unref();`,
    `process.exit(0);`,
  ].join("\n") + "\n");
  const started = Date.now();
  const report = await doctorReport("ubuntu", { doctorPath: script, timeoutMs: 10_000 });
  const elapsed = Date.now() - started;
  assert.equal(report.schemaVersion, 2, "the report exits before the pipes close and is still parsed");
  assert.ok(elapsed >= 400, `the bounded drain window ran (${elapsed}ms)`);
  assert.ok(elapsed < 3000, `the inherited pipes did not hold the collector (${elapsed}ms)`);
});

check("a doctor that exits with no report names the exit, not a parse error", async () => {
  const script = fakeDoctor("empty.mjs", "process.stderr.write('boom\\n'); process.exit(3);\n");
  await assert.rejects(
    () => doctorReport("ubuntu", { doctorPath: script, timeoutMs: 10_000 }),
    /doctor run failed: exited with code 3 — boom/,
    "the transport failure carries the stderr tail",
  );
});

let failed = 0;
for (const [name, fn] of checks) await runCheck(name, fn);
failed = checks.length - passed;
rmSync(scratch, { recursive: true, force: true });
console.log(`\n${passed}/${checks.length} doctor-collector checks pass`);
if (failed > 0) process.exitCode = 1;
