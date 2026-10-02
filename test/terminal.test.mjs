/**
 * Assertion checks for the interactive-terminal helpers that
 * `lib/subprocess.js` composes into a `wsl.exe` launch. `lib/wsl.js` imports
 * only Node builtins and `paths.js`, so this runs without the DSH peers that
 * the provider module itself needs.
 *
 *   node test/terminal.test.mjs
 */
import assert from "node:assert/strict";
import { interactiveShellArgs, wslEnvValue, wslTerminalArgv } from "../lib/wsl.js";
import { terminalRoute } from "../lib/terminal-route.js";

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

check("with no pinned shell, wsl.exe starts the distro's own login shell", () => {
  assert.deepEqual(
    wslTerminalArgv({ wslPath: "wsl.exe", distro: "ubuntu", linuxCwd: "/home/andy/proj" }),
    ["wsl.exe", "-d", "ubuntu", "--cd", "/home/andy/proj"],
  );
});

check("a pinned shell is named after --exec, never with -lc", () => {
  assert.deepEqual(
    wslTerminalArgv({
      wslPath: "wsl.exe",
      distro: "ubuntu",
      shellPath: "/bin/bash",
      args: ["-i"],
      linuxCwd: "/home/andy/proj",
      login: true,
    }),
    ["wsl.exe", "-d", "ubuntu", "--cd", "/home/andy/proj", "--exec", "/bin/bash", "-l", "-i"],
  );
});

check("an empty distro leaves -d out, so WSL's default applies", () => {
  assert.deepEqual(
    wslTerminalArgv({ wslPath: "wsl.exe", distro: "", shellPath: "/bin/zsh", args: ["-i"], linuxCwd: "/home/andy" }),
    ["wsl.exe", "--cd", "/home/andy", "--exec", "/bin/zsh", "-l", "-i"],
  );
});

check("an unknown directory drops --cd rather than passing an empty argument", () => {
  assert.deepEqual(wslTerminalArgv({ wslPath: "wsl.exe", distro: "ubuntu", linuxCwd: "" }), [
    "wsl.exe",
    "-d",
    "ubuntu",
  ]);
});

check("the POSIX family gets -l for an interactive login shell", () => {
  for (const shell of ["/bin/sh", "/usr/bin/bash", "/bin/dash", "/usr/bin/zsh", "/bin/ksh", "/bin/ash"]) {
    assert.deepEqual(interactiveShellArgs(shell, true), ["-l"], `${shell} should accept -l`);
  }
});

check("login off means no flags at all, never -lc", () => {
  for (const shell of ["/bin/bash", "/usr/bin/zsh", "/usr/bin/fish"]) {
    assert.deepEqual(interactiveShellArgs(shell, false), []);
  }
});

check("fish takes -l even though it rejects -lc", () => {
  assert.deepEqual(interactiveShellArgs("/usr/bin/fish", true), ["-l"]);
});

check("shells whose login spelling differs get no flag", () => {
  // csh/tcsh signal login through argv[0]; nu/xonsh use long flags.
  for (const shell of ["/bin/csh", "/bin/tcsh", "/usr/bin/nu", "/usr/bin/xonsh", "/usr/bin/pwsh"]) {
    assert.deepEqual(interactiveShellArgs(shell, true), [], `${shell} must not receive -l`);
  }
});

check("Windows-path facts get WSLENV's /p translation", () => {
  assert.equal(wslEnvValue(["DSH_SESSION_ID"]), "DSH_SESSION_ID");
  assert.equal(wslEnvValue(["DSH_HOME", "TERM"]), "DSH_HOME/p:TERM");
  assert.equal(wslEnvValue(["DSH_PROFILE_DIR", "DSH_WSL_HOME"]), "DSH_PROFILE_DIR/p:DSH_WSL_HOME");
});

check("terminal routing: WSL workspaces get the distro, Windows folders get the host", () => {
  assert.equal(terminalRoute("\\\\wsl.localhost\\ubuntu\\home\\andy\\proj"), "distro");
  assert.equal(terminalRoute("/home/andy/proj"), "distro");
  assert.equal(terminalRoute(""), "distro", "no evidence defaults to the pinned distro");
  assert.equal(terminalRoute("C:\\Users\\you\\project"), "host");
});

console.log(`\n${passed} checks passed`);
