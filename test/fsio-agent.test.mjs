/**
 * Assertion checks for the distro-side filesystem substrate: the pure record
 * parsing everywhere, and the full adapter-over-script stack on a POSIX host,
 * where the real agent script runs under the local `sh` and the kernel supplies
 * the symlink, mode and binary semantics the adapter must mirror.
 *
 * Not covered here: the wiring into `WslFileSystem` (the provider and its
 * fence), which lands with the substrate switch.
 *
 *   node test/fsio-agent.test.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FsTargetKey } from "@deepseek-ai/dsh-fs";
import { encodeExecFrame, encodeFsFrame, parseAgentLine, encodeFsbFrame, FS_READ_CHUNK_BYTES } from "../lib/agent-protocol.js";
import { DistroFs, nanoseconds, parseStatRecord, versionOf } from "../lib/fsio-agent.js";
import { applyLiteralEdit, restoreLineEndings } from "../lib/fsio-text.js";

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

/**
 * The private seams these unit checks reach for directly: `fail` (the op
 * failure classifier) and `request` (the round-trip wrapper).
 * @typedef {object} DistroFsSeams
 * @property {(op: string, result: {exitCode: number, stdout: Buffer, stderr: Buffer}, displayPath: string) => {code?: string, message: string}} fail
 * @property {(op: string, args: Array<string|Uint8Array>, signal?: AbortSignal|undefined) => Promise<unknown>} request
 */

/**
 * Views a substrate through its private seams.
 * @param {DistroFs} fs - the substrate under test.
 * @returns {DistroFsSeams} the private seams.
 */
const seamsOf = (fs) => /** @type {DistroFsSeams} */ (/** @type {unknown} */ (fs));

/** An agent-like transport backed by the real script under the local `sh`. */
class ScriptAgent {
  constructor() {
    /** The HELLO-reported protocol version (`hello()` fills it). */
    this.protocolVersion = 0;
    /** The HELLO-reported capability set (`hello()` fills it). */
    this.caps = new Set();
    this.dir = mkdtempSync(join(tmpdir(), "wsl-fsio-"));
    this.child = spawn("sh", [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = createInterface({ input: this.child.stdout });
    /** @type {string[]} */
    this.queue = [];
    /** @type {Array<(line: string) => void>} */
    this.waiters = [];
    this.n = 0;
    /**
     * The answer waiters, by request id. An answer is routed to the call
     * that asked for it, so two requests can be in flight at once — the
     * substrate's read road sends the stat and the first window before it
     * awaits either. The real `WslAgent` routes the same way; a shared queue
     * here handed the stat's answer to the read's caller, and the stat never
     * settled.
     * @type {Map<string, (line: string) => void>}
     */
    this.answers = new Map();
    this.lines.on("line", (line) => {
      // Only an ANSWER releases its waiter: an ACK names the same id and is
      // not one.
      const id = line.split("|")[1] ?? "";
      const answer = this.answers.get(id);
      if (answer !== undefined && !line.startsWith("ACK|")) {
        this.answers.delete(id);
        answer(line);
        return;
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.queue.push(line);
    });
  }

  /**
   * Wait for one request's own answer.
   * @param {string} id - the request whose answer to wait for.
   * @returns {Promise<string>} its RES or FSERR line.
   */
  answerFor(id) {
    return new Promise((resolve) => this.answers.set(id, resolve));
  }

  async hello() {
    const message = /** @type {HelloMessage} */ (parseAgentLine(await this.nextLine()));
    assert.equal(message.type, "hello");
    this.protocolVersion = message.version;
    this.caps = new Set(message.caps ?? []);
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
    const message = /** @type {AgentMessage} */ (parseAgentLine(await this.answerFor(id)));
    if (message.type === "result") {
      return { exitCode: message.exitCode, stdout: message.stdout, stderr: message.stderr };
    }
    if (message.type === "fsError") {
      // Protocol 7's structured refusal, projected onto the shape the
      // adapter's legacy branch parses (the reason rides alongside).
      return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(message.message), reason: message.reason };
    }
    throw new Error(`unexpected answer for ${id}`);
  }

  /**
   * The `WslAgent.fsb` shape: one batched frame, one RES record stream.
   * @param {{ ops: Array<{ op: string, args: string[] }>, timeoutMs?: number }} request - the batch request.
   * @returns {Promise<{ exitCode: number, stdout: Buffer, stderr: Buffer, reason?: string }>} the settled batch.
   */
  async fsb({ ops, timeoutMs = 30000 }) {
    const id = `b${this.n++}`;
    for (const line of encodeFsbFrame({ id, ops, timeoutMs })) this.child.stdin.write(`${line}\n`);
    const message = /** @type {AgentMessage} */ (parseAgentLine(await this.answerFor(id)));
    if (message.type === "result") {
      return { exitCode: message.exitCode, stdout: message.stdout, stderr: message.stderr };
    }
    if (message.type === "fsError") {
      // Protocol 7's structured refusal, projected onto the shape the
      // adapter's legacy branch parses (the reason rides alongside).
      return { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(message.message), reason: message.reason };
    }
    throw new Error(`unexpected answer for ${id}`);
  }

  async close() {
    this.child.stdin.write("SHUTDOWN\n");
    // A resident that ignores SHUTDOWN must not wedge teardown: wait for the
    // exit under a deadline, then kill. Without the bound a cleanup failure is
    // a file-level hang that no assertion can report.
    await Promise.race([
      new Promise((resolve) => this.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000).unref()),
    ]);
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => this.child.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000).unref()),
      ]);
    }
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/**
 * One substrate bound to one live script-backed agent.
 * @param {(fs: DistroFs, root: string, agent: ScriptAgent) => Promise<void>} setup - the check body over the live substrate.
 */
async function substrate(setup) {
  const agent = new ScriptAgent();
  try {
    await agent.hello();
    const fs = new DistroFs({ agent: asAgent(agent), distro: DISTRO });
    const root = join(agent.dir, "root");
    mkdirSync(root, { recursive: true });
    await setup(fs, root, agent);
  } finally {
    // A failed assertion must not leak the live `sh` behind this substrate:
    // an orphaned agent keeps `node --test` alive at file level, where no
    // assertion can report the failure.
    await agent.close();
  }
}

/**
 * The `code` a coded error carries, when the thrown value has one.
 * @param {unknown} error - the thrown value.
 * @returns {string | undefined} its `code`, if any.
 */
const codeOf = (error) => (error && typeof error === "object" ? /** @type {{code?: string}} */ (error).code : undefined);

checks.push(["nanoseconds normalizes stat's 9-digit and find's 10-digit fractions alike", () => {
  assert.equal(nanoseconds("1790988738.912215200"), "1790988738912215200");
  assert.equal(nanoseconds("1790988738.9122152000"), "1790988738912215200", "a 10th digit is truncated, deterministically");
  assert.equal(nanoseconds("123.4"), "123400000000");
  assert.equal(nanoseconds("123"), "123000000000");
}]);

checks.push(["versionOf joins the five identity ingredients the peer's probe uses", () => {
  assert.equal(versionOf({ dev: "139", ino: "6", size: 24, mtimeNs: "1790988738912215200", ctimeNs: "1790988738912215200" }), "139:6:24:1790988738912215200:1790988738912215200");
}]);

