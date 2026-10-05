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
 * @module dsh-plugin-wsl/agent-exec
 */

import { CwdError } from "./agent-errors.js";

/**
 * The request one agent `exec` carries.
 *
 * @typedef {object} AgentExecRequest
 * @property {string} cwd - Linux workdir.
 * @property {string[]} argv - the distro-side argv.
 * @property {number} [timeoutMs] - whole-command budget.
 * @property {Record<string, string>} [env] - extra environment for this request only.
 * @property {number} [maxOutputBytes] - per-stream capture ceiling.
 * @property {AbortSignal} [signal] - the caller's cancellation.
 */

/**
 * What an agent `exec` resolves with.
 *
 * @typedef {object} AgentExecResult
 * @property {number} exitCode - the command's exit code.
 * @property {Buffer} stdout - the captured stdout.
 * @property {Buffer} stderr - the captured stderr.
 * @property {{stdout: boolean, stderr: boolean}} [truncated] - the agent's per-stream capture-cap flags.
 */

/**
 * The {@link WslAgent}-like runner this module drives.
 *
 * @typedef {object} AgentExecRunner
 * @property {(request: AgentExecRequest) => Promise<AgentExecResult>} exec - run one command.
 */

/**
 * How the exec promise settled: the result, or the failure to propagate.
 *
 * @typedef {{ok: true, result: AgentExecResult, error?: undefined}|{ok: false, result?: undefined, error: unknown}} SettledExec
 */

/**
 * The memory-reader slice of one output stream.
 *
 * @typedef {{readFrom: (fromByte: number) => {text: string, lossy: boolean, nextOffset: number}}} OutputReader
 */

/**
 * One settled foreground command, the shape `dsh-tool-bash` consumes.
 *
 * @typedef {object} AgentExecutionHandle
 * @property {("running"|"completed"|"killed")} status - the lifecycle state.
 * @property {number|null} exitCode - the exit code; null until settled or when killed.
 * @property {string|null} signal - the terminating signal; null on a clean exit.
 * @property {{stdout: OutputReader, stderr: OutputReader}} observed - the live output readers.
 * @property {Promise<void>} done - settles when the command settles.
 * @property {() => {delta: string, lossy: boolean}} readOutput - the incremental delta reader.
 * @property {() => boolean} kill - stop the command; true on the first call only.
 * @property {() => Promise<{exitCode: number|null, signal: string|null, timedOut: boolean, aborted: boolean, timeoutMs: number, stdout: {text: string, lossy: boolean, truncated: boolean}, stderr: {text: string, lossy: boolean, truncated: boolean}}>} result - the canonical bash result.
 */

/**
 * A memory-backed output reader in the seam's shape.
 * @param {Buffer} buffer - the complete stream.
 * @returns {{readFrom: (fromByte: number) => {text: string, lossy: boolean, nextOffset: number}}}
 */
function memoryReader(buffer) {
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
export function agentExecutionHandle({ agent, cwd, argv, timeoutMs = 0, maxOutputBytes = 0, signal, onStarted }) {
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

  /** @type {Promise<SettledExec>} */
  const settle = agent.exec({ cwd, argv, timeoutMs, maxOutputBytes, signal: controller.signal }).then(
    (result) => ({ ok: true, result }),
    (/** @type {unknown} */ error) => {
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

  /** @type {Buffer} */
  let stdout = Buffer.alloc(0);
  /** @type {Buffer} */
  let stderr = Buffer.alloc(0);
  /** The agent's per-stream capture-cap flags, surfaced as `truncated`. */
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let exitOutcome = /** @type {{exitCode: number|null, signal: string|null}} */ ({ exitCode: null, signal: "SIGTERM" });

  /** @type {unknown|undefined} */
  let settleError;
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

  /** @type {AgentExecutionHandle} */
  const proc = {
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
        const output = (/** @type {string} */ text, /** @type {boolean} */ truncated) => ({ text, lossy: false, truncated });
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
