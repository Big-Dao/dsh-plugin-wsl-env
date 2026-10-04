/**
 * The `@` completion traversal prototype (lib/file-reference-wsl.js): the
 * routing decisions, the distro listing argv and its Dirent-faithful parse,
 * the per-segment resolve walk, and the strategy's coordinate dispatch —
 * over a fake agent runner, the same shape workspace-files-wsl tests use.
 *
 *   node test/file-reference-wsl.test.mjs
 */
import assert from "node:assert/strict";
import {
  hostFileReferenceTraversal,
  normalizeDisplaySegments,
  parseTraversalListing,
  resolveDirectoryArgv,
  traversalArgv,
  wslFileReferenceTraversal,
} from "../lib/file-reference-wsl.js";

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

const ROOT = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj";
const LIVE = new AbortController().signal;

const fakeRunner = (result) => {
  const calls = [];
  return {
    calls,
    exec: async (options) => {
      calls.push(options);
      return typeof result === "function" ? result(options) : result;
    },
  };
};
const DEFAULT = {
  readWorkspaceRoot: async () => {
    throw new Error("default readWorkspaceRoot must not run for distro targets");
  },
  readDirectory: async () => {
    throw new Error("default readDirectory must not run for distro targets");
  },
  resolveDisplayDirectory: async () => {
    throw new Error("default resolveDisplayDirectory must not run for distro targets");
  },
};

check("normalizeDisplaySegments resolves lexically and refuses escapes", () => {
  assert.deepEqual(normalizeDisplaySegments(""), []);
  assert.deepEqual(normalizeDisplaySegments("src/lib/"), ["src", "lib"]);
  assert.deepEqual(normalizeDisplaySegments("src/../app"), ["app"]);
  assert.deepEqual(normalizeDisplaySegments("./src/./lib"), ["src", "lib"]);
  assert.equal(normalizeDisplaySegments(".."), undefined);
  assert.equal(normalizeDisplaySegments("src/../../etc"), undefined);
});

check("traversalArgv keeps the path an argv element, never script text", () => {
  const dir = "/home/andy/proj/a b/'quoted'";
  const argv = traversalArgv("/home/andy/proj", dir, 5000);
  assert.equal(argv[0], "sh");
  assert.equal(argv[4], "/home/andy/proj");
  assert.equal(argv[5], dir);
  assert.equal(argv[6], 5000);
  assert.ok(!argv[2].includes(dir), "the script must not embed the path");
  assert.ok(argv[2].includes("find \"$real\" -mindepth 1 -maxdepth 1 -printf '%y\\t%f\\n'"));
  assert.ok(argv[2].includes("head -n \"$max\""));
});

check("parseTraversalListing keeps Dirent fidelity: symlinks and specials skipped", () => {
  const entries = parseTraversalListing("d\tsrc\nf\tREADME.md\nl\tlink\nd\ta b's dir\ns\tsock\n");
  assert.deepEqual(entries.map((entry) => entry.name), ["src", "README.md", "a b's dir"]);
  assert.equal(entries[0].isDirectory(), true);
  assert.equal(entries[0].isFile(), false);
  assert.equal(entries[1].isDirectory(), false);
  assert.equal(entries[1].isFile(), true);
});

check("resolveDirectoryArgv walks the segments as argv elements", () => {
  const argv = resolveDirectoryArgv("/home/andy/proj", ["src", "lib"]);
  assert.equal(argv[4], "/home/andy/proj");
  assert.deepEqual(argv.slice(5), ["src", "lib"]);
  assert.ok(argv[2].includes('[ -L "$cur" ]'), "a symlink component is refused");
  assert.ok(argv[2].includes('[ -d "$cur" ]'), "a non-directory component is refused");
});

check("a non-distro search root is answered by the default traversal wholesale", () => {
  const runner = fakeRunner({ exitCode: 0, stdout: "", stderr: "" });
  const traversal = wslFileReferenceTraversal({ root: "C:\\Users\\x", runnerFor: () => runner, defaultTraversal: DEFAULT });
  assert.equal(traversal, DEFAULT, "the factory hands drive workspaces straight to the default");
});

check("readWorkspaceRoot lists the root through the agent and maps the entries", async () => {
  const runner = fakeRunner({ exitCode: 0, stdout: "d\tsrc\nf\tREADME.md\nl\tlink\n", stderr: "" });
  const traversal = wslFileReferenceTraversal({ root: ROOT, runnerFor: () => runner, defaultTraversal: DEFAULT });
  const entries = await traversal.readWorkspaceRoot(ROOT, LIVE);
  assert.deepEqual(entries.map((entry) => entry.name), ["src", "README.md"]);
  assert.equal(runner.calls[0].cwd, "/");
  assert.equal(runner.calls[0].argv[4], "/home/andy/proj");
  assert.equal(runner.calls[0].argv[5], "/home/andy/proj");
});

check("readDirectory routes a joined child UNC with the workspace root as the guard", async () => {
  const runner = fakeRunner({ exitCode: 0, stdout: "f\tmain.rs\n", stderr: "" });
  const traversal = wslFileReferenceTraversal({ root: ROOT, runnerFor: () => runner, defaultTraversal: DEFAULT });
  const entries = await traversal.readDirectory(`${ROOT}\\src`, LIVE);
  assert.deepEqual(entries.map((entry) => entry.name), ["main.rs"]);
  assert.equal(runner.calls[0].argv[4], "/home/andy/proj", "containment is scoped to the workspace root");
  assert.equal(runner.calls[0].argv[5], "/home/andy/proj/src");
});

