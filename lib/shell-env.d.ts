/**
 * Contribute the WSL environment's facts to the managed `DSH_*` namespace.
 *
 * `dsh-shell-env` owns `ctx.shellEnv`, the registry that rebuilds the trusted
 * `DSH_*` variables injected into every model shell call. That is DSH's sanctioned
 * channel for telling a model what its shell environment actually is — the shell
 * tool's own description points the model at it ("Managed `$DSH_*` variables
 * expose current harness environment facts").
 *
 * It has one built-in key that looks like it should carry this, and does not:
 *
 *     collect() { const values = { [DSH_HOME_ENV]: this.dshHome, [DSH_SHELL_KEY]: "1" } }
 *
 * `DSH_SHELL` is a marker FLAG (`=1`) meaning "a DSH-managed shell call", not the
 * shell path, and it is in `RESERVED_BASH_ENV_KEYS`, so a contributor may not own
 * it. The supported way to convey the real shell is a `DSH_`-prefixed key of our
 * own, declared with a description and resolved synchronously.
 *
 * Scoping uses the same test as `auto-preset`: the agent's recorded workspace
 * directory. A session whose workspace is inside a distro is exactly a session
 * whose shell calls run in that distro — so a host session sees none of these.
 *
 * This is a TypeScript source built to `lib/shell-env.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/shell-env
 */
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
export declare const name = "wsl-shell-env";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
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
/** The config schema's validated output. */
export interface ShellEnvConfig {
    /** Distro these facts describe; empty means this machine's default distro. */
    distro?: string;
    /** How often the listening-port snapshot refreshes, in milliseconds. */
    portsRefreshMs?: number;
}
/**
 * The execution slice the shell-env registry hands a contributor's `resolve`;
 * the harness's execution object is structural here.
 */
export interface ShellEnvExecution {
    /** The executing session's agent stub. */
    agent?: {
        session?: {
            header?: {
                cwd?: string | undefined;
            } | undefined;
        } | undefined;
    } | undefined;
}
/**
 * The cordis context extended with the `shellEnv` registry slice this plugin
 * contributes through. The registry belongs to the harness and its
 * declaration is not visible to this plugin, so it is spelled structurally on
 * top of the framework's {@link Context}.
 */
export type ShellEnvContext = Context & {
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
/**
 * Contribute the WSL environment's facts to the shell-env registry.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export declare function apply(ctx: ShellEnvContext, config?: ShellEnvConfig): Promise<void>;
