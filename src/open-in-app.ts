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
import { existsSync } from "node:fs";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { uncToPosix } from "./paths.js";

/** The composition row's plugin name. */
export const name = "wsl-open-in-app";

/** The authenticated route the session-header menu posts to. */
export const OPEN_IN_APP_PATH = "/api/wsl-env/open-in-app";

export const Config = z.object({
  /**
   * Editor executable to launch. Empty resolves VS Code from its usual
   * Windows install locations, then falls back to `Code.exe` on PATH.
   */
  executable: z.string().default(""),
  /** Early-failure watch window per launch, in milliseconds. */
  watchMs: z.natural().min(1).default(1_500),
});

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
 * @returns the editor URI, or undefined when the path is not WSL UNC or
 *   cannot be encoded (a path with malformed UTF-16 is not a workspace).
 */
export function editorUri(uncPath: string): string | undefined {
  const target = uncToPosix(uncPath);
  if (target === undefined) return undefined;
  try {
    const encodedPath = target.linuxPath
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const path = encodedPath.startsWith("/") ? encodedPath : `/${encodedPath}`;
    return `vscode-remote://wsl%2B${encodeURIComponent(target.distro)}${path}`;
  } catch {
    // `encodeURIComponent` throws URIError on a lone surrogate. The route must
    // answer a classified 400, not reject the request, for such a body.
    return undefined;
  }
}

/**
 * The editor executables this machine is likely to carry, in preference order.
 *
 * @param env - environment carrying the Windows install roots.
 * @returns absolute candidate paths; empty when no root is named.
 */
export function editorCandidates(env: Environment): string[] {
  const candidates: string[] = [];
  const local = env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles;
  const programFilesX86 = env["ProgramFiles(x86)"];
  if (local !== undefined && local.length > 0) {
    candidates.push(join(local, "Programs", "Microsoft VS Code", "Code.exe"));
    candidates.push(join(local, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"));
    candidates.push(join(local, "Programs", "cursor", "Cursor.exe"));
  }
  if (programFiles !== undefined && programFiles.length > 0) {
    candidates.push(join(programFiles, "Microsoft VS Code", "Code.exe"));
  }
  if (programFilesX86 !== undefined && programFilesX86.length > 0) {
    candidates.push(join(programFilesX86, "Microsoft VS Code", "Code.exe"));
  }
  return candidates;
}

/**
 * Resolve the editor executable: an explicit config value wins; otherwise the
 * first existing install candidate; otherwise the PATH name `Code.exe`.
 *
 * @param config - this row's config.
 * @param env - environment carrying the install roots.
 * @param exists - existence check, injected for tests.
 * @returns the command to spawn.
 */
export function resolveEditor(
  config: OpenInAppConfig,
  env: Environment,
  exists: (path: string) => boolean = existsSync,
): string {
  const configured = (config.executable ?? "").trim();
  if (configured.length > 0) return configured;
  for (const candidate of editorCandidates(env)) {
    if (exists(candidate)) return candidate;
  }
  return "Code.exe";
}

/**
 * Remove `ELECTRON_RUN_AS_NODE` from an environment object, in place.
 *
 * Callers pass the editor child's environment copy, never the Host process
 * environment: a Host-wide deletion breaks Node-mode helpers that inherit it.
 *
 * @param env - environment to clean, in place.
 * @returns true when the name was present.
 */
export function dropElectronRunAsNode(env: NodeJS.ProcessEnv): boolean {
  if (env.ELECTRON_RUN_AS_NODE === undefined) return false;
  delete env.ELECTRON_RUN_AS_NODE;
  return true;
}

/**
 * The child environment for one editor launch: the Host environment with
 * `ELECTRON_RUN_AS_NODE` removed. The deletion is scoped to this child;
 * editing the Host's own environment would break Node-mode helpers (the
 * Windows Job runner, for one) that legitimately inherit the flag.
 *
 * @param env - source environment; defaults to the current process environment.
 * @returns a fresh environment safe to hand to an Electron editor.
 */
export function launchEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env };
  dropElectronRunAsNode(copy);
  return copy;
}

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
export function launchDetached(
  command: string,
  args: readonly string[],
  options: LaunchOptions,
  spawnChild: typeof spawn = spawn,
): Promise<LaunchOutcome> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnChild(command, [...args], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
        env: options.env,
      });
    } catch {
      resolve("failed");
      return;
    }
    let settled = false;
    const settle = (outcome: LaunchOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(watch);
      child.unref();
      resolve(outcome);
    };
    const watch = setTimeout(() => { settle("launched"); }, options.watchMs);
    child.once("error", (error: NodeJS.ErrnoException) => {
      settle(error.code === "ENOENT" ? "missing" : "failed");
    });
    child.once("exit", (code) => { settle(code === 0 ? "launched" : "failed"); });
  });
}

