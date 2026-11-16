/**
 * The agent-backed execution handle for the git-snapshot spawn.
 *
 * `workspace-changes`' `GitRunner` consumes a small slice of the subprocess
 * handle: `handle.done` for `{exitCode, signal}`, then
 * `handle.collected.stdout/stderr.readFrom(0)` for `{text, lossy}` — with
 * per-stream caps applied by the caller's `stdio` spec (a generous stdout
 * budget and a 16 KiB stderr tail). This module builds exactly that surface
 * around one resident-agent `exec`, so a distro snapshot pays the warm agent's
 * ~2 ms round trip per git call instead of the one-shot `wsl.exe`'s ~230 ms
 * process startup — measured 2026-11-01 on `ubuntu`; a full snapshot's 6-8
 * calls (plus per-file `cat-file`) used to spend over a second inside
 * `wsl.exe` alone.
 *
 * The caps map onto the agent's single per-request capture ceiling as the
 * larger of the two stream budgets; the reader then slices each stream to its
 * own budget and reports `lossy` from that slice, so the caller's contract
 * (per-stream cut flags) holds even though the wire carries one cap.
 *
 * Environment rides the agent's per-request `env` (an `env --` argv prefix —
 * no `SETENV` global pollution), holding only the translated `GIT_*` names:
 * the one-shot path forwards exactly those through `WSLENV`, and forwarding a
 * host `PATH` into the distro would be wrong, not just different.
 *
 * The agent being out is the fallback cue, exactly as `search-exec.ts`:
 * `spawnFallback` (the caller's one-shot `wsl.exe` handle) is consulted
 * lazily inside `done`, and from that point the facade proxies the delegate
 * verbatim unless its relay named a broken program or directory. Cancellation
 * shares one channel: the caller's `signal` and `kill()` abort the agent
 * exec, settling `done` as killed.
 *
 * ## Failure surfacing: a broken distro must not look like "no changes"
 *
 * `GitRunner` reads git's own exit codes and stderr; a rejection from
 * `handle.done` is an opaque snapshot failure the model cannot act on. The
 * agent's two local failures therefore become git's own dialect instead:
 *
 * - A `SpawnError` means the agent could not start the program. The native
 *   agent reports both a missing executable and a missing working directory
 *   that way, without naming either — so the synthesized message names both
 *   and the install remedy, at exit 127 (a shell's command-not-found; never
 *   `1`, which several git subcommands use for a normal negative answer, nor
 *   `128`, which `GitRunner` reads as "not a repository").
 * - A `CwdError` names the directory that could not be entered. It becomes
 *   git's fatal class — `fatal: cannot change to '<path>': No such file or
 *   directory` at exit 128 — which is exactly what `git -C <missing>` itself
 *   prints.
 *
 * Neither failure falls back to the one-shot path. A missing program would
 * only produce the relay's `execvpe(git) failed` at exit `1`, and a missing
 * directory is worse: `wsl.exe --cd` does not fail on it — it warns, runs in
 * `/`, and exits 0 — where `git` then answers "not a git repository", which
 * the snapshot reads as a clean, empty result. The one-shot delegate is
 * post-processed for both relay markers, so the agent being out cannot turn a
 * broken environment into a silent "no changes" either. Other failures still
 * propagate through `done` as rejections.
 *
 * A discovery call's absolute-path answer is translated on BOTH transports:
 * the one-shot delegate's stdout is taken over and passed through
 * `translateDiscoveryOutput` exactly as the agent's result is, so change
 * review sees the same UNC paths whether or not the resident is up.
 *
 * Pure shaping over injected collaborators, unit-testable without a distro.
 *
 * This is a TypeScript source built to `lib/git-exec.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/git-exec
 */

import { AgentUnavailableError, CwdError, SpawnError } from "./agent-errors.js";
import type { AgentExecRunner } from "./agent-exec.js";
import { t } from "./messages.js";
import { translateDiscoveryOutput } from "./git-route.js";
import { execProgramFailure, workdirFailure } from "./wsl.js";

/** One collected-stream reader with the seam's standard shape. */
interface GitStreamReader {
  /** Read the stream from a byte offset; `lossy` says the cap cut it. */
  readFrom: (from: number) => { text: string, lossy: boolean, nextOffset: number };
}

/**
 * The slice of the subprocess handle `GitRunner` consumes: settle on `done`,
 * then read the collected streams.
 */
