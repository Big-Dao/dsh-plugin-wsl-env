/**
 * Assertion checks for the session-scoped sandbox launcher's pure builders
 * (ADR 0001): the unit name, the systemd-run prefix, the stop argv and the
 * preflight probe. No systemd is needed; the runtime itself is the manual
 * probe's territory (`test/probe/session-sandbox.sh`).
 *
 *   node test/session-scope.test.mjs
 */
import assert from "node:assert/strict";
import {
  sessionScopePrefix,
  sessionScopeProblem,
  sessionScopeProbeArgv,
  sessionScopeProbeScript,
  sessionScopeStopArgv,
  sessionScopeUnit,
} from "../lib/session-scope.js";

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

check("the unit name is deterministic, sanitized and component-capped", () => {
  assert.equal(sessionScopeUnit("ubuntu", "abc123"), "dsh-wsl-ubuntu-abc123");
  assert.equal(sessionScopeUnit("my distro/ä", "a:b"), "dsh-wsl-my_distro__-a_b");
  assert.equal(sessionScopeUnit("", ""), "dsh-wsl-distro-session", "empty components fall back");
  const long = "x".repeat(200);
  const unit = sessionScopeUnit(long, long);
  assert.equal(unit.length, "dsh-wsl-".length + 64 + 1 + 64, "each component is capped at 64 characters");
  assert.match(unit, /^[A-Za-z0-9_.-]+$/, "only characters systemd accepts in a unit name");
});

check("the scope prefix puts systemd-run between wsl.exe and the agent argv", () => {
  assert.deepEqual(sessionScopePrefix("dsh-wsl-ubuntu-abc"), [
    "systemd-run", "--user", "--scope", "--quiet", "--unit", "dsh-wsl-ubuntu-abc", "--",
  ]);
});

check("the stop argv asks the user manager to stop the unit", () => {
  assert.deepEqual(sessionScopeStopArgv({ wslPath: "wsl.exe", distro: "ubuntu", unit: "u" }), [
    "wsl.exe", "-d", "ubuntu", "--exec", "systemctl", "--user", "stop", "u",
  ]);
  assert.deepEqual(sessionScopeStopArgv({ wslPath: "wsl.exe", distro: "", unit: "u" }), [
    "wsl.exe", "--exec", "systemctl", "--user", "stop", "u",
  ], "an empty distro leaves the default distro to wsl.exe");
});

check("the preflight script names each gate and its remedy", () => {
  const script = sessionScopeProbeScript();
  assert.match(script, /\[ -d \/run\/systemd\/system \]/);
  assert.match(script, /echo no-systemd/);
  assert.match(script, /systemctl --user is-system-running/);
  assert.match(script, /echo no-user-manager/);
  assert.match(script, /command -v systemd-run/);
  assert.match(script, /echo no-systemd-run/);
  assert.match(script, /Linger=yes/);
  assert.match(script, /echo no-linger/);
  assert.match(script, /echo ok$/);
  assert.equal(script.split("\n").length, 6, "one line per gate plus the success line");
});

check("the preflight argv runs that script through the distro's sh", () => {
  const argv = sessionScopeProbeArgv({ wslPath: "wsl.exe", distro: "ubuntu" });
  assert.deepEqual(argv.slice(0, 6), ["wsl.exe", "-d", "ubuntu", "--exec", "sh", "-c"]);
  assert.equal(argv[6], sessionScopeProbeScript());
  const bare = sessionScopeProbeArgv({ wslPath: "wsl.exe", distro: "" });
  assert.deepEqual(bare.slice(0, 4), ["wsl.exe", "--exec", "sh", "-c"]);
});


check("the preflight verdict maps to a remedy", () => {
  assert.equal(sessionScopeProblem({ output: { stdout: "ok\n" }, distro: "ubuntu" }), null);
  assert.match(sessionScopeProblem({ output: { stdout: "no-systemd" }, distro: "ubuntu" }) ?? "", /wsl\.conf/);
  assert.match(sessionScopeProblem({ output: { stdout: "no-user-manager" }, distro: "ubuntu" }) ?? "", /user manager/);
  assert.match(sessionScopeProblem({ output: { stdout: "no-systemd-run" }, distro: "ubuntu" }) ?? "", /systemd-run/);
  assert.match(sessionScopeProblem({ output: { stdout: "no-linger" }, distro: "ubuntu" }) ?? "", /loginctl enable-linger/);
  const failed = sessionScopeProblem({ output: { stdout: "", error: "wsl.exe failed: boom" }, distro: "ubuntu" }) ?? "";
  assert.match(failed, /preflight/);
  assert.match(failed, /boom/);
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} session-scope checks pass`);
