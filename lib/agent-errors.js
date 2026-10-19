/**
 * The error a {@link WslAgent} rejects with when the resident process is out
 * for this host process — the executor's cue to fall back to the one-shot
 * `wsl.exe` path. Deliberately its own class: callers must not confuse
 * "the agent cannot serve" with a failure of the command itself.
 *
 * This is a TypeScript source built to `lib/agent-errors.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/agent-errors
 */
/**
 * The abort reason the execution layer uses when its timer fires. The timeout
 * is enforced in the distro, so the agent layer must not add the out-of-band
 * USR1 on this path: that signal has no request id and would hit whoever runs
 * next.
 */
export const BASH_TIMEOUT_REASON = "BASH_TIMEOUT";
export class AgentUnavailableError extends Error {
    /**
     * @param message - why the agent is out, for the log.
     */
    constructor(message) {
        super(message);
        this.name = "AgentUnavailableError";
    }
}
/**
 * The request's workdir could not be entered inside the distro. Carries the
 * Linux path so a caller can synthesize the same diagnostic the one-shot
 * `wsl.exe` path produces from the relay's `chdir(...) failed` text.
 */
export class CwdError extends Error {
    /**
     * @param linuxPath - the path that could not be entered.
     */
    constructor(linuxPath) {
        super(`could not enter working directory "${linuxPath}"`);
        this.name = "CwdError";
        this.linuxPath = linuxPath;
    }
}
/**
 * The agent could not spawn the request's process at all (reason `spawn`).
 * The native agent reports a missing workdir this way, without naming it; the
 * executor retries such a request on the one-shot path, which can tell a
 * missing directory from a missing executable and report the path.
 */
export class SpawnError extends Error {
    /**
     * @param message - the agent's spawn diagnostic.
     */
    constructor(message) {
        super(message);
        this.name = "SpawnError";
    }
}
