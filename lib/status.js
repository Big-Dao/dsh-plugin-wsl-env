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
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { listDistros, listRunningDistros } from "./wsl.js";
import { digestReport, sectionOf } from "./wsl-doctor-tool.js";
import { runDoctorCli } from "./wsl-doctor-command.js";
import { mergeAutoPresetSeam } from "./doctor-live.js";
export const name = "wsl-status";
/** The one route the panel fetches; it must live under the `/api` channel. */
export const STATUS_PATH = "/api/wsl-env/status";
/** The on-disk schema version. */
const STORE_VERSION = 1;
/**
 * Where the last successful results live: the harness home's cache directory,
 * falling back to `~/.dsh` when the Host process names no home. The panel's
 * guidance must survive a page reload and an app restart; an in-memory cache
 * cannot, because the page's own reload drops the browser state and a plugin
 * reload drops the process state.
 * @returns the absolute path of the status store.
 */
function defaultStatePath() {
    const configured = (process.env.DSH_HOME ?? "").trim();
    const home = configured.length > 0 ? configured : join(homedir(), ".dsh");
    return join(home, "cache", "dsh-plugin-wsl-env", "status.json");
}
export const Config = z.object({
    /** How long one distro's quick verdict stays fresh, in milliseconds. */
    cacheMs: z.natural().default(15_000),
    /** Deadline for one scoped quick doctor run, in milliseconds. */
    timeoutMs: z.natural().min(1).default(90_000),
    /** `wsl.exe` to list the distros; keep in step with the providers' `wslPath`. */
    wslPath: z.string().default("wsl.exe"),
});
/**
 * Read the status store. A missing, unreadable or malformed file is no
 * guidance at all: the handler starts empty and the next check rewrites it.
 * @param path - the store path; empty disables persistence.
 * @returns the parsed store, or undefined.
 */
function readStored(path) {
    if (path.length === 0)
        return undefined;
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (parsed.version !== STORE_VERSION || parsed.distros === null || typeof parsed.distros !== "object")
            return undefined;
        return { version: STORE_VERSION, distros: parsed.distros };
    }
    catch {
        return undefined;
    }
}
/**
 * Write the last successful verdicts atomically. A read-only or missing home
 * must not fail the diagnosis that produced them, so a write error is
 * swallowed: the in-memory answer still reaches the panel.
 * @param path - the store path; empty disables persistence.
 * @param verdicts - the verdicts to persist, keyed by distro.
 */