checks.push(["parseStatRecord decodes the agent's TAB record into a probe-shaped info", () => {
  const record = Buffer.from("f\t644\t24\t139\t6\t1790988738.912215200\t1790988738.912215200", "utf8");
  assert.deepEqual(parseStatRecord(record), {
    type: "f",
    mode: 0o644,
    size: 24,
    dev: "139",
    ino: "6",
    version: "139:6:24:1790988738912215200:1790988738912215200",
  });
  // Special bits ride the record whole (setuid 4755, sticky 1777): the write
  // path re-applies them, which is what LIMITATIONS promises.
  assert.equal(parseStatRecord(Buffer.from("f\t4755\t1\t139\t7\t1.0\t1.0", "utf8")).mode, 0o4755);
  assert.equal(parseStatRecord(Buffer.from("f\t1777\t1\t139\t8\t1.0\t1.0", "utf8")).mode, 0o1777);
  // A truncated record is a coded failure, not a row of garbage values.
  assert.throws(() => parseStatRecord(Buffer.from("f\t644\t24\t139", "utf8")), /malformed stat record/);
}]);

checks.push(["resolveTarget keeps the UNC identity and follows a symlinked path", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    writeFileSync(join(root, "real.txt"), "x\n");
    symlinkSync("real.txt", join(root, "link"));
    const through = await fs.resolveTarget(join(root, "link"));
    assert.equal(through.displayPath, join(root, "link"));
    assert.ok(through.targetKey.startsWith("\\\\wsl.localhost\\ubuntu\\"), "the identity stays the distro's UNC form");
    assert.ok(through.targetKey.endsWith("real.txt"), "identity follows the symlink");
    const missing = await fs.resolveTarget(join(root, "nope", "child.txt"));
    assert.ok(missing.targetKey.endsWith("nope\\child.txt"), "the missing suffix rides the nearest real ancestor");
  });
}]);

checks.push(["stat returns null for a missing path and probe-shaped info for a real one", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    writeFileSync(join(root, "a.txt"), "x\n", { mode: 0o600 });
    assert.equal(await fs.stat(join(root, "nope")), null);
    const info = await fs.stat(join(root, "a.txt"));
    assert.ok(info, "the file is observed");
    assert.equal(info.type, "f");
    assert.equal(info.mode, 0o600);
    assert.equal(info.size, 2);
    assert.match(info.version, /^[\d:]+$/);
  });
}]);

checks.push(["listChildren sorts by name and gives a symlink child its target's identity", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const dir = join(root, "proj");
    mkdirSync(dir);
    writeFileSync(join(dir, "b.txt"), "xx\n");
    writeFileSync(join(dir, "a.txt"), "x\n");
    symlinkSync("a.txt", join(dir, "z-link"));
    symlinkSync("nowhere", join(dir, "broken"));
    const target = await fs.resolveTarget(dir);
    const entries = await fs.listChildren(target);
    assert.deepEqual(entries.map((entry) => entry.name), ["a.txt", "b.txt", "broken", "z-link"]);
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    const aTxt = byName["a.txt"];
    const zLink = byName["z-link"];
    const broken = byName.broken;
    assert.ok(aTxt !== undefined && zLink !== undefined && broken !== undefined, "the listing kept all four named entries");
    assert.equal(aTxt.type, "file");
    assert.equal(aTxt.size, 2);
    assert.equal(zLink.type, "file", "the follow-stat belongs to the target");
    assert.ok(zLink.target.targetKey.endsWith("a.txt"), "identity follows the symlink");
    assert.equal(broken.type, "other", "a dangling symlink lists as other, like the peer");
    assert.equal(broken.version, undefined, "a dangling symlink has no version, like the peer");
    assert.equal(broken.size, undefined);
  });
}]);

checks.push(["listChildren keeps every root child's name whole against the bare / parent", async () => {
  if (!POSIX) return;
  await substrate(async (fs) => {
    const target = await fs.resolveTarget("/");
    const entries = await fs.listChildren(target);
    const names = entries.map((entry) => entry.name);
    assert.ok(names.length > 2, "the root has children to name");
    // Slicing at parent.length + 1 sheared the first character off EVERY root
    // child ("/etc" -> "tc"), and the next write then created /tc.
    assert.ok(names.every((name) => !name.startsWith("/")), `names are bare: ${names.slice(0, 5).join(", ")}`);
    for (const known of ["etc", "usr", "tmp"]) {
      assert.ok(names.includes(known), `root lists "${known}" whole`);
    }
    const etc = entries.find((entry) => entry.name === "etc");
    assert.ok(etc, "etc is listed");
    assert.ok(etc.target.targetKey.endsWith("etc"), "the child identity is the whole path, not a sheared one");
  });
}]);

checks.push(["run_capture honours the output budget and reports which streams were cut", async () => {
  if (!POSIX) return;
  const agent = new ScriptAgent();
  try {
    await agent.hello();
    const id = `x${agent.n++}`;
    for (const line of encodeExecFrame({
      id,
      cwd: agent.dir,
      argv: ["sh", "-c", "printf 0123456789ABCDEF; printf oops >&2"],
      timeoutMs: 0,
      maxOutputBytes: 8,
    })) agent.child.stdin.write(`${line}\n`);
    let message;
    for (;;) {
      message = /** @type {AgentMessage} */ (parseAgentLine(await agent.nextLine()));
      if (message.type === "result" && message.id === id) break;
    }
    assert.equal(message.exitCode, 0);
    assert.equal(message.stdout.toString(), "01234567", "stdout is cut at the budget");
    assert.equal(message.truncated.stdout, true, "the cut stdout is flagged");
    assert.equal(message.stderr.toString(), "oops", "a stream under the budget passes whole");
    assert.equal(message.truncated.stderr, false, "and it is not flagged as cut");
  } finally {
    await agent.close();
  }
}]);

checks.push(["writeFileAtomic re-verifies the expected version distro-side before the rename", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const path = join(root, "guarded.txt");
    await fs.writeFileAtomic(path, "first\n", {});
    const before = await fs.stat(path);
    assert.ok(before, "the first write is observable");
    // A write whose expected version is current lands.
    await fs.writeFileAtomic(path, "second\n", { expectedVersion: before.version });
    assert.equal(readFileSync(path, "utf8"), "second\n");
    // The file changes underneath — an editor save, a git stash.
    writeFileSync(path, "concurrent edit\n");
    const external = await fs.stat(path);
    assert.ok(external, "the external change is observable");
    assert.notEqual(external.version, before.version, "the external change is a new version");
    await assert.rejects(
      fs.writeFileAtomic(path, "stale write\n", { expectedVersion: before.version }),
      (error) => codeOf(error) === "FS_STALE_VERSION" && /file changed since it was read/.test(/** @type {Error} */ (error).message),
    );
    assert.equal(readFileSync(path, "utf8"), "concurrent edit\n", "the concurrent writer's content is untouched");
    // A vanished target is the same refusal, in the host's own wording.
    const gone = await fs.stat(path);
    assert.ok(gone, "the file is observed before it vanishes");
    rmSync(path);
    await assert.rejects(
      fs.writeFileAtomic(path, "write into the void\n", { expectedVersion: gone.version }),
      (error) => codeOf(error) === "FS_STALE_VERSION" && /no longer exists/.test(/** @type {Error} */ (error).message),
    );
    // The refusals leave no staging debris in the target's directory.
    assert.deepEqual(readdirSync(root).filter((name) => name.includes(".tmpdir")), []);
  });
}]);

