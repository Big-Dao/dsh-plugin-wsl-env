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
 * @param {Record<string, string|undefined>} parent - this process's environment.
 * @returns {Record<string, string>} the pinned environment for `wsl.exe`.
 */
export function pinnedWindowsEnv(parent: Record<string, string | undefined>): Record<string, string>;
/**
 * @param {object} options - the spawn options.
 * @param {string} options.wslPath - the `wsl.exe` path.
 * @param {string} options.distro - the distro name.
 * @param {string} options.scriptPath - the agent script as a Linux path inside
 *   the distro (a `/mnt/<drive>/...` translation of the package's
 *   `agent/wsl-agent.sh`).
 * @param {number} [options.leaseMs] - the agent's own client lease, forwarded
 *   through the managed `DSH_` namespace so the script can self-terminate
 *   when a wedged relay stops carrying traffic without ever delivering EOF.
 * @returns {import("node:child_process").ChildProcess} the spawned process.
 */
/**
 * The spawn environment for one resident, with the client lease folded in.
 * The pinned environment forwards only the managed `DSH_` namespace, and it
 * forwards exactly the names the parent `WSLENV` lists — so the lease rides
 * both: the value on the variable, the name on `WSLENV`. A non-positive
 * lease leaves the environment as the pin built it (the script treats an
 * unset variable as no lease).
 * @param {Record<string, string>} env - the pinned environment.
 * @param {number} leaseMs - the agent's client lease in ms; 0 disables.
 * @returns {Record<string, string>} the environment to spawn with.
 */
export function agentLeaseEnv(env: Record<string, string>, leaseMs: number): Record<string, string>;
/**
 * Rewrite the request id inside a stored frame so a resent request does not
 * collide with ids the new process has already seen. SETENV lines pass
 * through unchanged (they are id-less and idempotent).
 * @param {string[]} lines - the stored frame.
 * @param {string} newId - the new request id.
 * @returns {string[]} the relabelled frame.
 */
export function relabelFrame(lines: string[], newId: string): string[];
/**
 * The resident agent for one distro.
 */
