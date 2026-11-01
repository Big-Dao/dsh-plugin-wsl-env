/**
 * Assertion checks for the agent-backed git-snapshot handle — the facade that
 * runs `workspace-changes`' snapshot calls on the warm resident and degrades
 * to the caller's one-shot handle when the agent is out. Pure shaping over
 * injected collaborators, so every outcome is reachable without a distro.
 *
 * Not covered here: the provider wiring that builds the handle
 * (`lib/subprocess.js` imports the DSH peers) — that remains the probes'
 * territory.
 *
 *   node test/git-exec.test.mjs
 */
import assert from "node:assert/strict";
import { AgentUnavailableError } from "../lib/agent-errors.js";
import { gitExecutionHandle } from "../lib/git-exec.js";

/**
 * The git handle the facade returns.
 * @typedef {import("../lib/git-exec.js").GitExecutionHandle} GitHandle
 */

/**
 * The collected-stream reader these checks consume — the seam's `stdout` /
 * `stderr` are optional, the reads here require them.
 * @typedef {NonNullable<GitHandle["collected"]["stdout"]>} GitReader
 */

/**
 * The handle's collaborators minus `spawnFallback` — the facade consults the
 * fallback only when the resident is out, so the pure agent path omits it and
 * the call site recovers the seam's full options type by cast.
 * @typedef {Omit<Parameters<typeof gitExecutionHandle>[0], "spawnFallback">} AgentGitOptions
 */

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through `runCheck`.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/**
 * Runs one check, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

const CWD = "/home/andy/proj";
const ARGV = ["git", "check-ignore", "-z", "--stdin"];
const CAPS = { stdout: 64000, stderr: 16384 };

/**
 * A fake resident: records exec options, resolves from a script.
 * @param {Array<import("../lib/agent-exec.js").AgentExecResult | Error | ((request: import("../lib/agent-exec.js").AgentExecRequest) => Promise<import("../lib/agent-exec.js").AgentExecResult>)>} script
 *   the outcomes the fake's `exec` consumes one per call: a result, a
 *   rejection, or a bespoke promise builder.
 * @returns {import("../lib/agent-exec.js").AgentExecRunner & {calls: import("../lib/agent-exec.js").AgentExecRequest[]}}
 *   the fake runner with its recorded calls.
 */
function fakeAgent(script) {
  /** @type {import("../lib/agent-exec.js").AgentExecRequest[]} */
  const calls = [];
  return {
    calls,
    exec(options) {
      calls.push(options);
      const [outcome] = script.splice(0, 1);
      if (outcome === undefined) throw new Error("the fake agent ran out of scripted outcomes");
      if (outcome instanceof Error) return Promise.reject(outcome);
      if (outcome instanceof Function) return /** @type {Promise<import("../lib/agent-exec.js").AgentExecResult>} */ (outcome(options));
      return Promise.resolve(outcome);
    },
  };
}

check("a successful agent exec fills collected and reports the exit code", async () => {
  const agent = fakeAgent([{ exitCode: 0, stdout: Buffer.from("src/a.ts\0"), stderr: Buffer.alloc(0) }]);
  const handle = gitExecutionHandle(/** @type {Parameters<typeof gitExecutionHandle>[0]} */ (/** @type {AgentGitOptions} */ ({ agent, cwd: CWD, argv: ARGV, env: { GIT_INDEX_FILE: "/tmp/snap/index" }, stdin: Buffer.from("src/a.ts\0"), caps: CAPS })));
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 0, signal: null });
  const stdout = /** @type {GitReader} */ (handle.collected.stdout).readFrom(0);
  assert.equal(stdout.text, "src/a.ts\0");
  assert.equal(stdout.lossy, false);
  assert.equal(agent.calls.length, 1);
  const call = agent.calls[0];
  assert.ok(call !== undefined, "the snapshot called the agent once");
  assert.equal(call.cwd, CWD);
  assert.deepEqual(call.argv, ARGV);
  assert.equal(call.maxOutputBytes, 64000, "the wire cap is the larger stream budget");
  assert.deepEqual(call.env, { GIT_INDEX_FILE: "/tmp/snap/index" }, "the translated GIT_* names ride the per-request env");
  assert.ok(call.stdin instanceof Uint8Array && call.stdin.length > 0, "the stdin payload rides the frame");
  assert.ok(call.signal instanceof AbortSignal, "the exec rides the handle's kill channel");
});

