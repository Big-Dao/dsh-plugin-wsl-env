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
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { mock } from "node:test";
import { newTally, runCheck, skip, summaryLine } from "./skip.mjs";
import { AGENT_NAME, PROTOCOL_VERSION, encodeB64, MIN_PROTOCOL_VERSION } from "../lib/agent-protocol.js";
import { AgentRequestStateUnknownError, AgentUnavailableError, CwdError, SpawnError } from "../lib/agent-errors.js";
import { WslAgent, agentLeaseEnv, pinnedWindowsEnv } from "../lib/agent.js";
import { effectiveMaskWindowsDrive } from "../lib/index.js";
import { confinedAgent, resetConfinedAgents, runSpawnChecklist, spawnChecklistScript } from "../lib/agent-confined.js";
import { bwrapProfileArgs } from "../lib/bwrap.js";

/** The suite's totals: a check this host cannot run counts as skipped, never as passed. */
const tally = newTally();
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = async (name, fn) => {
  await runCheck(name, fn, tally);
};

/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through `check`.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const checkReg = (name, fn) => checks.push([name, fn]);

/** @typedef {{ dieAfterHello?: boolean, dieOnRequest?: boolean, noHello?: boolean, helloVersion?: number, helloDigest?: string, helloPid?: number, hangOnExec?: boolean, fsRefusal?: { reason: string, message: string }, fsbPayload?: Buffer }} FakeAgentOptions */

/** A fake `wsl.exe --exec sh wsl-agent.sh` child the tests script directly. */
class FakeAgentProcess extends EventEmitter {
  /** @type {string|null} - the EXEC request id whose argv words are still arriving. */
  pendingId = null;
  /** @type {number} - how many argv words the pending EXEC expects. */
  pendingArgs = 0;
  /** @type {string[]} - the pending EXEC's argv words decoded so far. */
  pendingWords = [];
  /** @type {number|undefined} - the PID the fake HELLO advertises, when any. */
  helloPid = undefined;
  /** @type {boolean} - ACK the EXEC but never answer it (a running command). */
  hangOnExec = false;

  /** @param {FakeAgentOptions} [options] - the fake's behaviour. */
  constructor({ dieAfterHello = false, dieOnRequest = false, noHello = false, helloVersion = PROTOCOL_VERSION, helloDigest = TEST_DIGEST, helloPid = undefined, hangOnExec = false, fsRefusal = undefined, fsbPayload = undefined } = {}) {
    super();
    this.fsRefusal = fsRefusal;
    this.fsbPayload = fsbPayload;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.exitCode = null;
    /** @type {string[]} */
    this.frames = [];
    this.silent = false;
    this.noHello = noHello;
    this.helloPid = helloPid;
    this.hangOnExec = hangOnExec;
    let buffer = "";
    this.stdin.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        this.frames.push(line);
        // SHUTDOWN lands even when silent: the real resident exits on it
        // unconditionally, and every close() behind a silent fake would
        // otherwise sit out the host's one-second kill grace.
        if (line === "SHUTDOWN" || !this.silent) this.handleLine(line);
      }
    });
    this.dieAfterHello = dieAfterHello;
    this.dieOnRequest = dieOnRequest;
    queueMicrotask(() => {
      if (!this.noHello) this.stdout.write(`HELLO|${AGENT_NAME}|${helloVersion}|${helloDigest}${this.helloPid === undefined ? "" : `|${this.helloPid}`}\n`);
      if (this.dieAfterHello) this.emit("exit", 1, null);
    });
  }
  /**
   * Answers one protocol line the way the real agent script would.
   * @param {string} line - one protocol line, terminator stripped.
   */
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
      const id = header[1] ?? null;
      const nargs = Number(header[4]);
      // Mirror the real agent: the dequeue ACK precedes the answer.
      this.stdout.write(`ACK|${id}\n`);
      this.pendingArgs = nargs;
      this.pendingId = id;
      this.pendingWords = [];
      return;
    }
    if (line.startsWith("FSB|")) {
      const [, id] = line.split("|");
      this.stdout.write(`ACK|${id}\n`);
      const payload = this.fsbPayload ?? Buffer.from("OK 1|\n");
      this.stdout.write(`RES|${id}|0|${encodeB64(payload)}|${encodeB64(Buffer.alloc(0))}|0|0\n`);
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
      if (this.fsRefusal !== undefined) {
        // Protocol 7's structured refusal channel.
        this.stdout.write(`FSERR|${id}|${this.fsRefusal.reason}|${encodeB64(this.fsRefusal.message)}\n`);
        return;
      }
      const payload = op === "read" ? Buffer.from("hello-bytes\n") : Buffer.alloc(0);
      this.stdout.write(`RES|${id}|0|${encodeB64(payload)}|${encodeB64(Buffer.alloc(0))}\n`);
      return;
    }
    if (this.pendingId && this.pendingWords.length < this.pendingArgs) {
      this.pendingWords.push(Buffer.from(line, "base64").toString("utf8"));
      if (this.pendingWords.length === this.pendingArgs) {
        if (this.hangOnExec) {
          // A command that keeps running: the host's cancellation path is the
          // only thing that ends it.
          this.pendingId = null;
          return;
        }
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

/**
 * A transport factory handing out scripted children in order.
 * @param {FakeAgentProcess[]} children - the children to hand out; when the
 *   list holds one child, it serves every spawn.
 * @returns {{transport: (options: {wslPath: string, distro: string, scriptPath: string, argvPrefix: string[]}) => import("node:child_process").ChildProcess, made: Array<FakeAgentProcess | undefined>}}
 *   the factory `WslAgent` accepts, plus every child it handed out.
 */
function scriptedTransport(children) {
  /** @type {Array<FakeAgentProcess | undefined>} */
  const made = [];
  return {
    transport: () => {
      const child = children.length > 1 ? children.shift() : children[0];
      made.push(child);
      return /** @type {import("node:child_process").ChildProcess} */ (/** @type {*} */ (child));
    },
    made,
  };
}

const TEST_DIGEST = "6f".repeat(32);
const CONFIG = { distro: "ubuntu", scriptPath: "/mnt/c/pkg/agent/wsl-agent.sh", idleMs: 0, expectedDigest: TEST_DIGEST, serialRequests: false };

/** Two event-loop turns: enough for start() and the relay's microtask chain. */
const flush = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

checkReg("a shell keeps later requests on the host and removes a cancelled one", async () => {
  const child = new FakeAgentProcess();
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, serialRequests: true, spawnTransport: transport });
  const controller = new AbortController();
  const first = agent.exec({ cwd: "/", argv: ["true"] });
  const cancelled = agent.fs({ op: "write", args: ["/tmp/f", "payload"], signal: controller.signal });
  const last = agent.fs({ op: "stat", args: ["/tmp"] });
  await flush();
  assert.equal(child.frames.filter((line) => line.startsWith("EXEC|") || line.startsWith("FS|")).length, 1);
  controller.abort(new Error("cancelled while queued"));
  await assert.rejects(cancelled, /cancelled while queued/);
  child.stdout.write("RES|r0|0||\n");
  await flush();
  assert.equal((await first).exitCode, 0);
  assert.equal(child.frames.some((line) => line.startsWith("FS|r1|")), false);
  assert.equal(child.frames.some((line) => line.startsWith("FS|r2|stat|")), true);
  child.stdout.write("RES|r2|0||\n");
  assert.equal((await last).exitCode, 0);
  await agent.close();
});

checkReg("a shell crash refuses unsent writes and relays the active read", async () => {
  const dying = new FakeAgentProcess();
  dying.silent = true;
  const healthy = new FakeAgentProcess();
  const { transport } = scriptedTransport([dying, healthy]);
  const agent = new WslAgent({ ...CONFIG, serialRequests: true, spawnTransport: transport });
  const read = agent.fs({ op: "read", args: ["/tmp/f", "0", "16"] });
  const write = agent.fs({ op: "write", args: ["/tmp/f", "payload"] }).then(() => null, (error) => error);
  await flush();
  dying.emit("exit", 1, null);
  const [result, error] = await Promise.all([read, write]);
  assert.equal(result.stdout.toString("utf8"), "hello-bytes\n");
  assert.ok(error instanceof AgentUnavailableError);
  assert.match(error.message, /never ran/);
  assert.equal(healthy.frames.some((line) => line.includes("|write|")), false);
  await agent.close();
});

checkReg("a refused FS op settles with the reason token from the FSERR line", async () => {
  const child = new FakeAgentProcess({ fsRefusal: { reason: "stale", message: "cannot delete \"/x\": file changed since it was read" } });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  try {
    const result = await agent.fs({ op: "delete", args: ["/x", "v1"] });
    assert.equal(result.exitCode, 1, "the refusal settles the request");
    assert.equal(result.reason, "stale", "the structured reason rides the settled result");
    assert.equal(result.stderr.toString(), "cannot delete \"/x\": file changed since it was read");
  } finally {
    await agent.close();
  }
});