export class WslAgent {
    /**
     * @param {object} config - the agent configuration.
     * @param {string} config.distro - the distro this agent serves.
     * @param {string} config.scriptPath - the agent script as a Linux path
     *   inside the distro (see {@link spawnDefault}).
   * @param {string} [config.wslPath] - the `wsl.exe` path.
   * @param {number} [config.idleMs] - idle shutdown delay; 0 disables.
   * @param {string} [config.expectedDigest] - the sha256 of the agent script
   *   as this package shipped it; a HELLO whose digest differs is refused the
   *   same way a version mismatch is (the script is read in place, so a stale
   *   or half-synced runtime copy is the failure this catches).
   * @param {string[]} [config.argvPrefix] - arguments inserted between
     *   `wsl.exe --exec` and the `sh script` pair — the confinement wrapper
     *   (`bwrap … --`) a confined agent runs its whole lifetime under, so every
     *   filesystem op it performs is kernel-enforced. Empty for the plain agent.
   * @param {number} [config.frameCapBytes] - hard ceiling in bytes on one stdout
   *   protocol line; defaults to {@link MAX_FRAME_BYTES}.
   * @param {(options: {wslPath: string, distro: string, scriptPath: string, argvPrefix: string[]}) => import("node:child_process").ChildProcess} [config.spawnTransport]
     *   injectable process factory for tests.
     */
    constructor(config: {
        distro: string;
        scriptPath: string;
        wslPath?: string | undefined;
        idleMs?: number | undefined;
        expectedDigest?: string | undefined;
        argvPrefix?: string[] | undefined;
        frameCapBytes?: number | undefined;
        spawnTransport?: ((options: {
            wslPath: string;
            distro: string;
            scriptPath: string;
            argvPrefix: string[];
        }) => import("node:child_process").ChildProcess) | undefined;
    });
    distro: string;
    scriptPath: string;
    wslPath: string;
    argvPrefix: string[];
    idleMs: number;
    expectedDigest: string | undefined;
    /** Hard ceiling on one stdout protocol line; a longer line is a broken or
     * hostile agent, not data to hold — readline used to accumulate it all. */
    frameCapBytes: number;
    configuredSpawn: ((options: {
        wslPath: string;
        distro: string;
        scriptPath: string;
        argvPrefix: string[];
    }) => import("node:child_process").ChildProcess) | undefined;
    /** @type {import("node:child_process").ChildProcess|null} */
    process: import("node:child_process").ChildProcess | null;
    /** @type {"idle"|"starting"|"ready"|"dead"} */
    state: "idle" | "starting" | "ready" | "dead";
    /** @type {Promise<void>|null} */
    startPromise: Promise<void> | null;
    nextRequestId: number;
    /** @type {Map<string, PendingRequest>} */
    pending: Map<string, PendingRequest>;
    rebuildUsed: boolean;
    /** @type {NodeJS.Timeout|null} */
    idleTimer: NodeJS.Timeout | null;
    lastError: string;
    /**
     * Whether the agent is permanently out — the executor's fallback cue.
     * @returns {boolean}
     */
    get unavailable(): boolean;
    /** Human-readable reason for the last transition to `dead`, for logging. */
    get unavailableReason(): string;
    /**
     * Start the process and wait for the handshake. Re-entrant: concurrent
     * callers share the one start.
     * @returns {Promise<void>} resolved once the state is `ready`.
     */
    start(): Promise<void>;
    /**
     * One stdout line from the agent. The first must be a matching HELLO.
     * @param {string} line - one protocol line, terminator stripped.
     * @param {(error?: unknown) => void} settleStart - the handshake settler.
     * @param {NodeJS.Timeout} handshakeTimer - the handshake watchdog.
     * @private
     */
    private handleLine;
    /**
     * The process died. Requests in flight ride exactly one rebuild; a second
     * death is permanent.
     * @param {number | null} code - the exit code, null when killed by a signal.
     * @param {NodeJS.Signals | null} signalName - the killing signal, null on a
     *   normal exit.
     * @private
     */
    private handleProcessExit;
    /**
     * Register one request's pending entry and write its frame: the shared
     * request machinery (abort, submission, the ACK-armed watchdog). The
     * watchdog is deliberately NOT armed here — it starts at the agent's
     * dequeue `ACK`, so time spent queued behind an earlier request never
     * spends this request's budget and never kills the shared transport for a
     * stall that was not its own.
     * @param {object} request - the request to register.
     * @param {string} request.id - the request's id.
     * @param {string[]} request.lines - the frame lines to write.
     * @param {(result: ExecResult) => void} request.resolve - settles a RES.
     * @param {(error: Error) => void} request.reject - settles a failure.
     * @param {number} request.timeoutMs - the in-distro timeout in ms; 0 means none.
     * @param {AbortSignal} [request.signal] - the caller's cancellation.
     * @private
     */
    private track;
    /**
     * Run one command inside the distro through the agent.
     * @param {object} request - the execution request.
     * @param {string} request.cwd - Linux path to run in.
     * @param {string[]} request.argv - the argv, already bwrap-wrapped when the
     *   caller confines.
     * @param {number} [request.timeoutMs] - in-distro timeout, whole seconds
     *   upward, measured from the agent's dequeue ACK; `<= 0` or omitted means
     *   none. Queue time ahead of the dispatch is never counted.
     * @param {Record<string, string>} [request.env] - extra environment for this
     *   request only; values lose trailing newlines (protocol limitation).
     * @param {number} [request.maxOutputBytes] - per-stream capture ceiling the
     *   agent enforces (carried on the EXEC frame); the RES line reports which
     *   streams were cut. 0 (the default) keeps the unbounded capture.
     * @param {AbortSignal} [request.signal] - cancels the request (KILL + reject).
     * @returns {Promise<{exitCode: number, stdout: Buffer, stderr: Buffer, truncated: {stdout: boolean, stderr: boolean}}>}
     * @throws {AgentUnavailableError} when the agent is out for this process.
     */
    exec({ cwd, argv, timeoutMs, maxOutputBytes, env, signal }: {
        cwd: string;
        argv: string[];
        timeoutMs?: number | undefined;
        env?: Record<string, string> | undefined;
        maxOutputBytes?: number | undefined;
        signal?: AbortSignal | undefined;
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
     * @param {object} request - the filesystem request.
     * @param {string} request.op - op name (`stat`, `lstat`, `list`, `realpath`,
     *   `read`, `write`), dispatched by `agent/wsl-agent.sh`.
     * @param {string[]} request.args - op arguments; each rides one base64 line.
     * @param {number} [request.timeoutMs] - in-distro timeout, whole seconds
     *   upward, measured from the agent's dequeue ACK; `<= 0` or omitted means
     *   none.
     * @param {AbortSignal} [request.signal] - cancels the request (KILL + reject).
     * @returns {Promise<{exitCode: number, stdout: Buffer, stderr: Buffer}>}
     * @throws {AgentUnavailableError} when the agent is out for this process.
     */
    fs({ op, args, timeoutMs, signal }: {
        op: string;
        args: string[];
        timeoutMs?: number | undefined;
        signal?: AbortSignal | undefined;
    }): Promise<{
        exitCode: number;
        stdout: Buffer;
        stderr: Buffer;
    }>;
    /**
     * Liveness probe, also used to warm the agent up.
     * @param {AbortSignal} [signal] - cancels the wait.
     * @returns {Promise<void>} resolved on PONG.
     */
    ping(signal?: AbortSignal): Promise<void>;
    /**
     * Shut the agent down: SHUTDOWN first, then kill after a short grace. The
     * agent becomes reusable — a later `exec` starts a fresh process.
     * @returns {Promise<void>}
     */
    close(): Promise<void>;
    /**
     * @param {string[]} lines - the frame lines to write.
     * @returns {boolean} whether the frame was written.
     * @private
     */
    private writeLines;
    /**
     * @param {import("node:child_process").ChildProcess} child - the process being
     *   shut down.
     * @param {string[]} lines - the lines to write.
     * @private
     */
    private writeLinesSafe;
    /** @private */
    private rearmIdleTimer;
    /**
     * @param {PendingRequest} pending - the entry to detach its timer and abort
     *   listener from.
     * @private
     */
    private clearPending;
}
export default WslAgent;
/**
 * One settled command result, as `exec` resolves it.
 */
export type ExecResult = {
    /**
     * - the command's exit status.
     */
    exitCode: number;
    /**
     * - captured stdout.
     */
    stdout: Buffer;
    /**
     * - captured stderr.
     */
    stderr: Buffer;
    /**
     * - which streams the
     * capture cap cut.
     */
    truncated: {
        stdout: boolean;
        stderr: boolean;
    };
};
/**
 * One request in flight on an agent: its frame, its settlement callbacks, and
 * the ACK-armed watchdog.
 */
export type PendingRequest = {
    /**
     * - the request id, as the agent echoes it.
     */
    id: string;
    /**
     * - the frame lines (kept so a rebuild can re-send).
     */
    lines: string[];
    /**
     * - settles a RES.
     */
    resolve: (result: ExecResult) => void;
    /**
     * - settles a failure.
     */
    reject: (error: Error) => void;
    /**
     * - the ACK-armed watchdog timer.
     */
    watchdog: NodeJS.Timeout | null;
    /**
     * - the caller's cancellation, when any.
     */
    signal: AbortSignal | null;
    /**
     * - the abort listener, for removal.
     */
    onAbort: (() => void) | null;
    /**
     * - arms `watchdog`; null when the
     * request carries no timeout.
     */
    armWatchdog: (() => void) | null;
};
/**
 * The parsed protocol messages `parseAgentLine` returns — the union lives with
 * the protocol module now (`src/agent-protocol.ts`, built to the `.d.ts` this
 * import resolves), so no consumer restates it.
 */
export type AgentMessage = import("./agent-protocol.js").AgentMessage;
