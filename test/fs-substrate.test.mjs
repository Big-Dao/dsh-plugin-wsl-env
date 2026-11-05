/**
 * Assertion checks for the agent-backed filesystem substrate: the provider-
 * shaped orchestration (`fs-substrate.js`) over the real agent script under the
 * local `sh`. Windows skips; the record and adapter layers have their own
 * suites that run everywhere.
 *
 * Not covered here: the provider wiring in `lib/index.js` (it imports the DSH
 * peers, so it is exercised by the probe scripts against a real distro).
 *
 *   node test/fs-substrate.test.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFsbFrame, encodeFsFrame, parseAgentLine } from "../lib/agent-protocol.js";
import { AgentSubstrate } from "../lib/fs-substrate.js";

const SCRIPT = fileURLToPath(new URL("../agent/wsl-agent.sh", import.meta.url));
const POSIX = process.platform !== "win32";
const DISTRO = "ubuntu";

let passed = 0;
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = async (name, fn) => {
  if (!POSIX) return;
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];

/** @typedef {import("../lib/agent.js").WslAgent} WslAgent */

/**
 * The parsed protocol messages `parseAgentLine` returns — typed by the protocol
 * module itself now (`src/agent-protocol.ts`, whose build emits the `.d.ts`
 * these imports resolve).
 * @typedef {import("../lib/agent-protocol.js").HelloMessage} HelloMessage
 * @typedef {import("../lib/agent-protocol.js").ResultMessage} ResultMessage
 * @typedef {import("../lib/agent-protocol.js").AgentMessage} AgentMessage
 */

/**
 * Views a scripted transport as the resident `WslAgent` the substrate takes;
 * only the `fs` round trip is exercised (the real class carries the protocol).
 * @param {{ fs: WslAgent["fs"] }} fake - the scripted transport.
 * @returns {WslAgent} the same object, as the substrate's declared agent.
 */
const asAgent = (fake) => /** @type {WslAgent} */ (/** @type {unknown} */ (fake));

class ScriptAgent {
  constructor() {
    /** The HELLO-reported protocol version (`hello()` fills it). */
    this.protocolVersion = 0;
    /** The HELLO-reported capability set (`hello()` fills it). */
    this.caps = new Set();
    this.dir = mkdtempSync(join(tmpdir(), "wsl-substrate-"));
    this.child = spawn("sh", [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = createInterface({ input: this.child.stdout });
    /** @type {string[]} */
    this.queue = [];
    /** @type {Array<(line: string) => void>} */
    this.waiters = [];
    this.n = 0;
    this.lines.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.queue.push(line);
    });
  }

  async hello() {
    const hello = /** @type {HelloMessage} */ (parseAgentLine(await this.nextLine()));
    assert.equal(hello.type, "hello");
    this.protocolVersion = hello.version;
    this.caps = new Set(hello.caps ?? []);
  }

  nextLine() {
    return this.queue.shift() ?? new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * The `WslAgent.fs` shape, over the script.
   * @param {{ op: string, args: string[], timeoutMs?: number }} request - the op and its wire arguments.
   * @returns {Promise<{exitCode: number, stdout: Buffer, stderr: Buffer, reason?: string}>} the settled projection for this request.
   */
  async fs({ op, args, timeoutMs = 30000 }) {
    const id = `t${this.n++}`;
    for (const line of encodeFsFrame({ id, op, args, timeoutMs })) this.child.stdin.write(`${line}\n`);
    for (;;) {
      const message = /** @type {AgentMessage} */ (parseAgentLine(await this.nextLine()));
      if (message.type === "result" && message.id === id) {
        return { exitCode: message.exitCode, stdout: message.stdout, stderr: message.stderr };
      }
      if (message.type === "fsError" && message.id === id) {
        return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(message.message), reason: message.reason };
      }
    }
  }

