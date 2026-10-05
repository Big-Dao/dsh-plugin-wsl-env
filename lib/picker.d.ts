/**
 * WSL-aware directory picker: the `ctx.directoryPicker` backend that makes the
 * Web GUI's "Select Workspace Directory" dialog open inside a distro.
 *
 * ## Why this serves `kind: 'browse'` instead of declaring a `wsl` kind
 *
 * The seam's capability is a merge-extensible discriminated union, so adding a
 * `wsl` kind looks like the natural move. It does not work, and the reason is
 * worth stating plainly: the capability is **not** what crosses the wire.
 * `dsh-api-workspace-controller` exposes exactly three Remote verbs and pins
 * each to a literal kind —
 *
 *     pick(signal)             -> requireCapability('native', 'pick')
 *     list(path, signal)       -> requireCapability('browse', 'list')
 *     createDirectory(...)     -> requireCapability('browse', 'createDirectory')
 *
 * — and refuses anything else with `directory-picker/unavailable`. A backend
 * reporting `{ kind: 'wsl', ... }` would therefore break the very verbs it
 * needs, because `requireCapability('browse', ...)` would no longer match. The
 * wire vocabulary lives in a shipped, versioned package inside `app.asar`, so
 * adding a third kind means patching an asar package that the next app update
 * overwrites.
 *
 * Serving `browse` is not a workaround, it is the fit: `browse`'s primitives are
 * "list one absolute directory level" and "create one child directory", which is
 * exactly what browsing a distro needs. The only thing the shipped browse
 * backend lacks is *discoverability* of WSL — it opens at the Windows home
 * directory. This backend closes that gap:
 *
 *   - the root level lists the installed distros (`wsl.exe -l -q`), so WSL is
 *     the entry point rather than something you must know a UNC path for;
 *   - the breadcrumb "WSL" row jumps back to that distro list;
 *   - the dialog's Home affordance targets the preferred distro's Linux `$HOME`;
 *   - every other level inside a distro is listed BY THE DISTRO — the resident
 *     agent's `ls` when it is up, a one-shot `wsl.exe --exec ls` when it is
 *     out — because the host's own listing used to walk the 9p share in its
 *     slow direction, one metadata round trip per entry; a Windows path keeps
 *     the host's own walk, which is native there.
 *
 * Because the client surface is unchanged, this row composes with the **shipped**
 * `@deepseek-ai/dsh-client-ui-directory-picker-browse` dialog: no client code,
 * no wire change, no asar patch.
 *
 * This is a TypeScript source built to `lib/picker.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/picker
 */
import z from "@deepseek-ai/schemastery";
import { DirectoryPicker } from "@deepseek-ai/dsh-host-directory-picker";
import type { Context } from "@deepseek-ai/cordis";
import type { DirectoryEntry, DirectoryListing, DirectoryPickerBrowseCapability } from "@deepseek-ai/dsh-host-directory-picker";
/**
 * The resolved service configuration, as {@link WslDirectoryPicker.Config} yields.
 */
export interface PickerConfig {
    /** Path to `wsl.exe`; overridable for a non-standard install. */
    wslPath: string;
    /**
     * Distro listed first and used for the Home affordance; empty means WSL's
     * own default distro.
     */
    preferredDistro: string;
    /**
     * Whether the Windows home is also offered at the root level.
     */
    includeHostHome: boolean;
    /**
     * Bound on the directory rows one `list` call may return; the level is
     * flagged truncated beyond it.
     */
    maxEntries: number;
    /** How long a resolved distro list stays fresh. */
    distroCacheMs: number;
}
/**
 * Await `operation`, but reject with the signal's reason the moment it aborts.
 * Node's filesystem reads are not retractable, so the operation itself keeps
 * running against a handle the caller then closes; its late settlement is
 * swallowed so an abandoned read cannot surface as an unhandled rejection.
 *
 * @template T
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export declare function raceAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T>;
/**
 * The `ctx.directoryPicker` WSL implementation.
 *
 * The capability object is built once per service lifetime because consumers may
 * capture it across calls.
 */
