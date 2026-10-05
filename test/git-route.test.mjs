/**
 * Assertion checks for the git spawn routing — the pure decision that sends
 * `workspace-changes`' git snapshot commands into the distro instead of
 * across the 9p share, plus the environment translation that keeps the
 * snapshot's private git environment (index, object store, alternates) in
 * distro coordinates. Mirrors `search-route.js`'s shape for the other
 * rewritten launch.
 *
 *   node test/git-route.test.mjs
 */
import assert from "node:assert/strict";
import { isGitProgram, gitSpawnRewrite, translateGitEnv, translateGitEnvValue } from "../lib/git-route.js";

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

const WORKSPACE = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj";
const HOST_GIT = "C:\\Program Files\\Git\\cmd\\git.exe";

check("isGitProgram judges the program by its own name", () => {
  assert.equal(isGitProgram("git"), true);
  assert.equal(isGitProgram(HOST_GIT), true, "an absolute path to git.exe matches");
  assert.equal(isGitProgram("/usr/bin/git"), true);
  assert.equal(isGitProgram("GIT.EXE"), true, "the name is judged case-insensitively");
  assert.equal(isGitProgram("gitk"), false, "a longer name is not git");
  assert.equal(isGitProgram("grep"), false);
});

check("a distro workspace's git snapshot is rewritten into the distro's git", () => {
  const rewrite = gitSpawnRewrite({
    argv: [HOST_GIT, "status", "--porcelain", "-z"],
    cwd: WORKSPACE,
    wslPath: "C:\\Windows\\System32\\wsl.exe",
  });
  assert.ok(rewrite, "the distro workspace's git snapshot is rewritten");
  assert.equal(rewrite.distro, "ubuntu");
  assert.equal(rewrite.linuxCwd, "/home/andy/proj");
  assert.deepEqual(rewrite.wslArgv, [
    "C:\\Windows\\System32\\wsl.exe",
    "-d",
    "ubuntu",
    "--cd",
    "/home/andy/proj",
    "--exec",
    "git",
    "status",
    "--porcelain",
    "-z",
  ]);
  assert.deepEqual(rewrite.gitArgv, ["git", "status", "--porcelain", "-z"]);
});

check("the discovery flags stay on host git — their absolute output is UNC-shaped", () => {
  for (const flag of ["--show-toplevel", "--absolute-git-dir", "--git-path"]) {
    const rewrite = gitSpawnRewrite({ argv: ["git", "rev-parse", flag], cwd: WORKSPACE, wslPath: "wsl.exe" });
    assert.equal(rewrite, undefined, `${flag} prints absolute paths the caller resolves against the UNC world`);
  }
});

check("a spawn the decision does not name passes through untouched", () => {
  assert.equal(gitSpawnRewrite({ argv: ["git", "status"], cwd: "C:\\proj", wslPath: "wsl.exe" }), undefined);
  assert.equal(gitSpawnRewrite({ argv: ["git", "status"], cwd: undefined, wslPath: "wsl.exe" }), undefined);
  assert.equal(gitSpawnRewrite({ argv: ["node", "x"], cwd: WORKSPACE, wslPath: "wsl.exe" }), undefined);
  assert.equal(gitSpawnRewrite({ argv: undefined, cwd: WORKSPACE, wslPath: "wsl.exe" }), undefined);
});

check("translateGitEnv keeps the git hygiene flags and translates path-shaped values", () => {
  const { env, wslenv } = translateGitEnv({
    GIT_CONFIG_COUNT: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
    GIT_INDEX_FILE: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\.git\\index",
    GIT_OBJECT_DIRECTORY: "C:\\Users\\andy\\AppData\\Local\\Temp\\scratch\\objects",
    GIT_ALTERNATE_OBJECT_DIRECTORIES: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\.git\\objects",
  });
  assert.equal(env.GIT_CONFIG_COUNT, "0", "hygiene flags ride verbatim");
  assert.equal(env.GIT_INDEX_FILE, "/home/andy/proj/.git/index", "UNC identities map onto Linux paths");
  assert.equal(env.GIT_OBJECT_DIRECTORY, "/mnt/c/Users/andy/AppData/Local/Temp/scratch/objects", "drive scratch maps onto its mount");
  assert.equal(env.GIT_ALTERNATE_OBJECT_DIRECTORIES, "/home/andy/proj/.git/objects");
  assert.deepEqual(wslenv, ["GIT_CONFIG_COUNT", "GIT_TERMINAL_PROMPT", "GIT_OPTIONAL_LOCKS", "LC_ALL", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]);
});

check("a colon-separated multi-directory value passes through untranslated", () => {
  assert.equal(
    translateGitEnvValue("/a:/b"),
    "/a:/b",
    "the current callers set single directories; a list would need split-translate-join",
  );
});

check("an empty or absent environment translates to nothing to forward", () => {
  assert.deepEqual(translateGitEnv(undefined).wslenv, []);
  assert.deepEqual(translateGitEnv({}).env, {});
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} git-route checks pass`);
