/**
 * Session-start sandbox preflight: surface a missing or broken `bwrap` when a
 * distro session OPENS, not when its first command fails closed.
 *
 * Without this the discovery moment is the model's first command, whose
 * `SANDBOX_UNAVAILABLE` error scrolls past as one tool failure among many; the
 * operator may not read it until several commands have failed the same way.
 * The probe itself is not new — it is the providers' own usability probe, run
 * through the same shared cache (`lib/sandbox-core.js`), so a session-start
 * check costs a real probe only once per process, and the first confined
 * command after it pays nothing. Nothing else changes: the failure semantics
 * stay exactly as fail-closed as before, this service only MOVES THE NEWS.
 *
 * The same probes also run once at plugin load (`startup`, on by default) so an
 * install-plus-restart already carries the verdict in the log — the pinned or
 * WSL-default distro — before the first session opens. A session on that distro
 * repeats only the runtime-context entry; other distros keep the session-open
 * check unchanged.
 *
 * Advisory by construction. A preflight that cannot run (no WSL, a wedged
 * `wsl.exe`) degrades to a log line; it must never fail a session that has not
 * even asked for confinement yet. It also never installs anything: the remedy
 * it prints is the same one the refusals carry, and running an installer under
 * root uninvited would be a posture this plugin explicitly rejects.
 *
 * This is a TypeScript source built to `lib/preflight.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/preflight
 */

import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { isWslUnc } from "./paths.js";
import { defaultDistro, runCapture } from "./wsl.js";
import { distroOfUnc, isDefaultDistro, pinnedDistro } from "./distro-route.js";
import { bwrapFailure, bwrapUsable, missingBwrapRemedy } from "./sandbox-core.js";
import { sessionScopeProblem, sessionScopeProbeScript, sessionScopeSweepScript } from "./session-scope.js";
import { installMessagesLocale } from "./messages.js";

export const name = "wsl-preflight";

export const Config = z.object({
  /**
   * Distro to preflight. Empty/`"auto"` follows the session workspace; an
   * explicit name pins; `"default"` forces WSL's default.
   */
  distro: z.string().default(""),
  /** The `wsl.exe` path the probe spawns; keep in step with the providers' `wslPath`. */
  wslPath: z.string().default("wsl.exe"),
  /** Whether the session-start sandbox preflight runs at all. */
  sandbox: z.boolean().default(true),
  /**
   * Whether the preflight also checks the session-runtime prerequisites
   * (systemd PID 1, the user manager, `systemd-run`, Linger). On by default,
   * matching the shipped `sessionSandbox: true`; turn it off when the profile
   * opts out of the session runtime, or the warning would name a prerequisite
   * that profile does not use.
   */
  sessionSandbox: z.boolean().default(true),
  /**
   * Whether the same checks also run once at plugin load — install + restart —
   * against the pinned or WSL-default distro, so the verdict is in the log
   * before any session opens. Sessions on other distros are still checked at
   * open, and a session announcement for a message the load pass already
   * logged skips the duplicate log line but keeps its runtime-context entry.
   */
  startup: z.boolean().default(true),
});

/** The config schema's validated output. */
interface PreflightConfig {
  /** The distro mode: empty/`auto`, an explicit name, or `default`. */
  distro?: string;
  /** The `wsl.exe` path the probe spawns. */
  wslPath?: string;
  /** Whether the session-start sandbox preflight runs at all. */
  sandbox?: boolean;
  /** Whether the session-runtime prerequisites are preflighted too. */
  sessionSandbox?: boolean;
  /** Whether the checks also run once at plugin load, before any session. */
  startup?: boolean;
}

/** Distros whose stale-scope sweep has already run in this process. */
const sweptDistros = new Set<string>();

/**
 * Stop `dsh-wsl-*.scope` units a crashed app left behind. A scope is stale
 * when its cgroup has no `wsl-agent.sh`; a live agent means another session
 * still owns it. Advisory: a failed spawn re-arms the distro for the next
 * session, and the once-per-distro cache keeps the cost off the normal path.
 *
 * @param wslPath - the `wsl.exe` path.
 * @param distro - the resolved distro.
 */
const sweepStaleScopes = (wslPath: string, distro: string): void => {
  if (sweptDistros.has(distro)) return;
  sweptDistros.add(distro);
  void runCapture([wslPath, "-d", distro, "--exec", "sh", "-c", sessionScopeSweepScript()]).catch(() => {
    sweptDistros.delete(distro);
  });
};

/**
 * The slice of a created agent this service inspects; the harness's agent
 * object is structural here, the same view `auto-preset` uses.
 */
