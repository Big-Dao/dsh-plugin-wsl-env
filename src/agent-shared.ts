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

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toLinuxPath } from "./paths.js";
import { pinnedWindowsEnv, WslAgent } from "./agent.js";
import { configuredAgentBackend, ensureNativeBackend, NATIVE_AGENT_ENV } from "./native-agent.js";

const AGENT_SCRIPT_PATH = fileURLToPath(new URL("../agent/wsl-agent.sh", import.meta.url));
// The script the distro reads must be byte-identical to the copy this
// package shipped: the deployed layout reads it from the /mnt/c mirror, and
// the handshake digest is what catches a stale or half-synced runtime copy.
// Both resident factories (plain and confined) pin it.
const AGENT_SCRIPT_DIGEST = createHash("sha256").update(readFileSync(AGENT_SCRIPT_PATH)).digest("hex");
const sharedAgents = new Map<string, WslAgent>();
// Distros where the native shared agent failed at runtime; the reads fail open
// to the shell instead of retrying the same broken binary on every call.
const nativeFailed = new Set<string>();

/** The agent script as a host-side path, for factories that need both spellings. */
export const agentScriptPath = AGENT_SCRIPT_PATH;

/** The sha256 of the shipped agent script; every resident verifies its HELLO against it. */
export const agentScriptDigest = AGENT_SCRIPT_DIGEST;

/**
 * The shared agent for one distro, created on first use.
 *
 * @param distro - the distro name.
 * @returns the shared agent.
 */
export function sharedAgent(distro: string): WslAgent {
  let agent = sharedAgents.get(distro);
  if (agent !== undefined && !agent.unavailable) return agent;
  if (agent !== undefined) nativeFailed.add(distro);
  agent = new WslAgent({
    distro,
    scriptPath: toLinuxPath(AGENT_SCRIPT_PATH),
    expectedDigest: AGENT_SCRIPT_DIGEST,
    prepare: async () => {
      if (configuredAgentBackend() === "shell" || nativeFailed.has(distro)) return undefined;
      const prepared = await ensureNativeBackend({ wslPath: "wsl.exe", distro, source: process.env[NATIVE_AGENT_ENV] ?? "" });
      if (prepared === undefined) return undefined;
      return {
        scriptPath: prepared.path,
        expectedDigest: prepared.digest,
        signalable: false,
        serialRequests: false,
        spawnTransport: ({ wslPath, distro: target, argvPrefix }) =>
          spawn(wslPath, ["-d", target, "--exec", ...argvPrefix, prepared.path], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: pinnedWindowsEnv(process.env),
          }),
      };
    },
  });
  sharedAgents.set(distro, agent);
  return agent;
}
