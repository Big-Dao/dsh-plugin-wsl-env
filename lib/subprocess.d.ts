/**
 * `ctx.subprocess` entrypoint — the WSL execution world behind the GUI's
 * terminal window.
 *
 * ## Why this seam, and not `ctx.terminals`
 *
 * `ctx.terminals` (`@deepseek-ai/dsh-terminal` + `dsh-terminal-bash`) is the
 * *model-facing* persistent-terminal service. The right-hand terminal window is
 * a different subsystem: its host half is
 * `@deepseek-ai/dsh-api-terminal-controller`, mounted once by the Web bundle,
 * and it resolves the execution environment of the Session it serves with
 *
 *     execution(agent) {
 *       const subprocess = agent.ctx.get("subprocess");
 *       const sandboxPolicy = agent.ctx.get("sandboxPolicy");
 *       ...
 *     }
 *
 * ## Why a preset-scoped provider cannot serve it
 *
 * The obvious design — mount this provider in the `wsl` preset's isolate realm
 * next to `shell` and `fs` — does not work, and the reason is worth recording
 * because it is invisible from the profile YAML:
 *
 *   - A preset's isolate realms are created by `dsh-agent-preset-registry`
 *     under the registry's **own** context:
 *     `createScope(this.owner, key)` → `mountPreset(scope.ctx…)`.
 *   - An Agent's context is a **parallel branch** created by the agent loop:
 *     `this.scope = createScope(loopCtx, this); this.ctx = this.scope.ctx`,
 *     where `loopCtx` is the root-mounted `ctx.agents` service context.
 *     `createScope` only wraps a Cordis plugin and tags a scope key; it neither
 *     touches `Context.isolate` nor passes through a loader entry, so the
 *     agent's isolate map still resolves every service to the root realm.
 *
 * So `agent.ctx.get("subprocess")` always finds the **composition-level**
 * provider, whatever the agent's preset isolates. The shipped registry provides
 * `agentPresets.serviceFor(agent, name)` for exactly this gap, and the terminal
 * controller does not use it. (`shell` and `fs` are unaffected: the model-facing
 * tools live *inside* the preset tree, so their own contexts do resolve the
 * realm.)
 *
 * ## What this provider therefore changes
 *
 * It replaces the shipped `subprocess` row at the composition level and
 * overrides two methods. `spawnTerminal` rewrites a `wsl.exe` launch into a
 * launch that actually names the distro and the Session workspace's Linux
 * directory. `spawn` rewrites one further launch — the file-search tool's
 * packaged ripgrep binary, which a distro workspace's UNC working directory
 * names outright — into the distro's own rg: agent-first, one round trip on
 * the warm resident, with the one-shot `wsl.exe --exec` handle as the
 * documented fallback when the agent is out (`lib/search-route.js` holds the
 * decision, `lib/search-exec.js` the handle). Every other request —
 * including every other `spawn()`, which the command path uses for
 * `wsl.exe -lc <command>` — reaches the shipped implementation untouched.
 *
 * The interpreter, the PTY, output handling and process-tree teardown stay the
 * shipped implementation's, so the blast radius of replacing a root service
 * stays at the two things that were wrong: the directory and distro a terminal
 * starts in, and the filesystem a search walks.
 *
 * ## What the operator must pair it with
 *
 * `terminalEnvironment()` and `resolveExecutable()` are also resolved from the
 * root realm, and neither receives a Session or a directory, so this provider
 * deliberately leaves them alone: rewriting them would change executable lookup
 * for every other root consumer (the pwsh executor, the LSP host, the file
 * search) to make the *shell menu* of one window prettier. The profile instead
 * configures the terminal controller with the single shell profile that matters:
 * `shell: { path: wsl.exe, name: WSL }` and `shellCandidates: []`.
 *
 * Consequence worth stating plainly: the terminal is a property of the
 * composition, not of the Session. A Session whose workspace is a Windows folder
 * gets the same terminal, with that folder mounted at `/mnt/<drive>/…`.
 *
 * This is a TypeScript source built to `lib/subprocess.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/subprocess
 */
