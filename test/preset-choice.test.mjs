/**
 * Assertion checks for the session-preset decision. Pure module, no peers, so this
 * runs everywhere including CI.
 *
 * Not covered here: the frame in which the decision is applied while a session is
 * created, and the retry loop around `select()`. Those need a boot.
 *
 *   node test/preset-choice.test.mjs
 */
import assert from "node:assert/strict";
import { shouldAdoptWslPreset } from "../lib/preset-choice.js";

let passed = 0;
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

const DISTRO_CWD = "\\\\wsl.localhost\\ubuntu\\home\\you\\project";
const WINDOWS_CWD = "C:\\Users\\you\\project";

check("a distro workspace with no preset of its own adopts the WSL preset", () => {
  assert.equal(shouldAdoptWslPreset({ cwd: DISTRO_CWD, current: undefined, fallback: "host" }), true);
});

check("a distro workspace still on the registry default adopts it", () => {
  assert.equal(shouldAdoptWslPreset({ cwd: DISTRO_CWD, current: "host", fallback: "host" }), true);
});

check("an explicit choice is left alone", () => {
  assert.equal(shouldAdoptWslPreset({ cwd: DISTRO_CWD, current: "wsl", fallback: "host" }), false);
  assert.equal(shouldAdoptWslPreset({ cwd: DISTRO_CWD, current: "other", fallback: "host" }), false);
});

check("a Windows workspace keeps its environment", () => {
  assert.equal(shouldAdoptWslPreset({ cwd: WINDOWS_CWD, current: undefined, fallback: "host" }), false);
  assert.equal(shouldAdoptWslPreset({ cwd: WINDOWS_CWD, current: "host", fallback: "host" }), false);
});

check("a missing workspace is not a distro workspace", () => {
  assert.equal(shouldAdoptWslPreset({ cwd: undefined, current: undefined, fallback: "host" }), false);
  assert.equal(shouldAdoptWslPreset({}), false);
});

console.log(`\n${passed} checks passed`);