interface PreflightAgent {
  /** The agent's id. */
  id: string;
  /** The session stub, when mounted. */
  session?: { header?: { cwd?: string | undefined } } | undefined;
  /**
   * The agent's own context, when the harness exposes it. Used to publish the
   * advisory into the session's runtime context; absent in the unit tests and
   * on a harness without the `systemPrompt` seam, where the log line stands
   * alone.
   */
  ctx?: {
    inject?: (names: string[], install: (scope: PreflightPromptScope) => void) => unknown,
  } | undefined;
}

/** The slice of a session context that can carry the advisory. */
interface PreflightPromptScope {
  systemPrompt: {
    context: (entry: { name: string, order: number, text: () => string }) => unknown,
  };
}

/**
 * The cordis context extended with the slices this service consumes. `logger`
 * and the agent service belong to the harness, whose declarations are not
 * visible to this plugin, so they are spelled structurally on top of the
 * framework's {@link Context}.
 */
type PreflightContext = Context & {
  logger?: {
    debug?: (message: string) => void,
    warn?: (message: string) => void,
  },
  agents?: { list: () => PreflightAgent[] },
  on: (event: "agent/created", listener: (payload: { agent?: PreflightAgent } | undefined) => void) => () => boolean,
};

/**
 * Mount the preflight service.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export async function apply(ctx: PreflightContext, config: PreflightConfig = {}): Promise<void> {
  // Before the sandbox early return: the advisories' language follows the
  // harness locale even when this profile runs without the preflight's own
  // probes (the shell and fs rows install the same wiring themselves).
  installMessagesLocale(ctx);
  if (!(config.sandbox ?? true)) return;
  const wslPath = config.wslPath ?? "wsl.exe";
  const warn = (message: string) => ctx.logger?.warn?.(message);

  /**
   * Publish one advisory: the log line always, plus — when the harness exposes
   * the agent's `systemPrompt` — a session-scoped runtime-context entry, so the
   * warning is visible to the session instead of only in the app log. DSH
   * 0.2.1 has no toast/notice seam; docs/UPSTREAM-SESSION-NOTICE.md records the
   * ask, and the runtime context is the available visible channel today.
   *
   * @param agent - the session that just opened.
   * @param message - the advisory, remedy included.
   * @param level - `warn` for a blocked environment (the historical shape); `info` for the ready line, which is confirmation, not a complaint.
   */
  const announce = (agent: PreflightAgent, message: string, level: "warn" | "info" = "warn"): void => {
    announceLog(message, level);
    const agentCtx = agent.ctx;
    if (agentCtx === undefined || typeof agentCtx.inject !== "function") return;
    try {
      agentCtx.inject(["systemPrompt"], (scope) => {
        scope.systemPrompt.context({ name: "wsl-preflight", order: 200, text: () => message });
      });
    } catch (error) {
      ctx.logger?.debug?.(`wsl-preflight: could not publish the notice to the session (${(error as Error)?.message ?? error})`);
    }
  };

  /** Messages the load pass already logged; a session announcement repeats only the entry. */
  const startupLogged = new Set<string>();

  /**
   * The log-only half of {@link announce}: a blocked environment warns, a ready
   * verdict debugs. A message the startup pass already logged is skipped so the
   * first session on that distro does not repeat the same line.
   *
   * @param message - the advisory or ready line.
   * @param level - `warn` for a blocked environment; `info` for the ready line.
   */
  const announceLog = (message: string, level: "warn" | "info"): void => {
    if (startupLogged.has(message)) return;
    if (level === "info") {
      ctx.logger?.debug?.(message);
    } else {
      warn(message);
    }
  };

  /**
   * Ask the distro's session-runtime probe. Only a recognized refusal is a
   * verdict: an empty or unfamiliar answer means "cannot tell" (a fixture, an
   * old image, a wedged shell) and stays at debug level — the preflight is
   * advisory and must not invent a prerequisite from silence.
   *
   * @param distro - the resolved distro.
   * @returns the remedy, or undefined when the session runtime is usable or unknown.
   */
  const probeSession = async (distro: string): Promise<string | undefined> => {
    try {
      const output = await runCapture([wslPath, "-d", distro, "--exec", "sh", "-c", sessionScopeProbeScript()]);
      const word = output.trim().split(/\r?\n/u)[0]?.trim() ?? "";
      if (!["no-systemd", "no-user-manager", "no-systemd-run", "no-linger"].includes(word)) return undefined;
      return sessionScopeProblem({ output: { stdout: word }, distro }) ?? undefined;
    } catch (error) {
      ctx.logger?.debug?.(`wsl-preflight: the session probe could not run (${(error as Error)?.message ?? error})`);
      return undefined;
    }
  };

  /**
   * Probe one distro and compose its verdict: the same shape the session-open
   * check announces and the load pass logs. Concurrent callers share one flight
   * (the mount-time load pass and a session opening during startup), so both
   * read one verdict and the dedupe below lands exactly one log line; the entry
   * is dropped once settled so later sessions re-probe fresh.
   *
   * @param distro - the resolved distro.
   * @returns the message and its level.
   */
  const inflight = new Map<string, Promise<{ message: string, level: "warn" | "info" }>>();
  const verdictOf = (distro: string): Promise<{ message: string, level: "warn" | "info" }> => {
    const shared = inflight.get(distro);
    if (shared !== undefined) return shared;
    const flight = (async (): Promise<{ message: string, level: "warn" | "info" }> => {
    const usable = await bwrapUsable({ wslPath, distro });
    if (!usable) {
      return { message: `wsl-preflight: ${bwrapFailure(wslPath, distro) ?? missingBwrapRemedy(distro)}`, level: "warn" };
    }
    if (!(config.sessionSandbox ?? true)) {
      return { message: `wsl-preflight: ready — bwrap is usable inside "${distro}" (the session scope is not checked: sessionSandbox: false)`, level: "info" };
    }
    const sessionProblem = await probeSession(distro);
    if (sessionProblem !== undefined) {
      return { message: `wsl-preflight: ${sessionProblem}`, level: "warn" };
    }
    return { message: `wsl-preflight: ready — bwrap and the session scope are usable inside "${distro}"`, level: "info" };
    })();
    inflight.set(distro, flight);
    void flight.finally(() => { if (inflight.get(distro) === flight) inflight.delete(distro); });
    return flight;
  };

  /**
   * Probe the distro once and surface an unusable `bwrap` as a warning.
   *
   * @param agent - the session that just opened, for the workspace scope.
   */
  const check = async (agent: PreflightAgent | undefined): Promise<void> => {
    // Only a distro workspace has commands that confine: a host session would
    // warn about a sandbox it never uses.
    const cwd = agent?.session?.header?.cwd;
    if (agent === undefined || cwd === undefined || !isWslUnc(cwd)) return;
    const pinned = pinnedDistro(config.distro);
    let distro = pinned ?? "";
    if (distro.length === 0) {
      if (!isDefaultDistro(config.distro)) {
        distro = distroOfUnc(cwd) ?? "";
      }
      if (distro.length === 0) {
        try {
          distro = await defaultDistro({ wslPath });
        } catch (error) {
          // No WSL at all is the missing-wsl probe's territory; the first
          // command's own error is the precise one. Stay quiet at warn level.
          ctx.logger?.debug?.(`wsl-preflight: no default distro to preflight (${(error as Error)?.message ?? error})`);
          return;
        }
      }
    }
    // bwrapUsable answers false on a failed probe — it never rejects — so
    // nothing here can throw except a broken context, which is the caller's
    // bug, not the session's.
    // Clean up what a hard crash left behind before this session creates its
    // runtime; a live agent in another session's cgroup makes its scope safe.
    sweepStaleScopes(wslPath, distro);
    const { message, level } = await verdictOf(distro);
    announce(agent, message, level);
  };

  /**
   * The load pass: run the same probes once at mount — install + restart,
   * before any session — against the pinned or WSL-default distro, and log the
   * verdict. A session announcement for the same message then skips the
   * duplicate log line but keeps its runtime-context entry. Advisory like every
   * other arm: an unreachable distro degrades to a debug line.
   */
  const startupCheck = async (): Promise<void> => {
    let distro = "";
    try {
      distro = pinnedDistro(config.distro) ?? await defaultDistro({ wslPath });
    } catch (error) {
      ctx.logger?.debug?.(`wsl-preflight: no distro to preflight at load (${(error as Error)?.message ?? error})`);
      return;
    }
    try {
      sweepStaleScopes(wslPath, distro);
      const { message, level } = await verdictOf(distro);
      // Mark first, log second: a session opening during the load pass reads
      // the same flight and either order leaves exactly one log line.
      startupLogged.add(message);
      if (level === "info") {
        ctx.logger?.debug?.(message);
      } else {
        warn(message);
      }
    } catch (error) {
      ctx.logger?.debug?.(`wsl-preflight: the load pass could not run (${(error as Error)?.message ?? error})`);
    }
  };

  ctx.on("agent/created", (payload) => void check(payload?.agent));
  if (config.startup ?? true) void startupCheck();

  // Mount order is not a guarantee: a session created during startup can finish
  // before this service mounts and miss the event entirely (dsh-headless does
  // exactly that, and auto-preset sweeps for the same reason).
  //
  // `agents` is optional (this row injects nothing), so read it with `ctx.get`:
  // a property read of an undeclared service throws in cordis 4, and the catch
  // below would turn that into a silent no-op — exactly the sweep this block
  // exists to perform.
  try {
    const agents = ctx.get("agents") as PreflightContext["agents"];
    for (const agent of agents?.list() ?? []) void check(agent);
  } catch (error) {
    ctx.logger?.debug?.(`wsl-preflight: could not sweep already-live agents: ${(error as Error)?.message ?? error}`);
  }
}
