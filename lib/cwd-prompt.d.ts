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
export declare const name = "wsl-cwd-prompt";
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** Whether the runtime-context rewrite runs at all. */
    enabled: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** Whether the runtime-context rewrite runs at all. */
    enabled: z<boolean, boolean, "defined">;
}>>, "plain">;
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
type AssembleListener = (assembly: PromptAssembly, context: unknown, next: AssembleNext) => Promise<PromptAssembly>;
/** The `systemPrompt` slice an injected agent scope exposes. */
interface CwdPromptScope {
    systemPrompt: {
        /** Register one context entry in this scope's layer. */
        context: (entry: {
            name: string;
            order: number;
            required: boolean;
            interpolate: boolean;
            text: (context: AssembleRequestContext) => string;
        }) => unknown;
        /** The order constant the harness assigned to a named context family. */
        getContextOrder?: (family: string) => number | undefined;
    };
}
/** The assembly request context: what a provider's `text` receives. */
interface AssembleRequestContext {
    /** The live agent, when the assembly runs inside one. */
    agent?: {
        session?: {
            header?: {
                cwd?: string | undefined;
            };
        } | undefined;
    } | undefined;
}
/** The slice of a created agent this service inspects and injects into. */
interface CwdPromptAgent {
    /** The session stub, when mounted. */
    session?: {
        header?: {
            cwd?: string | undefined;
        };
    } | undefined;
    /** The agent's own context, when the harness exposes it. */
    ctx?: {
        inject?: (names: string[], install: (scope: CwdPromptScope) => void) => unknown;
        get?: (name: string) => unknown;
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
        debug?: (message: string) => void;
    };
    agents?: {
        list: () => CwdPromptAgent[];
    };
    on: ((event: "agent/created", listener: (payload: unknown) => unknown) => () => boolean) & ((event: "system-prompt/assemble", listener: AssembleListener) => () => boolean);
    get?: (name: string) => unknown;
};
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
export declare function rewriteQuotedUnc(text: string): string;
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
export declare function entryText(agent: AssembleRequestContext["agent"], workingDirectory: WorkingDirectorySlice | undefined): string;
/**
 * Mount the rewrite.
 *
 * @param ctx - the cordis context (the composition root, where the harness's
 *   own prompt services register).
 * @param config - the schema-validated plugin config.
 */
export declare function apply(ctx: CwdPromptContext, config?: CwdPromptConfig): void;
export {};
