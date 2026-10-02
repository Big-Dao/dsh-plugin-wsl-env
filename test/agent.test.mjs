/**
 * Assertion checks for the resident agent's lifecycle: handshake, request
 * framing, the one-rebuild rule, the permanent fallback, and cancellation.
 * The transport is faked, so this runs everywhere including CI.
 *
 * Not covered here: the real `wsl.exe` round trip — that is what
 * `test/probe/agent.sh` executes against a real distro.
 *
 *   node test/agent.test.mjs
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AGENT_NAME, PROTOCOL_VERSION, encodeB64 } from "../lib/agent-protocol.js";
import { AgentUnavailableError } from "../lib/agent-errors.js";
import { WslAgent } from "../lib/agent.js";

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

const checks = [];
const checkReg = (name, fn) => checks.push([name, fn]);

/** A fake `wsl.exe --exec sh wsl-agent.sh` child the tests script directly. */
class FakeAgentProcess extends EventEmitter {
  constructor({ dieAfterHello = false, dieOnRequest = false } = {}) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.exitCode = null;
    this.frames = [];
    this.silent = false;
    let buffer = "";
    this.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        this.frames.push(line);
        if (!this.silent) this.handleLine(line);
      }
    });
    this.dieAfterHello = dieAfterHello;
    this.dieOnRequest = dieOnRequest;
    queueMicrotask(() => {
      this.stdout.write(`HELLO|${AGENT_NAME}|${PROTOCOL_VERSION}\n`);
      if (this.dieAfterHello) this.emit("exit", 1, null);
    });
  }
  handleLine(line) {
    if (line === "SHUTDOWN") {
      this.exitCode = 0;
      this.emit("exit", 0, null);
      return;
    }
    if (line.startsWith("EXEC|")) {
      if (this.dieOnRequest) {
        this.exitCode = 1;
        this.emit("exit", 1, null);
        return;
      }
      const header = line.split("|");
      const id = header[1];
      const nargs = Number(header[4]);
      this.pendingArgs = nargs;
      this.pendingId = id;
      this.pendingWords = [];
      return;
    }
    if (this.pendingId && this.pendingWords.length < this.pendingArgs) {
      this.pendingWords.push(Buffer.from(line, "base64").toString("utf8"));
      if (this.pendingWords.length === this.pendingArgs) {
        const argv = this.pendingWords.join(" ");
        const stdout = Buffer.from(`${argv}\n`);
        this.stdout.write(`RES|${this.pendingId}|0|${encodeB64(stdout)}|${encodeB64(Buffer.alloc(0))}\n`);
        this.pendingId = null;
      }
    }
  }
  kill() {
    this.killed = true;
    this.emit("exit", null, "SIGKILL");
  }
}

/** A transport factory handing out scripted children in order. */
function scriptedTransport(children) {
  const made = [];
  return {
    transport: () => {
      const child = children.length > 1 ? children.shift() : children[0];
      made.push(child);
      return child;
    },
    made,
  };
}

const CONFIG = { distro: "ubuntu", scriptPath: "/mnt/c/pkg/agent/wsl-agent.sh", idleMs: 0 };

checkReg("exec rides the handshake and resolves with the decoded result", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const result = await agent.exec({ cwd: "/tmp", argv: ["echo", "hi"], timeoutMs: 0 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString("utf8"), "echo hi\n");
  assert.equal(child.frames[0], `EXEC|r0|${encodeB64("/tmp")}|0|2`);
  await agent.close();
});

checkReg("a crash with requests in flight is rebuilt exactly once and they still answer", async () => {
  const dying = new FakeAgentProcess({ dieOnRequest: true });
  const healthy = new FakeAgentProcess();
  const { transport } = scriptedTransport([dying, healthy]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const result = await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
  assert.equal(result.exitCode, 0);
  assert.ok(healthy.frames.some((line) => line.startsWith("EXEC|")));
  await agent.close();
});

checkReg("a second crash marks the agent dead and rejects in-flight and future calls", async () => {
  const first = new FakeAgentProcess({ dieOnRequest: true });
  const second = new FakeAgentProcess({ dieOnRequest: true });
  const { transport, made } = scriptedTransport([first, second]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), AgentUnavailableError);
  assert.equal(agent.unavailable, true);
  assert.match(agent.unavailableReason, /falling back permanently/);
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), AgentUnavailableError);
  // No third process may be spawned after the permanent fallback.
  assert.equal(made.length, 2);
});

checkReg("an abort kills the request and rejects with the signal's reason", async () => {
  const child = new FakeAgentProcess();
  child.silent = true; // never answers, so the KILL path is what settles the test
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const controller = new AbortController();
  const settled = agent.exec({ cwd: "/", argv: ["sleep", "100"], timeoutMs: 0, signal: controller.signal }).then(
    () => {
      throw new Error("should not have resolved");
    },
    (error) => error,
  );
  // Abort only after the request is truly in flight (registered post-handshake).
  setTimeout(() => controller.abort(new Error("caller cancelled")), 10);
  const error = await settled;
  assert.equal(error.message, "caller cancelled");
  assert.ok(child.frames.includes("KILL|r0"), "the KILL frame must be sent");
  await agent.close();
});

checkReg("a dead agent rejects at the door without spawning anything", async () => {
  const dying = new FakeAgentProcess({ dieOnRequest: true });
  const second = new FakeAgentProcess({ dieOnRequest: true });
  const { transport, made } = scriptedTransport([dying, second]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), AgentUnavailableError);
  const spawnCount = made.length;
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), AgentUnavailableError);
  assert.equal(made.length, spawnCount);
});

checkReg("ping warms the agent up and close returns it to idle, not dead", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await agent.ping();
  assert.equal(agent.state, "ready");
  await agent.close();
  assert.equal(agent.state, "idle");
  assert.equal(agent.unavailable, false);
});

for (const [name, fn] of checks) {
  await check(name, fn);
}

console.log(`\n${passed} agent lifecycle checks pass`);