checks.push(["a stat's version and a list row's version are the same string on this distro", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    writeFileSync(join(root, "skewed.txt"), "x\n");
    const statInfo = await fs.stat(join(root, "skewed.txt"));
    assert.ok(statInfo, "the file is observed");
    const statVersion = statInfo.version;
    const target = await fs.resolveTarget(root);
    const row = (await fs.listChildren(target)).find((entry) => entry.name === "skewed.txt");
    assert.ok(row, "the file is listed");
    // uutils stat rounds timestamps to microseconds; find is ns-exact. When
    // these two producers fed the version, one file carried two version
    // strings and a list-derived guard failed against its own stat.
    assert.equal(row.version, statVersion, "one file, one version string — whichever op answered");
  });
}]);

checks.push(["write publishes setuid whole, and the sweep clears a dead agent's staging", async () => {
  if (!POSIX) return;
  const agent = new ScriptAgent();
  try {
    await agent.hello();
    const file = join(agent.dir, "setuid.bin");
    // A dead agent's staging leftover for the same base: the PID 999999 in its
    // name is not running, so the next write to this base sweeps it away.
    const orphan = join(agent.dir, ".setuid.bin.999999.deadbeef.tmpdir");
    mkdirSync(orphan);
    writeFileSync(join(orphan, "setuid.bin.tmp"), "stale\n");
    // A LIVE process's staging (this test itself) must be left alone.
    const live = join(agent.dir, `.setuid.bin.${process.pid}.feedface.tmpdir`);
    mkdirSync(live);
    await agent.fs({ op: "write", args: [file, "4755", "replace", "-", "MZ"], timeoutMs: 30000 });
    assert.equal(statSync(file).mode & 0o7777, 0o4755, "setuid rides the publication chmod");
    assert.equal(existsSync(orphan), false, "the dead agent's staging was swept");
    assert.equal(existsSync(live), true, "a live process's staging is left alone");
    // An overwrite carrying the stat's (now whole) mode keeps the special bits.
    await agent.fs({ op: "write", args: [file, "4755", "replace", "-", "MZ2"], timeoutMs: 30000 });
    assert.equal(statSync(file).mode & 0o7777, 0o4755, "setuid survives the overwrite");
  } finally {
    rmSync(join(agent.dir, ".setuid.bin"), { force: true, recursive: true });
    await agent.close();
  }
}]);

checks.push(["the deny dialect classifies a write's read-only bind as FS_SANDBOX_DENIED", () => {
  const fs = new DistroFs({ agent: asAgent({ fs: () => { throw new Error("must not be called"); } }), distro: DISTRO });
  /**
   * @param {string} s - the text to encode.
   * @returns {string} its base64.
   */
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  const readonlyBind = { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from(`dsh-fs|io|${b64("Read-only file system")}\n`) };
  const denial = seamsOf(fs).fail("write", readonlyBind, "/ws/f.txt");
  assert.equal(denial.code, "FS_SANDBOX_DENIED");
  assert.equal(denial.message, `cannot write "/ws/f.txt": Read-only file system`);
  const sameTextOnStat = seamsOf(fs).fail("stat", readonlyBind, "/ws/f.txt");
  assert.equal(sameTextOnStat.code, "FS_IO_ERROR", "the denial dialect is the write op's alone");
}]);

checks.push(["request maps an aborted signal to FS_ABORTED and rethrows every other error", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller cancelled"));
  const fs = new DistroFs({ agent: asAgent({ fs: () => Promise.reject(new Error("transport gone")) }), distro: DISTRO });
  await assert.rejects(seamsOf(fs).request("stat", ["/x"], controller.signal), (error) => /** @type {{code?: string}} */ (error).code === "FS_ABORTED");
  await assert.rejects(seamsOf(fs).request("stat", ["/x"], undefined), /transport gone/);
}]);

checks.push(["resolveTarget refuses an empty path before any agent round trip", async () => {
  const fs = new DistroFs({ agent: asAgent({ fs: () => { throw new Error("must not be called"); } }), distro: DISTRO });
  await assert.rejects(fs.resolveTarget("   "), (error) => /** @type {{code?: string}} */ (error).code === "FS_NOT_FOUND");
}]);

checks.push(["readTextForDiff degrades to null on a missing or binary file", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const missing = await fs.resolveTarget(join(root, "nope.txt"));
    assert.equal(await fs.readTextForDiff(missing, 1024), null, "a vanished file serves no basis");
    const bin = join(root, "b.bin");
    writeFileSync(bin, Buffer.from([0, 1, 2]));
    assert.equal(await fs.readTextForDiff(await fs.resolveTarget(bin), 1024), null, "binary degrades to null, like the peer");
  });
}]);

