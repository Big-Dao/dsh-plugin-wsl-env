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
 * harness is a posture this plugin rejects. The sidebar's plugin-update row
 * exposes the same answer and a confirmed one-click upgrade; this module owns
 * the check itself and the fact the shell-env row serves.
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
export declare const name = "wsl-update-check";
/** The checked package: this plugin, by its npm name. */
export declare const PACKAGE = "dsh-plugin-wsl-env";
/** The interval the row ships with. */
export declare const DEFAULT_INTERVAL_MS: number;
/** The smallest interval a config may ask for; one check spawns `pnpm view` in the profile. */
export declare const MIN_INTERVAL_MS: number;
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** Whether the update check runs at all. */
    enabled: z<boolean, boolean, "defined">;
    /** How often the registry is asked, in milliseconds; floored at one minute. */
    intervalMs: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** Whether the update check runs at all. */
    enabled: z<boolean, boolean, "defined">;
    /** How often the registry is asked, in milliseconds; floored at one minute. */
    intervalMs: z<number, number, "defined">;
}>>, "plain">;
/** The config schema's validated output. */
interface UpdateCheckConfig {
    /** Whether the update check runs at all. */
    enabled?: boolean;
    /** How often the registry is asked, in milliseconds. */
    intervalMs?: number;
}
/** One published version, reduced to what the fact reads (host plugin-manager types). */
export interface ListedVersion {
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
    readonly incompatible?: {
        reason?: string;
    } | undefined;
}
/** What one check learned, in the two shapes `listVersions` answers (host plugin-manager types). */
export type VersionList = {
    readonly status: "listed";
    readonly installed: string;
    readonly registry: string | null;
    readonly attempts: readonly unknown[];
    /** Published versions newer than `installed`, newest first. */
    readonly versions: readonly ListedVersion[];
    readonly omitted: number;
} | {
    readonly status: "refused";
    readonly problem: "not-updatable" | "not-found" | "network" | "unknown";
    readonly reason: string;
    readonly attempts: readonly unknown[];
};
/** Why a check could not produce a version list. */
export type VersionProblem = "no-manager" | Extract<VersionList, {
    status: "refused";
}>["problem"];
/**
 * What one version check learned, for the panel's version card. Unlike
 * {@link UpdateFact}, this keeps the "up to date" answer and the reasons a
 * check learned nothing, so the panel can say which of the three happened.
 */
export type VersionCheck = {
    readonly status: "available";
    readonly installed: string;
    readonly checkedAt: number;
    readonly registry: string | null;
    readonly latest: ListedVersion;
} | {
    readonly status: "current";
    readonly installed: string;
    readonly checkedAt: number;
    readonly registry: string | null;
} | {
    readonly status: "unavailable";
    readonly installed: string;
    readonly checkedAt: number;
    readonly problem: VersionProblem;
    readonly reason: string;
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
 * The newest update fact this process has published, or undefined when no
 * check ran, the registry said "up to date", or the last check learned
 * nothing actionable.
 *
 * @returns the fact, for `shellEnv`'s synchronous resolver.
 */
export declare function currentUpdateFact(): UpdateFact | undefined;
/**
 * Publish (or clear) the update fact. Exported for the tests, which must be
 * able to stage a fact without a host plugin-manager — the same "tests-only"
 * carve-out as `clearNativeBackendCache`.
 *
 * @param next - the fact to publish, or undefined to clear.
 */
export declare function setUpdateFact(next: UpdateFact | undefined): void;
/**
 * The interval a config asks for, floored at {@link MIN_INTERVAL_MS}. A check
 * spawns `pnpm view` in the profile, so a tight loop would hammer the
 * registry; the floor makes even `0` safe.
 *
 * @param ms - the configured interval, or undefined for the default.
 * @returns the interval the scheduler uses.
 */
export declare function clampInterval(ms: number | undefined): number;
/**
 * How long after mount the first check waits: two to ten minutes, jittered.
 * The delay keeps the check off the startup path (a cold start must not wait
 * on a registry round-trip) and off the startup stampede of `pnpm` work the
 * profile is already doing.
 *
 * @param random - the randomness source, injectable for tests.
 * @returns the delay in milliseconds.
 */
export declare function firstDelayMs(random?: () => number): number;
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
export declare function updateTarget(list: Extract<VersionList, {
    status: "listed";
}>): ListedVersion | undefined;
/**
 * Run one version check and publish (or clear) the shell-environment fact.
 *
 * The fact is the only observable for the periodic check, so the three
 * outcomes are handled together: an available target publishes it, an
 * up-to-date list clears a stale one, and a non-answer (no manager, a refused
 * list, a throwing service) leaves the previous fact standing. A check must
 * never become the noisiest thing in the app, so none of these throws.
 *
 * @param manager - the host plugin-manager, or undefined when the host has none.
 * @param installed - the installed version to name when the host has no manager.
 * @param now - the check's timestamp, injectable for tests.
 * @returns what the check learned.
 */
export declare function inspectVersions(manager: PluginManagerSlice | undefined, installed: string, now?: number): Promise<VersionCheck>;
/**
 * Run one check against the host's plugin-manager and publish the fact.
 * Concurrent callers share the one in-flight read, so a slow listing is never
 * queried twice and no stale result overwrites the newer fact.
 *
 * @param manager - the host plugin-manager, or undefined when the host has none.
 * @returns the published fact, or undefined when the check learned nothing.
 */
export declare function checkForUpdate(manager: PluginManagerSlice | undefined): Promise<UpdateFact | undefined>;
/**
 * The fact as one line, for the managed `DSH_*` variable and the log. The
 * wording is the same the doctor's section reuses, so "available" never
 * drifts between the two surfaces.
 *
 * @param update - the fact, or undefined.
 * @returns the message, or an empty string when there is nothing to say.
 */
export declare function updateFactMessage(update: UpdateFact | undefined): string;
/**
 * The cordis context extended with the slices this service consumes. `logger`
 * and `pluginManager` belong to the harness, whose declarations are not
 * visible to this plugin, so they are spelled structurally on top of the
 * framework's {@link Context}.
 */
type UpdateCheckContext = Context & {
    logger?: {
        debug?: (message: string) => void;
    };
    pluginManager?: PluginManagerSlice;
};
/**
 * Mount the update check.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export declare function apply(ctx: UpdateCheckContext, config?: UpdateCheckConfig): Promise<void>;
export {};