/** The launch seam the handler calls. */
export interface OpenInAppDeps {
  /** Launch one editor URI and report how the attempt ended. */
  launch: (uri: string) => Promise<LaunchOutcome>;
}

/** JSON response with no-store caching. */
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * The route handler: validate one POST body and launch the editor for its WSL
 * workspace. Only a `\\wsl...` UNC path is accepted; the route never launches
 * for a Windows or POSIX path.
 *
 * @param deps - the launch seam.
 * @returns the exact-Fetch handler.
 */
export function createOpenInAppHandler(deps: OpenInAppDeps): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "只支持 POST" }, 405);
    const essence = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (essence !== "application/json") return json({ error: "content-type 必须是 application/json" }, 415);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "请求体不是合法 JSON" }, 400);
    }
    if (typeof body !== "object" || body === null) return json({ error: "请求体必须是对象" }, 400);
    const path = (body as { path?: unknown }).path;
    if (typeof path !== "string") return json({ error: "path 必须是字符串" }, 400);
    const uri = editorUri(path);
    if (uri === undefined) return json({ error: "不是 WSL 工作区路径" }, 400);
    let outcome: LaunchOutcome;
    try {
      outcome = await deps.launch(uri);
    } catch {
      // The launcher is a seam: a rejected promise must become a classified
      // failure, not an unhandled rejection inside the route.
      return json({ error: "VS Code 启动失败" }, 502);
    }
    if (outcome === "launched") return json({ ok: true, uri });
    return json({
      error: outcome === "missing"
        ? "找不到 VS Code；可在 wsl-open-in-app 行配置 executable"
        : "VS Code 启动失败",
    }, 502);
  };
}

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
export function createLauncher(
  config: OpenInAppConfig,
  env: NodeJS.ProcessEnv = process.env,
  spawnChild: typeof spawn = spawn,
): (uri: string) => Promise<LaunchOutcome> {
  const childEnvironment = launchEnvironment(env);
  const executable = resolveEditor(config, childEnvironment);
  const watchMs = config.watchMs ?? 1_500;
  return (uri) => launchDetached(
    executable,
    ["--folder-uri", uri],
    { watchMs, env: childEnvironment },
    spawnChild,
  );
}

/**
 * Mount the row: register the route once the Host connection is available.
 * The route scrubs `ELECTRON_RUN_AS_NODE` from each editor child's environment
 * without touching the Host process environment.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated config.
 */
export function apply(ctx: OpenInAppContext, config: OpenInAppConfig = {}): void {
  if (typeof ctx.inject !== "function") return;
  ctx.inject(["connection"], (scope) => {
    const connection = scope.connection ?? (scope.get?.("connection") as ConnectionFace | undefined);
    if (connection === undefined) return;
    const handler = createOpenInAppHandler({ launch: createLauncher(config) });
    const dispose = connection.fetch.register({
      path: OPEN_IN_APP_PATH,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: handler,
    });
    scope.effect?.(() => () => { void dispose(); }, `wsl-open-in-app: ${OPEN_IN_APP_PATH}`);
  });
}
