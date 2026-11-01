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
 * verbatim. Cancellation shares one channel: the caller's `signal` and
 * `kill()` abort the agent exec, settling `done` as killed.
 *
 * Pure shaping over injected collaborators, unit-testable without a distro.
 *
 * This is a TypeScript source built to `lib/git-exec.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/git-exec
 */
import type { AgentExecRunner } from "./agent-exec.js";
/** One collected-stream reader with the seam's standard shape. */
export interface GitStreamReader {
    /** Read the stream from a byte offset; `lossy` says the cap cut it. */
    readFrom: (from: number) => {
        text: string;
        lossy: boolean;
        nextOffset: number;
    };
}
/**
 * The slice of the subprocess handle `GitRunner` consumes: settle on `done`,
 * then read the collected streams.
 */
export interface GitExecutionHandle {
    /** Settles with the exit code and signal; rejects on a genuine failure. */
    done: Promise<{
        exitCode: number | null;
        signal: string | null;
    }>;
    /** The collected stream readers; a delegated handle's own on fallback. */
    collected: {
        stdout?: GitStreamReader | undefined;
        stderr?: GitStreamReader | undefined;
    };
    /** Cooperative kill; the runner relies on its `signal` for cancellation. */
    kill?: () => boolean | void;
}
/** Per-stream capture budgets the caller declared on its `stdio` spec. */
export interface GitStreamCaps {
    /** The stdout budget in bytes; the snapshot's `outputMaxBytes`. */
    stdout: number;
    /** The stderr tail budget in bytes. */
    stderr: number;
}
/**
 * Run one git command through the agent and present it as a git-snapshot
 * handle.
 *
 * @param object - the handle's collaborators.
 * @returns the snapshot handle (`done`, `collected`, `kill`).
 */
export declare function gitExecutionHandle({ agent, cwd, argv, env, stdin, caps, signal, spawnFallback }: {
    /** The {@link WslAgent}-like runner; throws `AgentUnavailableError` when out. */
    agent: AgentExecRunner;
    /** The Linux working directory to snapshot from. */
    cwd: string;
    /** The distro-side argv (`git` and its arguments). */
    argv: string[];
    /**
     * Per-request environment: the caller's entries with path-shaped values
     * translated into distro form. Empty entries are dropped; nothing but
     * `GIT_*` names should reach here.
     */
    env: Record<string, string>;
    /** The child's entire stdin, or undefined for an empty one. */
    stdin?: Uint8Array;
    /** Per-stream capture budgets from the caller's `stdio` spec. */
    caps: GitStreamCaps;
    /** The caller's cancellation (its own timeout races in through `AbortSignal.any`). */
    signal?: AbortSignal;
    /**
     * Builds the one-shot handle the facade delegates to when the agent is out;
     * called at most once, lazily.
     */
    spawnFallback: () => GitExecutionHandle;
}): GitExecutionHandle;
