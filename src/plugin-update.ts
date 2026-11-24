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
import { readFileSync } from "node:fs";
import {
  inspectVersions,
  PACKAGE,
  setUpdateFact,
  type ListedVersion,
  type PluginManagerSlice,
  type VersionCheck,
} from "./update-check.js";

export const name = "wsl-plugin-update";

/** The one route the panel fetches; it must live under the `/api` channel. */
export const PLUGIN_UPDATE_PATH = "/api/wsl-env/plugin-update";

/** How long a version answer stays fresh before a panel load re-reads it. */
export const DEFAULT_CACHE_MS = 10 * 60 * 1000;

export const Config = z.object({
  /** How long a version answer stays fresh, in milliseconds. */
  cacheMs: z.natural().default(DEFAULT_CACHE_MS),
});

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
  readonly error?: { readonly code?: string, readonly diagnostic?: string } | undefined;
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
  updateBundle: (
    name: string,
    version: string,
    options?: { readonly registry?: string | null },
  ) => Promise<UpdateBundleResult>;
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
  error?: { code?: string, diagnostic?: string };
  /** Package scripts awaiting explicit approval in the profile. */
  pendingBuilds?: readonly string[];
  /** Why the reinstallation of the old version failed, when it did. */
  restoreError?: { code?: string, diagnostic?: string };
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