checks.push(["stat maps notfound to null, non-regular reads refuse, and symlinked children walk their targets", async () => {
  if (!POSIX) return; // the script-backed substrate is POSIX-side
  await substrate(async (fs, root, agent) => {
    const present = join(root, "walk.txt");
    writeFileSync(present, "walk\n");
    const link = join(root, "link.txt");
    symlinkSync(present, link);
    const linkTarget = await fs.resolveTarget(link);
    // A symlinked child costs one follow-up stat plus one realpath, walking
    // the link to its target's identity.
    const rows = await fs.listChildren(await fs.resolveTarget(root));
    const row = rows.find((entry) => entry.name === "link.txt");
    assert.ok(row, "the link child is listed");
    assert.equal(row.type, "file", "the symlink is followed to a regular file");
    assert.equal(row.target.targetKey, linkTarget.targetKey, "the child's identity is the link's target");
    // A directory read refuses with NOT_REGULAR_FILE through statRegularFile.
    await assert.rejects(fs.readWholeText(await fs.resolveTarget(root)), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_REGULAR_FILE");
  });
}]);

checks.push(["stat maps a notfound refusal to null and a non-regular lstat to its wire type", async () => {
  if (!POSIX) return; // the script-backed substrate is POSIX-side
  await substrate(async (fs, root, agent) => {
    assert.equal(await fs.stat(join(root, "absent.txt")), null, "a missing path is null, like the peer's probe");
    const present = join(root, "stat-me.txt");
    writeFileSync(present, "walk\n");
    const row = await fs.stat(present, { follow: false });
    assert.ok(row, "the lstat resolves");
    assert.equal(row.type, "f", "lstat answers the file's own type");
    // A non-regular target through statRegularFile's read verb.
    await assert.rejects(fs.readWholeText(await fs.resolveTarget(root)), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_REGULAR_FILE");
    // An aborted stat maps onto FS_ABORTED.
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(fs.stat(present, { signal: controller.signal }), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_ABORTED");
  });
}]);

checks.push(["against the real script, a read sends its stat and its first window before awaiting either", async () => {
  if (!POSIX) return; // the script-backed substrate is POSIX-side
  await substrate(async (fs, root, agent) => {
    writeFileSync(join(root, "pipelined.txt"), "one\n");
    const target = await fs.resolveTarget(join(root, "pipelined.txt"));
    const send = agent.fs.bind(agent);
    /** @type {string[]} */
    const sent = [];
    agent.fs = (request) => {
      sent.push(request.op);
      return send(request);
    };
    // Both frames are written in `readWholeText`'s own synchronous run: the
    // first tick already finds both, before any answer could have arrived.
    const reading = fs.readWholeText(target);
    assert.deepEqual(sent, ["stat", "read"], "the stat and the first window went out together");
    assert.equal(await reading, "one\n");
  });
}]);

checks.push(["a batch record with the wrong index is refused instead of misattributed", async () => {
  const fake = fakeResident({
    fsb: async () => ({
      exitCode: 0,
      stdout: Buffer.from(`OK 2|${Buffer.from("second").toString("base64")}\nOK 1|${Buffer.from("first").toString("base64")}\n`),
      stderr: Buffer.alloc(0),
    }),
  });
  const fs = new DistroFs({ agent: fake, distro: DISTRO });
  await assert.rejects(
    fs.batch([{ op: "stat", args: ["/x"] }, { op: "list", args: ["/x"] }], undefined),
    /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_IO_ERROR" && /record 1 was answered as "OK 2"/.test(error.message),
  );
}]);

checks.push(["the FS budget scales with the content a write or move must handle", async () => {
  /** @type {number[]} */
  const budgets = [];
  const fake = {
    protocolVersion: 7,
    caps: new Set(),
    fs: async (/** @type {{ op: string, timeoutMs?: number }} */ request) => {
      budgets.push(request.timeoutMs ?? 0);
      return {
        exitCode: 0,
        stdout: request.op === "move"
          ? Buffer.from("f\t644\t5\t1\t2\t3.000000000\t4.000000000\n")
          : Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      };
    },
  };
  const fs = new DistroFs({ agent: asAgent(fake), distro: DISTRO });
  await fs.writeFileAtomic("/x", Buffer.alloc(3 * 1024 * 1024));
  await fs.moveAtomic("/x", "/y", { mode: 0o644, guard: "replace", size: 5 * 1024 * 1024 });
  assert.deepEqual(budgets, [33_000, 35_000], "30 s base plus one second per MiB");
}]);

checks.push(["removeFile and moveAtomic map the v7 refusals and the SRCFAIL record", async () => {
  /** @type {import("../lib/agent.js").WslAgent} */
  const fake = /** @type {never} */ ({
    protocolVersion: 7,
    caps: new Set(["batch"]),
    fs: async (/** @type {{ op: string }} */ { op }) => (op === "delete"
      ? { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("cannot delete \"/x\": file changed since it was read"), reason: "stale" }
      : { exitCode: 0, stdout: Buffer.from(`f\t644\t5\t1\t2\t3.000000000\t4.000000000\nSRCFAIL|perm|${Buffer.from("cannot remove").toString("base64")}`), stderr: Buffer.alloc(0) }),
  });
  const fs = new DistroFs({ agent: asAgent(fake), distro: DISTRO });
  await assert.rejects(fs.removeFile("/x", undefined, undefined), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_STALE_VERSION");
  const moved = await fs.moveAtomic("/x", "/y", { mode: 0o644, guard: "replace" });
  assert.ok(moved.sourceFailure, "the SRCFAIL record rides the outcome");
  assert.equal(moved.sourceFailure.reason, "perm");
  assert.equal(moved.sourceFailure.message, "cannot remove");
  assert.equal(moved.destination.type, "f");
}]);

checks.push(["parseStatRecord refuses a malformed TAB record with the IO code", () => {
  assert.throws(
    () => parseStatRecord(Buffer.from("f\t644\t5\t1\t2")),
    /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_IO_ERROR" && /malformed stat record/.test(error.message),
  );
}]);

checks.push(["the pipelined read road maps the stat's and the read's failures onto their codes", async () => {
  if (!POSIX) return; // the script-backed substrate is POSIX-side
  await substrate(async (fs, root, agent) => {
    const target = await fs.resolveTarget(join(root, "armed.txt"));
    // A stat that answers notfound is the not-found refusal, whatever the
    // read frame says or whether it answers at all.
    agent.fs = async ({ op }) => (op === "stat"
      ? { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), reason: "notfound" }
      : { exitCode: 0, stdout: Buffer.from("never shown"), stderr: Buffer.alloc(0) });
    await assert.rejects(fs.readWholeText(target), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_NOT_FOUND" && /not found/.test(error.message));
    // An OK stat followed by a failed read maps the read frame's reason.
    agent.fs = async ({ op }) => (op === "stat"
      ? { exitCode: 0, stdout: Buffer.from("f\t600\t5\t1\t2\t3.000000000\t4.000000000"), stderr: Buffer.alloc(0) }
      : { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("read went sideways"), reason: "io" });
    await assert.rejects(fs.readWholeText(target), /** @param {Error & {code?: string}} error */ (error) => error.code === "FS_IO_ERROR" && /read went sideways/.test(error.message));
  });
}]);

checks.push(["readWholeText refuses directories, binaries and invalid UTF-8 with the peer's codes", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    mkdirSync(join(root, "adir"));
    const text = await fs.resolveTarget(join(root, "adir"));
    await assert.rejects(fs.readWholeText(text), (error) => codeOf(error) === "FS_NOT_REGULAR_FILE");
    const binaryPath = join(root, "bin.dat");
    writeFileSync(binaryPath, Buffer.from([0x61, 0, 0x62]));
    const binary = await fs.resolveTarget(binaryPath);
    await assert.rejects(fs.readWholeText(binary), (error) => codeOf(error) === "FS_NOT_TEXT" && /binary file/.test(/** @type {Error} */ (error).message));
    const invalidPath = join(root, "bad.txt");
    writeFileSync(invalidPath, Buffer.from([0xc3, 0x28]));
    const invalid = await fs.resolveTarget(invalidPath);
    await assert.rejects(fs.readWholeText(invalid), (error) => codeOf(error) === "FS_NOT_TEXT");
    const gone = await fs.resolveTarget(join(root, "nope.txt"));
    await assert.rejects(fs.readWholeText(gone), (error) => codeOf(error) === "FS_NOT_FOUND");
  });
}]);

checks.push(["readWholeText reads through a symlinked path on ext4", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    writeFileSync(join(root, "real.txt"), "through the link\n");
    symlinkSync("real.txt", join(root, "link"));
    const target = await fs.resolveTarget(join(root, "link"));
    assert.equal(await fs.readWholeText(target), "through the link\n");
  });
}]);

checks.push(["readWholeBytes caps the content and reports the peer's TOO_LARGE shape", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const path = join(root, "a.txt");
    writeFileSync(path, "abcdefgh");
    const target = await fs.resolveTarget(path);
    assert.equal(Buffer.from(await fs.readWholeBytes(target, undefined, 8)).toString(), "abcdefgh", "the exact size passes");
    assert.equal(Buffer.from(await fs.readWholeBytes(target, undefined, 9)).toString(), "abcdefgh");
    await assert.rejects(fs.readWholeBytes(target, undefined, 4), (error) => codeOf(error) === "FS_TOO_LARGE" && /8 bytes exceeds the 4-byte limit/.test(/** @type {Error} */ (error).message));
  });
}]);

