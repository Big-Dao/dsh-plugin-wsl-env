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
 * @property {{stdout?: SearchCollectedReader|undefined, stderr?: SearchCollectedReader|undefined}} collected
 * @property {() => boolean|void} [kill] - optional cooperative kill; the tool
 *   relies on its `signal` for cancellation instead.
 */
/**
 * Run one search command through the agent and present it as a search handle.
 *
 * @param {object} object - the handle's collaborators.
 * @param {import("./agent-exec.js").AgentExecRunner} object.agent - the {@link WslAgent}-like runner: `exec`
 *   accepting `{cwd, argv, maxOutputBytes, signal}` and resolving
 *   `{exitCode, stdout, stderr}`; throws `AgentUnavailableError` when out.
 * @param {string} object.cwd - the Linux working directory to search from.
 * @param {string[]} object.argv - the distro-side argv (`rg` and its arguments).
 * @param {number} [object.maxOutputBytes] - per-stream capture ceiling the
 *   agent enforces; the tool's own raw-output budget rides here.
 * @param {AbortSignal} [object.signal] - the caller's cancellation.
 * @param {() => SearchExecutionHandle} object.spawnFallback - builds the one-shot handle the
 *   facade delegates to when the agent is out; called at most once, lazily.
 * @returns {SearchExecutionHandle} the search handle (`done`, `collected`, `kill`).
 */
export function searchExecutionHandle({ agent, cwd, argv, maxOutputBytes, signal, spawnFallback }: {
    agent: import("./agent-exec.js").AgentExecRunner;
    cwd: string;
    argv: string[];
    maxOutputBytes?: number | undefined;
    signal?: AbortSignal | undefined;
    spawnFallback: () => SearchExecutionHandle;
}): SearchExecutionHandle;
/**
 * The output-stream reader the search tool consumes: `handle.collected.stdout`
 * / `stderr` expose `readFrom(offset)` with the seam's standard shape.
 */
export type SearchCollectedReader = {
    readFrom: (from: number) => {
        text: string;
        lossy: boolean;
        nextOffset: number;
    };
};
/**
 * The slice of the subprocess handle the file-search tool consumes
 * (`dsh-tool-fs-search` `runRipgrep`): settle on `done`, then read the
 * collected streams. Nothing else of the handle is contract.
 */
export type SearchExecutionHandle = {
    done: Promise<{
        exitCode: number | null;
        signal: string | null;
    }>;
    collected: {
        stdout?: SearchCollectedReader | undefined;
        stderr?: SearchCollectedReader | undefined;
    };
    /**
     * - optional cooperative kill; the tool
     * relies on its `signal` for cancellation instead.
     */
    kill?: (() => boolean | void) | undefined;
};
