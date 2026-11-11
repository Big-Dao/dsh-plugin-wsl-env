/**
 * Distro-native model context: rewrite the `working-directory:current` entry so
 * a distro session reads its directory as the POSIX path its own commands use,
 * and adapt the host prompt facts that are wrong or unnecessarily Windows-shaped
 * in a WSL session. The adaptations are deliberately narrow and replaceable:
 * a one-sentence shell note, a POSIX-only replacement for `sandbox:policy`, and
 * suppression of the host's `harness:source` value (its `app.asar`/Windows path
 * is not a readable source checkout from the distro). See
 * docs/UPSTREAM-PROMPT-ADAPTERS.md for the upstream issues that remove them.
 *
 * The harness's `working-directory` service prints the session cwd verbatim,
 * which on this deployment is `\\wsl.localhost\<distro>\...` — the coordinate
 * system of the HOST filesystem, and one the model's tools mostly cannot use
 * directly: the shell executor runs inside the distro, where only the POSIX
 * form resolves. The mismatch is invisible to the harness and costs the model
 * a translation step on every path it quotes back, with a wrong-guess failure
 * mode (a UNC path handed to `bash` names nothing).
 *
 * The value reaches the model through TWO renderings, and both must be
 * covered:
 *
 *   1. the system prompt — the entry as `assemble()` resolves it;
 *   2. the per-turn runtime-context snapshot — `refreshContext()` re-resolves
 *      the registry providers DIRECTLY, so a waterfall listener on
 *      `system-prompt/assemble` never sees it.
 *
 * Both read the same scoped-layer table, where the nearest scope wins a name
 * (`ScopedLayers.merge`). So the primary mechanism is a session-scoped
 * registration UNDER THE SAME NAME: the entry's provider asks the harness's
 * `workingDirectory` service for the CURRENT directory (so a mid-session `cd`
 * still shows) and rewrites every WSL UNC spelling in it to its POSIX form.
 * A root-level waterfall listener stays as defense in depth for the prompt
 * path on a session where the inject seam is unavailable; the rewrite is
 * idempotent, so the two mechanisms compose without interaction.
 *
 * Advisory by construction. The seams are structural (the plugin's own types
 * spell the slices; docs/UPSTREAM-SESSION-NOTICE.md already relies on the
 * sibling `systemPrompt.context()` seam): a harness without them, an agent
 * whose context is not exposed, or a non-WSL workspace degrades to the
 * shipped behavior — no rewrite, no failure. The rewrite touches one display
 * string; it must never fail a model step.
 *
 * This is a TypeScript source built to `lib/cwd-prompt.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/cwd-prompt
 */

import z from "@deepseek-ai/schemastery";
import { isPosixAbsolute, isWslUnc, uncToPosix } from "./paths.js";

export const name = "wsl-cwd-prompt";

export const Config = z.object({
  /** Whether the runtime-context rewrite runs at all. */
  enabled: z.boolean().default(true),
});

/** The config schema's validated output. */
interface CwdPromptConfig {
  /** Whether the runtime-context rewrite runs at all. */
  enabled?: boolean;
}

/** One named contribution to the assembled system prompt. */
interface PromptContextEntry {
  /** The registry name; the harness's entry is `working-directory:current`. */
  name?: string;
  /** The literal contribution text, already resolved by its provider. */
  text?: string;
  /** Present and false on entries that skip prompt-variable interpolation. */
  interpolate?: boolean;
}

/** The slice of the assembly the waterfall hands around. */
interface PromptAssembly {
  /** The named contributions, ordered by registry order. */
  contexts?: PromptContextEntry[];
}

/** The waterfall's continuation; resolves to the (possibly rewritten) assembly. */
type AssembleNext = () => Promise<PromptAssembly>;

/** The waterfall listener's signature, as the harness's own services use it. */
type AssembleListener = (
  assembly: PromptAssembly,
  context: unknown,
  next: AssembleNext,
) => Promise<PromptAssembly>;

/** The `systemPrompt` slice an injected agent scope exposes. */
interface CwdPromptScope {
  systemPrompt: {
    /** Register one context entry in this scope's layer. */
    context: (entry: {
      name: string,
      order: number,
      required: boolean,
      interpolate: boolean,
      text: (context: AssembleRequestContext) => string,
    }) => unknown;
    /** Register one system-prompt section in this scope's layer, when the harness has the seam. */
    section?: (entry: {
      name: string,
      order: number,
      interpolate: boolean,
      text: string,
    }) => unknown;
    /** The order constant the harness assigned to a named context family. */
    getContextOrder?: (family: string) => number | undefined;
    /** The order constant the harness assigned to a named system-prompt section family. */
    getSectionOrder?: (family: string) => number | undefined;
  };
}

