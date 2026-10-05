/**
 * Pure builders and parsers for the distro-routed `workspace-files` service —
 * the GUI file tree and previews for a `\\wsl.localhost\<distro>` workspace,
 * served from inside the distro instead of Windows-side 9P walks.
 *
 * Peer-free by construction (no DSH imports): the service subclass imports
 * this alongside the shipped `dsh-api-workspace-files` base class, and the
 * unit tests import it standalone.
 *
 * This is a TypeScript source built to `lib/workspace-files-route.js`; edit
 * THIS file and run `pnpm run build` — the artifact under `lib/` is generated,
 * and `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/workspace-files-route
 */
/**
 * Translate one path-shaped value into distro coordinates: UNC identities map
 * onto their Linux paths, drive-letter paths onto their `/mnt/<drive>` mounts,
 * everything else passes through verbatim.
 *
 * @param value - the value to translate.
 * @returns the distro-side spelling.
 */
export declare function distroPath(value: string): string;
/**
 * Whether a workspace root belongs to a distro (and therefore routes
 * distro-side).
 *
 * @param workspaceRoot - the scope's workspace root, any coordinate system.
 * @returns true for a `\\wsl.localhost\<distro>` UNC root.
 */
export declare function isDistroWorkspace(workspaceRoot: string): boolean;
/**
 * The Linux working path for one request: UNC absolutes map onto their Linux
 * paths, POSIX absolutes and relative paths join onto the root.
 *
 * @param linuxRoot - the workspace root in Linux form.
 * @param path - the requested path, any coordinate system.
 * @returns the absolute Linux path.
 */
export declare function linuxJoin(linuxRoot: string, path: string): string;
/**
 * The record invocation for one path: line 1 is the no-follow kind (the
 * upstream lstat gate), line 2 the follow-stat fields (the upstream final
 * stat), tab-joined.
 *
 * @param file - absolute Linux path.
 * @returns the agent argv.
 */
export declare function statRecordArgv(file: string): string[];
/**
 * Parse one stat record (kind + follow fields, tab-joined).
 *
 * @param line - the record line.
 * @returns the upstream kind spelling, the byte size, and the synthesized
 *   opaque version.
 */
export declare function parseStatRecord(line: string | Buffer): {
    kind: string;
    type: string;
    size: number;
    version: string;
};
/**
 * Map a `stat` kind onto the wire's kind token.
 *
 * @param kind - the `stat -c %F` spelling.
 * @returns the wire kind token.
 */
export declare function wireKind(kind: string): string;
/**
 * The read invocation for one line-paged text read: the stat record rides
 * stderr (the caller builds the stat half of the response), the page rides
 * stdout — one line beyond the page, so EOF is decidable from the yield.
 * `$1` is the file, `$2` the 1-based first line, `$3` the line count.
 *
 * @param file - absolute Linux path.
 * @param offset - first line to return (1-based).
 * @param limit - maximum lines to return.
 * @returns the agent argv.
 */
export declare function pageArgv(file: string, offset: number, limit: number): string[];
/**
 * The byte-window invocation: the stat record rides stderr, the window rides
 * stdout. `$1` is the file, `$2` the byte offset, `$3` the byte count.
 *
 * @param file - absolute Linux path.
 * @param offset - byte offset (0-based).
 * @param length - byte count.
 * @returns the agent argv.
 */
export declare function bytesArgv(file: string, offset: number, length: number): string[];
/**
 * Parse the stat record a read or byte-window relayed on stderr.
 *
 * @param stderr - the relay's raw stderr.
 * @returns the parsed stat record, or undefined when stderr carries none.
 */
export declare function parseStatRecordFromStderr(stderr: string | Buffer): {
    kind: string;
    type: string;
    size: number;
    version: string;
} | undefined;
/**
 * The listing invocation for one directory: resolve the final component
 * through symlinks, refuse paths outside the root and non-directories, then
 * list one more entry than the cap so truncation is decidable from the yield.
 * `-L` matches the upstream child semantics (a symlink to a directory lists
 * as a directory, a broken link drops out); `-p` marks directories with the
 * trailing `/` the parser keys on.
 *
 * @param linuxRoot - the workspace root in Linux form (containment boundary).
 * @param linuxDir - the directory to list.
 * @param maxEntries - the caller's entry cap.
 * @returns the agent argv.
 */
export declare function listDistroArgv(linuxRoot: string, linuxDir: string, maxEntries: number): string[];
/**
 * Parse one capped `ls -1ALp` listing into wire entries.
 *
 * @param stdout - the listing's raw stdout.
 * @param maxEntries - the entry cap the caller configured.
 * @returns at most `maxEntries` entries and whether the level had more.
 */
export declare function parseDirListing(stdout: string | Buffer, maxEntries: number): {
    entries: Array<{
        name: string;
        type: "file" | "directory";
    }>;
    truncated: boolean;
};
