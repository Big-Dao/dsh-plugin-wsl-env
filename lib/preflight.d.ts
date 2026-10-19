/**
 * Session-start sandbox preflight: surface a missing or broken `bwrap` when a
 * distro session OPENS, not when its first command fails closed.
 *
 * Without this the discovery moment is the model's first command, whose
 * `SANDBOX_UNAVAILABLE` error scrolls past as one tool failure among many; the
 * operator may not read it until several commands have failed the same way.
 * The probe itself is not new — it is the providers' own usability probe, run
 * through the same shared cache (`lib/sandbox-core.js`), so a session-start
 * check costs a real probe only once per process, and the first confined
 * command after it pays nothing. Nothing else changes: the failure semantics
 * stay exactly as fail-closed as before, this service only MOVES THE NEWS.
 *
 * Advisory by construction. A preflight that cannot run (no WSL, a wedged
 * `wsl.exe`) degrades to a log line; it must never fail a session that has not
 * even asked for confinement yet. It also never installs anything: the remedy
 * it prints is the same one the refusals carry, and running an installer under
 * root uninvited would be a posture this plugin explicitly rejects.
 *
 * This is a TypeScript source built to `lib/preflight.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/preflight
 */
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "wsl-preflight";
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /**
     * Distro to preflight. Empty/`"auto"` follows the session workspace; an
     * explicit name pins; `"default"` forces WSL's default.
     */
    distro: z<string, string, "defined">;
    /** The `wsl.exe` path the probe spawns; keep in step with the providers' `wslPath`. */
    wslPath: z<string, string, "defined">;
    /** Whether the session-start sandbox preflight runs at all. */
    sandbox: z<boolean, boolean, "defined">;
    /**
     * Whether the preflight also checks the session-runtime prerequisites
     * (systemd PID 1, the user manager, `systemd-run`, Linger). On by default,
     * matching the shipped `sessionSandbox: true`; turn it off when the profile
     * opts out of the session runtime, or the warning would name a prerequisite
     * that profile does not use.
     */
    sessionSandbox: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /**
     * Distro to preflight. Empty/`"auto"` follows the session workspace; an
     * explicit name pins; `"default"` forces WSL's default.
     */
    distro: z<string, string, "defined">;
    /** The `wsl.exe` path the probe spawns; keep in step with the providers' `wslPath`. */
    wslPath: z<string, string, "defined">;
    /** Whether the session-start sandbox preflight runs at all. */
    sandbox: z<boolean, boolean, "defined">;
    /**
     * Whether the preflight also checks the session-runtime prerequisites
     * (systemd PID 1, the user manager, `systemd-run`, Linger). On by default,
     * matching the shipped `sessionSandbox: true`; turn it off when the profile
     * opts out of the session runtime, or the warning would name a prerequisite
     * that profile does not use.
     */
    sessionSandbox: z<boolean, boolean, "defined">;
}>>, "plain">;
/** The config schema's validated output. */
export interface PreflightConfig {
    /** The distro mode: empty/`auto`, an explicit name, or `default`. */
    distro?: string;
    /** The `wsl.exe` path the probe spawns. */
    wslPath?: string;
    /** Whether the session-start sandbox preflight runs at all. */
    sandbox?: boolean;
    /** Whether the session-runtime prerequisites are preflighted too. */
    sessionSandbox?: boolean;
}
/**
 * The slice of a created agent this service inspects; the harness's agent
 * object is structural here, the same view `auto-preset` uses.
 */
export interface PreflightAgent {
    /** The agent's id. */
    id: string;
    /** The session stub, when mounted. */
    session?: {
        header?: {
            cwd?: string | undefined;
        };
    } | undefined;
    /**
     * The agent's own context, when the harness exposes it. Used to publish the
     * advisory into the session's runtime context; absent in the unit tests and
     * on a harness without the `systemPrompt` seam, where the log line stands
     * alone.
     */
    ctx?: {
        inject?: (names: string[], install: (scope: PreflightPromptScope) => void) => unknown;
    } | undefined;
}
/** The slice of a session context that can carry the advisory. */
export interface PreflightPromptScope {
    systemPrompt: {
        context: (entry: {
            name: string;
            order: number;
            text: () => string;
        }) => unknown;
    };
}
/**
 * The cordis context extended with the slices this service consumes. `logger`
 * and the agent service belong to the harness, whose declarations are not
 * visible to this plugin, so they are spelled structurally on top of the
 * framework's {@link Context}.
 */
export type PreflightContext = Context & {
    logger?: {
        debug?: (message: string) => void;
        warn?: (message: string) => void;
    };
    agents?: {
        list: () => PreflightAgent[];
    };
    on: (event: "agent/created", listener: (payload: {
        agent?: PreflightAgent;
    } | undefined) => void) => () => boolean;
};
/**
 * Mount the preflight service.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export declare function apply(ctx: PreflightContext, config?: PreflightConfig): Promise<void>;
