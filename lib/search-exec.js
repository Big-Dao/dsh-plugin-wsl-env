/**
 * The agent-backed execution handle for the file-search spawn.
 *
 * `dsh-tool-fs-search` consumes a deliberately small slice of the subprocess
 * handle: it awaits `handle.done` for `{exitCode, signal}`, then reads
 * `handle.collected.stdout/stderr.readFrom(0)` — nothing else. This module
 * builds exactly that surface around one resident-agent `exec`, so a distro
 * search pays one round trip on the warm agent (~10 ms) instead of a one-shot
 * `wsl.exe` spawn (~400 ms of process startup for a few ms of rg).
 *
 * The agent being out is not an error condition here — it is the fallback
 * cue. `spawnFallback` (the shipped one-shot handle the caller builds) is
 * consulted lazily inside `done`. Cancellation shares one channel: the
 * caller's `signal` and `kill()` abort the agent exec, which settles `done`
 * as killed (`{exitCode: null, signal: "SIGTERM"}`) — the same shape the
 * one-shot path reports for a killed search.
 *
 * ## Failure surfacing: the tool must read rg's own failure, not a provider blow-up
 *
 * rg's exit codes are a contract the tool reads: `1` is "no matches", `2` is
 * "rg itself failed", and anything else is a provider-class failure. A distro
 * without ripgrep is the common, actionable failure — `docs/LIMITATIONS.md`
 * promises it surfaces as exit 127 with the bootstrap remedy — so this module
 * turns the agent's two local failures into that shape instead of rejecting
 * `done` (which the tool renders as an opaque "ripgrep provider failure", with
 * no program name and no remedy):
 *
 * - A `SpawnError` means the agent could not start the program. The native
 *   agent reports both a missing executable and a missing working directory
 *   that way, without naming either, so the synthesized message names both
 *   possibilities and the install remedy; the exit code is 127.
 * - A `CwdError` names the directory that could not be entered. It is
 *   synthesized as rg's own error exit code (`2`) with relay-shaped text —
 *   never `1`, which the tool would read as "no matches" and report as an
 *   empty success.
 *
 * Neither failure falls back to the one-shot path. A missing program would
 * only produce the relay's `execvpe(rg) failed` at exit `1` (again the
 * "no matches" dialect), and a missing directory is worse: `wsl.exe --cd`
 * does not fail on it — it warns, runs the command in `/`, and exits 0. The
 * shell executor can afford the one-shot retry because it decorates the
 * result with its workdir verdict; this handle has no such decoration point.
 * Everything else — a genuine agent failure that is not `AgentUnavailableError`
 * — still propagates through `done` as a rejection.
 *
 * The agent's capture cap is the tool's raw-output budget. A stream the
 * agent cut there is reported `lossy`, exactly as the one-shot delegate's
 * own reader reports it — the cut leaves the stream at exactly the budget,
 * so a length cannot show it, and a result read as whole was missing every
 * match past the cap.
 *
 * The one-shot delegate is post-processed the same way, because the agent
 * being out must not change what a broken environment looks like: a missing
 * program's `execvpe(rg) failed` line (exit 1) becomes the same 127, and the
 * relay's `chdir(...) failed` warning — which `wsl.exe` writes while it runs
 * the search in `/` and exits 0/1 — becomes the same explicit directory
 * failure instead of a silent wrong-directory result.
 *
 * Pure shaping over injected collaborators, so the handle semantics are
 * unit-testable without a distro.
 *
 * This is a TypeScript source built to `lib/search-exec.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/search-exec
 */
import { AgentUnavailableError, CwdError, SpawnError } from "./agent-errors.js";
import { execProgramFailure, workdirFailure } from "./wsl.js";
import { t } from "./messages.js";
/** The program the search spawn runs, when the caller's argv does not say. */
const SEARCH_PROGRAM = "rg";
/**
 * The exit code the synthesized results use for a failed search. `2` is rg's
 * own error code: `1` belongs to "no matches", which the tool renders as an
 * empty result rather than a failure.
 */
const SEARCH_ERROR_EXIT = 2;
/** The exit code a shell reports for a command it could not run. */
const COMMAND_NOT_FOUND_EXIT = 127;
/**
 * The synthesized failure one search settles with when the program could not
 * start: rg's error dialect is not available, so the message carries both
 * plausible causes (a missing program and a missing directory) and the
 * install remedy the docs promise.
 *
 * @param object - the failure facts.
 * @returns the stderr text.
 */
function programFailureText({ program, distro, detail }) {
    return t("searchProgramMissing", { program, distro, detail });
}
/**
 * The relay-shaped stderr one search settles with when its working directory
 * is gone — the same line the typed `CwdError` carries into a shell command's
 * synthesized result, plus the directory's own remedy.
 *
 * @param linuxPath - the directory the agent could not enter.
 * @returns the stderr text.
 */
