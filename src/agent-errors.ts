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
export class AgentUnavailableError extends Error {
  /**
   * @param message - why the agent is out, for the log.
   */
  constructor(message: string) {
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
  /** The path that could not be entered, in the distro's own spelling. */
  declare linuxPath: string;

  /**
   * @param linuxPath - the path that could not be entered.
   */
  constructor(linuxPath: string) {
    super(`could not enter working directory "${linuxPath}"`);
    this.name = "CwdError";
    this.linuxPath = linuxPath;
  }
}
