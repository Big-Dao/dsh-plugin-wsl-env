/**
 * Assertion checks for the agent-backed search handle — the facade that runs
 * the file-search command on the warm resident and degrades to the caller's
 * one-shot handle when the agent is out. Pure shaping over injected
 * collaborators, so every outcome is reachable without a distro.
 *
 * Not covered here: the provider wiring that builds the handle
 * (`lib/subprocess.js` imports the DSH peers) — that remains the probes'
 * territory.
 *
 *   node test/search-exec.test.mjs
 */
import assert from "node:assert/strict";
import { AgentUnavailableError } from "../lib/agent-errors.js";
import { searchExecutionHandle } from "../lib/search-exec.js";

/**
 * The search handle the facade returns.
 * @typedef {import("../lib/search-exec.js").SearchExecutionHandle} SearchHandle
 */

/**
 * The handle's collaborators minus `spawnFallback` — the facade consults the
 * fallback only when the resident is out, so the pure agent path omits it and
 * the call site recovers the seam's full options type by cast.
 * @typedef {Omit<Parameters<typeof searchExecutionHandle>[0], "spawnFallback">} AgentSearchOptions
 */

/**
 * The collected-stream reader these checks consume — the seam's `stdout` /
 * `stderr` are optional, the reads here require them.
 * @typedef {NonNullable<SearchHandle["collected"]["stdout"]>} SearchReader
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
const ARGV = ["rg", "--json", "--regexp=hole", "--", "."];

/**
 * A fake resident: records exec options, resolves from a script.
 * @param {Array<import("../lib/agent-exec.js").AgentExecResult | Error | ((request: import("../lib/agent-exec.js").AgentExecRequest) => Promise<import("../lib/agent-exec.js").AgentExecResult>)>} script
 *   the outcomes the fake's `exec` consumes one per call: a result, a rejection
 *   (any `Error`), or a bespoke promise builder.
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
      if (outcome instanceof Function) return outcome(options);
      return Promise.resolve(outcome);
    },
  };
}

check("a successful agent exec fills collected and reports the exit code", async () => {
  const agent = fakeAgent([{ exitCode: 0, stdout: Buffer.from("alpha\nbeta\n"), stderr: Buffer.alloc(0) }]);
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV, maxOutputBytes: 4096 })));
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 0, signal: null });
  const stdout = /** @type {SearchReader} */ (handle.collected.stdout).readFrom(0);
  assert.equal(stdout.text, "alpha\nbeta\n");
  assert.equal(stdout.lossy, false);
  assert.equal(/** @type {SearchReader} */ (handle.collected.stderr).readFrom(0).text, "");
  assert.equal(agent.calls.length, 1);
  const call = agent.calls[0];
  assert.ok(call !== undefined, "the search called the agent once");
  assert.equal(call.cwd, CWD);
  assert.deepEqual(call.argv, ARGV);
  assert.equal(call.maxOutputBytes, 4096);
  assert.ok(call.signal instanceof AbortSignal, "the exec rides the handle's kill channel");
});

check("readFrom consumes incrementally and clamps past the end", async () => {
  const agent = fakeAgent([{ exitCode: 0, stdout: Buffer.from("one\ntwo\n"), stderr: Buffer.alloc(0) }]);
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV })));
  await handle.done;
  const first = /** @type {SearchReader} */ (handle.collected.stdout).readFrom(0);
  assert.equal(first.text, "one\ntwo\n");
  assert.equal(/** @type {SearchReader} */ (handle.collected.stdout).readFrom(first.nextOffset).text, "", "the second read continues at the offset");
  assert.equal(/** @type {SearchReader} */ (handle.collected.stdout).readFrom(9999).text, "", "a read past the end is empty, not a throw");
});

check("rg's no-matches exit code rides through untouched", async () => {
  const agent = fakeAgent([{ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }]);
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV })));
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 1, signal: null }, "1 is the tool's no-matches dialect, not a failure");
});

check("an out agent falls back to the delegate and proxies it", async () => {
  const agent = fakeAgent([new AgentUnavailableError("the resident is out")]);
  let fallbacks = 0;
  const delegateCollected = { stdout: { readFrom: () => ({ text: "delegated", lossy: false, nextOffset: 9 }) } };
  const handle = searchExecutionHandle({
    agent,
    cwd: CWD,
    argv: ARGV,
    spawnFallback: () => {
      fallbacks += 1;
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: delegateCollected,
        kill() {},
      };
    },
  });
  const outcome = await handle.done;
  assert.equal(fallbacks, 1, "the delegate is built lazily, once");
  assert.deepEqual(outcome, { exitCode: 0, signal: null });
  assert.equal(handle.collected, delegateCollected, "collected proxies the delegate verbatim");
});

check("a genuine agent failure propagates through done", async () => {
  const failure = new Error("the workdir vanished");
  const agent = fakeAgent([failure]);
  const handle = searchExecutionHandle({ agent, cwd: CWD, argv: ARGV, spawnFallback: () => assert.fail("must not fall back") });
  await assert.rejects(handle.done, (error) => error === failure);
});

check("a cancelled search settles as killed, not failed", async () => {
  const controller = new AbortController();
  const agent = fakeAgent([
    (options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  ]);
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV, signal: controller.signal })));
  controller.abort(new Error("tool timeout"));
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: null, signal: "SIGTERM" });
});

check("kill() aborts a running agent exec", async () => {
  const agent = fakeAgent([
    (options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("killed")), { once: true });
      }),
  ]);
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV })));
  assert.equal(/** @type {NonNullable<SearchHandle["kill"]>} */ (handle.kill)(), undefined, "kill is fire-and-forget");
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: null, signal: "SIGTERM" });
});

check("kill() reaches the delegate once the fallback is active", async () => {
  const agent = fakeAgent([new AgentUnavailableError("out")]);
  let delegateKilled = 0;
  const handle = searchExecutionHandle({
    agent,
    cwd: CWD,
    argv: ARGV,
    spawnFallback: () => ({
      done: new Promise(() => {}),
      collected: {},
      kill() {
        delegateKilled += 1;
      },
    }),
  });
  const settled = handle.done.catch(() => "pending");
  await Promise.resolve();
  /** @type {NonNullable<SearchHandle["kill"]>} */ (handle.kill)();
  assert.equal(delegateKilled, 1, "the delegate's kill is forwarded");
  void settled;
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} search-exec checks pass`);
