/**
 * An agent-backed implementation of the shell execution handle.
 *
 * `LocalBashExecutor.executeArgv` builds its handle around a subprocess spawn:
 * live output readers with byte offsets, spill files beyond the collect
 * budget, a deadline that kills the Windows process tree. This module builds
 * the SAME handle shape around one agent `exec` — the shape `dsh-tool-bash`
 * consumes, so the tool layer cannot tell which path ran. The deliberate
 * deviations, documented here rather than hidden:
 *
 * - **No spill files; the capture cap is the agent's.** The EXEC frame
 *   carries the caller's per-stream budget and the AGENT cuts stdout and
 *   stderr at it, so a chatty command costs bounded distro memory AND bounded
 *   host memory; the RES line's flags say which streams were cut and the
 *   handle reports them as `truncated: true`. What the budget spares is the
 *   upstream spill machinery: the capture is still whole-in-memory, just
 *   whole-at-a-bounded-size.
 * - **Killed commands report `SIGTERM`**, not a raw exit status: the
 *   in-distro timeout and `kill()` both mean "we stopped it", and upstream
 *   reports its own kills the same way.
 *
 * Pure shaping over an injected runner, so the handle semantics are
 * unit-testable without a distro.
 *
 * This is a TypeScript source built to `lib/agent-exec.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/agent-exec
 */
/** The request one agent `exec` carries. */
export interface AgentExecRequest {
    /** Linux workdir. */
    cwd: string;
    /** The distro-side argv. */
    argv: string[];
    /** Whole-command budget. */
    timeoutMs?: number;
    /** Extra environment for this request only. */
    env?: Record<string, string>;
    /** Per-stream capture ceiling. */
    maxOutputBytes?: number;
    /** The caller's cancellation. */
    signal?: AbortSignal;
}
/** What an agent `exec` resolves with. */
export interface AgentExecResult {
    /** The command's exit code. */
    exitCode: number;
    /** The captured stdout. */
    stdout: Buffer;
    /** The captured stderr. */
    stderr: Buffer;
    /** The agent's per-stream capture-cap flags. */
    truncated?: {
        stdout: boolean;
        stderr: boolean;
    };
}
/** The {@link WslAgent}-like runner this module drives. */
export interface AgentExecRunner {
    /** Run one command. */
    exec: (request: AgentExecRequest) => Promise<AgentExecResult>;
}
/** How the exec promise settled: the result, or the failure to propagate. */
export type SettledExec = {
    ok: true;
    result: AgentExecResult;
    error?: undefined;
} | {
    ok: false;
    result?: undefined;
    error: unknown;
};
/** The memory-reader slice of one output stream. */
export interface OutputReader {
    /** Read the stream from a byte offset. */
    readFrom: (fromByte: number) => {
        text: string;
        lossy: boolean;
        nextOffset: number;
    };
}
/** One settled foreground command, the shape `dsh-tool-bash` consumes. */
export interface AgentExecutionHandle {
    /** The lifecycle state. */
    status: "running" | "completed" | "killed";
    /** The exit code; null until settled or when killed. */
    exitCode: number | null;
    /** The terminating signal; null on a clean exit. */
    signal: string | null;
    /** The live output readers. */
    observed: {
        stdout: OutputReader;
        stderr: OutputReader;
    };
    /** Settles when the command settles. */
    done: Promise<void>;
    /** The incremental delta reader. */
    readOutput: () => {
        delta: string;
        lossy: boolean;
    };
    /** Stop the command; true on the first call only. */
    kill: () => boolean;
    /** The canonical bash result. */
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
}
/**
 * Run one command through the agent and present it as an execution handle.
 *
 * @param request - the execution request.
 * @returns the execution handle (`status`, `exitCode`, `signal`, `observed`,
 *   `done`, `readOutput`, `kill`, `result`).
 */
export declare function agentExecutionHandle({ agent, cwd, argv, timeoutMs, maxOutputBytes, signal, onStarted }: {
    /**
     * The {@link WslAgent}-like runner: `exec` accepting
     * `{cwd, argv, timeoutMs, signal}` and resolving `{exitCode, stdout, stderr}`;
     * throws `AgentUnavailableError` when out.
     */
    agent: AgentExecRunner;
    /** Linux workdir. */
    cwd: string;
    /** The distro-side argv, bwrap-wrapped when confined. */
    argv: string[];
    /**
     * Whole-command budget; the agent TERMs at the ceiling second and KILLs
     * after its grace.
     */
    timeoutMs?: number;
    /**
     * Per-stream capture ceiling the agent enforces; the handle reports a cut
     * stream as `truncated: true`.
     */
    maxOutputBytes?: number;
    /** The caller's cancellation. */
    signal?: AbortSignal;
    /**
     * Provider-facts hook, called synchronously before the handle can settle.
     */
    onStarted?: (proc: object) => void;
}): AgentExecutionHandle;
