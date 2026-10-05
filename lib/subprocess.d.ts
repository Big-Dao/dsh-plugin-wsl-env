/**
 * The static Config schema's validated output. Every defaulted field is
 * present after validation; `hostCwd` is the volatile accessor the schema
 * builds.
 *
 * @typedef {object} WslSubprocessConfig
 * @property {string} distro - Distro name; empty means WSL's own default distro.
 * @property {string} wslPath - Path to `wsl.exe`.
 * @property {string} shell - A shell to pin inside the distro, as an absolute Linux path.
 * @property {boolean} loginShell - Login-shell semantics for a pinned shell.
 * @property {string} cwd - Fallback directory when a launch names none.
 * @property {{get: () => string|undefined}} hostCwd - Windows directory the `wsl.exe` process itself starts in.
 * @property {string[]} forwardEnv - Extra env names to forward into the distro through WSLENV.
 * @property {boolean} hostSessions - Whether a session on a Windows folder gets a host shell.
 * @property {boolean} terminalIdleReclaim - Whether the controller may reclaim an idle distro terminal.
 */
/**
 * Subprocess provider that serves a WSL distro as the composition's terminal
 * execution world.
 *
 * Mount it at the profile root in place of the shipped local provider (the
 * profile patch disables the `subprocess` row and inserts this one). It is a
 * subclass rather than a wrapper, so every method it does not override is
 * literally the shipped implementation.
 */