checkReg("fsb() sends one batched frame and settles with its per-op records", async () => {
  const records = Buffer.from(`OK 1|${encodeB64(Buffer.from("stat-row"))}\nBAD 2|notfound|${encodeB64(Buffer.from("gone"))}\n`);
  const child = new FakeAgentProcess({ fsbPayload: records });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  try {
    const result = await agent.fsb({ ops: [{ op: "stat", args: ["/a"] }, { op: "read", args: ["/a", "0", "4"] }] });
    assert.equal(result.exitCode, 0, "the batch settles");
    assert.equal(result.stdout.toString(), records.toString(), "the record stream is delivered verbatim");
    assert.ok(child.frames.some((line) => line.startsWith("FSB|")), "the batch rides one FSB header");
    assert.ok(child.frames.includes("OP|stat|1") && child.frames.includes("OP|read|3"), "each op rides its own OP record");
  } finally {
    await agent.close();
  }
});

checkReg("a shell send failure counts as a rejection without a settled request", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, serialRequests: true, spawnTransport: transport });
  await agent.start();
  child.stdin.destroy();
  await assert.rejects(agent.fs({ op: "stat", args: ["/tmp"] }), /never ran/);
  assert.equal(agent.metrics().fs.rejected, 1);
  assert.equal(agent.metrics().fs.requests, 0);
  assert.equal(agent.pending.size, 0);
  await agent.close();
});

checkReg("a cancelled active shell request holds the queue until its answer", async () => {
  const child = new FakeAgentProcess();
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, serialRequests: true, signalable: false, spawnTransport: transport });
  const controller = new AbortController();
  const active = agent.exec({ cwd: "/", argv: ["true"], signal: controller.signal });
  const queued = agent.fs({ op: "stat", args: ["/tmp"] });
  await flush();
  child.stdout.write("ACK|r0\n");
  controller.abort(new Error("cancelled active"));
  await assert.rejects(active, /cancelled active/);
  assert.equal(child.frames.some((line) => line.startsWith("FS|r1|")), false);
  child.stdout.write(`ERR|r0|cwd|${encodeB64("/gone")}\n`);
  await flush();
  assert.equal(child.frames.some((line) => line.startsWith("FS|r1|stat|")), true);
  child.stdout.write("RES|r1|0||\n");
  assert.equal((await queued).exitCode, 0);
  await agent.close();
});

checkReg("closing a shell rejects its active and unsent requests", async () => {
  const child = new FakeAgentProcess();
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, serialRequests: true, spawnTransport: transport });
  const active = agent.exec({ cwd: "/", argv: ["true"] }).then(() => null, (error) => error);
  const queued = agent.fs({ op: "write", args: ["/tmp/f", "payload"] }).then(() => null, (error) => error);
  await flush();
  await agent.close();
  const [first, second] = await Promise.all([active, queued]);
  assert.ok(first instanceof AgentUnavailableError);
  assert.ok(second instanceof AgentUnavailableError);
  assert.equal(child.frames.some((line) => line.startsWith("FS|")), false);
  assert.equal(agent.pending.size, 0);
});

checkReg("a prepared native agent sends requests concurrently", async () => {
  const child = new FakeAgentProcess();
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({
    ...CONFIG,
    serialRequests: true,
    spawnTransport: transport,
    prepare: async () => ({ scriptPath: "/native/agent", expectedDigest: TEST_DIGEST, serialRequests: false }),
  });
  const first = agent.fs({ op: "stat", args: ["/tmp/a"] });
  const second = agent.fs({ op: "stat", args: ["/tmp/b"] });
  await flush();
  assert.equal(child.frames.filter((line) => line.startsWith("FS|")).length, 2);
  child.stdout.write("RES|r1|0||\nRES|r0|0||\n");
  await Promise.all([first, second]);
  await agent.close();
});

checkReg("exec scopes environment variables to each request", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const [first, second] = await Promise.all([
    agent.exec({ cwd: "/tmp", argv: ["printenv", "COLOR"], env: { COLOR: "red" } }),
    agent.exec({ cwd: "/tmp", argv: ["printenv", "COLOR"], env: { COLOR: "blue" } }),
  ]);
  assert.equal(first.stdout.toString(), "env -- COLOR=red printenv COLOR\n");
  assert.equal(second.stdout.toString(), "env -- COLOR=blue printenv COLOR\n");
  assert.equal(child.frames.some((line) => line.startsWith("SETENV|")), false);
  const equalsCommand = await agent.exec({ cwd: "/tmp", argv: ["./tool=name", "arg"], env: { COLOR: "red" } });
  assert.equal(equalsCommand.stdout.toString(), "env -- COLOR=red /bin/sh -c exec \"$@\" env ./tool=name arg\n");
  await assert.rejects(agent.exec({ cwd: "/tmp", argv: ["true"], env: { "-bad": "value" } }), /environment variable/);
  await assert.rejects(agent.exec({ cwd: "/tmp", argv: ["true"], env: { GOOD: "bad\0value" } }), /environment variable/);
  await agent.close();
});

checkReg("exec rides the handshake and resolves with the decoded result", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const result = await agent.exec({ cwd: "/tmp", argv: ["echo", "hi"], timeoutMs: 0 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString("utf8"), "echo hi\n");
  assert.equal(child.frames[0], `EXEC|r0|${encodeB64("/tmp")}|0|2|0|0`);
  await agent.close();
});

checkReg("the caller's output budget rides the EXEC frame for the agent to enforce", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await agent.exec({ cwd: "/tmp", argv: ["echo", "hi"], timeoutMs: 0, maxOutputBytes: 64000 });
  assert.equal(child.frames[0], `EXEC|r0|${encodeB64("/tmp")}|0|2|64000|0`);
  await agent.close();
});

checkReg("a stdin payload rides the frame's flag and trailing payload line", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await agent.exec({ cwd: "/tmp", argv: ["cat"], stdin: Buffer.from("ignored\n") });
  const head = child.frames[0];
  assert.ok(head !== undefined, "the frame carries a headline");
  assert.equal(head.split("|")[6], "1", "the stdin flag is set");
  assert.deepEqual(child.frames.slice(1, -1), [encodeB64("cat")], "the argv words precede the payload");
  assert.equal(child.frames.at(-1), encodeB64("ignored\n"), "the payload line carries the stdin bytes");
  await agent.close();
});

/**
 * Record every piece the fake's stdin is written in.
 * @param {FakeAgentProcess} child - the fake.
 * @returns {Buffer[]} the pieces, in the order they were written.
 */
function recordWrites(child) {
  /** @type {Buffer[]} */
  const pieces = [];
  const write = /** @type {(chunk: Buffer | string, encoding?: unknown, callback?: unknown) => boolean} */ (child.stdin.write.bind(child.stdin));
  const recording = (/** @type {Buffer | string} */ chunk, /** @type {unknown} */ encoding, /** @type {unknown} */ callback) => {
    pieces.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk)));
    return write(chunk, encoding, callback);
  };
  child.stdin.write = /** @type {PassThrough["write"]} */ (recording);
  return pieces;
}

/** The piece size `src/agent.ts` writes in pieces of; a change there is a change here. */
const PIECE = 60 * 1024;

checkReg("a frame above one pipe buffer goes out in pieces a timer turn apart, and arrives whole", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const pieces = recordWrites(child);
  await agent.exec({ cwd: "/tmp", argv: ["cat"], stdin: Buffer.from("small\n") });
  assert.equal(pieces.length, 1, "a small frame is one write, as it always was");
  const since = child.frames.length;
  pieces.length = 0;
  // A 96 KiB payload is a ~128 KiB frame: inside the band where one write
  // pays the relay's fixed ~100 ms. The clock is mocked so "a timer turn" is
  // a fact about the schedule and not a measurement.
  const payload = Buffer.alloc(96 * 1024, 0x61);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const big = agent.exec({ cwd: "/tmp", argv: ["cat"], stdin: payload });
    await flush();
    assert.equal(pieces.length, 1, "the first piece goes out at once");
    await flush();
    await flush();
    assert.equal(pieces.length, 1, "the second piece waits for a timer turn, not a same-tick continuation");
    mock.timers.tick(1);
    await flush();
    assert.equal(pieces.length, 2, "one turn moves exactly one piece");
    mock.timers.tick(1);
    await flush();
    assert.equal(pieces.length, 3);
    mock.timers.tick(1);
    await flush();
    await big;
  } finally {
    mock.timers.reset();
  }
  assert.ok(pieces.every((piece) => piece.length <= PIECE), "no piece exceeds the piece size");
  assert.equal(Buffer.concat(pieces).toString(), `${child.frames.slice(since).join("\n")}\n`, "the pieces concatenate to the frame, bytes intact and in order");
  assert.ok((pieces[0]?.length ?? 0) === PIECE && (pieces[1]?.length ?? 0) === PIECE, "full pieces first, the remainder last");
  await agent.close();
});

