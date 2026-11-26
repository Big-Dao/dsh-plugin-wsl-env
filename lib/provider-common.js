import { canonicalPath, SandboxInvalidRootError, writableRoots } from "@deepseek-ai/dsh-sandbox";
import { isWslUnc, posixToUnc, toLinuxPath } from "./paths.js";
import { distroOfUnc, isDefaultDistro, pinnedDistro } from "./distro-route.js";
import { linuxHomePath } from "./wsl.js";
import { WritableRootError, ensureWritableRoots, resolveWritableRoots } from "./writable-roots.js";
const AUTO_SCOPE_RECHECK_MS = 60_000;
/**
 * How long a session runtime must have been quiet before the sweep may end
 * the session of one that no live agent holds any more. The same window the
 * shared resident idles out after; a live session's runtime is never subject
 * to it, however long it sits quiet.
 */
export const ORPHAN_RUNTIME_IDLE_MS = 600_000;
/** How often a provider sweeps its session runtimes for unheld ones. */
export const ORPHAN_SWEEP_MS = 60_000;
/**
 * The configured default workdir, or an empty string when the operator left it
 * unset. `cwd` is a volatile field on both providers, so it is read through
 * `.get()`, and it may be absent entirely.
 */
export function configuredCwd(config) {
    return String(config.cwd?.get?.() ?? "").trim();
}
/**
 * The distro user's home as a Linux path, cached on the provider instance whose
 * `distro`/`wslPath` config it belongs to.
 */
export async function distroHome(owner, distro) {
    const cached = owner.resolvedHomes.get(distro);
    if (cached !== undefined)
        return cached;
    if (owner.resolvedHome !== undefined && owner.resolvedDistro.length > 0 && distro === owner.resolvedDistro) {
        owner.resolvedHomes.set(distro, owner.resolvedHome);
        return owner.resolvedHome;
    }
    const config = owner.config;
    const home = await linuxHomePath(distro, { wslPath: config.wslPath });
    owner.resolvedHomes.set(distro, home);
    if (owner.resolvedDistro.length > 0 && distro === owner.resolvedDistro)
        owner.resolvedHome = home;
    return home;
}
/**
 * Translate workspace-write grants into the vocabulary used by the target
 * filesystem. WSL workspaces receive distro-local temporary and extra roots;
 * Windows workspaces retain the upstream grant.
 */
export function wslWritableRoots(policy, distro, linuxExtraRoots) {
    if (policy.mode !== "workspace-write")
        return [];
    const roots = new Set([canonicalPath(policy.workspaceRoot)]);
    if (isWslUnc(policy.workspaceRoot)) {
        roots.add(canonicalPath(posixToUnc(distro, "/tmp")));
        roots.add(canonicalPath(posixToUnc(distro, "/dev/shm")));
        for (const root of linuxExtraRoots)
            roots.add(canonicalPath(posixToUnc(distro, root)));
    }
    else {
        for (const root of writableRoots(policy))
            roots.add(root);
    }
    return [...roots];
}
/**
 * Resolve configured and policy-provided roots for one distro, then verify
 * their physical directories before they are bound into a confinement profile.
 */
export async function effectiveWritableRoots(input) {
    try {
        const roots = resolveWritableRoots({
            configured: input.configured,
            policy: input.policy?.additionalWritableRoots,
            home: input.home,
            distro: input.distro,
            workspaceRoot: toLinuxPath(input.policy?.workspaceRoot ?? input.home),
        });
        if (input.check !== false) {
            await ensureWritableRoots({ wslPath: input.wslPath, distro: input.distro, roots, signal: input.signal, ...(input.run === undefined ? {} : { run: input.run }) });
        }
        return roots;
    }
    catch (error) {
        if (error instanceof WritableRootError)
            throw new SandboxInvalidRootError(error.root, error.reason);
        throw error;
    }
}
/** Whether confined profiles shadow `/mnt`, with the explicit stance winning. */
export function effectiveMaskWindowsDrive(config) {
    if (config.interopVisibility !== undefined)
        return config.interopVisibility !== "visible";
    return config.maskWindowsDrive === true;
}
/** Resolve the distro for an operation from its configuration and candidates. */
export async function resolveOperationDistro(configured, candidates, probeDefault) {
    const pinned = pinnedDistro(configured);
    if (pinned !== undefined)
        return pinned;
    if (!isDefaultDistro(configured)) {
        for (const candidate of candidates) {
            const named = distroOfUnc(candidate);
            if (named !== undefined)
                return named;
        }
    }
    return probeDefault();
}
/**
 * Choose the session runtime policy for one distro, retrying an automatic
 * failed probe after its short cache expires.
 */
