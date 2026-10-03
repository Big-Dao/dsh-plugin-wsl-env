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
import { encodeFsFrame, parseAgentLine } from "../lib/agent-protocol.js";
import { AgentSubstrate } from "../lib/fs-substrate.js";

const SCRIPT = fileURLToPath(new URL("../agent/wsl-agent.sh", import.meta.url));
const POSIX = process.platform !== "win32";
const DISTRO = "ubuntu";

let passed = 0;
const check = async (name, fn) => {
  if (!POSIX) return;
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

const checks = [];

class ScriptAgent {
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "wsl-substrate-"));
    this.child = spawn("sh", [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    this.lines = createInterface({ input: this.child.stdout });
    this.queue = [];
    this.waiters = [];
    this.n = 0;
    this.lines.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.queue.push(line);
    });
  }

  async hello() {
    assert.equal(parseAgentLine(await this.nextLine()).type, "hello");
  }

  nextLine() {
    return this.queue.shift() ?? new Promise((resolve) => this.waiters.push(resolve));
  }

  async fs({ op, args, timeoutMs = 30000 }) {
    const id = `t${this.n++}`;
    for (const line of encodeFsFrame({ id, op, args, timeoutMs })) this.child.stdin.write(`${line}\n`);
    for (;;) {
      const message = parseAgentLine(await this.nextLine());
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

/** One substrate over one live script-backed agent, with a `root` workdir. */
async function substrate(setup) {
  const agent = new ScriptAgent();
  await agent.hello();
  const sub = new AgentSubstrate({ agent, distro: DISTRO });
  const root = join(agent.dir, "root");
  mkdirSync(root, { recursive: true });
  await setup(sub, root, agent);
  await agent.close();
}

const codeOf = (error) => (error && typeof error === "object" ? error.code : undefined);
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
    assert.equal((await sub.stat(target)).type, "file");
    assert.equal(await sub.stat(await targetOf(sub, join(root, "gone"))), undefined);
    const link = await sub.lstat(join(root, "link"));
    assert.equal(link.type, "symlink", "lstat sees the link itself");
    assert.equal(link.size, "a.txt".length);
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
      (error) => codeOf(error) === "FS_STALE_VERSION" && /changed since it was read/.test(error.message),
    );
    const again = await sub.writeText(target, "two\n", { kind: "replaceIfVersion", version: first.version });
    assert.equal(again.operation, "update");
    await assert.rejects(
      sub.writeText(target, "three\n", { kind: "createIfAbsent" }),
      (error) => codeOf(error) === "FS_NOT_OBSERVED" && /without reading it first/.test(error.message),
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
      (error) => codeOf(error) === "FS_STALE_VERSION",
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
    assert.equal(rows[0].target.displayPath, join(dir, "a.txt"), "display stays in Linux coordinates");
    assert.ok(rows[0].target.targetKey.startsWith("\\\\wsl.localhost\\ubuntu\\"));
    assert.equal(rows[0].size, 2);
    assert.equal(rows[1].type, "file", "the link row reports its target");
  });
}]);

checks.push(["stage-two routing sends mutations to the policy's agent and reads to the plain one", async () => {
  if (!POSIX) return;
  const agent = new ScriptAgent();
  await agent.hello();
  const confinedCalls = [];
  const confined = {
    fs: async ({ op, args }) => {
      confinedCalls.push(op);
      return agent.fs({ op, args });
    },
    close: () => agent.close(),
  };
  const sub = new AgentSubstrate({
    agent,
    distro: DISTRO,
    agentFor: (policy) => (policy?.mode === "workspace-write" ? Promise.resolve(confined) : Promise.resolve(agent)),
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

for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} fs-substrate checks pass${POSIX ? "" : " (skipped: not a POSIX shell host)"}`);