checkReg("a frame past the ceiling stays one write", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const pieces = recordWrites(child);
  // A 600 KiB payload is an ~800 KiB frame: one write is the faster schedule there.
  await agent.exec({ cwd: "/tmp", argv: ["cat"], stdin: Buffer.alloc(600 * 1024, 0x61) });
  assert.equal(pieces.length, 1, "no piece is paid for above the band");
  assert.ok((pieces[0]?.length ?? 0) > 512 * 1024);
  await agent.close();
});

checkReg("frames queued behind a pieced one keep their order", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const pieces = recordWrites(child);
  const big = agent.exec({ cwd: "/tmp", argv: ["cat"], stdin: Buffer.alloc(80 * 1024, 0x61) });
  const stat = agent.fs({ op: "stat", args: ["/tmp/x"] });
  const small = agent.exec({ cwd: "/tmp", argv: ["echo", "hi"] });
  await Promise.all([big, stat, small]);
  const [bigHead, echoHead] = [child.frames.findIndex((line) => line.startsWith("EXEC|") && line.endsWith("|1")), child.frames.findIndex((line) => line.startsWith("EXEC|") && !line.endsWith("|1"))];
  const fsAt = child.frames.findIndex((line) => line.startsWith("FS|"));
  assert.ok(bigHead >= 0 && echoHead > bigHead && fsAt > bigHead, `the pieced frame's lines come first (big ${bigHead}, fs ${fsAt}, echo ${echoHead})`);
  assert.equal(child.frames[bigHead + 1], encodeB64("cat"), "…and are not interleaved with the frames queued behind it");
  assert.equal(child.frames[bigHead + 2], encodeB64(Buffer.alloc(80 * 1024, 0x61)), "the payload line is whole");
  assert.ok(pieces.length > 1, "the big frame was pieced while the others waited");
  await agent.close();
});

checkReg("a resident that dies mid-piece leaves the next frames to its successor, whole", async () => {
  const dying = new FakeAgentProcess();
  dying.silent = true; // ACK/RES suppressed: the big request stays in flight
  const healthy = new FakeAgentProcess();
  const { transport } = scriptedTransport([dying, healthy]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const dyingPieces = recordWrites(dying);
  const healthyPieces = recordWrites(healthy);
  /** Resolves once the first piece is on the dying resident's stdin. */
  /** @type {() => void} */
  let firstPiece = () => {};
  const firstPieceWritten = new Promise((resolve) => {
    firstPiece = () => resolve(undefined);
  });
  const recorded = /** @type {(chunk: Buffer | string, encoding?: unknown, callback?: unknown) => boolean} */ (dying.stdin.write.bind(dying.stdin));
  const notifying = (/** @type {Buffer | string} */ chunk, /** @type {unknown} */ encoding, /** @type {unknown} */ callback) => {
    firstPiece();
    return recorded(chunk, encoding, callback);
  };
  dying.stdin.write = /** @type {PassThrough["write"]} */ (notifying);
  // The command's side effects are unknowable once the agent died, so it must
  // fail rather than ride the rebuild.
  const big = agent.exec({ cwd: "/", argv: ["git", "commit"], stdin: Buffer.alloc(96 * 1024, 0x61), timeoutMs: 0 }).then(
    () => {
      throw new Error("an in-flight EXEC must never be replayed");
    },
    (error) => error,
  );
  await firstPieceWritten;
  assert.equal(dyingPieces.length, 1, "the frame was one piece in when the resident died");
  // From here the pipe is dead for good: the pieces still queued fail, as
  // they would on a real transport.
  dying.stdin.destroy();
  dying.emit("exit", 1, null);
  const error = await big;
  assert.match(error.message, /state is unknown/);
  await agent.fs({ op: "stat", args: ["/tmp/x"] });
  assert.equal(healthyPieces.length, 1, "the next frame is one write on the successor");
  assert.equal(healthy.frames[0]?.startsWith("FS|"), true, "whole: nothing of the dead resident's half-written frame precedes it");
  await agent.close();
});

checkReg("an absent stdin keeps the payload line off the frame", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await agent.exec({ cwd: "/tmp", argv: ["echo", "hi"] });
  assert.equal(child.frames.length, 3, "header + two argv words, no payload line");
  await agent.close();
});

checkReg("a stdout line past the protocol cap kills the agent instead of accumulating", async () => {
  const child = new FakeAgentProcess({ helloDigest: "" });
  child.silent = true; // nothing answers; the cap is what must end this
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, expectedDigest: undefined, frameCapBytes: 64, spawnTransport: transport });
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

checkReg("a lost request's refusal class says whether it may have run", async () => {
  const dying = new FakeAgentProcess();
  dying.silent = true; // nothing is answered, so both requests stay on the dying child
  const healthy = new FakeAgentProcess();
  const { transport } = scriptedTransport([dying, healthy]);
  const agent = new WslAgent({ ...CONFIG, serialRequests: true, spawnTransport: transport });
  const sent = agent.exec({ cwd: "/", argv: ["git", "commit"], timeoutMs: 0 }).then(() => null, (error) => error);
  const queued = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(() => null, (error) => error);
  await flush();
  // The shell holds the second frame on the host until the first is answered.
  assert.equal(dying.frames.filter((line) => line.startsWith("EXEC|")).length, 1, "only the first frame reached the dying resident");
  dying.emit("exit", 1, null);
  const [sentError, queuedError] = await Promise.all([sent, queued]);
  // The class is what a caller with effects reads: the sent command may have
  // run and must not be retried, the queued one provably never did.
  assert.ok(sentError instanceof AgentRequestStateUnknownError, "a sent request refuses as state-unknown");
  assert.ok(sentError instanceof AgentUnavailableError, "and stays an unavailable refusal for read-only callers");
  assert.match(/** @type {Error} */ (sentError).message, /state is unknown/);
  assert.ok(!(queuedError instanceof AgentRequestStateUnknownError), "an unsent request is the plain out-of-service cue");
  assert.ok(queuedError instanceof AgentUnavailableError);
  assert.match(/** @type {Error} */ (queuedError).message, /never ran/);
  await agent.close();
});

checkReg("a close with a request in flight refuses it as state-unknown and the queued ones as never run", async () => {
  const child = new FakeAgentProcess({ hangOnExec: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, serialRequests: true, spawnTransport: transport });
  const running = agent.exec({ cwd: "/", argv: ["sleep", "100"], timeoutMs: 0 }).then(() => null, (error) => error);
  const queued = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(() => null, (error) => error);
  await flush();
  await agent.close();
  const [runningError, queuedError] = await Promise.all([running, queued]);
  assert.ok(runningError instanceof AgentRequestStateUnknownError, "the resident was closed on a running command: its state is unknown");
  assert.match(/** @type {Error} */ (runningError).message, /closed/);
  assert.ok(!(queuedError instanceof AgentRequestStateUnknownError), "a request the shell never wrote never ran");
  assert.match(/** @type {Error} */ (queuedError).message, /never ran/);
});

checkReg("a crash fails an in-flight FS write as unknown state, never replaying it", async () => {
  const dying = new FakeAgentProcess();
  dying.silent = true; // both FS requests stay in flight
  const healthy = new FakeAgentProcess();
  const { transport } = scriptedTransport([dying, healthy]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const write = agent.fs({ op: "write", args: ["/tmp/f", "payload"], timeoutMs: 0 }).then(() => "resolved", (error) => error);
  const list = agent.fs({ op: "list", args: ["/tmp"], timeoutMs: 0 });
  await flush();
  dying.emit("exit", 1, null);
  const [writeError] = await Promise.all([write, list]);
  assert.ok(writeError instanceof AgentUnavailableError, "a write in flight is a failure, not a retry");
  assert.match(writeError.message, /state is unknown/);
  assert.equal(healthy.frames.some((line) => line.includes("|write|")), false, "the write frame must never be replayed");
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

checkReg("a frame written but never ACKed trips the dispatch watchdog", async () => {
  const child = new FakeAgentProcess();
  child.silent = true; // the process stays alive, but it never dequeues
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, dispatchTimeoutMs: 5000 });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const settled = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(
      () => {
        throw new Error("should not have resolved");
      },
      (error) => error,
    );
    await flush();
    mock.timers.tick(4999);
    assert.equal(child.killed, false, "the dispatch ceiling has not run out yet");
    mock.timers.tick(1);
    assert.equal(child.killed, true, "a resident that never ACKs is killed instead of holding the queue");
    const error = await settled;
    assert.ok(error instanceof AgentUnavailableError);
    assert.match(error.message, /state is unknown/, "the killed transport cannot prove the request did not run");
  } finally {
    mock.timers.reset();
  }
  await agent.close();
});

