/**
 * Distro-native working directory in the model's runtime context: rewrite the
 * `working-directory:current` entry so a distro session reads its directory as
 * the POSIX path its own commands use, not the host UNC spelling.
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
import { isWslUnc, uncToPosix } from "./paths.js";

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
    /** The order constant the harness assigned to a named context family. */
    getContextOrder?: (family: string) => number | undefined;
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
    try {
      const resolved = agentCtx.get?.("workingDirectory");
      if (resolved !== undefined && resolved !== null) workingDirectory = /** @type {WorkingDirectorySlice} */ (resolved);
    } catch (error) {
      debug(`wsl-cwd-prompt: could not read the workingDirectory service (${(error as Error)?.message ?? error})`);
    }
    try {
      agentCtx.inject(["systemPrompt"], (scope) => {
        const order = scope.systemPrompt.getContextOrder?.("WORKING_DIRECTORY") ?? 200;
        scope.systemPrompt.context({
          name: ENTRY_NAME,
          order,
          required: true,
          interpolate: false,
          text: (context) => entryText(context?.agent, workingDirectory),
        });
      });
    } catch (error) {
      debug(`wsl-cwd-prompt: could not install the shadow entry (${(error as Error)?.message ?? error})`);
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
