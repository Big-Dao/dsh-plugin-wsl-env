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
import { AgentUnavailableError, CwdError, SpawnError } from "../lib/agent-errors.js";
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
const DISTRO = "ubuntu";
const ARGV = ["rg", "--json", "--regexp=hole", "--", "."];
/** The stderr text a search must read after a failure. */
const stderrOf = (/** @type {SearchHandle} */ handle) => /** @type {SearchReader} */ (handle.collected.stderr).readFrom(0).text;

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

check("a stream the agent cut at the capture cap reports lossy", async () => {
  // The shape the real agent produces: a cut lands EXACTLY on the budget, so
  // no length test can see it. Read as whole, a search past the budget was
  // reported with every later match missing.
  const agent = fakeAgent([{
    exitCode: 0,
    stdout: Buffer.alloc(4096, 0x61),
    stderr: Buffer.alloc(4096, 0x62),
    truncated: { stdout: true, stderr: true },
  }]);
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV, distro: DISTRO, maxOutputBytes: 4096 })));
  await handle.done;
  assert.equal(/** @type {SearchReader} */ (handle.collected.stdout).readFrom(0).lossy, true, "the stdout cut reaches the caller");
  assert.equal(/** @type {SearchReader} */ (handle.collected.stderr).readFrom(0).lossy, true, "and the stderr cut");
});

check("a successful agent exec fills collected and reports the exit code", async () => {
  const agent = fakeAgent([{ exitCode: 0, stdout: Buffer.from("alpha\nbeta\n"), stderr: Buffer.alloc(0) }]);
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV, distro: DISTRO, maxOutputBytes: 4096 })));
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
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV, distro: DISTRO })));
  await handle.done;
  const first = /** @type {SearchReader} */ (handle.collected.stdout).readFrom(0);
  assert.equal(first.text, "one\ntwo\n");
  assert.equal(/** @type {SearchReader} */ (handle.collected.stdout).readFrom(first.nextOffset).text, "", "the second read continues at the offset");
  assert.equal(/** @type {SearchReader} */ (handle.collected.stdout).readFrom(9999).text, "", "a read past the end is empty, not a throw");
});

check("rg's no-matches exit code rides through untouched", async () => {
  const agent = fakeAgent([{ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }]);
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV, distro: DISTRO })));
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 1, signal: null }, "1 is the tool's no-matches dialect, not a failure");
});

check("a spawn failure settles as exit 127 with the program and the bootstrap remedy", async () => {
  const agent = fakeAgent([new SpawnError("No such file or directory (os error 2)")]);
  const handle = searchExecutionHandle({
    agent,
    cwd: CWD,
    argv: ARGV,
    distro: DISTRO,
    spawnFallback: () => assert.fail("a spawn failure must not fall back to the one-shot path"),
  });
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 127, signal: null }, "the distro's missing rg surfaces as a command-not-found exit");
  const stderr = stderrOf(handle);
  assert.match(stderr, /\brg\b/, "the message names the program the tool tried to run");
  assert.match(stderr, /"ubuntu"/, "the message names the distro the remedy must run in");
  assert.match(stderr, /~\/\.local\/bin/, "a user-local install on another PATH is named as a cause");
  assert.match(stderr, /scripts\/bootstrap\.sh ubuntu --install/, "the bootstrap remedy is copy-pasteable");
  assert.equal(/** @type {SearchReader} */ (handle.collected.stdout).readFrom(0).text, "");
});

check("a missing workdir settles as rg's error code, never the no-matches 1", async () => {
  const agent = fakeAgent([new CwdError("/home/andy/gone")]);
  const handle = searchExecutionHandle({
    agent,
    cwd: CWD,
    argv: ARGV,
    distro: DISTRO,
    spawnFallback: () => assert.fail("a cwd failure must not fall back to the one-shot path"),
  });
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 2, signal: null }, "2 is rg's own error dialect; 1 would read as no matches");
  const stderr = stderrOf(handle);
  assert.match(stderr, /chdir\(\/home\/andy\/gone\) failed/, "the relay-shaped line names the directory");
  assert.match(stderr, /search directory "\/home\/andy\/gone" does not exist/, "the remedy follows the relay line");
});

check("an out agent falls back to the delegate and proxies it", async () => {
  const agent = fakeAgent([new AgentUnavailableError("the resident is out")]);
  let fallbacks = 0;
  const delegateCollected = { stdout: { readFrom: () => ({ text: "delegated", lossy: false, nextOffset: 9 }) } };
  const handle = searchExecutionHandle({
    agent,
    cwd: CWD,
    argv: ARGV,
    distro: DISTRO,
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

check("a delegate's missing-program relay is translated to 127 with the remedy", async () => {
  const agent = fakeAgent([new AgentUnavailableError("the resident is out")]);
  const relay = "<3>WSL (123 - Relay) ERROR: CreateProcessCommon:881: execvpe(rg) failed: No such file or directory";
  /** @type {string[]} */
  const reads = [];
  const handle = searchExecutionHandle({
    agent,
    cwd: CWD,
    argv: ARGV,
    distro: DISTRO,
    spawnFallback: () => ({
      done: Promise.resolve({ exitCode: 1, signal: null }),
      collected: {
        stdout: { readFrom: () => ({ text: "", lossy: false, nextOffset: 0 }) },
        stderr: { readFrom: () => { reads.push(relay); return { text: relay, lossy: false, nextOffset: relay.length }; } },
      },
    }),
  });
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 127, signal: null }, "the relay's execvpe failure is a command-not-found, not no matches");
  assert.ok(reads.length >= 1, "the delegate's stderr was read for the relay marker");
  assert.match(stderrOf(handle), /scripts\/bootstrap\.sh ubuntu --install/, "the translated text carries the remedy");
});

check("the relay marker survives a UTF-16LE stream read as UTF-8", async () => {
  const agent = fakeAgent([new AgentUnavailableError("out")]);
  const relay = "<3>WSL (123 - Relay) ERROR: CreateProcessCommon:881: execvpe(rg) failed: No such file or directory";
  const utf16 = [...relay].map((char) => `${char}\0`).join("");
  const handle = searchExecutionHandle({
    agent,
    cwd: CWD,
    argv: ARGV,
    distro: DISTRO,
    spawnFallback: () => ({
      done: Promise.resolve({ exitCode: 1, signal: null }),
      collected: { stderr: { readFrom: () => ({ text: utf16, lossy: false, nextOffset: utf16.length }) } },
    }),
  });
  const outcome = await handle.done;
  assert.deepEqual(outcome, { exitCode: 127, signal: null });
});

check("a genuine agent failure propagates through done", async () => {
  const failure = new Error("the workdir vanished");
  const agent = fakeAgent([failure]);
  const handle = searchExecutionHandle({ agent, cwd: CWD, argv: ARGV, distro: DISTRO, spawnFallback: () => assert.fail("must not fall back") });
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
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV, distro: DISTRO, signal: controller.signal })));
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
  const handle = searchExecutionHandle(/** @type {Parameters<typeof searchExecutionHandle>[0]} */ (/** @type {AgentSearchOptions} */ ({ agent, cwd: CWD, argv: ARGV, distro: DISTRO })));
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
    distro: DISTRO,
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