checks.push(["readByteWindow returns exactly the asked-for slice, empty past EOF", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const path = join(root, "a.txt");
    writeFileSync(path, "hello world");
    const target = await fs.resolveTarget(path);
    assert.equal(Buffer.from(await fs.readByteWindow(target, { offset: 6, length: 5 })).toString(), "world");
    assert.equal(Buffer.from(await fs.readByteWindow(target, { offset: 100, length: 5 })).length, 0);
    assert.equal(Buffer.from(await fs.readByteWindow(target, { offset: 0, length: 0 })).length, 0);
  });
}]);

checks.push(["streamWholeText yields the whole text and refuses a binary prefix", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const path = join(root, "a.txt");
    writeFileSync(path, "one\ntwo\nthree\n");
    const target = await fs.resolveTarget(path);
    let joined = "";
    for await (const chunk of fs.streamWholeText(target)) joined += chunk;
    assert.equal(joined, "one\ntwo\nthree\n");
    const binaryPath = join(root, "bin.dat");
    writeFileSync(binaryPath, Buffer.from([0x61, 0, 0x62, 0x63]));
    const binary = await fs.resolveTarget(binaryPath);
    await assert.rejects(async () => {
      for await (const chunk of fs.streamWholeText(binary)) chunk;
    }, (error) => codeOf(error) === "FS_NOT_TEXT");
  });
}]);

checks.push(["writeFileAtomic creates with the peer's POSIX mode and preserves on replace", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const fresh = join(root, "new.txt");
    await fs.writeFileAtomic(fresh, "created\n");
    assert.equal(readFileSync(fresh, "utf8"), "created\n");
    const created = await fs.stat(fresh);
    assert.ok(created, "the fresh write is observable");
    assert.equal(created.mode, 0o600, "a new file takes the peer's POSIX publication mode");
    const existing = join(root, "old.txt");
    writeFileSync(existing, "old\n");
    chmodSync(existing, 0o604);
    const existingInfo = await fs.stat(existing);
    assert.ok(existingInfo, "the existing file is observable");
    const { version } = existingInfo;
    await fs.writeFileAtomic(existing, "newer\n", { mode: 0o604 });
    assert.equal(readFileSync(existing, "utf8"), "newer\n");
    const preserved = await fs.stat(existing);
    assert.ok(preserved, "the rewritten file is observable");
    assert.equal(preserved.mode, 0o604, "the existing mode is preserved");
    assert.notEqual(preserved.version, version, "the version moved with the write");
    assert.equal(readdirSync(root).filter((name) => name.includes(".tmpdir")).length, 0, "no staging dir survives");
  });
}]);

checks.push(["a guarded create refuses an unread file, and a directory incumbent distinctly", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const existing = join(root, "a.txt");
    writeFileSync(existing, "keep\n");
    await assert.rejects(
      fs.writeFileAtomic(existing, "nope\n", { createIfAbsent: { displayPath: existing } }),
      (error) => codeOf(error) === "FS_NOT_OBSERVED" && /without reading it first/.test(/** @type {Error} */ (error).message),
    );
    assert.equal(readFileSync(existing, "utf8"), "keep\n", "the incumbent survives the refusal");
    const dir = join(root, "adir");
    mkdirSync(dir);
    await assert.rejects(
      fs.writeFileAtomic(dir, "nope\n", { createIfAbsent: { displayPath: dir } }),
      (error) => codeOf(error) === "FS_NOT_REGULAR_FILE",
    );
  });
}]);

checks.push(["readForEdit detects CRLF and the edit round trip restores it", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const path = join(root, "crlf.txt");
    writeFileSync(path, "alpha\r\nbeta\r\n");
    const target = await fs.resolveTarget(path);
    const { content, lineEndings } = await fs.readForEdit(target);
    assert.equal(content, "alpha\nbeta\n");
    assert.equal(lineEndings, "CRLF");
    const edited = applyLiteralEdit(content, "beta", "gamma", false, target.displayPath);
    await fs.writeFileAtomic(path, restoreLineEndings(edited.content, lineEndings), { mode: 0o644 });
    assert.equal(readFileSync(path, "utf8"), "alpha\r\ngamma\r\n");
  });
}]);

checks.push(["applyLiteralEdit refuses an empty needle, a miss, and an ambiguous match", () => {
  assert.throws(() => applyLiteralEdit("abc", "", "x", false, "p"), (error) => codeOf(error) === "FS_EDIT_NOT_FOUND");
  assert.throws(() => applyLiteralEdit("abc", "zz", "x", false, "p"), (error) => codeOf(error) === "FS_EDIT_NOT_FOUND" && /was not found in "p"/.test(/** @type {Error} */ (error).message));
  assert.throws(() => applyLiteralEdit("abcb", "b", "x", false, "p"), (error) => codeOf(error) === "FS_AMBIGUOUS_EDIT");
  assert.deepEqual(applyLiteralEdit("abcb", "b", "x", true, "p"), { content: "axcx", replacements: 2 });
  assert.deepEqual(applyLiteralEdit("a\nb", "a\r\nb", "c", false, "p").content, "c", "CRLF inside the needle is normalized");
}]);

checks.push(["readTextForDiff serves a small text file and nulls a big, missing, or binary one", async () => {
  if (!POSIX) return;
  await substrate(async (fs, root) => {
    const small = await fs.resolveTarget(join(root, "small.txt"));
    writeFileSync(join(root, "small.txt"), "a\r\nb\r\n");
    assert.equal(await fs.readTextForDiff(small, 100), "a\nb\n");
    const big = await fs.resolveTarget(join(root, "big.txt"));
    writeFileSync(join(root, "big.txt"), "x".repeat(100));
    assert.equal(await fs.readTextForDiff(big, 100), null, "at the bound there is no basis");
    assert.equal(await fs.readTextForDiff(big, 50), null);
    const gone = await fs.resolveTarget(join(root, "nope.txt"));
    assert.equal(await fs.readTextForDiff(gone, 100), null);
    const binary = await fs.resolveTarget(join(root, "bin.dat"));
    writeFileSync(join(root, "bin.dat"), Buffer.from([0, 1]));
    assert.equal(await fs.readTextForDiff(binary, 100), null);
  });
}]);

checks.push(["the EXEC frame is untouched by the adapter's arrival", () => {
  const lines = encodeExecFrame({ id: "r1", cwd: "/", argv: ["true"], timeoutMs: 0 });
  const head = lines[0];
  assert.ok(head !== undefined, "the frame carries a headline");
  assert.equal(head.split("|")[0], "EXEC");
}]);

/** An agent returning one canned FS result, whatever op it is asked. */
/**
 * @param {{exitCode: number, stdout: Buffer, stderr: Buffer}} result - the canned round trip.
 * @returns {{ fs: WslAgent["fs"] }} the one-answer transport.
 */
function cannedAgent(result) {
  return { fs: async () => result };
}
/**
 * @param {string} reason - the wire reason token.
 * @param {string} message - the failure message text.
 * @returns {Buffer} the `dsh-fs|reason|base64` protocol line.
 */
const fsLine = (reason, message) => Buffer.from(`dsh-fs|${reason}|${Buffer.from(message, "utf8").toString("base64")}\n`, "utf8");

