/**
 * The config schema's validated output.
 *
 * @typedef {object} AutoPresetConfig
 * @property {string} [preset] - Preset to bind for a WSL workspace.
 * @property {number} [attempts] - Attempts before giving up; each waits `retryMs`.
 * @property {number} [retryMs] - Gap between attempts, in milliseconds.
 */
/**
 * The slice of a created agent this plugin inspects; the harness's agent
 * object is structural here.
 *
 * @typedef {object} CreatedAgentView
 * @property {string} id - the agent's id.
 * @property {{header?: {cwd?: string|undefined}}|undefined} [session] - the session stub, when mounted.
 * @property {import("@deepseek-ai/cordis").Context} ctx - the agent's own context.
 */
/**
 * The cordis context extended with the agent-service slices this plugin
 * consumes. `agents` and `agentPresets` come from the harness's agent
 * packages, whose declarations are not visible to this plugin, so they are
 * spelled structurally on top of the framework's {@link Context}.
 *
 * @typedef {import("@deepseek-ai/cordis").Context & {
 *   agents: {list: () => CreatedAgentView[]},
 *   agentPresets: {
 *     composedPreset: (ctx: import("@deepseek-ai/cordis").Context) => string|undefined,
 *     defaultId: string|undefined,
 *     select: (agent: CreatedAgentView, presetId: string) => Promise<string>,
 *   },
 *   on: (event: "agent/created", listener: (payload: {agent?: CreatedAgentView}|undefined) => void) => () => boolean,
 *   sessionController?: {agents?: {ensureSession: (this: unknown, sessionId: string, cwd: string|undefined, checkPersistedIdentity: boolean, presetId: string|undefined) => Promise<unknown>}},
 * }} AutoPresetContext
 */
/**
 * Mount the auto-preset plugin.
 * @param {AutoPresetContext} ctx - the cordis context.
 * @param {AutoPresetConfig} [config] - the schema-validated plugin config.
 */
export function apply(ctx: AutoPresetContext, config?: AutoPresetConfig): Promise<void>;
export const name: "auto-preset";
export const inject: string[];
export const Config: z<Schemastery.ObjectS<NoInfer<{
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
/**
 * The config schema's validated output.
 */
export type AutoPresetConfig = {
    /**
     * - Preset to bind for a WSL workspace.
     */
    preset?: string | undefined;
    /**
     * - Attempts before giving up; each waits `retryMs`.
     */
    attempts?: number | undefined;
    /**
     * - Gap between attempts, in milliseconds.
     */
    retryMs?: number | undefined;
};
/**
 * The slice of a created agent this plugin inspects; the harness's agent
 * object is structural here.
 */
export type CreatedAgentView = {
    /**
     * - the agent's id.
     */
    id: string;
    /**
     * - the session stub, when mounted.
     */
    session?: {
        header?: {
            cwd?: string | undefined;
        };
    } | undefined;
    /**
     * - the agent's own context.
     */
    ctx: import("@deepseek-ai/cordis").Context;
};
/**
 * The cordis context extended with the agent-service slices this plugin
 * consumes. `agents` and `agentPresets` come from the harness's agent
 * packages, whose declarations are not visible to this plugin, so they are
 * spelled structurally on top of the framework's {@link Context}.
 */
export type AutoPresetContext = import("@deepseek-ai/cordis").Context & {
    agents: {
        list: () => CreatedAgentView[];
    };
    agentPresets: {
        composedPreset: (ctx: import("@deepseek-ai/cordis").Context) => string | undefined;
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
import z from "@deepseek-ai/schemastery";
