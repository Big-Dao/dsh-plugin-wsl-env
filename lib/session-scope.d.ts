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
export declare function sessionScopeUnit(distro: string, token: string): string;
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
export declare function sessionScopePrefix(unit: string): string[];
/**
 * The host argv that stops one session runtime. Stopping the scope is the
 * cleanup step that replaces the per-command PID namespace: the cgroup kills
 * every descendant, including a background dev server a command left behind.
 *
 * @param options - the transport path, distro and unit name.
 * @returns the `wsl.exe --exec systemctl --user stop` argv.
 */
export declare function sessionScopeStopArgv({ wslPath, distro, unit }: {
    /** The `wsl.exe` path. */
    wslPath: string;
    /** The distro name; empty means the default distro. */
    distro: string;
    /** The unit name from {@link sessionScopeUnit}. */
    unit: string;
}): string[];
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
export declare function sessionScopeProbeScript(): string;
/**
 * The script the session preflight runs to stop scopes a crashed app left
 * behind. A scope is stale when its cgroup has no `wsl-agent.sh` process: a
 * live agent means another session still owns it, so it must not be stopped.
 * The script only lists `dsh-wsl-*.scope` units and only stops the ones it
 * can prove stale; if there is no user manager it exits 0 (the session
 * preflight reports that condition separately).
 *
 * @returns the shell script.
 */
export declare function sessionScopeSweepScript(): string;
/**
 * Map the preflight's answer to a user-facing refusal, or `null` when the
 * platform can host a session runtime. The probe prints one word (it always
 * exits 0 so the host reads a verdict, not a spawn error); an empty or unknown
 * answer is reported with whatever diagnostic the host captured.
 *
 * @param options - the probe output and the distro it ran in.
 * @returns the refusal with a remedy, or null.
 */
export declare function sessionScopeProblem({ output, distro }: {
    /** The probe's stdout, or the host error when it could not run. */
    output: {
        stdout: string;
        error?: string;
    };
    /** The distro the probe ran in. */
    distro: string;
}): string | null;
/**
 * The host argv for the preflight probe.
 *
 * @param options - the transport path and distro.
 * @returns the `wsl.exe --exec sh -c <script>` argv.
 */
export declare function sessionScopeProbeArgv({ wslPath, distro }: {
    /** The `wsl.exe` path. */
    wslPath: string;
    /** The distro name; empty means the default distro. */
    distro: string;
}): string[];
