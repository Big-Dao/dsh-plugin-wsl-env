/**
 * Durable replacement for the local `app.asar` patch this repository used to
 * carry around the host's "Open in app" launcher.
 *
 * Two independent defects made that patch necessary. The first is scrubbed from
 * this route's editor child only; the shipped launcher still inherits it. The
 * second is fixed here without touching the installed archive:
 *
 *   1. The Desktop Host runs with `ELECTRON_RUN_AS_NODE=1`; the host
 *      launcher (`@deepseek-ai/dsh-host-open-in-app`) copies the parent
 *      environment through `scrubbedParentEnv()`, which does not drop that
 *      name. An Electron editor therefore starts as plain Node, exits 1 and
 *      the route answers `launch-failed`. The row scrubs the name from the
 *      **editor child's** environment only. Editing the Host environment would
 *      do the same for every later child, including Node-mode helpers such as
 *      the Windows Job runner, which legitimately inherit it and then fail to
 *      start.
 *   2. An Electron editor launched with a WSL UNC workspace opens the folder
 *      through the 9p share (Windows terminal, Windows extensions). The
 *      earlier patch rewrote the argument to `--folder-uri` and landed in
 *      Remote-WSL. The same conversion is offered here as an authenticated
 *      `POST /api/wsl-env/open-in-app` route; the browser's session-header
 *      menu calls it. The route refuses anything that is not a WSL UNC path,
 *      so it cannot launch an editor for an arbitrary path.
 *
 * The route is registered on the Host connection's authenticated exact-Fetch
 * channel (the same channel as this plugin's status route), so only the owner
 * browser reaches it. A composition without `connection` leaves the route
 * unregistered; the child environment is only built when a launch happens.
 *
 * This is a TypeScript source built to `lib/open-in-app.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/open-in-app
 */
import { spawn } from "node:child_process";
import z from "@deepseek-ai/schemastery";
/** The composition row's plugin name. */
export declare const name = "wsl-open-in-app";
/** The authenticated route the session-header menu posts to. */
export declare const OPEN_IN_APP_PATH = "/api/wsl-env/open-in-app";
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /**
     * Editor executable to launch. Empty resolves VS Code from its usual
     * Windows install locations, then falls back to `Code.exe` on PATH.
     */
    executable: z<string, string, "defined">;
    /** Early-failure watch window per launch, in milliseconds. */
    watchMs: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /**
     * Editor executable to launch. Empty resolves VS Code from its usual
     * Windows install locations, then falls back to `Code.exe` on PATH.
     */
    executable: z<string, string, "defined">;
    /** Early-failure watch window per launch, in milliseconds. */
    watchMs: z<number, number, "defined">;
}>>, "plain">;
/** The config schema's validated output. */
export interface OpenInAppConfig {
    /** Editor executable, or empty for the normal Windows lookup. */
    executable?: string;
    /** Early-failure watch window per launch, in milliseconds. */
    watchMs?: number;
}
/** How one detached launch ended. */
export type LaunchOutcome = "launched" | "missing" | "failed";
/** The environment shape the pure helpers read. */
type Environment = Readonly<Record<string, string | undefined>>;
/** Options for one detached launch. */
export interface LaunchOptions {
    /** Early-failure watch window, in milliseconds. */
    watchMs: number;
    /** Complete child environment; already scrubbed by the caller. */
    env: NodeJS.ProcessEnv;
}
/**
 * Convert a WSL UNC workspace to the `vscode-remote` URI Remote-WSL expects.
 *
 * Both share spellings (`\\wsl.localhost\<distro>\...` and
 * `\\wsl$\<distro>\...`) are accepted; every other path is refused rather
 * than guessed at.
 *
 * @param uncPath - candidate workspace path.
 * @returns the editor URI, or undefined when the path is not WSL UNC.
 */
export declare function editorUri(uncPath: string): string | undefined;
/**
 * The editor executables this machine is likely to carry, in preference order.
 *
 * @param env - environment carrying the Windows install roots.
 * @returns absolute candidate paths; empty when no root is named.
 */
export declare function editorCandidates(env: Environment): string[];
/**
 * Resolve the editor executable: an explicit config value wins; otherwise the
 * first existing install candidate; otherwise the PATH name `Code.exe`.
 *
 * @param config - this row's config.
 * @param env - environment carrying the install roots.
 * @param exists - existence check, injected for tests.
 * @returns the command to spawn.
 */
