/**
 * Assertion checks for the file-search spawn routing — the pure decision that
 * sends the search tool's packaged ripgrep into the distro instead of across
 * the 9p share, extracted from the subprocess provider so it has unit tests of
 * its own (the same shape as `terminal-route.js`, whose decision this mirrors
 * for the other rewritten launch).
 *
 * Not covered here: the provider wiring that applies the rewrite
 * (`lib/subprocess.js` imports the DSH peers) — that remains the probes'
 * territory.
 *
 *   node test/search-route.test.mjs
 */
import assert from "node:assert/strict";
import { isSearchProgram, searchSpawnRewrite } from "../lib/search-route.js";

let passed = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

const PACKAGED_RG = "C:\\app\\resources\\@vscode\\ripgrep\\bin\\rg.exe";
const WORKSPACE = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj";

check("isSearchProgram judges the program by its own name", () => {
  assert.equal(isSearchProgram("rg"), true);
  assert.equal(isSearchProgram(PACKAGED_RG), true, "the packaged binary's absolute path matches");
  assert.equal(isSearchProgram("/usr/bin/rg"), true, "a POSIX absolute path matches");
  assert.equal(isSearchProgram("RG.EXE"), true, "the name is judged case-insensitively");
  assert.equal(isSearchProgram("rgi"), false, "a longer name is not rg");
  assert.equal(isSearchProgram("ripgrep"), false, "the project name is not the binary name");
  assert.equal(isSearchProgram("grep"), false);
  assert.equal(isSearchProgram(""), false);
  assert.equal(isSearchProgram(undefined), false);
  assert.equal(isSearchProgram(42), false);
});

check("a distro workspace's search is rewritten into the distro's rg", () => {
  const rewrite = searchSpawnRewrite({
    argv: [PACKAGED_RG, "-n", "--json", "SANDBOX_UNAVAILABLE"],
    cwd: WORKSPACE,
    wslPath: "C:\\Windows\\System32\\wsl.exe",
  });
  assert.notEqual(rewrite, undefined);
  assert.equal(rewrite.distro, "ubuntu");
  assert.equal(rewrite.linuxCwd, "/home/andy/proj");
  assert.deepEqual(rewrite.wslArgv, [
    "C:\\Windows\\System32\\wsl.exe",
    "-d",
    "ubuntu",
    "--cd",
    "/home/andy/proj",
    "--exec",
    "rg",
    "-n",
    "--json",
    "SANDBOX_UNAVAILABLE",
    "--",
    ".",
  ]);
  assert.deepEqual(rewrite.rgArgv, ["rg", "-n", "--json", "SANDBOX_UNAVAILABLE", "--", "."]);
  assert.equal(rewrite.wslArgv.slice(-rewrite.rgArgv.length).join(" "), rewrite.rgArgv.join(" "), "the fallback wraps the same command");
});

check("a search with no explicit path gains `-- .` — the stdin-heuristic guard", () => {
  // `wsl.exe --exec` hands distro-side rg a relay fifo on stdin; rg's
  // readable-stdin heuristic then searches stdin (instantly empty) instead of
  // the directory. The tool spells an explicit path with a bare `--`, so its
  // absence is the signal to append `-- .` — the `--cd` directory.
  const rewrite = searchSpawnRewrite({
    argv: [PACKAGED_RG, "--json", "--regexp=hole"],
    cwd: WORKSPACE,
    wslPath: "wsl.exe",
  });
  assert.deepEqual(rewrite.wslArgv.slice(-2), ["--", "."]);
  assert.equal(rewrite.wslArgv.filter((part) => part === "--").length, 1, "the separator is appended exactly once");
});

check("a search that already names a path is forwarded verbatim", () => {
  const rewrite = searchSpawnRewrite({
    argv: [PACKAGED_RG, "--json", "--regexp=hole", "--", "lib"],
    cwd: WORKSPACE,
    wslPath: "wsl.exe",
  });
  assert.deepEqual(rewrite.wslArgv.slice(-2), ["--", "lib"]);
  assert.equal(rewrite.wslArgv.filter((part) => part === "--").length, 1, "no second separator is added");
});

check("the legacy wsl$ spelling and the distro root both route", () => {
  const legacy = searchSpawnRewrite({ argv: ["rg", "x"], cwd: "\\\\wsl$\\debian\\srv", wslPath: "wsl.exe" });
  assert.equal(legacy.distro, "debian");
  assert.equal(legacy.linuxCwd, "/srv");

  const root = searchSpawnRewrite({ argv: ["rg", "x"], cwd: "\\\\wsl.localhost\\ubuntu", wslPath: "wsl.exe" });
  assert.equal(root.linuxCwd, "/", "a bare distro root searches from /");
});

check("a spawn the decision does not name passes through untouched", () => {
  const drive = searchSpawnRewrite({ argv: ["rg", "x"], cwd: "C:\\Users\\andy\\proj", wslPath: "wsl.exe" });
  assert.equal(drive, undefined, "a host directory keeps the host binary, which is native there");

  const absent = searchSpawnRewrite({ argv: ["rg", "x"], cwd: undefined, wslPath: "wsl.exe" });
  assert.equal(absent, undefined, "no directory means no distro evidence");

  const relative = searchSpawnRewrite({ argv: ["rg", "x"], cwd: "proj", wslPath: "wsl.exe" });
  assert.equal(relative, undefined);

  const posix = searchSpawnRewrite({ argv: ["rg", "x"], cwd: "/home/andy/proj", wslPath: "wsl.exe" });
  assert.equal(posix, undefined, "a POSIX cwd would need an async distro query spawn cannot pay");

  const notRg = searchSpawnRewrite({ argv: ["node", "script.js"], cwd: WORKSPACE, wslPath: "wsl.exe" });
  assert.equal(notRg, undefined, "any other program is the shipped spawn's business");

  const noArgv = searchSpawnRewrite({ argv: undefined, cwd: WORKSPACE, wslPath: "wsl.exe" });
  assert.equal(noArgv, undefined);
});

check("the forwarded arguments survive byte for byte, and only the program changes", () => {
  const args = ["--json", "--max-count", "5", "-e", "a|b", "--", "dir with space"];
  const rewrite = searchSpawnRewrite({ argv: ["rg", ...args], cwd: WORKSPACE, wslPath: "wsl.exe" });
  assert.deepEqual(rewrite.wslArgv.slice(7), args);
  assert.equal(rewrite.wslArgv[6], "rg");
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} search-route checks pass`);
