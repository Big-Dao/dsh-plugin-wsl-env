/**
 * The session-scoped runtime registry (ADR 0001).
 *
 * One long-lived agent per `(sessionId, distro, workspaceRoot, policy)`, shared by the
 * providers that need it and refcounted: the first `acquire` spawns the agent
 * inside a systemd user scope, the last `release` closes the agent and stops
 * the scope (the cgroup then reaps any background dev server a command left
 * behind). The agent runs with no idle close — its lifetime is the session's —
 * but an explicit client lease still catches a wedged host.
 *
 * The session's end is the harness's `agent/disposed`: a provider in the
 * preset's realm hears it (rows there inherit the preset scope's tag, and
 * agent events flow up the scope chain), and calls {@link
 * SessionRuntimes.releaseSession}, which tears the session's runtimes down
 * however many references they carry. Each holder drops its own book for the
 * session on the same event, before it calls — and a holder that finds the
 * registry no longer keeps an entry it cached ({@link SessionRuntimes.holds})
 * acquires afresh rather than reusing a closed agent. The preset's own scope
 * is NOT the session's: upstream disposes it only when the preset definition
 * is unregistered, so a disposer registered by a provider there runs once per
 * process, never once per session.
 *
 * The confinement here is the agent's own bwrap mount profile, WITHOUT a PID
 * namespace: commands are the agent's children, so a background process
 * survives the command, `/tmp` is the distro's real `/tmp` under
 * `workspace-write`, and `ps` sees the session. `danger-full-access` gets the
 * scope but no mounts.
 *
 * Nothing in this module touches `wsl.exe` by default except through the
 * injectable factories; `test/session-runtime.test.mjs` drives the refcount,
 * the prefix composition and the stop ordering without systemd.
 *
 * This is a TypeScript source built to `lib/session-runtime.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/session-runtime
 */
import { WslAgent } from "./agent.js";
/**
 * Run the session runtime's preflight through an injected host runner and map
 * the answer to a refusal. Shared by the shell executor and the filesystem
 * provider, so both gate the runtime on the same four requirements.
 *
 * @param options - the transport, distro and runner.
 * @returns the remedy-bearing refusal, or null when the platform is usable.
 */
export declare function probeSessionRuntime({ wslPath, distro, run }: {
    /** The `wsl.exe` path. */
    wslPath: string;
    /** The distro name. */
    distro: string;
    /** The host runner; throws when the probe could not run. */
    run: (argv: string[]) => Promise<string>;
}): Promise<string | null>;
/** One request for a session runtime. */
interface SessionRuntimeRequest {
    /** The session identity; absent requests each get a separate runtime. */
    sessionId?: string;
    /** The distro the runtime lives in. */
    distro: string;
    /** The `wsl.exe` path; defaults to `wsl.exe`. */
    wslPath?: string;
    /** The session workspace root, in any coordinate system. */
    workspaceRoot: string;
    /** The resolved file-effect mode (`read-only`, `workspace-write`, `danger-full-access`). */
    mode: string;
    /** Shadow `/mnt` in the runtime's mount profile. */
    maskWindowsDrive?: boolean;
    /**
     * Extra Linux roots to bind read-write in the runtime's profile. The
     * providers resolved, filtered and checked them; they are part of the key
     * because the mount table is fixed for the runtime's lifetime.
     */
    writableRoots?: readonly string[];
    /**
     * Existing socket paths the runtime's bwrap profile masks: the user systemd
     * manager's sockets and, for `strict`, the system bus and container
     * sockets. Resolved by the provider (`lib/socket-isolation.js`); part of
     * the key because the mount table is fixed for the runtime's lifetime.
     */
    socketMasks?: readonly string[];
    /** Shadow `/run/WSL`, the WSL interop transport, inside the runtime. */
    maskInterop?: boolean;
    /** The agent's client lease; 0 disables. */
    leaseMs?: number;
}
/** One live runtime and its refcount. */
export interface SessionRuntimeEntry {
    /** The registry key (`distro`, workspace, mode, mask). */
    key: string;
    /** The bare systemd unit name the scope was started with; the `.scope` suffix is systemd's to add. */
    unit: string;
    /** The resident agent. */
    agent: WslAgent;
    /** The distro, for the stop command. */
    distro: string;
    /** The `wsl.exe` path, for the stop command. */
    wslPath: string;
    /** How many providers hold the runtime. */
    refs: number;
    /**
     * The session the runtime belongs to, as the key's first component spells
     * it. A caller with no session identity supplies a token of its own, which
     * no `agent/disposed` ever names.
     */
    sessionId: string;
}
/** The injectable edges, so the registry is testable without systemd. */
interface SessionRuntimeOptions {
    /** Create the agent; tests substitute a fake. */
    spawnAgent?: (options: {
        /** The distro. */
        distro: string;
        /** The `wsl.exe` path. */
        wslPath: string;
        /** The scope + mount prefix. */
        argvPrefix: string[];
        /** No idle close: the runtime lives for the session. */
        idleMs: number;
        /** The explicit client lease. */
        leaseMs: number;
        /** The prefix has no PID namespace, so USR1 can reach the agent. */
        signalable: boolean;
    }) => WslAgent;
    /** Stop the scope; tests record it. */
    stopScope?: (options: {
        wslPath: string;
        distro: string;
        unit: string;
    }) => void;
    /** The unique token in the unit name; tests pin it. */
    token?: () => string;
}
/**
 * Set (or clear) the native binary the session runtime should spawn for one
 * distro. The host calls this after the copy/verify step; an empty path
 * clears it and restores the shell agent.
 *
 * @param distro - the distro.
 * @param path - the Linux binary path, or empty to clear.
 * @param digest - the binary's sha256, which the HELLO must present.
 */
