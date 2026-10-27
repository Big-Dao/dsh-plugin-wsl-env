import { WslAgent } from "./agent.js";
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
export declare function spawnChecklistScript(root: string): string;
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
export declare function runSpawnChecklist({ wslPath, distro, root, runFn }: {
    wslPath: string;
    distro: string;
    root: string;
    runFn?: (argv: string[]) => Promise<unknown>;
}): Promise<void>;
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
    policy: {
        mode: string;
        workspaceRoot: string;
    };
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
export declare function confinedAgent({ distro, wslPath, policy, maskWindowsDrive, realTmp }: ConfinedAgentRequest): WslAgent;
/** Test hook: forget every confined resident (the plain agent has no factory state). */
export declare function resetConfinedAgents(): void;
export default confinedAgent;
