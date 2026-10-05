/**
 * Run one command through the agent and present it as an execution handle.
 *
 * @param {object} request - the execution request.
 * @param {AgentExecRunner} request.agent - the {@link WslAgent}-like runner: `exec`
 *   accepting `{cwd, argv, timeoutMs, signal}` and resolving
 *   `{exitCode, stdout, stderr}`; throws `AgentUnavailableError` when out.
 * @param {string} request.cwd - Linux workdir.
 * @param {string[]} request.argv - the distro-side argv, bwrap-wrapped when confined.
 * @param {number} [request.timeoutMs] - whole-command budget; the agent TERMs
 *   at the ceiling second and KILLs after its grace.
 * @param {number} [request.maxOutputBytes] - per-stream capture ceiling the
 *   agent enforces; the handle reports a cut stream as `truncated: true`.
 * @param {AbortSignal} [request.signal] - the caller's cancellation.
 * @param {(proc: object) => void} [request.onStarted] - provider-facts hook,
 *   called synchronously before the handle can settle.
 * @returns {AgentExecutionHandle} the execution handle (`status`, `exitCode`, `signal`,
 *   `observed`, `done`, `readOutput`, `kill`, `result`).
 */
export function agentExecutionHandle({ agent, cwd, argv, timeoutMs, maxOutputBytes, signal, onStarted }: {
    agent: AgentExecRunner;
    cwd: string;
    argv: string[];
    timeoutMs?: number | undefined;
    maxOutputBytes?: number | undefined;
    signal?: AbortSignal | undefined;
    onStarted?: ((proc: object) => void) | undefined;
}): AgentExecutionHandle;
/**
 * The request one agent `exec` carries.
 */
export type AgentExecRequest = {
    /**
     * - Linux workdir.
     */
    cwd: string;
    /**
     * - the distro-side argv.
     */
    argv: string[];
    /**
     * - whole-command budget.
     */
    timeoutMs?: number | undefined;
    /**
     * - extra environment for this request only.
     */
    env?: Record<string, string> | undefined;
    /**
     * - per-stream capture ceiling.
     */
    maxOutputBytes?: number | undefined;
    /**
     * - the caller's cancellation.
     */
    signal?: AbortSignal | undefined;
};
/**
 * What an agent `exec` resolves with.
 */
export type AgentExecResult = {
    /**
     * - the command's exit code.
     */
    exitCode: number;
    /**
     * - the captured stdout.
     */
    stdout: Buffer;
    /**
     * - the captured stderr.
     */
    stderr: Buffer;
    /**
     * - the agent's per-stream capture-cap flags.
     */
    truncated?: {
        stdout: boolean;
        stderr: boolean;
    } | undefined;
};
/**
 * The {@link WslAgent}-like runner this module drives.
 */
export type AgentExecRunner = {
    /**
     * - run one command.
     */
    exec: (request: AgentExecRequest) => Promise<AgentExecResult>;
};
/**
 * How the exec promise settled: the result, or the failure to propagate.
 */
export type SettledExec = {
    ok: true;
    result: AgentExecResult;
    error?: undefined;
} | {
    ok: false;
    result?: undefined;
    error: unknown;
};
/**
 * The memory-reader slice of one output stream.
 */
export type OutputReader = {
    readFrom: (fromByte: number) => {
        text: string;
        lossy: boolean;
        nextOffset: number;
    };
};
/**
 * One settled foreground command, the shape `dsh-tool-bash` consumes.
 */
export type AgentExecutionHandle = {
    /**
     * - the lifecycle state.
     */
    status: ("running" | "completed" | "killed");
    /**
     * - the exit code; null until settled or when killed.
     */
    exitCode: number | null;
    /**
     * - the terminating signal; null on a clean exit.
     */
    signal: string | null;
    /**
     * - the live output readers.
     */
    observed: {
        stdout: OutputReader;
        stderr: OutputReader;
    };
    /**
     * - settles when the command settles.
     */
    done: Promise<void>;
    /**
     * - the incremental delta reader.
     */
    readOutput: () => {
        delta: string;
        lossy: boolean;
    };
    /**
     * - stop the command; true on the first call only.
     */
    kill: () => boolean;
    /**
     * - the canonical bash result.
     */
    result: () => Promise<{
        exitCode: number | null;
        signal: string | null;
        timedOut: boolean;
        aborted: boolean;
        timeoutMs: number;
        stdout: {
            text: string;
            lossy: boolean;
            truncated: boolean;
        };
        stderr: {
            text: string;
            lossy: boolean;
            truncated: boolean;
        };
    }>;
};