function writeStored(path, verdicts) {
    if (path.length === 0)
        return;
    const distros = {};
    for (const [distro, entry] of verdicts) {
        const stored = { ...entry.view };
        delete stored.cached;
        distros[distro] = stored;
    }
    try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        writeFileSync(temporary, `${JSON.stringify({ version: STORE_VERSION, distros }, null, 2)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
    }
    catch {
        // Best effort: the result is still served from memory.
    }
}
/**
 * Build the JSON response for one request.
 * @param body - the JSON-serializable value.
 * @param status - the HTTP status.
 * @returns a JSON response.
 */
function json(body, status = 200) {
    return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
/**
 * Count the statuses the report actually produced for this distro, leaving
 * out the digest's synthetic "not run in this scope" catalog rows.
 * @param findings - the report's rows, already stripped of `fix.*` rows.
 * @returns the per-status totals.
 */
function countsOf(findings) {
    const actual = findings.filter((item) => item.distro !== "(not run)");
    const count = (status) => actual.filter((item) => item.status === status).length;
    return {
        ok: count("ok"),
        warn: count("warn"),
        fail: count("fail"),
        info: count("info"),
        skipped: count("skipped"),
        unknown: count("unknown"),
    };
}
/**
 * Digest one parsed doctor report into the panel's shape.
 * @param digest - the shared digest the command and the tool render.
 * @param distro - the distro the report answers for.
 * @param now - the run's timestamp.
 * @param repaired - whether the run was the full `--fix-owned` action.
 * @param source - who started the run.
 * @returns the panel view.
 */
function viewOf(digest, distro, now, repaired, source) {
    // The fix rows are the repair's own narration, not findings about the
    // environment: keep them out of the failure/warning lists so a repair does
    // not double-list its work, and surface them separately.
    // The digest also carries synthetic skip rows for catalog ids the report
    // never emitted (`fix.git-trust` on a quiet run): only the fix rows the
    // doctor actually produced are repairs.
    const fixes = digest.items.filter((item) => item.id.startsWith("fix.") && item.status !== "skipped");
    const findings = digest.items.filter((item) => !item.id.startsWith("fix."));
    // Which findings the plugin-owned repair can actually act on. A repair
    // button that cannot apply is worse than no button: the user sees warnings,
    // clicks "修复", and nothing changes. The cache only explains a failed
    // handshake when the cache is the finding — otherwise the handshake needs a
    // reinstall or a resync, not a purge.
    // A broken cache is `warn` under `agentBackend: auto` and `fail` under
    // `native`; both are plugin-owned and repairable by the purge.
    const cacheBroken = findings.some((item) => item.id === "agent.cache" && (item.status === "warn" || item.status === "fail"));
    const repairable = findings
        .filter((item) => (item.id === "runtime.scopes" && item.status === "warn")
        || (item.id === "agent.cache" && (item.status === "warn" || item.status === "fail"))
        || (item.id === "agent.handshake" && item.status === "fail" && cacheBroken))
        .map((item) => item.id);
    // Every executed check, in report order, grouped later by section. The
    // synthetic catalog rows and the repair's own `fix.*` narration are not
    // findings about this distro, so they stay out.
    const checkRows = findings
        .filter((item) => item.scopeSkip !== true)
        .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        detail: item.detail,
        ...(item.remedy === undefined ? {} : { remedy: item.remedy }),
        section: sectionOf(item.id),
    }));
    return {
        distro,
        verdict: digest.verdict === "ready" ? "ready" : "blocked",
        repaired,
        repairs: repaired
            ? fixes.map((item) => ({
                id: item.id,
                title: item.title,
                status: item.status,
                detail: item.detail,
                ...(item.remedy === undefined ? {} : { remedy: item.remedy }),
            }))
            : [],
        repairable,
        checkedAt: now,
        cached: false,
        source,
        failures: digest.failing
            .filter((check) => !check.id.startsWith("fix."))
            .map((check) => ({ id: check.id, detail: check.detail, remedy: check.remedy })),
        warnings: findings
            .filter((item) => item.status === "warn")
            .map((item) => ({
            id: item.id,
            detail: item.detail,
            ...(item.remedy === undefined ? {} : { remedy: item.remedy }),
        })),
        // Count the rows this run actually answered. The digest's synthetic
        // "not run in this scope" rows describe the catalog, not this distro, and
        // a repair's own `fix.*` rows are narration — both stay out.
        counts: countsOf(findings),
        sections: digest.sections,
        checks: checkRows,
        notRun: digest.scope === undefined ? 0 : digest.notRun,
        blockers: digest.blockers,
    };
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
export function createStatusHandler(options) {
    const now = options.now ?? (() => Date.now());
    const statePath = options.statePath ?? defaultStatePath();
    const verdicts = new Map();
    let list;
    // Restore the last successful results before the first request. The stored
    // view is the panel's shape; the fields later releases may have added are
    // defaulted so an older store still renders instead of failing the load.
    for (const [distro, view] of Object.entries(readStored(statePath)?.distros ?? {})) {
        if (view === null || typeof view !== "object" || view.distro !== distro || typeof view.checkedAt !== "number")
            continue;
        verdicts.set(distro, {
            at: view.checkedAt,
            view: {
                ...view,
                repairs: Array.isArray(view.repairs) ? view.repairs : [],
                repairable: Array.isArray(view.repairable) ? view.repairable : [],
                failures: Array.isArray(view.failures) ? view.failures : [],
                warnings: Array.isArray(view.warnings) ? view.warnings : [],
                counts: view.counts ?? { ok: 0, warn: 0, fail: 0, info: 0, skipped: 0, unknown: 0 },
                sections: Array.isArray(view.sections) ? view.sections : [],
                checks: Array.isArray(view.checks) ? view.checks : [],
                notRun: typeof view.notRun === "number" ? view.notRun : 0,
                blockers: Array.isArray(view.blockers) ? view.blockers : [],
                source: view.source === "background" ? "background" : "user",
                cached: false,
            },
        });
    }
    /**
     * Mark a stored or fresh answer for transport. The view's own `checkedAt`
     * and `source` are the truth about the run; `cached` only says whether this
     * response re-ran the doctor.
     * @param view - the view to present.
     * @param cached - whether the answer came from the cache.
     * @returns the presented view.
     */
    const present = (view, cached) => ({ ...view, cached });
    const installed = async (refresh) => {
        if (!refresh && list !== undefined && now() - list.at < options.cacheMs)
            return list.names;
        const names = await options.distros();
        list = { at: now(), names };
        return names;
    };
    const check = async (distro, refresh, repair = false, source = "user") => {
        const cached = verdicts.get(distro);
        // A failure is a fact of this moment: it is kept for the list and the
        // store, but a plain GET re-runs instead of serving it as fresh.
        if (!refresh && cached !== undefined && cached.view.verdict !== "error" && now() - cached.at < options.cacheMs)
            return present(cached.view, true);
        const at = now();
        let view;
        try {
            // A repair needs a full run: `--fix` refuses a scoped one because a
            // scoped report cannot re-verify what it did not probe. `--fix-owned`
            // keeps the loop on plugin-owned state (scopes, agent cache) — the panel
            // never installs packages or rewrites Windows-owned configuration.
            const argv = repair
                ? ["--json", "--fix", "--fix-owned", "--distro", distro]
                : ["--json", "--quick", "--distro", distro];
            const raw = await options.runCli(argv, undefined, options.timeoutMs);
            const report = JSON.parse(raw);
            view = viewOf(digestReport(mergeAutoPresetSeam(report), distro), distro, at, repair, source);
        }
        catch (error) {
            view = {
                distro,
                verdict: "error",
                repaired: false,
                repairs: [],
                repairable: [],
                checkedAt: at,
                cached: false,
                source,
                failures: [],
                warnings: [],
                counts: { ok: 0, warn: 0, fail: 0, info: 0, skipped: 0, unknown: 0 },
                sections: [],
                checks: [],
                notRun: 0,
                blockers: [],
                error: error?.message ?? String(error),
            };
        }
        // Persist the result exactly as observed, failure included: a failed
        // background refresh must overwrite the last good result rather than
        // leave a stale success on screen. The store keeps the truth; the panel
        // shows the error and offers the retry.
        verdicts.set(distro, { at, view });
        writeStored(statePath, verdicts);
        return present(view, false);
    };
    return async (request) => {
        if (request.method !== "GET" && request.method !== "POST")
            return json({ error: "只支持 GET 与 POST" }, 405);
        const url = new URL(request.url);
        const repair = request.method === "POST";
        const refresh = url.searchParams.get("refresh") === "1";
        const requested = url.searchParams.get("distro");
        let names;
        try {
            names = await installed(repair || refresh);
        }
        catch (error) {
            return json({ error: `无法读取发行版清单：${error?.message ?? String(error)}` }, 502);
        }
        if (requested === null || requested === "") {
            if (repair)
                return json({ error: "修复需要指定发行版" }, 400);
            // The running list bounds the panel's background refresh: only a
            // distro that is already up may be re-checked without the user asking,
            // because a probe boots a stopped one. A failed read means no refresh.
            let running = [];
            try {
                running = (await options.running?.() ?? []).filter((name) => names.includes(name));
            }
            catch {
                running = [];
            }
            const reply = {
                distros: names,
                running,
                cached: [...verdicts.entries()]
                    .filter(([distro]) => names.includes(distro))
                    .map(([, entry]) => present(entry.view, true)),
            };
            return json(reply);
        }
        if (!names.includes(requested))
            return json({ error: `未知发行版：${requested}` }, 400);
        const background = !repair && url.searchParams.get("background") === "1";
        return json(await check(requested, refresh || repair, repair, background ? "background" : "user"));
    };
}
/**
 * Resolve the row's config into handler options.
 *
 * The seams live in {@link StatusHandlerOptions} (and are exercised by the
 * handler tests). Reading them off the Context would be wrong twice over: a
 * Cordis context property accessor throws for a name that was not injected
 * ("cannot get property ... without inject"), which silently broke route
 * registration once already, and a plugin has no business inventing service
 * names.
 *
 * @param config - the schema-validated config.
 * @returns handler options.
 */
function optionsFor(config) {
    const wslPath = config.wslPath ?? "wsl.exe";
    return {
        cacheMs: config.cacheMs ?? 15_000,
        timeoutMs: config.timeoutMs ?? 90_000,
        distros: () => listDistros({ wslPath }),
        running: () => listRunningDistros({ wslPath }),
        runCli: runDoctorCli,
    };
}
/**
 * Mount the row: register the route once the Host connection is available.
 *
 * A composition without `connection` (headless, ACP) leaves the row inert —
 * the same posture the other surface rows take.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated config.
 */
export function apply(ctx, config = {}) {
    if (typeof ctx.inject !== "function")
        return;
    ctx.inject(["connection"], (scope) => {
        const connection = scope.connection ?? scope.get?.("connection");
        if (connection === undefined)
            return;
        const handler = createStatusHandler(optionsFor(config));
        const dispose = connection.fetch.register({
            path: STATUS_PATH,
            methods: ["GET", "POST"],
            requestBody: "buffered",
            fetch: handler,
        });
        scope.effect?.(() => () => { void dispose(); }, `wsl-status: ${STATUS_PATH}`);
    });
}
