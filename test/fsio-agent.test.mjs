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
import { encodeExecFrame, encodeFsFrame, parseAgentLine } from "../lib/agent-protocol.js";
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
 * The parsed protocol messages `parseAgentLine` returns — its own `@returns`
 * stops at `object`, so the union is restated here (as `lib/agent.js` does).
 * @typedef {{type: "hello", name: string, version: number, digest: string}} HelloMessage
 * @typedef {{type: "result", id: string, exitCode: number, stdout: Buffer, stderr: Buffer, truncated: {stdout: boolean, stderr: boolean}}} ResultMessage
 * @typedef {HelloMessage | ResultMessage | {type: "pong"} | {type: "ack", id: string} | {type: "agentError", id: string, reason: string, message: string} | {type: "unknown", line: string}} AgentMessage
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
    this.dir = mkdtempSync(join(tmpdir(), "wsl-fsio-"));
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
    const message = /** @type {HelloMessage} */ (parseAgentLine(await this.nextLine()));
    assert.equal(message.type, "hello");
  }

  nextLine() {
    return this.queue.shift() ?? new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * The `WslAgent.fs` shape, over the script.
   * @param {{ op: string, args: string[], timeoutMs?: number }} request - the op and its wire arguments.
   * @returns {Promise<{exitCode: number, stdout: Buffer, stderr: Buffer}>} the RES projection for this request.
   */
  async fs({ op, args, timeoutMs = 30000 }) {
    const id = `t${this.n++}`;
    for (const line of encodeFsFrame({ id, op, args, timeoutMs })) this.child.stdin.write(`${line}\n`);
    for (;;) {
      const message = /** @type {AgentMessage} */ (parseAgentLine(await this.nextLine()));
      if (message.type === "result" && message.id === id) {
        return { exitCode: message.exitCode, stdout: message.stdout, stderr: message.stderr };
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
 * One substrate bound to one live script-backed agent.
 * @param {(fs: DistroFs, root: string, agent: ScriptAgent) => Promise<void>} setup - the check body over the live substrate.
 */
async function substrate(setup) {
  const agent = new ScriptAgent();
  await agent.hello();
  const fs = new DistroFs({ agent: asAgent(agent), distro: DISTRO });
  const root = join(agent.dir, "root");
  mkdirSync(root, { recursive: true });
  await setup(fs, root, agent);
  await agent.close();
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
    assert.equal(byName["a.txt"].type, "file");
    assert.equal(byName["a.txt"].size, 2);
    assert.equal(byName["z-link"].type, "file", "the follow-stat belongs to the target");
    assert.ok(byName["z-link"].target.targetKey.endsWith("a.txt"), "identity follows the symlink");
    assert.equal(byName.broken.type, "other", "a dangling symlink lists as other, like the peer");
    assert.equal(byName.broken.version, undefined, "a dangling symlink has no version, like the peer");
    assert.equal(byName.broken.size, undefined);
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
  assert.equal(lines[0].split("|")[0], "EXEC");
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

for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} fsio-agent checks pass${POSIX ? "" : " (record parsing only: not a POSIX shell host)"}`);
