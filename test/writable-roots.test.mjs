/**
 * Assertion checks for the writable-root resolver and its one-time physical
 * check. Pure module plus an injected runner, so this runs everywhere.
 *
 *   node test/writable-roots.test.mjs
 */
import assert from "node:assert/strict";
import { WritableRootError, ensureWritableRoots, resetWritableRootsChecks, resolveWritableRoots, validateWritableRootsConfig, writableRootsCheckArgv } from "../lib/writable-roots.js";

const HOME = "/home/andy";
const WORKSPACE = "/home/andy/proj";
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

/**
 * Assert one resolver call throws a WritableRootError with the given reason.
 * @param {() => unknown} fn - the call.
 * @param {string} reason - the expected reason fragment.
 */
const rejects = (fn, reason) => {
  assert.throws(fn, (error) => error instanceof WritableRootError && error.reason.includes(reason));
};

await check("~ and ~/... expand against the distro home", () => {
  assert.deepEqual(
    resolveWritableRoots({ configured: ["~/.npm", "~/cache"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }),
    ["/home/andy/.npm", "/home/andy/cache"],
  );
  assert.deepEqual(resolveWritableRoots({ configured: ["~"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }), ["/home/andy"]);
});

await check("absolute Linux entries pass through and are normalized", () => {
  assert.deepEqual(
    resolveWritableRoots({ configured: ["/var/cache//x/", "/opt/../srv/cache"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }),
    ["/srv/cache", "/var/cache/x"],
  );
});

await check("a same-distro UNC policy entry becomes its Linux path", () => {
  assert.deepEqual(
    resolveWritableRoots({ policy: ["\\\\wsl.localhost\\Ubuntu\\home\\andy\\.npm"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }),
    ["/home/andy/.npm"],
  );
});

await check("another distro's UNC and a drive path fail closed", () => {
  rejects(() => resolveWritableRoots({ policy: ["\\\\wsl.localhost\\Debian\\home\\x"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }), "Windows-path extra directory");
  rejects(() => resolveWritableRoots({ policy: ["C:\\extra"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }), "Windows-path extra directory");
});

await check("relative and ~user config entries are refused", () => {
  rejects(() => resolveWritableRoots({ configured: ["relative/cache"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }), "absolute Linux path");
  rejects(() => resolveWritableRoots({ configured: ["~other/.cache"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }), "~user");
});

await check("entries already writable under the workspace or temp areas are dropped", () => {
  assert.deepEqual(
    resolveWritableRoots({ configured: ["/home/andy/proj/cache", "/tmp/x", "/dev/shm/y"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }),
    [],
  );
});

await check("entries nested inside another grant are dropped", () => {
  assert.deepEqual(
    resolveWritableRoots({ configured: ["~/.cache", "~/.cache/npm"], home: HOME, distro: "Ubuntu", workspaceRoot: WORKSPACE }),
    ["/home/andy/.cache"],
  );
});

await check("the same root from both sources appears once", () => {
  assert.deepEqual(
    resolveWritableRoots({
      configured: ["/home/andy/.npm"],
      policy: ["\\\\wsl.localhost\\Ubuntu\\home\\andy\\.npm"],
      home: HOME,
      distro: "Ubuntu",
      workspaceRoot: WORKSPACE,
    }),
    ["/home/andy/.npm"],
  );
});

await check("the check argv carries the script and the roots", () => {
  const argv = writableRootsCheckArgv("wsl.exe", "Ubuntu", ["/home/andy/.npm"]);
  assert.deepEqual(argv.slice(0, 6), ["wsl.exe", "-d", "Ubuntu", "--exec", "sh", "-c"]);
  assert.match(argv[6] ?? "", /pwd -P/u);
  assert.equal(argv[7], "wsl-writable-roots");
  assert.deepEqual(argv.slice(8), ["/home/andy/.npm"]);
});

await check("a successful check is remembered; a failure is retried", async () => {
  resetWritableRootsChecks();
  let calls = 0;
  const root = "/home/andy/.npm";
  await ensureWritableRoots({ wslPath: "wsl.exe", distro: "Ubuntu", roots: [root], run: async () => { calls += 1; return ""; } });
  await ensureWritableRoots({ wslPath: "wsl.exe", distro: "Ubuntu", roots: [root], run: async () => { calls += 1; return ""; } });
  assert.equal(calls, 1, "a success must not be re-probed");
  await assert.rejects(
    () => ensureWritableRoots({ wslPath: "wsl.exe", distro: "Ubuntu", roots: ["/home/andy/.cargo"], run: async () => { throw new Error("wsl.exe failed: 0|missing"); } }),
    (error) => error instanceof WritableRootError && error.root === "/home/andy/.cargo",
  );
  let retry = 0;
  await assert.rejects(
    () => ensureWritableRoots({ wslPath: "wsl.exe", distro: "Ubuntu", roots: ["/home/andy/.cargo"], run: async () => { retry += 1; throw new Error("wsl.exe failed: 0|missing"); } }),
    (error) => error instanceof WritableRootError,
  );
  assert.equal(retry, 1, "a failed check must be retried");
});

await check("an empty root list performs no check", async () => {
  resetWritableRootsChecks();
  let calls = 0;
  await ensureWritableRoots({ wslPath: "wsl.exe", distro: "Ubuntu", roots: [], run: async () => { calls += 1; return ""; } });
  assert.equal(calls, 0);
});

await check("the constructor check accepts distro spelling and rejects host spelling", () => {
  validateWritableRootsConfig([]);
  validateWritableRootsConfig(["/home/andy/.npm", "~/.cache", "~"]);
  assert.throws(() => validateWritableRootsConfig(["C:\\cache"]), /absolute Linux path/);
  assert.throws(() => validateWritableRootsConfig(["relative"]), /absolute Linux path/);
  assert.throws(() => validateWritableRootsConfig(["~other/.cache"]), /~/);
  assert.throws(() => validateWritableRootsConfig([""]), /non-empty/u);
});

console.log(`\n${passed} checks passed`);
