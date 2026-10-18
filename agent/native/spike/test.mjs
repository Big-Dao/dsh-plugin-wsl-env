/**
 * Spike test for the native agent prototype (ADR 0002, stage 2).
 *
 * It drives the Rust binary over the real v5 frames and compares the shape
 * with the shipped shell agent where it matters. Not part of the unit suite:
 * the binary is built on demand.
 *
 *   node agent/native/spike/test.mjs [path-to-binary]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { decodeB64, encodeExecFrame, encodeKill, encodeSetEnv } from "../../../lib/agent-protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const binary = process.argv[2] ?? join(here, "target", "release", "dsh-wsl-agent-spike");
const shellAgent = join(repo, "agent", "wsl-agent.sh");

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

class Session {
  constructor(command, args) {
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.resume();
    this.next = 0;
    this.pong = new Promise((resolve) => {
      this.pongResolve = resolve;
    });
    this.pending = new Map();
    this.hello = new Promise((resolve, reject) => {
      this.helloResolve = resolve;
      this.helloReject = reject;
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      const f = line.split("|");
      if (f[0] === "HELLO") {
        this.helloResolve({ name: f[1], version: Number(f[2]) });
        return;
      }
      if (f[0] === "PONG") {
        this.pongResolve?.();
        return;
      }
      if (f[0] === "ACK") return;
      if (f[0] === "RES" || f[0] === "ERR") {
        const entry = this.pending.get(f[1]);
        if (entry === undefined) return;
        this.pending.delete(f[1]);
        if (f[0] === "ERR") {
          entry.reject(new Error(`${f[2]}: ${decodeB64(f[3]).toString("utf8")}`));
          return;
        }
        entry.resolve({
          exitCode: Number(f[2]),
          stdout: decodeB64(f[3]),
          stderr: decodeB64(f[4]),
          truncated: { stdout: f[5] === "1", stderr: f[6] === "1" },
        });
      }
    });
    this.child.on("error", (error) => this.helloReject(error));
    this.child.on("exit", (code) => {
      for (const entry of this.pending.values()) entry.reject(new Error(`agent exited (${code})`));
      this.pending.clear();
    });
  }

  send(lines) {
    this.child.stdin.write(`${lines.join("\n")}\n`);
  }

  exec({ argv, cwd = repo, timeoutMs = 0, maxOutputBytes = 0 }) {
    const id = `r${this.next += 1}`;
    this.send(encodeExecFrame({ id, cwd, argv, timeoutMs, maxOutputBytes }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  setEnv(key, value) {
    this.send([encodeSetEnv(key, value)]);
  }

  kill(id) {
    this.send([encodeKill(id)]);
  }

  async close() {
    this.send(["SHUTDOWN"]);
    await new Promise((resolve) => this.child.once("exit", resolve));
    this.lines.close();
  }
}

await check("HELLO names wsl-agent/v5", async () => {
  const session = new Session(binary, []);
  const hello = await session.hello;
  assert.equal(hello.name, "wsl-agent");
  assert.equal(hello.version, 5);
  await session.close();
});

await check("PING answers PONG", async () => {
  const session = new Session(binary, []);
  await session.hello;
  session.send(["PING"]);
  await session.pong;
  await session.close();
});

await check("EXEC returns the exit code and both streams", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const result = await session.exec({ argv: ["sh", "-c", "printf out; printf err >&2; exit 7"] });
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.toString(), "out");
  assert.equal(result.stderr.toString(), "err");
  await session.close();
});

await check("SETENV reaches later commands, not earlier ones", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const before = await session.exec({ argv: ["sh", "-c", "printf %s \"${SPIKE_VAR:-unset}\""] });
  assert.equal(before.stdout.toString(), "unset");
  session.setEnv("SPIKE_VAR", "hello world");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = await session.exec({ argv: ["sh", "-c", "printf %s \"$SPIKE_VAR\""] });
  assert.equal(after.stdout.toString(), "hello world");
  await session.close();
});

await check("two EXECs run concurrently; the short one settles first", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const order = [];
  const slow = session.exec({ argv: ["sh", "-c", "sleep 1; printf slow"] }).then((result) => {
    order.push("slow");
    return result;
  });
  const fast = session.exec({ argv: ["sh", "-c", "printf fast"] }).then((result) => {
    order.push("fast");
    return result;
  });
  const [slowResult, fastResult] = await Promise.all([slow, fast]);
  assert.equal(fastResult.stdout.toString(), "fast");
  assert.equal(slowResult.stdout.toString(), "slow");
  assert.deepEqual(order, ["fast", "slow"], "the shell agent is serial; the spike is not");
  await session.close();
});

await check("KILL stops a running request without the second wsl.exe", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const started = Date.now();
  const pending = session.exec({ argv: ["sh", "-c", "sleep 10"] });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const id = [...session.pending.keys()].at(-1);
  assert.ok(id !== undefined);
  session.kill(id);
  const result = await pending;
  assert.ok(result.exitCode !== 0, `killed request exit ${result.exitCode}`);
  assert.ok(Date.now() - started < 5000, "KILL did not wait for the full command");
  await session.close();
});

await check("the in-distro timeout kills the process group", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const started = Date.now();
  const result = await session.exec({ argv: ["sh", "-c", "sleep 5"], timeoutMs: 200 });
  assert.ok(result.exitCode !== 0, `timed-out request exit ${result.exitCode}`);
  assert.ok(Date.now() - started < 3000, "timeout did not fire promptly");
  await session.close();
});

await check("the output cap cuts and still drains the pipe", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const result = await session.exec({ argv: ["sh", "-c", "head -c 100000 /dev/zero"], maxOutputBytes: 1024 });
  assert.equal(result.stdout.length, 1024);
  assert.equal(result.truncated.stdout, true);
  await session.close();
});

await check("the shell agent answers the same EXEC shape (differential)", async () => {
  const session = new Session("sh", [shellAgent]);
  const hello = await session.hello;
  assert.equal(hello.name, "wsl-agent");
  assert.equal(hello.version, 5);
  const result = await session.exec({ argv: ["sh", "-c", "printf out; printf err >&2; exit 7"] });
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.toString(), "out");
  assert.equal(result.stderr.toString(), "err");
  await session.close();
});

console.log(`\n${passed} native spike checks pass`);
