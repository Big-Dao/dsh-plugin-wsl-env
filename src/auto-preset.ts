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

import { appendFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { distroOfUnc } from "./distro-route.js";
import { installMessagesLocale, t } from "./messages.js";
import { isWslUnc } from "./paths.js";
import { publishAutoPresetSeam } from "./auto-preset-seam.js";
import { isDefaultPresetChoice, isWindowsAccessWorkspace, shouldAdoptWslPreset } from "./preset-choice.js";

/**
 * Set `DSH_WSL_TRACE` to a file path to record every decision this plugin makes.
 *
 * `ctx.logger` is not an injected service here, so a failure inside it would
 * swallow the message — and a silently-swallowed decision is exactly how a real
 * bug in this plugin stayed invisible once already.
 */
const TRACE = process.env.DSH_WSL_TRACE;

/**
 * Append one decision line to the trace file, when tracing is on.
 *
 * @param message - the decision line to append.
 */
function trace(message: string): void {
  if (TRACE === void 0 || TRACE === "") return;
  try {
    appendFileSync(TRACE, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* a trace is never worth failing a session over */
  }
}

/**
 * Read the registry's default preset id, tolerating a service without one.
 *
 * @param ctx - the plugin context.
 * @returns the default id, or undefined when the registry cannot name one.
 */
function defaultPresetId(ctx: AutoPresetContext): string | undefined {
  try {
    return ctx.agentPresets.defaultId;
  } catch {
    return undefined;
  }
}

/**
 * Whether a create failure is the preset registry refusing the target — the
 * one error class adoption may fall back on. A failed adoption must not turn
 * into a failed session creation; anything else still propagates.
 *
 * @param error - the rejection from the host's create call.
 * @returns true when the caller may retry with the recorded preset.
 */
function isPresetAdoptionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code.startsWith("agent-preset/")) return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("agent preset");
}

export const name = "auto-preset";

export const inject = ["agents", "agentPresets"];

export const Config = z.object({
  /** Preset to bind for a WSL workspace. */
  preset: z.string().default("wsl"),
  /** Attempts before giving up; each waits `retryMs`. */
  attempts: z.natural().min(1).default(6),
  /** Gap between attempts, in milliseconds. */
  retryMs: z.natural().default(150),
  /**
   * Workspace directories the operator opened for Windows access (9p) instead
   * of the distro environment. A session inside one of them keeps the host
   * preset, so the choice made in the sidebar survives later sessions.
   *
   * Volatile: the sidebar's access-mode dialog records the choice through the
   * Settings service, and this row must observe it without a remount.
   */
  windowsWorkspaces: z.array(z.string()).default([]).volatile(),
});

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
  windowsWorkspaces?: readonly string[] | { get: () => readonly string[] };
}

/**
 * Read the Windows-access list at consideration time.
 *
 * A volatile field arrives as a reference whose `get()` returns the value the
 * current configuration resolves to; reading it per decision is what makes an
 * edit in the sidebar apply to the next session instead of the next boot.
 *
 * @param value - the configured field, plain or volatile.
 * @returns the current list, or an empty list when the field is unset.
 */
