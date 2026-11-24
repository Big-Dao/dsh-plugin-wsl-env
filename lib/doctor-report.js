import { sharedAgent } from "./agent-shared.js";
import { mergeAutoPresetSeam, mergeLiveResidentStatus } from "./doctor-live.js";
import { nativeBackendFailure } from "./native-agent.js";
import { sharedAgentNativeNote } from "./agent-shared.js";
import { withHostPeerVersions } from "./peer-versions.js";
import { DOCTOR_OUTPUT_LIMIT_BYTES, runDoctorProcess } from "./doctor-process.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
/** The doctor script this package ships, resolved from the compiled module. */
const DOCTOR_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "doctor.mjs");
/** How long the doctor subprocess may run before the collector kills it. */
const DOCTOR_TIMEOUT_MS = 120_000;
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
export async function doctorReport(distro, options) {
    const script = options?.doctorPath ?? DOCTOR_SCRIPT;
    const argv = [script, distro, "--json"];
    if (options?.quick === true)
        argv.push("--quick");
    if (options?.sections !== undefined && options.sections.length > 0)
        argv.push("--sections", [...options.sections].join(","));
    if (options?.wslPath !== undefined)
        argv.push("--wsl", options.wslPath);
    // A nonzero doctor exit usually means an environment check FAILED on the
    // machine being examined — that is a valid report, not a broken collection.
    // The stdout is parsed regardless; only a run that produced no versioned
    // report rejects.
    const timeoutMs = options?.timeoutMs ?? DOCTOR_TIMEOUT_MS;
    // The child inherits this process's environment either way; the overlay adds
    // the peer set this host actually resolved, which the child cannot look up
    // itself (a separate Node process has no profile interception).
    const env = withHostPeerVersions(options?.envPath === undefined
        ? process.env
        : { ...process.env, PATH: `${options.envPath}:${process.env.PATH ?? ""}` });
    const run = await runDoctorProcess(argv, {
        timeoutMs,
        env,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    let report;
    try {
        report = JSON.parse(run.stdout);
    }
    catch {
        // A run that produced no report rejects, naming the transport failure
        // (spawn error, deadline, output cap, exit) and any stderr tail.
        const cause = run.spawnError?.message
            ?? (run.timedOut
                ? `timed out after ${timeoutMs}ms`
                : run.overLimit
                    ? `produced more than ${DOCTOR_OUTPUT_LIMIT_BYTES} bytes`
                    : `exited with code ${run.status ?? run.signal ?? "unknown"}`);
        throw new Error(`doctor run failed: ${cause}${run.stderr.length > 0 ? ` — ${run.stderr.trim().slice(-400)}` : ""}`);
    }
    const status = options?.liveStatus ?? sharedAgent(distro).status();
    // The resident the operations run on is the one `sharedAgent` hands out —
    // one instance per distro — and the note says why it is not on the native
    // entry, when the backend asks for one and it is not.
    const nativeNote = options?.liveStatus === undefined ? sharedAgentNativeNote(distro) ?? nativeBackendFailure(distro) : undefined;
    return mergeAutoPresetSeam(mergeLiveResidentStatus(report, status, nativeNote === undefined ? {} : { nativeNote }));
}