/** One cached version answer. */
interface CachedCheck {
  readonly at: number;
  readonly check: VersionCheck;
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
 * Read this package's version from the manifest beside `lib/`.
 * @returns the version, or undefined when the manifest is unreadable.
 */
function packageVersion(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The version this process loaded. A successful one-click upgrade replaces
 * the manifest before the old module graph is gone, so the panel must be able
 * to say "installed X, running Y" until the app reloads.
 */
const RUNNING_VERSION = packageVersion() ?? "unknown";

/**
 * The version installed on disk now; it moves after an upgrade while
 * {@link RUNNING_VERSION} stays at the loaded generation until a reload.
 *
 * @returns the manifest's version, or the loaded one when the file cannot be read.
 */
export function installedVersion(): string {
  return packageVersion() ?? RUNNING_VERSION;
}

/** The version this process loaded. */
export function runningVersion(): string {
  return RUNNING_VERSION;
}

/**
 * The update-capable slice of a manager, when it has one. A host from before
 * `updateBundle` still answers version checks; it just cannot offer the click.
 * @param manager - the host plugin-manager, or undefined.
 * @returns the manager with its updater, or undefined.
 */
function updaterOf(manager: PluginManagerSlice | undefined): UpdateManagerSlice | undefined {
  if (manager === undefined) return undefined;
  const candidate = manager as Partial<UpdateManagerSlice>;
  return typeof candidate.updateBundle === "function" ? candidate as UpdateManagerSlice : undefined;
}

/**
 * One JSON response with the route's own no-store policy.
 * @param body - the JSON-serializable value.
 * @param status - the HTTP status.
 * @returns a JSON response.
 */
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

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
export function createPluginUpdateHandler(options: PluginUpdateHandlerOptions): PluginUpdateHandler {
  const now = options.now ?? (() => Date.now());
  const installed = options.installed ?? installedVersion;
  const running = options.running ?? RUNNING_VERSION;
  /** One cached check; `at` is the clock read when the check started. */
  let cache: CachedCheck | undefined;
  /** A check already in flight, so two panel loads share one registry round-trip. */
  let inflight: Promise<VersionCheck> | undefined;
  /** One update at a time; a second click must not start a second removal/install pair. */
  let updating = false;

  const currentCheck = async (refresh: boolean): Promise<{ check: VersionCheck, cached: boolean }> => {
    if (!refresh && cache !== undefined && now() - cache.at < options.cacheMs) {
      return { check: cache.check, cached: true };
    }
    if (inflight !== undefined) return { check: await inflight, cached: false };
    const manager = options.manager();
    const at = now();
    const pending = inspectVersions(manager, installed(), at);
    inflight = pending;
    try {
      const check = await pending;
      // A missing manager is cheap to re-read, and a host can gain one at
      // runtime; everything else (including a registry refusal) is cached.
      if (!(check.status === "unavailable" && check.problem === "no-manager")) cache = { at, check };
      return { check, cached: false };
    } finally {
      inflight = undefined;
    }
  };

  const viewOf = (check: VersionCheck, cached: boolean, updateSupported: boolean): PluginVersionView => ({
    installed: installed(),
    running,
    status: check.status,
    checkedAt: check.checkedAt,
    cached,
    updateSupported,
    canUpdate: check.status === "available" && updateSupported && check.latest.incompatible === undefined,
    ...(check.status === "unavailable" ? { problem: check.problem, reason: check.reason } : {}),
    ...(check.status === "available" ? { registry: check.registry, latest: check.latest } : {}),
    ...(check.status === "current" ? { registry: check.registry } : {}),
  });

  /**
   * Read the version answer, including the panel's auto-check on first load.
   * @param refresh - whether to ignore a fresh cache entry.
   * @returns the session's JSON response.
   */
  const read = async (refresh: boolean): Promise<Response> => {
    try {
      const { check, cached } = await currentCheck(refresh);
      return json(viewOf(check, cached, updaterOf(options.manager()) !== undefined));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  };

  /**
   * Run the one-click upgrade. The target is the check's installable stable
   * release; `updateBundle` re-validates existence, bundle declaration, and
   * compatibility, and performs the removal/install/rollback itself.
   * @returns the session's JSON response.
   */
  const update = async (): Promise<Response> => {
    if (updating) return json({ error: "An update is already running" }, 409);
    const manager = options.manager();
    if (manager === undefined) {
      return json({ error: "The host has no plugin-manager; update from the Plugins page" }, 503);
    }
    const updater = updaterOf(manager);
    if (updater === undefined) {
      return json({ error: "This plugin-manager cannot update bundles; update from the Plugins page" }, 501);
    }
    // The lock is taken BEFORE the first await. Taken after the version
    // check it guarded only the install: that check is a registry round trip
    // — seconds, on a cold or stale cache — and two clicks inside it each
    // passed the test above and each ran their own removal and install.
    updating = true;
    try {
      let check: VersionCheck;
      try {
        check = (await currentCheck(false)).check;
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
      if (check.status === "current") return json({ error: "The installed version is up to date" }, 409);
      if (check.status === "unavailable") return json({ error: `No update target: ${check.reason}` }, 409);
      if (check.latest.incompatible !== undefined) {
        return json({ error: "The latest release requires a newer DSH; upgrade DeepSeek Harness first" }, 409);
      }
      const result = await updater.updateBundle(PACKAGE, check.latest.version, { registry: check.registry });
      cache = undefined;
      const application = result.result.application;
      // `overridden` still installed the target; the host reports it when a
      // higher-priority profile layer overrides the bundle selection.
      const updated = result.step === "install" && application !== "failed" && application !== "cancelled";
      if (updated) setUpdateFact(undefined);
      const restoreError = result.restore?.error;
      return json({
        updated,
        application,
        from: result.from,
        to: result.to,
        step: result.step,
        installed: installed(),
        running,
        checkedAt: now(),
        ...(result.result.restartReason === undefined ? {} : { restartReason: result.result.restartReason }),
        ...(result.restore === undefined ? {} : { restored: result.restore.application === "applied" }),
        ...(result.result.error === undefined ? {} : {
          error: {
            ...(result.result.error.code === undefined ? {} : { code: result.result.error.code }),
            ...(result.result.error.diagnostic === undefined ? {} : { diagnostic: result.result.error.diagnostic }),
          },
        }),
        ...(result.result.pendingBuilds === undefined ? {} : { pendingBuilds: result.result.pendingBuilds }),
        ...(restoreError === undefined ? {} : {
          restoreError: {
            ...(restoreError.code === undefined ? {} : { code: restoreError.code }),
            ...(restoreError.diagnostic === undefined ? {} : { diagnostic: restoreError.diagnostic }),
          },
        }),
      } satisfies PluginUpdateReply);
    } catch (error) {
      cache = undefined;
      return json({ error: error instanceof Error ? error.message : String(error) }, 502);
    } finally {
      updating = false;
    }
  };

  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ error: "Only GET and POST are supported" }, 405);
    }
    if (request.method === "GET") {
      const refresh = new URL(request.url).searchParams.get("refresh") === "1";
      return read(refresh);
    }
    return update();
  };
}

/**
 * Mount the row: register the route once the Host connection is available.
 *
 * A composition without `connection` (headless, ACP) leaves the row inert —
 * the same posture the status row takes.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export function apply(ctx: PluginUpdateContext, config: PluginUpdateConfig = {}): void {
  if (typeof ctx.inject !== "function") return;
  ctx.inject(["connection"], (scope) => {
    const connection = scope.connection ?? (scope.get?.("connection") as ConnectionFace | undefined);
    if (connection === undefined || typeof connection.fetch?.register !== "function") return;
    const manager = (): PluginManagerSlice | undefined =>
      (ctx.get?.("pluginManager") ?? scope.get?.("pluginManager")) as PluginManagerSlice | undefined;
    const handler = createPluginUpdateHandler({
      manager,
      cacheMs: config.cacheMs ?? DEFAULT_CACHE_MS,
      installed: installedVersion,
      running: RUNNING_VERSION,
    });
    const dispose = connection.fetch.register({
      path: PLUGIN_UPDATE_PATH,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: handler,
    });
    scope.effect?.(() => () => { void dispose(); }, `wsl-plugin-update: ${PLUGIN_UPDATE_PATH}`);
  });
}
