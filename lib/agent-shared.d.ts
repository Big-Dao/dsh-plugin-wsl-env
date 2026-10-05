/**
 * The per-distro resident agent shared by every provider in this process.
 *
 * Extracted from `lib/index.js` so modules the index does not import back
 * (`shell-env`, future consumers) can use the same peer without a cycle: the
 * shell executor's commands, the filesystem's in-distro side work and the
 * port snapshot all queue on ONE agent per distro, and the per-distro startup
 * cost is paid once per process.
 *
 * This is a TypeScript source built to `lib/agent-shared.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/agent-shared
 */
import { WslAgent } from "./agent.js";
/** The agent script as a host-side path, for factories that need both spellings. */
export declare const agentScriptPath: string;
/** The sha256 of the shipped agent script; every resident verifies its HELLO against it. */
export declare const agentScriptDigest: string;
/**
 * The shared agent for one distro, created on first use.
 *
 * @param distro - the distro name.
 * @returns the shared agent.
 */
export declare function sharedAgent(distro: string): WslAgent;
