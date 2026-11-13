/**
 * The plugin's update check: notice when a newer release exists, stop there.
 *
 * Upgrading today means re-installing by hand (the Plugins page) and the
 * harness's own plugin-manager already answers
 * "which versions exist and do they fit this DSH" — `listVersions` resolves
 * dist-tags, deprecation, and the `engines.dsh`/peer compatibility of every
 * candidate against the running DSH. This service makes that answer arrive
 * without the user opening the Versions page first: on a slow timer it asks
 * the host's `pluginManager` for this package's version list and, when the
 * stable channel has moved, publishes one fact. Applying the update stays a
 * user action — a plugin that silently replaces its own code under a running
 * harness is a posture this plugin rejects, and the harness has no HMR, so
 * even a correct swap needs a restart to take effect.
 *
 * Delegation is the whole network story: the check spawns nothing and fetches
 * nothing itself. `pluginManager` is read with `ctx.get`, the sanctioned read
 * for a service this row does not inject — a host without it (or a bundle
 * loaded from a linked checkout, which `listVersions` refuses as
 * `not-updatable` because the mirror is managed by `pnpm run sync:windows`)
 * simply means no check ran, at debug level, never a warning.
 *
 * This is a TypeScript source built to `lib/update-check.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/update-check
 */

import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";

export const name = "wsl-update-check";

/** The checked package: this plugin, by its npm name. */
const PACKAGE = "dsh-plugin-wsl-env";

/** The interval the row ships with. */
export const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The smallest interval a config may ask for; one check spawns `pnpm view` in the profile. */
export const MIN_INTERVAL_MS = 60 * 1000;

export const Config = z.object({
  /** Whether the update check runs at all. */
  enabled: z.boolean().default(true),
  /** How often the registry is asked, in milliseconds; floored at one minute. */
  intervalMs: z.number().default(DEFAULT_INTERVAL_MS),
});

/** The config schema's validated output. */
interface UpdateCheckConfig {
  /** Whether the update check runs at all. */
  enabled?: boolean;
  /** How often the registry is asked, in milliseconds. */
  intervalMs?: number;
}

/** One published version, reduced to what the fact reads (host plugin-manager types). */
interface ListedVersion {
  readonly version: string;
  readonly publishedAt?: string;
  readonly tags: readonly string[];
  /** Whether the version carries a semver prerelease suffix. */
  readonly prerelease: boolean;
  /** The registry's deprecation message, when the version is deprecated. */
  readonly deprecated?: string;
  /** A version without the bundle manifest cannot replace this bundle. */
  readonly bundle: boolean;
  /** Present when the running DSH rejects this version's engines/peers. */
  readonly incompatible?: { reason?: string } | undefined;
}

/** What one check learned, in the two shapes `listVersions` answers (host plugin-manager types). */
export type VersionList =
  | {
    readonly status: "listed";
    readonly installed: string;
    readonly registry: string;
    readonly attempts: readonly unknown[];
    /** Published versions newer than `installed`, newest first. */
    readonly versions: readonly ListedVersion[];
    readonly omitted: number;
  }
  | {
    readonly status: "refused";
    readonly problem: "not-updatable" | "not-found" | "network" | "unknown";
    readonly reason: string;
    readonly attempts: readonly unknown[];
  };

/**
 * The slice of the host's plugin-manager this row calls. The service belongs
 * to the harness and its declaration is not visible to this plugin, so it is
 * spelled structurally; `versions` are newer than the installed one, newest
 * first (see `packages/boot/plugin-manager/src/types.ts` upstream).
 */
export interface PluginManagerSlice {
  listVersions: (name: string) => Promise<VersionList>;
}

/** The update fact one successful check publishes. */
interface UpdateFact {
  /** The version this process runs. */
  installed: string;
  /** The version the stable channel offers. */
  latest: string;
  /** When the registry published it, as an ISO 8601 string. */
  publishedAt?: string;
  /** The running DSH rejects this version; upgrading means upgrading DSH first. */
  incompatible: boolean;
  /** The registry's deprecation message, when the newest release is deprecated. */
  deprecated?: string;
  /** When the check ran, in epoch milliseconds. */
  checkedAt: number;
}

/**
 * The module-level fact store. `shellEnv`'s resolver is synchronous by
 * contract, so the timer-fed fact must live somewhere a plain import can read
 * without await — the same posture as the ports snapshot, and the same
 * module-singleton pattern as the shared agent (`lib/agent-shared.js`).
 */
let fact: UpdateFact | undefined;

/**
 * The newest update fact this process has published, or undefined when no
 * check ran, the registry said "up to date", or the last check learned
 * nothing actionable.
 *
 * @returns the fact, for `shellEnv`'s synchronous resolver.
 */
export function currentUpdateFact(): UpdateFact | undefined {
  return fact;
}

/**
 * Publish (or clear) the update fact. Exported for the tests, which must be
 * able to stage a fact without a host plugin-manager — the same "tests-only"
 * carve-out as `clearNativeBackendCache`.
 *
 * @param next - the fact to publish, or undefined to clear.
 */
export function setUpdateFact(next: UpdateFact | undefined): void {
  fact = next;
}

/**
 * The interval a config asks for, floored at {@link MIN_INTERVAL_MS}. A check
 * spawns `pnpm view` in the profile, so a tight loop would hammer the
 * registry; the floor makes even `0` safe.
 *
 * @param ms - the configured interval, or undefined for the default.
 * @returns the interval the scheduler uses.
 */
