/**
 * Assertion checks for the session-scoped runtime registry (ADR 0001): the
 * refcount, the unit name and prefix composition, the mode-specific mounts,
 * and the close-then-stop teardown. The agent factory and the scope stopper
 * are injected, so no systemd or distro is touched.
 *
 *   node test/session-runtime.test.mjs
 */
import assert from "node:assert/strict";
import { mock } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { SessionRuntimes, setSessionNativeAgent } from "../lib/session-runtime.js";
import { ORPHAN_RUNTIME_IDLE_MS, ORPHAN_SWEEP_MS, ProviderRuntimeBook, SessionEndWatch, orphanedSessions } from "../lib/provider-common.js";

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
        // The real resident stamps its construction time the same way.
        lastActivityAt: Date.now(),
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
  sessionId: "session-a",
};

check("writableRoots are part of the key and bind inside the scope", async () => {
  const { registry, spawns } = harness();
  const plain = registry.acquire(request);
  const granted = registry.acquire({ ...request, writableRoots: ["/home/andy/.npm", "/home/andy/.cache"] });
  assert.notEqual(plain, granted, "a different mount table is a different runtime");
  assert.equal(spawns.length, 2, "the granted runtime spawned separately");
  const prefix = spawns[1]?.argvPrefix ?? [];
  const bwrap = prefix.indexOf("bwrap");
  assert.ok(bwrap > 0, "the mount profile follows the scope prefix");
  assert.deepEqual(prefix.slice(-10), [
    "--bind", "/home/andy/proj", "/home/andy/proj",
    "--bind", "/home/andy/.npm", "/home/andy/.npm",
    "--bind", "/home/andy/.cache", "/home/andy/.cache",
    "--",
  ]);
  assert.equal(registry.acquire({ ...request, writableRoots: ["/home/andy/.npm", "/home/andy/.cache"] }), granted, "the same roots reuse the runtime");
});

check("socket masks are part of the key and bind inside the scope", async () => {
  const { registry, spawns } = harness();
  const masks = ["/run/user/1000/bus", "/run/dbus/system_bus_socket"];
  const plain = registry.acquire(request);
  const masked = registry.acquire({ ...request, socketMasks: masks });
  assert.notEqual(plain, masked, "a different socket mount table is a different runtime");
  const prefix = spawns[1]?.argvPrefix ?? [];
  const bwrap = prefix.indexOf("bwrap");
  assert.ok(bwrap > 0, "the mount profile follows the scope prefix");
  for (const socket of masks) {
    const index = prefix.indexOf(socket);
    assert.ok(index > 0, `${socket} is in the profile`);
    assert.deepEqual(prefix.slice(index - 2, index + 1), ["--ro-bind", "/dev/null", socket]);
  }
  assert.equal(prefix[prefix.length - 1], "--", "the command separator is last");
  assert.equal(registry.acquire({ ...request, socketMasks: masks }), masked, "the same masks reuse the runtime");
});

check("maskInterop is part of the key and shadows /run/WSL", async () => {
  const { registry, spawns } = harness();
  const plain = registry.acquire(request);
  const masked = registry.acquire({ ...request, maskInterop: true });
  assert.notEqual(plain, masked, "a different interop mount table is a different runtime");
  const prefix = spawns[1]?.argvPrefix ?? [];
  const index = prefix.indexOf("/run/WSL");
  assert.ok(index > 0, "the interop transport is in the profile");
  assert.deepEqual(prefix.slice(index - 1, index + 1), ["--tmpfs", "/run/WSL"]);
  assert.equal(registry.acquire({ ...request, maskInterop: true }), masked, "the same mask reuses the runtime");
});

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

check("different sessions in one workspace have separate runtimes and lifetimes", async () => {
  const { registry, spawns, stops } = harness();
  const first = registry.acquire(request);
  const second = registry.acquire({ ...request, sessionId: "session-b" });
  assert.notEqual(first.key, second.key);
  assert.notEqual(first.unit, second.unit);
  assert.equal(spawns.length, 2);
  await registry.release(first.key);
  assert.deepEqual(stops.map((entry) => entry.unit), [first.unit]);
  await registry.release(second.key);
  assert.deepEqual(stops.map((entry) => entry.unit), [first.unit, second.unit]);
});

