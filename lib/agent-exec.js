/**
 * An agent-backed implementation of the shell execution handle.
 *
 * `LocalBashExecutor.executeArgv` builds its handle around a subprocess spawn:
 * live output readers with byte offsets, spill files beyond the collect
 * budget, a deadline that kills the Windows process tree. This module builds
 * the SAME handle shape around one agent `exec` — the shape `dsh-tool-bash`
 * consumes, so the tool layer cannot tell which path ran. The deliberate
 * deviations, both memory-for-simplicity trades documented here rather than
 * hidden:
 *
 * - **No spill files.** The agent returns each stream as one buffer; the
 *   handle serves reads from memory. The upstream budget machinery exists to
 *   bound host memory for unbounded streams; the agent path accepts holding
 *   the stream (the protocol line already carries it whole).
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
 * @param {object} request.agent - the {@link WslAgent}-like runner: `exec`
 *   accepting `{cwd, argv, timeoutMs, signal}` and resolving
 *   `{exitCode, stdout, stderr}`; throws `AgentUnavailableError` when out.
 * @param {string} request.cwd - Linux workdir.
 * @param {string[]} request.argv - the distro-side argv, bwrap-wrapped when confined.
 * @param {number} [request.timeoutMs] - whole-command budget; the agent TERMs
 *   at the ceiling second and KILLs after its grace.
 * @param {AbortSignal} [request.signal] - the caller's cancellation.
 * @param {(proc: object) => void} [request.onStarted] - provider-facts hook,
 *   called synchronously before the handle can settle.
 * @returns {object} the execution handle (`status`, `exitCode`, `signal`,
 *   `observed`, `done`, `readOutput`, `kill`, `result`).
 */
export function agentExecutionHandle({ agent, cwd, argv, timeoutMs = 0, signal, onStarted }) {
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

  const settle = agent.exec({ cwd, argv, timeoutMs, signal: controller.signal }).then(
    (result) => ({ ok: true, result }),
    (error) => {
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
  let exitOutcome = { exitCode: null, signal: "SIGTERM" };

  let settleError;
  const done = settle.then(({ ok, result, error }) => {
    if (ok) {
      stdout = result.stdout;
      stderr = result.stderr;
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

  /** @type {object} */
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
        return {
          exitCode: proc.exitCode,
          signal: proc.signal,
          timedOut,
          aborted: callerAborted && !timedOut,
          timeoutMs,
          stdout: { text: stdout.toString("utf8"), lossy: false },
          stderr: { text: stderr.toString("utf8"), lossy: false },
        };
      });
    },
  };
  onStarted?.(proc);
  return proc;
}
