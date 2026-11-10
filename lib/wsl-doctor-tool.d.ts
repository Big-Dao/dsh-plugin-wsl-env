/**
 * The `wsl_doctor` tool: the model runs the environment doctor itself, and
 * the verdict lands in the transcript — the GUI entry that belongs entirely
 * to the plugin.
 *
 * The doctor is this package's own diagnostic (WSL-316); exposing it as a
 * tool keeps the loop cohesive: no upstream surface is required, no file is
 * written into the user's workspace, and the model gets a structured digest
 * (verdict, blockers, per-failure copy-paste remedies) it can narrate or
 * act on. The heavy lifting is {@link doctorReport} — the sanctioned
 * in-process collector that spawns the shipped CLI once with the app's own
 * runtime and folds the live resident's state in; the tool adds only the
 * distro resolution and the digest.
 *
 * The distro comes from the caller when given, else from the agent's own
 * session cwd through the harness's `workingDirectory` service — the same
 * resolution the preflight performs, and the reason this row mounts inside
 * the `preset-wsl` block: a host-preset agent has no distro to examine.
 *
 * This is a TypeScript source built to `lib/wsl-doctor-tool.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated,
 * and `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/wsl-doctor-tool
 */
export declare const name = "wsl-doctor-tool";
/**
 * The context properties `apply` reads eagerly: the tool registry and the
 * harness's `workingDirectory` service (the session's distro resolution).
 * Cordis 4 refuses an undeclared read, so both must be named here. The doctor
 * collector is deliberately NOT injected: no host row provides a `doctor`
 * service, and a required inject would fail the whole preset mount; it is
 * resolved per call through the optional `ctx.get` (which needs no inject)
 * with the package's own `doctorReport` as the fallback — `doctorCollector`
 * below.
 */
export declare const inject: string[];
/** The tool registry slice this service consumes. */
interface ToolRegistrySlice {
    register: (tool: unknown) => unknown;
}
/** The harness's `workingDirectory` service slice (cwd resolution). */
interface WorkingDirectoryToolSlice {
    ensure: (agent: unknown, signal?: unknown) => Promise<string>;
}
/** The doctor report this tool digests — the doctor CLI's versioned shape. */
export interface DoctorReportLike {
    verdict?: string;
    blockers?: string[];
    distroVerdicts?: Array<{
        name: string;
        verdict: string;
        blockers: string[];
    }>;
    checks?: Array<{
        id: string;
        status: string;
        title?: string;
        detail?: string;
        remedy?: string;
        distro?: string;
    }>;
    summary?: Record<string, number>;
    /** The run's scope when the report is quick or section-filtered. */
    scope?: {
        sections: string[];
        quick: boolean;
    };
}
/** The doctor report collector: distro plus run scope in, report out. */
type DoctorCollector = (distro: string, options?: {
    quick?: boolean;
    sections?: readonly string[];
    signal?: AbortSignal;
}) => Promise<DoctorReportLike>;
/** The context slice this service consumes. */
type WslDoctorToolContext = {
    tools: ToolRegistrySlice;
    workingDirectory: WorkingDirectoryToolSlice;
    /** Optional cordis-style lookup: how production resolves `doctor` without an inject. */
    get?: (name: string) => unknown;
    /** The in-process collector: a provided `doctor` service, or the test seam's fake. */
    doctor?: DoctorCollector;
};
/** One failing check as the digest carries it: what failed and what to do. */
interface FailingCheck {
    id: string;
    detail: string;
    remedy: string;
    /** The distro the failing check ran in; absent for host-wide checks. */
    distro?: string;
}
/** Per-distro tallies: what was tested in each distro and how it came out. */
interface DistroTally {
    name: string;
    ok: number;
    warn: number;
    fail: number;
    unknown: number;
    info: number;
    skipped: number;
    /** This distro is the session's own — the run's primary subject. */
    session?: boolean;
    /** The distro's own verdict when the report carried one. */
    verdict?: string;
}
/** One check as the itemized listing carries it: what was tested and how it came out. */
interface CheckItem {
    id: string;
    /** The check's display name; falls back to the id when the report omits it. */
    title: string;
    status: string;
    detail: string;
    distro?: string;
    remedy?: string;
}
/** The tool's result: the doctor's verdict, condensed for the model. */
export interface DoctorDigest {
    verdict: string;
    blockers: string[];
    failing: FailingCheck[];
    warningCount: number;
    skippedCount: number;
    /** Per-section tallies for the checks the report carried, in SECTIONS order. */
    sections: Array<{
        section: string;
        ok: number;
        warn: number;
        fail: number;
        unknown: number;
    }>;
    /** Per-distro tallies in first-appearance order — the grouped summary. */
    distros: DistroTally[];
    /** Every check the report carried, in report order — the itemized listing. */
    items: CheckItem[];
    /** The scope the report answers for (quick profile or a section subset). */
    scope?: {
        sections: string[];
        quick: boolean;
    };
    distroVerdicts: Array<{
        name: string;
        verdict: string;
        blockers: string[];
    }>;
    note: string;
}
/**
 * The section a check id belongs to. Mirrors `sectionOf` in
 * `scripts/doctor.mjs` (the CLI's `--sections` filter reads that one); the
 * parity is pinned by a test in `test/wsl-doctor-tool.test.mjs`, so a check
 * cannot move sections on one side without the other noticing.
 * @param id - the check id.
 * @returns the section name.
 */