export function clampInterval(ms: number | undefined): number {
  return Math.max(ms ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS);
}

/**
 * How long after mount the first check waits: two to ten minutes, jittered.
 * The delay keeps the check off the startup path (a cold start must not wait
 * on a registry round-trip) and off the startup stampede of `pnpm` work the
 * profile is already doing.
 *
 * @param random - the randomness source, injectable for tests.
 * @returns the delay in milliseconds.
 */
export function firstDelayMs(random: () => number = Math.random): number {
  return 120_000 + random() * 480_000;
}

/**
 * Pick the version the fact should name: the stable channel's newest release
 * (`latest` tag) that is still a bundle. Prereleases ship on `next` by the
 * release discipline and never move `latest`, so they are not news; a version
 * that lost the bundle manifest could not be installed as an update. The list
 * is newest-first, so the first match is the newest.
 *
 * @param list - the version list `listVersions` answered with.
 * @returns the target version, or undefined when the stable channel has not moved.
 */
export function updateTarget(list: Extract<VersionList, { status: "listed" }>): ListedVersion | undefined {
  return list.versions.find((version) => version.bundle && version.tags.includes("latest"));
}

/**
 * Run one check against the host's plugin-manager and publish the fact.
 *
 * Every non-answer is quiet by design: a missing manager, a linked checkout
 * (`not-updatable`), a registry the host cannot reach (`network`), or a stable
 * channel that has not moved all leave the previous fact (or none) standing —
 * an update check must never become the noisiest thing in the app.
 *
 * @param manager - the host plugin-manager, or undefined when the host has none.
 * @returns the published fact, or undefined when the check learned nothing.
 */
export async function checkForUpdate(manager: PluginManagerSlice | undefined): Promise<UpdateFact | undefined> {
  if (manager === undefined) return undefined;
  let list: VersionList;
  try {
    list = await manager.listVersions(PACKAGE);
  } catch {
    // `listVersions` resolves refusals into its result; a throw means the
    // service itself is broken. The next tick retries; nothing is published.
    return undefined;
  }
  if (list.status !== "listed") return undefined;
  const target = updateTarget(list);
  if (target === undefined) {
    setUpdateFact(undefined);
    return undefined;
  }
  const next: UpdateFact = {
    installed: list.installed,
    latest: target.version,
    ...(target.publishedAt === undefined ? {} : { publishedAt: target.publishedAt }),
    incompatible: target.incompatible !== undefined,
    ...(target.deprecated === undefined ? {} : { deprecated: target.deprecated }),
    checkedAt: Date.now(),
  };
  setUpdateFact(next);
  return next;
}

/**
 * The fact as one line, for the managed `DSH_*` variable and the log. The
 * wording is the same the doctor's section reuses, so "available" never
 * drifts between the two surfaces.
 *
 * @param update - the fact, or undefined.
 * @returns the message, or an empty string when there is nothing to say.
 */
export function updateFactMessage(update: UpdateFact | undefined): string {
  if (update === undefined) return "";
  const marks: string[] = [];
  if (update.incompatible) marks.push("requires a newer DSH first");
  if (update.deprecated !== undefined) marks.push(`deprecated: ${update.deprecated}`);
  const tail = marks.length === 0 ? "" : ` — ${marks.join("; ")}`;
  return `${update.latest} available (installed ${update.installed})${tail}`;
}

/**
 * The cordis context extended with the slices this service consumes. `logger`
 * and `pluginManager` belong to the harness, whose declarations are not
 * visible to this plugin, so they are spelled structurally on top of the
 * framework's {@link Context}.
 */
type UpdateCheckContext = Context & {
  logger?: {
    debug?: (message: string) => void,
  },
  pluginManager?: PluginManagerSlice,
};

/**
 * Mount the update check.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export async function apply(ctx: UpdateCheckContext, config: UpdateCheckConfig = {}): Promise<void> {
  if (!(config.enabled ?? true)) return;
  const intervalMs = clampInterval(config.intervalMs);
  const debug = (message: string) => ctx.logger?.debug?.(message);

  const tick = async (): Promise<void> => {
    try {
      // The read is the cordis-sanctioned one for a service this row does not
      // inject: `ctx.get` answers undefined when the host has no
      // plugin-manager (a headless harness, a bare composition), where a
      // property read would throw and mark the whole component failed.
      const manager = ctx.get("pluginManager") as UpdateCheckContext["pluginManager"];
      if (manager === undefined) {
        debug("wsl-update-check: the host has no plugin-manager; the check is skipped");
        return;
      }
      const published = await checkForUpdate(manager);
      if (published === undefined) {
        debug("wsl-update-check: no newer stable release (or the registry was unreachable)");
        return;
      }
      debug(`wsl-update-check: ${updateFactMessage(published)}`);
    } catch (error) {
      // A check that cannot run is a next tick's business, never a session's
      // error: the timer swallows everything at debug level.
      debug(`wsl-update-check: the check failed (${(error as Error)?.message ?? error})`);
    }
  };

  const first = setTimeout(() => void tick(), firstDelayMs());
  const repeat = setInterval(() => void tick(), intervalMs);
  first.unref?.();
  repeat.unref?.();

  // Disposing matters: a config hot-reload re-runs apply(), and two live
  // timers would double the registry traffic.
  ctx.effect(() => () => {
    clearTimeout(first);
    clearInterval(repeat);
  });
}
