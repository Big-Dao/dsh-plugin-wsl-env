/**
 * Assertion checks for the distro-side terminal activity observation: the
 * probe builder, the parser, and the transparent handle wrapper that installs
 * the replacement `inspectActivity`. Pure checks run anywhere; one live leg
 * exercises the probe script against a real marked process on Linux only
 * (`/proc` is the observation's substrate).
 *
 *   node test/terminal-activity.test.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { parseTerminalActivity, TERMINAL_ID_ENV, terminalActivityProbe, wrapTerminalHandle } from "../lib/terminal-activity.js";

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
 * Runs one check now, printing its verdict; a throw fails the process exit code.
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

/**
 * @param {number} ms - how long to wait.
 * @returns {Promise<void>} resolves after the delay.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

check("the probe targets the distro shell with the id as an argument, never interpolated", () => {
  const id = "probe-$(rm -rf /)-id";
  const probe = terminalActivityProbe(id);
  assert.deepEqual(probe.cwd, "/");
  assert.deepEqual(probe.argv.slice(0, 2), ["sh", "-c"]);
  assert.equal(probe.argv[3], "sh", "the script's own $0");
  assert.equal(probe.argv[4], id, "the id rides as $1");
  const script = probe.argv[2];
  assert.ok(script !== undefined, "the script rides as one argv element");
  assert.equal(script.includes(id), false, "the id is not interpolated into the script text");
  assert.equal(script.includes("[["), false, "POSIX sh only — no bashisms");
});

check("parseTerminalActivity reads exactly the two reported states", () => {
  assert.equal(parseTerminalActivity("busy\n"), "busy");
  assert.equal(parseTerminalActivity("idle\n"), "idle");
  assert.equal(parseTerminalActivity(""), undefined);
  assert.equal(parseTerminalActivity("sh: line 1: boom: not found\n"), undefined);
});

check("wrapTerminalHandle forwards methods bound to the real handle", () => {
  /** @type {{pid: number, write(text: string): string}} */
  const handle = {
    pid: 4242,
    /** @param {string} text - the bytes to write. @returns {string} the echoed write. */
    write(text) {
      return `wrote:${this.pid}:${text}`;
    },
  };
  const wrapped = wrapTerminalHandle(/** @type {import("@deepseek-ai/dsh-subprocess").SubprocessTerminalHandle} */ (/** @type {unknown} */ (handle)), async () => ({ state: "idle", revision: 1 }));
  assert.equal(wrapped.pid, 4242, "non-function props pass through");
  assert.equal(wrapped.write("x"), "wrote:4242:x", "methods see the real handle as this");
  assert.notEqual(wrapped, handle);
});

check("wrapTerminalHandle replaces inspectActivity wholesale", async () => {
  const handle = /** @type {import("@deepseek-ai/dsh-subprocess").SubprocessTerminalHandle} */ (/** @type {unknown} */ ({ inspectActivity: async () => ({ state: "unknown", revision: 0 }) }));
  const wrapped = wrapTerminalHandle(handle, async () => ({ state: "idle", revision: 7 }));
  // The controller binds the property off the wrapped object — the replacement
  // must survive exactly that access pattern.
  const bound = wrapped.inspectActivity.bind(wrapped);
  assert.deepEqual(await bound(), { state: "idle", revision: 7 });
});

if (process.platform !== "win32") {
  check("the probe script reports busy while a marked process runs, idle after", async () => {
    const id = "terminal-activity-live-check";
    const probe = terminalActivityProbe(id);
    const run = () => parseTerminalActivity(spawnSync("sh", probe.argv.slice(1), { encoding: "utf8", timeout: 10_000 }).stdout);
    assert.equal(run(), "idle", "no marked process yet");

    // A marked shell holding a live child for ~1.5 s: the marker rides the
    // spawn environment (what wsl.exe does when it imports DSH_TERMINAL_ID
    // before --exec), so the shell is exec'd with it and the sleep inherits
    // it at its own exec — two marked processes, busy for that window, idle
    // again once the marked shell has exited. A runtime `export` inside the
    // script would NOT do: /proc/<pid>/environ shows the exec-time block
    // only, so the shell itself would stay unmarked and the count would
    // never pass one.
    const background = spawn("sh", ["-c", "sleep 1.5 & wait"], { stdio: "ignore", detached: true, env: { ...process.env, [TERMINAL_ID_ENV]: id } });
    background.unref();
    await delay(300);
    assert.equal(run(), "busy", "a marked shell with a live child is busy");
    await delay(1700);
    assert.equal(run(), "idle", "the marked shell has exited");
  });
}

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} terminal-activity checks pass`);