export async function sessionRuntimeWanted(value, distro, ensure, cache) {
    if (value === false)
        return false;
    if (value === true) {
        await ensure();
        return true;
    }
    const cached = cache.get(distro);
    if (cached?.usable === true)
        return true;
    if (cached !== undefined && Date.now() - cached.checkedAt < AUTO_SCOPE_RECHECK_MS)
        return false;
    try {
        await ensure();
        cache.set(distro, { usable: true, checkedAt: Date.now() });
        return true;
    }
    catch {
        cache.set(distro, { usable: false, checkedAt: Date.now() });
        return false;
    }
}
/**
 * The per-provider bookkeeping the filesystem and shell providers share.
 *
 * Both rows cache distro homes, hold session runtimes by registry key, cache
 * the session-runtime preflight that succeeded per distro, and cache the
 * `auto` preflight verdict. Own the state in one place so a semantic change
 * (the last one was the session-runtime move) is made once, not twice.
 */
export class ProviderRuntimeBook {
    /** Per-distro homes, so two concurrent distros cannot share one. */
    homes = new Map();
    /** The runtimes this provider holds, by registry key. */
    sessionRuntimeEntries = new Map();
    /** Distros whose session-runtime preflight has succeeded. */
    sessionRuntimePreflight = new Set();
    /** Per-distro `auto` verdicts, re-probed when they were negative and stale. */
    autoSessionScope = new Map();
}
/**
 * Drop one provider's references to every runtime a session used. The book
 * entries go first and together — a request for that session arriving
 * meanwhile acquires a fresh runtime instead of reusing one being torn down —
 * and the references are released afterwards.
 *
 * @param owner - the provider dropping its references.
 * @param sessionId - the session that ended.
 * @returns resolved once every dropped reference is released.
 */
async function dropSessionRuntimes(owner, sessionId) {
    const keys = [...owner.runtimeBook.sessionRuntimeEntries]
        .filter(([, entry]) => entry.sessionId === sessionId)
        .map(([key]) => key);
    for (const key of keys)
        owner.runtimeBook.sessionRuntimeEntries.delete(key);
    for (const key of keys)
        await owner.sessionRuntimes.release(key);
}
/**
 * The sessions to end: every one whose runtimes are quiet past the idle
 * window and that nothing holds any more — no live agent serves it, or it
 * was never a session at all (the provider's own token).
 *
 * The sweep is the safety net under `agent/disposed`, not a second way to end
 * a session: a runtime used inside the window is spared whatever its session
 * looks like, and when the harness exposes no agent registry to read, every
 * runtime is spared — an unreadable fact is never read as "gone".
 *
 * @param object - the held runtimes and the facts the verdict needs.
 * @returns the session ids to end, without duplicates.
 */
export function orphanedSessions({ entries, sessionless, sessionLive, now, idleMs = ORPHAN_RUNTIME_IDLE_MS }) {
    const sessions = new Set();
    for (const entry of entries) {
        if (!isQuiet(entry.agent, now, idleMs))
            continue;
        if (entry.sessionId !== sessionless && sessionLive(entry.sessionId) !== false)
            continue;
        sessions.add(entry.sessionId);
    }
    return [...sessions];
}
/**
 * Whether a runtime's resident has been quiet for the idle window. A resident
 * that reports no activity time is never called quiet.
 *
 * @param agent - the runtime's resident.
 * @param now - the current time, epoch ms.
 * @param idleMs - the idle window.
 * @returns true when the window has fully elapsed since its last exchange.
 */