/** The assembly request context: what a provider's `text` receives. */
interface AssembleRequestContext {
  /** The live agent, when the assembly runs inside one. */
  agent?: { session?: { header?: { cwd?: string | undefined } } | undefined } | undefined;
}

/** The slice of a created agent this service inspects and injects into. */
interface CwdPromptAgent {
  /** The session stub, when mounted. */
  session?: { header?: { cwd?: string | undefined } } | undefined;
  /** The agent's own context, when the harness exposes it. */
  ctx?: {
    inject?: (names: string[], install: (scope: CwdPromptScope) => void) => unknown,
    get?: (name: string) => unknown,
  } | undefined;
}

/**
 * The harness's `working-directory` service, read structurally: only `get`
 * is consumed, and its absence degrades to the session header's cwd.
 */
interface WorkingDirectorySlice {
  get?: (session: unknown) => string | undefined;
}

/**
 * The harness's `sandbox-policy` service, read structurally: only `resolve` is
 * consumed. The plugin uses it as the source of truth for mode and workspace
 * and only changes the WSL presentation (POSIX path, partial enforcement).
 */
interface SandboxPolicySlice {
  resolve?: (request: { session?: unknown }) => {
    mode?: string,
    workspaceRoot?: string,
    additionalWritableRoots?: readonly string[],
  } | undefined;
}

/** The cordis context slice this service consumes. */
type CwdPromptContext = {
  logger?: {
    debug?: (message: string) => void,
  },
  agents?: { list: () => CwdPromptAgent[] },
  on: ((event: "agent/created", listener: (payload: unknown) => unknown) => () => boolean) & ((event: "system-prompt/assemble", listener: AssembleListener) => () => boolean),
  get?: (name: string) => unknown,
};

/**
 * The context entry name the harness's working-directory service registers.
 * Registering the same name in a session scope shadows it for BOTH renderings
 * (`assemble` and `refreshContext` merge scoped layers over the global one).
 */
const ENTRY_NAME = "working-directory:current";

/** The model-facing shell note; the host's bash tool name cannot be changed here. */
const SHELL_SECTION = "wsl:shell";

/** The shell note's literal text; no path, no session-specific value. */
const SHELL_NOTE = "The shell tool may be named `bash`, but commands run in the distro's login shell with `-lc` by default; it is not necessarily bash, and `~/.bashrc` is not read. Check `$DSH_WSL_SHELL` for the exact shell.";

/** The host policy context this plugin replaces with a POSIX-only rendering. */
const POLICY_CONTEXT = "sandbox:policy";

/** The host source context and section this plugin suppresses in a WSL session. */
const SOURCE_CONTEXT = "harness:source";

/** The qualification that keeps a WSL policy line from claiming full isolation. */
const PARTIAL_NOTE = "bwrap enforcement is \"partial\": WSL interop to Windows is outside it.";

/**
 * Rewrite every JSON-string-quoted WSL UNC path in one text to its POSIX form.
 * The harness writes the cwd through `JSON.stringify`, so the backslashes are
 * ESCAPED inside the quotes (`"\\\\wsl.localhost\\..."` as rendered text):
 * match a JSON string, parse its inner content, and only rewrite when the raw
 * value is a WSL UNC share. A path that parses to anything else (a drive
 * path, another share, already-POSIX text) passes through unchanged, so the
 * rewrite is safe to re-run.
 *
 * @param text - the contribution text.
 * @returns the text with WSL UNC paths in distro coordinates.
 */
export function rewriteQuotedUnc(text: string): string {
  return String(text).replace(/"((?:[^"\\]|\\.)*)"/gu, (whole, inner: string) => {
    let raw: string;
    try {
      // The inner content is a complete JSON string body by construction of
      // the match; a body with an invalid escape fails closed to `whole`.
      raw = JSON.parse(`"${inner}"`) as string;
    } catch {
      return whole;
    }
    const parsed = uncToPosix(raw);
    return parsed === undefined ? whole : JSON.stringify(parsed.linuxPath);
  });
}