export class WslSubprocessRuntime extends LocalSubprocessRuntime {
    static Config: z<Schemastery.ObjectS<NoInfer<{
        /** Distro name; empty means WSL's own default distro. */
        distro: z<string, string, "defined">;
        /** Path to `wsl.exe`; overridable for a non-standard install. */
        wslPath: z<string, string, "defined">;
        /**
         * A shell to pin inside the distro, as an absolute Linux path. Empty — the
         * default — leaves the choice to `wsl.exe`, which starts the distro user's
         * login shell exactly as an interactive `wsl.exe` does.
         */
        shell: z<string, string, "defined">;
        /**
         * Login-shell semantics for a pinned shell. Ignored when no shell is pinned,
         * because then the login shell is the shell.
         */
        loginShell: z<boolean, boolean, "defined">;
        /** Fallback directory when a launch names none; accepts any coordinate system. */
        cwd: z<string, string, "defined">;
        /** Windows directory the `wsl.exe` process itself starts in. */
        hostCwd: z<string, string, "volatile">;
        /** Extra env names to forward into the distro through WSLENV. */
        forwardEnv: z<string[], string[], "defined">;
        /**
         * Give a session opened on a WINDOWS folder a host shell instead of the
         * distro's shell started at `/mnt/<drive>/…`. WSL-folder sessions always
         * get the distro shell — that is this provider's purpose. `false` restores
         * the composition-owned terminal for every session.
         */
        hostSessions: z<boolean, boolean, "defined">;
        /**
         * Let the controller reclaim an idle distro terminal. The terminal is
         * marked at launch (`DSH_TERMINAL_ID` through the existing `WSLENV`
         * forwarding) and its handle's `inspectActivity` is replaced with a
         * distro-side observation: the resident agent scans `/proc` for the
         * marker — a shell with live children is busy, a shell without children
         * is idle. The shipped observation can only answer `unknown` for a distro
         * terminal, and `unknown` never accumulates idle, which is why these
         * terminals had to be closed by hand. When the agent is out the
         * observation answers `unknown` (no reclaim) — a probe that cannot answer
         * must not authorize a close. `false` restores that posture.
         */
        terminalIdleReclaim: z<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /** Distro name; empty means WSL's own default distro. */
        distro: z<string, string, "defined">;
        /** Path to `wsl.exe`; overridable for a non-standard install. */
        wslPath: z<string, string, "defined">;
        /**
         * A shell to pin inside the distro, as an absolute Linux path. Empty — the
         * default — leaves the choice to `wsl.exe`, which starts the distro user's
         * login shell exactly as an interactive `wsl.exe` does.
         */
        shell: z<string, string, "defined">;
        /**
         * Login-shell semantics for a pinned shell. Ignored when no shell is pinned,
         * because then the login shell is the shell.
         */
        loginShell: z<boolean, boolean, "defined">;
        /** Fallback directory when a launch names none; accepts any coordinate system. */
        cwd: z<string, string, "defined">;
        /** Windows directory the `wsl.exe` process itself starts in. */
        hostCwd: z<string, string, "volatile">;
        /** Extra env names to forward into the distro through WSLENV. */
        forwardEnv: z<string[], string[], "defined">;
        /**
         * Give a session opened on a WINDOWS folder a host shell instead of the
         * distro's shell started at `/mnt/<drive>/…`. WSL-folder sessions always
         * get the distro shell — that is this provider's purpose. `false` restores
         * the composition-owned terminal for every session.
         */
        hostSessions: z<boolean, boolean, "defined">;
        /**
         * Let the controller reclaim an idle distro terminal. The terminal is
         * marked at launch (`DSH_TERMINAL_ID` through the existing `WSLENV`
         * forwarding) and its handle's `inspectActivity` is replaced with a
         * distro-side observation: the resident agent scans `/proc` for the
         * marker — a shell with live children is busy, a shell without children
         * is idle. The shipped observation can only answer `unknown` for a distro
         * terminal, and `unknown` never accumulates idle, which is why these
         * terminals had to be closed by hand. When the agent is out the
         * observation answers `unknown` (no reclaim) — a probe that cannot answer
         * must not authorize a close. `false` restores that posture.
         */
        terminalIdleReclaim: z<boolean, boolean, "defined">;
    }>>, "plain">;
    /**
     * @param {import("@deepseek-ai/cordis").Context} ctx - the cordis context.
     * @param {WslSubprocessConfig} config - the schema-validated config.
     */
    constructor(ctx: import("@deepseek-ai/cordis").Context, config: WslSubprocessConfig);
    config: WslSubprocessConfig;
    /** Cached default distro, resolved once from `wsl.exe -l -q`. */
    resolvedDistro: string;
    /**
     * The distro a launch uses when the request's directory does not name one,
     * resolving WSL's default on first use.
     * @returns the distro name.
     */
    distro(): Promise<string>;
    /** Windows directory the `wsl.exe` process is started from. */
    hostCwd(): string;
    /**
     * The distro and Linux directory one terminal request names.
     *
     * The Session workspace the terminal controller passes in is the coordinate
     * the harness already speaks, and it is also the strongest evidence of the
     * intended distro: a UNC path names one outright. Anything else — a Windows
     * drive path or a directory-less request — may legitimately be served by the
     * configured distro.
     *
     * @param {string|undefined} cwd - the request's working directory, in any coordinate system.
     * @returns {Promise<{distro: string, linuxCwd: string}>} the distro name and its absolute Linux directory.
     */
    terminalTarget(cwd: string | undefined): Promise<{
        distro: string;
        linuxCwd: string;
    }>;
    /**
     * The replacement `inspectActivity` for one distro terminal: ask the
     * resident agent whether the marked shell is at its prompt.
     *
     * The revision increments only when the reported state changes, so the
     * controller's retention accumulates idle across consecutive `idle`
     * observations and restarts the clock on every transition. Any probe
     * failure — the agent out, the distro stopped, a script error — answers
     * `unknown`, which the retention reads as "not idle": the probe that cannot
     * answer never authorizes a close. The first unexpected (non-availability)
     * failure is logged once, so a broken probe is diagnosable without
     * spamming the log every poll.
     *
     * @param {string} distro - the distro the terminal lives in.
     * @param {string} terminalId - the launch's `DSH_TERMINAL_ID` mark.
     * @returns {() => Promise<import("./terminal-activity.js").SubprocessTerminalActivity>} the seam's activity observation.
     */
    distroActivity(distro: string, terminalId: string): () => Promise<import("./terminal-activity.js").SubprocessTerminalActivity>;
    /**
     * The environment one `wsl.exe` launch forwards: the safe list plus every
     * managed `DSH_*` name, admitted through `WSLENV` and never `PATH` — see the
     * WSLENV note in the recipes.
     * @param {{env?: Record<string, string|undefined>|undefined}} spec - the launch request whose env is forwarded.
     * @returns {Record<string, string>|Record<string, string|undefined>|undefined} the environment the host launch carries.
     */
    forwardedEnv(spec: {
        env?: Record<string, string | undefined> | undefined;
    }): Record<string, string> | Record<string, string | undefined> | undefined;
    /**
     * Whether a terminal request is a `wsl.exe` launch.
     *
     * A bare `argv[0]` is judged by its own name, so the shipped program name and
     * an operator-pinned absolute path both match.
     *
     * @param {readonly string[]} [argv] - the request's program and arguments.
     * @returns {boolean} true when this provider owns the launch.
     */
    launchesDistro(argv?: readonly string[]): boolean;
}
export default WslSubprocessRuntime;
/**
 * The static Config schema's validated output. Every defaulted field is
 * present after validation; `hostCwd` is the volatile accessor the schema
 * builds.
 */
export type WslSubprocessConfig = {
    /**
     * - Distro name; empty means WSL's own default distro.
     */
    distro: string;
    /**
     * - Path to `wsl.exe`.
     */
    wslPath: string;
    /**
     * - A shell to pin inside the distro, as an absolute Linux path.
     */
    shell: string;
    /**
     * - Login-shell semantics for a pinned shell.
     */
    loginShell: boolean;
    /**
     * - Fallback directory when a launch names none.
     */
    cwd: string;
    /**
     * - Windows directory the `wsl.exe` process itself starts in.
     */
    hostCwd: {
        get: () => string | undefined;
    };
    /**
     * - Extra env names to forward into the distro through WSLENV.
     */
    forwardEnv: string[];
    /**
     * - Whether a session on a Windows folder gets a host shell.
     */
    hostSessions: boolean;
    /**
     * - Whether the controller may reclaim an idle distro terminal.
     */
    terminalIdleReclaim: boolean;
};
import { LocalSubprocessRuntime } from "@deepseek-ai/dsh-subprocess-local";
import z from "@deepseek-ai/schemastery";
