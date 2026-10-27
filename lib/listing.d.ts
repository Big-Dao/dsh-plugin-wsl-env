/**
 * Pure listing helpers for the WSL directory picker, kept dependency-free so
 * they can be unit-tested without installing the DSH peers the service itself
 * imports. Ported from `@deepseek-ai/dsh-host-directory-picker-browse` so the
 * picker behaves exactly like the shipped browse backend on ordinary paths.
 *
 * This is a TypeScript source built to `lib/listing.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/listing
 */
/** One picker row: a display name, its jump target, and the dot-entry flag. */
export interface ListingRow {
    /** The row's display name. */
    name: string;
    /** The row's jump target, Windows spelling. */
    path: string;
    /** Whether the entry is a dot-entry. */
    hidden: boolean;
}
/**
 * Whether a path names one fixed filesystem location regardless of process
 * state. On Windows only drive-qualified (`C:\…`) or complete UNC
 * (`\\server\share…`) forms qualify — which is what lets a distro root like
 * `\\wsl.localhost\ubuntu` be adopted as a workspace, while the bare share root
 * `\\wsl.localhost` is correctly rejected as a directory.
 *
 * @param path - candidate path.
 * @returns whether the path is fully qualified.
 */
export declare function fullyQualified(path: string): boolean;
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
 * @param target - an absolute Windows path.
 * @returns the ancestry, outermost first.
 */
export declare function ancestryCrumbs(target: string): ListingRow[];
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
 * @param target - the directory being listed.
 * @param providerRoot - the share root acting as the WSL row's jump target.
 * @returns breadcrumb rows, outermost first.
 */
export declare function breadcrumbs(target: string, providerRoot: string): ListingRow[];
/**
 * Insert a streamed candidate into the name-sorted bounded window, evicting the
 * name-largest candidate when the window exceeds `keep`. Keeps memory O(keep)
 * regardless of how many children a level holds, so a pathological directory
 * cannot make the picker allocate one row per entry.
 *
 * @template {{name: string}} T
 * @param window - the name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has more candidates).
 */
export declare function boundedInsert<T extends {
    name: string;
}>(window: T[], candidate: T, keep: number): boolean;
/**
 * The distro-side argv one picker level is listed with.
 *
 * `-L` follows symlinks so a link to a directory reports as a directory and a
 * broken link drops out (exactly what the per-entry `stat` the host path used
 * to pay one 9p round trip for); `-maxdepth 1` keeps the listing to one level;
 * `-mindepth 1` drops the start point the way `ls -A` dropped `.` and `..`;
 * `-type d` keeps only enterable rows; `-print0` separates entries with NUL —
 * a filename containing a newline arrives whole instead of splitting into two
 * rows, which is the bug that retired the `ls -1ALp` line parse (WSL-306).
 * `find` is unsorted; the parser sorts.
 *
 * Busybox find (Alpine) supports every flag here — verified on alpine:3,
 * debian:stable-slim and fedora:latest with a newline-named fixture.
 *
 * @param linuxDir - the absolute Linux directory to list.
 * @returns the argv for the agent or a `wsl.exe --exec` launch.
 */
export declare function dirListingArgv(linuxDir: string): string[];
/**
 * Parse one `find -print0` listing into the picker's rows.
 *
 * Entries arrive NUL-separated as `<linuxDir>/<name>`; the linuxDir prefix is
 * stripped to recover the bare name (the root listing's `/name` form
 * included). `find` is unsorted, so the names are sorted host-side — a
 * deterministic code-point order, which is what the picker shows. The first
 * `maxEntries` names become rows; a level with more is flagged truncated.
 *
 * @param stdout - the listing's raw stdout.
 * @param linuxDir - the absolute Linux directory that was listed (the argv's
 * own spelling — the prefix stripped from every entry).
 * @param parent - the listed directory, in the UNC form the rows carry.
 * @param maxEntries - the row bound; a level with more is flagged truncated.
 * @returns the first `maxEntries` rows and whether the level had more.
 */
export declare function parseDirListing(stdout: string | Buffer, linuxDir: string, parent: string, maxEntries: number): {
    rows: ListingRow[];
    truncated: boolean;
};
