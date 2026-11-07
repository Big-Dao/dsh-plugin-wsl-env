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
export function rewriteQuotedUnc(text) {
    return String(text).replace(/"((?:[^"\\]|\\.)*)"/gu, (whole, inner) => {
        let raw;
        try {
            // The inner content is a complete JSON string body by construction of
            // the match; a body with an invalid escape fails closed to `whole`.
            raw = JSON.parse(`"${inner}"`);
        }
        catch {
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
export function entryText(agent, workingDirectory) {
    const session = agent?.session;
    let directory;
    try {
        directory = session === undefined ? undefined : workingDirectory?.get?.(session);
    }
    catch {
        directory = undefined;
    }
    if (directory === undefined || directory.length === 0)
        directory = session?.header?.cwd ?? "";
    return rewriteQuotedUnc(`Current working directory: ${JSON.stringify(directory)}.`);
}
/**
 * Mount the rewrite.
 *
 * @param ctx - the cordis context (the composition root, where the harness's
 *   own prompt services register).
 * @param config - the schema-validated plugin config.
 */
export function apply(ctx, config = {}) {
    const enabled = config.enabled ?? true;
    if (!enabled)
        return;
    const debug = (message) => ctx.logger?.debug?.(message);
    /**
     * Install the session-scoped shadow entry: same name, so it wins the merge;
     * the provider re-reads the current directory on every rendering. Absent on
     * host workspaces (nothing WSL to rewrite) and on agents whose context the
     * harness does not expose (the shipped entry stands).
     *
     * @param agent - the session that just opened.
     */
    const install = (agent) => {
        const cwd = agent.session?.header?.cwd;
        if (cwd === undefined || !isWslUnc(cwd))
            return;
        const agentCtx = agent.ctx;
        if (agentCtx === undefined || typeof agentCtx.inject !== "function")
            return;
        let workingDirectory;
        try {
            const resolved = agentCtx.get?.("workingDirectory");
            if (resolved !== undefined && resolved !== null)
                workingDirectory = /** @type {WorkingDirectorySlice} */ (resolved);
        }
        catch (error) {
            debug(`wsl-cwd-prompt: could not read the workingDirectory service (${error?.message ?? error})`);
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
        }
        catch (error) {
            debug(`wsl-cwd-prompt: could not install the shadow entry (${error?.message ?? error})`);
        }
    };
    ctx.on("agent/created", (payload) => {
        // Structural payload: the harness emits { agent } on agent/created.
        const agent = payload?.agent;
        if (agent !== undefined)
            install(agent);
    });
    // Mount order is not a guarantee: a session created during startup can finish
    // before this service mounts and miss the event entirely (dsh-headless does
    // exactly that, and wsl-preflight sweeps for the same reason). `agents` is
    // optional, so read it with `ctx.get`: a property read of an undeclared
    // service throws in cordis 4, and the catch below turns that into a silent
    // no-op — exactly the sweep this block exists to perform.
    try {
        const agents = ctx.get?.("agents");
        for (const agent of agents?.list() ?? [])
            install(agent);
    }
    catch (error) {
        debug(`wsl-cwd-prompt: could not sweep already-live agents: ${error?.message ?? error}`);
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
    const listener = async (assembly, _context, next) => {
        try {
            const entry = assembly?.contexts?.find((candidate) => candidate?.name === ENTRY_NAME);
            if (entry !== undefined && typeof entry.text === "string")
                entry.text = rewriteQuotedUnc(entry.text);
        }
        catch {
            // Display preference, not correctness: skip the rewrite rather than
            // fail the model step this assembly feeds.
        }
        return next();
    };
    ctx.on("system-prompt/assemble", listener);
}
