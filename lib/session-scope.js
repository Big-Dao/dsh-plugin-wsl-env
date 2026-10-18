/**
 * Pure builders for the session-scoped sandbox launcher (ADR 0001).
 *
 * The runtime is one transient systemd **user scope** per session, running the
 * agent as its main process; commands are the agent's children, so a
 * background dev server stays in the scope's cgroup, `/tmp` is the distro's
 * real `/tmp`, and `ps` sees the session. Session end stops the scope and the
 * cgroup reaps everything.
 *
 * Nothing here spawns: the host inserts {@link sessionScopePrefix} between
 * `wsl.exe --exec` and the agent's own argv, runs
 * {@link sessionScopeProbeArgv} before enabling the mode, and runs
 * {@link sessionScopeStopArgv} when the session ends. Keeping the shapes pure
 * is what lets the launcher be tested without systemd.
 *
 * This is a TypeScript source built to `lib/session-scope.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/session-scope
 */
/** The longest piece of a unit name this builder emits, per component. */
const MAX_COMPONENT = 64;
/**
 * Characters systemd accepts in a unit name; everything else is folded to `_`.
 * The allowed set is `[A-Za-z0-9:_.\-]`; `:` is legal in unit names but not
 * useful here, so it is folded too, keeping the name easy to copy into a
 * shell.
 */
const UNIT_CHARS = /[^A-Za-z0-9_.-]/gu;
/**
 * Sanitize one component of a unit name.
 *
 * @param value - the raw component.
 * @param fallback - the component to use when nothing survives.
 * @returns the sanitized, length-capped component.
 */
function component(value, fallback) {
    const clean = value.replace(UNIT_CHARS, "_").slice(0, MAX_COMPONENT);
    return clean.length > 0 ? clean : fallback;
}
/**
 * Build the systemd user unit name for one session runtime.
 *
 * The caller supplies a token that is unique for the session (a random hex
 * string, a session id); the distro name is part of the name so two distros'
 * runtimes are never confused in `systemctl --user list-units`. The result is
 * deterministic for the pair, which is what lets the host stop the unit later
 * without keeping a map.
 *
 * @param distro - the distro name.
 * @param token - the per-session unique token.
 * @returns a unit name safe for `systemd-run --unit`.
 */
export function sessionScopeUnit(distro, token) {
    return `dsh-wsl-${component(distro, "distro")}-${component(token, "session")}`;
}
/**
 * The arguments inserted after `wsl.exe --exec` to run the agent in a
 * transient user scope. The agent's own argv (its confinement prefix, the
 * shell and the script) follows the `--` terminator.
 *
 * `--scope` is deliberate: a scope's stdio is inherited, so the protocol's
 * pipes stay the transport's; a transient *service* would need `--pipe` and a
 * fresh verification of its EOF/exit-code semantics (ADR open question).
 *
 * @param unit - the unit name from {@link sessionScopeUnit}.
 * @returns the argv fragment, ending with `--`.
 */
export function sessionScopePrefix(unit) {
    return ["systemd-run", "--user", "--scope", "--quiet", "--unit", unit, "--"];
}
/**
 * The host argv that stops one session runtime. Stopping the scope is the
 * cleanup step that replaces the per-command PID namespace: the cgroup kills
 * every descendant, including a background dev server a command left behind.
 *
 * @param options - the transport path, distro and unit name.
 * @returns the `wsl.exe --exec systemctl --user stop` argv.
 */
export function sessionScopeStopArgv({ wslPath, distro, unit }) {
    return [
        wslPath,
        ...(distro.length > 0 ? ["-d", distro] : []),
        "--exec",
        "systemctl",
        "--user",
        "stop",
        unit,
    ];
}
/**
 * The script the preflight runs inside the distro before the session runtime
 * is enabled. It answers one word so the host can map the answer to a remedy:
 *
 * - `ok` — systemd is PID 1, the user manager answers, `systemd-run` exists
 *   and the user lingers (a headless `wsl.exe --exec` has no login session).
 * - `no-systemd` — `/run/systemd/system` is absent (systemd is not PID 1).
 * - `no-user-manager` — `systemctl --user` does not report running/degraded.
 * - `no-systemd-run` — the `systemd-run` binary is missing.
 * - `no-linger` — the user manager would stop with the last session; the
 *   remedy is `loginctl enable-linger <user>`.
 *
 * `degraded` is accepted: a partially failed unit elsewhere does not make the
 * user manager unable to create a scope.
 *
 * @returns the shell script.
 */
export function sessionScopeProbeScript() {
    return [
        '[ -d /run/systemd/system ] || { echo no-systemd; exit 1; }',
        'state=$(systemctl --user is-system-running 2>/dev/null || true)',
        'case "$state" in running|degraded) ;; *) echo no-user-manager; exit 2;; esac',
        'command -v systemd-run >/dev/null 2>&1 || { echo no-systemd-run; exit 3; }',
        'loginctl show-user "$(id -un)" -p Linger 2>/dev/null | grep -q "^Linger=yes$" || { echo no-linger; exit 4; }',
        "echo ok",
    ].join("\n");
}
/**
 * The host argv for the preflight probe.
 *
 * @param options - the transport path and distro.
 * @returns the `wsl.exe --exec sh -c <script>` argv.
 */
export function sessionScopeProbeArgv({ wslPath, distro }) {
    return [
        wslPath,
        ...(distro.length > 0 ? ["-d", distro] : []),
        "--exec",
        "sh",
        "-c",
        sessionScopeProbeScript(),
    ];
}
