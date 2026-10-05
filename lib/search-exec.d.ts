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
 * This is a TypeScript source built to `lib/search-exec.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/search-exec
 */
import type { AgentExecRunner } from "./agent-exec.js";
/**
 * The output-stream reader the search tool consumes: `handle.collected.stdout`
 * / `stderr` expose `readFrom(offset)` with the seam's standard shape.
 */
export interface SearchCollectedReader {
    /** Read the stream from a byte offset. */
    readFrom: (from: number) => {
        text: string;
        lossy: boolean;
        nextOffset: number;
    };
}
/**
 * The slice of the subprocess handle the file-search tool consumes
 * (`dsh-tool-fs-search` `runRipgrep`): settle on `done`, then read the
 * collected streams. Nothing else of the handle is contract.
 */
export interface SearchExecutionHandle {
    /** Settles with the exit code and signal; rejects on a genuine failure. */
    done: Promise<{
        exitCode: number | null;
        signal: string | null;
    }>;
    /** The collected stream readers; a delegated handle's own on fallback. */
    collected: {
        stdout?: SearchCollectedReader | undefined;
        stderr?: SearchCollectedReader | undefined;
    };
    /**
     * Optional cooperative kill; the tool relies on its `signal` for
     * cancellation instead.
     */
    kill?: () => boolean | void;
}
/**
 * Run one search command through the agent and present it as a search handle.
 *
 * @param object - the handle's collaborators.
 * @returns the search handle (`done`, `collected`, `kill`).
 */
export declare function searchExecutionHandle({ agent, cwd, argv, maxOutputBytes, signal, spawnFallback }: {
    /**
     * The {@link WslAgent}-like runner: `exec` accepting
     * `{cwd, argv, maxOutputBytes, signal}` and resolving
     * `{exitCode, stdout, stderr}`; throws `AgentUnavailableError` when out.
     */
    agent: AgentExecRunner;
    /** The Linux working directory to search from. */
    cwd: string;
    /** The distro-side argv (`rg` and its arguments). */
    argv: string[];
    /**
     * Per-stream capture ceiling the agent enforces; the tool's own raw-output
     * budget rides here.
     */
    maxOutputBytes?: number;
    /** The caller's cancellation. */
    signal?: AbortSignal;
    /**
     * Builds the one-shot handle the facade delegates to when the agent is out;
     * called at most once, lazily.
     */
    spawnFallback: () => SearchExecutionHandle;
}): SearchExecutionHandle;