check("missing or empty session identifiers do not share runtimes", async () => {
  const { registry, spawns } = harness();
  const first = registry.acquire({ ...request, sessionId: "" });
  const second = registry.acquire({ ...request, sessionId: "" });
  const third = registry.acquire({ ...request, sessionId: undefined });
  assert.notEqual(first.key, second.key);
  assert.notEqual(second.key, third.key);
  assert.equal(spawns.length, 3);
  await registry.disposeAll();
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
  const digest = "c".repeat(64);
  setSessionNativeAgent("ubuntu", native, digest);
  try {
    const registry = new SessionRuntimes({ stopScope: () => {} });
    const entry = registry.acquire({ distro: "ubuntu", wslPath: "wsl.exe", workspaceRoot: "/home/u/proj", mode: "workspace-write" });
    assert.equal(entry.agent.scriptPath, native, "the native binary is the entrypoint");
    assert.equal(entry.agent.expectedDigest, digest, "the HELLO must present the copied binary's sha256");
    assert.equal(entry.agent.signalable, false, "the native reads KILL frames; USR1 would kill it");
    await registry.release(entry.key);
  } finally {
    setSessionNativeAgent("ubuntu", "");
  }
});

check("a distro without a native entry builds the shell fallback with the shipped digest", async () => {
  setSessionNativeAgent("ze-shell-fallback", "");
  try {
    const registry = new SessionRuntimes({ stopScope: () => {} });
    const entry = registry.acquire({ distro: "ze-shell-fallback", wslPath: "wsl.exe", workspaceRoot: "/home/u/proj", mode: "workspace-write" });
    assert.ok(entry.agent.scriptPath.endsWith("wsl-agent.sh"), "the shell agent script is the entrypoint");
    assert.equal(/** @type {string} */ (entry.agent.expectedDigest).length, 64, "the digest is the shipped script's sha256");
    await registry.release(entry.key);
  } finally {
    setSessionNativeAgent("ze-shell-fallback", "");
  }
});

check("a probe whose wsl.exe cannot run degrades to the error-shaped output", async () => {
  const { probeSessionRuntime } = await import("../lib/session-runtime.js");
  // The probe's answer is the remedy-bearing refusal string, or null when the
  // platform is usable — a broken run is a refusal, never a silent pass.
  const outcome = await probeSessionRuntime({ wslPath: "/nonexistent-dsh-wsl", distro: "ze-x", run: (async () => "") });
  assert.match(/** @type {string} */ (outcome ?? ""), /answered \(nothing\)|failed/, "the broken probe names its remedy");
});

check("the default stop is best effort against a scope that may already be gone", async () => {
  // No injected stopScope: the default stop spawns its stopper and absorbs a
  // spawn failure — a stale unit is a listing problem, not an acquire failure.
  const registry = new SessionRuntimes();
  const entry = registry.acquire({ distro: "ze-default-stop", wslPath: "/nonexistent-dsh-wsl", workspaceRoot: "/home/u/proj", mode: "workspace-write", sessionId: "s1" });
  assert.ok(entry.agent, "the acquire itself does not depend on the stopper");
  await registry.release(entry.key);
});

check("an entry names its session; a request without one is keyed by a token of its own", () => {
  const { registry } = harness();
  assert.equal(registry.acquire(request).sessionId, "session-a");
  const bare = registry.acquire({ ...request, sessionId: undefined });
  assert.equal(bare.sessionId.length > 0, true, "the token is never empty, so a session end can name it");
});

check("releaseSession tears a session's runtimes down whatever their reference count, and only that session's", async () => {
  const { registry, stops, events } = harness();
  /** The agents closed so far, read from the event log the harness mutates. */
  const closes = () => events.filter((event) => event === "close").length;
  const shared = registry.acquire(request);
  registry.acquire({ ...request });
  assert.equal(shared.refs, 2, "precondition: two holders keep the runtime");
  const sibling = registry.acquire({ ...request, mode: "read-only" });
  const other = registry.acquire({ ...request, sessionId: "session-b" });
  assert.equal(registry.holds(shared), true);
  await registry.releaseSession("session-a");
  assert.deepEqual(stops.map((stop) => stop.unit).sort(), [shared.unit, sibling.unit].sort(), "every runtime of the session stops, reference count or not");
  assert.deepEqual(events, ["close", "stop", "close", "stop"], "each one closes its agent before its scope stops");
  assert.equal(closes(), 2);
  assert.equal(registry.holds(shared), false, "a holder's cached entry is no longer the registry's");
  assert.equal(registry.holds(other), true, "another session's runtime is untouched");
  assert.equal(registry.acquire({ ...request, sessionId: "session-b" }), other, "and still addressable");
  await registry.releaseSession("session-a");
  await registry.release(shared.key);
  assert.equal(closes(), 2, "ending it again, or releasing a stale reference, tears nothing down twice");
  const resumed = registry.acquire(request);
  assert.notEqual(resumed, shared, "a session resumed under the same id gets a fresh runtime");
  assert.equal(registry.holds(resumed), true);
});

