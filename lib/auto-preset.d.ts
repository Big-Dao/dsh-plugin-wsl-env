/**
 * Auto-preset: bind an agent to the WSL preset when its workspace directory
 * lives inside a distro.
 *
 * Why an event hook and not configuration: the environment is chosen in
 * `dsh-api-session-controller`'s `composeAgent(presetId)`, whose signature has no
 * working directory — the cwd only exists one frame up in
 * `ensureSession(sessionId, cwd, ...)`. So the path-aware decision has to be made
 * where the path IS available. `agent/created` carries it:
 *
 *     ctx.serial(carrier, "agent/created", { agent, source, signal })
 *
 * and `agent.session.header.cwd` is the session's workspace directory.
 *
 * Two details are load-bearing, both established by experiment:
 *
 *  1. **Respect an explicit choice.** By the time the event fires, the resolved
 *     preset is already mounted (`composeAgent` mounts request-or-default in
 *     `setup`). We cannot tell which of the two it was — so we only ever rewrite
 *     when the mounted preset equals the registry default, which means the client
 *     omitted it. An operator's pick is never overridden.
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
 * @module dsh-plugin-wsl/auto-preset
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
}>>, Schemastery.ObjectT<NoInfer<{
    /** Preset to bind for a WSL workspace. */
    preset: z<string, string, "defined">;
    /** Attempts before giving up; each waits `retryMs`. */
    attempts: z<number, number, "defined">;
    /** Gap between attempts, in milliseconds. */
    retryMs: z<number, number, "defined">;
}>>, "plain">;
/** The config schema's validated output. */
export interface AutoPresetConfig {
    /** Preset to bind for a WSL workspace. */
    preset?: string;
    /** Attempts before giving up; each waits `retryMs`. */
    attempts?: number;
    /** Gap between attempts, in milliseconds. */
    retryMs?: number;
}
/**
 * The slice of a created agent this plugin inspects; the harness's agent
 * object is structural here.
 */
export interface CreatedAgentView {
    /** The agent's id. */
    id: string;
    /** The session stub, when mounted. */
    session?: {
        header?: {
            cwd?: string | undefined;
        };
    } | undefined;
    /** The agent's own context. */
    ctx: Context;
}
/**
 * The cordis context extended with the agent-service slices this plugin
 * consumes. `agents` and `agentPresets` come from the harness's agent
 * packages, whose declarations are not visible to this plugin, so they are
 * spelled structurally on top of the framework's {@link Context}.
 */
export type AutoPresetContext = Context & {
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
        agents?: {
            ensureSession: (this: unknown, sessionId: string, cwd: string | undefined, checkPersistedIdentity: boolean, presetId: string | undefined) => Promise<unknown>;
        };
    };
};
/**
 * Mount the auto-preset plugin.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export declare function apply(ctx: AutoPresetContext, config?: AutoPresetConfig): Promise<void>;
