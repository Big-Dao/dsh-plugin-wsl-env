/**
 * End-to-end checks for the agent script's FS frames, driven over the real
 * wire protocol under the local `sh` — no distro needed, so this runs in CI on
 * Linux and in a WSL checkout alike. Windows skips: the agent targets a POSIX
 * shell, and `test/probe/agent.sh` covers the real `wsl.exe` round trip.
 *
 * Not covered here: the host-side request machinery (`test/agent.test.mjs`
 * fakes that transport) and the adapter that maps these ops onto `ctx.fs`.
 *
 *   node test/agent-fs-script.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_NAME, PROTOCOL_VERSION, encodeB64, encodeExecFrame, encodeFsFrame, parseAgentLine } from "../lib/agent-protocol.js";

const SCRIPT = fileURLToPath(new URL("../agent/wsl-agent.sh", import.meta.url));
const POSIX = process.platform !== "win32";

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

/** One live agent process over a temp directory, driven frame by frame. */
class Harness {
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), "wsl-agent-fs-"));
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

  nextLine() {
    return this.queue.shift() ?? new Promise((resolve) => this.waiters.push(resolve));
  }

  /** @returns {Promise<string>} the HELLO line, with its version asserted. */
  async hello() {
    const line = await this.nextLine();
    const message = parseAgentLine(line);
    assert.equal(message.type, "hello");
    assert.equal(message.name, AGENT_NAME);
    assert.equal(message.version, PROTOCOL_VERSION);
    // The digest is the script's own content identity; against the real file
    // it must be exactly what a hash of that file reports.
    const expected = createHash("sha256").update(readFileSync(SCRIPT)).digest("hex");
    assert.equal(message.digest, expected);
    return line;
  }

  fs(op, args) {
    const id = `t${this.n++}`;
    for (const line of encodeFsFrame({ id, op, args, timeoutMs: 30000 })) this.child.stdin.write(`${line}\n`);
    return id;
  }

  /** Send one FS op and resolve with its RES result. */
  async call(op, args) {
    const id = this.fs(op, args);
    for (;;) {
      const message = parseAgentLine(await this.nextLine());
      if (message.type !== "result" || message.id !== id) continue;
      return message;
    }
  }

  /** First stderr line parsed as the fs failure protocol. */
  static fsFailure(result) {
    const first = result.stderr.toString("utf8").split("\n")[0];
    const [, reason, message] = first.split("|");
    return { reason, message: Buffer.from(message, "base64").toString("utf8") };
  }

  async close() {
    this.child.stdin.write("SHUTDOWN\n");
    await new Promise((resolve) => this.child.once("exit", resolve));
    rmSync(this.dir, { recursive: true, force: true });
  }
}

const b64 = (value) => encodeB64(value);
/** A distro-independent assertion: agent times arrive as `seconds.frac`. */
const TIME_SHAPE = /^\d+(\.\d+)?$/;

checks.push(["HELLO opens the protocol at the host's version", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
  } finally {
    await agent.close();
  }
}]);

checks.push(["stat of a missing path fails with the dsh-fs notfound protocol line", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const result = await agent.call("stat", [join(agent.dir, "nope")]);
    assert.equal(result.exitCode, 1);
    const failure = Harness.fsFailure(result);
    assert.equal(failure.reason, "notfound");
    assert.match(failure.message, /No such file|not found/);
  } finally {
    await agent.close();
  }
}]);

checks.push(["write replace publishes content through a staging dir that is cleaned up", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const target = join(agent.dir, "a.txt");
    const result = await agent.call("write", [target, "644", "replace", "-", "alpha\n"]);
    assert.equal(result.exitCode, 0, result.stderr.toString("utf8"));
    assert.equal(readdirSync(agent.dir).filter((name) => name.includes(".tmpdir")).length, 0, "staging dir must be gone");
    const stat = await agent.call("stat", [target]);
    const [type, mode, size] = stat.stdout.toString("utf8").split("\t");
    assert.equal(type, "f");
    assert.equal(parseInt(mode, 8) & 0o777, 0o644, "the mode field is octal text");
    assert.equal(Number(size), "alpha\n".length);
  } finally {
    await agent.close();
  }
}]);

checks.push(["write no-replace refuses an existing target with the exists reason and keeps its content", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const target = join(agent.dir, "a.txt");
    writeFileSync(target, "keep\n", { mode: 0o644 });
    const result = await agent.call("write", [target, "644", "no-replace", "-", "intruder\n"]);
    assert.equal(result.exitCode, 1);
    assert.equal(Harness.fsFailure(result).reason, "exists");
    assert.equal(readFileSync(target, "utf8"), "keep\n");
    assert.equal(readdirSync(agent.dir).filter((name) => name.includes(".tmpdir")).length, 0, "staging dir must be gone");
  } finally {
    await agent.close();
  }
}]);