  /**
   * The `WslAgent.fsb` shape: one batched frame, one RES record stream.
   * @param {{ ops: Array<{ op: string, args: string[] }>, timeoutMs?: number }} request - the batch request.
   * @returns {Promise<{ exitCode: number, stdout: Buffer, stderr: Buffer, reason?: string }>} the settled batch.
   */
  async fsb({ ops, timeoutMs = 30000 }) {
    const id = `t${this.n++}`;
    for (const line of encodeFsbFrame({ id, ops, timeoutMs })) this.child.stdin.write(`${line}\n`);
    for (;;) {
      const message = /** @type {AgentMessage} */ (parseAgentLine(await this.nextLine()));
      if (message.type === "result" && message.id === id) {
        return { exitCode: message.exitCode, stdout: message.stdout, stderr: message.stderr };
      }
      if (message.type === "fsError" && message.id === id) {
        return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(message.message), reason: message.reason };
      }
    }
  }

  async close() {
    this.child.stdin.write("SHUTDOWN\n");
    await new Promise((resolve) => this.child.once("exit", resolve));
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * One substrate over one live script-backed agent, with a `root` workdir.
 * @param {(sub: AgentSubstrate, root: string, agent: ScriptAgent) => Promise<void>} setup - the check body over the live substrate.
 */
async function substrate(setup) {
  const agent = new ScriptAgent();
  await agent.hello();
  const sub = new AgentSubstrate({ agent: asAgent(agent), distro: DISTRO });
  const root = join(agent.dir, "root");
  mkdirSync(root, { recursive: true });
  await setup(sub, root, agent);
  await agent.close();
}

/**
 * The `code` a coded error carries, when the thrown value has one.
 * @param {unknown} error - the thrown value.
 * @returns {string | undefined} its `code`, if any.
 */
const codeOf = (error) => (error && typeof error === "object" ? /** @type {{code?: string}} */ (error).code : undefined);
/**
 * @param {AgentSubstrate} sub - the substrate.
 * @param {string} path - the Linux path to resolve.
 * @returns {Promise<{displayPath: string, targetKey: string}>} its resolved target.
 */
const targetOf = async (sub, path) => sub.resolve(path);

checks.push(["resolve returns the canonical Linux spelling and the distro's UNC identity", async () => {
  await substrate(async (sub, root) => {
    writeFileSync(join(root, "real.txt"), "x\n");
    symlinkSync("real.txt", join(root, "link"));
    const direct = await sub.resolve(join(root, "real.txt"));
    assert.equal(direct.displayPath, join(root, "real.txt"));
    assert.ok(direct.targetKey.startsWith("\\\\wsl.localhost\\ubuntu\\"));
    const through = await sub.resolve(join(root, "link"));
    assert.ok(through.targetKey.endsWith("real.txt"), "identity follows the symlink");
    const missing = await sub.resolve(join(root, "nope", "child.txt"));
    assert.ok(missing.targetKey.endsWith("nope\\child.txt"), "missing suffix rides the nearest real ancestor");
  });
}]);

checks.push(["stat and lstat answer with the provider's row shapes", async () => {
  await substrate(async (sub, root) => {
    writeFileSync(join(root, "a.txt"), "x\n");
    symlinkSync("a.txt", join(root, "link"));
    const target = await targetOf(sub, join(root, "a.txt"));
    const info = await sub.stat(target);
    assert.ok(info, "the file is observed");
    assert.equal(info.type, "file");
    assert.equal(await sub.stat(await targetOf(sub, join(root, "gone"))), undefined);
    const link = await sub.lstat(join(root, "link"));
    assert.ok(link, "the link is observed");
    assert.equal(link.type, "symlink", "lstat sees the link itself");
    assert.equal(link.size, "a.txt".length);
  });
}]);

checks.push(["lstat refuses an empty path; edit refuses a directory", async () => {
  await substrate(async (sub, root) => {
    mkdirSync(join(root, "adir"));
    await assert.rejects(sub.lstat(""), (error) => codeOf(error) === "FS_NOT_FOUND");
    const dirTarget = await targetOf(sub, join(root, "adir"));
    await assert.rejects(
      sub.editText(dirTarget, { oldString: "x", newString: "y" }, undefined),
      (error) => codeOf(error) === "FS_NOT_REGULAR_FILE",
    );
  });
}]);

checks.push(["the per-target lock serializes concurrent mutations FIFO and a failure does not poison the tail", async () => {
  await substrate(async (sub, root) => {
    const p = join(root, "contended.txt");
    const target = await targetOf(sub, p);
    /** @type {string[]} */
    const order = [];
    const first = sub.writeText(target, "one\n", undefined, undefined).then(() => order.push("first"));
    // Walk past the first holder before the second runs.
    await new Promise((r) => setImmediate(r));
    const second = sub.writeText(target, "two\n", undefined, undefined).then(() => order.push("second"));
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first", "second"], "the contended target serializes in queue order");
    assert.equal(readFileSync(p, "utf8"), "two\n", "the second write lands last, byte-true");

    // A rejecting holder must not poison the next in line: the tail swallows.
    const failing = sub.writeText(target, "x\n", undefined, undefined).then(
      () => order.push("failing-resolved"),
      () => order.push("failing-rejected"),
    );
    await new Promise((r) => setImmediate(r));
    const after = sub.writeText(target, "three\n", undefined, undefined).then(() => order.push("after"));
    await Promise.all([failing, after]);
    assert.ok(order.includes("after"), "the lock outlives a rejecting holder");
    assert.equal(readFileSync(p, "utf8"), "three\n");
  });
}]);

checks.push(["editText on a file that never existed reads as not-found, not stale", async () => {
  await substrate(async (sub, root) => {
    const target = await targetOf(sub, join(root, "never.txt"));
    await assert.rejects(
      sub.editText(target, { oldString: "x", newString: "y" }, undefined),
      (error) => codeOf(error) === "FS_NOT_FOUND",
      "an edit with no read behind it names a file that never answered the stat",
    );
  });
}]);

checks.push(["editText losing its file after a read is stale, not missing", async () => {
  await substrate(async (sub, root) => {
    const p = join(root, "doomed.txt");
    const target = await targetOf(sub, p);
    const created = await sub.writeText(target, "one\n", undefined);
    rmSync(p);
    await assert.rejects(
      sub.editText(target, { oldString: "one", newString: "two" }, { version: created.version }),
      (error) => codeOf(error) === "FS_STALE_VERSION",
      "the read-backed guard is stale: the file existed and is gone",
    );
  });
}]);

checks.push(["writeText creates and updates with the peer's outcome shape", async () => {
  await substrate(async (sub, root) => {
    const target = await targetOf(sub, join(root, "a.txt"));
    const created = await sub.writeText(target, "alpha\r\n", undefined);
    assert.equal(created.operation, "create");
    assert.equal(created.before, null);
    assert.equal(created.after, "alpha\n", "the outcome's after is LF-normalized");
    assert.ok(created.version.length > 0);
    assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "alpha\r\n", "the file keeps the written bytes");
    const updated = await sub.writeText(target, "beta\n", undefined);
    assert.equal(updated.operation, "update");
    assert.equal(updated.before, "alpha\n", "the diff basis is the LF-normalized old text");
    assert.equal(updated.after, "beta\n");
  });
}]);

