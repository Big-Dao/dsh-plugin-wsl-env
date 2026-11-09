/**
 * The doctor's live-resident merge (WSL-313): the one place where an
 * in-process {@link AgentStatus} may be folded into a doctor report.
 *
 * The doctor CLI (`scripts/doctor.mjs`) is a separate process from the app,
 * so its handshake check can only ever probe a fresh resident; a live
 * resident's `deaths` and `lastError` are host-process state with no IPC to
 * reach them. This module is the sanctioned alternative: callers that hold
 * the plugin's context (the app process itself, through
 * {@link doctorReport}) merge the resident's own `status()` snapshot into a
 * collected report — no transport is invented, and a status that answers for
 * no resident (pid unknown) changes nothing.
 *
 * @module dsh-plugin-wsl-env/doctor-live
 */
import type { AgentStatus } from "./agent.js";
/** One check line of the doctor's versioned JSON report. */
interface DoctorCheck {
    /** The stable check id, e.g. `agent.handshake`. */
    id: string;
    /** `ok` | `warn` | `fail` | `info` | `skipped`. */
    status: string;
    /** The human detail line. */
    detail?: string;
    /** The copy-paste remedy, when the status is not `ok`. */
    remedy?: string;
    /** The distro the check ran against (schema 2, distro-scoped checks). */
    distro?: string;
    /** Whether a `fail` here blocks the first command (schema 2). */
    blocksFirstCommand?: boolean;
}
/** The doctor's versioned JSON report shape (`schemaVersion`). */
export interface DoctorReport {
    /** The report schema version. */
    schemaVersion: number;
    /** Every check, in report order. */
    checks: DoctorCheck[];
    /** Per-status tally. */
    summary: Record<string, number>;
}
/**
 * Fold an in-process resident's lifecycle snapshot into a doctor report's
 * `agent.handshake` check.
 *
 * The merge fires only when the status answers for a resident this process
 * actually holds (`pid` known) — a never-started singleton's snapshot says
 * nothing about the app's resident and is ignored, keeping the fresh-probe
 * report honest. A `dead` resident fails the check; a `lastError` on a
 * running resident surfaces as `warn` (the revival budget may already have
 * recovered it); the digest facts the fresh probe established are kept.
 *
 * @param report - the collected doctor report (not mutated).
 * @param status - the in-process `status()` snapshot, when reachable.
 * @returns the report with the merged handshake check; the input object when
 * there is nothing to merge.
 */
export declare function mergeLiveResidentStatus(report: DoctorReport, status: AgentStatus | undefined): DoctorReport;
export {};
