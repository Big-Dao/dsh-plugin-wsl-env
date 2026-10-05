/**
 * The distro-side activity observation for GUI distro terminals, and the
 * handle wrapper that installs it.
 *
 * ## The gap this closes
 *
 * The terminal controller reclaims unattended terminals after
 * `unattendedTimeoutMs` of observed idleness, but its observation is
 * host-side: `dsh-subprocess-local`'s shell-activity integration is gated to
 * interactive `bash`/`zsh` launched directly on a POSIX host, and a distro
 * terminal is `wsl.exe` on win32. Every branch of the shipped
 * `inspectActivity` therefore settles on `unknown` for these terminals, and
 * `unknown` never accumulates idle — a distro terminal had to be closed by
 * hand.
 *
 * ## The observation
 *
 * The terminal is MARKED at launch: a per-terminal `DSH_TERMINAL_ID` rides
 * the `WSLENV` forwarding this provider already does, so the distro shell —
 * and every process it spawns — carries it in `/proc/<pid>/environ`. The
 * controller's 30 s retention poll then asks the resident agent to count the
 * marked processes: exactly one (the shell alone, at its prompt) is IDLE;
 * more than one (a command, a pipeline, a nested shell is running) is BUSY;
 * none at all defers to the shipped handle (the shell has exited; its own
 * exit bookkeeping is more precise than this scan). The agent being out
 * yields `unknown` — the same never-reclaim posture as before, which is the
 * safe direction: a probe that cannot answer must not authorize a close.
 *
 * Pure builders and a transparent proxy here; the agent wiring lives in the
 * subprocess provider.
 *
 * @module dsh-plugin-wsl/terminal-activity
 */

/** The env name that marks one terminal's process tree inside the distro. */
export const TERMINAL_ID_ENV = "DSH_TERMINAL_ID";

/**
 * The seam's activity observation — structurally the upstream
 * `SubprocessTerminalActivity` (`subprocess-local/src/terminal.ts`): `state`
 * is `'idle' | 'busy' | 'unknown'` and `revision` is a counter that changes
 * when the reported state changes, which is what the controller's retention
 * loop keys its idle accumulation on.
 *
 * @typedef {Object} SubprocessTerminalActivity
 * @property {'idle' | 'busy' | 'unknown'} state
 * @property {number} revision
 */

/**
 * The probe: count the `/proc` processes carrying the terminal marker.
 *
 * POSIX sh on purpose (the distro's `sh` is the only guaranteed interpreter).
 * The count is the whole decision: the terminal's login shell is exec'd WITH
 * the marker (wsl.exe imports it into the session before `--exec`), so an
 * idle-at-prompt shell is exactly one marked process, and anything the shell
 * runs — a command, a pipeline, a nested shell — is exec'd with the marker
 * inherited, pushing the count past one. `/proc/<pid>/environ` shows the
 * exec-time environment, which is precisely why the count works: runtime
 * exports would be invisible, and exec-time inheritance is the signal.
 *
 * The marker check reads the NUL-separated environ through `tr`, which is why
 * the id is passed as `$1` rather than interpolated into the script.
 *
 * @param {string} terminalId - the `DSH_TERMINAL_ID` value one terminal was launched with.
 * @returns {{cwd: string, argv: string[]}} the agent `exec` target: the probe script with the id as `$1`.
 */
export function terminalActivityProbe(terminalId) {
  const script = [
    "id=$1",
    "count=0",
    'for d in /proc/[0-9]*; do',
    '  [ -r "$d/environ" ] || continue',
    '  if tr "\\000" "\\n" < "$d/environ" 2>/dev/null | grep -qx "DSH_TERMINAL_ID=$id"; then',
    "    count=$((count+1))",
    '    [ "$count" -gt 1 ] && { echo busy; exit 0; }',
    "  fi",
    "done",
    "echo idle",
  ].join("\n");
  return { cwd: "/", argv: ["sh", "-c", script, "sh", terminalId] };
}

/**
 * Parse the probe's stdout into an activity state.
 *
 * @param {string|Buffer} stdout - the probe's raw stdout.
 * @returns {"busy"|"idle"|undefined} `"busy"` or `"idle"` as the probe reported, or undefined when the
 *   output is anything else (the caller answers `unknown`).
 */
export function parseTerminalActivity(stdout) {
  const text = String(stdout).trim();
  if (text === "busy" || text === "idle") return text;
  return undefined;
}

/**
 * Wrap a terminal handle so its activity is observed inside the distro.
 *
 * Everything except `inspectActivity` forwards to the wrapped handle
 * transparently — methods stay bound to the real handle, so the controller's
 * `write`/`resize`/`signalForeground`/stream access behave exactly as on the
 * shipped object. `inspectActivity` is replaced wholesale: the shipped
 * implementation can only answer `unknown` for a distro terminal, and the
 * replacement answers from the marker scan (or `unknown` itself, when the
 * probe cannot answer).
 *
 * @param {import("@deepseek-ai/dsh-subprocess").SubprocessTerminalHandle} handle - the handle `spawnTerminal` returned.
 * @param {() => Promise<SubprocessTerminalActivity>} inspectActivity - the replacement observation, matching the seam's
 *   `() => Promise<SubprocessTerminalActivity>` shape.
 * @returns {import("@deepseek-ai/dsh-subprocess").SubprocessTerminalHandle} the transparent proxy handle.
 */
export function wrapTerminalHandle(handle, inspectActivity) {
  return new Proxy(handle, {
    get(target, prop) {
      if (prop === "inspectActivity") return inspectActivity;
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