export declare function setSessionNativeAgent(distro: string, path: string, digest?: string): void;
/**
 * The refcounted registry. One instance lives for the process; providers share
 * it so the shell and filesystem sides address the same runtime for a session.
 */
export declare class SessionRuntimes {
    /** The live runtimes, by key. */
    private readonly runtimes;
    /** The agent factory. */
    private readonly spawnAgent;
    /** The scope stopper. */
    private readonly stopScope;
    /** The unit-token generator. */
    private readonly token;
    /**
     * @param options - the injectable edges; production passes none.
     */
    constructor(options?: SessionRuntimeOptions);
    /**
     * The key a request addresses: session, distro, workspace, mode and mask. A policy
     * change is a different runtime, because the mount profile is fixed for the
     * agent's lifetime.
     *
     * @param request - the runtime request.
     * @returns the registry key.
     */
    static key(request: Pick<SessionRuntimeRequest, "distro" | "workspaceRoot" | "mode" | "maskWindowsDrive" | "sessionId" | "writableRoots" | "socketMasks" | "maskInterop">): string;
    /**
     * Acquire the runtime for one key, creating it on first use.
     *
     * @param request - the runtime request.
     * @returns the live entry; the caller holds one reference.
     */
    acquire(request: SessionRuntimeRequest): SessionRuntimeEntry;
    /**
     * Release one reference. The last release closes the agent and stops the
     * scope, in that order: the agent's exit ends the protocol, the stop reaps
     * whatever the session left running.
     *
     * @param key - the entry's key.
     * @returns resolved once the last holder's teardown finished.
     */
    release(key: string): Promise<void>;
    /**
     * Whether the registry still keeps THIS entry. A holder caches the entry it
     * acquired; a session end tears the entry down whatever references remain,
     * so a holder that did not drop its cache itself asks here before reusing
     * it — a closed agent must never be handed out as a live runtime.
     *
     * @param entry - the entry the holder cached.
     * @returns true while the registry tracks that exact entry.
     */
    holds(entry: SessionRuntimeEntry): boolean;
    /**
     * End one session. Every runtime it named is torn down regardless of its
     * reference count: the session is over, and a reference nobody will release
     * again is not a reason to keep a scope. Holders drop their own books on the
     * same event; a holder that did not notices through {@link
     * SessionRuntimes.holds}. Idempotent: a second call finds nothing.
     *
     * @param sessionId - the session that ended.
     * @returns resolved once every runtime of the session is torn down.
     */
    releaseSession(sessionId: string): Promise<void>;
    /**
     * Tear one runtime down: close the agent, then stop the scope.
     *
     * @param entry - the runtime, already removed from the map.
     */
    private teardown;
    /**
     * Release every runtime, for a host shutdown or a test. Sequential on
     * purpose: concurrent closes would race the shared agent's state.
     *
     * @returns resolved once every runtime is torn down.
     */
    disposeAll(): Promise<void>;
}
/** The process-wide registry the providers will share. */
export declare const sessionRuntimes: SessionRuntimes;
export {};