checkReg("the ACK disarms the dispatch watchdog", async () => {
  const child = new FakeAgentProcess();
  child.silent = true; // ACK is scripted below; the answer never comes
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, dispatchTimeoutMs: 5000 });
  mock.timers.enable({ apis: ["setTimeout"] });
  const settled = agent.exec({ cwd: "/", argv: ["sleep", "100"], timeoutMs: 0 }).then(
    () => {
      throw new Error("should not have resolved");
    },
    (error) => error,
  );
  try {
    await flush();
    child.stdout.write("ACK|r0\n");
    await flush();
    mock.timers.tick(60_000);
    assert.equal(child.killed, false, "an ACKed request with no budget may run indefinitely");
  } finally {
    mock.timers.reset();
  }
  await agent.close();
  assert.match((await settled).message, /closed/);
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
  const secondDeath = await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(() => null, (error) => error);
  assert.ok(secondDeath instanceof AgentRequestStateUnknownError, "the second death's in-flight request may have run too");
  assert.match(/** @type {Error} */ (secondDeath).message, /exited again.*state is unknown/, "and its refusal says so, with the inspect-first remedy");
  assert.equal(agent.unavailable, true);
  assert.match(agent.unavailableReason, /reviving in/);
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), /agent is down/);
  // The backoff keeps a third process from spawning before the revival window.
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
  /** @type {{wslPath: string, distro: string, scriptPath: string, argvPrefix: string[]}[]} */
  const seen = [];
  const agent = new WslAgent({
    ...CONFIG,
    argvPrefix: ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--"],
    spawnTransport: (options) => {
      seen.push(options);
      return /** @type {import("node:child_process").ChildProcess} */ (/** @type {*} */ (child));
    },
  });
  await agent.exec({ cwd: "/tmp", argv: ["true"], timeoutMs: 0 });
  assert.equal(seen.length, 1);
  const confined = seen[0];
  assert.ok(confined !== undefined, "the confinement was asked once");
  assert.deepEqual(confined.argvPrefix, ["bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--"]);
  assert.equal(confined.scriptPath, CONFIG.scriptPath);
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
    profile.slice(-8),
    ["--bind", "/tmp", "/tmp", "--tmpfs", "/dev/shm", "--bind", "/home/u/ws", "/home/u/ws"],
    "workspace-write binds the workspace AND the real /tmp the fence grants: a write the fence approved must land where every reader reads",
  );
  const tmpfsAt = profile.indexOf("--tmpfs");
  assert.deepEqual(profile.slice(tmpfsAt, tmpfsAt + 2), ["--tmpfs", "/dev/shm"], "the fs resident's only tmpfs is the shm temp area; /tmp stays real");

  resetConfinedAgents();
  const ephemeral = confinedAgent({
    distro: "ubuntu",
    policy: { mode: "workspace-write", workspaceRoot: "/home/u/ws" },
    realTmp: false,
  });
  const ephemeralProfile = ephemeral.argvPrefix.slice(1, -1);
  assert.deepEqual(
    ephemeralProfile.slice(-7),
    ["--tmpfs", "/tmp", "--tmpfs", "/dev/shm", "--bind", "/home/u/ws", "/home/u/ws"],
    "realTmp: false restores the ephemeral temp area (tests and probes only)",
  );

  resetConfinedAgents();
  const readOnly = confinedAgent({ distro: "ubuntu", policy: { mode: "read-only", workspaceRoot: "/" } });
  assert.equal(readOnly.argvPrefix[0], "bwrap");
  assert.equal(readOnly.argvPrefix.at(-1), "--");
  assert.equal(readOnly.argvPrefix.includes("--tmpfs"), false, "read-only grants no temp area");
  assert.equal(readOnly.argvPrefix.includes("/tmp"), false, "read-only mounts no /tmp at all");
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

checkReg("realTmp binds the real /tmp the fence grants, instead of an ephemeral tmpfs", () => {
  const real = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: "/w" }, { realTmp: true });
  assert.deepEqual(
    real.slice(9),
    ["--bind", "/tmp", "/tmp", "--tmpfs", "/dev/shm", "--bind", "/w", "/w"],
    "the real /tmp is bound read-write where the ephemeral tmpfs used to sit",
  );
  assert.deepEqual(real.slice(real.indexOf("--tmpfs"), real.indexOf("--tmpfs") + 2), ["--tmpfs", "/dev/shm"], "the only tmpfs is the shm temp area, not /tmp");
  const ephemeral = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: "/w" });
  assert.deepEqual(ephemeral.slice(9, 10), ["--tmpfs"], "the default keeps the ephemeral temp area");
  const readOnly = bwrapProfileArgs({ mode: "read-only", workspaceRoot: "/" }, { realTmp: true });
  assert.equal(readOnly.includes("/tmp"), false, "realTmp is inert under read-only: no /tmp mount exists to change");
});

checkReg("writableRoots binds each effective root after the workspace", () => {
  const args = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: "/w" }, { writableRoots: ["/cache", "/data"] });
  assert.deepEqual(
    args.slice(-9),
    ["--bind", "/w", "/w", "--bind", "/cache", "/cache", "--bind", "/data", "/data"],
    "the grants follow the workspace bind in the resolver's order",
  );
  const readOnly = bwrapProfileArgs({ mode: "read-only", workspaceRoot: "/" }, { writableRoots: ["/cache"] });
  assert.equal(readOnly.includes("/cache"), false, "read-only grants no extra write");
  const none = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: "/w" });
  assert.equal(none.includes("/cache"), false, "the default still binds only the workspace");
});

checkReg("the confined factory keys the roots into the resident's identity", () => {
  resetConfinedAgents();
  const policy = { mode: "workspace-write", workspaceRoot: "/home/u/ws" };
  const plain = confinedAgent({ distro: "ubuntu", policy });
  const granted = confinedAgent({ distro: "ubuntu", policy, writableRoots: ["/home/u/.npm"] });
  assert.notEqual(plain, granted, "a different mount table is a different resident");
  const bind = granted.argvPrefix.indexOf("/home/u/.npm");
  assert.ok(bind !== -1 && granted.argvPrefix[bind - 1] === "--bind", "the granted resident binds the cache");
  assert.equal(plain.argvPrefix.includes("/home/u/.npm"), false, "the plain resident does not");
  resetConfinedAgents();
});

checkReg("pidNamespace: false keeps the mounts and lets background processes survive", () => {
  const session = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: "/w" }, { pidNamespace: false, realTmp: true });
  assert.equal(session.includes("--unshare-pid"), false, "the session runtime has no PID namespace");
  assert.ok(session.includes("--proc"), "the /proc mount stays");
  assert.deepEqual(session.slice(-8), ["--bind", "/tmp", "/tmp", "--tmpfs", "/dev/shm", "--bind", "/w", "/w"]);
  const perCommand = bwrapProfileArgs({ mode: "workspace-write", workspaceRoot: "/w" });
  assert.equal(perCommand.includes("--unshare-pid"), true, "the default stays the per-command shape");
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

checkReg("the confined factory keys the socket masks into the resident's identity", () => {
  resetConfinedAgents();
  const policy = { mode: "workspace-write", workspaceRoot: "/home/u/ws" };
  const plain = confinedAgent({ distro: "ubuntu", policy });
  const masked = confinedAgent({ distro: "ubuntu", policy, socketMasks: ["/run/user/1000/bus"] });
  assert.notEqual(plain, masked, "a different socket mount table is a different resident");
  const index = masked.argvPrefix.indexOf("/run/user/1000/bus");
  assert.ok(index > 1 && masked.argvPrefix[index - 2] === "--ro-bind" && masked.argvPrefix[index - 1] === "/dev/null", "the masked resident binds /dev/null over the socket");
  assert.equal(plain.argvPrefix.includes("/run/user/1000/bus"), false, "the plain resident does not");
  resetConfinedAgents();
});

checkReg("the confined factory keys the interop mask into the resident's identity", () => {
  resetConfinedAgents();
  const policy = { mode: "workspace-write", workspaceRoot: "/home/u/ws" };
  const visible = confinedAgent({ distro: "ubuntu", policy });
  const masked = confinedAgent({ distro: "ubuntu", policy, maskInterop: true });
  assert.notEqual(visible, masked, "a different interop mount table is a different resident");
  const index = masked.argvPrefix.indexOf("/run/WSL");
  assert.ok(index > 0 && masked.argvPrefix[index - 1] === "--tmpfs", "the masked resident's profile shadows the interop transport");
  assert.equal(visible.argvPrefix.includes("/run/WSL"), false, "the visible resident leaves it in view");
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

checkReg("a handshake version mismatch kills the transport and fails the session", async () => {
  const child = new FakeAgentProcess({ helloVersion: MIN_PROTOCOL_VERSION - 1 });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await assert.rejects(
    () => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }),
    /handshake mismatch|exited during handshake/,
    "a mismatched transport is killed and the session fails loudly",
  );
  assert.equal(child.killed, true, "the mismatched transport is killed, not left running");
});