checks.push(["writeText forwards the guard: stale versions and unread files are refused", async () => {
  await substrate(async (sub, root) => {
    const target = await targetOf(sub, join(root, "a.txt"));
    const first = await sub.writeText(target, "one\n", undefined);
    await assert.rejects(
      sub.writeText(target, "two\n", { kind: "replaceIfVersion", version: "bogus" }),
      (error) => codeOf(error) === "FS_STALE_VERSION" && /changed since it was read/.test(/** @type {Error} */ (error).message),
    );
    const again = await sub.writeText(target, "two\n", { kind: "replaceIfVersion", version: first.version });
    assert.equal(again.operation, "update");
    await assert.rejects(
      sub.writeText(target, "three\n", { kind: "createIfAbsent" }),
      (error) => codeOf(error) === "FS_NOT_OBSERVED" && /without reading it first/.test(/** @type {Error} */ (error).message),
    );
    assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "two\n");
  });
}]);

checks.push(["writeText refuses a directory target with the peer's code", async () => {
  await substrate(async (sub, root) => {
    mkdirSync(join(root, "adir"));
    const target = await targetOf(sub, join(root, "adir"));
    await assert.rejects(sub.writeText(target, "x\n", undefined), (error) => codeOf(error) === "FS_NOT_REGULAR_FILE");
  });
}]);

checks.push(["editText round-trips CRLF and refuses staleness and ambiguity", async () => {
  await substrate(async (sub, root) => {
    const path = join(root, "crlf.txt");
    writeFileSync(path, "alpha\r\nbeta\r\n");
    const target = await targetOf(sub, path);
    const outcome = await sub.editText(target, { oldString: "beta", newString: "gamma" }, undefined);
    assert.equal(outcome.before, "alpha\nbeta\n", "before is the LF-normalized original");
    assert.equal(outcome.after, "alpha\ngamma\n");
    assert.equal(readFileSync(path, "utf8"), "alpha\r\ngamma\r\n", "the file keeps its CRLF style");
    await assert.rejects(
      sub.editText(target, { oldString: "delta", newString: "x" }, { version: outcome.version }),
      (error) => codeOf(error) === "FS_EDIT_NOT_FOUND",
    );
    await assert.rejects(
      sub.editText(target, { oldString: "gamma", newString: "x" }, { version: "bogus" }),
      (error) => codeOf(error) === "FS_STALE_VERSION",
    );
    const gone = await targetOf(sub, join(root, "nope.txt"));
    await assert.rejects(
      sub.editText(gone, { oldString: "a", newString: "b" }, undefined),
      (error) => codeOf(error) === "FS_NOT_FOUND",
    );
  });
}]);

