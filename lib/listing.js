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
import { win32 } from "node:path";
import { isWslUnc, uncToPosix } from "./paths.js";
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
export function fullyQualified(path) {
    return win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path);
}
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
export function ancestryCrumbs(target) {
    const crumbs = [];
    let current = target;
    for (;;) {
        const parent = win32.dirname(current);
        // `basename` of a volume root is empty (`C:\`), so the root crumb falls
        // back to its own path rather than rendering blank.
        crumbs.unshift({ name: win32.basename(current) || current, path: current, hidden: false });
        if (parent === current)
            return crumbs;
        current = parent;
    }
}
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
export function breadcrumbs(target, providerRoot) {
    const crumbs = ancestryCrumbs(target);
    const head = crumbs[0];
    if (head === undefined)
        return [{ name: "WSL", path: providerRoot, hidden: false }];
    const parsed = isWslUnc(head.path) ? uncToPosix(head.path) : undefined;
    if (parsed !== undefined && parsed.linuxPath === "/") {
        // `win32.dirname` reports the share root with a trailing separator
        // (`\\wsl.localhost\ubuntu\`); rewrite the row to the canonical distro root
        // so crumb paths match what distroRoot() and the picker produce elsewhere.
        crumbs[0] = { name: parsed.distro, path: `${providerRoot}\\${parsed.distro}`, hidden: false };
        crumbs.unshift({ name: "WSL", path: providerRoot, hidden: false });
    }
    return crumbs;
}
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
export function boundedInsert(window, candidate, keep) {
    const last = window.at(-1);
    if (window.length === keep && last !== undefined && candidate.name.localeCompare(last.name) >= 0)
        return true;
    let lo = 0;
    let hi = window.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const midRow = window[mid];
        // mid < hi <= window.length, so the row is always defined; the check is
        // for the checker, and it ends the search instead of throwing if that
        // invariant were ever broken.
        if (midRow === undefined)
            break;
        if (candidate.name.localeCompare(midRow.name) < 0)
            hi = mid;
        else
            lo = mid + 1;
    }
    window.splice(lo, 0, candidate);
    if (window.length <= keep)
        return false;
    window.pop();
    return true;
}
/**
 * The distro-side argv one picker level is listed with.
 *
 * `-1` is one entry per line, `-A` keeps dot-entries but drops `.` and `..`,
 * `-L` follows symlinks so a link to a directory reports as a directory and a
 * broken link drops out (exactly what the per-entry `stat` the host path used
 * to pay one 9p round trip for), and `-p` marks directories with the trailing
 * `/` the parser keys on.
 *
 * @param linuxDir - the absolute Linux directory to list.
 * @returns the argv for the agent or a `wsl.exe --exec` launch.
 */
export function lsListingArgv(linuxDir) {
    return ["ls", "-1ALp", "--", linuxDir];
}
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
 * @param stdout - the listing's raw stdout.
 * @param parent - the listed directory, in the UNC form the rows carry.
 * @param maxEntries - the row bound; a level with more is flagged truncated.
 * @returns the first `maxEntries` rows and whether the level had more.
 */
export function parseLsListing(stdout, parent, maxEntries) {
    const rows = [];
    let truncated = false;
    for (const line of String(stdout).split("\n")) {
        if (!line.endsWith("/"))
            continue;
        const name = line.slice(0, -1);
        if (name.length === 0)
            continue;
        if (rows.length === maxEntries) {
            truncated = true;
            break;
        }
        rows.push({ name, path: win32.join(parent, name), hidden: name.startsWith(".") });
    }
    return { rows, truncated };
}
