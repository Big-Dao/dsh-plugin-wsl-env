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

checks.push(["the loop script scans the directory itself, so deletions are seen", () => {
  const script = watchLoopScript(2);
  assert.match(script, /find "\$D" -newer "\$S"/);
  assert.match(script, /sleep 2/);
  assert.match(script, /printf 'C\\n'/);
  assert.equal(watchLoopScript(0), watchLoopScript(1), "a sub-second cadence clamps to 1s");
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
        return new FakeChild();
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
  constructor(autoReady = true) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    if (autoReady) queueMicrotask(() => this.line("R"));
  }
  line(text) {
    this.stdout.write(`${text}\n`);
  }
  // The real loop prints READY right after its stamp; tests that arm a
  // "working" watcher get it for free, tests that script raw lines do not.
  write(text) {
    this.stdout.write(text);
  }
  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

/** A spawn double handing back a scripted child. */
function fakeSpawn(child) {
  return { arm: () => child };
}

for (const [name, fn] of checks) await check(name, fn);
console.log(`\n${passed} watcher checks pass`);

