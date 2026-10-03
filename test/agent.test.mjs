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
import { mock } from "node:test";
import { AGENT_NAME, PROTOCOL_VERSION, encodeB64 } from "../lib/agent-protocol.js";
import { AgentUnavailableError } from "../lib/agent-errors.js";
import { WslAgent, pinnedWindowsEnv } from "../lib/agent.js";
import { confinedAgent, resetConfinedAgents } from "../lib/agent-confined.js";
import { bwrapProfileArgs } from "../lib/bwrap.js";

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
      // Mirror the real agent: the dequeue ACK precedes the answer.
      this.stdout.write(`ACK|${id}\n`);
      this.pendingArgs = nargs;
      this.pendingId = id;
      this.pendingWords = [];
      return;
    }
    if (line.startsWith("FS|")) {
      if (this.dieOnRequest) {
        this.exitCode = 1;
        this.emit("exit", 1, null);
        return;
      }
      const [, id, op] = line.split("|");
      this.stdout.write(`ACK|${id}\n`);
      const payload = op === "read" ? Buffer.from("hello-bytes\n") : Buffer.alloc(0);
      this.stdout.write(`RES|${id}|0|${encodeB64(payload)}|${encodeB64(Buffer.alloc(0))}\n`);
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

/** Two event-loop turns: enough for start() and the relay's microtask chain. */
const flush = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

checkReg("exec rides the handshake and resolves with the decoded result", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const result = await agent.exec({ cwd: "/tmp", argv: ["echo", "hi"], timeoutMs: 0 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString("utf8"), "echo hi\n");
  assert.equal(child.frames[0], `EXEC|r0|${encodeB64("/tmp")}|0|2|0`);
  await agent.close();
});

checkReg("the caller's output budget rides the EXEC frame for the agent to enforce", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await agent.exec({ cwd: "/tmp", argv: ["echo", "hi"], timeoutMs: 0, maxOutputBytes: 64000 });
  assert.equal(child.frames[0], `EXEC|r0|${encodeB64("/tmp")}|0|2|64000`);
  await agent.close();
});

checkReg("a stdout line past the protocol cap kills the agent instead of accumulating", async () => {
  const child = new FakeAgentProcess();
  child.silent = true; // nothing answers; the cap is what must end this
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, frameCapBytes: 64, spawnTransport: transport });
  const settled = agent.exec({ cwd: "/", argv: ["yes"], timeoutMs: 0 }).then(
    () => {
      throw new Error("should not have resolved");
    },
    (error) => error,
  );
  await flush(); // the handshake is done: the cap acts on a READY agent's stream
  child.stdout.write(`${"x".repeat(200)}\n`);
  const error = await settled;
  assert.equal(child.killed, true, "an oversized frame must kill the transport");
  assert.match(error.message, /state is unknown/);
  await agent.close();
});