checks.push(["a malformed listing record is a coded failure, not a garbage row", async () => {
  // The directory's own stat answers first; the LIST round trip then returns a
  // record truncated mid-protocol.
  const responses = [
    { exitCode: 0, stdout: Buffer.from("d\t40755\t4096\t139\t6\t1790988738.912215200\t1790988738.912215200", "utf8"), stderr: Buffer.alloc(0) },
    { exitCode: 0, stdout: Buffer.from("f\t2", "utf8"), stderr: Buffer.alloc(0) },
  ];
  const fs = new DistroFs({
    agent: asAgent({
      fs: async () => {
        const response = responses.shift();
        if (response === undefined) throw new Error("the fake agent ran out of scripted responses");
        return response;
      },
    }),
    distro: DISTRO,
  });
  const target = { displayPath: "/doc", targetKey: FsTargetKey("\\\\wsl.localhost\\ubuntu\\doc") };
  await assert.rejects(() => fs.listChildren(target), (error) => /** @type {{code?: string}} */ (error).code === "FS_IO_ERROR");
}]);

checks.push(["a notdir wire reason is FS_NOT_DIRECTORY, not FS_NOT_FOUND", async () => {
  const fs = new DistroFs({
    agent: asAgent(cannedAgent({ exitCode: 1, stdout: Buffer.alloc(0), stderr: fsLine("notdir", "Not a directory") })),
    distro: DISTRO,
  });
  const target = { displayPath: "/doc/file/child", targetKey: FsTargetKey("\\\\wsl.localhost\\ubuntu\\doc\\file\\child") };
  await assert.rejects(
    () => fs.readWholeText(target),
    (error) => codeOf(error) === "FS_NOT_DIRECTORY",
  );
}]);

checks.push(["a kernel read-only denial on a WRITE is the sandbox refusal, not an I/O error", async () => {
  // The head-teacher claim of the confined substrate: a write the mount table
  // refused carries FS_SANDBOX_DISABLED's sibling — the code the tool layer
  // turns into an escalation offer. Before this check existed, the mapping
  // was guarded only by a manual Windows probe.
  const fs = new DistroFs({
    agent: asAgent(cannedAgent({ exitCode: 1, stdout: Buffer.alloc(0), stderr: fsLine("io", 'mv: cannot move: Read-only file system') })),
    distro: DISTRO,
  });
  await assert.rejects(
    () => fs.writeFileAtomic("/doc/file.txt", "content"),
    (error) => {
      assert.equal(/** @type {{code?: string}} */ (error).code, "FS_SANDBOX_DENIED");
      assert.match(/** @type {Error} */ (error).message, /cannot write "\/doc\/file\.txt"/);
      return true;
    },
  );
}]);

checks.push(["the same signature is sandbox-classified ONLY on the write path", async () => {
  // A read-side op reporting the dialect is an I/O failure — the read mounts
  // are never read-only-refused in a way the fence caused.
  const fs = new DistroFs({
    agent: asAgent(cannedAgent({ exitCode: 1, stdout: Buffer.alloc(0), stderr: fsLine("io", "Read-only file system") })),
    distro: DISTRO,
  });
  await assert.rejects(() => fs.stat("/doc/gone"), (error) => /** @type {{code?: string}} */ (error).code === "FS_IO_ERROR");
}]);

checks.push(["a write refused on ordinary permissions keeps its I/O classification", async () => {
  const fs = new DistroFs({
    agent: asAgent(cannedAgent({ exitCode: 1, stdout: Buffer.alloc(0), stderr: fsLine("perm", "Permission denied") })),
    distro: DISTRO,
  });
  await assert.rejects(() => fs.writeFileAtomic("/doc/file.txt", "content"), (error) => /** @type {{code?: string}} */ (error).code === "FS_IO_ERROR");
}]);

// --- the arms the batch-road checks never reached ---------------------------

/** Encodes one UTF-8 string as the protocol's base64 payload. @param {string} s */
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/**
 * A protocol-7 fake resident: `caps` decides the batch road, `fs`/`fsb` are
 * scripted per check. Nothing spawns.
 * @param {{ caps?: Set<string>, fs?: (request: { op: string, args?: string[] }) => Promise<{exitCode: number, stdout: Buffer, stderr: Buffer, reason?: string}>, fsb?: (request: { ops: Array<{ op: string, args: string[] }> }) => Promise<{exitCode: number, stdout: Buffer, stderr: Buffer}> }} [options]
 * @returns {import("../lib/agent.js").WslAgent} the fake, as the substrate's declared agent.
 */
function fakeResident({ caps = new Set(["batch"]), fs, fsb } = {}) {
  return /** @type {import("../lib/agent.js").WslAgent} */ (/** @type {unknown} */ ({
    protocolVersion: 7,
    caps,
    fs: fs ?? (async () => ({ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })),
    fsb: fsb ?? (async () => ({ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })),
  }));
}

/** A hand-made resolved target inside the test distro. @param {string} linuxPath */
const fakeTarget = (linuxPath) => ({
  displayPath: linuxPath,
  targetKey: FsTargetKey(`\\\\wsl.localhost\\${DISTRO}${linuxPath.replaceAll("/", "\\")}`),
});

/** The TAB stat record for one kind of node, with a stable identity. @param {string} type */
const statRecord = (type) => Buffer.from(`${type}\t755\t24\t1\t2\t3.000000000\t4.000000000`, "utf8");

checks.push(["fail's structured-reason dialect maps the write denial and the plain reason", () => {
  const fs = new DistroFs({ agent: fakeResident(), distro: DISTRO });
  // The structured result's `reason` rides the runtime shape; a variable (not
  // a fresh literal) carries the extra field past the narrower parameter type.
  /** @type {{ exitCode: number, stdout: Buffer, stderr: Buffer, reason?: string }} */
  const deniedWrite = { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("Read-only file system"), reason: "io" };
  const denial = seamsOf(fs).fail("write", deniedWrite, "/ws/f.txt");
  assert.equal(denial.code, "FS_SANDBOX_DENIED", "the write denial is the sandbox's, whatever dialect carried it");
  /** @type {{ exitCode: number, stdout: Buffer, stderr: Buffer, reason?: string }} */
  const ioStat = { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("input/output error"), reason: "io" };
  const plain = seamsOf(fs).fail("stat", ioStat, "/ws/f.txt");
  assert.equal(plain.code, "FS_IO_ERROR");
  assert.equal(plain.message, "input/output error", "the raw reason text is the message");
}]);