function isQuiet(agent, now, idleMs) {
    return typeof agent.lastActivityAt === "number" && now - agent.lastActivityAt >= idleMs;
}
/**
 * Tie one provider's session runtimes to the sessions they belong to.
 *
 * The preset realm both providers live in is shared by every session and
 * outlives all of them: upstream disposes its scope only when the preset
 * definition is unregistered, so nothing registered there runs "when the
 * session ends". What fires per session is the harness's `agent/disposed` —
 * the rows inside a preset inherit the preset scope's tag, and an agent's
 * events are dispatched up the scope chain — so that event ends the session
 * here. A periodic sweep underneath ends the sessions whose runtimes sit
 * quiet with no live agent behind them: it covers a session end the event did
 * not deliver, and requests that never named a session at all.
 */
export class SessionEndWatch {
    /** The provider whose runtimes this watch ends. */
    owner;
    /** Whether a live agent still serves a session; `undefined` when unreadable. */
    sessionLive;
    /** The unheld-session sweep, running while the provider holds a runtime. */
    sweep = null;
    /** Detaches the `agent/disposed` listener. */
    off;
    /**
     * @param owner - the provider; read at call time, so a test may substitute
     *   its registry after construction.
     * @param ctx - the provider's composition context.
     */
    constructor(owner, ctx) {
        this.owner = owner;
        this.sessionLive = sessionLiveReader(ctx);
        // The promise is returned, not discarded: the harness contains and logs a
        // listener's rejected teardown instead of turning it into an unhandled
        // rejection.
        this.off = ctx.on("agent/disposed", (payload) => {
            const id = payload?.agent?.id;
            return id === undefined ? undefined : this.endSession(id);
        });
    }
    /**
     * End one session for this provider: its own references go first, so its
     * book never names a runtime being torn down, then the registry ends the
     * session for every holder.
     *
     * @param sessionId - the session that ended.
     * @returns resolved once the session's runtimes are torn down.
     */
    async endSession(sessionId) {
        await dropSessionRuntimes(this.owner, sessionId);
        await this.owner.sessionRuntimes.releaseSession(sessionId);
        if (this.owner.runtimeBook.sessionRuntimeEntries.size === 0)
            this.stopSweep();
    }
    /**
     * Make sure the unheld-session sweep runs; called once the provider holds a
     * runtime. The timer never keeps the process alive.
     */
    ensureSweep() {
        if (this.sweep !== null)
            return;
        const timer = setInterval(() => {
            for (const sessionId of orphanedSessions({
                entries: this.owner.runtimeBook.sessionRuntimeEntries.values(),
                sessionless: this.owner.sessionRuntimeOwner,
                sessionLive: this.sessionLive,
                now: Date.now(),
            })) {
                void this.endSession(sessionId).catch(() => { });
            }
        }, ORPHAN_SWEEP_MS);
        timer.unref?.();
        this.sweep = timer;
    }
    /** Stop the sweep while the provider holds nothing; a later acquire restarts it. */
    stopSweep() {
        if (this.sweep !== null)
            clearInterval(this.sweep);
        this.sweep = null;
    }
    /** Detach the listener and stop the sweep: the provider is going away. */
    dispose() {
        this.off();
        this.stopSweep();
    }
}
/**
 * Whether a live agent still serves a session, read from the harness's agent
 * registry. `agents` is read with `ctx.get` because the providers do not
 * inject it — a property read of an uninjected service throws in cordis 4 —
 * and an unreadable registry answers `undefined`, which the sweep takes as
 * "do not know", never as "gone".
 *
 * @param ctx - the provider's composition context.
 * @returns the liveness reader.
 */
function sessionLiveReader(ctx) {
    return (sessionId) => {
        try {
            const agents = ctx.get("agents");
            if (typeof agents?.get !== "function")
                return undefined;
            return agents.get(sessionId) !== undefined;
        }
        catch {
            return undefined;
        }
    };
}
