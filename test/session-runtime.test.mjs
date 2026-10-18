/**
 * Assertion checks for the session-scoped runtime registry (ADR 0001): the
 * refcount, the unit name and prefix composition, the mode-specific mounts,
 * and the close-then-stop teardown. The agent factory and the scope stopper
 * are injected, so no systemd or distro is touched.
 *
 *   node test/session-runtime.test.mjs
 */
import assert from "node:assert/strict";
import { SessionRuntimes, setSessionNativeAgent } from "../lib/session-runtime.js";

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
 * A registry over recording fakes.
 * @returns {{ registry: SessionRuntimes, spawns: Array<{ distro: string, wslPath: string, argvPrefix: string[], idleMs: number, leaseMs: number, signalable: boolean }>, stops: Array<{ wslPath: string, distro: string, unit: string }>, closes: number, events: string[] }} the wiring.
 */
const harness = () => {
  /** @type {Array<{ distro: string, wslPath: string, argvPrefix: string[], idleMs: number, leaseMs: number, signalable: boolean }>} */
  const spawns = [];
  /** @type {Array<{ wslPath: string, distro: string, unit: string }>} */
  const stops = [];
  /** @type {string[]} */
  const events = [];
  const state = { spawns, stops, events, closes: 0 };
  const registry = new SessionRuntimes({
    spawnAgent: (options) => {
      spawns.push(options);
      return /** @type {import("../lib/agent.js").WslAgent} */ (/** @type {unknown} */ ({
        close: async () => {
          state.closes += 1;
          events.push("close");
        },
      }));
    },
    stopScope: (options) => {
      stops.push(options);
      events.push("stop");
    },
    token: () => `tok${spawns.length + 1}`,
  });
  return { registry, ...state };
};

/** One workspace-write request; individual checks override what they need. */
const request = {
  distro: "ubuntu",
  wslPath: "wsl.exe",
  workspaceRoot: "/home/andy/proj",
  mode: "workspace-write",
  maskWindowsDrive: false,
};

check("the same key is one runtime, refcounted, with the scope + mount prefix", async () => {
  const { registry, spawns, stops, events } = harness();
  const first = registry.acquire(request);
  const second = registry.acquire({ ...request });
  assert.equal(first, second, "the same key addresses the same runtime");
  assert.equal(first.refs, 2);
  assert.equal(spawns.length, 1, "the second acquire did not spawn");
  assert.equal(first.unit, "dsh-wsl-ubuntu-tok1");
  assert.deepEqual(spawns[0]?.argvPrefix.slice(0, 7), [
    "systemd-run", "--user", "--scope", "--quiet", "--unit", "dsh-wsl-ubuntu-tok1", "--",
  ]);
  assert.equal(spawns[0]?.idleMs, 0, "the runtime lives for the session, not an idle window");
  assert.equal(spawns[0]?.leaseMs, 0);
  assert.equal(spawns[0]?.signalable, true, "no PID namespace, so the agent stays cancellable");
  const prefix = spawns[0]?.argvPrefix ?? [];
  const bwrap = prefix.indexOf("bwrap");
  assert.ok(bwrap > 0, "the mount profile follows the scope prefix");
  assert.equal(prefix.includes("--unshare-pid"), false, "the session runtime has no PID namespace");
  assert.deepEqual(prefix.slice(bwrap), [
    "bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent",
    "--bind", "/tmp", "/tmp", "--bind", "/home/andy/proj", "/home/andy/proj", "--",
  ]);
  await registry.release(first.key);
  assert.equal(events.length, 0, "one holder still keeps the runtime alive");
  await registry.release(first.key);
  assert.deepEqual(events, ["close", "stop"], "the last release closes, then stops the scope");
  assert.equal(stops[0]?.unit, first.unit);
});

check("danger-full-access keeps the scope but no mounts", async () => {
  const { registry, spawns } = harness();
  const entry = registry.acquire({ ...request, mode: "danger-full-access" });
  const prefix = spawns[0]?.argvPrefix ?? [];
  assert.equal(prefix.includes("bwrap"), false, "an approved escalation is not mount-confined");
  assert.deepEqual(prefix.slice(0, 7), ["systemd-run", "--user", "--scope", "--quiet", "--unit", entry.unit, "--"]);
  await registry.release(entry.key);
});

check("read-only mounts neither /tmp nor the workspace", async () => {
  const { registry, spawns } = harness();
  const entry = registry.acquire({ ...request, mode: "read-only" });
  const prefix = spawns[0]?.argvPrefix ?? [];
  assert.deepEqual(prefix.slice(0, 7), ["systemd-run", "--user", "--scope", "--quiet", "--unit", entry.unit, "--"]);
  assert.equal(prefix.includes("/tmp"), false);
  assert.equal(prefix.includes("/home/andy/proj"), false);
  assert.equal(prefix.includes("--unshare-pid"), false);
  await registry.release(entry.key);
});

check("the mask is part of the key and the profile", async () => {
  const { registry, spawns } = harness();
  const visible = registry.acquire(request);
  const masked = registry.acquire({ ...request, maskWindowsDrive: true });
  assert.notEqual(visible.key, masked.key, "a masked runtime is a different runtime");
  assert.notEqual(visible.unit, masked.unit);
  assert.equal(spawns.length, 2);
  assert.equal((spawns[1]?.argvPrefix ?? []).includes("--tmpfs"), true, "the masked profile shadows /mnt");
  await registry.disposeAll();
});

check("an explicit lease is independent of the idle close", async () => {
  const { registry, spawns } = harness();
  const entry = registry.acquire({ ...request, leaseMs: 720000 });
  assert.equal(spawns[0]?.leaseMs, 720000);
  assert.equal(spawns[0]?.idleMs, 0);
  await registry.release(entry.key);
});

check("disposeAll tears down every runtime, and an unknown release is a no-op", async () => {
  const { registry, spawns, stops, events } = harness();
  registry.acquire(request);
  registry.acquire({ ...request, mode: "read-only" });
  assert.equal(spawns.length, 2);
  await registry.disposeAll();
  assert.equal(stops.length, 2);
  assert.deepEqual(events, ["close", "stop", "close", "stop"]);
  await registry.release("not-a-key");
  assert.equal(stops.length, 2, "releasing an unknown key changes nothing");
});


check("a distro with a native entry spawns it without sh and with USR1 off", async () => {
  const native = "/home/u/.cache/dsh-wsl/agent/abc/dsh-wsl-agent";
  setSessionNativeAgent("ubuntu", native);
  try {
    const registry = new SessionRuntimes({ stopScope: () => {} });
    const entry = registry.acquire({ distro: "ubuntu", wslPath: "wsl.exe", workspaceRoot: "/home/u/proj", mode: "workspace-write" });
    assert.equal(entry.agent.scriptPath, native, "the native binary is the entrypoint");
    assert.equal(entry.agent.expectedDigest, undefined, "the spike HELLO has no digest");
    assert.equal(entry.agent.signalable, false, "the native reads KILL frames; USR1 would kill it");
    await registry.release(entry.key);
  } finally {
    setSessionNativeAgent("ubuntu", "");
  }
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} session-runtime checks pass`);
