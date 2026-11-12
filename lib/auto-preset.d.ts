/**
 * Auto-preset: bind an agent to the WSL preset when its workspace directory
 * lives inside a distro.
 *
 * Why an event hook and not configuration: the environment is chosen in
 * `dsh-api-session-controller`'s `composeAgent(presetId)`, whose signature has no
 * working directory. The creation API above it — `createSession({ cwd,
 * agentPreset, ... })` — holds both, so this row wraps that frame to fill the
 * preset before the first mount; the `agent/created` event below is the
 * fallback for flows that do not pass through it:
 *
 *     ctx.serial(carrier, "agent/created", { agent, source, signal })
 *
 * and `agent.session.header.cwd` is the session's workspace directory.
 *
 * Two details are load-bearing, both established by experiment:
 *
 *  1. **Respect an explicit choice.** By the time the event fires, the resolved
 *     preset is already mounted (`composeAgent` mounts request-or-default in
 *     `setup`). A non-default preset id is an operator's pick and is never
 *     overridden. The default id (or no id at all) is not a pick of another
 *     environment: the client may send it explicitly, so the creation-time hook
 *     treats it as automatic for a distro workspace.
 *
 *  2. **Switch after creation, not during.** Switching inside the listener
 *     collides with the previous generation's tools:
 *         Error: tool "subagent" is already registered in this scope
 *     Deferring past the creating call fixes it — the session is still blank
 *     (no turn has started), so `select()` remains legal. A short retry loop
 *     absorbs the remaining ordering slack instead of relying on one timer.
 *
 * This is a TypeScript source built to `lib/auto-preset.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/auto-preset
 */
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "auto-preset";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** Preset to bind for a WSL workspace. */
    preset: z<string, string, "defined">;
    /** Attempts before giving up; each waits `retryMs`. */
    attempts: z<number, number, "defined">;
    /** Gap between attempts, in milliseconds. */
    retryMs: z<number, number, "defined">;
    /**
     * Workspace directories the operator opened for Windows access (9p) instead
     * of the distro environment. A session inside one of them keeps the host
     * preset, so the choice made in the sidebar survives later sessions.
     *
     * Volatile: the sidebar's access-mode dialog records the choice through the
     * Settings service, and this row must observe it without a remount.
     */
    windowsWorkspaces: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** Preset to bind for a WSL workspace. */
    preset: z<string, string, "defined">;
    /** Attempts before giving up; each waits `retryMs`. */
    attempts: z<number, number, "defined">;
    /** Gap between attempts, in milliseconds. */
    retryMs: z<number, number, "defined">;
    /**
     * Workspace directories the operator opened for Windows access (9p) instead
     * of the distro environment. A session inside one of them keeps the host
     * preset, so the choice made in the sidebar survives later sessions.
     *
     * Volatile: the sidebar's access-mode dialog records the choice through the
     * Settings service, and this row must observe it without a remount.
     */
    windowsWorkspaces: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, "plain">;
/** The config schema's validated output. */
interface AutoPresetConfig {
    /** Preset to bind for a WSL workspace. */
    preset?: string;
    /** Attempts before giving up; each waits `retryMs`. */
    attempts?: number;
    /** Gap between attempts, in milliseconds. */
    retryMs?: number;
    /**
     * Paths reserved for Windows access. The Loader hands a volatile field to
     * `apply` as a live reference, so both spellings are accepted: a reference
     * when the row was composed by the Loader, a plain array in hand-built test
     * contexts.
     */
    windowsWorkspaces?: readonly string[] | {
        get: () => readonly string[];
    };
}
/**
 * The slice of a created agent this plugin inspects; the harness's agent
 * object is structural here.
 */
interface CreatedAgentView {
    /** The agent's id. */
    id: string;
    /** The session stub, when mounted. */
    session?: {
        header?: {
            cwd?: string | undefined;
            /** A subagent session inherits its parent's environment; it gets no advisory of its own. */
            origin?: string | undefined;
            parentSession?: string | undefined;
        } | undefined;
    } | undefined;
    /** The agent's own context. */
    ctx: Context;
}
/**
 * The create request the host's session-agent controller accepts (0.2.2+).
 * Only the fields this row reads are spelled here; the wrapper forwards the
 * whole object, so a newer host field survives untouched.
 */
interface SessionCreateRequestLike {
    /** The blank session to reuse, when the caller named one. */
    readonly sessionId?: string;
    /** The workspace the session owns. */
    readonly cwd: string;
    /** The preset the caller requested, or undefined for the default. */
    readonly agentPreset?: string;
    /** The caller's reuse policy, forwarded untouched. */
    readonly reusable: (sessionId: string) => boolean;
}
/** The controller slice this row wraps. */
interface SessionAgentFacade {
    /** Create or reuse the session for one request; the creation-time seam. */
    createSession?: (request: SessionCreateRequestLike) => Promise<unknown>;
}
/**
 * The cordis context extended with the agent-service slices this plugin
 * consumes. `agents` and `agentPresets` come from the harness's agent
 * packages, whose declarations are not visible to this plugin, so they are
 * spelled structurally on top of the framework's {@link Context}.
 */
type AutoPresetContext = Context & {
    agents: {
        list: () => CreatedAgentView[];
    };
    agentPresets: {
        composedPreset: (ctx: Context) => string | undefined;
        defaultId: string | undefined;
        select: (agent: CreatedAgentView, presetId: string) => Promise<string>;
    };
    on: (event: "agent/created", listener: (payload: {
        agent?: CreatedAgentView;
    } | undefined) => void) => () => boolean;
    sessionController?: {
        agents?: SessionAgentFacade;
    };
};
/**
 * Mount the auto-preset plugin.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export declare function apply(ctx: AutoPresetContext, config?: AutoPresetConfig): Promise<void>;
export {};
