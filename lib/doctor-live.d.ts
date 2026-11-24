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
 * no resident (never started: no pid, no death, no failure) changes nothing.
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
    /** The ids of the blocking (`fail`) checks, when the report derives them. */
    blockers?: string[];
    /** `ready` or `blocked`, when the report derives it from {@link blockers}. */
    verdict?: string;
    /** Per-distro `verdict` and `blockers`, when the report derives them. */
    distroVerdicts?: Array<{
        name: string;
        verdict: string;
        blockers: string[];
    }>;
}
/** What a diagnosis knows about a resident beyond its lifecycle snapshot. */
export interface LiveResidentNotes {
    /**
     * Why the resident is not on the native entry though the backend asks for
     * it — the entry is demoted, or its preparation failed.
     */
    nativeNote?: string;
}
/**
 * Fold an in-process resident's lifecycle snapshot into a doctor report's
 * `agent.handshake` check.
 *
 * The merge fires only when the status answers for a resident this process
 * actually held — a pid, a death, or a failure not yet recovered from (see
 * {@link isHeld}). A never-started singleton's snapshot says nothing about
 * the app's resident and is ignored, keeping the fresh-probe report honest.
 * A `dead` resident FAILS the check: every path into `dead` clears the pid,
 * so a pid-only test used to skip exactly the resident that was down, and
 * file operations failing closed behind it read as `ready`. A `lastError` on
 * a running resident surfaces as `warn`; it is the failure not yet recovered
 * from, because an accepted handshake clears it. The digest facts the fresh
 * probe established are kept.
 *
 * A verdict the collector derived from its own checks — `blockers`,
 * `verdict`, `distroVerdicts` — is derived again when the merge changes a
 * check's status: a digest trusts those fields over the checks when the
 * report carries them, so a failure that stops reaching them stops existing.
 *
 * @template T - the report's own type, preserved so richer shapes pass through.
 * @param report - the collected doctor report (not mutated).
 * @param status - the in-process `status()` snapshot, when reachable.
 * @param notes - what the caller knows beyond the snapshot.
 * @returns the report with the merged handshake check; the input object when
 * there is nothing to merge.
 */
export declare function mergeLiveResidentStatus<T extends DoctorReport>(report: T, status: AgentStatus | undefined, notes?: LiveResidentNotes): T;
/** The report fields {@link mergeAutoPresetSeam} needs; the strict and loose report types both fit. */
interface SeamMergeReport {
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
 * Fold auto-preset's creation-time seam state into a doctor report.
 *
 * The seam is host-process state — whether the running session controller
 * exposes `agents.createSession` — so the standalone CLI cannot see it, just as
 * it cannot see a live resident's lifecycle (see {@link mergeLiveResidentStatus}).
 * The in-app surfaces (the `wsl_doctor` tool, the `/wsl-doctor` command and the
 * sidebar panel) call this merge, so the silent-degradation case that motivated
 * the check appears as a warning instead of a log line only. A `warn` does not
 * block the first command: adoption after creation still runs.
 *
 * @param report - the collected doctor report (not mutated).
 * @returns the report with the `session.preset-seam` row appended.
 */
export declare function mergeAutoPresetSeam<T extends SeamMergeReport>(report: T): T;
export {};
