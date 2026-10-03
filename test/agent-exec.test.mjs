/**
 * Assertion checks for the agent-backed execution handle: result shaping,
 * timeout/kill semantics, incremental readOutput, and the cwd-failure
 * synthesis. The runner is faked, so this runs everywhere including CI.
 *
 * Not covered here: the real round trip — `test/probe/exec.sh` runs the same
 * handle against a live distro.
 *
 *   node test/agent-exec.test.mjs
 */
import assert from "node:assert/strict";
import { AgentUnavailableError, CwdError } from "../lib/agent-errors.js";
import { agentExecutionHandle } from "../lib/agent-exec.js";

let passed = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

/** A runner resolving after `ms` with the given outcome. */
function fakeAgent(outcome, ms = 5) {
  return {
    exec({ signal }) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => (outcome.throw ? reject(outcome.throw) : resolve(outcome)), ms);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  };
}

check("a completed command shapes the result like the one-shot path", async () => {
  const proc = agentExecutionHandle({
    agent: fakeAgent({ exitCode: 0, stdout: Buffer.from("out\n"), stderr: Buffer.from("err\n") }),
    cwd: "/tmp",
    argv: ["true"],
    timeoutMs: 5000,
  });
  const result = await proc.result();
  assert.equal(proc.status, "completed");
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.equal(result.stdout.text, "out\n");
  assert.equal(result.stderr.text, "err\n");
  // The bash tool's canonical result copies `truncated` unconditionally; an
  // undefined there fails the wire's lossless-JSON snapshot.
  assert.equal(result.stdout.truncated, false);
  assert.equal(result.stderr.truncated, false);
});

check("the agent's capture-cap flags surface as per-stream truncated, honestly", async () => {
  const seen = {};
  const proc = agentExecutionHandle({
    agent: {
      exec({ maxOutputBytes }) {
        seen.maxOutputBytes = maxOutputBytes;
        return Promise.resolve({
          exitCode: 0,
          stdout: Buffer.from("cut"),
          stderr: Buffer.alloc(0),
          truncated: { stdout: true, stderr: false },
        });
      },
    },
    cwd: "/tmp",
    argv: ["yes"],
    maxOutputBytes: 64000,
  });
  const result = await proc.result();
  assert.equal(seen.maxOutputBytes, 64000, "the caller's budget reaches the agent");
  assert.equal(result.stdout.truncated, true, "the cut stream reports truncated");
  assert.equal(result.stderr.truncated, false, "the whole stream does not over-report");
});

check("the in-distro timeout reports a killed process with SIGTERM", async () => {
  const proc = agentExecutionHandle({
    // Simulates the agent's own timeout kill: resolves with exit 143 late.
    agent: fakeAgent({ exitCode: 143, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }, 200),
    cwd: "/tmp",
    argv: ["sleep", "30"],
    timeoutMs: 30,
  });
  const result = await proc.result();
  assert.equal(result.timedOut, true, "our timer must fire before the agent answers");
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(proc.status, "killed");
});

check("readOutput after settlement returns the whole stream once, then nothing", async () => {
  // Documented deviation: the agent path has no live streaming, so the first
  // post-completion read carries everything and the next is empty.
  const proc = agentExecutionHandle({
    agent: fakeAgent({ exitCode: 0, stdout: Buffer.from("a\nb"), stderr: Buffer.from("boom") }),
    cwd: "/tmp",
    argv: ["x"],
    timeoutMs: 5000,
  });
  await proc.done;
  const first = proc.readOutput();
  assert.match(first.delta, /a/);
  assert.match(first.delta, /\[stderr\]/);
  assert.equal(proc.readOutput().delta, "");
});

check("readOutput yields incremental deltas with stderr interleaved", async () => {
  const proc = agentExecutionHandle({
    agent: fakeAgent({ exitCode: 0, stdout: Buffer.from("a\nb"), stderr: Buffer.from("boom") }),
    cwd: "/tmp",
    argv: ["x"],
    timeoutMs: 5000,
  });
  await proc.done;
  const first = proc.readOutput();
  assert.match(first.delta, /a\nb/);
  assert.match(first.delta, /\[stderr\]\nboom/);
});

check("kill reports SIGTERM and settles as killed", async () => {
  const proc = agentExecutionHandle({
    agent: fakeAgent({ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }, 500),
    cwd: "/tmp",
    argv: ["sleep", "30"],
    timeoutMs: 0,
  });
  assert.equal(proc.kill(), true);
  assert.equal(proc.kill(), false, "a second kill on a settled handle is false");
  const result = await proc.result();
  assert.equal(result.signal, "SIGTERM");
  assert.equal(proc.status, "killed");
});

check("a cwd failure becomes relay-shaped stderr, not a killed process", async () => {
  const error = new CwdError("/gone");
  const proc = agentExecutionHandle({
    agent: fakeAgent({ throw: error }),
    cwd: "/gone",
    argv: ["true"],
    timeoutMs: 5000,
  });
  const result = await proc.result();
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr.text, /chdir\(\/gone\) failed/);
  assert.equal(proc.status, "completed");
});

check("an out-of-service agent propagates for the executor's fallback", async () => {
  const error = new AgentUnavailableError("agent exited again");
  const proc = agentExecutionHandle({
    agent: fakeAgent({ throw: error }),
    cwd: "/tmp",
    argv: ["true"],
    timeoutMs: 5000,
  });
  await assert.rejects(() => proc.result(), (thrown) => thrown === error);
});

for (const [name, fn] of checks) await runCheck(name, fn);
console.log(`\n${passed} agent-exec checks pass`);
