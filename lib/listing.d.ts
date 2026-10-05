/**
 * One picker row: a display name, its jump target, and the dot-entry flag.
 *
 * @typedef {object} ListingRow
 * @property {string} name - the row's display name.
 * @property {string} path - the row's jump target, Windows spelling.
 * @property {boolean} hidden - whether the entry is a dot-entry.
 */
/**
 * Whether a path names one fixed filesystem location regardless of process
 * state. On Windows only drive-qualified (`C:\…`) or complete UNC
 * (`\\server\share…`) forms qualify — which is what lets a distro root like
 * `\\wsl.localhost\ubuntu` be adopted as a workspace, while the bare share root
 * `\\wsl.localhost` is correctly rejected as a directory.
 *
 * @param {string} path - candidate path.
 * @returns {boolean} whether the path is fully qualified.
 */
export function fullyQualified(path: string): boolean;
/**
 * Ancestor chain from the filesystem root to `target` inclusive — the
 * breadcrumb rows of a listing, every one a jump target. On a UNC path the walk
 * terminates at the share root, whose `dirname` is itself.
 *
 * The `win32` flavour is explicit, not the platform default: these helpers
 * serve Windows paths only, and the bare `node:path` functions are POSIX on
 * Linux, where a UNC path parses as a single relative segment and the chain
 * collapses to `['.', <whole path>]`. Walking up from inside a distro also
 * yields the share root WITH its trailing separator (`\\wsl.localhost\ubuntu\`)
 * — canonicalized by {@link breadcrumbs}, and asserted by the tests.
 *
 * `win32.basename` of a drive root (`C:\`) is empty, so the root crumb falls
 * back to its own path rather than rendering blank.
 *
 * @param {string} target - an absolute Windows path.
 * @returns {ListingRow[]} the ancestry, outermost first.
 */
export function ancestryCrumbs(target: string): ListingRow[];
/**
 * Breadcrumb rows for a level, with the WSL share head prepended for anything
 * inside a distro.
 *
 * Two Windows path quirks make this more than a relabel. `win32.dirname` treats
 * `\\server\share` as a volume root and never yields the share itself, so the
 * WSL row has to be synthesized; and `win32.basename` of that same share root is
 * the empty string, so the distro row is named from the parsed distro instead.
 * Without both fixes, browsing into a distro would render a blank breadcrumb and
 * offer no way back to the distro list.
 *
 * @param {string} target - the directory being listed.
 * @param {string} providerRoot - the share root acting as the WSL row's jump target.
 * @returns {ListingRow[]} breadcrumb rows, outermost first.
 */
export function breadcrumbs(target: string, providerRoot: string): ListingRow[];
/**
 * Insert a streamed candidate into the name-sorted bounded window, evicting the
 * name-largest candidate when the window exceeds `keep`. Keeps memory O(keep)
 * regardless of how many children a level holds, so a pathological directory
 * cannot make the picker allocate one row per entry.
 *
 * @template {{name: string}} T
 * @param {T[]} window - the name-ascending window, mutated in place.
 * @param {T} candidate - the streamed candidate to place.
 * @param {number} keep - the window bound.
 * @returns {boolean} true when an eviction happened (the level has more candidates).
 */
export function boundedInsert<T extends {
    name: string;
}>(window: T[], candidate: T, keep: number): boolean;
/**
 * The distro-side argv one picker level is listed with.
 *
 * `-1` is one entry per line, `-A` keeps dot-entries but drops `.` and `..`,
 * `-L` follows symlinks so a link to a directory reports as a directory and a
 * broken link drops out (exactly what the per-entry `stat` the host path used
 * to pay one 9p round trip for), and `-p` marks directories with the trailing
 * `/` the parser keys on.
 *
 * @param {string} linuxDir - the absolute Linux directory to list.
 * @returns {string[]} the argv for the agent or a `wsl.exe --exec` launch.
 */
export function lsListingArgv(linuxDir: string): string[];
/**
 * Parse one `ls -1ALp` listing into the picker's rows.
 *
 * A line is a row when it ends with `/` — a directory, or a symlink `-L`
 * resolved to one; files and dangling links are skipped, matching the host
 * path's behaviour. The parse reads the listing as UTF-8 lines, so a filename
 * containing a newline would split into two rows — the same limitation class
 * the one-shot transport has always had, accepted here with the 9p walk it
 * replaces.
 *
 * @param {string|Buffer} stdout - the listing's raw stdout.
 * @param {string} parent - the listed directory, in the UNC form the rows carry.
 * @param {number} maxEntries - the row bound; a level with more is flagged truncated.
 * @returns {{rows: ListingRow[], truncated: boolean}} the first `maxEntries` rows and whether the level had more.
 */
export function parseLsListing(stdout: string | Buffer, parent: string, maxEntries: number): {
    rows: ListingRow[];
    truncated: boolean;
};
/**
 * One picker row: a display name, its jump target, and the dot-entry flag.
 */
export type ListingRow = {
    /**
     * - the row's display name.
     */
    name: string;
    /**
     * - the row's jump target, Windows spelling.
     */
    path: string;
    /**
     * - whether the entry is a dot-entry.
     */
    hidden: boolean;
};