check("an unreadable directory is [], a failed root is a rejection, an abort is neither", async () => {
  const refusing = wslFileReferenceTraversal({
    root: ROOT,
    runnerFor: () => fakeRunner({ exitCode: 4, stdout: "", stderr: "NOTDIR:/x" }),
    defaultTraversal: DEFAULT,
  });
  assert.deepEqual(await refusing.readDirectory(`${ROOT}\\gone`, LIVE), [], "upstream's readdir catch yields []");
  await assert.rejects(refusing.readWorkspaceRoot(ROOT, LIVE), "the root failing stays a rejection, like upstream");

  const wedged = wslFileReferenceTraversal({
    root: ROOT,
    runnerFor: () => fakeRunner(() => {
      throw new Error("agent wedge");
    }),
    defaultTraversal: DEFAULT,
  });
  assert.deepEqual(await wedged.readDirectory(`${ROOT}\\src`, LIVE), [], "an agent failure on a level is still []");

  const aborted = new AbortController();
  aborted.abort();
  const runner = fakeRunner({ exitCode: 0, stdout: "", stderr: "" });
  const traversal = wslFileReferenceTraversal({ root: ROOT, runnerFor: () => runner, defaultTraversal: DEFAULT });
  await assert.rejects(traversal.readDirectory(`${ROOT}\\src`, aborted.signal));
  assert.equal(runner.calls.length, 0, "an aborted caller never reaches the agent");
});

check("resolveDisplayDirectory walks segments once and answers in the UNC form", async () => {
  const runner = fakeRunner({ exitCode: 0, stdout: "/home/andy/proj/lib\n", stderr: "" });
  const traversal = wslFileReferenceTraversal({ root: ROOT, runnerFor: () => runner, defaultTraversal: DEFAULT });
  assert.equal(await traversal.resolveDisplayDirectory(ROOT, "src/../lib", LIVE), `${ROOT}\\lib`);
  assert.deepEqual(runner.calls[0].argv.slice(5), ["lib"], "segments ride as argv; a/../lib normalized before the walk");
});

check("resolveDisplayDirectory short-circuits the root, escapes, and refusals", async () => {
  const runner = fakeRunner({ exitCode: 0, stdout: "", stderr: "" });
  const traversal = wslFileReferenceTraversal({ root: ROOT, runnerFor: () => runner, defaultTraversal: DEFAULT });
  assert.equal(await traversal.resolveDisplayDirectory(ROOT, "", LIVE), ROOT, "the root itself needs no walk");
  assert.equal(await traversal.resolveDisplayDirectory(ROOT, "../outside", LIVE), undefined, "an escape is refused");
  assert.equal(runner.calls.length, 0, "neither case reached the agent");

  const notDir = wslFileReferenceTraversal({
    root: ROOT,
    runnerFor: () => fakeRunner({ exitCode: 4, stdout: "", stderr: "NOTDIR:/x" }),
    defaultTraversal: DEFAULT,
  });
  assert.equal(await notDir.resolveDisplayDirectory(ROOT, "src", LIVE), undefined, "a non-directory component is refused");
  const symlink = wslFileReferenceTraversal({
    root: ROOT,
    runnerFor: () => fakeRunner({ exitCode: 5, stdout: "", stderr: "SYMLINK:/x" }),
    defaultTraversal: DEFAULT,
  });
  assert.equal(await symlink.resolveDisplayDirectory(ROOT, "link", LIVE), undefined, "a symlink component is refused");
});

check("a drive-shaped absolute inside a distro strategy defers to the default", async () => {
  const runner = fakeRunner({ exitCode: 0, stdout: "", stderr: "" });
  let defaultCalls = 0;
  const traversal = wslFileReferenceTraversal({
    root: ROOT,
    runnerFor: () => runner,
    defaultTraversal: { ...DEFAULT, readDirectory: async () => {
      defaultCalls += 1;
      return [];
    } },
  });
  await traversal.readDirectory("C:\\elsewhere", LIVE);
  assert.equal(defaultCalls, 1);
  assert.equal(runner.calls.length, 0);
});

check("the host default traversal mirrors the upstream default semantics", async () => {
  const entries = [{ name: "a", isDirectory: () => true, isFile: () => false }];
  const deps = {
    readdir: async (path) => {
      if (String(path).endsWith("locked") || String(path) === "C:\\missing") {
        throw Object.assign(new Error("unreadable"), { code: "EACCES" });
      }
      return entries;
    },
    lstat: async (path) => {
      if (path.endsWith("link")) {
        return { isSymbolicLink: () => true, isDirectory: () => false };
      }
      if (path.endsWith("gone")) {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
      return { isSymbolicLink: () => false, isDirectory: () => true };
    },
  };
  const traversal = hostFileReferenceTraversal(deps);
  assert.equal(await traversal.readWorkspaceRoot("C:\\w", LIVE), entries);
  assert.deepEqual(await traversal.readDirectory("C:\\w\\locked", LIVE), [], "a readdir error on a level is []");
  await assert.rejects(traversal.readWorkspaceRoot("C:\\missing", LIVE), "the root failing stays a rejection");
  assert.equal(await traversal.resolveDisplayDirectory("C:\\w", "src", LIVE), "C:\\w/src");
  assert.equal(await traversal.resolveDisplayDirectory("C:\\w", "link", LIVE), undefined, "a symlink component is refused");
  assert.equal(await traversal.resolveDisplayDirectory("C:\\w", "gone", LIVE), undefined, "a missing component is refused");
  assert.equal(await traversal.resolveDisplayDirectory("C:\\w", "../etc", LIVE), undefined, "an escape is refused");
});

let failed = 0;
for (const [name, fn] of checks) await runCheck(name, fn);
failed = checks.length - passed;
console.log(`\n${passed}/${checks.length} file-reference-wsl checks pass`);
if (failed > 0) process.exitCode = 1;
