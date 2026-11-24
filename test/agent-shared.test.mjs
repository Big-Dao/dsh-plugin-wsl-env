/**
 * Checks the shared-agent selection (A7): the `agentBackend` mode picks the
 * native entry when prepared, and the shell otherwise; the app-wide singleton
 * is keyed by transport and distro.
 *
 *   node test/agent-shared.test.mjs
 */
import assert from "node:assert/strict";
import { NATIVE_DEMOTION_MS, agentScriptDigest, freshNativeVerdict, nativeEntryAllowed, recordStart, resetSharedAgents, sharedAgent } from "../lib/agent-shared.js";
import { configureAgentBackend } from "../lib/native-agent.js";

let passed = 0;
/**
 * Runs one check now.
 * @param {string} name - the check name.
 * @param {() => void | Promise<void>} fn - the check body.
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

await check("agentBackend shell keeps the shared reads on the shell script", async () => {
  configureAgentBackend("shell");
  const agent = sharedAgent("ubuntu");
  assert.match(agent.scriptPath, /wsl-agent\.sh$/u);
  assert.equal(agent.expectedDigest, agentScriptDigest);
  assert.equal(sharedAgent("ubuntu"), agent, "the agent is one per distro");
  await agent.close();
});

await check("a custom wslPath is its own shared agent", async () => {
  configureAgentBackend("shell");
  resetSharedAgents();
  const custom = sharedAgent("ze-transport", "C:\\custom\\wsl.exe");
  const fallback = sharedAgent("ze-transport");
  assert.notEqual(custom, fallback, "the configured transport is not the default one");
  assert.equal(sharedAgent("ze-transport", "C:\\custom\\wsl.exe"), custom, "one agent per transport and distro");
  await custom.close();
  await fallback.close();
  resetSharedAgents();
});

await check("one instance per distro for the life of the process, through a death", async () => {
  configureAgentBackend("shell");
  resetSharedAgents();
  const agent = sharedAgent("ze-shared-death");
  // The state every path into `dead` leaves: no pid, a death to its name.
  agent.markDead();
  assert.equal(agent.status().pid, undefined);
  assert.equal(agent.unavailable, true);
  assert.equal(sharedAgent("ze-shared-death"), agent, "a dead resident is not replaced: its own revival budget is the recovery");
  assert.equal(agent.deaths, 1, "and the budget is not reset behind its back");
  resetSharedAgents();
});

await check("the native entry is demoted only by failing where the shell entry starts", () => {
  const t0 = 1_000_000;
  const healthy = freshNativeVerdict();
  recordStart(healthy, { ok: true, native: true }, t0);
  assert.deepEqual(healthy, { suspect: false, demotedUntil: 0 });
  assert.equal(nativeEntryAllowed(healthy, t0), true);

  // The distro is down: both entries fail alike, which says nothing about
  // the binary. Retiring it here is what used to happen on ANY death.
  const outage = freshNativeVerdict();
  recordStart(outage, { ok: false, native: true }, t0);
  assert.equal(nativeEntryAllowed(outage, t0), false, "while suspected, the next start is the shell entry's");
  recordStart(outage, { ok: false, native: false }, t0 + 1000);
  assert.deepEqual(outage, { suspect: true, demotedUntil: 0 }, "a shell entry that fails too leaves the suspicion open, not settled");

  // The native entry down and the shell entry up on the same distro: that is
  // the evidence, and it demotes the native entry for a while — not for good.
  const broken = freshNativeVerdict();
  recordStart(broken, { ok: false, native: true }, t0);
  recordStart(broken, { ok: true, native: false }, t0 + 2000);
  assert.equal(broken.suspect, false);
  assert.equal(broken.demotedUntil, t0 + 2000 + NATIVE_DEMOTION_MS);
  assert.equal(nativeEntryAllowed(broken, broken.demotedUntil - 1), false);
  assert.equal(nativeEntryAllowed(broken, broken.demotedUntil), true, "after the window the entry is tried again");

  // A native start that then succeeds closes the matter.
  const recovered = { ...broken };
  recordStart(recovered, { ok: true, native: true }, broken.demotedUntil + 1);
  assert.equal(nativeEntryAllowed(recovered, broken.demotedUntil), true);

  // A failed shell start on its own is not the native entry's problem.
  const shellOnly = freshNativeVerdict();
  recordStart(shellOnly, { ok: false, native: false }, t0);
  assert.deepEqual(shellOnly, { suspect: false, demotedUntil: 0 });
  assert.equal(nativeEntryAllowed(shellOnly, t0), true);
});

console.log(`\n${passed} agent-shared checks pass`);
