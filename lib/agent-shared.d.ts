/**
 * The shared agent for one distro, created on first use.
   * @param {string} distro - the distro name.
 * @returns {WslAgent} the shared agent.
 */
export function sharedAgent(distro: string): WslAgent;
/** The agent script as a host-side path, for factories that need both spellings. */
export const agentScriptPath: string;
/** The sha256 of the shipped agent script; every resident verifies its HELLO against it. */
export const agentScriptDigest: string;
import { WslAgent } from "./agent.js";