checkReg("a v6 agent is still accepted (negotiation window)", async () => {
  const child = new FakeAgentProcess({ helloVersion: MIN_PROTOCOL_VERSION });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  try {
    const result = await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
    assert.equal(result.exitCode, 0);
    assert.equal(agent.protocolVersion, MIN_PROTOCOL_VERSION, "the negotiated version is recorded");
    assert.deepEqual([...agent.caps], [], "a v6 HELLO advertises no capabilities");
  } finally {
    await agent.close();
  }
});

checkReg("spawn failure and stderr chatter surface as diagnostics, not hangs", async () => {
  const child = new FakeAgentProcess();
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const settled = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(() => "resolved", (e) => e);
  await flush();
  child.stderr.write("wsl.exe: some diagnostic\n");
  assert.match(agent.lastError, /some diagnostic/, "stderr chatter is captured as diagnostics");
  // A spawn failure AFTER the handshake has settled cannot reject the session
  // (that promise is already resolved); what it does is take the transport
  // down, so the in-flight request rides the rebuild and comes back as
  // unknown-state — never as a hang.
  child.emit("error", new Error("spawn failed"));
  child.emit("exit", 1, null);
  const error = await settled;
  assert.match(error.message, /state is unknown/);
  await agent.close();
});

checkReg("protocol garbage after the handshake is dropped, and a cwd rejection reads as CwdError", async () => {
  const child = new FakeAgentProcess();
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const settled = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(() => "resolved", (e) => e);
  await flush();
  child.stdout.write("total garbage\n");
  child.stdout.write(`ERR|r0|cwd|${encodeB64("/gone")}\n`);
  const error = await settled;
  assert.ok(error instanceof CwdError, "the command's own cwd refusal is a CwdError");
  assert.match(error.message, /could not enter working directory "\/gone"/);
  await agent.close();
});

checkReg("a spawn rejection reads as SpawnError so the executor can retry one-shot", async () => {
  const child = new FakeAgentProcess();
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const settled = agent.exec({ cwd: "/gone", argv: ["true"], timeoutMs: 0 }).then(() => "resolved", (e) => e);
  await flush();
  child.stdout.write(`ERR|r0|spawn|${encodeB64("No such file or directory (os error 2)")}\n`);
  const error = await settled;
  assert.ok(error instanceof SpawnError, "a spawn failure is its own class, not the agent being out");
  assert.match(error.message, /No such file or directory/);
  await agent.close();
});

checkReg("an agentError that is not cwd reads as the agent being out", async () => {
  const child = new FakeAgentProcess();
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const settled = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(() => "resolved", (e) => e);
  await flush();
  child.stdout.write(`ERR|r0|protocol|${encodeB64("unrecognized request")}\n`);
  const error = await settled;
  assert.ok(error instanceof AgentUnavailableError);
  assert.match(error.message, /agent rejected request r0 \(protocol\)/);
  await agent.close();
});

checkReg("a pre-aborted signal rejects exec and fs at the door", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const controller = new AbortController();
  controller.abort(new Error("cancelled up front"));
  await assert.rejects(
    () => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0, signal: controller.signal }),
    /cancelled up front/,
  );
  await assert.rejects(
    () => agent.fs({ op: "stat", args: ["/x"], timeoutMs: 0, signal: controller.signal }),
    /cancelled up front/,
  );
  await agent.close();
});

checkReg("ping refuses a dead agent at the door", async () => {
  const dying = new FakeAgentProcess({ dieOnRequest: true });
  const second = new FakeAgentProcess({ dieOnRequest: true });
  const { transport } = scriptedTransport([dying, second]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), /state is unknown/);
  await agent.start();
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), AgentUnavailableError);
  assert.equal(agent.unavailable, true);
  await assert.rejects(() => agent.ping(), AgentUnavailableError, "a dead agent refuses even a ping");
});

checkReg("an idle agent retires through its own timer", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ distro: "ubuntu", scriptPath: "/x", idleMs: 25, spawnTransport: transport });
  // The clock is mocked before the first dispatch so the idle timer the
  // request arms is on the mocked schedule.
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
    mock.timers.tick(25); // the idle deadline itself
    await flush();
    assert.equal(child.exitCode, 0, "the idle timer shut the agent down cleanly");
    assert.equal(agent.state, "idle", "retirement is idle, not dead — a later call respawns");
  } finally {
    mock.timers.reset();
  }
});

checkReg("an over-cap buffer with no newline yet is dropped mid-flight", async () => {
  const child = new FakeAgentProcess({ helloDigest: "" });
  child.silent = true;
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, expectedDigest: undefined, frameCapBytes: 64, spawnTransport: transport });
  const settled = agent.exec({ cwd: "/", argv: ["yes"], timeoutMs: 0 }).then(() => "resolved", (e) => e);
  await flush();
  child.stdout.write("x".repeat(200)); // no newline — the accumulator itself must bail
  const error = await settled;
  assert.equal(child.killed, true, "the accumulator must not hold an over-cap line open");
  assert.match(error.message, /state is unknown/);
  await agent.close();
});

checkReg("a rebuild whose start fails marks the agent dead and fails the carried request", async () => {
  const dying = new FakeAgentProcess();
  dying.silent = true;
  const broken = new FakeAgentProcess({ noHello: true }); // the rebuild never completes its handshake
  const { transport } = scriptedTransport([dying, broken]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const settled = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(() => "resolved", (e) => e);
  await flush();
  dying.emit("exit", 1, null); // the death triggers the single permitted rebuild
  const error = await settled;
  assert.match(error.message, /state is unknown/);
  await flush(); // the rebuild has spawned `broken`; its handshake is now pending
  assert.equal(agent.state, "starting");
  broken.emit("error", new Error("spawn failed")); // the rebuild's start fails
  await flush();
  assert.equal(agent.unavailable, true, "a failed rebuild marks the agent dead");
  assert.equal(agent.state, "dead");
});

checkReg("a dead agent revives after its backoff and does not replay the failed request", async () => {
  const dying = new FakeAgentProcess();
  dying.silent = true;
  const broken = new FakeAgentProcess({ noHello: true });
  const healthy = new FakeAgentProcess({ helloPid: 77 });
  const { transport } = scriptedTransport([dying, broken, healthy]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, revivalBackoffMs: 1 });
  // The clock is mocked from the start — Date too, because the revival
  // backoff is a `deadUntil` wall-clock stamp, not a timer.
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let failed;
  try {
    failed = agent.exec({ cwd: "/", argv: ["sleep", "1"], timeoutMs: 0 }).then(() => "resolved", (e) => e);
    await flush();
    dying.emit("exit", 1, null); // the death spends the rebuild
    const error = await failed;
    assert.match(error.message, /state is unknown/, "the in-flight command is never replayed");
    await flush(); // the rebuild spawned `broken`; its handshake is pending
    broken.emit("error", new Error("spawn failed")); // the rebuild fails → dead
    await flush();
    assert.equal(agent.state, "dead");
    assert.equal(agent.status().deaths, 1);
    mock.timers.tick(1); // fire the revival backoff
    await flush();
    const result = await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
    assert.equal(result.exitCode, 0, "the revived transport answers");
    assert.equal(agent.state, "ready");
    assert.equal(agent.status().pid, 77);
    assert.equal(healthy.frames.filter((line) => line.startsWith("EXEC|")).length, 1, "only the new request runs after the revival");
  } finally {
    mock.timers.reset();
  }
  await agent.close();
});

checkReg("the revival budget ends in a named permanent state with the restart remedy", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, revivalBackoffMs: 1 });
  for (let death = 0; death < 4; death += 1) agent.markDead();
  assert.equal(agent.status().deaths, 4);
  await assert.rejects(
    () => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }),
    /permanently out after 4 deaths.*restart the DSH app/,
    "the refusal is named and carries the remedy",
  );
});

checkReg("onStart reports each start's outcome and the entry it used", async () => {
  const native = new FakeAgentProcess();
  const shell = new FakeAgentProcess();
  const failing = new FakeAgentProcess({ noHello: true });
  const { transport } = scriptedTransport([native, shell, failing]);
  /** @type {Array<{ ok: boolean, native: boolean }>} */
  const outcomes = [];
  // Prepared on the first start only, as a preparation that later declines.
  let prepared = 0;
  const agent = new WslAgent({
    ...CONFIG,
    spawnTransport: transport,
    onStart: (outcome) => { outcomes.push(outcome); },
    prepare: async () => {
      prepared += 1;
      return prepared === 1 ? { scriptPath: "/cache/dsh-wsl-agent", expectedDigest: TEST_DIGEST } : undefined;
    },
  });
  await agent.start();
  await agent.close();
  await agent.start();
  await agent.close();
  await agent.start().catch(() => undefined);
  assert.deepEqual(outcomes, [
    { ok: true, native: true },
    { ok: true, native: false },
    { ok: false, native: false },
  ], "the entry of each start, and whether its handshake was accepted");
});