check("orphanedSessions names the quiet runtimes nothing holds", () => {
  const now = 1_000_000;
  /**
   * One held runtime over a scripted resident.
   * @param {string} sessionId - the session the runtime belongs to.
   * @param {{ lastActivityAt?: number }} agent - the resident's activity time, or none.
   * @returns {Record<string, unknown>} the entry.
   */
  const held = (sessionId, agent) => ({ key: sessionId, unit: `u-${sessionId}`, agent, distro: "ubuntu", wslPath: "wsl.exe", refs: 1, sessionId });
  const quiet = held("gone", { lastActivityAt: now - ORPHAN_RUNTIME_IDLE_MS });
  // The entries spell the slice `orphanedSessions` reads; the one cast states
  // which declared type they stand in for.
  const entries = /** @type {import("../lib/session-runtime.js").SessionRuntimeEntry[]} */ (/** @type {unknown} */ ([
    quiet,
    held("gone", { lastActivityAt: now - ORPHAN_RUNTIME_IDLE_MS + 1 }),
    held("gone", {}),
    held("owner-token", { lastActivityAt: 0 }),
    held("alive", { lastActivityAt: 0 }),
  ]));
  /** @param {string} id - a session id. */
  const readable = (id) => id !== "gone";
  assert.deepEqual(orphanedSessions({ entries, sessionless: "owner-token", sessionLive: readable, now }), ["gone", "owner-token"]);
  assert.deepEqual(orphanedSessions({ entries, sessionless: "owner-token", sessionLive: readable, now, idleMs: ORPHAN_RUNTIME_IDLE_MS * 2 }), [], "a longer window spares the quiet one too");
  assert.deepEqual(
    orphanedSessions({ entries, sessionless: "owner-token", sessionLive: () => undefined, now }),
    ["owner-token"],
    "an agent registry that cannot be read spares every named session",
  );
  const gone = entries.filter((entry) => entry.sessionId === "gone").slice(0, 1);
  assert.deepEqual(orphanedSessions({ entries: [...gone, ...gone], sessionless: "owner-token", sessionLive: readable, now }), ["gone"], "once per session, however many runtimes it had");
});

/**
 * The dispatch slice the watch listens through: cordis's typed `Events` does
 * not name the harness's agent events.
 * @typedef {{ parallel: (event: "agent/disposed", payload: { agent: { id: string } }) => Promise<void> }} DisposalBus
 */

/**
 * Views a context as the bus a disposal is dispatched on.
 * @param {Context} ctx - the context.
 * @returns {DisposalBus} the bus.
 */
const busOf = (ctx) => /** @type {DisposalBus} */ (/** @type {unknown} */ (ctx));

/** Lets the teardown a sweep started run past its awaits. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A provider-shaped owner over the recording registry.
 * @param {SessionRuntimes} registry - the registry the provider holds runtimes in.
 * @returns {import("../lib/provider-common.js").SessionEndOwner & { runtimeBook: ProviderRuntimeBook }} the owner.
 */
const ownerOf = (registry) => ({ runtimeBook: new ProviderRuntimeBook(), sessionRuntimes: registry, sessionRuntimeOwner: "owner-token" });