export declare function resolveEditor(config: OpenInAppConfig, env: Environment, exists?: (path: string) => boolean): string;
/**
 * Remove `ELECTRON_RUN_AS_NODE` from an environment object, in place.
 *
 * Callers pass the editor child's environment copy, never the Host process
 * environment: a Host-wide deletion breaks Node-mode helpers that inherit it.
 *
 * @param env - environment to clean, in place.
 * @returns true when the name was present.
 */
export declare function dropElectronRunAsNode(env: NodeJS.ProcessEnv): boolean;
/**
 * The child environment for one editor launch: the Host environment with
 * `ELECTRON_RUN_AS_NODE` removed. The deletion is scoped to this child;
 * editing the Host's own environment would break Node-mode helpers (the
 * Windows Job runner, for one) that legitimately inherit the flag.
 *
 * @param env - source environment; defaults to the current process environment.
 * @returns a fresh environment safe to hand to an Electron editor.
 */
export declare function launchEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/**
 * Launch one detached editor through a `--folder-uri` argument and classify
 * an early failure.
 *
 * Success is decoupled from process lifetime, mirroring the host launcher: a
 * child still running when the watch window closes counts as launched (an
 * existing editor window may keep the process in the foreground), exit code 0
 * inside the window counts as launched, and a nonzero exit, a spawn error or
 * a synchronous spawn throw is a failure.
 *
 * @param command - executable path or PATH name.
 * @param args - argv, never a shell string.
 * @param options - watch window and complete child environment.
 * @param spawnChild - spawn seam, injected for tests.
 * @returns the classified outcome.
 */
export declare function launchDetached(command: string, args: readonly string[], options: LaunchOptions, spawnChild?: typeof spawn): Promise<LaunchOutcome>;
/** The launch seam the handler calls. */
export interface OpenInAppDeps {
    /** Launch one editor URI and report how the attempt ended. */
    launch: (uri: string) => Promise<LaunchOutcome>;
}
/**
 * The route handler: validate one POST body and launch the editor for its WSL
 * workspace. Only a `\\wsl...` UNC path is accepted; the route never launches
 * for a Windows or POSIX path.
 *
 * @param deps - the launch seam.
 * @returns the exact-Fetch handler.
 */
export declare function createOpenInAppHandler(deps: OpenInAppDeps): (request: Request) => Promise<Response>;
/** One exact route's registration shape. */
interface ConnectionRoute {
    readonly path: string;
    readonly methods: readonly string[];
    readonly requestBody: "buffered" | "streaming";
    readonly fetch: (request: Request) => Promise<Response>;
}
/** The connection slice this row registers into. */
interface ConnectionFace {
    /** The exact-Fetch route registry. */
    readonly fetch: {
        /** Register one exact route; the returned disposer withdraws it. */
        register: (route: ConnectionRoute) => () => Promise<void> | void;
    };
}
/** The context slice this row consumes; the seams keep it boot-free in tests. */
interface OpenInAppContext {
    /** Optional cordis-style lookup: how production resolves the connection. */
    get?: (name: string) => unknown;
    /** Wait for a service, then run the callback in its scope. */
    inject?: (deps: readonly string[], callback: (scope: OpenInAppContext) => void) => unknown;
    /** Own one disposer on the calling fiber. */
    effect?: (callback: () => () => void, label?: string) => unknown;
    /** The Host connection whose `/api` channel carries the route. */
    connection?: ConnectionFace;
}
/**
 * Build the launch seam for one row: resolve the editor once, scrub the child
 * environment once, and hand every call to {@link launchDetached}.
 *
 * The factory exists so a test can observe the exact argv, the detachment
 * flags and the child environment the row produces without starting an editor.
 *
 * @param config - this row's config.
 * @param env - source environment; defaults to the current process environment.
 * @param spawnChild - spawn seam, injected for tests.
 * @returns the launch seam {@link createOpenInAppHandler} calls.
 */
export declare function createLauncher(config: OpenInAppConfig, env?: NodeJS.ProcessEnv, spawnChild?: typeof spawn): (uri: string) => Promise<LaunchOutcome>;
/**
 * Mount the row: register the route once the Host connection is available.
 * The route scrubs `ELECTRON_RUN_AS_NODE` from each editor child's environment
 * without touching the Host process environment.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated config.
 */
export declare function apply(ctx: OpenInAppContext, config?: OpenInAppConfig): void;
export {};
