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

import { CwdError } from "./agent-errors.js";

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
  truncated?: { stdout: boolean, stderr: boolean };
}

/** The {@link WslAgent}-like runner this module drives. */
export interface AgentExecRunner {
  /** Run one command. */
  exec: (request: AgentExecRequest) => Promise<AgentExecResult>;
}

/** How the exec promise settled: the result, or the failure to propagate. */
export type SettledExec = { ok: true, result: AgentExecResult, error?: undefined } | { ok: false, result?: undefined, error: unknown };

/** The memory-reader slice of one output stream. */
export interface OutputReader {
  /** Read the stream from a byte offset. */
  readFrom: (fromByte: number) => { text: string, lossy: boolean, nextOffset: number };
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
  observed: { stdout: OutputReader, stderr: OutputReader };
  /** Settles when the command settles. */
  done: Promise<void>;
  /** The incremental delta reader. */
  readOutput: () => { delta: string, lossy: boolean };
  /** Stop the command; true on the first call only. */
  kill: () => boolean;
  /** The canonical bash result. */
  result: () => Promise<{ exitCode: number | null, signal: string | null, timedOut: boolean, aborted: boolean, timeoutMs: number, stdout: { text: string, lossy: boolean, truncated: boolean }, stderr: { text: string, lossy: boolean, truncated: boolean } }>;
}

/**
 * A memory-backed output reader in the seam's shape.
 *
 * @param buffer - the complete stream.
 * @returns the reader over it.
 */
function memoryReader(buffer: Buffer): OutputReader {
  return {
    readFrom(fromByte) {
      const start = Math.min(fromByte, buffer.length);
      return {
        text: buffer.subarray(start).toString("utf8"),
        lossy: false,
        nextOffset: buffer.length,
      };
    },
  };
}

/**
 * Run one command through the agent and present it as an execution handle.
 *
 * @param request - the execution request.
 * @returns the execution handle (`status`, `exitCode`, `signal`, `observed`,
 *   `done`, `readOutput`, `kill`, `result`).
 */