checks.push(["listChildren's batched stat/list dialect maps every record shape", async () => {
  const target = fakeTarget("/dir");
  /** @param {string} stdout @param {string} code @param {RegExp} match */
  const rejects = async (stdout, code, match) => {
    const fake = fakeResident({ fsb: async () => ({ exitCode: 0, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0) }) });
    await assert.rejects(new DistroFs({ agent: fake, distro: DISTRO }).listChildren(target), (error) => /** @type {{ code?: string }} */ (error).code === code && match.test(/** @type {Error} */ (error).message));
  };
  await rejects(`BAD 1|perm|${b64("permission denied")}\n`, "FS_IO_ERROR", /permission denied/);
  await rejects(`BAD 1|notfound|${b64("no such directory")}\n`, "FS_NOT_FOUND", /not found/);
  await rejects(`OK 1|${statRecord("f").toString("base64")}\n`, "FS_NOT_DIRECTORY", /not a directory/);
  await rejects(`OK 1|${statRecord("d").toString("base64")}\nBAD 2|io|${b64("list failed")}\n`, "FS_IO_ERROR", /list failed/);
  await rejects(`OK 1|${statRecord("d").toString("base64")}\n`, "FS_IO_ERROR", /distro I\/O failure/);
  // The success arm: a directory stat and an empty listing answer no rows.
  const ok = fakeResident({ fsb: async () => ({ exitCode: 0, stdout: Buffer.from(`OK 1|${statRecord("d").toString("base64")}\nOK 2|\n`), stderr: Buffer.alloc(0) }) });
  const rows = await new DistroFs({ agent: ok, distro: DISTRO }).listChildren(target);
  assert.deepEqual(rows, [], "an empty listing is no rows, not an error");
}]);

