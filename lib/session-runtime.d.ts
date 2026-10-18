/**
 * The session-scoped runtime registry (ADR 0001).
 *
 * One long-lived agent per `(distro, workspaceRoot, policy)`, shared by the
 * providers that need it and refcounted: the first `acquire` spawns the agent
 * inside a systemd user scope, the last `release` closes the agent and stops
 * the scope (the cgroup then reaps any background dev server a command left
 * behind). The agent runs with no idle close — its lifetime is the session's —
 * but an explicit client lease still catches a wedged host.
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
 * @module dsh-plugin-wsl/session-runtime
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
export interface SessionRuntimeRequest {
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
    /** The agent's client lease; 0 disables. */
    leaseMs?: number;
}
/** One live runtime and its refcount. */
export interface SessionRuntimeEntry {
    /** The registry key (`distro`, workspace, mode, mask). */
    key: string;
    /** The systemd user unit name. */
    unit: string;
    /** The resident agent. */
    agent: WslAgent;
    /** The distro, for the stop command. */
    distro: string;
    /** The `wsl.exe` path, for the stop command. */
    wslPath: string;
    /** How many providers hold the runtime. */
    refs: number;
}
/** The injectable edges, so the registry is testable without systemd. */
export interface SessionRuntimeOptions {
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
     * The key a request addresses: distro, workspace, mode and mask. A policy
     * change is a different runtime, because the mount profile is fixed for the
     * agent's lifetime.
     *
     * @param request - the runtime request.
     * @returns the registry key.
     */
    static key(request: Pick<SessionRuntimeRequest, "distro" | "workspaceRoot" | "mode" | "maskWindowsDrive">): string;
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
     * Release every runtime, for a host shutdown or a test. Sequential on
     * purpose: concurrent closes would race the shared agent's state.
     *
     * @returns resolved once every runtime is torn down.
     */
    disposeAll(): Promise<void>;
}
/** The process-wide registry the providers will share. */
export declare const sessionRuntimes: SessionRuntimes;
