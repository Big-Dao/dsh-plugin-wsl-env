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
export interface ToolRegistrySlice {
    register: (tool: unknown) => unknown;
}
/** The harness's `workingDirectory` service slice (cwd resolution). */
export interface WorkingDirectoryToolSlice {
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
}
/** The cordis context slice this service consumes. */
export type WslDoctorToolContext = {
    tools: ToolRegistrySlice;
    workingDirectory: WorkingDirectoryToolSlice;
    /** Optional cordis-style lookup: how production resolves `doctor` without an inject. */
    get?: (name: string) => unknown;
    /** The in-process collector: a provided `doctor` service, or the test seam's fake. */
    doctor?: (distro: string) => Promise<DoctorReportLike>;
};
/** The tool's config: the row takes no options. */
export interface WslDoctorToolConfig {
    /** Reserved; the wrapper has no options today. */
    enabled?: boolean;
}
/** One failing check as the digest carries it: what failed and what to do. */
export interface FailingCheck {
    id: string;
    detail: string;
    remedy: string;
}
/** The tool's result: the doctor's verdict, condensed for the model. */
export interface DoctorDigest {
    verdict: string;
    blockers: string[];
    failing: FailingCheck[];
    warningCount: number;
    skippedCount: number;
    distroVerdicts: Array<{
        name: string;
        verdict: string;
        blockers: string[];
    }>;
    note: string;
}
/**
 * Digest one doctor report down to what the model acts on: the verdict, the
 * blockers, and every failing check with its copy-paste remedy. Warnings and
 * skipped legs count but do not list — the report's own ids name them when
 * the model asks.
 * @param report - the collected (and live-merged) doctor report.
 * @returns the digest.
 */
export declare function digestReport(report: DoctorReportLike): DoctorDigest;
/**
 * Render the digest as the tool's text output: one verdict line, one line
 * per failing check with its remedy. The model narrates this; keeping it
 * plain text keeps the transcript readable.
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