function workdirFailureText(linuxPath) {
    return `<3>WSL: CreateProcessCommon: chdir(${linuxPath}) failed: No such file or directory\n${t("searchWorkdirMissing", { path: linuxPath })}`;
}
/**
 * Run one search command through the agent and present it as a search handle.
 *
 * @param object - the handle's collaborators.
 * @returns the search handle (`done`, `collected`, `kill`).
 */
export function searchExecutionHandle({ agent, cwd, argv, distro, maxOutputBytes = 0, signal, spawnFallback }) {
    const state = { delegate: undefined, stdout: undefined, stderr: undefined, lossy: { stdout: false, stderr: false } };
    const controller = new AbortController();
    if (signal?.aborted)
        controller.abort(signal.reason);
    else
        signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    const program = argv[0] ?? SEARCH_PROGRAM;
    const reader = (slot) => ({
        readFrom(from) {
            const buffer = state[slot] ?? Buffer.alloc(0);
            const start = Math.min(from, buffer.length);
            return { text: buffer.subarray(start).toString("utf8"), lossy: state.lossy[slot], nextOffset: buffer.length };
        },
    });
    /**
     * Settle on a synthesized failure: drop any delegate so `collected` serves
     * the buffers this facade owns, and keep the streams empty on stdout.
     *
     * @param exitCode - rg's dialect exit code for the failure.
     * @param stderr - the model-facing diagnostic, remedy included.
     * @returns the settled outcome.
     */
    const settleFailure = (exitCode, stderr) => {
        state.delegate = undefined;
        state.stdout = Buffer.alloc(0);
        state.stderr = Buffer.from(stderr, "utf8");
        state.lossy = { stdout: false, stderr: false };
        return { exitCode, signal: null };
    };
    /**
     * The 127 result for a program the distro could not start.
     *
     * @param detail - the agent's or the relay's own spawn diagnostic.
     * @returns the settled outcome.
     */
    const settleProgramMissing = (detail) => settleFailure(COMMAND_NOT_FOUND_EXIT, programFailureText({ program, distro, detail }));
    /**
     * The rg-error result for a directory the distro could not enter.
     *
     * @param linuxPath - the directory that could not be entered.
     * @returns the settled outcome.
     */
    const settleWorkdirMissing = (linuxPath) => settleFailure(SEARCH_ERROR_EXIT, workdirFailureText(linuxPath));
    /**
     * Delegate one agent-unavailable request to the one-shot handle, translating
     * the relay's missing-program failure into the documented 127 shape. A
     * delegated outcome that names no missing program passes through verbatim
     * (its collected streams stay the delegate's).
     *
     * @returns the settled outcome.
     */
    const settleDelegate = async () => {
        const delegate = spawnFallback();
        state.delegate = delegate;
        const outcome = await delegate.done;
        if (outcome.exitCode === null)
            return outcome;
        const text = delegate.collected.stderr?.readFrom(0).text ?? "";
        // `wsl.exe --cd <missing>` warns, then runs the command in `/` and exits
        // 0/1 — a silent wrong-directory search. The relay warning is the only
        // evidence, so it becomes the same explicit failure the agent's CwdError
        // produces.
        const missingDir = workdirFailure("", text);
        if (missingDir !== undefined)
            return settleWorkdirMissing(missingDir);
        // A missing program surfaces as `execvpe(rg) failed` at exit 1 — the
        // tool's no-matches dialect. Translate it into the documented 127.
        const relayFailure = execProgramFailure("", text);
        if (relayFailure !== undefined)
            return settleProgramMissing(relayFailure);
        return outcome;
    };
    const handle = {
        get collected() {
            if (state.delegate !== undefined)
                return state.delegate.collected;
            return { stdout: reader("stdout"), stderr: reader("stderr") };
        },
        done: (async () => {
            let result;
            try {
                result = await agent.exec({ cwd, argv, maxOutputBytes, signal: controller.signal });
                state.stdout = result.stdout;
                state.stderr = result.stderr;
                state.lossy = { stdout: result.truncated?.stdout === true, stderr: result.truncated?.stderr === true };
            }
            catch (error) {
                if (controller.signal.aborted) {
                    // Our kill() or the caller's cancellation: the killed outcome the
                    // one-shot path reports, not a failure.
                    return { exitCode: null, signal: "SIGTERM" };
                }
                if (error instanceof CwdError) {
                    // The directory is gone. Synthesize rg's own error code with the
                    // relay-shaped line, so the tool reports a failure that names the
                    // path instead of rejecting as a provider failure.
                    return settleWorkdirMissing(error.linuxPath);
                }
                if (error instanceof SpawnError) {
                    // The agent could not start the program. The native agent reports
                    // both a missing executable and a missing workdir this way, so the
                    // message names both and the remedy makes it actionable.
                    return settleProgramMissing(error.message);
                }
                if (!(error instanceof AgentUnavailableError))
                    throw error;
                return await settleDelegate();
            }
            return { exitCode: result.exitCode, signal: null };
        })(),
        kill() {
            controller.abort(new Error("killed"));
            state.delegate?.kill?.();
        },
    };
    return handle;
}
