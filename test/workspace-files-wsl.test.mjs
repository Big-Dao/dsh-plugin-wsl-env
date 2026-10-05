/**
 * Assertion checks for the distro-routed `workspace-files` takeover: the pure
 * builders/parsers and the distro operations over a fake agent runner. Every
 * wire shape and refusal the GUI can observe is asserted here, without a
 * distro.
 *
 *   node test/workspace-files-wsl.test.mjs
 */
import assert from "node:assert/strict";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";
import {
  WorkspaceFilesWsl,
  distroList,
  distroRead,
  distroReadBytes,
  distroStat,
} from "../lib/workspace-files-wsl.js";
import {
  isDistroWorkspace,
  linuxJoin,
  listDistroArgv,
  parseDirListing,
  parseStatRecord,
  parseStatRecordFromStderr,
  pageArgv,
  statRecordArgv,
  bytesArgv,
  distroPath,
} from "../lib/workspace-files-route.js";

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
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).stack?.split('\n').slice(0, 3).join(' | ') ?? error}`);
    process.exitCode = 1;
  }
};

const ROOT = "/home/andy/proj";

/** @typedef {import("../lib/agent.js").WslAgent} WslAgent */

/** One `exec` frame as these checks script it. */
/** @typedef {{ cwd: string, argv: string[] }} RunnerCall */
/**
 * The runner slice these checks script: `exec` answering whatever the check
 * queued (plain outcome shapes, not the real `ExecResult`).
 * @typedef {{ exec: (frame: RunnerCall) => unknown }} ScriptedRunner
 */

/**
 * Views a scripted runner as the resident `WslAgent` the distro ops take;
 * only `exec` is exercised (the real class carries the protocol).
 * @param {ScriptedRunner} fake - the scripted runner.
 * @returns {WslAgent} the same object, as the seam's declared agent.
 */
const asRunner = (fake) => /** @type {WslAgent} */ (/** @type {unknown} */ (fake));

/**
 * A scripted runner: each `exec` shifts the next outcome off the script.
 * @param {Array<{exitCode: number, stdout: string|Uint8Array, stderr: string|Uint8Array}|Error|((options: RunnerCall) => unknown)>} script - the queued outcomes.
 * @returns {WslAgent & { calls: RunnerCall[] }} the runner and every frame it saw.
 */
function fakeAgent(script) {
  /** @type {RunnerCall[]} */
  const calls = [];
  /** @type {ScriptedRunner & { calls: RunnerCall[] }} */
  const runner = {
    calls,
    exec(options) {
      calls.push(options);
      const [outcome] = script.splice(0, 1);
      if (outcome instanceof Function) return outcome(options);
      if (outcome instanceof Error) return Promise.reject(outcome);
      return Promise.resolve(outcome);
    },
  };
  return /** @type {WslAgent & { calls: RunnerCall[] }} */ (/** @type {unknown} */ (runner));
}

/**
 * A workspace scope for the checks: the routed layer reads only
 * `workspaceRoot`; the session identity is the wire layer's to mint.
 * @param {string} workspaceRoot - the share root naming the distro scope.
 * @returns {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileScope} the scope, as the task seam declares it.
 */
const scopeOf = (workspaceRoot) => /** @type {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileScope} */ (/** @type {unknown} */ ({ workspaceRoot }));

/**
 * The service config these checks mount: `{}` is the whole input, and the
 * declared parameter type is the RESOLVED shape the schema fills in.
 * @returns {ConstructorParameters<typeof WorkspaceFilesWsl>[1]} the schema-defaulted config.
 */
const serviceConfig = () => /** @type {ConstructorParameters<typeof WorkspaceFilesWsl>[1]} */ (WorkspaceFilesWsl.Config(/** @type {Parameters<typeof WorkspaceFilesWsl.Config>[0]} */ (/** @type {unknown} */ ({}))));

/** One unaborted signal stands in for the wire layer's per-call cancellation. */
const SIGNAL = new AbortController().signal;

check("route predicate and path helpers", () => {
  assert.equal(isDistroWorkspace("\\\\wsl.localhost\\ubuntu\\home\\x"), true);
  assert.equal(isDistroWorkspace("C:\\proj"), false);
  assert.equal(linuxJoin("/home/andy/proj", "src/a.ts"), "/home/andy/proj/src/a.ts");
  assert.equal(linuxJoin("/home/andy/proj", "\\\\wsl.localhost\\ubuntu\\etc\\hosts"), "/etc/hosts");
  assert.equal(linuxJoin("/home/andy/proj", ""), "/home/andy/proj");
  assert.equal(distroPath("C:\\Users\\x\\Temp"), "/mnt/c/Users/x/Temp");
  assert.equal(distroPath("42"), "42", "non-path values ride verbatim");
});

check("builders produce the argv shape the agent protocol carries", () => {
  assert.deepEqual(listDistroArgv("/root", "/root/src", 500), [
    "sh", "-c",
    'root=$1 dir=$2 max=$3\nreal=$(realpath -L -- "$dir") || exit 2\ncase "$real" in "$root") ;; "$root"/*) ;; *) echo "OUTSIDE:$real" >&2; exit 3;; esac\n[ -d "$real" ] || { echo "NOTDIR:$real" >&2; exit 4; }\nls -1ALp -- "$real" | head -n "$max"',
    "sh", "/root", "/root/src", "501",
  ]);
  assert.deepEqual(statRecordArgv("/root/a.txt").slice(0, 2), ["sh", "-c"]);
  assert.deepEqual(pageArgv("/root/a.txt", 3, 100).slice(3), ["sh", "/root/a.txt", "3", "100"]);
  assert.deepEqual(bytesArgv("/root/a.txt", 0, 2048).slice(3), ["sh", "/root/a.txt", "0", "2048"]);
});

check("parseDirListing caps entries and distinguishes directories from files", () => {
  const { entries, truncated } = parseDirListing("src/\nREADME.md\nnotes/\n", 2);
  assert.deepEqual(entries, [
    { name: "src", type: "directory" },
    { name: "README.md", type: "file" },
  ]);
  assert.equal(truncated, true, "the level had more than the cap");
  const whole = parseDirListing("a/\n", 5);
  assert.equal(whole.truncated, false);
});

check("parseStatRecord synthesizes the opaque version and maps the kind", () => {
  const record = parseStatRecord("regular file\t4096\tfc03\t917517\t1760000000\t1759000000");
  assert.equal(record.type, "file");
  assert.equal(record.size, 4096);
  assert.equal(record.version, "fc03:917517:4096:1760000000:1759000000");
  assert.equal(parseStatRecord("symbolic link\t10\tx\ty\tz\tw").type, "symlink");
});

check("distroList routes through the runner and maps refusals", async () => {
  const runner = fakeAgent([
    { exitCode: 0, stdout: "src/\nREADME.md\n", stderr: "" },
    { exitCode: 3, stdout: "", stderr: "OUTSIDE:/etc" },
    { exitCode: 4, stdout: "", stderr: "NOTDIR:/home/andy/proj/a.txt" },
    { exitCode: 2, stdout: "", stderr: "realpath: No such file" },
  ]);
  const listing = await distroList({ runner, distro: "ubuntu", linuxRoot: ROOT, path: ".", maxEntries: 100 });
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["src", "README.md"]);
  assert.equal(listing.path, "", "the workspace root lists as an empty relative path");
  assert.equal(runner.calls[0].cwd, "/");
  await assert.rejects(
    () => distroList({ runner, distro: "ubuntu", linuxRoot: ROOT, path: "..", maxEntries: 100 }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/outside-workspace",
  );
  await assert.rejects(
    () => distroList({ runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt", maxEntries: 100 }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/not-directory",
  );
  await assert.rejects(
    () => distroList({ runner, distro: "ubuntu", linuxRoot: ROOT, path: "gone", maxEntries: 100 }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/not-found",
  );
});

check("distroStat returns the UNC display path with the synthesized version", async () => {
  const runner = fakeAgent([
    { exitCode: 0, stdout: "regular file\t512\tfc03\t917517\t1760000000\t1759000000\n", stderr: "" },
  ]);
  const stat = await distroStat({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(stat.absolutePath, "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\a.txt", "the display path keeps today's UNC form");
  assert.equal(stat.version, "fc03:917517:512:1760000000:1759000000");
  assert.equal(stat.bytes, 512);
  const missing = fakeAgent([{ exitCode: 1, stdout: "", stderr: "" }]);
  await assert.rejects(
    () => distroStat({ runner: missing, distro: "ubuntu", linuxRoot: ROOT, path: "gone", distroWorkspaceRoot: "" }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/not-found",
  );
});

check("distroRead mirrors the upstream page semantics", async () => {
  const record = "regular file\t24\tfc03\t1\t1760000000\t1759000000";
  const runner = fakeAgent([
    { exitCode: 0, stdout: Buffer.from("alpha\nbeta\ngamma\n"), stderr: `${record}\n` },
    { exitCode: 0, stdout: Buffer.from("alpha\nbeta\n"), stderr: `${record}\n` },
    { exitCode: 0, stdout: Buffer.from("a\x00b\n"), stderr: `${record}\n` },
    { exitCode: 0, stdout: Buffer.from([0xff, 0xfe]), stderr: `${record}\n` },
  ]);
  const full = await distroRead({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    offset: 1, limit: 100, maxBytes: 65536,
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(full.text, "alpha\nbeta\ngamma\n");
  assert.equal(full.eof, true, "the yield stayed within the limit");
  assert.equal(full.lines, 3);
  assert.equal(full.absolutePath, "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\a.txt");

  const partial = await distroRead({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    offset: 1, limit: 2, maxBytes: 65536,
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(partial.text, "alpha\nbeta\n");
  assert.equal(partial.eof, false, "a third line exists past the page");

  await assert.rejects(
    () => distroRead({
      runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
      offset: 1, limit: 100, maxBytes: 65536,
      distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/not-text",
    "a NUL byte marks the page binary",
  );
});

check("distroRead enforces the page byte cap with the upstream message", async () => {
  const record = "regular file\t99999\tfc03\t1\t1760000000\t1759000000";
  const runner = fakeAgent([{ exitCode: 0, stdout: Buffer.from("x".repeat(200) + "\n"), stderr: `${record}\n` }]);
  await assert.rejects(
    () => distroRead({
      runner, distro: "ubuntu", linuxRoot: ROOT, path: "big.txt",
      offset: 1, limit: 10, maxBytes: 100,
      distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/too-large" && /exceed the 100 byte cap/.test(error.message),
  );
});

check("distroReadBytes caps whole-file reads and reports EOF", async () => {
  const data = Buffer.from("hello world");
  const runner = fakeAgent([
    { exitCode: 0, stdout: data, stderr: `regular file\t${data.length}\tfc03\t1\t1760000000\t1759000000\n` },
    { exitCode: 0, stdout: data, stderr: `regular file\t99999\tfc03\t1\t1760000000\t1759000000\n` },
    { exitCode: 0, stdout: Buffer.from("ld"), stderr: "regular file\t11\tfc03\t1\t1760000000\t1759000000\n" },
  ]);
  const whole = await distroReadBytes({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    offset: undefined, length: undefined, maxFileBytes: 65536,
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(whole.data.length, data.length);
  assert.equal(whole.eof, true);
  assert.equal(whole.offset, 0);
  await assert.rejects(
    () => distroReadBytes({
      runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
      offset: undefined, length: undefined, maxFileBytes: 65536,
      distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/too-large",
    "a file above the complete-file cap is refused, never truncated",
  );
  await assert.rejects(
    () => distroReadBytes({
      runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
      offset: 0, length: 4096, maxBytes: 100, maxFileBytes: 65536,
      distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/too-large" && /exceed the 100 byte cap/.test(error.message),
    "a byte window asking past the cap is refused before the runner, never shortened",
  );
  const window = await distroReadBytes({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    offset: data.length - 2, length: 64, maxFileBytes: 65536,
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(window.eof, true, "a short window at the end of the file reports EOF");
  assert.equal(Buffer.from(window.data).toString(), "ld");
});

check("parseStatRecordFromStderr picks the tab-separated record line", () => {
  const record = parseStatRecordFromStderr("noise\nregular file\t24\tfc03\t1\t1760000000\t1759000000\n");
  assert.ok(record, "the record line is found");
  assert.equal(record.type, "file");
  assert.equal(parseStatRecordFromStderr("no record here"), undefined);
});

// --- the class: the coordination the standalone functions cannot show ------

check("the class routes a distro scope through the runner and a drive scope to super", async () => {
  const ctx = new Context();
  ctx.inject = /** @type {typeof ctx.inject} */ (/** @type {unknown} */ (() => {})); // the feed's wiring needs services no unit test mounts
  const service = new WorkspaceFilesWsl(ctx, serviceConfig());
  /** @type {string[]} */
  const runnerCalls = [];
  service.runnerFor = (distro) => asRunner({
    exec: async ({ argv }) => {
      runnerCalls.push(distro);
      return { exitCode: 0, stdout: "src/\nREADME.md\n", stderr: Buffer.alloc(0) };
    },
  });
  const distro = await service.list(scopeOf("\\\\wsl.localhost\\ubuntu\\home\\x"), "", SIGNAL);
  assert.equal(distro.path, "");
  assert.deepEqual(distro.entries.map((e) => e.name), ["src", "README.md"]);
  assert.deepEqual(runnerCalls, ["ubuntu"], "the distro scope rides the agent");

  // A drive scope defers to the shipped service. The base is not mounted here,
  // so its remote dispatch rejects — the assertion is that the ROUTING chose
  // super, visible in the runner never being called.
  await assert.rejects(
    () => service.list(scopeOf("C:\\proj"), "", SIGNAL),
    () => true,
  );
  assert.deepEqual(runnerCalls, ["ubuntu"], "the drive scope never reached the agent");
});

check("read validates its page before reaching the runner", async () => {
  const ctx = new Context();
  ctx.inject = /** @type {typeof ctx.inject} */ (/** @type {unknown} */ (() => {}));
  const service = new WorkspaceFilesWsl(ctx, serviceConfig());
  service.runnerFor = () => {
    throw new Error("must not be reached");
  };
  const scope = scopeOf("\\\\wsl.localhost\\ubuntu\\home\\x");
  await assert.rejects(
    () => service.read(scope, "a.ts", { offset: 0, limit: 10 }, SIGNAL),
    (error) => error instanceof RemoteError && /offset/.test(error.message),
    "offset 0 is not a line number",
  );
  await assert.rejects(
    () => service.read(scope, "a.ts", { offset: 1, limit: 999999 }, SIGNAL),
    (error) => error instanceof RemoteError && /limit/.test(error.message),
    "a limit past the cap refuses before any work",
  );
});

check("the read route's refusal ladder: not-found, not-regular-file, not-text, hard failure", async () => {
  const record = "directory\t4096\tfc03\t1\t1760000000\t1759000000";
  const responses = {
    missing: [{ exitCode: 2, stdout: "", stderr: "" }],
    wrongKind: [{ exitCode: 0, stdout: "", stderr: `${record}\n` }],
    binary: [{ exitCode: 0, stdout: Buffer.from([0xff, 0xfe, 0x00]), stderr: "regular file\t3\tfc03\t1\t1760000000\t1759000000\n" }],
    wedged: [{ exitCode: 7, stdout: "", stderr: "stat exploded" }],
  };
  for (const [name, script] of Object.entries(responses)) {
    const runner = fakeAgent(script);
    await assert.rejects(
      () => distroRead({
        runner, distro: "ubuntu", linuxRoot: ROOT, path: "x",
        offset: 1, limit: 10, maxBytes: 65536,
        distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
      }),
      (error) => {
        if (name === "missing") return /** @type {{code?: string}} */ (error).code === "workspace-file/not-found";
        if (name === "wrongKind") return /** @type {{code?: string}} */ (error).code === "workspace-file/not-regular-file";
        if (name === "binary") return /** @type {{code?: string}} */ (error).code === "workspace-file/not-text";
        return !(error instanceof RemoteError) || error.code === undefined;
      },
      `${name} reads as its own refusal`,
    );
  }
});

check("stat, read, readBytes and readByteRange route distro scopes through the runner", async () => {
  const ctx = new Context();
  ctx.inject = /** @type {typeof ctx.inject} */ (/** @type {unknown} */ (() => {}));
  const service = new WorkspaceFilesWsl(ctx, serviceConfig());
  const record = "regular file\t24\tfc03\t1\t1760000000\t1759000000";
  const responses = [
    { exitCode: 0, stdout: `regular file\t512\tfc03\t917517\t1760000000\t1759000000\n`, stderr: "" }, // stat
    { exitCode: 0, stdout: Buffer.from("alpha\nbeta\n"), stderr: `${record}\n` }, // read
    { exitCode: 0, stdout: Buffer.from("window"), stderr: `${record}\n` }, // readBytes
    { exitCode: 0, stdout: Buffer.from("range"), stderr: `${record}\n` }, // readByteRange
  ];
  service.runnerFor = () => asRunner({
    exec: async () => responses.shift(),
  });
  const scope = scopeOf("\\\\wsl.localhost\\ubuntu\\home\\x");
  const stat = await service.stat(scope, "a.txt", SIGNAL);
  assert.equal(stat.absolutePath, "\\\\wsl.localhost\\ubuntu\\home\\x\\a.txt");
  const page = await service.read(scope, "a.txt", { offset: 1, limit: 10 }, SIGNAL);
  assert.equal(page.eof, true);
  const bytes = await service.readBytes(scope, "a.txt", { range: { offset: 0, length: 6 } }, SIGNAL);
  assert.ok(bytes);
  const range = await service.readByteRange(scope, "a.txt", 0, 5, SIGNAL);
  assert.ok(range);
});

check("the default runnerFor hands back the distro's shared agent", () => {
  const ctx = new Context();
  ctx.inject = /** @type {typeof ctx.inject} */ (/** @type {unknown} */ (() => {}));
  const service = new WorkspaceFilesWsl(ctx, serviceConfig());
  const runner = service.runnerFor("ubuntu");
  assert.equal(runner, service.runnerFor("ubuntu"), "the shared singleton, keyed by distro");
  assert.notEqual(runner, service.runnerFor("debian"));
});

check("coords reads the distro and root from any depth of the same share", () => {
  const ctx = new Context();
  ctx.inject = /** @type {typeof ctx.inject} */ (/** @type {unknown} */ (() => {}));
  const service = new WorkspaceFilesWsl(ctx, serviceConfig());
  assert.deepEqual(service.coords("\\\\wsl.localhost\\ubuntu\\home\\x"), { distro: "ubuntu", linuxRoot: "/home/x" });
  assert.deepEqual(service.coords("\\\\wsl.localhost\\ubuntu"), { distro: "ubuntu", linuxRoot: "/" });
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} workspace-files-wsl checks pass`);