export declare function sectionOf(id: string): "host" | "sandbox" | "session" | "conf" | "net" | "agent";
/** The sections in report order, matching the doctor CLI's SECTIONS list. */
export declare const SECTIONS: string[];
/**
 * Every check id the doctor can emit — the CLI's whole probing surface,
 * including the ids that only appear conditionally (`distro.present` for a
 * configured-but-missing distro, `fix.git-trust` for a `--fix` run) and the
 * `tools.*` ids the optional-tool loop constructs. The itemized listing uses
 * this to show the checks a scoped (quick or section) run did NOT execute as
 * explicit `[SKIP]` rows instead of silently dropping them; the parity test
 * in `test/wsl-doctor-tool.test.mjs` re-extracts the ids from the CLI source
 * and fails when the catalog drifts. A full run carries no scope, so a
 * conditional id whose trigger never fired (no distro is missing, no
 * `--fix`) also surfaces there under the generic `no scope recorded`
 * reason — for those ids the honest reading is "did not fire", not
 * "out of scope".
 */
export declare const CHECK_CATALOG: readonly string[];
/**
 * Digest one doctor report down to what the model acts on: the verdict, the
 * blockers, every failing check with its copy-paste remedy, and the
 * per-section tallies that make the passed checks visible (a bare verdict
 * says nothing about what was tested — the sections do). Warnings and
 * skipped legs count but do not list — the report's own ids name them when
 * the model asks.
 * @param report - the collected (and live-merged) doctor report.
 * @param sessionDistro - the distro this session runs in, when known; the
 *   matching tally is flagged so the rendered summary can name it.
 * @returns the digest.
 */
export declare function digestReport(report: DoctorReportLike, sessionDistro?: string): DoctorDigest;
/**
 * Render the digest as the tool's text output, in the style of a regular
 * diagnostic tool: one verdict line, then an itemized listing — every check
 * the report carried, grouped by distro, each with an explicit status marker
 * (`[OK]` / `[WARN]` / `[FAIL]` / `[INFO]` / `[SKIP]` / `[??]`), its name and
 * what it found. A failed check carries its copy-paste remedy on the next
 * line; a warned check carries its detail, which is already the remedy's
 * context. The model narrates this; keeping it plain text keeps the
 * transcript readable.
 * @param digest - the digested report.
 * @returns the multi-line text.
 */
export declare function renderDigest(digest: DoctorDigest): string;
/**
 * Mount the tool.
 *
 * @param ctx - the cordis context (the preset realm, where the tools
 *   registry and the workingDirectory service are reachable).
 */
export declare function apply(ctx: WslDoctorToolContext): Promise<void>;
export {};
