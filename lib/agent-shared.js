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

import { fileURLToPath } from "node:url";
import { toLinuxPath } from "./paths.js";
import { WslAgent } from "./agent.js";

const AGENT_SCRIPT_PATH = fileURLToPath(new URL("../agent/wsl-agent.sh", import.meta.url));
const sharedAgents = new Map();

/**
 * The shared agent for one distro, created on first use.
 * @param distro - the distro name.
 * @returns {WslAgent} the shared agent.
 */
export function sharedAgent(distro) {
  let agent = sharedAgents.get(distro);
  if (agent === undefined) {
    agent = new WslAgent({ distro, scriptPath: toLinuxPath(AGENT_SCRIPT_PATH) });
    sharedAgents.set(distro, agent);
  }
  return agent;
}
