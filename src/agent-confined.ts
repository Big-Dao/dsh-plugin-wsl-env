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


/**
 * The resident's spawn checklist, as one `sh -c` body run in the distro.
 *
 * Steps, in order — the first failing step names itself on stderr and exits 1:
 *
 * - `workspace-root`: the bwrap profile binds the root (`--bind <root>
 *   <root>`) and bwrap refuses a missing bind source, so `mkdir -p` it — on a
 *   freshly imported distro the first write's workspace may not exist yet
 *   (WSL-305).
 * - `interpreter`: the resident runs as `sh <script>`; a distro without `sh`
 *   is not a distro this plugin can serve.
 * - `base64` and `sha256sum`: the agent script's frames and its HELLO digest
 *   read through them; coreutils provides both on the glibc families and
 *   busybox applets on Alpine (verified in the container matrix).
 *
 * The root rides as `$1`, so the body carries no interpolated path — the
 * same body is safe for any (distro, root) pair.
 *
 * @param root - the Linux-spelled workspace root.
 * @returns the `sh -c` body.
 */
export function spawnChecklistScript(root: string): string {
  return [
    'mkdir -p -- "$1" || { echo workspace-root >&2; exit 1; }',
    "command -v sh >/dev/null || { echo interpreter >&2; exit 1; }",
    "command -v base64 >/dev/null || { echo base64 >&2; exit 1; }",
    "command -v sha256sum >/dev/null || { echo sha256sum >&2; exit 1; }",
  ].join("\n");
}

/**
 * Run the spawn checklist in the distro: one `wsl.exe --exec sh -c` round
 * trip, the workspace root as `$1`. Resolves when every step passes;
 * rejects with the named failing step when one does not — the resident
 * would exit during its handshake with a bare code 1 and no hint (WSL-305),
 * and a name beats a code.
 *
 * @param options - the transport, distro, root, and an injectable run.
 * @returns resolves when the checklist passes.
 */
export async function runSpawnChecklist({ wslPath, distro, root, runFn }: { wslPath: string, distro: string, root: string, runFn?: (argv: string[]) => Promise<unknown> }): Promise<void> {
  const run = runFn ?? (async (argv: string[]) => {
    const { runCapture } = await import("./wsl.js");
    return runCapture([wslPath, "-d", distro, ...argv]);
  });
  let detail = "";
  try {
    await run(["--exec", "sh", "-c", spawnChecklistScript(root), "sh", root]);
  } catch (error) {
    // runCapture rejects on the checklist's non-zero exit with the stderr
    // folded into the message — where the failing step named itself.
    detail = String(error).trim();
  }
  const named = /workspace-root|interpreter|base64|sha256sum/.exec(detail)?.[0];
  if (named !== undefined) {
    throw new Error(`spawn checklist step '${named}' failed in ${distro}`);
  }
  if (detail !== "") {
    throw new Error(`spawn checklist could not run in ${distro}: ${detail.slice(0, 200)}`);
  }
}

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
    const linuxRoot = toLinuxPath(policy.workspaceRoot, { distro });
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
      argvPrefix: bwrapArgvPrefix({ mode: policy.mode, workspaceRoot: linuxRoot }, { maskWindowsDrive, realTmp }),
      // workspace-write is the only mode that binds the workspace root, and
      // bwrap refuses a missing bind source (WSL-305): on a freshly imported
      // distro the first write's workspace may not exist yet, and the resident
      // used to exit during its handshake with a bare code 1. Create the root
      // before the first spawn; every later start re-runs it harmlessly.
      prepare: policy.mode === "workspace-write"
        ? () => runSpawnChecklist({ wslPath, distro, root: linuxRoot }).then(() => undefined)
        : undefined,
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
