/**
 * Assertion checks for the `wsl.exe` interop primitives' spawning half: the
 * capture deadline that keeps a wedged WSL service from hanging a tool call
 * forever, the abort path staying cancellation rather than looking like a
 * deadline, and the process-level single-flight cache behind the distro's
 * home and login-shell probes. `process.execPath` plays the executable, so the
 * deadline checks run on both platform families; the cache checks need a
 * POSIX-executable fake and skip on Windows.
 *
 *   node test/wsl.test.mjs
 */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_WSL_DEADLINE_MS,
  defaultShell,
  linuxHomePath,
  parseDistroList,
  parseHomePath,
  resetWslProbeCacheForTests,
  runCapture,
  runCaptureRaw,
} from "../lib/wsl.js";

/**
 * A Node child that outlives any deadline the checks use.
 * @param {number} ms - how long the child sleeps.
 * @returns {string[]} the argv of a child that outlives the deadline.
 */
const slow = (ms) => [process.execPath, "-e", `setTimeout(() => {}, ${ms})`];
const immediate = () => [process.execPath, "-e", "process.stdout.write('done')"];

let passed = 0;
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];

checks.push(["a capture resolves with the child's stdout", async () => {
  const stdout = await runCapture(immediate());
  assert.equal(stdout, "done");
}]);

checks.push(["an empty argv is refused before anything spawns", () => {
  assert.throws(() => runCapture([]), /needs a program to run/);
}]);

checks.push(["a hung call dies at the deadline, named as a wedged service", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    () => runCapture(slow(60_000), undefined, 250),
    (error) => {
      assert.match(/** @type {Error} */ (error).message, /no completion within 250ms/, "the deadline is named");
      assert.match(/** @type {Error} */ (error).message, /wsl\.exe --shutdown/, "the remedy is named");
      return true;
    },
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 5_000, `the kill took ${elapsed}ms — the deadline must be a deadline`);
}]);

checks.push(["an abort is cancellation, not a deadline report", async () => {
  const controller = new AbortController();
  const pending = runCapture(slow(60_000), controller.signal, 60_000);
  queueMicrotask(() => controller.abort(new Error("teardown")));
  await assert.rejects(
    () => pending,
    (error) => {
      assert.equal((/** @type {Error} */ (error)).name, "AbortError", "the abort keeps its own error shape");
      assert.ok(!/no completion within/.test(/** @type {Error} */ (error).message), "no deadline wording on a cancellation");
      return true;
    },
  );
}]);

checks.push(["the default deadline is finite — nothing waits forever by accident", () => {
  assert.ok(DEFAULT_WSL_DEADLINE_MS > 0 && DEFAULT_WSL_DEADLINE_MS <= 120_000, `got ${DEFAULT_WSL_DEADLINE_MS}`);
}]);

check("parseDistroList reads CRLF, blank lines, and keeps WSL's own order", () => {
  assert.deepEqual(parseDistroList("ubuntu\r\n\r\nDebian-22\r\n"), ["ubuntu", "Debian-22"], "CRLF and blanks are transport noise");
  assert.deepEqual(parseDistroList(""), []);
  assert.deepEqual(parseDistroList("  spaced  \n"), ["spaced"]);
});

check("parseHomePath accepts a Linux home and refuses empty or Windows answers", () => {
  assert.equal(parseHomePath("ubuntu", "/home/andy"), "/home/andy");
  assert.throws(() => parseHomePath("ubuntu", ""), /no usable \$HOME/);
  assert.throws(() => parseHomePath("ubuntu", "C:\\Users\\x"), /no usable \$HOME/, "a Windows answer is not a home");
});

checks.push(["a denied capture names the sandbox cause", async () => {
  await assert.rejects(
    () => runCapture(["sh", "-c", "echo E_ACCESSDENIED >&2; exit 1"]),
    (error) => /WSL is unreachable from a sandboxed process/.test(/** @type {Error} */ (error).message),
    "the low-integrity-token remedy is named",
  );
}]);

checks.push(["an unstartable executable names the wslPath remedy", async () => {
  await assert.rejects(
    () => runCapture(["/nonexistent-dsh-wsl-binary"]),
    (error) => /could not be started/.test(/** @type {Error} */ (error).message) && /wslPath/.test(/** @type {Error} */ (error).message),
  );
}]);

checks.push(["an aborted capture is cancellation, not a wedged service", async () => {
  const controller = new AbortController();
  const pending = runCapture(slow(60_000), controller.signal, 60_000);
  setTimeout(() => controller.abort(new Error("caller cancelled")), 100);
  await assert.rejects(
    () => pending,
    (error) => !/no completion within/.test(/** @type {Error} */ (error).message),
    "the deadline hint stays off an abort",
  );
}]);

checks.push(["runCapture strips NUL bytes from UTF-16LE diagnostics", async () => {
  const nul = ["a", "b", "c"].join("\u0000");
  const out = await runCapture([process.execPath, "-e", `process.stdout.write(${JSON.stringify(nul)})`]);
  assert.equal(out, "abc", "the UTF-16LE diagnostic spelling collapses to its text");
}]);

checks.push(["runCaptureRaw preserves NUL separators", async () => {
  const nul = ["/home/andy/a", "/home/andy/b", ""].join("\u0000");
  const out = await runCaptureRaw([process.execPath, "-e", `process.stdout.write(${JSON.stringify(nul)})`]);
  assert.equal(out, nul, "a find -print0 listing keeps its separators");
}]);

// ── the shared split cache behind the home/shell probes ──────────────────────

