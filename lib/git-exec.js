/**
 * The agent-backed execution handle for the git-snapshot spawn.
 *
 * `workspace-changes`' `GitRunner` consumes a small slice of the subprocess
 * handle: `handle.done` for `{exitCode, signal}`, then
 * `handle.collected.stdout/stderr.readFrom(0)` for `{text, lossy}` — with
 * per-stream caps applied by the caller's `stdio` spec (a generous stdout
 * budget and a 16 KiB stderr tail). This module builds exactly that surface
 * around one resident-agent `exec`, so a distro snapshot pays the warm agent's
 * ~2 ms round trip per git call instead of the one-shot `wsl.exe`'s ~230 ms
 * process startup — measured 2026-11-01 on `ubuntu`; a full snapshot's 6-8
 * calls (plus per-file `cat-file`) used to spend over a second inside
 * `wsl.exe` alone.
 *
 * The caps map onto the agent's single per-request capture ceiling as the
 * larger of the two stream budgets; the reader then slices each stream to its
 * own budget and reports `lossy` from that slice, so the caller's contract
 * (per-stream cut flags) holds even though the wire carries one cap.
 *
 * Environment rides the agent's per-request `env` (an `env --` argv prefix —
 * no `SETENV` global pollution), holding only the translated `GIT_*` names:
 * the one-shot path forwards exactly those through `WSLENV`, and forwarding a
 * host `PATH` into the distro would be wrong, not just different.
 *
 * The agent being out is the fallback cue, exactly as `search-exec.ts`:
 * `spawnFallback` (the caller's one-shot `wsl.exe` handle) is consulted
 * lazily inside `done`, and from that point the facade proxies the delegate
 * verbatim. Cancellation shares one channel: the caller's `signal` and
 * `kill()` abort the agent exec, settling `done` as killed.
 *
 * Pure shaping over injected collaborators, unit-testable without a distro.
 *
 * This is a TypeScript source built to `lib/git-exec.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/git-exec
 */
import { AgentUnavailableError } from "./agent-errors.js";
/**
 * Run one git command through the agent and present it as a git-snapshot
 * handle.
 *
 * @param object - the handle's collaborators.
 * @returns the snapshot handle (`done`, `collected`, `kill`).
 */
export function gitExecutionHandle({ agent, cwd, argv, env, stdin, caps, signal, spawnFallback }) {
    const state = { delegate: undefined, stdout: undefined, stderr: undefined };
    const controller = new AbortController();
    if (signal?.aborted)
        controller.abort(signal.reason);
    else
        signal?.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    // The agent enforces ONE cap per request; declare the larger budget on the
    // wire and cut each stream to its own budget here, so the caller's
    // per-stream contract holds and a stream under its cap is never flagged.
    const wireCap = Math.max(caps.stdout, caps.stderr);
    const reader = (slot) => {
        const cap = slot === "stdout" ? caps.stdout : caps.stderr;
        return {
            readFrom(from) {
                const buffer = state[slot] ?? Buffer.alloc(0);
                const lossy = buffer.length > cap;
                const visible = lossy ? buffer.subarray(0, cap) : buffer;
                const start = Math.min(from, visible.length);
                return { text: visible.subarray(start).toString("utf8"), lossy, nextOffset: visible.length };
            },
        };
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
                result = await agent.exec({ cwd, argv, env, stdin, maxOutputBytes: wireCap, signal: controller.signal });
                state.stdout = result.stdout;
                state.stderr = result.stderr;
            }
            catch (error) {
                if (!(error instanceof AgentUnavailableError)) {
                    if (controller.signal.aborted) {
                        // Our kill() or the caller's cancellation: the killed outcome the
                        // one-shot path reports, not a failure.
                        return { exitCode: null, signal: "SIGTERM" };
                    }
                    throw error;
                }
                const delegate = spawnFallback();
                state.delegate = delegate;
                return delegate.done;
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