export function agentExecutionHandle({ agent, cwd, argv, timeoutMs = 0, maxOutputBytes = 0, signal, onStarted }: {
  /**
   * The {@link WslAgent}-like runner: `exec` accepting
   * `{cwd, argv, timeoutMs, signal}` and resolving `{exitCode, stdout, stderr}`;
   * throws `AgentUnavailableError` when out.
   */
  agent: AgentExecRunner,
  /** Linux workdir. */
  cwd: string,
  /** The distro-side argv, bwrap-wrapped when confined. */
  argv: string[],
  /**
   * Whole-command budget; the agent TERMs at the ceiling second and KILLs
   * after its grace.
   */
  timeoutMs?: number,
  /**
   * Per-stream capture ceiling the agent enforces; the handle reports a cut
   * stream as `truncated: true`.
   */
  maxOutputBytes?: number,
  /** The caller's cancellation. */
  signal?: AbortSignal,
  /**
   * Provider-facts hook, called synchronously before the handle can settle.
   */
  onStarted?: (proc: object) => void,
}): AgentExecutionHandle {
  // Our own controller is the kill channel; the caller's signal races it.
  const controller = new AbortController();
  let timedOut = false;
  let killed = false;
  let callerAborted = false;
  if (signal) {
    if (signal.aborted) callerAborted = true;
    else signal.addEventListener("abort", () => { callerAborted = true; controller.abort(signal.reason); }, { once: true });
  }
  if (timeoutMs > 0) {
    setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("BASH_TIMEOUT"));
    }, timeoutMs).unref?.();
  }

  const settle: Promise<SettledExec> = agent.exec({ cwd, argv, timeoutMs, maxOutputBytes, signal: controller.signal }).then(
    (result) => ({ ok: true, result }),
    (error: unknown) => {
      // A workdir the distro cannot enter is the command's own failure, not
      // the agent's: synthesize the relay-shaped stderr the one-shot path
      // produces, so the executor's `workdirFailure` check reports it the
      // same way. An agent that is actually OUT propagates for fallback.
      if (error instanceof CwdError) {
        return {
          ok: true,
          result: {
            exitCode: 1,
            stdout: Buffer.alloc(0),
            stderr: Buffer.from(`<3>WSL: CreateProcessCommon: chdir(${error.linuxPath}) failed: No such file or directory`, "utf8"),
          },
        };
      }
      return { ok: false, error };
    },
  );

  let stdout: Buffer = Buffer.alloc(0);
  let stderr: Buffer = Buffer.alloc(0);
  /** The agent's per-stream capture-cap flags, surfaced as `truncated`. */
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let exitOutcome: { exitCode: number | null, signal: string | null } = { exitCode: null, signal: "SIGTERM" };

  let settleError: unknown;
  const done = settle.then(({ ok, result, error }) => {
    if (ok) {
      stdout = result.stdout;
      stderr = result.stderr;
      stdoutTruncated = result.truncated?.stdout === true;
      stderrTruncated = result.truncated?.stderr === true;
      // The distro timeout and kill() both mean "we stopped it"; a genuine
      // exit keeps its code.
      if (timedOut || killed || callerAborted) exitOutcome = { exitCode: null, signal: "SIGTERM" };
      else exitOutcome = { exitCode: result.exitCode, signal: null };
    } else if (timedOut || killed) {
      // OUR kill (the in-distro timeout or kill()): the agent's rejection is
      // the abort plumbing, not a failure — settle as the killed outcome the
      // one-shot path reports for the same situation.
      stdout = Buffer.alloc(0);
      stderr = Buffer.alloc(0);
    } else {
      // The caller's cancellation rejections propagate (upstream keeps
      // cancellation as a rejection), as does a genuinely out-of-service
      // agent — that one is the executor's fallback cue.
      settleError = error;
    }
    return exitOutcome;
  });

  const stdoutReader = () => memoryReader(stdout);
  const stderrReader = () => memoryReader(stderr);

  let stdoutOffset = 0;
  let stderrOffset = 0;

  const proc: AgentExecutionHandle = {
    status: "running",
    exitCode: null,
    signal: null,
    observed: {
      get stdout() { return stdoutReader(); },
      get stderr() { return stderrReader(); },
    },
    done: done.then(() => {
      proc.status = exitOutcome.signal !== null || exitOutcome.exitCode === null ? "killed" : "completed";
      proc.exitCode = exitOutcome.exitCode;
      proc.signal = exitOutcome.signal;
    }),
    readOutput() {
      const out = stdoutReader().readFrom(stdoutOffset);
      const err = stderrReader().readFrom(stderrOffset);
      stdoutOffset = out.nextOffset;
      stderrOffset = err.nextOffset;
      const separator = out.text.length > 0 && !out.text.endsWith("\n") ? "\n" : "";
      return {
        delta: out.text + (err.text.length > 0 ? `${separator}[stderr]\n${err.text}` : ""),
        lossy: false,
      };
    },
    kill() {
      if (proc.status !== "running") return false;
      // Upstream marks the handle killed SYNCHRONOUSLY, before the process is
      // observed to die — the second kill() must already be a no-op.
      proc.status = "killed";
      killed = true;
      controller.abort(new Error("killed"));
      return true;
    },
    result() {
      return done.then(() => {
        // The spawn-equivalent failure (the agent being out) rejects here,
        // exactly like upstream's `running.done` rejection carried by result().
        if (settleError !== undefined) throw settleError;
        // `truncated` is REQUIRED by the bash tool's canonical result — it
        // copies the field unconditionally, and an `undefined` fails the wire's
        // lossless-JSON snapshot ("value is not lossless JSON"). The agent's
        // capture-cap flags are what make it TRUE instead of a perma-lie.
        const output = (text: string, truncated: boolean) => ({ text, lossy: false, truncated });
        return {
          exitCode: proc.exitCode,
          signal: proc.signal,
          timedOut,
          aborted: callerAborted && !timedOut,
          timeoutMs,
          stdout: output(stdout.toString("utf8"), stdoutTruncated),
          stderr: output(stderr.toString("utf8"), stderrTruncated),
        };
      });
    },
  };
  onStarted?.(proc);
  return proc;
}
