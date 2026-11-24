import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionRuntimeEntry } from "./session-runtime.js";
/**
 * How long a session runtime must have been quiet before the sweep may end
 * the session of one that no live agent holds any more. The same window the
 * shared resident idles out after; a live session's runtime is never subject
 * to it, however long it sits quiet.
 */
export declare const ORPHAN_RUNTIME_IDLE_MS = 600000;
/** How often a provider sweeps its session runtimes for unheld ones. */
export declare const ORPHAN_SWEEP_MS = 60000;
interface DistroHomeOwner {
    config: unknown;
    resolvedDistro: string;
    resolvedHome: string | undefined;
    resolvedHomes: Map<string, string>;
}
/**
 * The configured default workdir, or an empty string when the operator left it
 * unset. `cwd` is a volatile field on both providers, so it is read through
 * `.get()`, and it may be absent entirely.
 */
export declare function configuredCwd(config: {
    cwd?: {
        get(): string | undefined;
    };
}): string;
/**
 * The distro user's home as a Linux path, cached on the provider instance whose
 * `distro`/`wslPath` config it belongs to.
 */
export declare function distroHome(owner: DistroHomeOwner, distro: string): Promise<string>;
/**
 * Translate workspace-write grants into the vocabulary used by the target
 * filesystem. WSL workspaces receive distro-local temporary and extra roots;
 * Windows workspaces retain the upstream grant.
 */
export declare function wslWritableRoots(policy: SandboxExecutionPolicy, distro: string, linuxExtraRoots: readonly string[]): string[];
/**
 * Resolve configured and policy-provided roots for one distro, then verify
 * their physical directories before they are bound into a confinement profile.
 */
export declare function effectiveWritableRoots(input: {
    configured?: readonly string[] | undefined;
    policy?: SandboxExecutionPolicy | undefined;
    distro: string;
    home: string;
    wslPath: string;
    signal?: AbortSignal | undefined;
    run?: ((argv: string[]) => Promise<string>) | undefined;
    check?: boolean;
}): Promise<string[]>;
/** Whether confined profiles shadow `/mnt`, with the explicit stance winning. */
export declare function effectiveMaskWindowsDrive(config: {
    interopVisibility?: "visible" | "masked" | "disabled";
    maskWindowsDrive?: boolean;
}): boolean;
/** Resolve the distro for an operation from its configuration and candidates. */
export declare function resolveOperationDistro(configured: string, candidates: ReadonlyArray<string | undefined>, probeDefault: () => Promise<string>): Promise<string>;
/**
 * Choose the session runtime policy for one distro, retrying an automatic
 * failed probe after its short cache expires.
 */
export declare function sessionRuntimeWanted(value: boolean | "auto", distro: string, ensure: () => Promise<void>, cache: Map<string, {
    usable: boolean;
    checkedAt: number;
}>): Promise<boolean>;
/**
 * The per-provider bookkeeping the filesystem and shell providers share.
 *
 * Both rows cache distro homes, hold session runtimes by registry key, cache
 * the session-runtime preflight that succeeded per distro, and cache the
 * `auto` preflight verdict. Own the state in one place so a semantic change
 * (the last one was the session-runtime move) is made once, not twice.
 */
export declare class ProviderRuntimeBook {
    /** Per-distro homes, so two concurrent distros cannot share one. */
    readonly homes: Map<string, string>;
    /** The runtimes this provider holds, by registry key. */
    readonly sessionRuntimeEntries: Map<string, SessionRuntimeEntry>;
    /** Distros whose session-runtime preflight has succeeded. */
    readonly sessionRuntimePreflight: Set<string>;
    /** Per-distro `auto` verdicts, re-probed when they were negative and stale. */
    readonly autoSessionScope: Map<string, {
        usable: boolean;
        checkedAt: number;
    }>;
}
/** The lifecycle slice the session-end wiring listens on. */
export interface SessionLifecycle {
    /** The harness's agent-disposed event, carrying the agent that left. */
    on: (event: "agent/disposed", listener: (payload: {
        agent?: {
            id: string;
        } | undefined;
    } | undefined) => void | Promise<void>) => () => boolean;
}
/** The registry slice a provider's session-end wiring drives. */
interface SessionRuntimeRegistry {
    /** Release one reference. */
    release: (key: string) => Promise<void>;
    /** Whether the registry still keeps a cached entry. */
    holds: (entry: SessionRuntimeEntry) => boolean;
    /** End one session for every holder. */
    releaseSession: (sessionId: string) => Promise<void>;
}
/** The provider state the session-end wiring reads and keeps. */
export interface SessionEndOwner {
    /** The provider's book. */
    runtimeBook: ProviderRuntimeBook;
    /** The registry; tests substitute it after construction. */
    sessionRuntimes: SessionRuntimeRegistry;
    /** The provider's token for requests that carry no session identity. */
    sessionRuntimeOwner: string;
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
export declare function orphanedSessions({ entries, sessionless, sessionLive, now, idleMs }: {
    /** The runtimes a provider holds. */
    entries: Iterable<SessionRuntimeEntry>;
    /** The token the provider keys sessionless requests by. */
    sessionless: string;
    /**
     * Whether a live agent still serves a session; `undefined` when that cannot
     * be read.
     */
    sessionLive: (sessionId: string) => boolean | undefined;
    /** The current time, epoch ms. */
    now: number;
    /** How long a runtime must have been quiet; defaults to {@link ORPHAN_RUNTIME_IDLE_MS}. */
    idleMs?: number;
}): string[];
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
export declare class SessionEndWatch {
    /** The provider whose runtimes this watch ends. */
    private readonly owner;
    /** Whether a live agent still serves a session; `undefined` when unreadable. */
    private readonly sessionLive;
    /** The unheld-session sweep, running while the provider holds a runtime. */
    private sweep;
    /** Detaches the `agent/disposed` listener. */
    private readonly off;
    /**
     * @param owner - the provider; read at call time, so a test may substitute
     *   its registry after construction.
     * @param ctx - the provider's composition context.
     */
    constructor(owner: SessionEndOwner, ctx: Context);
    /**
     * End one session for this provider: its own references go first, so its
     * book never names a runtime being torn down, then the registry ends the
     * session for every holder.
     *
     * @param sessionId - the session that ended.
     * @returns resolved once the session's runtimes are torn down.
     */
    endSession(sessionId: string): Promise<void>;
    /**
     * Make sure the unheld-session sweep runs; called once the provider holds a
     * runtime. The timer never keeps the process alive.
     */
    ensureSweep(): void;
    /** Stop the sweep while the provider holds nothing; a later acquire restarts it. */
    stopSweep(): void;
    /** Detach the listener and stop the sweep: the provider is going away. */
    dispose(): void;
}
export {};