export declare class WslDirectoryPicker extends DirectoryPicker {
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
    /** The resolved {@link WslDirectoryPicker.Config}. */
    config: PickerConfig;
    /** Last distro listing, so navigating to the root does not spawn `wsl.exe` every time. */
    distroCache: {
        at: number;
        value: string[];
    } | undefined;
    /** Per-distro Linux home, resolved once (a distro's default user does not change under a running session). */
    homeCache: Map<string, string>;
    /**
     * @param ctx - the owning context.
     * @param config - the resolved {@link WslDirectoryPicker.Config}.
     */
    constructor(ctx: Context, config: PickerConfig);
    /**
     * The browse interaction capability.
     *
     * Deliberately `browse` and not a `wsl` kind: see the module comment. The
     * distro listing is exposed as {@link WslDirectoryPicker.distros} for
     * programmatic callers instead of through the capability union, because a
     * capability kind the wire controller does not recognise would disable the
     * verbs above rather than add a new one.
     *
     * @returns the stable `browse` capability object.
     */
    capability(): DirectoryPickerBrowseCapability;
    browseCapability: DirectoryPickerBrowseCapability;
    /**
     * Installed distros, cached briefly.
     *
     * @param signal - optional cancellation.
     * @returns distro names, default distro first.
     */
    distros(signal?: AbortSignal): Promise<string[]>;
    /**
     * The distro this picker leads with: the configured one when installed, else
     * WSL's default, else the first installed.
     *
     * @param signal - optional cancellation.
     * @returns a distro name, or empty when none is installed.
     */
    preferredDistro(signal?: AbortSignal): Promise<string>;
    /**
     * A distro's Linux home directory as a UNC path, best effort: a distro that
     * cannot be queried (stopped, and unable to start) falls back to its root so
     * the dialog still opens somewhere real.
     *
     * @param distro - distro name.
     * @param signal - optional cancellation.
     * @returns the UNC home path.
     */
    homeOf(distro: string, signal?: AbortSignal): Promise<string>;
    /**
     * The root level: one row per installed distro, plus the Windows home when
     * configured. `path` is the preferred distro's root rather than the share
     * root, so adopting the level with nothing selected still yields a real
     * directory; the breadcrumb's "WSL" row carries the share root and returns
     * here.
     *
     * @param signal - optional cancellation.
     * @returns the root listing.
     */
    rootLevel(signal?: AbortSignal): Promise<DirectoryListing>;
    /**
     * Breadcrumb rows for a level, headed by the WSL row.
     *
     * @param target - the directory being listed.
     * @returns breadcrumb rows.
     */
    crumbsFor(target: string): DirectoryEntry[];
    /**
     * List one directory level.
     *
     * @param path - absolute directory; absent or the share root lists the distros.
     * @param signal - caller lifetime.
     * @returns the level's listing with its ancestry.
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
     * @param target - the absolute UNC directory to list.
     * @param signal - caller lifetime.
     * @returns the level's rows and truncation flag.
     * @throws DirectoryPickerError with code `directory-unreadable`.
     */
    listDistroLevel(target: string, signal?: AbortSignal): Promise<{
        rows: DirectoryEntry[];
        truncated: boolean;
    }>;
    /**
     * List one Windows level with the host's own walk — native I/O on a native
     * filesystem, unchanged from the shipped browse behaviour.
     *
     * @param target - the absolute Windows directory to list.
     * @param signal - caller lifetime.
     * @returns the level's rows and truncation flag.
     * @throws DirectoryPickerError with code `directory-unreadable`.
     */
    listHostLevel(target: string, signal?: AbortSignal): Promise<{
        rows: DirectoryEntry[];
        truncated: boolean;
    }>;
    /**
     * Create one child directory inside the listed level.
     *
     * @param path - absolute existing parent directory.
     * @param name - single non-blank path segment.
     * @returns the created directory's absolute path.
     * @throws DirectoryPickerError with code `directory-exists` or `directory-create-failed`.
     */
    createDirectory(path: string, name: string): Promise<string>;
    /**
     * Create one child directory inside the distro — the resident agent's
     * `mkdir` when it is up, a one-shot `wsl.exe --exec mkdir` when it is out;
     * the host's `mkdir` over the 9p share is what this replaces.
     *
     * @param parent - the absolute UNC parent directory.
     * @param name - the validated single path segment to create.
     * @param target - the UNC path the caller receives on success.
     * @returns the created directory's absolute path.
     * @throws DirectoryPickerError with code `directory-exists` or `directory-create-failed`.
     */
    createDistroDirectory(parent: string, name: string, target: string): Promise<string>;
}
export default WslDirectoryPicker;
export { ancestryCrumbs, boundedInsert, breadcrumbs, fullyQualified } from "./listing.js";
