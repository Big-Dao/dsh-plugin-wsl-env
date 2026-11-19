/**
 * The sidebar panel's plugin route: version information, update availability,
 * and the confirmed one-click upgrade.
 *
 * The version answer is the host plugin-manager's, not ours: `listVersions`
 * resolves dist-tags, deprecation, and the `engines.dsh`/peer compatibility of
 * every candidate against the running DSH, and `updateBundle` performs the
 * replacement with the profile's normal package manager rules (bundle
 * selection, exact version, rollback). This row only gives the panel a
 * browser-reachable, authenticated exact-Fetch route to that service:
 *
 *   - `GET /api/wsl-env/plugin-update` — the installed and running version,
 *     the latest stable release that can replace it, and the last check's
 *     outcome. A stale answer is re-read; `refresh=1` forces a fresh check.
 *   - `POST /api/wsl-env/plugin-update` — install that release through
 *     `updateBundle`. It is one click in the panel, never automatic: a plugin
 *     that silently replaces its own code under a running harness is a
 *     posture this plugin rejects.
 *
 * Nothing here fetches the registry or runs pnpm directly. A host without a
 * plugin-manager (or one from before `updateBundle` existed) still gets the
 * installed version and an explanation; a linked checkout is refused by the
 * host as `not-updatable` and the panel points at the Plugins page instead.
 *
 * This is a TypeScript source built to `lib/plugin-update.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/plugin-update
 */