checks.push(["reads answer through the substrate in all four flavours", async () => {
  await substrate(async (sub, root) => {
    const path = join(root, "a.txt");
    writeFileSync(path, "hello world\n");
    const target = await targetOf(sub, path);
    assert.equal(await sub.readText(target), "hello world\n");
    assert.equal(Buffer.from(await sub.readBytes(target, undefined, 64)).toString(), "hello world\n");
    assert.equal(Buffer.from(await sub.readByteRange(target, { offset: 6, length: 5 })).toString(), "world");
    let joined = "";
    for await (const chunk of await sub.streamText(target)) joined += chunk;
    assert.equal(joined, "hello world\n");
  });
}]);

checks.push(["listDir rows carry Linux display paths and canonical identities", async () => {
  await substrate(async (sub, root) => {
    const dir = join(root, "proj");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.txt"), "x\n");
    symlinkSync("a.txt", join(dir, "link"));
    const rows = await sub.listDir(await targetOf(sub, dir));
    assert.deepEqual(rows.map((row) => row.name), ["a.txt", "link"]);
    const [aRow, linkRow] = rows;
    assert.ok(aRow !== undefined && linkRow !== undefined, "the listing kept both rows");
    assert.equal(aRow.target.displayPath, join(dir, "a.txt"), "display stays in Linux coordinates");
    assert.ok(aRow.target.targetKey.startsWith("\\\\wsl.localhost\\ubuntu\\"));
    assert.equal(aRow.size, 2);
    assert.equal(linkRow.type, "file", "the link row reports its target");
  });
}]);

checks.push(["stage-two routing sends mutations to the policy's agent and reads to the plain one", async () => {
  if (!POSIX) return;
  const agent = new ScriptAgent();
  await agent.hello();
  /** @type {string[]} */
  const confinedCalls = [];
  /**
   * The confined resident stand-in: one `fs` round trip through the plain agent.
   * @type {{ fs: WslAgent["fs"], close: () => Promise<void> }}
   */
  const confined = {
    fs: async ({ op, args }) => {
      confinedCalls.push(op);
      return agent.fs({ op, args });
    },
    close: () => agent.close(),
  };
  const sub = new AgentSubstrate({
    agent: asAgent(agent),
    distro: DISTRO,
    agentFor: (policy) => (policy?.mode === "workspace-write" ? Promise.resolve(asAgent(confined)) : Promise.resolve(asAgent(agent))),
  });
  const root = join(agent.dir, "root");
  mkdirSync(root, { recursive: true });
  try {
    const target = await sub.resolve(join(root, "a.txt"));
    const policy = { mode: "workspace-write", workspaceRoot: root };
    await sub.writeText(target, "routed\n", undefined, undefined, policy);
    assert.deepEqual(confinedCalls, ["write"], "the publication rode the confined resident");
    assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "routed\n");
    await sub.editText(target, { oldString: "routed", newString: "edited" }, undefined, undefined, policy);
    assert.deepEqual(confinedCalls, ["write", "write"], "the edit's publication rode it too");
    assert.equal(await sub.readText(target), "edited\n", "reads ride the plain resident");
    // An escalated write is what danger-full-access means: the plain agent.
    await sub.writeText(target, "escalated\n", undefined, undefined, { mode: "danger-full-access", workspaceRoot: root });
    assert.deepEqual(confinedCalls, ["write", "write"], "the escalation bypassed the confined resident");
    // No policy (pre-checked caller) stays on the plain resident as well.
    await sub.writeText(target, "plain\n", undefined, undefined, undefined);
    assert.deepEqual(confinedCalls, ["write", "write"], "a policy-less write is not confined");
  } finally {
    await agent.close();
  }
}]);