checkReg("a resident that came back carries no lastError", async () => {
  const dying = new FakeAgentProcess({ dieOnRequest: true });
  const healthy = new FakeAgentProcess();
  const { transport } = scriptedTransport([dying, healthy]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await assert.rejects(() => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }), /state is unknown/);
  assert.notEqual(agent.lastError, "", "the death is on record while it is unresolved");
  await agent.start();
  assert.equal(agent.status().state, "ready");
  assert.equal(agent.lastError, "", "an accepted handshake closes the failure: a diagnosis reads what the resident is now");
  await agent.close();
});

checkReg("lastActivityAt follows the resident's exchanges, with no idle timer of its own", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  // idleMs 0 is a session runtime's shape: nothing closes on its own, but an
  // owner still has to tell a quiet resident from an abandoned one.
  mock.timers.enable({ apis: ["Date"] });
  let agent;
  try {
    agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
    const born = agent.lastActivityAt;
    assert.equal(typeof born, "number", "the construction time is recorded before any exchange");
    // The clock moves between construction and the first frame.
    mock.timers.tick(5000);
    const settled = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
    await flush();
    child.stdout.write("RES|r0|0||\n");
    await settled;
    assert.ok(agent.lastActivityAt >= born + 5000, "the exchange moved the stamp");
    const after = agent.lastActivityAt;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(agent.lastActivityAt, after, "and nothing else does");
  } finally {
    mock.timers.reset();
  }
  await agent.close();
});

checkReg("status reports the live pid, state, pending count and last error", async () => {
  const child = new FakeAgentProcess({ helloPid: 55 });
  child.silent = true; // the request stays in flight, so `pending` is observable
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const run = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).catch(() => undefined);
  await flush();
  assert.deepEqual(agent.status(), {
    distro: "ubuntu",
    state: "ready",
    pid: 55,
    lastError: "",
    deaths: 0,
    pending: 1,
  });
  await agent.close();
  await run;
});

checkReg("a request that cannot be written is rejected, not stranded", async () => {
  const child = new FakeAgentProcess();
  child.stdin.end(); // the write side is gone before any request is made
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await assert.rejects(
    () => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 5000 }),
    /never ran/,
    "an unwritable frame must fail its caller instead of waiting forever",
  );
  await agent.close();
});

checkReg("a HELLO whose script digest differs from the shipped copy is refused like a version mismatch", async () => {
  const child = new FakeAgentProcess({ helloDigest: "ff".repeat(32) });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await assert.rejects(
    () => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }),
    /digest mismatch.*resync|exited during handshake/,
    "a stale or half-synced runtime copy must fail loudly, with the fix in the message",
  );
  assert.equal(child.killed, true, "the mismatched transport is killed, not left running");
  assert.match(agent.unavailableReason, /digest mismatch/);
});

checkReg("a HELLO without a digest cannot satisfy a host that expects one", async () => {
  const child = new FakeAgentProcess({ helloDigest: "" });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await assert.rejects(
    () => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }),
    /digest mismatch|exited during handshake/,
    "an unhashable script is a refusal, not a silent skip of the verification",
  );
});

checkReg("the client lease rides the managed namespace and its WSLENV entry", () => {
  const pinned = pinnedWindowsEnv({ WSLENV: "DSH_HOME/p" });
  const leased = agentLeaseEnv(pinned, 720000);
  assert.equal(leased.DSH_AGENT_LEASE_MS, "720000", "the lease value rides the managed namespace");
  assert.equal(leased.WSLENV, "DSH_HOME/p:DSH_AGENT_LEASE_MS", "the name rides WSLENV, or wsl.exe never imports it");
  const bare = agentLeaseEnv(pinnedWindowsEnv({}), 720000);
  assert.equal(bare.WSLENV, "DSH_AGENT_LEASE_MS", "an empty parent WSLENV gains no leading separator");
  const off = agentLeaseEnv(pinned, 0);
  assert.equal(off, pinned, "a disabled lease leaves the pinned environment untouched");
});

checkReg("an explicit lease rides the spawn without an idle close", async () => {
  const child = new FakeAgentProcess();
  /** @type {{ leaseMs: number } | undefined} */
  let seen;
  /**
   * A transport that records the spawn options.
   * @param {{ wslPath: string, distro: string, scriptPath: string, argvPrefix: string[], leaseMs: number }} options - the spawn options.
   * @returns {import("node:child_process").ChildProcess} the fake child.
   */
  const transport = (options) => {
    seen = options;
    return /** @type {import("node:child_process").ChildProcess} */ (/** @type {unknown} */ (child));
  };
  const agent = new WslAgent({ ...CONFIG, idleMs: 0, leaseMs: 12345, spawnTransport: transport });
  await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
  assert.equal(seen?.leaseMs, 12345, "the explicit lease reaches the spawn");
  await agent.close();
});

checkReg("a stale child's exit cannot tear down its replacement", async () => {
  const first = new FakeAgentProcess({ noHello: true });
  const second = new FakeAgentProcess();
  const { transport, made } = scriptedTransport([first, second]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const failed = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(
    () => {
      throw new Error("the first start should fail");
    },
    (error) => error,
  );
  // Fail the first handshake, then start a replacement and let the old
  // child's exit land while the replacement is still starting.
  first.emit("error", new Error("spawn failed"));
  assert.ok((await failed) instanceof AgentUnavailableError);
  const secondRun = agent.exec({ cwd: "/tmp", argv: ["echo", "hi"], timeoutMs: 0 });
  first.emit("exit", 1, null);
  // Late events from the dead generation are ignored, not applied to the live
  // one (the emit with a listener is how the fake reports them).
  first.emit("error", new Error("late spawn error"));
  const result = await secondRun;
  assert.equal(result.exitCode, 0, "the replacement still answers");
  assert.equal(result.stdout.toString("utf8"), "echo hi\n");
  assert.equal(made.length, 2, "the stale exit did not force a third spawn");
  await agent.close();
});

checkReg("close releases the host's ends of the child's stdio", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
  await agent.close();
  await agent.close(); // an idle close on an already-closed agent is a no-op
  assert.equal(child.stdin.destroyed, true, "stdin is released");
  assert.equal(child.stdout.destroyed, true, "stdout is released");
  assert.equal(child.stderr.destroyed, true, "stderr is released");
});

checkReg("close fails a start it interrupts", async () => {
  const child = new FakeAgentProcess({ noHello: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const run = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(
    () => {
      throw new Error("should not have started");
    },
    (error) => error,
  );
  await flush();
  await agent.close();
  const error = await run;
  assert.ok(error instanceof AgentUnavailableError, "the interrupted start rejects as unavailable");
  assert.match(error.message, /closed during start/);
});

checkReg("close settles requests it interrupts", async () => {
  const child = new FakeAgentProcess();
  child.silent = true; // the handshake answers, nothing after it
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  const run = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(
    () => {
      throw new Error("should not have completed");
    },
    (error) => error,
  );
  await flush();
  await agent.close();
  const error = await run;
  assert.ok(error instanceof AgentUnavailableError, "the interrupted request rejects as unavailable");
  assert.match(error.message, /closed before this request answered/);
});

checkReg("an abort signals the running agent out of band", async () => {
  /** @type {Array<{ wslPath: string, distro: string, pid: number, signal: NodeJS.Signals }>} */
  const signals = [];
  const child = new FakeAgentProcess({ helloPid: 4242, hangOnExec: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, signalTransport: (options) => signals.push(options) });
  const controller = new AbortController();
  const run = agent.exec({ cwd: "/", argv: ["sleep", "30"], timeoutMs: 0, signal: controller.signal }).then(
    () => {
      throw new Error("should not have completed");
    },
    (error) => error,
  );
  await flush(); // HELLO, ACK, the argv words; the command keeps running
  child.stdout.write("ACK|unknown\n"); // a late ACK for nobody is ignored
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    controller.abort(new Error("stop"));
    const error = await run;
    assert.ok(error instanceof Error);
    assert.match(error.message, /stop/);
    mock.timers.tick(61); // past the resident's 60 ms cancel-signal grace
    await flush();
    assert.deepEqual(signals, [{ wslPath: "wsl.exe", distro: "ubuntu", pid: 4242, signal: "SIGUSR1" }]);
  } finally {
    mock.timers.reset();
  }
  await agent.close();
});

checkReg("a queued abort waits for the request to start before signalling", async () => {
  /** @type {Array<{ wslPath: string, distro: string, pid: number, signal: NodeJS.Signals }>} */
  const signals = [];
  const child = new FakeAgentProcess({ helloPid: 7 });
  child.silent = true; // no ACK: the request is still queued
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, signalTransport: (options) => signals.push(options) });
  const controller = new AbortController();
  const run = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0, signal: controller.signal }).then(
    () => {
      throw new Error("should not have completed");
    },
    (error) => error,
  );
  await flush();
  const [id] = [...agent.pending.keys()];
  assert.ok(id !== undefined, "the request is tracked");
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    controller.abort(new Error("stop"));
    await run;
    assert.equal(signals.length, 0, "a request that has not started must not kill the running one");
    child.stdout.write(`ACK|${id}\n`);
    await flush();
    mock.timers.tick(61); // past the resident's 60 ms cancel-signal grace
    await flush();
    assert.deepEqual(signals, [{ wslPath: "wsl.exe", distro: "ubuntu", pid: 7, signal: "SIGUSR1" }], "the signal follows the ACK");
    child.stdout.write(`RES|${id}|0|${encodeB64("")}|${encodeB64("")}\n`);
    await flush();
    assert.equal(agent.pending.size, 0, "the late answer only cleans the cancelled entry");
  } finally {
    mock.timers.reset();
  }
  await agent.close();
});

