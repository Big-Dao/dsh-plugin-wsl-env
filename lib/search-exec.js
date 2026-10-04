/**
 * The agent-backed execution handle for the file-search spawn.
 *
 * `dsh-tool-fs-search` consumes a deliberately small slice of the subprocess
 * handle: it awaits `handle.done` for `{exitCode, signal}`, then reads
 * `handle.collected.stdout/stderr.readFrom(0)` — nothing else. This module
 * builds exactly that surface around one resident-agent `exec`, so a distro
 * search pays one round trip on the warm agent (~10 ms) instead of a one-shot
 * `wsl.exe` spawn (~400 ms of process startup for a few ms of rg).
 *
 * The agent being out is not an error condition here — it is the fallback
 * cue. `spawnFallback` (the shipped one-shot handle the caller builds) is
 * consulted lazily inside `done`; from that point the facade proxies the
 * delegate's `collected` and `done` verbatim. Neither transport ever touches
 * the 9p share.
 *
 * Cancellation shares one channel: the caller's `signal` and `kill()` abort
 * the agent exec, which settles `done` as killed (`{exitCode: null, signal:
 * "SIGTERM"}`) — the same shape the one-shot path reports for a killed search.
 * A genuine agent failure (anything but unavailability) propagates through
 * `done` as a rejection, which the tool classifies as a search failure.
 *
 * Pure shaping over injected collaborators, so the handle semantics are
 * unit-testable without a distro.
 *
 * @module dsh-plugin-wsl/search-exec
 */

import { AgentUnavailableError } from "./agent-errors.js";

/**
 * The output-stream reader the search tool consumes: `handle.collected.stdout`
 * / `stderr` expose `readFrom(offset)` with the seam's standard shape.
 *
 * @typedef {Object} SearchCollectedReader
 * @property {(from: number) => {text: string, lossy: boolean, nextOffset: number}} readFrom
 */

/**
 * The slice of the subprocess handle the file-search tool consumes
 * (`dsh-tool-fs-search` `runRipgrep`): settle on `done`, then read the
 * collected streams. Nothing else of the handle is contract.
 *
 * @typedef {Object} SearchExecutionHandle
 * @property {Promise<{exitCode: number|null, signal: string|null}>} done
 * @property {{stdout: SearchCollectedReader, stderr: SearchCollectedReader}} collected
 * @property {() => boolean|void} [kill] - optional cooperative kill; the tool
 *   relies on its `signal` for cancellation instead.
 */

/**
 * Run one search command through the agent and present it as a search handle.
 *
 * @param object - the handle's collaborators.
 * @param {object} object.agent - the {@link WslAgent}-like runner: `exec`
 *   accepting `{cwd, argv, maxOutputBytes, signal}` and resolving
 *   `{exitCode, stdout, stderr}`; throws `AgentUnavailableError` when out.
 * @param {string} object.cwd - the Linux working directory to search from.
 * @param {string[]} object.argv - the distro-side argv (`rg` and its arguments).
 * @param {number} [object.maxOutputBytes] - per-stream capture ceiling the
 *   agent enforces; the tool's own raw-output budget rides here.
 * @param {AbortSignal} [object.signal] - the caller's cancellation.
 * @param {() => object} object.spawnFallback - builds the one-shot handle the
 *   facade delegates to when the agent is out; called at most once, lazily.
 * @returns {object} the search handle (`done`, `collected`, `kill`).
 */
export function searchExecutionHandle({ agent, cwd, argv, maxOutputBytes = 0, signal, spawnFallback }) {
  const state = { delegate: undefined, stdout: undefined, stderr: undefined };
  const controller = new AbortController();
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });

  const reader = (slot) => ({
    readFrom(from) {
      const buffer = state[slot] ?? Buffer.alloc(0);
      const start = Math.min(from, buffer.length);
      return { text: buffer.subarray(start).toString("utf8"), lossy: false, nextOffset: buffer.length };
    },
  });

  /** @type {object} */
  const handle = {
    get collected() {
      if (state.delegate !== undefined) return state.delegate.collected;
      return { stdout: reader("stdout"), stderr: reader("stderr") };
    },
    done: (async () => {
      let result;
      try {
        result = await agent.exec({ cwd, argv, maxOutputBytes, signal: controller.signal });
        state.stdout = result.stdout;
        state.stderr = result.stderr;
      } catch (error) {
        if (!(error instanceof AgentUnavailableError)) {
          if (controller.signal.aborted) {
            // Our kill() or the caller's cancellation: the killed outcome the
            // one-shot path reports, not a failure.
            return { exitCode: null, signal: "SIGTERM" };
          }
          throw error;
        }
        const delegate = spawnFallback();
        state.delegate = delegate;
        return delegate.done;
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