export interface GitExecutionHandle {
  /** Settles with the exit code and signal; rejects on a genuine failure. */
  done: Promise<{ exitCode: number | null, signal: string | null }>;
  /** The collected stream readers; a delegated handle's own on fallback. */
  collected: { stdout?: GitStreamReader | undefined, stderr?: GitStreamReader | undefined };
  /** Cooperative kill; the runner relies on its `signal` for cancellation. */
  kill?: () => boolean | void;
}

/** Per-stream capture budgets the caller declared on its `stdio` spec. */
interface GitStreamCaps {
  /** The stdout budget in bytes; the snapshot's `outputMaxBytes`. */
  stdout: number;
  /** The stderr tail budget in bytes. */
  stderr: number;
}

/** The exit code a shell reports for a command it could not run. */
const COMMAND_NOT_FOUND_EXIT = 127;

/**
 * git's fatal-error exit code. A directory that cannot be entered is what
 * `git -C <missing>` itself reports this way, so the synthesized line speaks
 * git's own dialect rather than inventing a code.
 */
const GIT_FATAL_EXIT = 128;

/**
 * The stderr one snapshot settles with when its working directory is gone:
 * git's own fatal line, then the directory's remedy.
 *
 * @param linuxPath - the directory the agent could not enter.
 * @returns the stderr text.
 */
function workdirFailureText(linuxPath: string): string {
  return `fatal: cannot change to '${linuxPath}': No such file or directory\n${t("gitWorkdirMissing", { path: linuxPath })}`;
}

/**
 * Run one git command through the agent and present it as a git-snapshot
 * handle.
 *
 * @param object - the handle's collaborators.
 * @returns the snapshot handle (`done`, `collected`, `kill`).
 */
