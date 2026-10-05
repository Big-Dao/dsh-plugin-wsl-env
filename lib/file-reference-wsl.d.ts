/**
 * Lexically normalize a `/`-separated display directory against its root.
 * Upstream resolves `resolve(root, displayDirectory)` and refuses a result
 * outside the root, so `a/../b` lands on `b` while `..` past the root is
 * refused outright — the walk below never sees a `..` segment.
 *
 * @param {string} displayDirectory - the query text before the fragment, possibly "".
 * @returns {string[] | undefined} the normalized segments, or undefined when
 *   the display directory escapes the root.
 */
export function normalizeDisplaySegments(displayDirectory: string): string[] | undefined;
/**
 * The distro argv for one directory listing: `find -printf '%y\t%f'` over the
 * contained directory. The containment guard is the same shape the picker and
 * workspace-files use — `realpath` the requested directory, refuse anything
 * the root does not contain — and the `%y` type char is what keeps symlink
 * semantics identical to a readdir Dirent (skipped, not followed).
 *
 * @param {string} linuxRoot - the workspace root, POSIX spelling.
 * @param {string} linuxDir - the directory to list, POSIX spelling.
 * @param {number} maxEntries - the listing cap (head -n bound).
 * @returns {string[]} the agent exec argv.
 */
export function traversalArgv(linuxRoot: string, linuxDir: string, maxEntries: number): string[];
/**
 * Parse one `%y\t%f` listing into upstream's Dirent-like entries.
 * `d` is a directory and `f` a file; every other type char — `l` for
 * symlinks, devices, sockets — is skipped, matching a readdir Dirent.
 *
 * @param {string|Buffer} stdout - the raw listing.
 * @returns {{name: string, isDirectory: () => boolean, isFile: () => boolean}[]}
 */
export function parseTraversalListing(stdout: string | Buffer): {
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
}[];
/**
 * The argv for the per-segment walk behind `resolveDisplayDirectory`: each
 * segment must exist, be a directory, and not be a symlink — upstream's
 * lstat verdicts, checked in one exec. Segments ride as argv elements, never
 * interpolated into the script.
 *
 * @param {string} linuxRoot - the workspace root, POSIX spelling.
 * @param {string[]} segments - the normalized display segments below the root.
 * @returns {string[]} the agent exec argv.
 */
export function resolveDirectoryArgv(linuxRoot: string, segments: string[]): string[];
/**
 * The host-default traversal — the node:fs implementations the seam keeps
 * as upstream's defaults, replicated here so the prototype answers host
 * workspaces without the seam and so tests can inject substitutes for it.
 * (Upstream owns the real defaults; this copy exists only until the takeover.)
 *
 * @param {object} deps - the node:fs/promises functions, injectable for tests.
 * @param {typeof import("node:fs/promises").readdir} deps.readdir - the readdir implementation.
 * @param {typeof import("node:fs/promises").lstat} deps.lstat - the lstat implementation.
 * @returns {FileReferenceTraversal} the strategy object with the upstream default semantics.
 */
export function hostFileReferenceTraversal(deps: {
    readdir: typeof import("node:fs/promises").readdir;
    lstat: typeof import("node:fs/promises").lstat;
}): FileReferenceTraversal;
/**
 * The distro-routed traversal strategy. Each method routes by coordinate:
 * a `\\wsl.localhost\<distro>` UNC rides the resident agent (the search
 * root and every absolute upstream passes stay in the UNC form it joined
 * them with); anything else defers to the default traversal. The search
 * root doubles as the containment root for the distro listings' guard, so
 * the seam wires one strategy per `WorkspaceFileSearch` — exactly where
 * `WorkspaceFileSearch(root, config, traversal)` would take it.
 *
 * @param {object} options
 * @param {string} options.root - the search root, the UNC form upstream passes.
 * @param {(distro: string) => Pick<import("./agent.js").WslAgent, "exec">} options.runnerFor - the agent runner
 *   for one distro; tests substitute a fake (a real wiring passes sharedAgent).
 * @param {FileReferenceTraversal} options.defaultTraversal - the host-default strategy.
 * @param {number} [options.maxEntries] - the listing cap, upstream's index budget.
 * @returns {FileReferenceTraversal} the strategy object the seam's `WorkspaceFileSearch` would take.
 */
export function wslFileReferenceTraversal({ root, runnerFor, defaultTraversal, maxEntries }: {
    root: string;
    runnerFor: (distro: string) => Pick<import("./agent.js").WslAgent, "exec">;
    defaultTraversal: FileReferenceTraversal;
    maxEntries?: number | undefined;
}): FileReferenceTraversal;
export default wslFileReferenceTraversal;
/**
 * Upstream's Dirent shape the ranking engine reads: what a `withFileTypes`
 * readdir yields and what the distro listing parses into.
 */
export type TraversalDirent = {
    /**
     * - the child's name.
     */
    name: string;
    /**
     * - the directory verdict.
     */
    isDirectory: () => boolean;
    /**
     * - the regular-file verdict.
     */
    isFile: () => boolean;
};
/**
 * The traversal seam `WorkspaceFileSearch` consumes — the three module-internal
 * funnels of `@deepseek-ai/dsh-file-reference-local`, per RFC addendum ①.
 */
export type FileReferenceTraversal = {
    /**
     * - the root's entries.
     */
    readWorkspaceRoot: (absolute: string, signal: AbortSignal) => Promise<TraversalDirent[]>;
    /**
     * - one directory's entries; an unreadable one yields [].
     */
    readDirectory: (absolute: string, signal: AbortSignal) => Promise<TraversalDirent[]>;
    /**
     * - the resolved display directory, or undefined when refused.
     */
    resolveDisplayDirectory: (root: string, displayDirectory: string, signal: AbortSignal) => Promise<string | undefined>;
};
