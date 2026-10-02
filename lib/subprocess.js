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
 * overrides one method: `spawnTerminal`. A `wsl.exe` launch is rewritten into a
 * launch that actually names the distro and the Session workspace's Linux
 * directory; every other request — including every ordinary `spawn()`, which the
 * command path uses for `wsl.exe -lc <command>` — reaches the shipped
 * implementation untouched.
 *
 * The interpreter, the PTY, output handling and process-tree teardown stay the
 * shipped implementation's, so the blast radius of replacing a root service
 * stays at the one thing that was wrong: the directory and distro a terminal
 * starts in.
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
 * @module dsh-plugin-wsl/subprocess
 */

import z from "@deepseek-ai/schemastery";
import { LocalSubprocessRuntime } from "@deepseek-ai/dsh-subprocess-local";
import { isPosixAbsolute, toLinuxPath, uncToPosix, windowsToLinuxMount } from "./paths.js";
import { DEFAULT_WSL_PATH, defaultDistro, wslEnvValue, wslTerminalArgv } from "./wsl.js";
import { terminalRoute } from "./terminal-route.js";

/**
 * Env names a terminal launch keeps for the distro. `TERM` rides along because
 * the PTY consumer sets it for the host process, and WSL imports no name that
 * `WSLENV` does not list.
 */
const SAFE_FORWARD = ["TERM", "NO_COLOR", "PAGER", "GIT_PAGER", "LANG", "LC_ALL"];

/** Namespace of the managed facts; every `DSH_*` name in a terminal request is forwarded. */
const DSH_ENV_PREFIX = "DSH_";

/** The one program a launch of this provider's does not pass through. */
const WSL_PROGRAM = "wsl";

/**
 * Subprocess provider that serves a WSL distro as the composition's terminal
 * execution world.
 *
 * Mount it at the profile root in place of the shipped local provider (the
 * profile patch disables the `subprocess` row and inserts this one). It is a
 * subclass rather than a wrapper, so every method it does not override is
 * literally the shipped implementation.
 */
export class WslSubprocessRuntime extends LocalSubprocessRuntime {
  static Config = z.object({
    /** Distro name; empty means WSL's own default distro. */
    distro: z.string().default(""),
    /** Path to `wsl.exe`; overridable for a non-standard install. */
    wslPath: z.string().default(DEFAULT_WSL_PATH),
    /**
     * A shell to pin inside the distro, as an absolute Linux path. Empty — the
     * default — leaves the choice to `wsl.exe`, which starts the distro user's
     * login shell exactly as an interactive `wsl.exe` does.
     */
    shell: z.string().default(""),
    /**
     * Login-shell semantics for a pinned shell. Ignored when no shell is pinned,
     * because then the login shell is the shell.
     */
    loginShell: z.boolean().default(true),
    /** Fallback directory when a launch names none; accepts any coordinate system. */
    cwd: z.string().default(""),
    /** Windows directory the `wsl.exe` process itself starts in. */
    hostCwd: z.string().volatile(),
    /** Extra env names to forward into the distro through WSLENV. */
    forwardEnv: z.array(z.string()).default([]),
    /**
     * Give a session opened on a WINDOWS folder a host shell instead of the
     * distro's shell started at `/mnt/<drive>/…`. WSL-folder sessions always
     * get the distro shell — that is this provider's purpose. `false` restores
     * the composition-owned terminal for every session.
     */
    hostSessions: z.boolean().default(true),
  });

  constructor(ctx, config) {
    super(ctx);
    this.config = config;
    /** Cached default distro, resolved once from `wsl.exe -l -q`. */
    this.resolvedDistro = config.distro;
  }

  /**
   * The distro a launch uses when the request's directory does not name one,
   * resolving WSL's default on first use.
   * @returns the distro name.
   */
  async distro() {
    if (this.resolvedDistro.length === 0) this.resolvedDistro = await defaultDistro({ wslPath: this.config.wslPath });
    return this.resolvedDistro;
  }

  /** Windows directory the `wsl.exe` process is started from. */
  hostCwd() {
    return this.config.hostCwd.get() ?? process.env.SystemRoot ?? process.cwd();
  }

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
  async terminalTarget(cwd) {
    const text = String(cwd ?? "").trim();
    const named = uncToPosix(text);
    if (named !== undefined) return { distro: named.distro, linuxCwd: named.linuxPath };
    const distro = await this.distro();
    if (isPosixAbsolute(text)) return { distro, linuxCwd: text };
    const mounted = windowsToLinuxMount(text);
    if (mounted !== undefined) return { distro, linuxCwd: mounted };
    return { distro, linuxCwd: toLinuxPath(this.config.cwd, { distro }) };
  }

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
  async spawnTerminal(spec) {
    if (!this.launchesDistro(spec.argv)) return super.spawnTerminal(spec);
    // A session on a Windows folder is a HOST session: it gets the host shell
    // in its own directory, not the distro's shell at `/mnt/<drive>/…`. The
    // wsl.exe argv still names this provider's launch, so the substitution
    // stays inside the override — every other consumer is untouched.
    if (this.config.hostSessions && terminalRoute(spec.cwd) === "host") {
      return super.spawnTerminal({ ...spec, argv: ["powershell.exe", "-NoLogo"] });
    }
    const target = await this.terminalTarget(spec.cwd);
    const argv = wslTerminalArgv({
      wslPath: this.config.wslPath,
      distro: target.distro,
      shellPath: this.config.shell,
      linuxCwd: target.linuxCwd,
      login: this.config.loginShell,
    });
    const forward = new Set([...SAFE_FORWARD, ...this.config.forwardEnv]);
    const imported = Object.keys(spec.env ?? {}).filter(
      (name) => forward.has(name) || name.startsWith(DSH_ENV_PREFIX),
    );
    return super.spawnTerminal({
      ...spec,
      argv,
      // A Windows CreateProcess cannot use a Linux path as its working
      // directory; the Linux directory rides on `--cd` instead.
      cwd: this.hostCwd(),
      env: {
        ...spec.env,
        ...(imported.length > 0 ? { WSLENV: wslEnvValue(imported) } : {}),
      },
    });
  }

  /**
   * Whether a terminal request is a `wsl.exe` launch.
   *
   * A bare `argv[0]` is judged by its own name, so the shipped program name and
   * an operator-pinned absolute path both match.
   *
   * @param argv - the request's program and arguments.
   * @returns true when this provider owns the launch.
   */
  launchesDistro(argv) {
    const program = argv?.[0];
    if (typeof program !== "string" || program.length === 0) return false;
    const base = program.slice(Math.max(program.lastIndexOf("/"), program.lastIndexOf("\\")) + 1);
    return base.toLowerCase().replace(/\.exe$/u, "") === WSL_PROGRAM;
  }
}

export default WslSubprocessRuntime;
