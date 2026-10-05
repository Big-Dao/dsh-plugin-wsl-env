/**
 * The confined agent for one distro and one resolved policy, created on first
 * use and shared for the process lifetime. A success is remembered; a failed
 * start is not (the agent's own rebuild rules take over from there).
 *
 * @param {object} request - the confinement request.
 * @param {string} request.distro - the distro to run in.
 * @param {string} [request.wslPath] - the `wsl.exe` path.
 * @param {{mode: string, workspaceRoot: string}} request.policy - the RESOLVED
 *   file-effect policy: the profile binds exactly what the mode grants.
 * @param {boolean} [request.maskWindowsDrive] - shadow `/mnt` with an empty
 *   tmpfs in the resident's profile; part of the cache key, since it changes
 *   the mount table the resident lives under.
 * @param {boolean} [request.realTmp] - default TRUE: workspace-write binds the
 *   distro's real `/tmp` read-write into the resident's profile, so a write
 *   the fence approved lands where every reader reads. `false` restores the
 *   ephemeral tmpfs — for tests and probes, not production: a `/tmp` write
 *   behind an ephemeral mount reports success into a directory no reader can
 *   see, which is the bug this default exists to prevent.
 * @returns {WslAgent} the confined resident for this key.
 */
export function confinedAgent({ distro, wslPath, policy, maskWindowsDrive, realTmp }: {
    distro: string;
    wslPath?: string | undefined;
    policy: {
        mode: string;
        workspaceRoot: string;
    };
    maskWindowsDrive?: boolean | undefined;
    realTmp?: boolean | undefined;
}): WslAgent;
/** Test hook: forget every confined resident (the plain agent has no factory state). */
export function resetConfinedAgents(): void;
export default confinedAgent;
import { WslAgent } from "./agent.js";
