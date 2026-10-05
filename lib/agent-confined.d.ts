import { WslAgent } from "./agent.js";
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