checks.push(["without an agentFor, the substrate keeps stage-one posture on one agent", async () => {
  if (!POSIX) return;
  await substrate(async (sub, root) => {
    const target = await targetOf(sub, join(root, "a.txt"));
    await sub.writeText(target, "x\n", undefined, undefined, { mode: "workspace-write", workspaceRoot: root });
    assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "x\n", "a policy still writes, on the plain resident");
  });
}]);


checks.push(["patchText applies hunks with the peer's mismatch dialect", async () => {
  await substrate(async (sub, root) => {
    const file = join(root, "patch.txt");
    writeFileSync(file, "one\ntail\n");
    const target = await sub.resolve(file);
    const stat = await sub.stat(target);
    assert.ok(stat, "the fixture stat resolves");
    const patched = await sub.patchText(target, [{ lineNumber: 1, oldLines: ["one"], newLines: ["two"], isEndOfFile: false }], { version: stat.version });
    assert.equal(readFileSync(file, "utf8"), "two\ntail\n");
    assert.equal(patched.after, "two\ntail\n");
    await assert.rejects(
      sub.patchText(target, [{ lineNumber: 1, oldLines: ["absent"], newLines: ["x"], isEndOfFile: false }], undefined),
      /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_PATCH_MISMATCH" && /hunk at patch line 1 \(oldLines\) does not match/.test(error.message),
    );
    // Failure arms: a vanished file is stale, a stale expected version is
    // stale, a directory is not a regular file.
    const missing = await sub.resolve(join(root, "patch-missing.txt"));
    await assert.rejects(sub.patchText(missing, [], undefined), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_STALE_VERSION");
    await assert.rejects(sub.patchText(target, [], { version: "bogus" }), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_STALE_VERSION");
    const directoryTarget = await sub.resolve(root);
    await assert.rejects(sub.patchText(directoryTarget, [], undefined), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_REGULAR_FILE");
  });
}]);

checks.push(["deleteFile removes the file and refuses a stale version", async () => {
  await substrate(async (sub, root) => {
    const file = join(root, "delete.txt");
    writeFileSync(file, "gone\n");
    const target = await sub.resolve(file);
    const stat = await sub.stat(target);
    assert.ok(stat, "the fixture stat resolves");
    await assert.rejects(sub.deleteFile(target, { version: "bogus" }), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_STALE_VERSION");
    assert.equal(readFileSync(file, "utf8"), "gone\n");
    const outcome = await sub.deleteFile(target, { version: stat.version });
    assert.equal(outcome.before, "gone\n");
    assert.throws(() => readFileSync(file, "utf8"));
    // Failure arms: vanished and non-regular targets.
    await assert.rejects(sub.deleteFile(target, undefined), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_STALE_VERSION");
    const directoryTarget = await sub.resolve(root);
    await assert.rejects(sub.deleteFile(directoryTarget, undefined), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_REGULAR_FILE");
  });
}]);

checks.push(["moveFile publishes the destination, guards both endpoints and removes the source", async () => {
  await substrate(async (sub, root) => {
    const source = join(root, "move-src.txt");
    const destination = join(root, "move-dst.txt");
    writeFileSync(source, "moving\n");
    const srcTarget = await sub.resolve(source);
    const dstTarget = await sub.resolve(destination);
    const stat = await sub.stat(srcTarget);
    assert.ok(stat, "the fixture stat resolves");
    await assert.rejects(sub.moveFile(srcTarget, srcTarget, {}), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_SAME_TARGET");
    await assert.rejects(sub.moveFile(srcTarget, dstTarget, { expectedSource: { version: "bogus" } }), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_STALE_VERSION");
    await assert.rejects(sub.moveFile(srcTarget, dstTarget, { expectedDestination: { kind: "replaceIfVersion", version: "bogus" } }), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_STALE_VERSION");
    writeFileSync(destination, "existing\n");
    await assert.rejects(sub.moveFile(srcTarget, dstTarget, { expectedDestination: { kind: "createIfAbsent" } }), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_OBSERVED");
    rmSync(destination);
    // A guarded create publishes with no-replace and removes the source.
    const created = await sub.moveFile(srcTarget, dstTarget, { expectedSource: { version: stat.version }, expectedDestination: { kind: "createIfAbsent" } });
    assert.equal(created.destination.operation, "create");
    assert.equal(created.sourceDeleted, true);
    // The move-with-hunks shape: the text is transformed on the way back.
    const back = await sub.moveFile(dstTarget, srcTarget, { hunks: [{ lineNumber: 1, oldLines: ["moving"], newLines: ["moved-back"], isEndOfFile: false }] });
    assert.equal(back.destination.after, "moved-back\n");
    assert.equal(back.sourceDeleted, true);
    assert.equal(readFileSync(source, "utf8"), "moved-back\n");
    assert.throws(() => readFileSync(destination, "utf8"));
  });
}]);

checks.push(["readWholeText and statRegularFile refuse with the peer's codes", async () => {
  if (!POSIX) return;
  await substrate(async (sub, root) => {
    const missingTarget = await sub.resolve(join(root, "absent.txt"));
    await assert.rejects(sub.fs.readWholeText(missingTarget), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_FOUND");
    const directoryTarget = await sub.resolve(root);
    await assert.rejects(sub.fs.readWholeText(directoryTarget), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_REGULAR_FILE");
    writeFileSync(join(root, "bin.txt"), Buffer.from([0x4d, 0x00, 0x5a, 0x0a]), { flag: "w" });
    const binaryTarget = await sub.resolve(join(root, "bin.txt"));
    await assert.rejects(sub.fs.readWholeText(binaryTarget), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_TEXT");
  });
}]);

checks.push(["protocol-6 residents refuse the destructive ops with a rebuild hint", async () => {
  if (!POSIX) return;
  const legacy = { protocolVersion: 6, caps: new Set(), fs: async () => { throw new Error("a v6 agent has no delete/move op"); } };
  const sub = new AgentSubstrate({ agent: asAgent(legacy), distro: DISTRO });
  const target = { displayPath: "/tmp/x.txt", targetKey: "\\\\wsl.localhost\\ubuntu\\tmp\\x.txt" };
  await assert.rejects(sub.deleteFile(target, undefined), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_IO_ERROR" && /protocol-7/.test(error.message));
  await assert.rejects(sub.moveFile(target, { displayPath: "/tmp/y.txt", targetKey: "\\\\wsl.localhost\\ubuntu\\tmp\\y.txt" }, {}), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_IO_ERROR" && /protocol-7/.test(error.message));
}]);

checks.push(["moveFile over an existing destination reports update and replaces its content", async () => {
  await substrate(async (sub, root) => {
    const source = join(root, "over-src.txt");
    const destination = join(root, "over-dst.txt");
    writeFileSync(source, "new-body\n");
    writeFileSync(destination, "old-body\n");
    const srcTarget = await sub.resolve(source);
    const dstTarget = await sub.resolve(destination);
    const dstStat = await sub.stat(dstTarget);
    assert.ok(dstStat, "the destination is observed before the move");
    const moved = await sub.moveFile(srcTarget, dstTarget, { expectedDestination: { kind: "replaceIfVersion", version: dstStat.version } });
    assert.equal(moved.destination.operation, "update", "an existing destination reports update");
    assert.equal(readFileSync(destination, "utf8"), "new-body\n");
    assert.equal(moved.destination.before, "old-body\n", "the destination's pre-move text is the diff basis");
    assert.throws(() => readFileSync(source, "utf8"), "the source is removed");
    // A destination that is a directory refuses with the write dialect.
    const directoryTarget = await sub.resolve(root);
    await assert.rejects(sub.moveFile(dstTarget, directoryTarget, {}), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_REGULAR_FILE" && /cannot write/.test(error.message));
  });
}]);

checks.push(["moveFile refuses a missing source, a directory source and a mismatched hunk", async () => {
  await substrate(async (sub, root) => {
    const missing = await sub.resolve(join(root, "no-such-source.txt"));
    const destination = await sub.resolve(join(root, "move-target.txt"));
    await assert.rejects(sub.moveFile(missing, destination, {}), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_STALE_VERSION");
    const directoryTarget = await sub.resolve(root);
    await assert.rejects(sub.moveFile(directoryTarget, destination, {}), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_REGULAR_FILE");
    const source = join(root, "hunk-source.txt");
    writeFileSync(source, "plain\n");
    const sourceTarget = await sub.resolve(source);
    await assert.rejects(
      sub.moveFile(sourceTarget, destination, { hunks: [{ lineNumber: 1, oldLines: ["absent"], newLines: ["x"], isEndOfFile: false }] }),
      /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_PATCH_MISMATCH",
    );
  });
}]);
for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} fs-substrate checks pass${POSIX ? "" : " (skipped: not a POSIX shell host)"}`);