checks.push(["the pipelined read road refuses when the stat frame fails", async () => {
  // A stat frame that failed with nothing structured to read is the I/O
  // failure arm; an empty record in its place is the malformed-record arm.
  const failed = fakeResident({
    fs: async ({ op }) => (op === "stat"
      ? { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
      : { exitCode: 0, stdout: Buffer.from("never shown"), stderr: Buffer.alloc(0) }),
  });
  await assert.rejects(
    new DistroFs({ agent: failed, distro: DISTRO }).readWholeText(fakeTarget("/f.txt")),
    (error) => /** @type {{ code?: string }} */ (error).code === "FS_IO_ERROR" && /distro I\/O failure/.test(/** @type {Error} */ (error).message),
  );
  const malformed = fakeResident({ fs: async () => ({ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) });
  await assert.rejects(
    new DistroFs({ agent: malformed, distro: DISTRO }).readWholeText(fakeTarget("/f.txt")),
    (error) => /** @type {{ code?: string }} */ (error).code === "FS_IO_ERROR" && /malformed stat record/.test(/** @type {Error} */ (error).message),
  );
}]);

checks.push(["the non-batched read road stats by frame and streams chunked reads", async () => {
  let reads = 0;
  const chunk = FS_READ_CHUNK_BYTES;
  const fs = new DistroFs({
    agent: fakeResident({
      caps: new Set(), // no batch: the frame-by-frame road
      fs: async ({ op }) => {
        if (op === "stat") return { exitCode: 0, stdout: statRecord("f"), stderr: Buffer.alloc(0) };
        reads += 1;
        return { exitCode: 0, stdout: reads === 1 ? Buffer.alloc(chunk, 65) : Buffer.from("tail"), stderr: Buffer.alloc(0) };
      },
    }),
    distro: DISTRO,
  });
  const text = await fs.readWholeText(fakeTarget("/big.bin"));
  assert.equal(reads, 2, "the loop fetched a second chunk after the full one");
  assert.equal(text.length, chunk + 4, "the chunks concatenate whole");
  assert.ok(text.endsWith("tail"), "the short final chunk closes the read");
  // The stat record's size is the byte-cap gate; a file that grows between
  // stat and read is what the loop's own overflow arm is for.
  const liar = new DistroFs({
    agent: fakeResident({
      caps: new Set(),
      fs: async ({ op }) => {
        if (op === "stat") return { exitCode: 0, stdout: Buffer.from("f\t644\t5\t1\t2\t3.000000000\t4.000000000", "utf8"), stderr: Buffer.alloc(0) };
        return { exitCode: 0, stdout: Buffer.alloc(chunk, 66), stderr: Buffer.alloc(0) };
      },
    }),
    distro: DISTRO,
  });
  await assert.rejects(liar.readWholeBytes(fakeTarget("/liar.bin"), undefined, 10), (error) => /** @type {{ code?: string }} */ (error).code === "FS_TOO_LARGE", "the loop's overflow arm catches the growth the stat gate missed");
}]);

checks.push(["the pipelined read road continues past a full first chunk and never carries bytes in a batch", async () => {
  let reads = 0;
  const chunk = FS_READ_CHUNK_BYTES;
  const stat = Buffer.from(`f\t644\t${chunk + 4}\t1\t2\t3.000000000\t4.000000000`, "utf8");
  const fs = new DistroFs({
    agent: fakeResident({
      caps: new Set(["batch"]),
      // A read inside a batch is base64-encoded twice (once in its record,
      // once around the record stream): the read road must not use one.
      fsb: async () => { throw new Error("the read road put a read in a batched frame"); },
      fs: async ({ op, args }) => {
        if (op === "stat") return { exitCode: 0, stdout: stat, stderr: Buffer.alloc(0) };
        reads += 1;
        assert.equal(args?.[2], String(chunk), "every window of the unbounded read is one chunk wide");
        return { exitCode: 0, stdout: reads === 1 ? Buffer.alloc(chunk, 65) : Buffer.from("tail"), stderr: Buffer.alloc(0) };
      },
    }),
    distro: DISTRO,
  });
  const text = await fs.readWholeText(fakeTarget("/big.bin"));
  assert.equal(reads, 2, "the first window and the remainder, each by its own frame");
  assert.equal(text.length, chunk + 4, "the windows concatenate whole");
  assert.ok(text.endsWith("tail"), "the short final window closes the read");
  // A non-notfound stat refusal maps its reason on this road too.
  const refused = fakeResident({
    fs: async ({ op }) => (op === "stat"
      ? { exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("permission denied"), reason: "perm" }
      : { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
  });
  await assert.rejects(
    new DistroFs({ agent: refused, distro: DISTRO }).readWholeText(fakeTarget("/f.txt")),
    (error) => /** @type {{ code?: string }} */ (error).code === "FS_IO_ERROR" && /permission denied/.test(/** @type {Error} */ (error).message),
  );
}]);

checks.push(["a read's stat and first window are both sent before the first answer is awaited", async () => {
  /** @type {string[]} */
  const sent = [];
  /** @type {() => void} */
  let answerStat = () => {};
  const statGate = new Promise((resolve) => { answerStat = /** @type {() => void} */ (resolve); });
  const fs = new DistroFs({
    agent: fakeResident({
      fs: async ({ op }) => {
        sent.push(op);
        if (op === "stat") {
          await statGate;
          return { exitCode: 0, stdout: statRecord("f"), stderr: Buffer.alloc(0) };
        }
        return { exitCode: 0, stdout: Buffer.from("tail"), stderr: Buffer.alloc(0) };
      },
    }),
    distro: DISTRO,
  });
  const reading = fs.readWholeText(fakeTarget("/f.txt"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(sent, ["stat", "read"], "two frames went out while the stat was still unanswered: one host round trip, not two");
  answerStat();
  assert.equal(await reading, "tail");
}]);

checks.push(["a listing's symlink children are followed in one batched frame, and a dangling one keeps its shape", async () => {
  const dir = "/proj";
  const row = (/** @type {string} */ type, /** @type {string} */ name) => `${type}\t24\t1\t2\t3.000000000\t4.000000000\t${dir}/${name}`;
  const listing = [row("l", "to-file"), row("f", "plain.txt"), row("l", "dangling"), row("l", "to-dir")].join("\0") + "\0";
  /** @type {Array<Array<{ op: string, args: string[] }>>} */
  const batches = [];
  const fake = fakeResident({
    fsb: async ({ ops }) => {
      batches.push(ops);
      if (ops.some((op) => op.op === "list")) {
        return { exitCode: 0, stdout: Buffer.from(`OK 1|${statRecord("d").toString("base64")}\nOK 2|${Buffer.from(listing, "latin1").toString("base64")}\n`), stderr: Buffer.alloc(0) };
      }
      // The follow-up frame answers every stat and realpath it was asked.
      const records = ops.map((op, index) => {
        if (op.args[0] === `${dir}/dangling`) return `BAD ${index + 1}|notfound|${b64("No such file or directory")}`;
        if (op.op === "stat") return `OK ${index + 1}|${(op.args[0] === `${dir}/to-dir` ? statRecord("d") : Buffer.from("f\t644\t7\t9\t8\t3.000000000\t4.000000000", "utf8")).toString("base64")}`;
        return `OK ${index + 1}|${b64(`${dir}/plain.txt`)}`;
      });
      return { exitCode: 0, stdout: Buffer.from(`${records.join("\n")}\n`), stderr: Buffer.alloc(0) };
    },
  });
  const rows = await new DistroFs({ agent: fake, distro: DISTRO }).listChildren(fakeTarget(dir));
  assert.deepEqual(rows.map((entry) => entry.name), ["dangling", "plain.txt", "to-dir", "to-file"]);
  assert.equal(batches.length, 2, "the listing, then ONE frame for every link's follow-up: 400 sequential round trips for 200 links used to be the cost");
  assert.deepEqual(batches[1]?.map((op) => op.op), ["stat", "realpath", "stat", "realpath", "stat", "realpath"], "each link's stat and realpath, in listing order");
  const byName = Object.fromEntries(rows.map((entry) => [entry.name, entry]));
  assert.equal(byName["to-file"]?.type, "file");
  assert.equal(byName["to-file"]?.size, 7, "a file target's size is the row's");
  assert.match(String(byName["to-file"]?.version), /^9:8:7:/, "and its version");
  assert.equal(byName["to-file"]?.target.targetKey, fakeTarget(`${dir}/plain.txt`).targetKey, "the identity follows the link");
  assert.equal(byName["to-dir"]?.type, "directory");
  assert.equal(byName["to-dir"]?.size, undefined, "a directory target carries no size");
  assert.equal(byName.dangling?.type, "other", "a dangling symlink lists as other, like the peer");
  assert.equal(byName.dangling?.version, undefined);
  assert.equal(byName["plain.txt"]?.type, "file", "a plain child needs no follow-up at all");
}]);

checks.push(["a link-heavy directory has its follow-ups split so one frame stays bounded", async () => {
  const dir = "/bin";
  const names = Array.from({ length: 257 }, (_, index) => `l${index}`);
  const listing = names.map((name) => `l\t0\t1\t2\t3.000000000\t4.000000000\t${dir}/${name}`).join("\0") + "\0";
  /** @type {number[]} */
  const sizes = [];
  const fake = fakeResident({
    fsb: async ({ ops }) => {
      if (ops.some((op) => op.op === "list")) {
        return { exitCode: 0, stdout: Buffer.from(`OK 1|${statRecord("d").toString("base64")}\nOK 2|${Buffer.from(listing, "latin1").toString("base64")}\n`), stderr: Buffer.alloc(0) };
      }
      sizes.push(ops.length);
      // Every link dangles: the frame is still answered op by op.
      return { exitCode: 0, stdout: Buffer.from(`${ops.map((op, index) => `BAD ${index + 1}|notfound|${b64("gone")}`).join("\n")}\n`), stderr: Buffer.alloc(0) };
    },
  });
  const rows = await new DistroFs({ agent: fake, distro: DISTRO }).listChildren(fakeTarget(dir));
  assert.equal(rows.length, 257);
  assert.deepEqual(sizes, [512, 2], "256 links' stat and realpath per frame, then what is left");
  assert.ok(rows.every((entry) => entry.type === "other" && entry.version === undefined));
}]);

checks.push(["without the batch capability a listing keeps the serial road of one stat and one realpath per link", async () => {
  const dir = "/proj";
  const listing = `l\t0\t1\t2\t3.000000000\t4.000000000\t${dir}/link\n\0`;
  /** @type {string[]} */
  const ops = [];
  const fake = fakeResident({
    caps: new Set(),
    fs: async ({ op, args }) => {
      ops.push(op);
      // The directory's own stat answers a directory; the link's answers its target.
      if (op === "stat") return { exitCode: 0, stdout: statRecord(args?.[0] === dir ? "d" : "f"), stderr: Buffer.alloc(0) };
      if (op === "realpath") return { exitCode: 0, stdout: Buffer.from(`${dir}/target`), stderr: Buffer.alloc(0) };
      assert.equal(args?.[0], dir, "the listing itself is the only other request");
      return { exitCode: 0, stdout: Buffer.from(listing, "latin1"), stderr: Buffer.alloc(0) };
    },
  });
  const rows = await new DistroFs({ agent: fake, distro: DISTRO }).listChildren(fakeTarget(dir));
  assert.deepEqual(ops, ["stat", "list", "stat", "realpath"], "one frame per follow-up, the road a v6 peer has always taken");
  assert.equal(rows[0]?.type, "file");
  assert.equal(rows[0]?.target.targetKey, fakeTarget(`${dir}/target`).targetKey);
}]);

checks.push(["a byte-capped whole read keeps its windows one chunk wide", async () => {
  const chunk = FS_READ_CHUNK_BYTES;
  const cap = chunk + 10;
  /** @type {string[]} */
  const windows = [];
  let reads = 0;
  const fs = new DistroFs({
    agent: fakeResident({
      fs: async ({ op, args }) => {
        if (op === "stat") return { exitCode: 0, stdout: Buffer.from(`f\t644\t${cap}\t1\t2\t3.000000000\t4.000000000`, "utf8"), stderr: Buffer.alloc(0) };
        windows.push(String(args?.[2]));
        reads += 1;
        return { exitCode: 0, stdout: reads === 1 ? Buffer.alloc(chunk, 65) : Buffer.from("0123456789"), stderr: Buffer.alloc(0) };
      },
    }),
    distro: DISTRO,
  });
  const bytes = await fs.readWholeBytes(fakeTarget("/capped.bin"), undefined, cap);
  assert.equal(bytes.length, cap, "the content is read whole up to the cap");
  // The cap allows one byte more than the limit — the overflow probe — but
  // no request asks for all of it at once: the first window is one chunk.
  assert.deepEqual(windows, [String(chunk), "11"], "one chunk, then what the cap leaves plus the probe");
}]);

checks.push(["readTextForDiff degrades to null when the probe itself fails", async () => {
  const fs = new DistroFs({
    agent: fakeResident({ fs: async () => ({ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("permission denied"), reason: "perm" }) }),
    distro: DISTRO,
  });
  assert.equal(await fs.readTextForDiff(fakeTarget("/guarded.txt"), 1024), null, "a failed stat serves no diff basis, loudly null");
}]);

for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} fsio-agent checks pass${POSIX ? "" : " (record parsing only: not a POSIX shell host)"}`);
