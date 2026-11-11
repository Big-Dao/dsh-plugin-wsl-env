import type { AgentStatus } from "./agent.js";
import { type DoctorReport } from "./doctor-live.js";
/**
 * Collect the doctor's versioned JSON report and merge the live resident's
 * own lifecycle facts when this process holds one (WSL-313).
 *
 * The doctor CLI is a separate process, so its handshake check can only probe
 * a fresh resident; a live resident's `deaths` and `lastError` are
 * host-process state with no IPC to reach them. This entry point runs from
 * the plugin's own context instead: it collects the report as a subprocess
 * (no plugin code is re-entered) and folds `sharedAgent(distro).status()` in
 * — the sanctioned merge, since a snapshot that answers for no resident
 * changes nothing. Outside the app the singleton was never started, so the
 * returned report is the fresh probe verbatim; inside it, a wedged live
 * resident's failures finally reach the report.
 *
 * @param distro - the distro the doctor examines.
 * @param options - `doctorPath` overrides the shipped script (tests);
 *   `timeoutMs` bounds the run; `signal` lets the caller cancel it;
 *   `liveStatus` overrides the in-process status snapshot (tests).
 * @returns the merged report.
 */
export declare function doctorReport(distro: string, options?: {
    doctorPath?: string;
    /** The `wsl.exe` the doctor probes with; forwarded as `--wsl <path>`. */
    wslPath?: string;
    /**
     * Run the quick profile instead of the full scan: first-command
     * prerequisites only (host/session/sandbox, no smokes, no registry query,
     * no port survey) — forwarded as `--quick`.
     */
    quick?: boolean;
    /**
     * Restrict the run to these doctor sections (host, sandbox, session, conf,
     * net, agent); forwarded as `--sections <csv>`. Undefined runs everything.
     */
    sections?: readonly string[];
    /**
     * Prepended to the doctor subprocess's PATH — a caller that stages a fake
     * `wsl.exe` (tests) passes the staging directory here instead of mutating
     * `process.env`, whose visibility across spawned grandchildren is exactly
     * the ambiguity this option removes.
     */
    envPath?: string;
    /** Hard deadline for the subprocess; defaults to two minutes. */
    timeoutMs?: number;
    /** The caller's cancellation (the tool's `exec.signal`); aborts the child. */
    signal?: AbortSignal;
    liveStatus?: AgentStatus;
}): Promise<DoctorReport>;