checkReg("a stale cancel signal is dropped once a newer request is running", async () => {
  /** @type {Array<{ wslPath: string, distro: string, pid: number, signal: NodeJS.Signals }>} */
  const signals = [];
  const child = new FakeAgentProcess({ helloPid: 31, hangOnExec: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, signalTransport: (options) => signals.push(options) });
  const first = new AbortController();
  const run = agent.exec({ cwd: "/", argv: ["sleep", "30"], timeoutMs: 0, signal: first.signal }).then(
    () => "completed",
    () => "aborted",
  );
  await flush();
  const [firstId] = [...agent.pending.keys()];
  assert.ok(firstId !== undefined);
  // Abort the first, then let the agent answer it and ACK a newer request
  // before the grace expires — exactly the interleaving that used to kill the
  // new command with SIGUSR1.
  /** The replacement request; `agent.close()` is what settles it. */
  let second;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    first.abort(new Error("stop"));
    assert.equal(await run, "aborted");
    child.stdout.write(`RES|${firstId}|0|${encodeB64("")}|${encodeB64("")}\n`);
    second = agent.exec({ cwd: "/", argv: ["sleep", "30"], timeoutMs: 0 }).catch(() => undefined);
    await flush();
    mock.timers.tick(61); // let the grace expire under the mocked clock
    await flush();
    assert.deepEqual(signals, [], "the old cancel must not reach the request that took its place");
  } finally {
    mock.timers.reset();
  }
  await agent.close();
  await second;
});

checkReg("a PID-namespaced resident is never signalled by its HELLO pid", async () => {
  /** @type {Array<{ wslPath: string, distro: string, pid: number, signal: NodeJS.Signals }>} */
  const signals = [];
  const child = new FakeAgentProcess({ helloPid: 9, hangOnExec: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, argvPrefix: ["bwrap", "--"], spawnTransport: transport, signalTransport: (options) => signals.push(options) });
  const controller = new AbortController();
  const run = agent.exec({ cwd: "/", argv: ["sleep", "30"], timeoutMs: 0, signal: controller.signal }).then(
    () => {
      throw new Error("should not have completed");
    },
    (error) => error,
  );
  await flush();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    controller.abort(new Error("stop"));
    await run;
    // The out-of-band USR1 is deliberately delayed; asserting before it could
    // fire would pass no matter whom the agent signals.
    mock.timers.tick(61); // past the resident's 60 ms cancel-signal grace
    await flush();
    assert.equal(signals.length, 0, "the confined resident's namespace PID is not addressable");
  } finally {
    mock.timers.reset();
  }
  await agent.close();
});

