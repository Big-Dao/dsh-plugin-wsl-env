/**
 * Session-start sandbox preflight: surface a missing or broken `bwrap` when a
 * distro session OPENS, not when its first command fails closed.
 *
 * Without this the discovery moment is the model's first command, whose
 * `SANDBOX_UNAVAILABLE` error scrolls past as one tool failure among many; the
 * operator may not read it until several commands have failed the same way.
 * The probe itself is not new — it is the providers' own usability probe, run
 * through the same shared cache (`lib/sandbox-core.js`), so a session-start
 * check costs a real probe only once per process, and the first confined
 * command after it pays nothing. Nothing else changes: the failure semantics
 * stay exactly as fail-closed as before, this service only MOVES THE NEWS.
 *
 * Advisory by construction. A preflight that cannot run (no WSL, a wedged
 * `wsl.exe`) degrades to a log line; it must never fail a session that has not
 * even asked for confinement yet. It also never installs anything: the remedy
 * it prints is the same one the refusals carry, and running an installer under
 * root uninvited would be a posture this plugin explicitly rejects.
 *
 * This is a TypeScript source built to `lib/preflight.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/preflight
 */
import z from "@deepseek-ai/schemastery";
import { isWslUnc } from "./paths.js";
import { defaultDistro, runCapture } from "./wsl.js";
import { distroOfUnc, isDefaultDistro, pinnedDistro } from "./distro-route.js";
import { bwrapFailure, bwrapUsable, missingBwrapRemedy } from "./sandbox-core.js";
import { sessionScopeSweepScript } from "./session-scope.js";
export const name = "wsl-preflight";
export const Config = z.object({
    /**
     * Distro to preflight. Empty/`"auto"` follows the session workspace; an
     * explicit name pins; `"default"` forces WSL's default.
     */
    distro: z.string().default(""),
    /** The `wsl.exe` path the probe spawns; keep in step with the providers' `wslPath`. */
    wslPath: z.string().default("wsl.exe"),
    /** Whether the session-start sandbox preflight runs at all. */
    sandbox: z.boolean().default(true),
});
/** Distros whose stale-scope sweep has already run in this process. */
const sweptDistros = new Set();
/**
 * Stop `dsh-wsl-*.scope` units a crashed app left behind. A scope is stale
 * when its cgroup has no `wsl-agent.sh`; a live agent means another session
 * still owns it. Advisory: a failed spawn re-arms the distro for the next
 * session, and the once-per-distro cache keeps the cost off the normal path.
 *
 * @param wslPath - the `wsl.exe` path.
 * @param distro - the resolved distro.
 */
const sweepStaleScopes = (wslPath, distro) => {
    if (sweptDistros.has(distro))
        return;
    sweptDistros.add(distro);
    void runCapture([wslPath, "-d", distro, "--exec", "sh", "-c", sessionScopeSweepScript()]).catch(() => {
        sweptDistros.delete(distro);
    });
};
/**
 * Mount the preflight service.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export async function apply(ctx, config = {}) {
    if (!(config.sandbox ?? true))
        return;
    const wslPath = config.wslPath ?? "wsl.exe";
    const warn = (message) => ctx.logger?.warn?.(message);
    /**
     * Probe the distro once and surface an unusable `bwrap` as a warning.
     *
     * @param agent - the session that just opened, for the workspace scope.
     */
    const check = async (agent) => {
        // Only a distro workspace has commands that confine: a host session would
        // warn about a sandbox it never uses.
        const cwd = agent?.session?.header?.cwd;
        if (cwd === undefined || !isWslUnc(cwd))
            return;
        const pinned = pinnedDistro(config.distro);
        let distro = pinned ?? "";
        if (distro.length === 0) {
            if (!isDefaultDistro(config.distro)) {
                distro = distroOfUnc(cwd) ?? "";
            }
            if (distro.length === 0) {
                try {
                    distro = await defaultDistro({ wslPath });
                }
                catch (error) {
                    // No WSL at all is the missing-wsl probe's territory; the first
                    // command's own error is the precise one. Stay quiet at warn level.
                    ctx.logger?.debug?.(`wsl-preflight: no default distro to preflight (${error?.message ?? error})`);
                    return;
                }
            }
        }
        // bwrapUsable answers false on a failed probe — it never rejects — so
        // nothing here can throw except a broken context, which is the caller's
        // bug, not the session's.
        // Clean up what a hard crash left behind before this session creates its
        // runtime; a live agent in another session's cgroup makes its scope safe.
        sweepStaleScopes(wslPath, distro);
        const usable = await bwrapUsable({ wslPath, distro });
        if (usable) {
            ctx.logger?.debug?.(`wsl-preflight: bwrap is usable inside distro "${distro}"`);
            return;
        }
        warn(`wsl-preflight: ${bwrapFailure(wslPath, distro) ?? missingBwrapRemedy(distro)}`);
    };
    ctx.on("agent/created", (payload) => void check(payload?.agent));
    // Mount order is not a guarantee: a session created during startup can finish
    // before this service mounts and miss the event entirely (dsh-headless does
    // exactly that, and auto-preset sweeps for the same reason).
    try {
        for (const agent of ctx.agents?.list() ?? [])
            void check(agent);
    }
    catch (error) {
        ctx.logger?.debug?.(`wsl-preflight: could not sweep already-live agents: ${error?.message ?? error}`);
    }
}
