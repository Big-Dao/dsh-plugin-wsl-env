/**
 * The per-distro resident agent shared by every provider in this process.
 *
 * Extracted from `lib/index.js` so modules the index does not import back
 * (`shell-env`, future consumers) can use the same peer without a cycle: the
 * shell executor's commands, the filesystem's in-distro side work and the
 * port snapshot all queue on ONE agent per distro, and the per-distro startup
 * cost is paid once per process.
 *
 * @module dsh-plugin-wsl/agent-shared
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toLinuxPath } from "./paths.js";
import { WslAgent } from "./agent.js";

const AGENT_SCRIPT_PATH = fileURLToPath(new URL("../agent/wsl-agent.sh", import.meta.url));
// The script the distro reads must be byte-identical to the copy this
// package shipped: the deployed layout reads it from the /mnt/c mirror, and
// the handshake digest is what catches a stale or half-synced runtime copy.
// Both resident factories (plain and confined) pin it.
const AGENT_SCRIPT_DIGEST = createHash("sha256").update(readFileSync(AGENT_SCRIPT_PATH)).digest("hex");
const sharedAgents = new Map();

/** The agent script as a host-side path, for factories that need both spellings. */
export const agentScriptPath = AGENT_SCRIPT_PATH;

/** The sha256 of the shipped agent script; every resident verifies its HELLO against it. */
export const agentScriptDigest = AGENT_SCRIPT_DIGEST;

/**
 * The shared agent for one distro, created on first use.
   * @param {string} distro - the distro name.
 * @returns {WslAgent} the shared agent.
 */
export function sharedAgent(distro) {
  let agent = sharedAgents.get(distro);
  if (agent === undefined) {
    agent = new WslAgent({ distro, scriptPath: toLinuxPath(AGENT_SCRIPT_PATH), expectedDigest: AGENT_SCRIPT_DIGEST });
    sharedAgents.set(distro, agent);
  }
  return agent;
}
