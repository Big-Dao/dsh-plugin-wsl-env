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
 * @module dsh-plugin-wsl-env/shell-env
 */
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
/**
 * One Windows path as the POSIX side sees it through the default automount
 * (`C:\a\b` → `/mnt/c/a/b`). The doctor command names the app's own runtime
 * this way, because it is executed by the distro's shell through interop.
 * A moved automount root is the `distro.wsl-conf-automount` check's finding,
 * not this mapping's problem to guess.
 * @param p - the Windows path.
 * @returns the POSIX form for a `C:`-drive path; anything else passes through.
 */
export declare function windowsToPosix(p: string): string;
/**
 * The `DSH_WSL_DOCTOR` value: a ready-to-run POSIX-sh command that executes
 * the plugin's doctor from inside a distro session. The interpreter is the
 * app's own runtime in Node mode (`ELECTRON_RUN_AS_NODE=1` — the same
 * mechanism the probe suite uses for headless CLI runs), reached through
 * interop at its `/mnt/...` path; the script stays a Windows path because
 * the runtime is a Windows binary and interop translates arguments for
 * nothing. `WSLENV` is inlined so the flag actually crosses the boundary.
 * Windows hosts only: the whole mechanism is the interop path.
 * @param execPath - `process.execPath` in the app process (the runtime binary).
 * @param pluginRoot - the plugin's installed root (holding `scripts/doctor.mjs`).
 * @param isWindows - `process.platform === "win32"` at the call site.
 * @returns the command string, or undefined off Windows.
 */
export declare function doctorFact(execPath: string, pluginRoot: string, isWindows?: boolean): string | undefined;
export declare const name = "wsl-shell-env";
export declare const inject: string[];
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /**
     * Distro these facts describe. Empty/`"auto"` follows each session's
     * workspace; an explicit name pins; `"default"` forces WSL's default.
     */
    distro: z<string, string, "defined">;
    /** How often the listening-port snapshot refreshes, in milliseconds. */
    portsRefreshMs: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /**
     * Distro these facts describe. Empty/`"auto"` follows each session's
     * workspace; an explicit name pins; `"default"` forces WSL's default.
     */
    distro: z<string, string, "defined">;
    /** How often the listening-port snapshot refreshes, in milliseconds. */
    portsRefreshMs: z<number, number, "defined">;
}>>, "plain">;
/** The config schema's validated output. */
export interface ShellEnvConfig {
    /** The distro mode: empty/`auto`, an explicit name, or `default`. */
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