checks.push(["write refuses a missing parent chain instead of materializing it", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const target = join(agent.dir, "deep", "er", "f.txt");
    const result = await agent.call("write", [target, "-", "replace", "-", "nested\n"]);
    assert.notEqual(result.exitCode, 0, "a typo'd parent chain must fail, not be created");
    const { reason } = Harness.fsFailure(result);
    assert.equal(reason, "notfound", "the refusal is the peer's ENOENT dialect");
    assert.equal(existsSync(target), false, "nothing was materialized");
  } finally {
    await agent.close();
  }
}]);

checks.push(["read returns the requested window; a window past EOF is empty", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const target = join(agent.dir, "a.txt");
    await agent.call("write", [target, "-", "replace", "-", "hello world\n"]);
    const window = await agent.call("read", [target, "6", "5"]);
    assert.equal(window.stdout.toString("utf8"), "world");
    const past = await agent.call("read", [target, "1000", "5"]);
    assert.equal(past.stdout.length, 0);
    assert.equal(past.exitCode, 0);
  } finally {
    await agent.close();
  }
}]);

checks.push(["list reports children with follow types, and keeps dangling symlinks", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const dir = join(agent.dir, "proj");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.txt"), "x\n", { flag: "wx" });
    symlinkSync("a.txt", join(dir, "link"));
    symlinkSync("nowhere", join(dir, "broken"));
    const result = await agent.call("list", [dir]);
    assert.equal(result.exitCode, 0, result.stderr.toString("utf8"));
    const records = result.stdout.toString("utf8").split("\0").filter((record) => record.length > 0).map((record) => {
      const parts = record.split("\t");
      const path = parts.slice(6).join("\t");
      return { type: parts[0], size: parts[1], mtime: parts[4], ctime: parts[5], name: path.slice(dir.length + 1) };
    });
    const byName = Object.fromEntries(records.map((record) => [record.name, record]));
    assert.deepEqual(Object.keys(byName).sort(), ["a.txt", "broken", "link"]);
    assert.equal(byName["a.txt"].type, "f");
    assert.equal(byName.link.type, "l", "the raw record reports the entry's own type; the adapter resolves the target");
    assert.equal(byName.broken.type, "l", "a dangling symlink is still listed");
    assert.match(byName["a.txt"].mtime, TIME_SHAPE);
    assert.match(byName["a.txt"].ctime, TIME_SHAPE);
  } finally {
    await agent.close();
  }
}]);

checks.push(["realpath resolves a symlinked identity and walks a missing suffix", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const dir = join(agent.dir, "proj");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "real.txt"), "x\n", { flag: "wx" });
    symlinkSync("real.txt", join(dir, "link"));
    const through = await agent.call("realpath", [join(dir, "link")]);
    assert.equal(through.exitCode, 0);
    assert.equal(through.stdout.toString("utf8"), join(dir, "real.txt"), "identity follows the symlink");
    const missing = await agent.call("realpath", [join(dir, "nope", "child.txt")]);
    assert.equal(missing.exitCode, 0);
    assert.equal(missing.stdout.toString("utf8"), join(dir, "nope", "child.txt"), "missing suffix rides the nearest real ancestor");
  } finally {
    await agent.close();
  }
}]);

checks.push(["EXEC and PING still work beside the FS frames", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const id = `x${agent.n++}`;
    for (const line of encodeExecFrame({ id, cwd: "/", argv: ["sh", "-c", "echo exec-ok"], timeoutMs: 30000 })) {
      agent.child.stdin.write(`${line}\n`);
    }
    let sawExec = false;
    let sawPong = false;
    agent.child.stdin.write("PING\n");
    for (;;) {
      const message = parseAgentLine(await agent.nextLine());
      if (message.type === "result" && message.id === id) {
        assert.equal(message.stdout.toString("utf8").trim(), "exec-ok");
        sawExec = true;
      }
      if (message.type === "pong") sawPong = true;
      if (sawExec && sawPong) break;
    }
  } finally {
    await agent.close();
  }
}]);

checks.push(["a symlinked directory as the list target answers with the target's children", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const real = join(agent.dir, "real");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "inside.txt"), "x\n", { flag: "wx" });
    symlinkSync(real, join(agent.dir, "link"));
    const result = await agent.call("list", [join(agent.dir, "link")]);
    assert.equal(result.exitCode, 0, result.stderr.toString("utf8"));
    const names = result.stdout.toString("utf8").split("\0").filter((record) => record.length > 0)
      .map((record) => record.split("\t").slice(6).join("\t"))
      .map((path) => path.slice(real.length + 1));
    assert.deepEqual(names, ["inside.txt"], "the link resolves; readdir parity, not an empty answer");
  } finally {
    await agent.close();
  }
}]);