checkReg("a crash relays a read-only FS request but fails an in-flight EXEC as unknown state", async () => {
  const dying = new FakeAgentProcess();
  dying.silent = true; // ACK/RES suppressed, so BOTH requests stay in flight
  const healthy = new FakeAgentProcess();
  const { transport } = scriptedTransport([dying, healthy]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  // The command's side effects are unknowable once the agent died — replaying
  // it could run non-idempotent work twice, so it must fail instead.
  const command = agent.exec({ cwd: "/", argv: ["git", "commit"], timeoutMs: 0 }).then(
    () => {
      throw new Error("an in-flight EXEC must never be replayed");
    },
    (error) => error,
  );
  // The read provably changed nothing on its first attempt: it rides.
  const read = agent.fs({ op: "read", args: ["/tmp/f", "0", "16"], timeoutMs: 0 });
  await flush(); // handshake done; both frames sit unanswered on the dying child
  dying.emit("exit", 1, null);
  const [commandError, readResult] = await Promise.all([command, read]);
  assert.match(commandError.message, /state is unknown/);
  assert.ok(commandError instanceof AgentUnavailableError);
  assert.equal(readResult.exitCode, 0);
  assert.equal(readResult.stdout.toString("utf8"), "hello-bytes\n");
  assert.ok(healthy.frames.some((line) => line.startsWith("FS|")), "the read-only frame rides the rebuild");
  assert.equal(healthy.frames.some((line) => line.startsWith("EXEC|")), false, "an EXEC frame must never be replayed");
  await agent.close();
});

checkReg("the watchdog starts at the dequeue ACK, so queue time never spends the budget", async () => {
  const child = new FakeAgentProcess();
  child.silent = true; // never answers; only the watchdog may end this
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const settled = agent.exec({ cwd: "/", argv: ["sleep", "100"], timeoutMs: 1000 }).then(
      () => {
        throw new Error("should not have resolved");
      },
      (error) => error,
    );
    await flush();
    // Queued far past the budget with no dispatch: the shared transport must
    // still be alive, because this request never started to execute.
    mock.timers.tick(60_000);
    assert.equal(child.killed, false, "queue time must not arm the watchdog");
    // Dispatched: the ACK starts the clock — budget plus grace, then the kill.
    child.stdout.write("ACK|r0\n");
    await flush();
    mock.timers.tick(1000 + 13_000 - 1);
    assert.equal(child.killed, false, "the watchdog waits out the full grace");
    mock.timers.tick(1);
    assert.equal(child.killed, true, "a dispatched request that never answers trips its watchdog");
    // The kill orphans the request: the rebuild refuses to replay an EXEC and
    // says so, instead of running the command a second time.
    const error = await settled;
    assert.match(error.message, /state is unknown/);
  } finally {
    mock.timers.reset();
  }
  await agent.close();
});

checkReg("an abort after the relay kills the request under its relabelled id", async () => {
  const dying = new FakeAgentProcess({ dieOnRequest: true });
  const healthy = new FakeAgentProcess();
  healthy.silent = true; // the relayed request must hang until the abort kills it
  const { transport } = scriptedTransport([dying, healthy]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const controller = new AbortController();
  const settled = agent.fs({ op: "read", args: ["/tmp/f", "0", "16"], timeoutMs: 0, signal: controller.signal }).then(
    () => {
      throw new Error("should not have resolved");
    },
    (error) => error,
  );
  await flush(); // the rebuild has re-registered the request as r1
  controller.abort(new Error("caller cancelled"));
  const error = await settled;
  assert.equal(error.message, "caller cancelled");
  assert.ok(healthy.frames.includes("KILL|r1"), "the KILL must address the relabelled id, not the dead one");
  await agent.close();
});

checkReg("a second crash marks the agent dead and rejects in-flight and future calls", async () => {
  const first = new FakeAgentProcess({ dieOnRequest: true });
  const second = new FakeAgentProcess({ dieOnRequest: true });
  const { transport, made } = scriptedTransport([first, second]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  // The first crash fails its command with unknown state — an EXEC is never
  // replayed — while the rebuild goes on in the background.
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), /state is unknown/);
  await agent.start();
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

checkReg("a confined agent's argvPrefix reaches the transport before the interpreter", async () => {
  const child = new FakeAgentProcess();
  const seen = [];
  const agent = new WslAgent({
    ...CONFIG,
    argvPrefix: ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--"],
    spawnTransport: (options) => {
      seen.push(options);
      return child;
    },
  });
  await agent.exec({ cwd: "/tmp", argv: ["true"], timeoutMs: 0 });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].argvPrefix, ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--"]);
  assert.equal(seen[0].scriptPath, CONFIG.scriptPath);
});

checkReg("the confined factory builds a whole command: program, profile, separator", async () => {
  // The transport inserts this prefix directly after `wsl.exe --exec`, so a prefix
  // that starts at `--ro-bind` asks the distro to execute an option: the resident
  // dies with exit 1 during its handshake and every confined mutation fails.
  resetConfinedAgents();
  const confined = confinedAgent({
    distro: "ubuntu",
    policy: { mode: "workspace-write", workspaceRoot: "/home/u/ws" },
  });
  assert.equal(confined.argvPrefix[0], "bwrap", "the prefix must name the program");
  assert.equal(confined.argvPrefix.at(-1), "--", "bwrap's own options end before the command");
  const profile = confined.argvPrefix.slice(1, -1);
  assert.deepEqual(
    profile.slice(0, 5),
    ["--ro-bind", "/", "/", "--dev", "/dev"],
    "the read-only base of the profile follows the program",
  );
  assert.deepEqual(
    profile.slice(-5),
    ["--tmpfs", "/tmp", "--bind", "/home/u/ws", "/home/u/ws"],
    "a workspace-write policy binds the workspace read-write",
  );

  resetConfinedAgents();
  const readOnly = confinedAgent({ distro: "ubuntu", policy: { mode: "read-only", workspaceRoot: "/" } });
  assert.equal(readOnly.argvPrefix[0], "bwrap");
  assert.equal(readOnly.argvPrefix.at(-1), "--");
  assert.equal(readOnly.argvPrefix.includes("--tmpfs"), false, "read-only grants no temp area");
  resetConfinedAgents();
});

checkReg("the profile option shadows /mnt after the read-only root", () => {
  const masked = bwrapProfileArgs({ mode: "read-only", workspaceRoot: "/" }, { maskWindowsDrive: true });
  const mnt = masked.indexOf("/mnt");
  assert.ok(mnt > masked.indexOf("--ro-bind"), "the mask must follow the root bind to shadow the drive");
  assert.equal(masked[mnt - 1], "--tmpfs", "the mask is an empty tmpfs, not a bind");
  const unmasked = bwrapProfileArgs({ mode: "read-only", workspaceRoot: "/" });
  assert.equal(unmasked.includes("/mnt"), false, "the default leaves the drive visible");
  const write = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: "/w" }, { maskWindowsDrive: true });
  assert.deepEqual(write.slice(-2), ["--tmpfs", "/mnt"], "the mask is last, shadowing whatever the root bind mounted");
});

