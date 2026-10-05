/**
 * Assertion checks for the root-plane routing filesystem's pure predicates
 * and path helpers. The class itself needs the DSH peers and a live distro —
 * covered by the probes and the GUI.
 *
 *   node test/fs-routing.test.mjs
 */
import assert from "node:assert/strict";
import { targetIsDistro, inputIsDistro } from "../lib/fs-routing.js";
import { linuxJoin } from "../lib/workspace-files-route.js";

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

check("targetIsDistro reads the target identity", () => {
  assert.equal(targetIsDistro("\\\\wsl.localhost\\ubuntu\\home\\x"), true);
  assert.equal(targetIsDistro("\\\\wsl$\\debian\\srv"), true);
  assert.equal(targetIsDistro("C:\\proj\\a.ts"), false);
  assert.equal(targetIsDistro("/home/x"), false);
});

check("inputIsDistro names the distro for UNC inputs only", () => {
  assert.equal(inputIsDistro("\\\\wsl.localhost\\ubuntu\\home\\x"), true);
  assert.equal(inputIsDistro(undefined), false);
  assert.equal(inputIsDistro("C:\\proj"), false);
});

check("linuxJoin resolves UNC absolutes, POSIX absolutes, and relatives", () => {
  assert.equal(linuxJoin("/home/andy/proj", "src/a.ts"), "/home/andy/proj/src/a.ts");
  assert.equal(linuxJoin("/home/andy/proj", "\\\\wsl.localhost\\ubuntu\\etc\\hosts"), "/etc/hosts");
  assert.equal(linuxJoin("/home/andy/proj", "/etc/hosts"), "/etc/hosts", "a POSIX absolute wins over the root");
  assert.equal(linuxJoin("/home/andy/proj", ""), "/home/andy/proj");
  assert.equal(linuxJoin("/home/andy/proj", "."), "/home/andy/proj", "dot segments normalize to the root");
  assert.equal(linuxJoin("/", "etc"), "/etc", "the root mount joins without a double slash");
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} fs-routing checks pass`);