import z from "@deepseek-ai/schemastery";
import { LocalSubprocessRuntime } from "@deepseek-ai/dsh-subprocess-local";
import type { Context } from "@deepseek-ai/cordis";
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from "@deepseek-ai/dsh-subprocess";
import type { SubprocessTerminalActivity } from "./terminal-activity.js";
/**
 * The static Config schema's validated output. Every defaulted field is
 * present after validation; `hostCwd` is the volatile accessor the schema
 * builds.
 */
export interface WslSubprocessConfig {
    /** Distro name; empty means WSL's own default distro. */
    distro: string;
    /** Path to `wsl.exe`. */
    wslPath: string;
    /** A shell to pin inside the distro, as an absolute Linux path. */
    shell: string;
    /** Login-shell semantics for a pinned shell. */
    loginShell: boolean;
    /** Fallback directory when a launch names none. */
    cwd: string;
    /** Windows directory the `wsl.exe` process itself starts in. */
    hostCwd: {
        get: () => string | undefined;
    };
    /** Extra env names to forward into the distro through WSLENV. */
    forwardEnv: string[];
    /** Whether a session on a Windows folder gets a host shell. */
    hostSessions: boolean;
    /** Whether the controller may reclaim an idle distro terminal. */
    terminalIdleReclaim: boolean;
}
/**
 * Subprocess provider that serves a WSL distro as the composition's terminal
 * execution world.
 *
 * Mount it at the profile root in place of the shipped local provider (the
 * profile patch disables the `subprocess` row and inserts this one). It is a
 * subclass rather than a wrapper, so every method it does not override is
 * literally the shipped implementation.
 */
export declare class WslSubprocessRuntime extends LocalSubprocessRuntime {
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
    /** The schema-validated config. */
    config: WslSubprocessConfig;
    /** Cached default distro, resolved once from `wsl.exe -l -q`. */
    resolvedDistro: string;
    /**
     * @param ctx - the cordis context.
     * @param config - the schema-validated config.
     */
    constructor(ctx: Context, config: WslSubprocessConfig);
    /**
     * The distro a launch uses when the request's directory does not name one,
     * resolving WSL's default on first use.
     *
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
     * @param cwd - the request's working directory, in any coordinate system.
     * @returns the distro name and its absolute Linux directory.
     */
    terminalTarget(cwd: string | undefined): Promise<{
        distro: string;
        linuxCwd: string;
    }>;
    /**
     * Open one interactive shell inside the distro over the host's PTY.
     *
     * Only a `wsl.exe` launch is rewritten. Everything else — a shipped host
     * shell, the PTY backend's `bash -i`, any other consumer's terminal — is the
     * shipped implementation's, which is what keeps replacing a root provider
     * safe.
     *
     * The request's remaining arguments are intentionally not forwarded: the
     * controller's shell profile carries only the program, and a second set of
     * `wsl.exe` arguments would fight the distro and `--cd` this method derives
     * from the Session.
     *
     * @param spec - the terminal request from the PTY consumer.
     * @returns the live terminal handle.
     */
    spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>;
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
     * @param distro - the distro the terminal lives in.
     * @param terminalId - the launch's `DSH_TERMINAL_ID` mark.
     * @returns the seam's activity observation.
     */
    distroActivity(distro: string, terminalId: string): () => Promise<SubprocessTerminalActivity>;
    /**
     * Open one host-side process, rewriting two kinds of launches into the
     * distro: the file-search tool's ripgrep (agent-first, one-shot fallback)
     * and git snapshot commands (one-shot only — snapshot operations are not
     * latency-sensitive, and their stdin relay and collected streams are the
     * shipped handle's). Both decisions are pure coordinate functions
     * (`search-route.js`, `git-route.js`); a spawn neither names (any other
     * program, any drive or relative directory) reaches the shipped
     * implementation verbatim.
     *
     * @param spec - the spawn request.
     * @returns the live search handle.
     */
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
    /**
     * The environment one `wsl.exe` launch forwards: the safe list plus every
     * managed `DSH_*` name, admitted through `WSLENV` and never `PATH` — see the
     * WSLENV note in the recipes.
     *
     * @param spec - the launch request whose env is forwarded.
     * @returns the environment the host launch carries.
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
     * @param argv - the request's program and arguments.
     * @returns true when this provider owns the launch.
     */
    launchesDistro(argv?: readonly string[]): boolean;
}
export default WslSubprocessRuntime;
