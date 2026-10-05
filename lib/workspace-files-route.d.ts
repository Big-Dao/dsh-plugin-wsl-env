/**
 * Translate one path-shaped value into distro coordinates: UNC identities map
 * onto their Linux paths, drive-letter paths onto their `/mnt/<drive>` mounts,
 * everything else passes through verbatim.
 *
 * @param {string} value - the value to translate.
 * @returns {string} the distro-side spelling.
 */
export function distroPath(value: string): string;
/**
 * Whether a workspace root belongs to a distro (and therefore routes
 * distro-side).
 *
 * @param {string} workspaceRoot - the scope's workspace root, any coordinate system.
 * @returns {boolean} true for a `\\wsl.localhost\<distro>` UNC root.
 */
export function isDistroWorkspace(workspaceRoot: string): boolean;
/**
 * The Linux working path for one request: UNC absolutes map onto their Linux
 * paths, POSIX absolutes and relative paths join onto the root.
 *
 * @param {string} linuxRoot - the workspace root in Linux form.
 * @param {string} path - the requested path, any coordinate system.
 * @returns {string} the absolute Linux path.
 */
export function linuxJoin(linuxRoot: string, path: string): string;
/**
 * The record invocation for one path: line 1 is the no-follow kind (the
 * upstream lstat gate), line 2 the follow-stat fields (the upstream final
 * stat), tab-joined.
 *
 * @param {string} file - absolute Linux path.
 * @returns {string[]} the agent argv.
 */
export function statRecordArgv(file: string): string[];
/**
 * Parse one stat record (kind + follow fields, tab-joined).
 *
 * @param {string|Buffer} line - the record line.
 * @returns {{kind: string, type: string, size: number, version: string}} the upstream kind spelling, the byte size, and the synthesized
 *   opaque version.
 */
export function parseStatRecord(line: string | Buffer): {
    kind: string;
    type: string;
    size: number;
    version: string;
};
/**
 * Map a `stat` kind onto the wire's kind token.
 *
 * @param {string} kind - the `stat -c %F` spelling.
 * @returns {string} the wire kind token.
 */
export function wireKind(kind: string): string;
/**
 * The read invocation for one line-paged text read: the stat record rides
 * stderr (the caller builds the stat half of the response), the page rides
 * stdout — one line beyond the page, so EOF is decidable from the yield.
 * `$1` is the file, `$2` the 1-based first line, `$3` the line count.
 *
 * @param {string} file - absolute Linux path.
 * @param {number} offset - first line to return (1-based).
 * @param {number} limit - maximum lines to return.
 * @returns {string[]} the agent argv.
 */
export function pageArgv(file: string, offset: number, limit: number): string[];
/**
 * The byte-window invocation: the stat record rides stderr, the window rides
 * stdout. `$1` is the file, `$2` the byte offset, `$3` the byte count.
 *
 * @param {string} file - absolute Linux path.
 * @param {number} offset - byte offset (0-based).
 * @param {number} length - byte count.
 * @returns {string[]} the agent argv.
 */
export function bytesArgv(file: string, offset: number, length: number): string[];
/**
 * Parse the stat record a read or byte-window relayed on stderr.
 *
 * @param {string|Buffer} stderr - the relay's raw stderr.
 * @returns {{kind: string, type: string, size: number, version: string}|undefined} the parsed stat record, or undefined when stderr carries none.
 */
export function parseStatRecordFromStderr(stderr: string | Buffer): {
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
 * @param {string} linuxRoot - the workspace root in Linux form (containment boundary).
 * @param {string} linuxDir - the directory to list.
 * @param {number} maxEntries - the caller's entry cap.
 * @returns {string[]} the agent argv.
 */
export function listDistroArgv(linuxRoot: string, linuxDir: string, maxEntries: number): string[];
/**
 * Parse one capped `ls -1ALp` listing into wire entries.
 *
 * @param {string|Buffer} stdout - the listing's raw stdout.
 * @param {number} maxEntries - the entry cap the caller configured.
 * @returns {{entries: Array<{name: string, type: "file"|"directory"}>, truncated: boolean}} at most `maxEntries` entries and whether the level had more.
 */
export function parseDirListing(stdout: string | Buffer, maxEntries: number): {
    entries: Array<{
        name: string;
        type: "file" | "directory";
    }>;
    truncated: boolean;
};
