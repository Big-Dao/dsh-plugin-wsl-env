/**
 * Host side of the resident in-distro agent.
 *
 * One {@link WslAgent} instance owns one long-lived `wsl.exe` process per
 * distro. The lifetime rules, in order of importance:
 *
 * 1. **Correctness before speed.** Any agent failure is answered by at most
 *    one rebuild; the requests that were in flight ride it ONLY when their
 *    first execution provably changed nothing (the read-only FS ops). A
 *    command or a write that was in flight has UNKNOWN state — replaying it
 *    would run non-idempotent work twice or report a create that actually
 *    succeeded as a refusal — so it fails instead, and the caller re-reads
 *    before retrying. A second failure marks the agent permanently dead and
 *    every future call rejects with {@link AgentUnavailableError} — the
 *    executor's cue to fall back to the one-shot `wsl.exe` path it shipped
 *    with, so the worst case of the agent is "today's behaviour, plus one
 *    failed round trip".
 * 2. **The in-distro timeout is the real one.** The EXEC frame carries the
 *    timeout in whole seconds and the agent SIGTERMs the child itself, so a
 *    timed-out command dies where it lives instead of leaving an orphan
 *    behind a dead `wsl.exe`. The host-side watchdog is armed on the agent's
 *    `ACK` — the dequeue signal — so it measures EXECUTION, never the queue
 *    wait: a short-budget request queued behind a long one can no longer
 *    kill the shared transport for a stall that was never its own. It still
 *    catches an agent that accepted a request and then stopped answering at
 *    all.
 * 3. **Idle agents go away.** `idleMs` after the last exchange the process is
 *    killed; the next call starts a fresh one. WSL VMs are shared, but every
 *    process is a promise someone has to keep.
 *
 * The transport is injectable so the lifecycle and the fallback decision are
 * unit-testable without a distro.
 *
 * This is a TypeScript source built to `lib/agent.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/agent
 */
import type { ChildProcess } from "node:child_process";
/** One settled command result, as `exec` resolves it. */
export interface ExecResult {
    /** The command's exit status. */
    exitCode: number;
    /** Captured stdout. */
    stdout: Buffer;
    /** Captured stderr. */
    stderr: Buffer;
    /** Which streams the capture cap cut. */
    truncated: {
        stdout: boolean;
        stderr: boolean;
    };
}
/**
 * One request in flight on an agent: its frame, its settlement callbacks, and
 * the ACK-armed watchdog.
 */
export interface PendingRequest {
    /** The request id, as the agent echoes it. */
    id: string;
    /** The frame lines (kept so a rebuild can re-send). */
    lines: string[];
    /** Settles a RES. */
    resolve: (result: ExecResult) => void;
    /** Settles a failure. */
    reject: (error: Error) => void;
    /** The ACK-armed watchdog timer. */
    watchdog: NodeJS.Timeout | null;
    /** The caller's cancellation, when any. */
    signal: AbortSignal | null;
    /** The abort listener, for removal. */
    onAbort: (() => void) | null;
    /** Arms `watchdog`; null when the request carries no timeout. */
    armWatchdog: (() => void) | null;
}
/**
 * The Windows environment the transport starts from, pinned.
 *
 * Spawned bare, `wsl.exe` would inherit this process's whole environment — and
 * the `WSLENV` variable riding along decides which of those names are
 * FORWARDED into the distro, where every model command inherits them. Dev
 * machines routinely route secrets that way (`WSLENV=GITHUB_TOKEN/u` is the
 * documented example), so the resident's env is built from scratch instead:
 * the Windows essentials `wsl.exe` itself needs, the managed `DSH_*` facts,
 * and a `WSLENV` that names only those managed entries — preserving their
 * original forwarding flags. Nothing else on the Windows side can reach a
 * model command.
 *
 * Deliberately NOT here: the executor's `forwardEnv` names. They ride the
 * one-shot path's WSLENV (`spawnSpec` builds it per call); the resident path
 * has never forwarded them, and this pin keeps that posture instead of
 * widening it silently.
 *
 * @param parent - this process's environment.
 * @returns the pinned environment for `wsl.exe`.
 */
