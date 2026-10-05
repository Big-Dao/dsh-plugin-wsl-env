/**
 * Assertion checks for the shell-family flag selection. `lib/wsl.js` imports
 * only Node builtins and `paths.js`, so this runs without the DSH peers.
 *
 *   node test/shell.test.mjs
 */
import assert from "node:assert/strict";
import { shellArgs, workdirFailure, wslErrorCode } from "../lib/wsl.js";
import { toLinuxPath } from "../lib/paths.js";

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

check("regression: a UNC workdir converts to the distro path before reaching the agent's chdir", () => {
  // The agent carries the workdir as a frame field, so the conversion the
  // one-shot argv() performs inline has to happen at the call site. A raw UNC
  // reaching chdir fails every shell call from a GUI session — this pins the
  // conversion the executor relies on.
  assert.equal(
    toLinuxPath("\\\\wsl.localhost\\ubuntu\\home\\andy\\proj", { distro: "ubuntu" }),
    "/home/andy/proj",
  );
});

check("the POSIX family gets login + command when asked", () => {
  for (const shell of ["/bin/sh", "/usr/bin/bash", "/bin/dash", "/usr/bin/zsh", "/bin/ksh", "/bin/ash"]) {
    assert.deepEqual(shellArgs(shell, true), ["-lc"], `${shell} should accept -lc`);
  }
});

check("the POSIX family drops -l when login semantics are off", () => {
  assert.deepEqual(shellArgs("/usr/bin/zsh", false), ["-c"]);
  assert.deepEqual(shellArgs("/bin/bash", false), ["-c"]);
});

check("non-POSIX shells never get -l, even when login is requested", () => {
  // csh/tcsh signal login through argv[0]; fish/nu/xonsh take other flags.
  for (const shell of ["/usr/bin/fish", "/bin/csh", "/bin/tcsh", "/usr/bin/nu", "/usr/bin/xonsh", "/usr/bin/pwsh"]) {
    assert.deepEqual(shellArgs(shell, true), ["-c"], `${shell} must not receive -l`);
  }
});

check("a bare name without a directory still resolves its family", () => {
  assert.deepEqual(shellArgs("bash", true), ["-lc"]);
  assert.deepEqual(shellArgs("fish", true), ["-c"]);
});

check("case does not change the family", () => {
  assert.deepEqual(shellArgs("/usr/bin/ZSH", true), ["-lc"]);
});

check("a WSL error code is found however it is encoded", () => {
  // A missing distro puts this on stdout: exit 255, empty stderr. Some builds
  // encode it UTF-16LE, which reads back as UTF-8 with a NUL between every byte.
  assert.equal(wslErrorCode("Wsl/Service/WSL_E_DISTRO_NOT_FOUND", ""), "WSL_E_DISTRO_NOT_FOUND");
  const utf16 = Buffer.from("Wsl/Service/WSL_E_DISTRO_NOT_FOUND", "utf16le").toString("utf8");
  assert.equal(wslErrorCode("", utf16), "WSL_E_DISTRO_NOT_FOUND");
});

check("output without a WSL error code reports none", () => {
  assert.equal(wslErrorCode("hello", "world"), undefined);
  assert.equal(wslErrorCode(undefined, undefined), undefined);
  assert.equal(wslErrorCode("WSL_E_", ""), undefined);
});

check("the relay's workdir failure is recognised", () => {
  const stderr = "<3>WSL (269223 - Relay) ERROR: CreateProcessCommon:809: chdir(/definitely/not/here) failed 2";
  assert.equal(workdirFailure("hi", stderr), "/definitely/not/here");
  // Read as UTF-16 the same line arrives with NULs between the bytes.
  const utf16 = Buffer.from(stderr, "utf16le").toString("utf8");
  assert.equal(workdirFailure("", utf16), "/definitely/not/here");
});

check("a command's own chdir message is not mistaken for the relay's", () => {
  assert.equal(workdirFailure("done", "chdir(/x) failed"), undefined);
  assert.equal(workdirFailure("", "CreateProcessCommon: chdir(/x) failed"), undefined);
  assert.equal(workdirFailure("hi", ""), undefined);
});

console.log(`\n${passed} checks passed`);
