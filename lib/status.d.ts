/**
 * The sidebar panel's diagnostic route (`GET`/`POST /api/wsl-env/status`).
 *
 * The panel is a status/config surface, and the authoritative environment
 * verdict is the doctor's. A browser plugin cannot reach a plugin-private Host
 * method (the Client Remote assembly fixes its namespaces at build time), but
 * it can reach an **authenticated exact Fetch route** on the `/api` channel:
 * `ctx.connection.fetch.register` is the same seam the shipped Session-log and
 * file routes use, it admits only the owner Peer, and it needs no generated
 * wire schema. This row therefore publishes two answers:
 *
 *   - `GET /api/wsl-env/status` — the installed distros (from `wsl.exe -l -q`,
 *     which starts nothing) plus the last successful verdict per distro,
 *     restored from the store below;
 *   - `GET /api/wsl-env/status?distro=<name>` — one distro's quick doctor
 *     report, digested to the same shape the `/wsl-doctor` command renders;
 *   - `POST /api/wsl-env/status?distro=<name>` — the panel's repair action: a
 *     full doctor run with `--fix-owned`, which sweeps stale session scopes
 *     and purges a broken agent cache, then re-verifies both and answers with
 *     the same digest plus the `fix.*` rows. Nothing outside the plugin's own
 *     state is touched (no packages, no Windows git config), so the panel
 *     stays a diagnostic surface that can heal its own residue.
 *
 * The doctor runs as the standalone CLI subprocess, exactly as the command row
 * runs it, so a diagnosis still answers when the plugin's own module graph is
 * what is broken. Runs are cached per distro for `cacheMs`; `refresh=1` drops
 * the entry. A check is only ever started by an explicit click in the panel:
 * probing a stopped distro boots it, which a page load must not do to every
 * installed distro.
 *
 * The last result per distro — success or failure — is persisted to
 * `$DSH_HOME/cache/dsh-plugin-wsl-env/status.json` (falling back to `~/.dsh`),
 * so a page reload or an app restart still shows what the last check found and
 * when. `source` records whether that run came from an explicit panel action
 * or from the page-load background refresh; a failed background run overwrites
 * the stored result exactly as it was observed. Results are never labeled
 * expired: the timestamp is the timestamp, and the row's check button is the
 * next step. Writing is best-effort — a read-only home degrades to the
 * in-memory cache rather than failing the diagnosis.
 *
 * This is a TypeScript source built to `lib/status.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/status
 */
