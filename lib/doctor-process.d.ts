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
/**
 * How much of one doctor stream the collector retains. The `--json` report is
 * a few dozen KiB; the cap exists so a runaway child cannot grow the Host's
 * memory without bound.
 */
export declare const DOCTOR_OUTPUT_LIMIT_BYTES: number;
/**
 * How long after the doctor exits the collector waits for its pipes. A
 * grandchild that inherited the pipes can keep them open forever; the report
 * on stdout is complete once the doctor itself has exited, so the wait is
 * bounded instead of following the pipes to EOF.
 */
export declare const DOCTOR_DRAIN_GRACE_MS = 500;
/** One finished doctor subprocess, as the collector hands it to the parser. */
export interface DoctorRun {
    stdout: string;
    stderr: string;
    /** The exit status; null when a signal ended the run. */
    status: number | null;
    /** The terminating signal name, when one ended the run. */
    signal: string | null;
    /** The run outlived its deadline and was killed. */
    timedOut: boolean;
    /** Stream capture crossed {@link DOCTOR_OUTPUT_LIMIT_BYTES} and the run was killed. */
    overLimit: boolean;
    /** The transport failure: a spawn error (ENOENT, EACCES) or an abort. */
    spawnError?: Error;
}
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
export declare function runDoctorProcess(argv: string[], options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<DoctorRun>;
