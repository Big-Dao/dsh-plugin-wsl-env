import { sharedAgent } from "./agent-shared.js";
import { mergeLiveResidentStatus } from "./doctor-live.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
/** The doctor script this package ships, resolved from the compiled module. */
const DOCTOR_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "doctor.mjs");
/** How long the doctor subprocess may run before the collector kills it. */
const DOCTOR_TIMEOUT_MS = 120_000;
/**
 * How much of one doctor stream the collector retains. The `--json` report is
 * a few dozen KiB; the cap exists so a runaway child cannot grow the Host's
 * memory without bound.
 */
const DOCTOR_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
/**
 * How long after the doctor exits the collector waits for its pipes. A
 * grandchild that inherited the pipes can keep them open forever; the report
 * on stdout is complete once the doctor itself has exited, so the wait is
 * bounded instead of following the pipes to EOF.
 */
const DOCTOR_DRAIN_GRACE_MS = 500;
/**
 * Run the doctor CLI asynchronously and collect its streams.
 *
 * `spawnSync` would block the Host's event loop for the whole run — up to the
 * deadline, with no way to cancel and every other tool stalled behind it — so
 * the collector spawns, arms a deadline and the caller's abort signal, and
 * settles on the child's exit plus a bounded drain window. A grandchild that
 * inherits the pipes cannot hold the collector past that window.
 *
 * @param argv - the node argv (script path first).
 * @param options - the child env, the deadline, and the caller's signal.
 * @returns the finished run, including the spawn failure when it never started.
 */
function runDoctorProcess(argv, options) {
    return new Promise((resolvePromise) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let overLimit = false;
        let spawnError;
        let exit;
        let drainTimer;
        let settled = false;
        const child = spawn(process.execPath, argv, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            ...(options.env === undefined ? {} : { env: options.env }),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        const settle = () => {
            if (settled)
                return;
            settled = true;
            clearTimeout(deadlineTimer);
            if (drainTimer !== undefined)
                clearTimeout(drainTimer);
            resolvePromise({
                stdout,
                stderr,
                status: exit?.status ?? null,
                signal: exit?.signal ?? null,
                timedOut,
                overLimit,
                ...(spawnError === undefined ? {} : { spawnError }),
            });
        };
        const kill = () => {
            try {
                child.kill();
            }
            catch {
                // An already-exited child: the exit handler settles the run.
            }
        };
        const deadlineTimer = setTimeout(() => {
            timedOut = true;
            kill();
        }, options.timeoutMs);
        const capture = (chunk, which) => {
            if (settled)
                return;
            if (which === "stdout")
                stdout += chunk;
            else
                stderr += chunk;
            if (stdout.length + stderr.length > DOCTOR_OUTPUT_LIMIT_BYTES) {
                overLimit = true;
                kill();
            }
        };
        child.stdout?.on("data", (chunk) => capture(chunk.toString("utf8"), "stdout"));
        child.stderr?.on("data", (chunk) => capture(chunk.toString("utf8"), "stderr"));
        child.on("error", (error) => {
            // A spawn failure never reaches `exit`; an abort is reported with the
            // same event, so the marker is normalized into a plain message.
            spawnError = error.name === "AbortError"
                ? new Error("doctor run aborted")
                : error;
            if (exit === undefined)
                settle();
        });
        child.on("exit", (code, signalName) => {
            exit = { status: code, signal: signalName ?? null };
            // The report is complete at exit; give the pipes one bounded window to
            // flush (a grandchild holding them must not stall the collector).
            drainTimer = setTimeout(settle, DOCTOR_DRAIN_GRACE_MS);
        });
        child.on("close", () => {
            if (exit !== undefined)
                settle();
        });
    });
}
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
    const run = await runDoctorProcess(argv, {
        timeoutMs,
        ...(options?.envPath !== undefined ? { env: { ...process.env, PATH: `${options.envPath}:${process.env.PATH ?? ""}` } } : {}),
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
    return mergeLiveResidentStatus(report, status);
}
