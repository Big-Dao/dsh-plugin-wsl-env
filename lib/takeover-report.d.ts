/**
 * The in-app doctor's effective-provider check for the three root-plane
 * takeovers.
 *
 * The plugin replaces `subprocess`, `fs` and `directoryPicker` by disabling
 * the shipped rows and mounting same-name providers. That swap can fail at
 * runtime — most visibly on a HMR plugin upgrade, where the outgoing bundle
 * layer re-activates the shipped rows before the incoming layer disables them
 * again (see docs/UPSTREAM-SERVICE-SWAP.md). The failed rows leave no log line
 * a user reads, and the doctor's standalone CLI cannot see live services at
 * all, so the in-app surfaces inspect the context instead and report which
 * provider is serving each name.
 *
 * `missing` for one name only is possible in a composition that intentionally
 * disables the row; the check stays silent when NONE of the three is served,
 * which is the shape of every context that cannot see the composition root
 * (the test seam, a preset realm, the standalone CLI).
 *
 * This is a TypeScript source built to `lib/takeover-report.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated.
 *
 * @module dsh-plugin-wsl-env/takeover-report
 */
/** The service names this plugin replaces with its own providers. */
export declare const TAKEOVER_SERVICES: readonly ["subprocess", "fs", "directoryPicker"];
/** One replaced service name. */
export type TakeoverService = (typeof TAKEOVER_SERVICES)[number];
/** Which provider currently serves one takeover name. */
export interface TakeoverSnapshot {
    /** The service name. */
    readonly service: TakeoverService;
    /** `plugin` — this plugin's class; `other` — a different provider; `missing` — none. */
    readonly state: "plugin" | "other" | "missing";
    /** The other provider's constructor name, when it has one. */
    readonly provider?: string;
}
/** The context face the snapshot needs: an optional service lookup. */
export interface TakeoverContext {
    /** Read a service; absent means the caller cannot observe one. */
    get?: (name: string) => unknown;
}
/** The report fields {@link mergeTakeoverReport} reads and rewrites. */
export interface TakeoverMergeReport {
    /** The report's check rows. */
    checks?: Array<{
        id: string;
        status: string;
        title?: string;
        detail?: string;
        remedy?: string;
        distro?: string;
        blocksFirstCommand?: boolean;
    }>;
    /** The per-status tally. */
    summary?: Record<string, number>;
}
/**
 * Read which provider serves each takeover name in this context.
 *
 * A context that cannot look services up (a test seam, the standalone CLI
 * report) yields an empty snapshot, and the merge then adds no row.
 *
 * @param ctx - the context to inspect.
 * @returns one entry per takeover name, in {@link TAKEOVER_SERVICES} order.
 */
export declare function takeoverSnapshot(ctx: TakeoverContext): TakeoverSnapshot[];
/**
 * Fold the effective-provider snapshot into a doctor report as one check.
 *
 * A context that cannot see any of the three services adds no row: it has no
 * evidence about the takeovers, and inventing a finding would be noise in
 * every preset realm and every unit test. When at least one service is
 * served, the row names all three so a single `warn` says exactly which half
 * of the swap landed.
 *
 * @param report - the doctor report (not mutated).
 * @param snapshot - {@link takeoverSnapshot}'s answer.
 * @returns the report with the `providers.takeover` row appended, when it has evidence.
 */
export declare function mergeTakeoverReport<T extends TakeoverMergeReport>(report: T, snapshot: readonly TakeoverSnapshot[]): T;
