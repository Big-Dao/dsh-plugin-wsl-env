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
 * consulted lazily inside `done`. Cancellation shares one channel: the
 * caller's `signal` and `kill()` abort the agent exec, which settles `done`
 * as killed (`{exitCode: null, signal: "SIGTERM"}`) — the same shape the
 * one-shot path reports for a killed search.
 *
 * ## Failure surfacing: the tool must read rg's own failure, not a provider blow-up
 *
 * rg's exit codes are a contract the tool reads: `1` is "no matches", `2` is
 * "rg itself failed", and anything else is a provider-class failure. A distro
 * without ripgrep is the common, actionable failure — `docs/LIMITATIONS.md`
 * promises it surfaces as exit 127 with the bootstrap remedy — so this module
 * turns the agent's two local failures into that shape instead of rejecting
 * `done` (which the tool renders as an opaque "ripgrep provider failure", with
 * no program name and no remedy):
 *
 * - A `SpawnError` means the agent could not start the program. The native
 *   agent reports both a missing executable and a missing working directory
 *   that way, without naming either, so the synthesized message names both
 *   possibilities and the install remedy; the exit code is 127.
 * - A `CwdError` names the directory that could not be entered. It is
 *   synthesized as rg's own error exit code (`2`) with relay-shaped text —
 *   never `1`, which the tool would read as "no matches" and report as an
 *   empty success.
 *
 * Neither failure falls back to the one-shot path. A missing program would
 * only produce the relay's `execvpe(rg) failed` at exit `1` (again the
 * "no matches" dialect), and a missing directory is worse: `wsl.exe --cd`
 * does not fail on it — it warns, runs the command in `/`, and exits 0. The
 * shell executor can afford the one-shot retry because it decorates the
 * result with its workdir verdict; this handle has no such decoration point.
 * Everything else — a genuine agent failure that is not `AgentUnavailableError`
 * — still propagates through `done` as a rejection.
 *
 * The agent's capture cap is the tool's raw-output budget. A stream the
 * agent cut there is reported `lossy`, exactly as the one-shot delegate's
 * own reader reports it — the cut leaves the stream at exactly the budget,
 * so a length cannot show it, and a result read as whole was missing every
 * match past the cap.
 *
 * The one-shot delegate is post-processed the same way, because the agent
 * being out must not change what a broken environment looks like: a missing
 * program's `execvpe(rg) failed` line (exit 1) becomes the same 127, and the
 * relay's `chdir(...) failed` warning — which `wsl.exe` writes while it runs
 * the search in `/` and exits 0/1 — becomes the same explicit directory
 * failure instead of a silent wrong-directory result.
 *
 * Pure shaping over injected collaborators, so the handle semantics are
 * unit-testable without a distro.
 *
 * This is a TypeScript source built to `lib/search-exec.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/search-exec
 */
import type { AgentExecRunner } from "./agent-exec.js";
/**
 * The output-stream reader the search tool consumes: `handle.collected.stdout`
 * / `stderr` expose `readFrom(offset)` with the seam's standard shape.
 */
interface SearchCollectedReader {
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
export declare function searchExecutionHandle({ agent, cwd, argv, distro, maxOutputBytes, signal, spawnFallback }: {
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
     * The distro name, for the failures' remedies and the relay
     * post-processing. The synthesized text names the distro so the model can
     * relay an install command without another probe.
     */
    distro: string;
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
export {};
