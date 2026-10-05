/**
 * The error a {@link WslAgent} rejects with when the resident process is out
 * for this host process — the executor's cue to fall back to the one-shot
 * `wsl.exe` path. Deliberately its own class: callers must not confuse
 * "the agent cannot serve" with a failure of the command itself.
 *
 * @module dsh-plugin-wsl/agent-errors
 */
export class AgentUnavailableError extends Error {
    /**
     * @param {string} message - why the agent is out, for the log.
     */
    constructor(message: string);
}
/**
 * The request's workdir could not be entered inside the distro. Carries the
 * Linux path so a caller can synthesize the same diagnostic the one-shot
 * `wsl.exe` path produces from the relay's `chdir(...) failed` text.
 */
export class CwdError extends Error {
    /**
     * @param {string} linuxPath - the path that could not be entered.
     */
    constructor(linuxPath: string);
    linuxPath: string;
}