checkReg("a prefixed but PID-shared session runtime is signalable", async () => {
  /** @type {Array<{ wslPath: string, distro: string, pid: number, signal: NodeJS.Signals }>} */
  const signals = [];
  const child = new FakeAgentProcess({ helloPid: 11, hangOnExec: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({
    ...CONFIG,
    argvPrefix: ["systemd-run", "--user", "--scope", "--"],
    signalable: true,
    spawnTransport: transport,
    signalTransport: (options) => signals.push(options),
  });
  const controller = new AbortController();
  const run = agent.exec({ cwd: "/", argv: ["sleep", "30"], timeoutMs: 0, signal: controller.signal }).then(
    () => {
      throw new Error("should not have completed");
    },
    (error) => error,
  );
  await flush();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    controller.abort(new Error("stop"));
    await run;
    mock.timers.tick(61); // past the resident's 60 ms cancel-signal grace
    await flush();
    assert.deepEqual(signals, [{ wslPath: "wsl.exe", distro: "ubuntu", pid: 11, signal: "SIGUSR1" }]);
  } finally {
    mock.timers.reset();
  }
  await agent.close();
});

checkReg("the default signal path runs a second wsl.exe with the cancel argv", async () => {
  if (process.platform === "win32") skip("the fake wsl.exe is a POSIX script");
  const dir = mkdtempSync(join(tmpdir(), "wsl-signal-"));
  try {
    const record = join(dir, "argv");
    const fakeWsl = join(dir, "wsl.exe");
    writeFileSync(fakeWsl, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(record)}\n`);
    chmodSync(fakeWsl, 0o755);
    const child = new FakeAgentProcess({ helloPid: 4242, hangOnExec: true });
    const { transport } = scriptedTransport([child]);
    const agent = new WslAgent({ ...CONFIG, wslPath: fakeWsl, spawnTransport: transport });
    const controller = new AbortController();
    const run = agent.exec({ cwd: "/", argv: ["sleep", "30"], timeoutMs: 0, signal: controller.signal }).then(
      () => {
        throw new Error("should not have completed");
      },
      (error) => error,
    );
    await flush();
    controller.abort(new Error("stop"));
    await run;
    /** @type {string[] | undefined} */
    let argv;
    // The fake's `> record` redirect creates an empty file before printf
    // writes the args, so an empty read is "not yet", not "no args" — keep
    // polling (the first real arg is always "-d" or "--exec", never "").
    for (let attempt = 0; attempt < 100 && (argv === undefined || argv[0] === ""); attempt += 1) {
      try {
        argv = readFileSync(record, "utf8").trim().split("\n");
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (argv !== undefined && argv[0] === "") await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(argv !== undefined && argv[0] !== "", "the signal helper ran with its argv");
    assert.deepEqual(argv.slice(0, 3), ["-d", "ubuntu", "--exec"]);
    assert.equal(argv[3], "sh");
    assert.equal(argv[4], "-c");
    assert.match(argv[5] ?? "", /kill -s "\$1" "\$2"/);
    assert.deepEqual(argv.slice(6), ["sh", "USR1", "4242"]);
    await agent.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

checkReg("a failed signal helper is swallowed, not thrown", async () => {
  const child = new FakeAgentProcess({ helloPid: 4242, hangOnExec: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, wslPath: "/nonexistent/wsl.exe", spawnTransport: transport });
  const controller = new AbortController();
  const run = agent.exec({ cwd: "/", argv: ["sleep", "30"], timeoutMs: 0, signal: controller.signal }).then(
    () => {
      throw new Error("should not have completed");
    },
    (error) => error,
  );
  await flush();
  controller.abort(new Error("stop"));
  await run;
  await flush(); // the spawn error is delivered and swallowed
  assert.equal(child.frames.some((frame) => frame.startsWith("KILL|")), true, "the frame fallback was still written");
  await agent.close();
});

checkReg("the constructor defaults fill a bare config", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ distro: "ubuntu", scriptPath: "/mnt/c/pkg/agent/wsl-agent.sh", spawnTransport: transport });
  const result = await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
  assert.equal(result.exitCode, 0);
  await agent.close();
});

checkReg("a dead agent rejects start and fs at the door", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, revivalBackoffMs: 1 });
  for (let death = 0; death < 4; death += 1) agent.markDead();
  await assert.rejects(() => agent.start(), (error) => error instanceof AgentUnavailableError && /permanently out/.test(error.message));
  await assert.rejects(() => agent.fs({ op: "stat", args: [] }), (error) => error instanceof AgentUnavailableError);
});

checkReg("a crash while a cancelled request is pending drops it, not the rebuild", async () => {
  const first = new FakeAgentProcess({ helloPid: 1, hangOnExec: true });
  const second = new FakeAgentProcess();
  const { transport } = scriptedTransport([first, second]);
  /** @type {Array<{ wslPath: string, distro: string, pid: number, signal: NodeJS.Signals }>} */
  const signals = [];
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, signalTransport: (options) => signals.push(options) });
  const controller = new AbortController();
  const run = agent.exec({ cwd: "/", argv: ["sleep", "30"], timeoutMs: 0, signal: controller.signal }).then(
    () => {
      throw new Error("should not have completed");
    },
    (error) => error,
  );
  await flush();
  controller.abort(new Error("stop"));
  await run;
  assert.equal(agent.pending.size, 1, "the cancelled entry waits for its answer");
  first.emit("exit", 1, null);
  await flush();
  assert.equal(agent.pending.size, 0, "the crash drops the cancelled entry");
  await agent.close();
});

checkReg("the pending queue refuses a submission past its cap", async () => {
  const child = new FakeAgentProcess();
  child.silent = true; // the first request never answers
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport, maxPending: 1 });
  const first = agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(
    () => "settled",
    (error) => error,
  );
  await flush();
  await assert.rejects(
    () => agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }),
    /requests in flight \(max 1\)/,
  );
  await agent.close();
  await first;
});

await check("the agent records per-kind queue/exec metrics and resets them", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, maxPending: 1, spawnTransport: transport });
  await agent.exec({ cwd: "/tmp", argv: ["echo", "hi"], timeoutMs: 0 });
  await agent.fs({ op: "read", args: ["/tmp/x", "0", "16"] });
  const metrics = agent.metrics();
  assert.equal(metrics.exec.requests, 1);
  assert.equal(metrics.fs.requests, 1);
  assert.equal(metrics.inFlightMax, 1);
  assert.ok(metrics.exec.execMs >= 0 && metrics.fs.execMs >= 0);
  assert.ok(metrics.exec.queueMs >= 0 && metrics.fs.queueMs >= 0);
  agent.resetMetrics();
  assert.deepEqual(agent.metrics(), {
    fs: { requests: 0, queueMs: 0, queueMaxMs: 0, execMs: 0, execMaxMs: 0, failed: 0, cancelled: 0, rejected: 0 },
    exec: { requests: 0, queueMs: 0, queueMaxMs: 0, execMs: 0, execMaxMs: 0, failed: 0, cancelled: 0, rejected: 0 },
    inFlightMax: 0,
  });
  await agent.close();
});

await check("rejected and cancelled requests are counted separately", async () => {
  const child = new FakeAgentProcess({ hangOnExec: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, maxPending: 1, spawnTransport: transport });
  const controller = new AbortController();
  const running = agent.exec({ cwd: "/tmp", argv: ["sleep", "9"], timeoutMs: 0, signal: controller.signal });
  await flush();
  await assert.rejects(agent.exec({ cwd: "/tmp", argv: ["true"], timeoutMs: 0 }), /max 1/u);
  controller.abort();
  await assert.rejects(running);
  const metrics = agent.metrics();
  assert.equal(metrics.exec.rejected, 1);
  assert.equal(metrics.exec.cancelled, 1);
  await agent.close();
});

await check("an async prepare selects the entry before the first spawn", async () => {
  const child = new FakeAgentProcess();
  const { transport, made } = scriptedTransport([child]);
  const agent = new WslAgent({
    ...CONFIG,
    signalable: true,
    spawnTransport: transport,
    prepare: async () => ({ scriptPath: "/native/agent", expectedDigest: TEST_DIGEST, signalable: false, spawnTransport: transport }),
  });
  await agent.exec({ cwd: "/tmp", argv: ["echo", "hi"], timeoutMs: 0 });
  assert.equal(agent.scriptPath, "/native/agent");
  assert.equal(agent.expectedDigest, TEST_DIGEST);
  assert.equal(agent.signalable, false);
  assert.equal(made.length, 1);
  await agent.close();
});

checkReg("workspace-write prepares the workspace root; read-only does not", () => {
  resetConfinedAgents();
  const confined = confinedAgent({ distro: "ubuntu", policy: { mode: "workspace-write", workspaceRoot: "/home/u/ws" } });
  assert.equal(typeof confined.prepare, "function", "the mode that binds the root must create it first");
  resetConfinedAgents();
  const readOnly = confinedAgent({ distro: "ubuntu", policy: { mode: "read-only", workspaceRoot: "/" } });
  assert.equal(readOnly.prepare, undefined, "read-only binds /, which always exists");
});

checkReg("the checklist script names its steps in order and takes the root as $1", () => {
  const script = spawnChecklistScript("/home/andy/.dsh-fsprobe");
  assert.match(script, /mkdir -p -- "\$1"/, "the root rides as $1, never interpolated into the body");
  assert.match(script, /echo workspace-root >&2/);
  assert.match(script, /pwd -P/, "the root must be its own physical directory, like the grants");
  assert.match(script, /echo workspace-symlink >&2/);
  assert.match(script, /echo interpreter >&2/);
  assert.match(script, /echo base64 >&2/);
  assert.match(script, /echo sha256sum >&2/);
});

checkReg("a symlinked workspace root is named on the rejection", async () => {
  await assert.rejects(
    runSpawnChecklist({
      wslPath: "wsl.exe", distro: "Debian", root: "/home/u/link",
      runFn: async () => { throw new Error("workspace-symlink"); },
    }),
    /the workspace root in Debian is a symlink; use the physical directory path/,
  );
});

checkReg("runSpawnChecklist issues one exec round trip with the root as $1", async () => {
  /** @type {string[][]} */
  const calls = [];
  await runSpawnChecklist({
    wslPath: "wsl.exe", distro: "Debian", root: "/home/andy/.dsh-fsprobe",
    runFn: async (argv) => { calls.push(argv); },
  });
  assert.equal(calls.length, 1);
  const argv = calls[0] ?? [];
  assert.deepEqual(argv.slice(0, 3), ["--exec", "sh", "-c"]);
  assert.equal(argv.at(-2), "sh");
  assert.equal(argv.at(-1), "/home/andy/.dsh-fsprobe");
});

checkReg("a failing checklist step is named on the rejection", async () => {
  await assert.rejects(
    () => runSpawnChecklist({
      wslPath: "wsl.exe", distro: "Debian", root: "/x",
      runFn: async () => { throw new Error("wsl.exe failed: base64"); },
    }),
    /checklist step 'base64' failed in Debian/,
  );
});

checkReg("an unreachable checklist is reported as its own failure", async () => {
  await assert.rejects(
    () => runSpawnChecklist({
      wslPath: "wsl.exe", distro: "Debian", root: "/x",
      runFn: async () => { throw new Error("wsl.exe failed: WSL is unreachable"); },
    }),
    /checklist could not run in Debian/,
  );
});

checkReg("a handshake exit carries the resident's stderr on the failure", async () => {
  const child = new FakeAgentProcess({ noHello: true });
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  // Write the refusal first, deliver its "data" event, and only then exit —
  // the real ordering: bwrap prints, flushes, and dies.
  child.stderr.write("bwrap: Can't find source path /home/andy/.dsh-fsprobe: No such file or directory\n");
  await new Promise((resolve) => child.stderr.write("", resolve));
  setImmediate(() => child.emit("exit", 1, null));
  const error = await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 }).then(
    () => { throw new Error("should not have resolved"); },
    (e) => e,
  );
  assert.match(error.message, /exited during handshake/);
  assert.match(error.message, /stderr=bwrap: Can't find source path/, "the resident's own refusal must ride the failure");
  await agent.close();
});

checkReg("the handshake stderr listener detaches once HELLO arrives", async () => {
  const child = new FakeAgentProcess();
  const { transport } = scriptedTransport([child]);
  const agent = new WslAgent({ ...CONFIG, spawnTransport: transport });
  await agent.exec({ cwd: "/", argv: ["true"], timeoutMs: 0 });
  await flush();
  // The handshake tail exists only to decorate a handshake failure; left
  // attached it accumulates every stderr byte for the resident's lifetime.
  assert.equal(child.stderr.listenerCount("data"), 1, "only the diagnostic stderr listener may remain after the handshake");
  await agent.close();
});

checkReg("interopVisibility stance takes precedence over the legacy boolean", () => {
  assert.equal(effectiveMaskWindowsDrive({}), false, "unset stance and no legacy boolean masks nothing");
  assert.equal(effectiveMaskWindowsDrive({ maskWindowsDrive: true }), true, "the legacy boolean answers while the stance key is unset");
  assert.equal(effectiveMaskWindowsDrive({ interopVisibility: "masked" }), true);
  assert.equal(effectiveMaskWindowsDrive({ interopVisibility: "disabled" }), true, "disabled masks in-session: the belt, while the distro-level closure stays a documented user step");
  assert.equal(effectiveMaskWindowsDrive({ interopVisibility: "visible", maskWindowsDrive: true }), false, "an explicit visible stance overrides the legacy boolean");
  assert.equal(effectiveMaskWindowsDrive({ interopVisibility: undefined, maskWindowsDrive: true }), true, "undefined keeps the legacy answer");
});

for (const [name, fn] of checks) {
  await check(name, fn);
}

console.log(`\n${summaryLine(tally, "agent lifecycle")}`);