function windowsAccessList(value: AutoPresetConfig["windowsWorkspaces"]): readonly string[] {
  if (value === undefined) return [];
  if (typeof (value as { get?: unknown }).get === "function") {
    try {
      const current = (value as { get: () => readonly string[] }).get();
      return Array.isArray(current) ? current : [];
    } catch {
      // A volatile read is config, not session state: a throwing field must not
      // fail a session creation or an adoption decision. An unreadable record
      // means "no recorded Windows-access directory".
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
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
      cwd?: string | undefined,
      /** A subagent session inherits its parent's environment; it gets no advisory of its own. */
      origin?: string | undefined,
      parentSession?: string | undefined,
    } | undefined,
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
  agents: { list: () => CreatedAgentView[] },
  agentPresets: {
    composedPreset: (ctx: Context) => string | undefined,
    defaultId: string | undefined,
    select: (agent: CreatedAgentView, presetId: string) => Promise<string>,
  },
  on: (event: "agent/created", listener: (payload: { agent?: CreatedAgentView } | undefined) => void) => () => boolean,
  sessionController?: { agents?: SessionAgentFacade },
};

/**
 * Mount the auto-preset plugin.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export async function apply(ctx: AutoPresetContext, config: AutoPresetConfig = {}): Promise<void> {
  const target = config.preset ?? "wsl";
  const attempts = config.attempts ?? 6;
  const retryMs = config.retryMs ?? 150;
  // The advisory below is model-facing text; follow the app's language like the
  // other rows do (a profile without `settings` keeps English).
  installMessagesLocale(ctx);
  const warn = (message: string) => {
    trace(`WARN ${message}`);
    // `logger` is not injectable here, so an unavailable or throwing logger must
    // not turn this into a silent no-op: fall back to stderr.
    let logged = false;
    try {
      ctx.logger?.warn?.(`auto-preset: ${message}`);
      logged = ctx.logger !== void 0;
    } catch {
      logged = false;
    }
    if (!logged) {
      try {
        process.stderr.write(`auto-preset: ${message}\n`);
      } catch {
        /* logging is never worth failing a session over */
      }
    }
  };

  /**
   * Say, once, that a distro workspace is running the host environment.
   *
   * The model gets a runtime-context entry because otherwise it believes its
   * commands run in the distro (they run in Windows PowerShell, and file access
   * crosses the 9p share). The operator gets the log line; the web client's
   * banner is the human-facing half of the same fact. Nothing here can fail a
   * session: the whole plugin is advisory at this point.
   *
   * @param agent - the session that just opened.
   * @param cwd - its workspace, a `\\wsl.localhost\…` path.
   * @param message - the already-localized advisory.
   */
  const advised = new Set<string>();
  const adviseHostMode = (agent: CreatedAgentView, cwd: string, message: string): void => {
    if (advised.has(agent.id) || !isWslUnc(cwd)) return;
    // A subagent inherits the environment its parent was told about; repeating
    // the advisory in every child context is noise, not information.
    const header = agent.session?.header;
    if (header?.origin === "subagent" || header?.parentSession !== undefined) return;
    advised.add(agent.id);
    warn(`"${cwd}" runs the host (Windows) environment: commands use PowerShell and file access crosses the 9p share`);
    // The harness's agent context carries `systemPrompt`; the service is not in
    // this plugin's typings, so the injection is spelled structurally. A host
    // payload without a context still gets the log line, not a crash.
    const context = agent.ctx as unknown as {
      inject?: (names: string[], install: (scope: {
        systemPrompt: { context: (entry: { name: string, order: number, text: () => string }) => unknown },
      }) => void) => unknown,
    } | undefined;
    const inject = context?.inject;
    if (typeof inject !== "function" || context === undefined) return;
    try {
      inject.call(context, ["systemPrompt"], (scope) => {
        scope.systemPrompt.context({ name: "wsl-access-mode", order: 200, text: () => message });
      });
    } catch (error) {
      // A missing seam degrades to the log line above, never to a failed session.
      trace(`  -> could not publish the host-mode advisory: ${(error as Error)?.message ?? error}`);
    }
  };

  const consider = (agent: CreatedAgentView | undefined) => {
    if (agent === void 0) return;

    let cwd;
    let current;
    try {
      cwd = agent.session?.header?.cwd;
      current = ctx.agentPresets.composedPreset(agent.ctx);
    } catch (error) {
      warn(`cannot inspect the new agent: ${(error as Error)?.message ?? error}`);
      return;
    }
    trace(`consider agent=${agent.id} cwd=${JSON.stringify(cwd)} current=${String(current)}`);

    // Only a workspace inside a distro, and only when the preset is still the
    // registry default (i.e. the operator did not ask for one). `undefined` means
    // the creating caller mounted nothing at all — the headless runner does this
    // — which is likewise "no explicit choice".
    const fallback = defaultPresetId(ctx);
    const windowsAccess = windowsAccessList(config.windowsWorkspaces);
    if (!shouldAdoptWslPreset({ cwd, current, fallback, windowsAccess })) {
      if (cwd !== undefined && isWindowsAccessWorkspace(cwd, windowsAccess)) {
        trace(`  -> skipped: Windows-access workspace ${JSON.stringify(cwd)}`);
        adviseHostMode(agent, cwd, t("hostModeWindowsAccess", { cwd, distro: distroOfUnc(cwd) ?? "WSL" }));
      }
      return;
    }
    if (cwd === undefined) return;
    const workspace = cwd;
    trace(`  -> acting: fallback=${String(fallback)} isWsl=${isWslUnc(workspace)}`);

    // Deferred on purpose — see the module comment.
    void (async () => {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const chosen = await ctx.agentPresets.select(agent, target);
          ctx.logger?.debug?.(`auto-preset: "${workspace}" -> preset "${chosen}"`);
          return;
        } catch (error) {
          const code = (error as { code?: unknown })?.code;
          // The session already started a turn: its preset is fixed, and that is
          // a legitimate outcome (the operator drove it before we got here).
          if (code === "agent-preset/locked") {
            warn(`"${workspace}" already began its first turn; leaving the preset as "${String(current)}"`);
            adviseHostMode(agent, workspace, t("hostModeLocked", { cwd: workspace, distro: distroOfUnc(workspace) ?? "WSL" }));
            return;
          }
          if (code === "agent-preset/not-found") {
            warn(`preset "${target}" is not composed in this profile; skipping "${workspace}"`);
            adviseHostMode(agent, workspace, t("hostModePresetUnavailable", { cwd: workspace, distro: distroOfUnc(workspace) ?? "WSL" }));
            return;
          }
          if (attempt === attempts) {
            warn(`could not bind preset "${target}" for "${workspace}": ${code ?? (error as Error)?.name}: ${(error as Error)?.message}`);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, retryMs));
        }
      }
    })();
  };

  ctx.on("agent/created", (payload) => consider(payload?.agent));

  // ── Make the INITIAL preset correct, instead of correcting it afterwards ────
  //
  // A WSL workspace mounted on the HOST preset puts the Windows ACL sandbox in
  // front of a `\\wsl.localhost` path, which cannot carry security descriptors:
  // the shell tool then dies in sandbox preparation (`GetNamedSecurityInfoW
  // failed (Win32 1)`) and the workspace is unusable — not merely mis-labelled.
  // Correcting the preset after creation loses whenever the first turn does not
  // wait, so the choice is made where the cwd still exists: the controller
  // resolves the preset in `composeAgent(presetId)`, which has no cwd, but its
  // caller `createSession({ cwd, agentPreset, … })` holds both. Filling the
  // preset there makes the very first mount already correct, so the host sandbox
  // never meets the distro path at all.
  //
  // The host renamed this frame: 0.2.0-rc.2 exposed
  // `ensureSession(sessionId, cwd, …, presetId)`; 0.2.1 replaced it with the
  // request object below. Wrapping the request keeps any field a newer host adds
  // intact, and a missing method is reported through the warning and the
  // doctor's `session.preset-seam` check instead of failing silently.
  ctx.inject(["sessionController"], (controllerCtx) => {
    const facade = (controllerCtx as AutoPresetContext).sessionController?.agents;
    if (facade === void 0 || typeof facade.createSession !== "function") {
      publishAutoPresetSeam("inactive", "the host's sessionController exposes no agents.createSession()");
      warn("sessionController exposes no agents.createSession(); the creation-time preset fix is inactive");
      return;
    }
    const original = facade.createSession;
    facade.createSession = async function (this: unknown, request: SessionCreateRequestLike) {
      // A non-default preset id always wins; the default id (or no id) is
      // automatic. Only a distro workspace is affected. A workspace the operator
      // opened for Windows access keeps the host preset even here: this is the
      // frame that makes the first mount correct, so skipping it is what the
      // choice means.
      const candidate = request as unknown as { cwd?: unknown, agentPreset?: unknown, sessionId?: unknown } | null;
      if (candidate === null || typeof candidate !== "object" || typeof candidate.cwd !== "string") {
        return original.call(this, request);
      }
      const requested = typeof candidate.agentPreset === "string" ? candidate.agentPreset : undefined;
      const fallback = defaultPresetId(ctx);
      if (!isDefaultPresetChoice(requested, fallback) || !isWslUnc(candidate.cwd)
        || isWindowsAccessWorkspace(candidate.cwd, windowsAccessList(config.windowsWorkspaces))) {
        return original.call(this, request);
      }
      try {
        return await original.call(this, { ...request, agentPreset: target });
      } catch (error) {
        // A session already stored under another preset, or a profile without
        // the WSL preset, must not turn adoption into a failed creation: retry
        // with the caller's own choice and let the event path report the state.
        if (!isPresetAdoptionError(error)) throw error;
        const named = typeof candidate.sessionId === "string" ? candidate.sessionId : "(new session)";
        trace(`creation-time preset "${target}" refused for ${named}; falling back to the recorded one`);
        return original.call(this, request);
      }
    };
    publishAutoPresetSeam("active", "agents.createSession is wrapped; distro sessions mount the WSL preset first", "createSession");
    trace("creation-time preset fix installed");
    controllerCtx.effect(() => () => {
      facade.createSession = original;
      publishAutoPresetSeam("inactive", "the auto-preset row was disposed");
    });
  });
  // Mount order is not a guarantee: a runner that creates its session during
  // startup can finish before this plugin mounts and miss the event entirely
  // (dsh-headless does exactly that). Sweep the agents already live so the
  // decision never depends on who mounted first.
  try {
    for (const agent of ctx.agents.list()) consider(agent);
  } catch (error) {
    warn(`could not sweep already-live agents: ${(error as Error)?.message ?? error}`);
  }
}
