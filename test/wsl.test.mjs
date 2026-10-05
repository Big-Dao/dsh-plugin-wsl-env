/**
 * Assertion checks for the `wsl.exe` interop primitives' spawning half: the
 * capture deadline that keeps a wedged WSL service from hanging a tool call
 * forever, and the abort path staying cancellation rather than looking like a
 * deadline.
 *
 * The resolution helpers around `runCapture` are thin argv builders covered by
 * the probe suite (`test/probe/*.sh`) against a real distro; only the deadline
 * semantics need a unit here. `process.execPath` plays the executable, so the
 * checks run on both platform families.
 *
 *   node test/wsl.test.mjs
 */
import assert from "node:assert/strict";
import { runCapture, DEFAULT_WSL_DEADLINE_MS, parseDistroList, parseHomePath } from "../lib/wsl.js";

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

for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} wsl checks pass`);
