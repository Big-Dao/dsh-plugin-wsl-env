/**
 * The distro-side traversal strategy for `@` completion — the plugin's
 * ready answer to RFC addendum ① (docs/upstream/rfc-wsl-workspaces.md).
 *
 * ## The seam this consumes
 *
 * `@deepseek-ai/dsh-file-reference-local` funnels every workspace traversal
 * through three module-internal functions: `readWorkspaceRoot` and
 * `readDirectory` (both `node:fs/promises` readdir with `withFileTypes`) and
 * `resolveDisplayDirectory` (a lexical resolve plus a per-segment `lstat`
 * walk that refuses symlink and non-directory components). Everything else —
 * the fuzzy ranking, the bounded index, the generation/invalidation dance,
 * the excluded-directory list — is pure logic over the entries those three
 * return. Addendum ① proposes exposing the three as an injectable strategy
 * with the current implementations as defaults; this module is the consumer
 * side, built and tested against that interface so the takeover lands the
 * day the seam does.
 *
 * It is deliberately NOT wired into cordis.patch.yml yet: with the seam
 * absent, reaching the funnels would mean subclassing past module-internal
 * functions or re-implementing the ranking engine — the behavior-regression
 * path the RFC rules out. The module ships, tested, until upstream speaks.
 *
 * ## Semantics, held faithful where the seam allows
 *
 * - Entries keep upstream's Dirent shape: `{name, isDirectory(), isFile()}`.
 *   The distro listing uses `find -printf '%y\t%f'` rather than `ls -1ALp`
 *   precisely for this: `%y` reports `l` for symlinks, which the parse skips
 *   the way a readdir Dirent is neither file nor directory. `ls -1ALp` would
 *   resolve links through and change which candidates exist.
 * - `resolveDisplayDirectory` refuses a symlink or non-directory component
 *   with one agent exec that walks the (lexically normalized) segments —
 *   the same verdict upstream reaches with N sequential lstats, and unlike
 *   `realpath`, refusing is the point, not resolving.
 * - A directory the traversal cannot read yields `[]` (upstream's readdir
 *   catch); an aborted caller propagates the abort instead.
 * - The returned absolutes stay in the root's own coordinate system (UNC for
 *   a distro workspace), because upstream joins children with the host
 *   `node:path` — a POSIX path from this layer would be mangled by it.
 *
 * This is a TypeScript source built to `lib/file-reference-wsl.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/file-reference-wsl
 */
import type { WslAgent } from "./agent.js";
/**
 * Upstream's Dirent shape the ranking engine reads: what a `withFileTypes`
 * readdir yields and what the distro listing parses into.
 */
export interface TraversalDirent {
    /** The child's name. */
    name: string;
    /** The directory verdict. */
    isDirectory: () => boolean;
    /** The regular-file verdict. */
    isFile: () => boolean;
}
/**
 * The traversal seam `WorkspaceFileSearch` consumes — the three module-internal
 * funnels of `@deepseek-ai/dsh-file-reference-local`, per RFC addendum ①.
 */
export interface FileReferenceTraversal {
    /** The root's entries. */
    readWorkspaceRoot: (absolute: string, signal: AbortSignal) => Promise<TraversalDirent[]>;
    /** One directory's entries; an unreadable one yields []. */
    readDirectory: (absolute: string, signal: AbortSignal) => Promise<TraversalDirent[]>;
    /** The resolved display directory, or undefined when refused. */
    resolveDisplayDirectory: (root: string, displayDirectory: string, signal: AbortSignal) => Promise<string | undefined>;
}
/**
 * Lexically normalize a `/`-separated display directory against its root.
 * Upstream resolves `resolve(root, displayDirectory)` and refuses a result
 * outside the root, so `a/../b` lands on `b` while `..` past the root is
 * refused outright — the walk below never sees a `..` segment.
 *
 * @param displayDirectory - the query text before the fragment, possibly "".
 * @returns the normalized segments, or undefined when the display directory
 *   escapes the root.
 */
export declare function normalizeDisplaySegments(displayDirectory: string): string[] | undefined;
/**
 * The distro argv for one directory listing: `find -printf '%y\t%f'` over the
 * contained directory. The containment guard is the same shape the picker and
 * workspace-files use — `realpath` the requested directory, refuse anything
 * the root does not contain — and the `%y` type char is what keeps symlink
 * semantics identical to a readdir Dirent (skipped, not followed).
 *
 * @param linuxRoot - the workspace root, POSIX spelling.
 * @param linuxDir - the directory to list, POSIX spelling.
 * @param maxEntries - the listing cap (head -n bound).
 * @returns the agent exec argv.
 */
export declare function traversalArgv(linuxRoot: string, linuxDir: string, maxEntries: number): string[];
/**
 * Parse one `%y\t%f` listing into upstream's Dirent-like entries.
 * `d` is a directory and `f` a file; every other type char — `l` for
 * symlinks, devices, sockets — is skipped, matching a readdir Dirent.
 *
 * @param stdout - the raw listing.
 * @returns the parsed entries.
 */
export declare function parseTraversalListing(stdout: string | Buffer): Array<{
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
}>;
/**
 * The argv for the per-segment walk behind `resolveDisplayDirectory`: each
 * segment must exist, be a directory, and not be a symlink — upstream's
 * lstat verdicts, checked in one exec. Segments ride as argv elements, never
 * interpolated into the script.
 *
 * @param linuxRoot - the workspace root, POSIX spelling.
 * @param segments - the normalized display segments below the root.
 * @returns the agent exec argv.
 */
export declare function resolveDirectoryArgv(linuxRoot: string, segments: string[]): string[];
/**
 * The host-default traversal — the node:fs implementations the seam keeps
 * as upstream's defaults, replicated here so the prototype answers host
 * workspaces without the seam and so tests can inject substitutes for it.
 * (Upstream owns the real defaults; this copy exists only until the takeover.)
 *
 * @param deps - the node:fs/promises functions, injectable for tests.
 * @returns the strategy object with the upstream default semantics.
 */
export declare function hostFileReferenceTraversal(deps: {
    /** The readdir implementation. */
    readdir: typeof import("node:fs/promises").readdir;
    /** The lstat implementation. */
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
 * @param options - the strategy's collaborators.
 * @returns the strategy object the seam's `WorkspaceFileSearch` would take.
 */
export declare function wslFileReferenceTraversal({ root, runnerFor, defaultTraversal, maxEntries }: {
    /** The search root, the UNC form upstream passes. */
    root: string;
    /**
     * The agent runner for one distro; tests substitute a fake (a real wiring
     * passes sharedAgent).
     */
    runnerFor: (distro: string) => Pick<WslAgent, "exec">;
    /** The host-default strategy. */
    defaultTraversal: FileReferenceTraversal;
    /** The listing cap, upstream's index budget. */
    maxEntries?: number;
}): FileReferenceTraversal;
export default wslFileReferenceTraversal;