export declare function pinnedWindowsEnv(parent: Record<string, string | undefined>): Record<string, string>;
/**
 * The spawn environment for one resident, with the client lease folded in.
 * The pinned environment forwards only the managed `DSH_` namespace, and it
 * forwards exactly the names the parent `WSLENV` lists — so the lease rides
 * both: the value on the variable, the name on `WSLENV`. A non-positive
 * lease leaves the environment as the pin built it (the script treats an
 * unset variable as no lease).
 *
 * @param env - the pinned environment.
 * @param leaseMs - the agent's client lease in ms; 0 disables.
 * @returns the environment to spawn with.
 */
export declare function agentLeaseEnv(env: Record<string, string>, leaseMs: number): Record<string, string>;
/** The resident agent for one distro. */
export declare class WslAgent {
    /** The distro this agent serves. */
    distro: string;
    /** The agent script as a Linux path inside the distro (see {@link spawnDefault}). */
    scriptPath: string;
    /** The `wsl.exe` path. */
    wslPath: string;
    /** Arguments between `wsl.exe --exec` and the `sh script` pair. */
    argvPrefix: string[];
    /** Idle shutdown delay; 0 disables. */
    idleMs: number;
    /** The sha256 of the agent script as this package shipped it. */
    expectedDigest: string | undefined;
    /**
     * Hard ceiling on one stdout protocol line; a longer line is a broken or
     * hostile agent, not data to hold — readline used to accumulate it all.
     */
    frameCapBytes: number;
    /** The injectable process factory, when the caller supplied one. */
    configuredSpawn: ((options: {
        wslPath: string;
        distro: string;
        scriptPath: string;
        argvPrefix: string[];
    }) => ChildProcess) | undefined;
    /** The live resident process, when any. */
    process: ChildProcess | null;
    /** The lifecycle state. */
    state: "idle" | "starting" | "ready" | "dead";
    /** The in-flight start, shared by concurrent callers. */
    startPromise: Promise<void> | null;
    /** The next request id. */
    nextRequestId: number;
    /** The requests in flight, keyed by their current id. */
    pending: Map<string, PendingRequest>;
    /** Whether the one permitted rebuild has been spent. */
    rebuildUsed: boolean;
    /** The idle-shutdown timer. */
    idleTimer: NodeJS.Timeout | null;
    /** The last failure, for `unavailableReason` and log messages. */
    lastError: string;
    /**
     * @param config - the agent configuration.
     */
    constructor(config: {
        /** The distro this agent serves. */
        distro: string;
        /**
         * The agent script as a Linux path inside the distro (see
         * {@link spawnDefault}).
         */
        scriptPath: string;
        /** The `wsl.exe` path. */
        wslPath?: string;
        /** Idle shutdown delay; 0 disables. */
        idleMs?: number;
        /**
         * The sha256 of the agent script as this package shipped it; a HELLO whose
         * digest differs is refused the same way a version mismatch is (the script
         * is read in place, so a stale or half-synced runtime copy is the failure
         * this catches).
         */
        expectedDigest?: string;
        /**
         * Arguments inserted between `wsl.exe --exec` and the `sh script` pair —
         * the confinement wrapper (`bwrap … --`) a confined agent runs its whole
         * lifetime under, so every filesystem op it performs is kernel-enforced.
         * Empty for the plain agent.
         */
        argvPrefix?: string[];
        /** Hard ceiling in bytes on one stdout protocol line; defaults to {@link MAX_FRAME_BYTES}. */
        frameCapBytes?: number;
        /** Injectable process factory for tests. */
        spawnTransport?: (options: {
            wslPath: string;
            distro: string;
            scriptPath: string;
            argvPrefix: string[];
        }) => ChildProcess;
    });
    /**
     * Whether the agent is permanently out — the executor's fallback cue.
     *
     * @returns true once the rebuild budget is spent.
     */
    get unavailable(): boolean;
    /** Human-readable reason for the last transition to `dead`, for logging. */
    get unavailableReason(): string;
    /**
     * Start the process and wait for the handshake. Re-entrant: concurrent
     * callers share the one start.
     *
     * @returns resolved once the state is `ready`.
     */
    start(): Promise<void>;
    /**
     * One stdout line from the agent. The first must be a matching HELLO.
     *
     * @param line - one protocol line, terminator stripped.
     * @param settleStart - the handshake settler.
     * @param handshakeTimer - the handshake watchdog.
     */
    private handleLine;
    /**
     * The process died. Requests in flight ride exactly one rebuild; a second
     * death is permanent.
     *
     * @param code - the exit code, null when killed by a signal.
     * @param signalName - the killing signal, null on a normal exit.
     */
    private handleProcessExit;
    /**
     * Register one request's pending entry and write its frame: the shared
     * request machinery (abort, submission, the ACK-armed watchdog). The
     * watchdog is deliberately NOT armed here — it starts at the agent's
     * dequeue `ACK`, so time spent queued behind an earlier request never
     * spends this request's budget and never kills the shared transport for a
     * stall that was not its own.
     *
     * @param request - the request to register.
     */
    private track;
    /**
     * Run one command inside the distro through the agent.
     *
     * @param request - the execution request.
     * @returns the settled result.
     * @throws {AgentUnavailableError} when the agent is out for this process.
     */
    exec({ cwd, argv, timeoutMs, maxOutputBytes, env, signal }: {
        /** Linux path to run in. */
        cwd: string;
        /** The argv, already bwrap-wrapped when the caller confines. */
        argv: string[];
        /**
         * In-distro timeout, whole seconds upward, measured from the agent's
         * dequeue ACK; `<= 0` or omitted means none. Queue time ahead of the
         * dispatch is never counted.
         */
        timeoutMs?: number;
        /**
         * Extra environment for this request only; values lose trailing newlines
         * (protocol limitation).
         */
        env?: Record<string, string>;
        /**
         * Per-stream capture ceiling the agent enforces (carried on the EXEC
         * frame); the RES line reports which streams were cut. 0 (the default)
         * keeps the unbounded capture.
         */
        maxOutputBytes?: number;
        /** Cancels the request (KILL + reject). */
        signal?: AbortSignal;
    }): Promise<{
        exitCode: number;
        stdout: Buffer;
        stderr: Buffer;
        truncated: {
            stdout: boolean;
            stderr: boolean;
        };
    }>;
    /**
     * Run one filesystem-substrate op inside the distro through the agent.
     * Responses reuse the EXEC `ACK`/`RES` lines, so cancellation and the
     * watchdog are exactly the command path's. The rebuild relay differs by op:
     * a read-only op rides a rebuild, a `write` in flight fails with an
     * unknown-state error instead of being replayed.
     *
     * @param request - the filesystem request.
     * @returns the settled result.
     * @throws {AgentUnavailableError} when the agent is out for this process.
     */
    fs({ op, args, timeoutMs, signal }: {
        /**
         * Op name (`stat`, `lstat`, `list`, `realpath`, `read`, `write`),
         * dispatched by `agent/wsl-agent.sh`.
         */
        op: string;
        /** Op arguments; each rides one base64 line. */
        args: string[];
        /**
         * In-distro timeout, whole seconds upward, measured from the agent's
         * dequeue ACK; `<= 0` or omitted means none.
         */
        timeoutMs?: number;
        /** Cancels the request (KILL + reject). */
        signal?: AbortSignal;
    }): Promise<{
        exitCode: number;
        stdout: Buffer;
        stderr: Buffer;
    }>;
    /**
     * Liveness probe, also used to warm the agent up.
     *
     * @param signal - cancels the wait.
     * @returns resolved on PONG.
     */
    ping(signal?: AbortSignal): Promise<void>;
    /**
     * Shut the agent down: SHUTDOWN first, then kill after a short grace. The
     * agent becomes reusable — a later `exec` starts a fresh process.
     *
     * @returns resolved once the process is gone.
     */
    close(): Promise<void>;
    /**
     * Write one frame to the live process.
     *
     * @param lines - the frame lines to write.
     * @returns whether the frame was written.
     */
    private writeLines;
    /**
     * Write one frame to a specific process, tolerating a dead pipe.
     *
     * @param child - the process being shut down.
     * @param lines - the lines to write.
     */
    private writeLinesSafe;
    /** Restart the idle-shutdown countdown. */
    private rearmIdleTimer;
    /**
     * Detach an entry's timer and abort listener.
     *
     * @param pending - the entry to clear.
     */
    private clearPending;
}
/**
 * Rewrite the request id inside a stored frame so a resent request does not
 * collide with ids the new process has already seen. SETENV lines pass
 * through unchanged (they are id-less and idempotent).
 *
 * @param lines - the stored frame.
 * @param newId - the new request id.
 * @returns the relabelled frame.
 */
export declare function relabelFrame(lines: string[], newId: string): string[];
export default WslAgent;