import z from "@deepseek-ai/schemastery";
import { type DoctorDigest } from "./wsl-doctor-tool.js";
export declare const name = "wsl-status";
/** The one route the panel fetches; it must live under the `/api` channel. */
export declare const STATUS_PATH = "/api/wsl-env/status";
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** How long one distro's quick verdict stays fresh, in milliseconds. */
    cacheMs: z<number, number, "defined">;
    /** Deadline for one scoped quick doctor run, in milliseconds. */
    timeoutMs: z<number, number, "defined">;
    /** `wsl.exe` to list the distros; keep in step with the providers' `wslPath`. */
    wslPath: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** How long one distro's quick verdict stays fresh, in milliseconds. */
    cacheMs: z<number, number, "defined">;
    /** Deadline for one scoped quick doctor run, in milliseconds. */
    timeoutMs: z<number, number, "defined">;
    /** `wsl.exe` to list the distros; keep in step with the providers' `wslPath`. */
    wslPath: z<string, string, "defined">;
}>>, "plain">;
/** The config schema's validated output. */
export interface StatusConfig {
    /** How long one distro's quick verdict stays fresh, in milliseconds. */
    cacheMs?: number;
    /** Deadline for one scoped quick doctor run, in milliseconds. */
    timeoutMs?: number;
    /** `wsl.exe` to list the distros. */
    wslPath?: string;
}
/** The CLI runner seam: argv in, one JSON report out. */
type DoctorCli = (argv: string[], signal?: AbortSignal, timeoutMs?: number) => Promise<string>;
/** One warning the report carried: advisory, not blocking. */
export interface StatusWarning {
    /** The check id. */
    id: string;
    /** What the check saw. */
    detail: string;
    /** The remedy the CLI printed, when it printed one. */
    remedy?: string;
}
/** One repair the doctor performed (or attempted), as the panel consumes it. */
export interface StatusRepair {
    /** The doctor's fix check id: `fix.scopes` or `fix.cache`. */
    id: string;
    /** What was attempted. */
    title: string;
    /** The doctor's status: `ok` when the fresh probe verified it, `warn` otherwise. */
    status: string;
    /** The before → after evidence. */
    detail: string;
    /** What to do when the repair did not take. */
    remedy?: string;
}
/** One check row, as the panel's expandable detail renders it. */
export interface StatusCheck {
    /** The check id. */
    id: string;
    /** The check's display name. */
    title: string;
    /** The doctor's status: `ok`, `warn`, `fail`, `info`, `skipped` or `unknown`. */
    status: string;
    /** What the check saw. */
    detail: string;
    /** The remedy the CLI printed, when it printed one. */
    remedy?: string;
    /** The doctor section the check belongs to, for grouping. */
    section: string;
}
/** One distro's verdict, as the panel consumes it. */
export interface DistroStatusView {
    /** The distro the verdict belongs to. */
    distro: string;
    /** `ready` and `blocked` come from the report; `error` means the run failed. */
    verdict: "ready" | "blocked" | "error";
    /** Whether this answer came from the repair action (a full `--fix-owned` run). */
    repaired: boolean;
    /** The doctor's fix rows: what the repair did and whether it verified. */
    repairs: StatusRepair[];
    /**
     * The findings `--fix-owned` can act on right now: `runtime.scopes` with
     * stale units, `agent.cache` with unusable entries, and `agent.handshake`
     * when the cache explains it. Everything else is manual — its remedy is
     * the next step, and the panel must not offer a repair that cannot apply.
     */
    repairable: string[];
    /** Unix epoch milliseconds of the run. */
    checkedAt: number;
    /** Every failing check with the remedy the CLI printed. */
    failures: Array<{
        id: string;
        detail: string;
        remedy: string;
    }>;
    /** Every warning check, so a ready verdict still shows what to look at. */
    warnings: StatusWarning[];
    /**
     * The result's structure: how many checks landed in each status. Synthetic
     * "not run in this scope" rows and the repair's own `fix.*` rows are
     * excluded, so the numbers describe the environment this distro answered.
     */
    counts: {
        ok: number;
        warn: number;
        fail: number;
        info: number;
        skipped: number;
        unknown: number;
    };
    /** Per-section tallies, in the doctor's section order. */
    sections: DoctorDigest["sections"];
    /**
     * Every check this run executed, with its result — the panel's expandable
     * "details" list. Synthetic "not run in this scope" rows are excluded (the
     * `notRun` count speaks for them), so a row never claims a check it did not
     * run.
     */
    checks: StatusCheck[];
    /**
     * Catalog checks a scoped run never executed. Zero for a full run: its
     * unlisted catalog ids are conditional checks that did not fire, not a
     * coverage gap to advertise.
     */
    notRun: number;
    /** The report's unresolved blocker ids. */
    blockers: string[];
    /** Whether the answer came from the persisted or in-memory cache. */
    cached?: boolean;
    /**
     * Who started the run: an explicit panel action (`user`) or the page-load
     * refresh for an already-running distro (`background`). Persisted with the
     * result so a reload still says where the check came from.
     */
    source: "user" | "background";
    /** Why the run failed, when `verdict` is `error`. */
    error?: string;
}
/** The answer to a list request. */
export interface DistroListReply {
    /** Installed distro names, WSL's own order. */
    distros: string[];
    /** The installed distros that are running now; only these may be refreshed in the background. */
    running: string[];
    /** The last stored verdict per installed distro, complete so a reload keeps its details. */
    cached: DistroStatusView[];
}
/** The route handler this module publishes. */
export type StatusHandler = (request: Request) => Promise<Response>;
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
/**
 * The context slice this row consumes. `inject`/`effect` are Cordis fiber
 * methods; the optional seams exist so the handler and registration are
 * unit-testable without a boot.
 */
interface StatusContext {
    /** Optional cordis-style lookup: how production resolves the connection. */
    get?: (name: string) => unknown;
    /** Wait for a service, then run the callback in its scope. */
    inject?: (deps: readonly string[], callback: (scope: StatusContext) => void) => unknown;
    /** Own one disposer on the calling fiber. */
    effect?: (callback: () => () => void, label?: string) => unknown;
    /** The Host connection whose `/api` channel carries the route. */
    connection?: ConnectionFace;
}
/** The handler options a test builds directly. */
export interface StatusHandlerOptions {
    /** How long a verdict stays fresh. */
    cacheMs: number;
    /** Deadline for one run. */
    timeoutMs: number;
    /** Installed distro names, WSL's order. */
    distros: () => Promise<string[]>;
    /** The CLI runner. */
    runCli: DoctorCli;
    /** Clock seam. */
    now?: () => number;
    /** Where the last results persist; `""` disables persistence. */
    statePath?: string;
    /** Running distro names, for the panel's background refresh. */
    running?: () => Promise<string[]>;
}
/**
 * Build the route handler.
 *
 * One handler owns one cache, so the row registers exactly one instance and an
 * unload drops every verdict with it.
 *
 * @param options - the distro, runner, and cache seams.
 * @returns the request handler.
 */
export declare function createStatusHandler(options: StatusHandlerOptions): StatusHandler;
/**
 * Mount the row: register the route once the Host connection is available.
 *
 * A composition without `connection` (headless, ACP) leaves the row inert —
 * the same posture the other surface rows take.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated config.
 */
export declare function apply(ctx: StatusContext, config?: StatusConfig): void;
export {};
