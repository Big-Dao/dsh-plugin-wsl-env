/** One directory row, as the browse seam's client types define it. @typedef {import("@deepseek-ai/dsh-host-directory-picker").DirectoryEntry} DirectoryEntry */
/** One directory level plus its ancestry, as a browse backend reports it. @typedef {import("@deepseek-ai/dsh-host-directory-picker").DirectoryListing} DirectoryListing */
/** The browse interaction shape this backend reports through {@link WslDirectoryPicker#capability}. @typedef {import("@deepseek-ai/dsh-host-directory-picker").DirectoryPickerBrowseCapability} BrowseCapability */
/**
 * The resolved service configuration, as {@link WslDirectoryPicker.Config} yields.
 *
 * @typedef {object} PickerConfig
 * @property {string} wslPath - path to `wsl.exe`; overridable for a non-standard install.
 * @property {string} preferredDistro - distro listed first and used for the Home
 *   affordance; empty means WSL's own default distro.
 * @property {boolean} includeHostHome - whether the Windows home is also offered
 *   at the root level.
 * @property {number} maxEntries - bound on the directory rows one `list` call may
 *   return; the level is flagged truncated beyond it.
 * @property {number} distroCacheMs - how long a resolved distro list stays fresh.
 */
/**
 * Await `operation`, but reject with the signal's reason the moment it aborts.
 * Node's filesystem reads are not retractable, so the operation itself keeps
 * running against a handle the caller then closes; its late settlement is
 * swallowed so an abandoned read cannot surface as an unhandled rejection.
 *
 * @template T
 * @param {Promise<T>} operation - the in-flight filesystem step.
 * @param {AbortSignal} [signal] - caller lifetime; absent means plain awaiting.
 * @returns {Promise<T>} the operation's value.
 */
export function raceAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T>;
/**
 * The `ctx.directoryPicker` WSL implementation.
 *
 * The capability object is built once per service lifetime because consumers may
 * capture it across calls.
 */