/**
 * The rewritten entry text for one assembly: ask the harness's service for the
 * CURRENT directory (a mid-session `cd` must show), fall back to the session
 * header's original cwd, and translate only WSL UNC spellings. Everything the
 * regex cannot see passes through untouched, so a host session receives the
 * shipped text byte for byte.
 *
 * @param agent - the agent the assembly runs inside.
 * @param workingDirectory - the harness's service, when resolvable.
 * @returns the entry text.
 */
export function entryText(agent: AssembleRequestContext["agent"], workingDirectory: WorkingDirectorySlice | undefined): string {
  const session = agent?.session;
  let directory: string | undefined;
  try {
    directory = session === undefined ? undefined : workingDirectory?.get?.(session);
  } catch {
    directory = undefined;
  }
  if (directory === undefined || directory.length === 0) directory = session?.header?.cwd ?? "";
  return rewriteQuotedUnc(`Current working directory: ${JSON.stringify(directory)}.`);
}

/**
 * One path in the only spelling a WSL model should see. A WSL UNC becomes its
 * POSIX path; an already-POSIX path passes; every Windows spelling returns
 * undefined, so a caller can omit it rather than leak it.
 *
 * @param value - a path from the host policy service or a session header.
 * @returns the POSIX path, or undefined when no POSIX spelling is available.
 */
export function posixPath(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const parsed = uncToPosix(value);
  if (parsed !== undefined) return parsed.linuxPath;
  return isPosixAbsolute(value) ? value : undefined;
}

/**
 * The POSIX-only replacement for the host's `sandbox:policy` context. It keeps
 * the host's mode and root (resolved through `ctx.sandboxPolicy`) but never
 * prints a UNC or Windows path. The partial qualifier is conditional because
 * the plugin can be configured with the sandbox off or in danger-full-access.
 *
 * @param policy - the host policy resolution, when the service is available.
 * @param cwd - the session's workspace, used when the policy root is not POSIX.
 * @returns the model-facing policy text.
 */
export function policyText(policy: { mode?: string, workspaceRoot?: string, additionalWritableRoots?: readonly string[] } | undefined, cwd: string): string {
  const mode = policy?.mode ?? "unknown";
  const workspace = posixPath(policy?.workspaceRoot) ?? posixPath(cwd);
  const roots = (policy?.additionalWritableRoots ?? [])
    .map((root) => posixPath(root))
    .filter((root): root is string => root !== undefined);
  const parts = [`Current DSH file policy: ${mode}.`];
  if (mode === "danger-full-access") {
    parts.push("No WSL file fence is applied.");
    return parts.join(" ");
  }
  if (workspace !== undefined) parts.push(`WSL workspace: ${JSON.stringify(workspace)}.`);
  if (roots.length > 0) parts.push(`Additional WSL writable roots: ${roots.map((root) => JSON.stringify(root)).join(", ")}.`);
  if (mode === "read-only") {
    parts.push(`When the WSL sandbox is enabled, mutations are refused; ${PARTIAL_NOTE}`);
  } else if (mode === "workspace-write") {
    parts.push(roots.length > 0
      ? `When the WSL sandbox is enabled, mutations are limited to the WSL workspace and the listed roots; ${PARTIAL_NOTE}`
      : `When the WSL sandbox is enabled, mutations are limited to the WSL workspace; ${PARTIAL_NOTE}`);
  } else {
    parts.push(`When the WSL sandbox enforces a mode, ${PARTIAL_NOTE}`);
  }
  return parts.join(" ");
}

/**
 * Mount the rewrite.
 *
 * @param ctx - the cordis context (the composition root, where the harness's
 *   own prompt services register).
 * @param config - the schema-validated plugin config.
 */