import z from "@deepseek-ai/schemastery";
import { type ListedVersion, type PluginManagerSlice, type VersionCheck } from "./update-check.js";
export declare const name = "wsl-plugin-update";
/** The one route the panel fetches; it must live under the `/api` channel. */
export declare const PLUGIN_UPDATE_PATH = "/api/wsl-env/plugin-update";
/** How long a version answer stays fresh before a panel load re-reads it. */
export declare const DEFAULT_CACHE_MS: number;
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** How long a version answer stays fresh, in milliseconds. */
    cacheMs: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** How long a version answer stays fresh, in milliseconds. */
    cacheMs: z<number, number, "defined">;
}>>, "plain">;
/** The config schema's validated output. */
export interface PluginUpdateConfig {
    /** How long a version answer stays fresh, in milliseconds. */
    cacheMs?: number;
}
/** One application outcome, as the host's plugin-manager reports it. */
export type ChangeApplication = "applied" | "restart-required" | "overridden" | "failed" | "cancelled";
/** One host change result, reduced to what this route reads. */
interface ChangeOutcome {
    readonly changed: boolean;
    readonly application: ChangeApplication;
    readonly restartReason?: string;
    readonly stage: string;
    readonly target: string;
    readonly error?: {
        readonly code?: string;
        readonly diagnostic?: string;
    } | undefined;
    readonly pendingBuilds?: readonly string[];
}
/** What `updateBundle` answers (host plugin-manager types). */
export interface UpdateBundleResult {
    readonly from: string;
    readonly to: string;
    readonly step: "check" | "remove" | "install";
    readonly result: ChangeOutcome;
    readonly restore?: ChangeOutcome | undefined;
}
/** The slice of the host's plugin-manager the one-click upgrade needs. */
export interface UpdateManagerSlice extends PluginManagerSlice {
    /** Replace an installed bundle with one newer exact version. */
    updateBundle: (name: string, version: string, options?: {
        readonly registry?: string | null;
    }) => Promise<UpdateBundleResult>;
}
/** The version answer the panel renders. */
export interface PluginVersionView {
    /** The version installed on disk now. */
    installed: string;
    /** The version this process loaded; it lags `installed` until a reload. */
    running: string;
    /** What the last check learned. */
    status: VersionCheck["status"];
    /** When that check ran, in epoch milliseconds. */
    checkedAt: number;
    /** Whether that answer came from the in-process cache. */
    cached: boolean;
    /** Whether the host's plugin-manager can perform an update. */
    updateSupported: boolean;
    /** Whether the panel may offer the one-click upgrade. */
    canUpdate: boolean;
    /** The registry that answered the check. */
    registry?: string | null;
    /** The installable stable release, when one is available. */
    latest?: ListedVersion;
    /** Why a check produced no answer. */
    problem?: string;
    /** The host's explanation for an unavailable check. */
    reason?: string;
}
/** The POST answer: the host's outcome plus the versions now on disk and in memory. */
export interface PluginUpdateReply {
    /** Whether the target version is now installed. */
    updated: boolean;
    /** The last step's application outcome. */
    application: ChangeApplication;
    /** The version the update started from. */
    from: string;
    /** The version it targeted. */
    to: string;
    /** The last step that ran. */
    step: UpdateBundleResult["step"];
    /** The version installed on disk after the attempt. */
    installed: string;
    /** The version this process still runs. */
    running: string;
    /** When the attempt settled, in epoch milliseconds. */
    checkedAt: number;
    /** Why a successful install needs a restart, when it does. */
    restartReason?: string;
    /** Whether the old version was reinstalled after a failed target install. */
    restored?: boolean;
    /** Why the update could not install its target. */
    error?: {
        code?: string;
        diagnostic?: string;
    };
    /** Package scripts awaiting explicit approval in the profile. */
    pendingBuilds?: readonly string[];
    /** Why the reinstallation of the old version failed, when it did. */
    restoreError?: {
        code?: string;
        diagnostic?: string;
    };
}
/** The route handler this module publishes. */
export type PluginUpdateHandler = (request: Request) => Promise<Response>;
/** One exact route's registration shape. */
interface ConnectionRoute {
    readonly path: string;
    readonly methods: readonly string[];
    readonly requestBody: "buffered" | "streaming";
    readonly fetch: (request: Request) => Promise<Response>;
}
/** The connection slice this row registers into. */
interface ConnectionFace {
    /** The exact-Fetch route registry. */
    readonly fetch: {
        /** Register one exact route; the returned disposer withdraws it. */
        register: (route: ConnectionRoute) => () => Promise<void> | void;
    };
}
/** The context slice this row consumes. */
interface PluginUpdateContext {
    /** Optional cordis-style lookup: how production resolves the connection. */
    get?: (name: string) => unknown;
    /** Wait for a service, then run the callback in its scope. */
    inject?: (deps: readonly string[], callback: (scope: PluginUpdateContext) => void) => unknown;
    /** Own one disposer on the calling fiber. */
    effect?: (callback: () => () => void, label?: string) => unknown;
    /** The Host connection whose `/api` channel carries the route. */
    connection?: ConnectionFace;
}
/** The handler options a test builds directly. */
export interface PluginUpdateHandlerOptions {
    /** The host plugin-manager, or undefined when the host has none. */
    manager: () => PluginManagerSlice | undefined;
    /** How long a version answer stays fresh. */
    cacheMs: number;
    /** Clock seam. */
    now?: () => number;
    /** The installed version, read from this package's manifest. */
    installed?: () => string;
    /** The version this process loaded. */
    running?: string;
}
/**
 * The version installed on disk now; it moves after an upgrade while
 * {@link RUNNING_VERSION} stays at the loaded generation until a reload.
 *
 * @returns the manifest's version, or the loaded one when the file cannot be read.
 */
export declare function installedVersion(): string;
/** The version this process loaded. */
export declare function runningVersion(): string;
/**
 * Build the route handler.
 *
 * One handler owns one cache and one update slot, so the row registers exactly
 * one instance and an unload drops both. The version check is cached for
 * `cacheMs` because one answer costs several `pnpm view` calls in the profile;
 * an update is never cached.
 *
 * @param options - the manager, clock, and cache seams.
 * @returns the request handler.
 */
export declare function createPluginUpdateHandler(options: PluginUpdateHandlerOptions): PluginUpdateHandler;
/**
 * Mount the row: register the route once the Host connection is available.
 *
 * A composition without `connection` (headless, ACP) leaves the row inert —
 * the same posture the status row takes.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export declare function apply(ctx: PluginUpdateContext, config?: PluginUpdateConfig): void;
export {};
