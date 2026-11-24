/**
 * The bounded `doctor.mjs` subprocess collector shared by the two doctor
 * runners: the in-app report (`doctor-report.ts`, the `wsl_doctor` tool) and
 * the `/wsl-doctor` command. Both used to carry their own spawn, deadline and
 * stream handling; the command's copy concatenated per-chunk
 * `toString("utf8")` (splitting a multi-byte character at a chunk boundary),
 * had no output cap, and checked the JSON prefix before the deadline. One
 * collector now owns all three rules:
 *
 *   - the deadline kills the child and settles the run as timed out;
 *   - stdout + stderr are capped, and crossing the cap kills the run;
 *   - streams are decoded with a `StringDecoder` (`setEncoding("utf8")`), so a
 *     chunk boundary never splits a code point;
 *   - a grandchild that inherited the pipes cannot hold the collector past the
 *     bounded drain window after the doctor itself exits.
 *
 * This is a TypeScript source built to `lib/doctor-process.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/doctor-process
 */
import { spawn } from "node:child_process";
/**
 * How much of one doctor stream the collector retains. The `--json` report is
 * a few dozen KiB; the cap exists so a runaway child cannot grow the Host's
 * memory without bound.
 */
export const DOCTOR_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
/**
 * How long after the doctor exits the collector waits for its pipes. A
 * grandchild that inherited the pipes can keep them open forever; the report
 * on stdout is complete once the doctor itself has exited, so the wait is
 * bounded instead of following the pipes to EOF.
 */
export const DOCTOR_DRAIN_GRACE_MS = 500;
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
export function runDoctorProcess(argv, options) {
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
        /**
         * Append one already-decoded chunk under the shared cap.
         *
         * @param chunk - the decoded text.
         * @param which - the stream it came from.
         */
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
        // A StringDecoder, so a multi-byte code point split across two chunks is
        // reassembled instead of becoming two replacement characters.
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => capture(chunk, "stdout"));
        child.stderr?.on("data", (chunk) => capture(chunk, "stderr"));
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
