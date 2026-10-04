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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

check("the probe targets the distro shell with the id as an argument, never interpolated", () => {
  const id = "probe-$(rm -rf /)-id";
  const probe = terminalActivityProbe(id);
  assert.deepEqual(probe.cwd, "/");
  assert.deepEqual(probe.argv.slice(0, 2), ["sh", "-c"]);
  assert.equal(probe.argv[3], "sh", "the script's own $0");
  assert.equal(probe.argv[4], id, "the id rides as $1");
  assert.equal(probe.argv[2].includes(id), false, "the id is not interpolated into the script text");
  assert.equal(probe.argv[2].includes("[["), false, "POSIX sh only — no bashisms");
});

check("parseTerminalActivity reads exactly the two reported states", () => {
  assert.equal(parseTerminalActivity("busy\n"), "busy");
  assert.equal(parseTerminalActivity("idle\n"), "idle");
  assert.equal(parseTerminalActivity(""), undefined);
  assert.equal(parseTerminalActivity("sh: line 1: boom: not found\n"), undefined);
});

check("wrapTerminalHandle forwards methods bound to the real handle", () => {
  const handle = {
    pid: 4242,
    write(text) {
      return `wrote:${this.pid}:${text}`;
    },
  };
  const wrapped = wrapTerminalHandle(handle, async () => ({ state: "idle", revision: 1 }));
  assert.equal(wrapped.pid, 4242, "non-function props pass through");
  assert.equal(wrapped.write("x"), "wrote:4242:x", "methods see the real handle as this");
  assert.notEqual(wrapped, handle);
});

check("wrapTerminalHandle replaces inspectActivity wholesale", async () => {
  const handle = { inspectActivity: async () => ({ state: "unknown", revision: 0 }) };
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

    // A marked shell holding a live child for ~1.5 s: the parent carries the
    // exported marker in its environ, the sleep is its child — busy for that
    // window, idle again once the marked shell has exited.
    const background = spawn("sh", ["-c", `export ${TERMINAL_ID_ENV}='${id}'; sleep 1.5 & wait`], { stdio: "ignore", detached: true });
    background.unref();
    await delay(300);
    assert.equal(run(), "busy", "a marked shell with a live child is busy");
    await delay(1700);
    assert.equal(run(), "idle", "the marked shell has exited");
  });
}

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} terminal-activity checks pass`);