checkReg("the confined factory keys the mask into the resident's identity", async () => {
  resetConfinedAgents();
  const policy = { mode: "workspace-write", workspaceRoot: "/home/u/ws" };
  const visible = confinedAgent({ distro: "ubuntu", policy });
  const masked = confinedAgent({ distro: "ubuntu", policy, maskWindowsDrive: true });
  assert.notEqual(visible, masked, "a different mount table is a different resident");
  const mnt = masked.argvPrefix.indexOf("/mnt");
  assert.ok(mnt !== -1 && masked.argvPrefix[mnt - 1] === "--tmpfs", "the masked resident's profile shadows /mnt");
  assert.equal(visible.argvPrefix.includes("/mnt"), false, "the visible resident's profile leaves the drive in view");
  resetConfinedAgents();
});

checkReg("the transport's Windows env is pinned: no user WSLENV forwarding reaches the distro", () => {
  const pinned = pinnedWindowsEnv({
    SystemRoot: "C:\\WINDOWS",
    PATH: "C:\\Windows\\system32",
    GITHUB_TOKEN: "secret-token-value",
    WSLENV: "GITHUB_TOKEN/u:DSH_WSL_DISTRO:PATH/w",
    DSH_WSL_DISTRO: "ubuntu",
  });
  assert.equal(pinned.WSLENV, "DSH_WSL_DISTRO", "only the managed entry survives the pin, flags intact");
  assert.equal("GITHUB_TOKEN" in pinned, false, "the secret never reaches the transport env");
  assert.equal(pinned.WSLENV.includes("PATH"), false, "PATH is deliberately never listed in WSLENV");
  assert.equal(pinned.PATH, "C:\\Windows\\system32", "the Windows PATH is kept for resolving wsl.exe");
  assert.equal(pinned.DSH_WSL_DISTRO, "ubuntu", "managed facts still flow");
  assert.equal(pinned.WSL_UTF8, "1", "the UTF-8 diagnostics pin rides along");
  assert.equal(pinned.SystemRoot, "C:\\WINDOWS", "Windows essentials are kept for wsl.exe");
  const bare = pinnedWindowsEnv({});
  assert.equal(bare.WSLENV, "", "a parent without WSLENV forwards nothing");
});

for (const [name, fn] of checks) {
  await check(name, fn);
}

console.log(`\n${passed} agent lifecycle checks pass`);
