/**
 * Assertion checks for the in-distro watcher: the loop script it generates and
 * the arm/close lifecycle with a fake spawn. Pure or transport-faked, so this
 * runs everywhere including CI.
 *
 * Not covered here: the real `wsl.exe` round trip — `test/probe/watch.sh`
 * executes that against a real distro.
 *
 *   node test/watcher.test.mjs
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { armDistroWatcher, watchLoopScript } from "../lib/watcher.js";

/** @typedef {import("node:child_process").ChildProcess} ChildProcess */

let passed = 0;
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];

checks.push(["the loop script scans the directory itself, so deletions are seen", () => {
  const script = watchLoopScript(2);
  assert.match(script, /find "\$D" -newer "\$S"/);
  assert.match(script, /sleep 2/);
  assert.match(script, /printf 'C\\n'/);
  assert.equal(watchLoopScript(0), watchLoopScript(1), "a sub-second cadence clamps to 1s");
}]);

checks.push(["the loop script removes its stamp on every way out", () => {
  const script = watchLoopScript(2);
  assert.match(script, /trap 'rm -f "\$S"' EXIT/, "the EXIT trap removes the stamp");
  assert.match(script, /trap 'exit 0' TERM INT HUP/, "signals route through a plain exit so the EXIT trap runs");
}]);

checks.push(["the loop script dies loudly when the watched directory vanishes", () => {
  const script = watchLoopScript(2);
  assert.match(script, /\[ ! -d "\$D" \]/, "each tick checks the target still exists");
  assert.match(script, /printf 'E\\n'/, "the E line tells the host, instead of silent never-firing");
  assert.match(script, /exit 1/, "the loop exits rather than spinning on a missing directory");
}]);

checks.push(["an E line reports the vanished target and survives the follow-up exit", async () => {
  const child = new FakeChild();
  const { arm } = fakeSpawn(child);
  /** @type {Error[]} */
  const errors = [];
  const changes = [];
  const close = await armDistroWatcher({
    wslPath: "wsl.exe",
    distro: "ubuntu",
    linuxPath: "/home/you/gone",
    onChange: () => changes.push(1),
    onError: (error) => errors.push(error),
    signal: new AbortController().signal,
    spawn: arm,
  });
  child.line("E");
  child.emit("exit", 1, null); // the loop's own exit right after E
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(errors.length, 1, "exactly one report — E, not E plus the exit");
  assert.match(errors[0].message, /\/home\/you\/gone/);
  assert.match(errors[0].message, /no longer exists/);
  await close(); // still closable, and killing an already-dead loop is a no-op
  assert.equal(changes.length, 0);
}]);

checks.push(["a bounded scan puts -maxdepth right after the path", () => {
  const script = watchLoopScript(2, 4);
  assert.match(script, /find "\$D" -maxdepth 4 -newer "\$S"/);
  assert.equal(watchLoopScript(2, 0), watchLoopScript(2), "0 means the unbounded whole-tree walk");
  assert.equal(watchLoopScript(2, -3), watchLoopScript(2), "nonsense depths fall back to unbounded");
}]);