check("each stream is cut at its own budget, not the wire cap", async () => {
  const agent = fakeAgent([{
    exitCode: 0,
    stdout: Buffer.alloc(70000, 0x61), // over the 64000 stdout cap, under nothing else
    stderr: Buffer.alloc(100, 0x62), // well under the 16384 tail
    truncated: { stdout: true, stderr: false },
  }]);
  const handle = gitExecutionHandle(/** @type {Parameters<typeof gitExecutionHandle>[0]} */ (/** @type {AgentGitOptions} */ ({ agent, cwd: CWD, argv: ARGV, env: {}, caps: CAPS })));
  await handle.done;
  const stdout = /** @type {GitReader} */ (handle.collected.stdout).readFrom(0);
  assert.equal(stdout.lossy, true, "the stdout stream over its cap is lossy");
  assert.equal(stdout.text.length, 64000, "the stdout text is cut at the caller's budget");
  const stderr = /** @type {GitReader} */ (handle.collected.stderr).readFrom(0);
  assert.equal(stderr.lossy, false, "the stderr stream under its cap is not flagged");
  assert.equal(stderr.text.length, 100);
});

check("a one-character overflow past the cap flags lossy", async () => {
  const agent = fakeAgent([{ exitCode: 0, stdout: Buffer.alloc(CAPS.stderr + 1, 0x61), stderr: Buffer.alloc(0) }]);
  const handle = gitExecutionHandle(/** @type {Parameters<typeof gitExecutionHandle>[0]} */ (/** @type {AgentGitOptions} */ ({ agent, cwd: CWD, argv: ARGV, env: {}, caps: { stdout: CAPS.stderr, stderr: CAPS.stderr } })));
  await handle.done;
  const stdout = /** @type {GitReader} */ (handle.collected.stdout).readFrom(0);
  assert.equal(stdout.text.length, CAPS.stderr);
  assert.equal(stdout.lossy, true, "exactly-at-cap is not lossy; one over is");
});

check("an empty stdin keeps the payload off the wire", async () => {
  const agent = fakeAgent([{ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }]);
  const handle = gitExecutionHandle(/** @type {Parameters<typeof gitExecutionHandle>[0]} */ (/** @type {AgentGitOptions} */ ({ agent, cwd: CWD, argv: ["git", "write-tree"], env: {}, caps: CAPS })));
  await handle.done;
  const call = agent.calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.stdin, undefined, "no stdin means the v5 shape on the frame");
});

check("an out agent falls back to the delegate and proxies it", async () => {
  const agent = fakeAgent([new AgentUnavailableError("the resident is out")]);
  let fallbacks = 0;
  const delegate = {
    done: Promise.resolve({ exitCode: 3, signal: null }),
    collected: { stdout: { readFrom: () => ({ text: "delegated", lossy: false, nextOffset: 9 }) } },
  };
  const handle = gitExecutionHandle({
    agent,
    cwd: CWD,
    argv: ARGV,
    env: {},
    caps: CAPS,
    spawnFallback: () => {
      fallbacks += 1;
      return delegate;
    },
  });
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 3, signal: null }, "the delegated handle's outcome");
  assert.equal(/** @type {GitReader} */ (handle.collected.stdout).readFrom(0).text, "delegated", "the collected streams proxy the delegate");
  assert.equal(fallbacks, 1, "the fallback builds at most once");
});

check("a genuine agent failure propagates through done", async () => {
  const agent = fakeAgent([new Error("the exec failed for a real reason")]);
  const handle = gitExecutionHandle({ agent, cwd: CWD, argv: ARGV, env: {}, caps: CAPS, spawnFallback: () => { throw new Error("must not fall back"); } });
  await assert.rejects(handle.done, /for a real reason/);
});

check("kill settles done as the one-shot path's killed outcome", async () => {
  const agent = fakeAgent([(/** @type {import("../lib/agent-exec.js").AgentExecRequest} */ options) => new Promise((_, reject) => {
    options.signal?.addEventListener("abort", () => reject(options.signal?.reason ?? new Error("aborted")), { once: true });
  })]);
  const handle = gitExecutionHandle(/** @type {Parameters<typeof gitExecutionHandle>[0]} */ (/** @type {AgentGitOptions} */ ({ agent, cwd: CWD, argv: ARGV, env: {}, caps: CAPS })));
  const settled = handle.done;
  handle.kill?.();
  const outcome = await settled;
  assert.deepEqual(outcome, { exitCode: null, signal: "SIGTERM" });
});

const run = async () => {
  for (const [name, fn] of checks) await runCheck(name, fn);
  console.log(`\n${passed} git-exec checks pass`);
  if (process.exitCode !== undefined && process.exitCode !== 0) return;
  process.exitCode = 0;
};
await run();
