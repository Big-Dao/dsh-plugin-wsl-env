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
export function mergeLiveResidentStatus(report, status) {
    if (!status || status.pid == null)
        return report;
    const fresh = report.checks.find((check) => check.id === "agent.handshake");
    if (!fresh)
        return report;
    const errorLine = status.lastError.length > 0 ? `; lastError: ${status.lastError}` : "";
    // The fresh check's shape fields (distro, blocksFirstCommand) ride through:
    // the merge rewrites the verdict and the evidence, never the schema.
    const merged = {
        ...fresh,
        status: status.state === "dead" ? "fail" : status.lastError.length > 0 ? "warn" : fresh.status,
        detail: `probed: the live resident (pid ${status.pid}, state ${status.state}, deaths ${status.deaths}, pending ${status.pending})${errorLine}; fresh-probe facts: ${fresh.detail ?? ""}`,
    };
    const checks = report.checks.map((check) => (check === fresh ? merged : check));
    const summary = { ...report.summary };
    if (merged.status !== fresh.status) {
        summary[fresh.status] = Math.max(0, (summary[fresh.status] ?? 0) - 1);
        summary[merged.status] = (summary[merged.status] ?? 0) + 1;
    }
    return { ...report, checks, summary };
}
