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
import { isWslUnc, posixToUnc, uncToPosix } from "./paths.js";
/** Upstream's default cap on one workspace index; the per-directory listing
 * rides the same bound, since one level can't usefully exceed the budget. */
const DEFAULT_MAX_ENTRIES = 50000;
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
export function normalizeDisplaySegments(displayDirectory) {
    const segments = [];
    for (const segment of String(displayDirectory).split("/")) {
        if (segment === "" || segment === ".")
            continue;
        if (segment === "..") {
            if (segments.length === 0)
                return undefined;
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    return segments;
}
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
export function traversalArgv(linuxRoot, linuxDir, maxEntries) {
    const script = [
        "root=$1 dir=$2 max=$3",
        'real=$(realpath -L -- "$dir") || exit 2',
        'case "$real" in "$root") ;; "$root"/*) ;; *) echo "OUTSIDE:$real" >&2; exit 3;; esac',
        '[ -d "$real" ] || { echo "NOTDIR:$real" >&2; exit 4; }',
        'find "$real" -mindepth 1 -maxdepth 1 -printf \'%y\\t%f\\n\' | head -n "$max"',
    ].join("\n");
    return ["sh", "-c", script, "sh", linuxRoot, linuxDir, String(maxEntries)];
}
/**
 * Parse one `%y\t%f` listing into upstream's Dirent-like entries.
 * `d` is a directory and `f` a file; every other type char — `l` for
 * symlinks, devices, sockets — is skipped, matching a readdir Dirent.
 *
 * @param stdout - the raw listing.
 * @returns the parsed entries.
 */
export function parseTraversalListing(stdout) {
    const entries = [];
    for (const line of String(stdout).split("\n")) {
        const tab = line.indexOf("\t");
        if (tab <= 0)
            continue;
        const kind = line.slice(0, tab);
        const name = line.slice(tab + 1);
        if (name.length === 0)
            continue;
        if (kind !== "d" && kind !== "f")
            continue;
        entries.push({
            name,
            isDirectory: () => kind === "d",
            isFile: () => kind === "f",
        });
    }
    return entries;
}
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
export function resolveDirectoryArgv(linuxRoot, segments) {
    const script = [
        "root=$1",
        'cur="$root"',
        'for seg in "${@:2}"; do',
        '  cur="$cur/$seg"',
        '  if [ -L "$cur" ]; then echo "SYMLINK:$cur" >&2; exit 5; fi',
        '  [ -d "$cur" ] || { echo "NOTDIR:$cur" >&2; exit 4; }',
        "done",
        'printf \'%s\\n\' "$cur"',
    ].join("\n");
    return ["sh", "-c", script, "sh", linuxRoot, ...segments];
}
/**
 * The host-default traversal — the node:fs implementations the seam keeps
 * as upstream's defaults, replicated here so the prototype answers host
 * workspaces without the seam and so tests can inject substitutes for it.
 * (Upstream owns the real defaults; this copy exists only until the takeover.)
 *
 * @param deps - the node:fs/promises functions, injectable for tests.
 * @returns the strategy object with the upstream default semantics.
 */
export function hostFileReferenceTraversal(deps) {
    const read = async (absolute, signal) => {
        signal.throwIfAborted();
        try {
            const entries = await deps.readdir(absolute, { withFileTypes: true });
            signal.throwIfAborted();
            return entries;
        }
        catch (error) {
            signal.throwIfAborted();
            throw error;
        }
    };
    return {
        readWorkspaceRoot: read,
        readDirectory: async (absolute, signal) => {
            signal.throwIfAborted();
            try {
                const entries = await deps.readdir(absolute, { withFileTypes: true });
                signal.throwIfAborted();
                return entries;
            }
            catch {
                signal.throwIfAborted();
                return [];
            }
        },
        resolveDisplayDirectory: async (root, displayDirectory, signal) => {
            const segments = normalizeDisplaySegments(displayDirectory);
            if (segments === undefined)
                return undefined;
            let current = root;
            for (const segment of segments) {
                signal.throwIfAborted();
                current = `${current}${current.endsWith("/") ? "" : "/"}${segment}`;
                try {
                    const status = await deps.lstat(current);
                    signal.throwIfAborted();
                    if (status.isSymbolicLink() || !status.isDirectory())
                        return undefined;
                }
                catch {
                    signal.throwIfAborted();
                    return undefined;
                }
            }
            return current;
        },
    };
}
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
export function wslFileReferenceTraversal({ root, runnerFor, defaultTraversal, maxEntries = DEFAULT_MAX_ENTRIES }) {
    if (!isWslUnc(root))
        return defaultTraversal;
    const rootCoords = uncToPosix(root);
    if (!rootCoords)
        return defaultTraversal;
    const rootLinux = rootCoords.linuxPath;
    /**
     * List one distro directory through the resident agent's guarded `find`.
     *
     * @param absolute - the UNC directory to list.
     * @param signal - the caller's cancellation.
     * @param onRefusal - the refusal policy: rethrow the error, or degrade to
     *   an empty listing.
     * @returns the parsed entries.
     */
    const listDistro = async (absolute, signal, onRefusal) => {
        signal.throwIfAborted();
        const coords = uncToPosix(absolute);
        if (!coords)
            return onRefusal(new Error(`not a distro path: ${absolute}`));
        const { linuxPath } = coords;
        try {
            const result = await runnerFor(rootCoords.distro).exec({
                cwd: "/",
                argv: traversalArgv(rootLinux, linuxPath, maxEntries),
                maxOutputBytes: 4_000_000,
                timeoutMs: 30_000,
                signal,
            });
            signal.throwIfAborted();
            if (result.exitCode !== 0) {
                return onRefusal(new Error(`listing "${linuxPath}" failed: ${String(result.stderr).trim() || `exit ${result.exitCode}`}`));
            }
            return parseTraversalListing(result.stdout);
        }
        catch (error) {
            signal.throwIfAborted();
            return onRefusal(error);
        }
    };
    return {
        readWorkspaceRoot(absolute, signal) {
            if (!isWslUnc(absolute))
                return defaultTraversal.readWorkspaceRoot(absolute, signal);
            return listDistro(absolute, signal, (error) => {
                throw error;
            });
        },
        readDirectory(absolute, signal) {
            if (!isWslUnc(absolute))
                return defaultTraversal.readDirectory(absolute, signal);
            return listDistro(absolute, signal, () => []);
        },
        async resolveDisplayDirectory(rootOf, displayDirectory, signal) {
            signal.throwIfAborted();
            if (!isWslUnc(rootOf))
                return defaultTraversal.resolveDisplayDirectory(rootOf, displayDirectory, signal);
            const segments = normalizeDisplaySegments(displayDirectory);
            if (segments === undefined)
                return undefined;
            if (segments.length === 0)
                return root;
            try {
                const result = await runnerFor(rootCoords.distro).exec({
                    cwd: "/",
                    argv: resolveDirectoryArgv(rootLinux, segments),
                    maxOutputBytes: 4_000_000,
                    timeoutMs: 30_000,
                    signal,
                });
                signal.throwIfAborted();
                if (result.exitCode !== 0)
                    return undefined;
                return posixToUnc(rootCoords.distro, String(result.stdout).trim());
            }
            catch {
                signal.throwIfAborted();
                return undefined;
            }
        },
    };
}
export default wslFileReferenceTraversal;
