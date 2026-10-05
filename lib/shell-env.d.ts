/**
 * The config schema's validated output.
 *
 * @typedef {object} ShellEnvConfig
 * @property {string} [distro] - Distro these facts describe; empty means this machine's default distro.
 * @property {number} [portsRefreshMs] - How often the listening-port snapshot refreshes, in milliseconds.
 */
/**
 * The execution slice the shell-env registry hands a contributor's `resolve`;
 * the harness's execution object is structural here.
 *
 * @typedef {object} ShellEnvExecution
 * @property {{session?: {header?: {cwd?: string|undefined}}|undefined}|undefined} [agent] - the executing session's agent stub.
 */
/**
 * The cordis context extended with the `shellEnv` registry slice this plugin
 * contributes through. The registry belongs to the harness and its
 * declaration is not visible to this plugin, so it is spelled structurally on
 * top of the framework's {@link Context}.
 *
 * @typedef {import("@deepseek-ai/cordis").Context & {
 *   shellEnv: {
 *     register: (contributor: {
 *       name: string,
 *       variables: Record<string, {description: string}>,
 *       resolve: (execution: ShellEnvExecution|undefined) => Record<string, string>,
 *     }) => () => void,
 *   },
 * }} ShellEnvContext
 */
/**
 * Contribute the WSL environment's facts to the shell-env registry.
 * @param {ShellEnvContext} ctx - the cordis context.
 * @param {ShellEnvConfig} [config] - the schema-validated plugin config.
 */
export function apply(ctx: ShellEnvContext, config?: ShellEnvConfig): Promise<void>;
export const name: "wsl-shell-env";
export const inject: string[];
export const Config: z<Schemastery.ObjectS<NoInfer<{
    /** Distro these facts describe; empty means this machine's default distro. */
    distro: z<string, string, "defined">;
    /** How often the listening-port snapshot refreshes, in milliseconds. */
    portsRefreshMs: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** Distro these facts describe; empty means this machine's default distro. */
    distro: z<string, string, "defined">;
    /** How often the listening-port snapshot refreshes, in milliseconds. */
    portsRefreshMs: z<number, number, "defined">;
}>>, "plain">;
/**
 * The config schema's validated output.
 */
export type ShellEnvConfig = {
    /**
     * - Distro these facts describe; empty means this machine's default distro.
     */
    distro?: string | undefined;
    /**
     * - How often the listening-port snapshot refreshes, in milliseconds.
     */
    portsRefreshMs?: number | undefined;
};
/**
 * The execution slice the shell-env registry hands a contributor's `resolve`;
 * the harness's execution object is structural here.
 */
export type ShellEnvExecution = {
    /**
     * - the executing session's agent stub.
     */
    agent?: {
        session?: {
            header?: {
                cwd?: string | undefined;
            };
        } | undefined;
    } | undefined;
};
/**
 * The cordis context extended with the `shellEnv` registry slice this plugin
 * contributes through. The registry belongs to the harness and its
 * declaration is not visible to this plugin, so it is spelled structurally on
 * top of the framework's {@link Context}.
 */
export type ShellEnvContext = import("@deepseek-ai/cordis").Context & {
    shellEnv: {
        register: (contributor: {
            name: string;
            variables: Record<string, {
                description: string;
            }>;
            resolve: (execution: ShellEnvExecution | undefined) => Record<string, string>;
        }) => () => void;
    };
};
import z from "@deepseek-ai/schemastery";
