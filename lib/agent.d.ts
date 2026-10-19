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
 *    before retrying. A failure that spends the rebuild leaves the agent
 *    `dead` with a bounded revival: the next call after a 2/4/8-second backoff
 *    gets a fresh transport and its own single rebuild; after three deaths the
 *    state is permanent and every call rejects with a restart remedy. While
 *    dead, calls reject with {@link AgentUnavailableError} — the executor's cue
 *    to fall back to the one-shot `wsl.exe` path it shipped with, so the worst
 *    case of the agent is "today's behaviour, plus one failed round trip".
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
    /** The request's numeric sequence; newer requests have a larger one. */
    seq: number;
    /** Which metric bucket this request belongs to. */
    kind: "fs" | "exec";
    /** When the frame was written, for the queue measurement. */
    sentAt: number;
    /** When the agent ACKed it, for the execution measurement. */
    ackedAt?: number;
    /** Whether the metrics recorded this request's settle. */
    measured: boolean;
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
    /** Whether the agent has ACKed this request (it is the running one). */
    started: boolean;
    /** The caller cancelled it; the entry stays until the agent answers. */
    cancelled: boolean;
    /** The caller was already settled; a late answer only cleans up. */
    settled: boolean;
    /** Whether the agent has answered (RES or ERR); a late signal is then unsafe. */
    answered: boolean;
    /** The delayed cancel signal, so it can be dropped when the request settles. */
    signalTimer: NodeJS.Timeout | null;
}
/** Per-kind request metrics. */
export interface RequestMetrics {
    /** Requests that settled (successful, failed or cancelled). */
    requests: number;
    /** Total queue wait (sent -> ACK), ms. */
    queueMs: number;
    /** Largest single queue wait, ms. */
    queueMaxMs: number;
    /** Total execution time (ACK -> settle), ms. */
    execMs: number;
    /** Largest single execution time, ms. */
    execMaxMs: number;
    /** Settled with an error (not cancellation). */
    failed: number;
    /** Cancelled by the caller. */
    cancelled: number;
    /** Rejected before tracking: queue full, already aborted, or send failed. */
    rejected: number;
}
/** A read-only snapshot of the resident's lifecycle, for diagnostics. */
export interface AgentStatus {
    /** The distro served. */
    distro: string;
    /** Lifecycle state. */
    state: "idle" | "starting" | "ready" | "dead";
    /** The HELLO pid, when one is known and addressable. */
    pid: number | undefined;
    /** The last failure, if any. */
    lastError: string;
    /** Deaths observed; the revival budget is spent after {@link MAX_REVIVALS}. */
    deaths: number;
    /** Requests currently in flight. */
    pending: number;
}
/** The agent's cumulative request metrics. */
export interface AgentMetrics {
    /** FS frames. */
    fs: RequestMetrics;
    /** EXEC frames (commands, ping). */
    exec: RequestMetrics;
    /** Peak number of pending requests. */
    inFlightMax: number;
}
/** The entry an async preparation may select before the first spawn. */
export interface WslAgentPrepared {
    /** The agent entrypoint (the shell script or the native cache path). */
    scriptPath: string;
    /** The HELLO digest to verify. */
    expectedDigest?: string;
    /** Whether USR1 can reach the agent (false for the native KILL-frame path). */
    signalable?: boolean;
    /** The process factory for this entry. */
    spawnTransport?: (options: {
        wslPath: string;
        distro: string;
        scriptPath: string;
        argvPrefix: string[];
        leaseMs: number;
    }) => ChildProcess;
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
        leaseMs: number;
    }) => ChildProcess) | undefined;
    /** The explicit lease, when the caller supplied one (independent of idleMs). */
    configuredLease: number | undefined;
    /** The injectable signal sender, when the caller supplied one. */
    configuredSignal: ((options: {
        wslPath: string;
        distro: string;
        pid: number;
        signal: NodeJS.Signals;
    }) => void) | undefined;
    /** The agent shell's PID from its HELLO, when a second wsl.exe can address it. */
    agentPid: number | undefined;
    /**
     * Whether a second `wsl.exe` can deliver `USR1` to the agent's HELLO pid.
     * True for the plain agent; false for a resident inside a PID namespace. A
     * session runtime has a prefix (scope + mounts) but no PID namespace, so it
     * opts in explicitly.
     */
    signalable: boolean;
    /** The maximum requests allowed in flight on this resident. */
    maxPending: number;
    /** The live resident process, when any. */
    process: ChildProcess | null;
    /** The lifecycle state. */
    state: "idle" | "starting" | "ready" | "dead";
    /** The in-flight start, shared by concurrent callers. */
    startPromise: Promise<void> | null;
    /** The in-flight start's settler, so close() can fail a start it interrupts. */
    startSettler: ((error?: unknown) => void) | null;
    /** The next request id. */
    nextRequestId: number;
    /** The requests in flight, keyed by their current id. */
    pending: Map<string, PendingRequest>;
    /** The newest request the agent has ACKed; a cancel older than this is stale. */
    lastAckedSeq: number;
    /** Whether the one permitted rebuild has been spent. */
    rebuildUsed: boolean;
    /** Deaths observed; each one past the first consumes the revival budget. */
    deaths: number;
    /** When the next revival may start, epoch ms; 0 when not waiting. */
    deadUntil: number;
    /** The first revival delay; tests shorten it. */
    revivalBackoffMs: number;
    /** The idle-shutdown timer. */
    idleTimer: NodeJS.Timeout | null;
    /** The last failure, for `unavailableReason` and log messages. */
    lastError: string;
    /** Cumulative request metrics; see {@link metrics}. */
    requestMetrics: AgentMetrics;
    /** The optional async preparation hook. */
    prepare: (() => Promise<WslAgentPrepared | undefined>) | undefined;
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
         * The client lease in ms, independent of `idleMs`. A session runtime holds
         * the agent for the session's lifetime (no idle close) but still wants the
         * lease's last-resort self-termination; a positive value here overrides the
         * idle-derived lease.
         */
        leaseMs?: number;
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
        /**
         * Whether a second `wsl.exe` can signal the agent's pid. Defaults to
         * "true when the argv prefix is empty": the plain agent shares the distro's
         * PID namespace, a confined resident does not, and a session runtime has a
         * prefix but no PID namespace and must opt in.
         */
        signalable?: boolean;
        /** Hard ceiling in bytes on one stdout protocol line; defaults to {@link MAX_FRAME_BYTES}. */
        frameCapBytes?: number;
        /** Injectable process factory for tests. */
        spawnTransport?: (options: {
            wslPath: string;
            distro: string;
            scriptPath: string;
            argvPrefix: string[];
            leaseMs: number;
        }) => ChildProcess;
        /**
         * Injectable out-of-band signal delivery for tests. The real path spawns a
         * second `wsl.exe` to send USR1 to the agent's PID.
         */
        signalTransport?: (options: {
            wslPath: string;
            distro: string;
            pid: number;
            signal: NodeJS.Signals;
        }) => void;
        /**
         * Maximum requests in flight on one resident; a submission past it is
         * refused instead of growing the request map without bound.
         */
        maxPending?: number;
        /** Optional async preparation selecting the entry before the first spawn. */
        prepare?: () => Promise<WslAgentPrepared | undefined>;
        /** The first revival delay in ms; doubles per death. Tests shorten it. */
        revivalBackoffMs?: number;
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
     * Enter the dead state and schedule the next bounded revival attempt.
     *
     * The delay doubles per death (2 s, 4 s, 8 s, … capped at 30 s). After
     * {@link MAX_REVIVALS} deaths the state stays permanent and the refusal
     * carries the restart remedy.
     */
    markDead(): void;
    /**
     * A read-only lifecycle snapshot for diagnostics. Includes the live pid, the
     * last failure and the remaining revival budget; it never starts or stops
     * anything.
     *
     * @returns the status snapshot.
     */
    status(): AgentStatus;
    /**
     * Start the process and wait for the handshake. Re-entrant: concurrent
     * callers share the one start.
     *
     * @returns resolved once the state is `ready`.
     */
    start(): Promise<void>;
    /**
     * Apply an async preparation entry to this agent before the first spawn.
     *
     * @param entry - the selected entry.
     */
    private applyPrepared;
    /**
     * Spawn the process and run the handshake.
     *
     * @returns resolved once the state is `ready`.
     */
    private beginStart;
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
     * @param child - the process that exited.
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
     * Deliver an out-of-band signal to the resident shell. The serial stdin loop
     * cannot consume a frame while a command runs, so cancellation is a signal;
     * a second `wsl.exe` is the only channel that reaches the agent while it is
     * blocked in `wait`.
     *
     * Only an agent that shares the distro's PID namespace is addressable: the
     * plain agent, or a session runtime (its prefix is a scope plus mounts, but
     * no PID namespace). A confined resident runs inside a PID namespace whose
     * PIDs do not exist in the distro, so signalling its HELLO PID could hit an
     * unrelated process; there the KILL frame remains the (delayed) fallback.
     *
     * @param signal - the signal to deliver (`SIGUSR1` is the cancel trap).
     */
    /**
     * The cumulative request metrics: queue wait (sent -> ACK) and execution
     * time (ACK -> settle) per request kind, plus the peak in-flight count.
     *
     * @returns a snapshot the caller can keep.
     */
    metrics(): AgentMetrics;
    /** Reset the cumulative metrics (diagnostics/probes). */
    resetMetrics(): void;
    /**
     * The metric bucket for a request kind.
     * @param kind - fs or exec.
     * @returns the bucket.
     */
    private kindMetrics;
    /**
     * Record a request that never entered the pending map.
     * @param kind - the bucket.
     */
    private noteRejected;
    /**
     * Record the dequeue ACK: the request's queue wait.
     * @param pending - the request.
     */
    private recordAck;
    /**
     * Record a settle: the requests count, the execution time (or the queue wait
     * for a request that never ACKed), and the outcome.
     * @param pending - the request.
     * @param error - the failure, when any.
     */
    private recordSettle;
    private signalAgent;
    /**
     * Shut the agent down: SHUTDOWN first, then kill after a short grace. The
     * agent becomes reusable — a later `exec` starts a fresh process.
     *
     * @returns resolved once the process is gone.
     */
    close(): Promise<void>;
    /**
     * Release the host's ends of a dead child's stdio. A descendant that
     * inherited a pipe's write end would otherwise keep the read side — and the
     * fd — open until that descendant exits; the agent's own helpers are
     * redirected at their spawn sites, but the host must not depend on it.
     *
     * @param child - the process whose streams are being released.
     */
    private teardownStreams;
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
    /**
     * Deliver the out-of-band cancel signal after a short grace, and only while
     * the request it was meant for is still the agent's current one.
     *
     * The signal has no request id: it interrupts whatever command the agent is
     * blocked in. A timeout request is usually already being killed by the
     * in-distro watcher, so an immediate signal can land after the agent moved
     * on — the next request then dies with exit 138 (SIGUSR1) and looks
     * `completed`. A newer ACK means the agent has answered the old request, so
     * the signal is dropped; an answered request is dropped too.
     *
     * @param pending - the cancelled request.
     */
    private armCancelSignal;
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