export function apply(ctx: CwdPromptContext, config: CwdPromptConfig = {}): void {
  const enabled = config.enabled ?? true;
  if (!enabled) return;
  const debug = (message: string) => ctx.logger?.debug?.(message);

  /**
   * Install the session-scoped shadow entry: same name, so it wins the merge;
   * the provider re-reads the current directory on every rendering. Absent on
   * host workspaces (nothing WSL to rewrite) and on agents whose context the
   * harness does not expose (the shipped entry stands).
   *
   * @param agent - the session that just opened.
   */
  const install = (agent: CwdPromptAgent): void => {
    const cwd = agent.session?.header?.cwd;
    if (cwd === undefined || !isWslUnc(cwd)) return;
    const agentCtx = agent.ctx;
    if (agentCtx === undefined || typeof agentCtx.inject !== "function") return;
    let workingDirectory: WorkingDirectorySlice | undefined;
    let sandboxPolicy: SandboxPolicySlice | undefined;
    try {
      const resolved = agentCtx.get?.("workingDirectory");
      if (resolved !== undefined && resolved !== null) workingDirectory = /** @type {WorkingDirectorySlice} */ (resolved);
    } catch (error) {
      debug(`wsl-cwd-prompt: could not read the workingDirectory service (${(error as Error)?.message ?? error})`);
    }
    try {
      const resolved = agentCtx.get?.("sandboxPolicy");
      if (resolved !== undefined && resolved !== null) sandboxPolicy = /** @type {SandboxPolicySlice} */ (resolved);
    } catch (error) {
      debug(`wsl-cwd-prompt: could not read the sandboxPolicy service (${(error as Error)?.message ?? error})`);
    }
    const resolvePolicy = () => {
      try {
        return sandboxPolicy?.resolve?.({ session: agent.session });
      } catch {
        return undefined;
      }
    };
    try {
      agentCtx.inject(["systemPrompt"], (scope) => {
        const systemPrompt = scope.systemPrompt;
        systemPrompt.context({
          name: ENTRY_NAME,
          order: systemPrompt.getContextOrder?.("WORKING_DIRECTORY") ?? 200,
          required: true,
          interpolate: false,
          text: (context) => entryText(context?.agent, workingDirectory),
        });
        systemPrompt.context({
          name: POLICY_CONTEXT,
          order: systemPrompt.getContextOrder?.("SANDBOX_POLICY") ?? 110,
          required: false,
          interpolate: false,
          text: () => policyText(resolvePolicy(), cwd),
        });
        // The host source value is a Windows/app.asar path in this deployment.
        // An empty scoped contribution removes it from the snapshot; a WSL
        // session has no readable use for the host spelling.
        systemPrompt.context({
          name: SOURCE_CONTEXT,
          order: systemPrompt.getContextOrder?.("HARNESS_SOURCE") ?? 200,
          required: false,
          interpolate: false,
          text: () => "",
        });
        if (typeof systemPrompt.section === "function") {
          systemPrompt.section({
            name: SHELL_SECTION,
            order: systemPrompt.getSectionOrder?.("TOOL_BASH") ?? 1000,
            interpolate: false,
            text: SHELL_NOTE,
          });
          systemPrompt.section({
            name: SOURCE_CONTEXT,
            order: systemPrompt.getSectionOrder?.("HARNESS_SOURCE") ?? 10000,
            interpolate: false,
            text: "",
          });
        }
      });
    } catch (error) {
      debug(`wsl-cwd-prompt: could not install the prompt adapters (${(error as Error)?.message ?? error})`);
    }
  };

  ctx.on("agent/created", (payload) => {
    // Structural payload: the harness emits { agent } on agent/created.
    const agent = (payload as { agent?: CwdPromptAgent | undefined } | undefined)?.agent;
    if (agent !== undefined) install(agent);
  });

  // Mount order is not a guarantee: a session created during startup can finish
  // before this service mounts and miss the event entirely (dsh-headless does
  // exactly that, and wsl-preflight sweeps for the same reason). `agents` is
  // optional, so read it with `ctx.get`: a property read of an undeclared
  // service throws in cordis 4, and the catch below turns that into a silent
  // no-op — exactly the sweep this block exists to perform.
  try {
    const agents = ctx.get?.("agents") as CwdPromptContext["agents"] | undefined;
    for (const agent of agents?.list() ?? []) install(agent);
  } catch (error) {
    debug(`wsl-cwd-prompt: could not sweep already-live agents: ${(error as Error)?.message ?? error}`);
  }

  /**
   * Defense in depth for the PROMPT rendering on sessions where the inject
   * seam is unavailable: rewrite the assembled entry in place, then continue
   * the chain. Never throws; an unexpected shape skips the rewrite.
   *
   * @param assembly - the assembly built so far.
   * @param _context - the assembly context (unused).
   * @param next - the waterfall continuation.
   * @returns the downstream assembly.
   */
  const listener = async (assembly: PromptAssembly, _context: unknown, next: AssembleNext): Promise<PromptAssembly> => {
    try {
      const entry = assembly?.contexts?.find((candidate) => candidate?.name === ENTRY_NAME);
      if (entry !== undefined && typeof entry.text === "string") entry.text = rewriteQuotedUnc(entry.text);
    } catch {
      // Display preference, not correctness: skip the rewrite rather than
      // fail the model step this assembly feeds.
    }
    return next();
  };

  ctx.on("system-prompt/assemble", listener);
}
