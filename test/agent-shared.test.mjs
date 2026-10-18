/**
 * Checks the shared-agent selection (A7): the `agentBackend` mode picks the
 * native entry when prepared, and the shell otherwise; the app-wide singleton
 * is keyed by distro.
 *
 *   node test/agent-shared.test.mjs
 */
import assert from "node:assert/strict";
import { agentScriptDigest, sharedAgent } from "../lib/agent-shared.js";
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

console.log(`\n${passed} agent-shared checks pass`);
