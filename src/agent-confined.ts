/**
 * Confined residents: one long-lived agent per (distro, policy) pair, running
 * its WHOLE lifetime inside the bwrap profile that policy asks for — so every
 * filesystem op it performs is enforced by the kernel's mount table, not just
 * by the host-side check that chose it.
 *
 * This is stage two of the substrate's enforcement story. Stage one routed
 * every op through the plain agent with the policy check deciding what may
 * pass; stage two routes *mutations* to a confined resident whose view of the
 * filesystem already matches the granted rights, so a bug in the check cannot
 * become a write outside the workspace — the kernel refuses it.
 *
 * Keying is the whole design: the profile is fixed for an agent's lifetime,
 * so a change in the policy (the Permissions selector, a session move) simply
 * addresses a different key, and the previous resident retires through its own
 * idle timer. Escalated writes (`danger-full-access`) keep addressing the
 * plain agent, which is what an approved escalation means.
 *
 * The argv it hands the transport is a whole command — program, profile, `--` —
 * assembled by the peer-free `lib/bwrap.js`, which both confinement sites share.
 * That import is why this module needs no DSH peer either: a bare checkout can
 * construct the factory and assert the command it produces, which is what
 * `test/agent.test.mjs` does. It used to import the sandbox's own profile
 * builder and assemble the prefix itself, missing the program; the probe inlined
 * a third copy, so nothing compared production's command with a working one and
 * every confined mutation failed the resident's handshake.
 *
 * This is a TypeScript source built to `lib/agent-confined.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/agent-confined
 */
import { bwrapArgvPrefix } from "./bwrap.js";
import { toLinuxPath } from "./paths.js";
import { agentScriptDigest, agentScriptPath } from "./agent-shared.js";
import { WslAgent } from "./agent.js";

const confinedAgents = new Map<string, WslAgent>();

/** One confinement request. */
export interface ConfinedAgentRequest {
  /** The distro to run in. */
  distro: string;
  /** The `wsl.exe` path. */
  wslPath?: string;
  /**
   * The RESOLVED file-effect policy: the profile binds exactly what the mode
   * grants.
   */
  policy: { mode: string, workspaceRoot: string };
  /**
   * Shadow `/mnt` with an empty tmpfs in the resident's profile; part of the
   * cache key, since it changes the mount table the resident lives under.
   */
  maskWindowsDrive?: boolean;
  /**
   * Default TRUE: workspace-write binds the distro's real `/tmp` read-write
   * into the resident's profile, so a write the fence approved lands where
   * every reader reads. `false` restores the ephemeral tmpfs — for tests and
   * probes, not production: a `/tmp` write behind an ephemeral mount reports
   * success into a directory no reader can see, which is the bug this default
   * exists to prevent.
   */
  realTmp?: boolean;
}

/**
 * The confined agent for one distro and one resolved policy, created on first
 * use and shared for the process lifetime. A success is remembered; a failed
 * start is not (the agent's own rebuild rules take over from there).
 *
 * @param request - the confinement request.
 * @returns the confined resident for this key.
 */
export function confinedAgent({ distro, wslPath = "wsl.exe", policy, maskWindowsDrive = false, realTmp = true }: ConfinedAgentRequest): WslAgent {
  const key = `${wslPath}\0${distro}\0${policy.mode}\0${policy.workspaceRoot}\0${maskWindowsDrive ? "masked" : "visible"}\0${realTmp ? "real" : "ephemeral"}`;
  let agent = confinedAgents.get(key);
  if (agent === undefined) {
    agent = new WslAgent({
      distro,
      wslPath,
      scriptPath: toLinuxPath(agentScriptPath),
      expectedDigest: agentScriptDigest,
      // The prefix is a whole command from the distro's point of view — program,
      // profile, `--` — because the transport inserts it between
      // `wsl.exe --exec` and the `sh <script>` pair (`lib/agent.js`'s
      // `spawnDefault`). Both confinement sites share that assembly in
      // `lib/bwrap.js`, whose module doc records what happened when they did not.
      argvPrefix: bwrapArgvPrefix(
        { mode: policy.mode, workspaceRoot: toLinuxPath(policy.workspaceRoot, { distro }) },
        { maskWindowsDrive, realTmp },
      ),
    });
    confinedAgents.set(key, agent);
  }
  return agent;
}

/** Test hook: forget every confined resident (the plain agent has no factory state). */
export function resetConfinedAgents(): void {
  confinedAgents.clear();
}

export default confinedAgent;
