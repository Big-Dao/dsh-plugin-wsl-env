/**
 * Auto-preset: bind an agent to the WSL preset when its workspace directory
 * lives inside a distro.
 *
 * Why an event hook and not configuration: the environment is chosen in
 * `dsh-api-session-controller`'s `composeAgent(presetId)`, whose signature has no
 * working directory — the cwd only exists one frame up in
 * `ensureSession(sessionId, cwd, ...)`. So the path-aware decision has to be made
 * where the path IS available. `agent/created` carries it:
 *
 *     ctx.serial(carrier, "agent/created", { agent, source, signal })
 *
 * and `agent.session.header.cwd` is the session's workspace directory.
 *
 * Two details are load-bearing, both established by experiment:
 *
 *  1. **Respect an explicit choice.** By the time the event fires, the resolved
 *     preset is already mounted (`composeAgent` mounts request-or-default in
 *     `setup`). We cannot tell which of the two it was — so we only ever rewrite
 *     when the mounted preset equals the registry default, which means the client
 *     omitted it. An operator's pick is never overridden.
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
 * @module dsh-plugin-wsl/auto-preset
 */
import { appendFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";
import { isWslUnc } from "./paths.js";
import { shouldAdoptWslPreset } from "./preset-choice.js";
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
function trace(message) {
    if (TRACE === void 0 || TRACE === "")
        return;
    try {
        appendFileSync(TRACE, `${new Date().toISOString()} ${message}\n`);
    }
    catch {
        /* a trace is never worth failing a session over */
    }
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
});
/**
 * Mount the auto-preset plugin.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export async function apply(ctx, config = {}) {
    const target = config.preset ?? "wsl";
    const attempts = config.attempts ?? 6;
    const retryMs = config.retryMs ?? 150;
    const warn = (message) => {
        trace(`WARN ${message}`);
        // `logger` is not injectable here, so an unavailable or throwing logger must
        // not turn this into a silent no-op: fall back to stderr.
        let logged = false;
        try {
            ctx.logger?.warn?.(`auto-preset: ${message}`);
            logged = ctx.logger !== void 0;
        }
        catch {
            logged = false;
        }
        if (!logged) {
            try {
                process.stderr.write(`auto-preset: ${message}\n`);
            }
            catch {
                /* logging is never worth failing a session over */
            }
        }
    };
    const consider = (agent) => {
        if (agent === void 0)
            return;
        let cwd;
        let current;
        try {
            cwd = agent.session?.header?.cwd;
            current = ctx.agentPresets.composedPreset(agent.ctx);
        }
        catch (error) {
            warn(`cannot inspect the new agent: ${error?.message ?? error}`);
            return;
        }
        trace(`consider agent=${agent.id} cwd=${JSON.stringify(cwd)} current=${String(current)}`);
        // Only a workspace inside a distro, and only when the preset is still the
        // registry default (i.e. the operator did not ask for one). `undefined` means
        // the creating caller mounted nothing at all — the headless runner does this
        // — which is likewise "no explicit choice".
        let fallback;
        try {
            fallback = ctx.agentPresets.defaultId;
        }
        catch {
            fallback = void 0;
        }
        if (!shouldAdoptWslPreset({ cwd, current, fallback }))
            return;
        trace(`  -> acting: fallback=${String(fallback)} isWsl=${isWslUnc(cwd)}`);
        // Deferred on purpose — see the module comment.
        void (async () => {
            for (let attempt = 1; attempt <= attempts; attempt += 1) {
                try {
                    const chosen = await ctx.agentPresets.select(agent, target);
                    ctx.logger?.debug?.(`auto-preset: "${cwd}" -> preset "${chosen}"`);
                    return;
                }
                catch (error) {
                    const code = error?.code;
                    // The session already started a turn: its preset is fixed, and that is
                    // a legitimate outcome (the operator drove it before we got here).
                    if (code === "agent-preset/locked") {
                        warn(`"${cwd}" already began its first turn; leaving the preset as "${String(current)}"`);
                        return;
                    }
                    if (code === "agent-preset/not-found") {
                        warn(`preset "${target}" is not composed in this profile; skipping "${cwd}"`);
                        return;
                    }
                    if (attempt === attempts) {
                        warn(`could not bind preset "${target}" for "${cwd}": ${code ?? error?.name}: ${error?.message}`);
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
    // resolves the preset in `composeAgent(presetId)`, which has no cwd, but it
    // calls `agents.ensureSession(sessionId, cwd, …, presetId)` — and that frame
    // holds both. Filling the preset there makes the very first mount already
    // correct, so the host sandbox never meets the distro path at all.
    ctx.inject(["sessionController"], (controllerCtx) => {
        const facade = controllerCtx.sessionController?.agents;
        if (facade === void 0 || typeof facade.ensureSession !== "function") {
            warn("sessionController exposes no agents.ensureSession(); the creation-time preset fix is inactive");
            return;
        }
        const original = facade.ensureSession;
        facade.ensureSession = async function (sessionId, cwd, checkPersistedIdentity, presetId) {
            // An explicit choice always wins, and only a distro workspace is affected.
            if (presetId !== void 0 || cwd === undefined || !isWslUnc(cwd)) {
                return original.call(this, sessionId, cwd, checkPersistedIdentity, presetId);
            }
            try {
                return await original.call(this, sessionId, cwd, checkPersistedIdentity, target);
            }
            catch (error) {
                // A session already stored under another preset rejects a different one.
                // Fall back rather than turn adoption into a new failure mode.
                if (!String(error?.message ?? "").includes("agent preset"))
                    throw error;
                trace(`creation-time preset "${target}" refused for ${sessionId}; falling back to the recorded one`);
                return original.call(this, sessionId, cwd, checkPersistedIdentity, presetId);
            }
        };
        trace("creation-time preset fix installed");
        controllerCtx.effect(() => () => {
            facade.ensureSession = original;
        });
    });
    // Mount order is not a guarantee: a runner that creates its session during
    // startup can finish before this plugin mounts and miss the event entirely
    // (dsh-headless does exactly that). Sweep the agents already live so the
    // decision never depends on who mounted first.
    try {
        for (const agent of ctx.agents.list())
            consider(agent);
    }
    catch (error) {
        warn(`could not sweep already-live agents: ${error?.message ?? error}`);
    }
}