export class WslDirectoryPicker extends DirectoryPicker {
    static Config: z<Schemastery.ObjectS<NoInfer<{
        /** Path to `wsl.exe`; overridable for a non-standard install. */
        wslPath: z<string, string, "defined">;
        /**
         * Distro listed first and used for the Home affordance. Empty means WSL's
         * own default distro.
         */
        preferredDistro: z<string, string, "defined">;
        /**
         * Also offer the Windows home directory at the root level, so a normal
         * host folder stays reachable without typing a path. The dialog's editable
         * path zone accepts any Windows path either way.
         */
        includeHostHome: z<boolean, boolean, "defined">;
        /** Bound on the directory rows one `list` call may return; the level is flagged truncated. */
        maxEntries: z<number, number, "defined">;
        /** How long a resolved distro list stays fresh. */
        distroCacheMs: z<number, number, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /** Path to `wsl.exe`; overridable for a non-standard install. */
        wslPath: z<string, string, "defined">;
        /**
         * Distro listed first and used for the Home affordance. Empty means WSL's
         * own default distro.
         */
        preferredDistro: z<string, string, "defined">;
        /**
         * Also offer the Windows home directory at the root level, so a normal
         * host folder stays reachable without typing a path. The dialog's editable
         * path zone accepts any Windows path either way.
         */
        includeHostHome: z<boolean, boolean, "defined">;
        /** Bound on the directory rows one `list` call may return; the level is flagged truncated. */
        maxEntries: z<number, number, "defined">;
        /** How long a resolved distro list stays fresh. */
        distroCacheMs: z<number, number, "defined">;
    }>>, "plain">;
    /**
     * @param {import("@deepseek-ai/cordis").Context} ctx - the owning context.
     * @param {PickerConfig} config - the resolved {@link WslDirectoryPicker.Config}.
     */
    constructor(ctx: import("@deepseek-ai/cordis").Context, config: PickerConfig);
    config: PickerConfig;
    /** Last distro listing, so navigating to the root does not spawn `wsl.exe` every time. */
    distroCache: {
        at: number;
        value: string[];
    } | undefined;
    /** Per-distro Linux home, resolved once (a distro's default user does not change under a running session). */
    homeCache: Map<any, any>;
    /**
     * The browse interaction capability.
     *
     * Deliberately `browse` and not a `wsl` kind: see the module comment. The
     * distro listing is exposed as {@link WslDirectoryPicker.distros} for
     * programmatic callers instead of through the capability union, because a
     * capability kind the wire controller does not recognise would disable the
     * verbs above rather than add a new one.
     *
     * @returns {BrowseCapability} the stable `browse` capability object.
     */
    capability(): BrowseCapability;
    /** @type {BrowseCapability} */
    browseCapability: BrowseCapability;
    /**
     * Installed distros, cached briefly.
     * @param {AbortSignal} [signal] - optional cancellation.
     * @returns {Promise<string[]>} distro names, default distro first.
     */
    distros(signal?: AbortSignal): Promise<string[]>;
    /**
     * The distro this picker leads with: the configured one when installed, else
     * WSL's default, else the first installed.
     * @param {AbortSignal} [signal] - optional cancellation.
     * @returns {Promise<string>} a distro name, or empty when none is installed.
     */
    preferredDistro(signal?: AbortSignal): Promise<string>;
    /**
     * A distro's Linux home directory as a UNC path, best effort: a distro that
     * cannot be queried (stopped, and unable to start) falls back to its root so
     * the dialog still opens somewhere real.
     *
     * @param {string} distro - distro name.
     * @param {AbortSignal} [signal] - optional cancellation.
     * @returns {Promise<string>} the UNC home path.
     */
    homeOf(distro: string, signal?: AbortSignal): Promise<string>;
    /**
     * The root level: one row per installed distro, plus the Windows home when
     * configured. `path` is the preferred distro's root rather than the share
     * root, so adopting the level with nothing selected still yields a real
     * directory; the breadcrumb's "WSL" row carries the share root and returns
     * here.
     *
     * @param {AbortSignal} [signal] - optional cancellation.
     * @returns {Promise<DirectoryListing>} the root listing.
     */
    rootLevel(signal?: AbortSignal): Promise<DirectoryListing>;
    /**
     * Breadcrumb rows for a level, headed by the WSL row.
     * @param {string} target - the directory being listed.
     * @returns {DirectoryEntry[]} breadcrumb rows.
     */
    crumbsFor(target: string): DirectoryEntry[];
    /**
     * List one directory level.
     * @param {string} [path] - absolute directory; absent or the share root lists the distros.
     * @param {AbortSignal} [signal] - caller lifetime.
     * @returns {Promise<DirectoryListing>} the level's listing with its ancestry.
     * @throws DirectoryPickerError with code `directory-unreadable`.
     */
    list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>;
    /**
     * List one level inside the distro, where the files live.
     *
     * The resident agent answers in one round trip; when it is out — distro
     * stopped, or the resident's rebuild budget spent — the same `ls` runs
     * through a one-shot `wsl.exe`. Neither path touches the 9p share, which is
     * what the host walk it replaces used: one metadata round trip per entry,
     * in the share's slow direction, plus one more per symlink.
     *
     * @param {string} target - the absolute UNC directory to list.
     * @param {AbortSignal} [signal] - caller lifetime.
     * @returns {Promise<{rows: DirectoryEntry[], truncated: boolean}>} the level's
     *   rows and truncation flag.
     * @throws DirectoryPickerError with code `directory-unreadable`.
     */
    listDistroLevel(target: string, signal?: AbortSignal): Promise<{
        rows: DirectoryEntry[];
        truncated: boolean;
    }>;
    /**
     * List one Windows level with the host's own walk — native I/O on a native
     * filesystem, unchanged from the shipped browse behaviour.
     * @param {string} target - the absolute Windows directory to list.
     * @param {AbortSignal} [signal] - caller lifetime.
     * @returns {Promise<{rows: DirectoryEntry[], truncated: boolean}>} the level's
     *   rows and truncation flag.
     * @throws DirectoryPickerError with code `directory-unreadable`.
     */
    listHostLevel(target: string, signal?: AbortSignal): Promise<{
        rows: DirectoryEntry[];
        truncated: boolean;
    }>;
    /**
     * Create one child directory inside the listed level.
     * @param {string} path - absolute existing parent directory.
     * @param {string} name - single non-blank path segment.
     * @returns {Promise<string>} the created directory's absolute path.
     * @throws DirectoryPickerError with code `directory-exists` or `directory-create-failed`.
     */
    createDirectory(path: string, name: string): Promise<string>;
    /**
     * Create one child directory inside the distro — the resident agent's
     * `mkdir` when it is up, a one-shot `wsl.exe --exec mkdir` when it is out;
     * the host's `mkdir` over the 9p share is what this replaces.
     *
     * @param {string} parent - the absolute UNC parent directory.
     * @param {string} name - the validated single path segment to create.
     * @param {string} target - the UNC path the caller receives on success.
     * @returns {Promise<string>} the created directory's absolute path.
     * @throws DirectoryPickerError with code `directory-exists` or `directory-create-failed`.
     */
    createDistroDirectory(parent: string, name: string, target: string): Promise<string>;
}
export default WslDirectoryPicker;
/**
 * One directory row, as the browse seam's client types define it.
 */
export type DirectoryEntry = import("@deepseek-ai/dsh-host-directory-picker").DirectoryEntry;
/**
 * One directory level plus its ancestry, as a browse backend reports it.
 */
export type DirectoryListing = import("@deepseek-ai/dsh-host-directory-picker").DirectoryListing;
/**
 * The browse interaction shape this backend reports through {@link WslDirectoryPicker#capability}.
 */
export type BrowseCapability = import("@deepseek-ai/dsh-host-directory-picker").DirectoryPickerBrowseCapability;
/**
 * The resolved service configuration, as {@link WslDirectoryPicker.Config} yields.
 */
export type PickerConfig = {
    /**
     * - path to `wsl.exe`; overridable for a non-standard install.
     */
    wslPath: string;
    /**
     * - distro listed first and used for the Home
     * affordance; empty means WSL's own default distro.
     */
    preferredDistro: string;
    /**
     * - whether the Windows home is also offered
     * at the root level.
     */
    includeHostHome: boolean;
    /**
     * - bound on the directory rows one `list` call may
     * return; the level is flagged truncated beyond it.
     */
    maxEntries: number;
    /**
     * - how long a resolved distro list stays fresh.
     */
    distroCacheMs: number;
};
import { DirectoryPicker } from "@deepseek-ai/dsh-host-directory-picker";
import z from "@deepseek-ai/schemastery";
export { ancestryCrumbs, boundedInsert, breadcrumbs, fullyQualified } from "./listing.js";
