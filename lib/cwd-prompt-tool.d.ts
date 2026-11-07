/**
 * Distro-native `working_directory` tool output: serve the model's own
 * read/cd tool with the SAME read/`cd` semantics the harness ships, but with
 * the returned `cwd` rewritten to the distro's POSIX form on a WSL session.
 *
 * The runtime-context rewrite (`lib/cwd-prompt.js`) covers the system-prompt
 * entry and the per-turn snapshot. The `working_directory` tool is the THIRD
 * surface the cwd reaches the model through: `dsh-tool-working-directory`
 * prints `fs.processPath()` verbatim, which on this deployment is the UNC
 * spelling — the one coordinate the distro shell cannot resolve. A model that
 * quotes that path into `bash` fails exactly the failure mode the
 * runtime-context rewrite exists to remove, so the surfaces must agree.
 *
 * This row DISABLES the shipped tool row and mounts a replacement with the
 * same tool name, the same parameters, the same `cd` semantics (the harness's
 * `workingDirectory` service still owns directory validation, resolution, and
 * the durable change), and one difference: the returned `cwd` string has every
 * WSL UNC spelling rewritten to its POSIX form. A non-WSL path passes through
 * byte for byte, so host sessions see the shipped behavior.
 *
 * Advisory by construction. The service reads the harness's
 * `workingDirectory` structurally; a harness without it fails this row's
 * activation loudly (a missing service is a composition error, not a runtime
 * degradation), while every per-call failure is the shipped tool's own — this
 * wrapper adds no I/O and no new failure modes.
 *
 * This is a TypeScript source built to `lib/cwd-prompt-tool.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/cwd-prompt-tool
 */
export declare const name = "wsl-cwd-prompt-tool";
/** The config schema's validated output: the row takes no options. */
export interface CwdPromptToolConfig {
    /** Reserved; the wrapper has no options today. */
    enabled?: boolean;
}
/** The tool registry slice this service consumes. */
export interface ToolRegistrySlice {
    register: (tool: unknown) => unknown;
}
/** The harness's `workingDirectory` service slice the shipped tool uses. */
export interface WorkingDirectoryToolSlice {
    ensure: (agent: unknown, signal?: unknown) => Promise<string>;
    set: (agent: unknown, path: string, signal?: unknown) => Promise<string>;
}
/** The cordis context slice this service consumes. */
export type CwdPromptToolContext = {
    tools: ToolRegistrySlice;
    workingDirectory: WorkingDirectoryToolSlice;
};
/** A resolved tool call: what the shipped tool's `execute` receives. */
export interface ToolExec {
    /** The live agent, required by the shipped tool too. */
    agent: unknown;
    /** Cancellation for the underlying directory operations. */
    signal?: unknown;
}
/** The tool's result: one rewritten absolute path. */
export interface WorkingDirectoryResult {
    /** The current absolute working directory, distro-native on WSL sessions. */
    cwd: string;
}
/**
 * A raw absolute path as the model should see it: the POSIX path a WSL UNC
 * names, and every other path unchanged. This is the single-path sibling of
 * `cwd-prompt.js`'s `rewriteQuotedUnc`, which handles the JSON-quoted texts.
 *
 * @param path - the absolute path the harness produced.
 * @returns the distro-native path, or the input unchanged.
 */
export declare function rewriteUncPath(path: string): string;
/**
 * Mount the replacement tool.
 *
 * @param ctx - the cordis context (the composition root, where the shipped
 *   tool row is disabled by the patch layer).
 */
export declare function apply(ctx: CwdPromptToolContext): Promise<void>;