export function gitExecutionHandle({ agent, cwd, argv, env, stdin, caps, distro, discovery, signal, spawnFallback }: {
  /** The {@link WslAgent}-like runner; throws `AgentUnavailableError` when out. */
  agent: AgentExecRunner,
  /** The Linux working directory to snapshot from. */
  cwd: string,
  /** The distro-side argv (`git` and its arguments). */
  argv: string[],
  /**
   * The distro name; used by the discovery translation (absolute path lines
   * become `\\wsl.localhost\<distro><path>`) and by every failure's remedy.
   */
  distro: string,
  /**
   * True for a SENTINEL discovery call (`--show-toplevel` /
   * `--absolute-git-dir` / `--git-path` answered by the distro git): the
   * captured stdout's absolute Linux path lines are translated into UNC form
   * before the caller reads them. Snapshot calls leave this unset.
   */
  discovery?: boolean,
  /**
   * Per-request environment: the caller's entries with path-shaped values
   * translated into distro form. Empty entries are dropped; nothing but
   * `GIT_*` names should reach here.
   */
  env: Record<string, string>,
  /** The child's entire stdin, or undefined for an empty one. */
  stdin?: Uint8Array,
  /** Per-stream capture budgets from the caller's `stdio` spec. */
  caps: GitStreamCaps,
  /** The caller's cancellation (its own timeout races in through `AbortSignal.any`). */
  signal?: AbortSignal,
  /**
   * Builds the one-shot handle the facade delegates to when the agent is out;
   * called at most once, lazily.
   */
  spawnFallback: () => GitExecutionHandle,
}): GitExecutionHandle {
  const state: {
    delegate: GitExecutionHandle | undefined,
    stdout: Buffer | undefined,
    stderr: Buffer | undefined,
    /** A delegated stream's own cut flag, carried over when this facade takes it over. */
    lossy: { stdout: boolean, stderr: boolean },
  } = { delegate: undefined, stdout: undefined, stderr: undefined, lossy: { stdout: false, stderr: false } };
  const controller = new AbortController();
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });

  // The agent enforces ONE cap per request; declare the larger budget on the
  // wire and cut each stream to its own budget here, so the caller's
  // per-stream contract holds and a stream under its cap is never flagged.
  const wireCap = Math.max(caps.stdout, caps.stderr);
  const reader = (slot: "stdout" | "stderr"): GitStreamReader => {
    const cap = slot === "stdout" ? caps.stdout : caps.stderr;
    return {
      readFrom(from) {
        const buffer = state[slot] ?? Buffer.alloc(0);
        const lossy = state.lossy[slot] || buffer.length > cap;
        const visible = lossy ? buffer.subarray(0, cap) : buffer;
        const start = Math.min(from, visible.length);
        return { text: visible.subarray(start).toString("utf8"), lossy, nextOffset: visible.length };
      },
    };
  };

  /**
   * Settle on a synthesized failure: drop any delegate so `collected` serves
   * the buffers this facade owns.
   *
   * @param exitCode - git's dialect exit code for the failure.
   * @param stderr - the model-facing diagnostic, remedy included.
   * @returns the settled outcome.
   */
  const settleFailure = (exitCode: number, stderr: string): { exitCode: number, signal: null } => {
    state.delegate = undefined;
    state.stdout = Buffer.alloc(0);
    state.stderr = Buffer.from(stderr, "utf8");
    state.lossy = { stdout: false, stderr: false };
    return { exitCode, signal: null };
  };

  /**
   * The 127 result for a program the distro could not start.
   *
   * @param detail - the agent's or the relay's own spawn diagnostic.
   * @returns the settled outcome.
   */
  const settleProgramMissing = (detail: string): { exitCode: number, signal: null } =>
    settleFailure(COMMAND_NOT_FOUND_EXIT, t("gitProgramMissing", { distro, detail }));

  /**
   * The fatal result for a directory the distro could not enter.
   *
   * @param linuxPath - the directory that could not be entered.
   * @returns the settled outcome.
   */
  const settleWorkdirMissing = (linuxPath: string): { exitCode: number, signal: null } =>
    settleFailure(GIT_FATAL_EXIT, workdirFailureText(linuxPath));

  /**
   * Take the delegated discovery call's streams over so their stdout gets the
   * SAME UNC translation the agent path applies. The one-shot transport runs
   * the same distro git, so an untranslated answer would hand the caller
   * Linux absolute paths that only resolve correctly on the agent transport —
   * a transport-dependent change review. The delegate's per-stream cut flags
   * are carried into this facade's readers rather than flattened.
   *
   * @param delegate - the settled one-shot handle.
   */
  const takeOverDiscoveryOutput = (delegate: GitExecutionHandle): void => {
    const stdout = delegate.collected.stdout?.readFrom(0);
    const stderr = delegate.collected.stderr?.readFrom(0);
    state.delegate = undefined;
    state.stdout = translateDiscoveryOutput(distro, Buffer.from(stdout?.text ?? "", "utf8"));
    state.stderr = Buffer.from(stderr?.text ?? "", "utf8");
    state.lossy = { stdout: stdout?.lossy === true, stderr: stderr?.lossy === true };
  };

  /**
   * Delegate one agent-unavailable request to the one-shot handle, translating
   * the relay's missing-directory warning and missing-program line into the
   * same explicit failures the agent path produces. Any other delegated
   * outcome passes through verbatim (its collected streams stay the
   * delegate's).
   *
   * @returns the settled outcome.
   */
  const settleDelegate = async (): Promise<{ exitCode: number | null, signal: string | null }> => {
    const delegate = spawnFallback();
    state.delegate = delegate;
    const outcome = await delegate.done;
    if (outcome.exitCode === null) return outcome;
    const text = delegate.collected.stderr?.readFrom(0).text ?? "";
    const missingDir = workdirFailure("", text);
    if (missingDir !== undefined) return settleWorkdirMissing(missingDir);
    const relayFailure = execProgramFailure("", text);
    if (relayFailure !== undefined) return settleProgramMissing(relayFailure);
    if (discovery) takeOverDiscoveryOutput(delegate);
    return outcome;
  };

  const handle: GitExecutionHandle = {
    get collected() {
      if (state.delegate !== undefined) return state.delegate.collected;
      return { stdout: reader("stdout"), stderr: reader("stderr") };
    },
    done: (async () => {
      let result;
      try {
        result = await agent.exec({ cwd, argv, env, stdin, maxOutputBytes: wireCap, signal: controller.signal });
        state.stdout = discovery ? translateDiscoveryOutput(distro, result.stdout) : result.stdout;
        state.stderr = result.stderr;
      } catch (error) {
        if (controller.signal.aborted) {
          // Our kill() or the caller's cancellation: the killed outcome the
          // one-shot path reports, not a failure.
          return { exitCode: null, signal: "SIGTERM" };
        }
        if (error instanceof CwdError) {
          // The directory is gone: git's own fatal dialect, so the snapshot
          // reports the path instead of rejecting as a provider failure.
          return settleWorkdirMissing(error.linuxPath);
        }
        if (error instanceof SpawnError) {
          // The agent could not start the program. The native agent reports
          // both a missing executable and a missing workdir this way, so the
          // message names both and the remedy makes it actionable.
          return settleProgramMissing(error.message);
        }
        if (!(error instanceof AgentUnavailableError)) throw error;
        return await settleDelegate();
      }
      return { exitCode: result.exitCode, signal: null };
    })(),
    kill() {
      controller.abort(new Error("killed"));
      state.delegate?.kill?.();
    },
  };
  return handle;
}