checks.push(["an argv word that does not decode refuses the request, and nothing runs", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const id = `x${agent.n++}`;
    agent.child.stdin.write(`EXEC|${id}|${encodeB64("/")}|0|2|0\n`);
    agent.child.stdin.write(`${encodeB64("echo")}\n`);
    agent.child.stdin.write("not!!base64!!\n");
    const message = parseAgentLine(await agent.nextLine());
    assert.equal(message.type, "agentError", "the refusal is an ERR frame");
    assert.equal(message.id, id);
    assert.equal(message.reason, "protocol", "a decode failure is a contract breach, not a command");
  } finally {
    await agent.close();
  }
}]);

checks.push(["a SETENV key that is not a POSIX identifier is refused; a good key exports", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    agent.child.stdin.write("SETENV|1bad|QQo=\n");
    const refusal = parseAgentLine(await agent.nextLine());
    assert.equal(refusal.type, "agentError");
    assert.equal(refusal.id, "", "the refusal is request-less");
    assert.equal(refusal.reason, "protocol");
    agent.child.stdin.write(`SETENV|GOOD_KEY|${encodeB64("ok")}\n`);
    const id = `x${agent.n++}`;
    for (const line of encodeExecFrame({ id, cwd: "/", argv: ["sh", "-c", "printf %s $GOOD_KEY"], timeoutMs: 30000 })) {
      agent.child.stdin.write(`${line}\n`);
    }
    let ackSeen = false;
    for (;;) {
      const message = parseAgentLine(await agent.nextLine());
      if (message.type === "ack" && message.id === id) ackSeen = true;
      if (message.type === "result" && message.id === id) {
        assert.equal(ackSeen, true);
        assert.equal(message.stdout.toString("utf8"), "ok", "the validated key exported for the request");
        break;
      }
    }
  } finally {
    await agent.close();
  }
}]);

checks.push(["an unknown fs op names the breach, not a missing file", async () => {
  const agent = new Harness();
  try {
    await agent.hello();
    const result = await agent.call("bogus", []);
    assert.notEqual(result.exitCode, 0);
    const first = result.stderr.toString("utf8").split("\n")[0];
    assert.ok(first.startsWith("dsh-fs|protocol|"), `the reason names the contract breach: ${first}`);
  } finally {
    await agent.close();
  }
}]);

checks.push(["a timed-out EXEC takes the command's descendants with it", async () => {
  // The command backgrounds a shell whose ARGV carries a unique marker and
  // then sleeps far past its own budget. The timeout must answer promptly AND
  // the whole tree must be gone — the pre-process-group behaviour killed only
  // the direct child, orphaning the background shell for its natural life.
  if (!POSIX) return; // the agent and pgrep are POSIX-side
  const agent = new Harness();
  const marker = `wsl-agent-gkill-${process.pid}-${Date.now()}`;
  try {
    await agent.hello();
    const id = `x${agent.n++}`;
    const startedAt = Date.now();
    for (const line of encodeExecFrame({
      id,
      cwd: "/",
      // The inner shell's argv carries the marker, so its survival is
      // observable; the bracket in the probe pattern below keeps pgrep from
      // matching its own command line.
      argv: ["sh", "-c", `sh -c "touch /tmp/${marker} && sleep 60" & sleep 60`],
      timeoutMs: 1200,
    })) {
      agent.child.stdin.write(`${line}\n`);
    }
    for (;;) {
      const message = parseAgentLine(await agent.nextLine());
      if (message.type === "result" && message.id === id) break;
    }
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 10_000, `the timeout answered after ${elapsed}ms`);
    // The grace is 3s (TERM, then KILL); give the second signal its moment,
    // then demand a clean tree.
    await new Promise((resolve) => setTimeout(resolve, 4500));
    const { execFileSync } = await import("node:child_process");
    const survivors = execFileSync("sh", ["-c", `pgrep -f "wsl-agent-gki[l]l-${process.pid}-" | wc -l`]).toString().trim();
    assert.equal(survivors, "0", "no descendant of the timed-out request survives");
  } finally {
    await agent.close();
    rmSync(`/tmp/${marker}`, { force: true });
  }
}]);

for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} agent fs script checks pass${POSIX ? "" : " (skipped: not a POSIX shell host)"}`);