const probeDir = mkdtempSync(join(tmpdir(), "dsh-wsl-probe-"));
const fakeWsl = join(probeDir, "wsl.exe");
writeFileSync(fakeWsl, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_WSL_LOG, args.join(" ") + "\\n");
if (Number(process.env.FAKE_WSL_DELAY ?? 0) > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_WSL_DELAY));
if (process.env.FAKE_WSL_FAIL === "1") { process.stderr.write("probe failed\\n"); process.exit(1); }
const script = args[args.length - 1] ?? "";
if (script.includes("getent")) { process.stdout.write(process.env.FAKE_WSL_SHELL ?? "/bin/bash"); process.exit(0); }
if (script.includes("SHELL")) { process.stdout.write(process.env.FAKE_WSL_SHELL ?? "/bin/bash"); process.exit(0); }
process.stdout.write(process.env.FAKE_WSL_HOME ?? "/home/andy");
`);
chmodSync(fakeWsl, 0o755);
process.on("exit", () => rmSync(probeDir, { recursive: true, force: true }));

/**
 * Point the fake at a fresh log and clear the process-level probe cache.
 * @returns {string} the log path.
 */
const freshProbeLog = () => {
  resetWslProbeCacheForTests();
  delete process.env.FAKE_WSL_FAIL;
  delete process.env.FAKE_WSL_DELAY;
  const log = join(probeDir, "probe.log");
  writeFileSync(log, "");
  process.env.FAKE_WSL_LOG = log;
  return log;
};

/**
 * The fake's argv log as lines.
 * @param {string} log - the log path.
 * @returns {string[]} one entry per spawn.
 */
const probeLines = (log) => readFileSync(log, "utf8").split("\n").filter(Boolean);

checks.push(["a distro's home is resolved once per process, not once per call site", async () => {
  if (process.platform === "win32") {
    console.log("SKIP  the process-level probe cache (the fake wsl.exe is a POSIX executable)");
    return;
  }
  const log = freshProbeLog();
  assert.equal(await linuxHomePath("ubuntu", { wslPath: fakeWsl }), "/home/andy");
  assert.equal(await linuxHomePath("ubuntu", { wslPath: fakeWsl }), "/home/andy");
  assert.equal(probeLines(log).length, 1, "the second call reused the shared probe");
  assert.equal(await linuxHomePath("debian", { wslPath: fakeWsl }), "/home/andy");
  assert.equal(probeLines(log).length, 2, "a different distro is its own probe");
}]);

checks.push(["concurrent callers share one in-flight probe", async () => {
  if (process.platform === "win32") {
    console.log("SKIP  single-flight (the fake wsl.exe is a POSIX executable)");
    return;
  }
  const log = freshProbeLog();
  const [first, second] = await Promise.all([
    linuxHomePath("ubuntu", { wslPath: fakeWsl }),
    linuxHomePath("ubuntu", { wslPath: fakeWsl }),
  ]);
  assert.equal(first, "/home/andy");
  assert.equal(second, "/home/andy");
  assert.equal(probeLines(log).length, 1, "the second caller joined the in-flight probe");
}]);

checks.push(["one caller's abort does not kill the shared probe for the others", async () => {
  if (process.platform === "win32") {
    console.log("SKIP  shared-probe abort isolation (the fake wsl.exe is a POSIX executable)");
    return;
  }
  const log = freshProbeLog();
  process.env.FAKE_WSL_DELAY = "150";
  try {
    const controller = new AbortController();
    const first = linuxHomePath("ubuntu", { wslPath: fakeWsl, signal: controller.signal });
    const second = linuxHomePath("ubuntu", { wslPath: fakeWsl });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(first, /abort/i);
    assert.equal(await second, "/home/andy", "the other caller's probe survives the first caller's cancellation");
    assert.equal(probeLines(log).length, 1);
  } finally {
    delete process.env.FAKE_WSL_DELAY;
  }
}]);

checks.push(["a failed home probe stays retryable", async () => {
  if (process.platform === "win32") {
    console.log("SKIP  failed-probe retry (the fake wsl.exe is a POSIX executable)");
    return;
  }
  const log = freshProbeLog();
  process.env.FAKE_WSL_FAIL = "1";
  await assert.rejects(() => linuxHomePath("ubuntu", { wslPath: fakeWsl }), /probe failed/);
  delete process.env.FAKE_WSL_FAIL;
  assert.equal(await linuxHomePath("ubuntu", { wslPath: fakeWsl }), "/home/andy");
  assert.equal(probeLines(log).length, 2, "the failure was not cached");
}]);

checks.push(["a confirmed login shell is cached, an unresolved one is retried", async () => {
  if (process.platform === "win32") {
    console.log("SKIP  the login-shell cache (the fake wsl.exe is a POSIX executable)");
    return;
  }
  const log = freshProbeLog();
  assert.equal(await defaultShell("ubuntu", { wslPath: fakeWsl }), "/bin/bash");
  assert.equal(await defaultShell("ubuntu", { wslPath: fakeWsl }), "/bin/bash");
  assert.equal(probeLines(log).length, 1, "the confirmed shell was resolved once");
  process.env.FAKE_WSL_FAIL = "1";
  resetWslProbeCacheForTests();
  assert.equal(await defaultShell("debian", { wslPath: fakeWsl }), undefined, "both probes failed");
  delete process.env.FAKE_WSL_FAIL;
  assert.equal(await defaultShell("debian", { wslPath: fakeWsl }), "/bin/bash");
  assert.equal(probeLines(log).length, 4, "the unresolved answer was not cached: two failed asks, then one retry");
}]);

for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} wsl checks pass`);
