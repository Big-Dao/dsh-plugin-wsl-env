/**
 * Assertion checks for the shell-family flag selection. `lib/wsl.js` imports
 * only Node builtins and `paths.js`, so this runs without the DSH peers.
 *
 *   node test/shell.test.mjs
 */
import assert from "node:assert/strict";
import { shellArgs, wslErrorCode } from "../lib/wsl.js";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

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

console.log(`\n${passed} checks passed`);
