/**
 * Assertion checks for the socket-isolation helper: the probe's parse, the
 * per-stance masks, the once-per-distro cache, and the fail-closed probe.
 *
 *   node test/socket-isolation.test.mjs
 */
import assert from "node:assert/strict";
import {
  SocketIsolationError,
  parseSocketIsolationFacts,
  resetSocketIsolationCache,
  socketIsolationProbeScript,
  socketMaskPaths,
  socketMasksFor,
} from "../lib/socket-isolation.js";

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

const FACTS = "R /run/user/1000\nU /run/user/1000/bus\nU /run/user/1000/systemd/private\nS /run/dbus/system_bus_socket\nS /run/user/1000/bus\n";

await check("parseSocketIsolationFacts splits the runtime, user and strict sections", async () => {
  const facts = parseSocketIsolationFacts(FACTS);
  assert.equal(facts.runtimeDir, "/run/user/1000");
  assert.deepEqual(facts.userSockets, ["/run/user/1000/bus", "/run/user/1000/systemd/private"]);
  assert.deepEqual(facts.strictSockets, ["/run/dbus/system_bus_socket", "/run/user/1000/bus"]);
});

await check("socketMaskPaths maps the stance, deduplicating the union", async () => {
  const facts = parseSocketIsolationFacts(FACTS);
  assert.deepEqual(socketMaskPaths("off", facts), []);
  assert.deepEqual(socketMaskPaths("session-bus", facts), ["/run/user/1000/bus", "/run/user/1000/systemd/private"]);
  assert.deepEqual(socketMaskPaths("strict", facts), ["/run/user/1000/bus", "/run/user/1000/systemd/private", "/run/dbus/system_bus_socket"]);
});

await check("socketMasksFor probes once per distro and caches the facts", async () => {
  resetSocketIsolationCache();
  /** @type {string[][]} */
  const calls = [];
  const run = async (/** @type {string[]} */ argv) => {
    calls.push(argv);
    return FACTS;
  };
  const first = await socketMasksFor({ mode: "session-bus", wslPath: "wsl.exe", distro: "ubuntu", run });
  assert.deepEqual(first, ["/run/user/1000/bus", "/run/user/1000/systemd/private"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], "wsl.exe");
  assert.deepEqual(calls[0]?.slice(1, 4), ["-d", "ubuntu", "--exec"]);
  const second = await socketMasksFor({ mode: "strict", wslPath: "wsl.exe", distro: "ubuntu", run });
  assert.equal(calls.length, 1, "the second stance reused the cached facts");
  assert.ok(second.includes("/run/dbus/system_bus_socket"));
});

await check("socketMasksFor skips the probe for off", async () => {
  resetSocketIsolationCache();
  let called = 0;
  const masks = await socketMasksFor({ mode: "off", wslPath: "wsl.exe", distro: "ubuntu", run: async () => { called += 1; return ""; } });
  assert.deepEqual(masks, []);
  assert.equal(called, 0);
});

await check("a failed probe throws a SocketIsolationError and is retried", async () => {
  resetSocketIsolationCache();
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls === 1) throw new Error("boom");
    return FACTS;
  };
  await assert.rejects(
    () => socketMasksFor({ mode: "session-bus", wslPath: "wsl.exe", distro: "ubuntu", run: flaky }),
    (error) => error instanceof SocketIsolationError && error.mode === "session-bus",
  );
  const masks = await socketMasksFor({ mode: "session-bus", wslPath: "wsl.exe", distro: "ubuntu", run: flaky });
  assert.equal(calls, 2, "a failure is not cached");
  assert.deepEqual(masks, ["/run/user/1000/bus", "/run/user/1000/systemd/private"]);
});

await check("the probe script names the runtime directory and the strict sockets", async () => {
  const script = socketIsolationProbeScript();
  assert.match(script, /XDG_RUNTIME_DIR/);
  assert.match(script, /\/run\/dbus\/system_bus_socket/);
  assert.match(script, /readlink -f/);
});

for (const [name, fn] of checks) await runCheck(name, fn);
console.log(`\n${passed} socket-isolation checks pass`);