checks.push(["arming resolves only on the loop's READY barrier, not before", async () => {
  const child = new FakeChild(false);
  const { arm } = fakeSpawn(child);
  let resolved = false;
  const pending = armDistroWatcher({
    wslPath: "wsl.exe",
    distro: "ubuntu",
    linuxPath: "/home/you/proj",
    onChange: () => {},
    signal: new AbortController().signal,
    spawn: arm,
  }).then(() => { resolved = true; return () => {}; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resolved, false, "must not resolve before the READY line");
  child.line("R");
  const close = await pending;
  assert.equal(typeof close, "function");
}]);

checks.push(["arming resolves with a close that stops the loop", async () => {
  const child = new FakeChild();
  const { arm } = fakeSpawn(child);
  const changes = [];
  const controller = new AbortController();
  const close = await armDistroWatcher({
    wslPath: "wsl.exe",
    distro: "ubuntu",
    linuxPath: "/home/you/proj",
    onChange: () => changes.push(1),
    signal: controller.signal,
    spawn: arm,
  });
  child.line("C");
  child.line("C");
  assert.equal(changes.length, 2);
  await close();
  assert.equal(child.killed, true, "close must kill the loop");
  // A late C after close must not fire: the listeners are gone.
  child.line("C");
  assert.equal(changes.length, 2);
}]);

checks.push(["an exited loop surfaces as an error, not silence", async () => {
  const child = new FakeChild();
  const { arm } = fakeSpawn(child);
  const controller = new AbortController();
  /** @type {Error[]} */
  const errors = [];
  const closePromise = armDistroWatcher({
    wslPath: "wsl.exe",
    distro: "ubuntu",
    linuxPath: "/gone",
    onChange: () => {},
    onError: (error) => errors.push(error),
    signal: controller.signal,
    spawn: arm,
  });
  child.emit("exit", 1, null);
  // The seam promise rejects (observation never became active); the same
  // failure also surfaces through onError for the already-active case.
  await assert.rejects(() => closePromise, /exited unexpectedly/);
  assert.equal(errors.length, 0);
}]);

checks.push(["close waits for the loop's exit event, not just the kill call", async () => {
  const child = new FakeChild();
  let killCount = 0;
  child.kill = () => {
    killCount += 1;
    child.exitCode = 0;
    queueMicrotask(() => child.emit("exit", 0, null)); // exit arrives AFTER kill returns
  };
  const { arm } = fakeSpawn(child);
  const close = await armDistroWatcher({
    wslPath: "wsl.exe",
    distro: "ubuntu",
    linuxPath: "/home/you/proj",
    onChange: () => {},
    signal: new AbortController().signal,
    spawn: arm,
  });
  let closed = false;
  await close().then(() => { closed = true; });
  assert.equal(closed, true, "close resolved through the exit event");
  assert.equal(killCount, 1, "exactly one kill");
}]);

checks.push(["an abort after the watcher is active surfaces through onError", async () => {
  const child = new FakeChild();
  const { arm } = fakeSpawn(child);
  const controller = new AbortController();
  /** @type {Error[]} */
  const errors = [];
  const close = await armDistroWatcher({
    wslPath: "wsl.exe",
    distro: "ubuntu",
    linuxPath: "/home/you/proj",
    onChange: () => {},
    onError: (error) => errors.push(error),
    signal: controller.signal,
    spawn: arm,
  });
  controller.abort(new Error("teardown"));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(errors.length, 1, "the already-active watcher reports the teardown");
  assert.match(errors[0].message, /teardown/);
  // After settle, the error is REPORTED, not acted on — stopping the loop is
  // still the caller's close.
  await close();
  assert.equal(child.killed, true, "the caller's close stops the loop after the error");
}]);

checks.push(["a pre-aborted signal rejects without spawning", async () => {
  const controller = new AbortController();
  controller.abort(new Error("nope"));
  let spawned = 0;
  await assert.rejects(
    () => armDistroWatcher({
      wslPath: "wsl.exe",
      distro: "ubuntu",
      linuxPath: "/x",
      onChange: () => {},
      signal: controller.signal,
      spawn: () => {
        spawned += 1;
        return asChild(new FakeChild());
      },
    }),
    /nope/,
  );
  assert.equal(spawned, 0);
}]);

/** The minimum of a ChildProcess the watcher touches. */
class FakeChild extends EventEmitter {
  /**
   * @param autoReady - emit the loop's READY line on construction, as the real
   *   loop does; the barrier test passes false to script the handshake itself.
   */
  /** @param {boolean} [autoReady] - whether the fake announces READY up front. */
  constructor(autoReady = true) {
    super();
    this.stdout = new PassThrough();
    /** @type {PassThrough | undefined} */
    this.stderr = new PassThrough();
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    if (autoReady) queueMicrotask(() => this.line("R"));
  }
  /** @param {string} text - the line to write, terminator added. */
  line(text) {
    this.stdout.write(`${text}\n`);
  }
  // The real loop prints READY right after its stamp; tests that arm a
  // "working" watcher get it for free, tests that script raw lines do not.
  /** @param {string} text - the raw bytes to write. */
  write(text) {
    this.stdout.write(text);
  }
  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

/**
 * Views a scripted child as the `ChildProcess` the watcher's spawn hook returns.
 * @param {FakeChild} child - the scripted child.
 * @returns {ChildProcess} the same object, as the seam's declared child type.
 */
const asChild = (child) => /** @type {ChildProcess} */ (/** @type {unknown} */ (child));

/**
 * A spawn double handing back a scripted child.
 * @param {FakeChild} child - the child to hand out.
 * @returns {{arm: () => ChildProcess}} the spawn hook.
 */
function fakeSpawn(child) {
  return { arm: () => asChild(child) };
}

checks.push(["a child without stderr arms cleanly, and close after exit resolves without waiting", async () => {
  const child = new FakeChild();
  child.stderr = undefined; // the stream is optional; arming must not assume it
  child.exitCode = 1; // already exited before close: the close must not hang
  const { arm } = fakeSpawn(child);
  const close = await armDistroWatcher({
    wslPath: "wsl.exe",
    distro: "ubuntu",
    linuxPath: "/home/you/proj",
    onChange: () => {},
    signal: new AbortController().signal,
    spawn: arm,
  });
  await close();
  assert.equal(child.killed || child.exitCode !== null, true, "the already-exited child needs no kill");
}]);

for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} watcher checks pass`);