check("agent/disposed ends the session through the watch: the holder's book goes first, then the scope", async () => {
  const { registry, stops } = harness();
  const ctx = new Context();
  const owner = ownerOf(registry);
  const watch = new SessionEndWatch(owner, ctx);
  /**
   * Acquire for the owner and record the reference in its book.
   * @param {Partial<typeof request>} overrides - the request's differences.
   * @returns {import("../lib/session-runtime.js").SessionRuntimeEntry} the held runtime.
   */
  const hold = (overrides) => {
    const entry = registry.acquire({ ...request, ...overrides });
    owner.runtimeBook.sessionRuntimeEntries.set(entry.key, entry);
    return entry;
  };
  const ended = hold({});
  registry.acquire(request);
  assert.equal(ended.refs, 2, "precondition: a reference the watch does not know about");
  const kept = hold({ sessionId: "session-b" });
  await busOf(ctx).parallel("agent/disposed", { agent: { id: "session-a" } });
  assert.equal(owner.runtimeBook.sessionRuntimeEntries.has(ended.key), false, "the holder's book no longer names the runtime");
  assert.equal(registry.holds(ended), false, "the leftover reference did not keep the scope alive");
  assert.deepEqual(stops.map((stop) => stop.unit), [ended.unit]);
  assert.equal(registry.holds(kept), true, "another session keeps its runtime");
  watch.dispose();
  await busOf(ctx).parallel("agent/disposed", { agent: { id: "session-b" } });
  assert.equal(registry.holds(kept), true, "a disposed watch no longer ends sessions");
  await registry.disposeAll();
});

check("the sweep ends a session the event missed once it is quiet, and never one a live agent holds", async () => {
  const { registry, stops } = harness();
  const ctx = new Context();
  // A service is readable through `ctx.get` only while its providing fiber is
  // active, which in a bare Context means from inside a plugin — the shape
  // the harness itself provides `agents` in.
  await ctx.plugin({
    name: "agents-host",
    /** @param {Context} hostCtx - the host plugin's context. */
    apply(hostCtx) {
      hostCtx.provide("agents", {
        /** @param {string} id - a session id. */
        get: (id) => (id === "live-session" ? { id } : undefined),
        list: () => [],
      });
    },
  });
  const owner = ownerOf(registry);
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const watch = new SessionEndWatch(owner, ctx);
    /**
     * Acquire for the owner and record the reference in its book.
     * @param {Partial<typeof request>} overrides - the request's differences.
     * @returns {import("../lib/session-runtime.js").SessionRuntimeEntry} the held runtime.
     */
    const hold = (overrides) => {
      const entry = registry.acquire({ ...request, ...overrides });
      owner.runtimeBook.sessionRuntimeEntries.set(entry.key, entry);
      return entry;
    };
    const held = hold({ sessionId: "live-session" });
    const missed = hold({ sessionId: "missed-session" });
    // A provider keys a request that names no session by its own token.
    const sessionless = hold({ sessionId: owner.sessionRuntimeOwner });
    watch.ensureSweep();
    mock.timers.tick(ORPHAN_SWEEP_MS * 9);
    await settle();
    assert.equal(stops.length, 0, "inside the idle window nothing is ended, whatever holds it");
    // The missed session's runtime is used again: its window starts over.
    missed.agent.lastActivityAt = Date.now();
    mock.timers.tick(ORPHAN_SWEEP_MS * 2);
    await settle();
    assert.deepEqual(stops.map((stop) => stop.unit), [sessionless.unit], "only the runtime that never named a session was quiet for a whole window");
    assert.equal(owner.runtimeBook.sessionRuntimeEntries.size, 2, "the ended runtime left the book with its scope");
    mock.timers.tick(ORPHAN_RUNTIME_IDLE_MS + ORPHAN_SWEEP_MS);
    await settle();
    assert.equal(registry.holds(missed), false, "quiet and held by no live agent: ended");
    assert.equal(registry.holds(held), true, "quiet but held by a live agent: kept, for as long as the session lives");
    assert.equal(stops.length, 2);
    watch.dispose();
  } finally {
    mock.timers.reset();
  }
  await registry.disposeAll();
});

check("a watch over a context that exposes no agent registry ends nothing on its own", async () => {
  const { registry, stops } = harness();
  const ctx = new Context();
  const owner = ownerOf(registry);
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  try {
    const watch = new SessionEndWatch(owner, ctx);
    const entry = registry.acquire({ ...request, sessionId: "nobody-knows" });
    owner.runtimeBook.sessionRuntimeEntries.set(entry.key, entry);
    watch.ensureSweep();
    mock.timers.tick(ORPHAN_RUNTIME_IDLE_MS + ORPHAN_SWEEP_MS * 2);
    await settle();
    assert.equal(stops.length, 0, "an unreadable fact is not read as gone");
    watch.dispose();
  } finally {
    mock.timers.reset();
  }
  await registry.disposeAll();
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} session-runtime checks pass`);
