/**
 * Contribute the WSL environment's facts to the managed `DSH_*` namespace.
 *
 * `dsh-shell-env` owns `ctx.shellEnv`, the registry that rebuilds the trusted
 * `DSH_*` variables injected into every model shell call. That is DSH's sanctioned
 * channel for telling a model what its shell environment actually is — the shell
 * tool's own description points the model at it ("Managed `$DSH_*` variables
 * expose current harness environment facts").
 *
 * It has one built-in key that looks like it should carry this, and does not:
 *
 *     collect() { const values = { [DSH_HOME_ENV]: this.dshHome, [DSH_SHELL_KEY]: "1" } }
 *
 * `DSH_SHELL` is a marker FLAG (`=1`) meaning "a DSH-managed shell call", not the
 * shell path, and it is in `RESERVED_BASH_ENV_KEYS`, so a contributor may not own
 * it. The supported way to convey the real shell is a `DSH_`-prefixed key of our
 * own, declared with a description and resolved synchronously.
 *
 * Scoping uses the same test as `auto-preset`: the agent's recorded workspace
 * directory. A session whose workspace is inside a distro is exactly a session
 * whose shell calls run in that distro — so a host session sees none of these.
 *
 * This is a TypeScript source built to `lib/shell-env.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/shell-env
 */
import z from "@deepseek-ai/schemastery";
import { uncToPosix } from "./paths.js";
import { defaultDistro, defaultShell, linuxHomePath, listDistros } from "./wsl.js";
import { isDefaultDistro, pinnedDistro } from "./distro-route.js";
import { sharedAgent } from "./agent-shared.js";
import { scanListeningPorts } from "./ports.js";
export const name = "wsl-shell-env";
export const inject = ["shellEnv"];
export const Config = z.object({
    /**
     * Distro these facts describe. Empty/`"auto"` follows each session's
     * workspace; an explicit name pins; `"default"` forces WSL's default.
     */
    distro: z.string().default(""),
    /** How often the listening-port snapshot refreshes, in milliseconds. */
    portsRefreshMs: z.number().default(10 * 1000),
});
/**
 * Contribute the WSL environment's facts to the shell-env registry.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export async function apply(ctx, config = {}) {
    // `resolve` is called synchronously by the registry (`Object.entries` of its
    // result), so a fact that needs `wsl.exe` cannot be fetched there. The
    // default/pinned distro is probed once at mount; every other distro is
    // probed when a session created in it appears, so a machine with several
    // stopped distros does not boot them all at application start.
    const configured = config.distro ?? "";
    const portsRefreshMs = config.portsRefreshMs ?? 10_000;
    const pinned = pinnedDistro(configured);
    let distros;
    if (pinned !== undefined) {
        distros = [pinned];
    }
    else {
        try {
            distros = await listDistros();
        }
        catch {
            distros = [];
        }
        if (distros.length === 0) {
            try {
                distros = [await defaultDistro()];
            }
            catch {
                distros = [];
            }
        }
    }
    const defaultName = distros[0];
    /** The facts one distro can answer; a failed probe leaves its key absent. */
    const facts = new Map();
    const inflight = new Set();
    const ensureFacts = async (distro) => {
        if (facts.has(distro) || inflight.has(distro))
            return;
        inflight.add(distro);
        try {
            const [shell, home] = await Promise.all([
                defaultShell(distro),
                linuxHomePath(distro).catch(() => undefined),
            ]);
            facts.set(distro, { shell, home });
        }
        finally {
            inflight.delete(distro);
        }
    };
    const initial = pinned ?? defaultName;
    if (initial !== undefined)
        await ensureFacts(initial);
    const variables = {
        DSH_WSL_DISTRO: {
            description: "Name of the WSL distro this session's workspace lives in.",
        },
        DSH_WSL_SHELL: {
            description: "Absolute path of the login shell that model shell calls run in inside that distro. Commands are executed by this shell, not by bash.",
        },
        DSH_WSL_HOME: {
            description: "Home directory of the user model shell calls run as inside that distro.",
        },
        DSH_WSL_PORTS: {
            description: `Ports with a listener inside that distro (comma-separated, ascending), as of the last snapshot — refreshed every ${Math.round(portsRefreshMs / 1000)}s, so a dev server started moments ago may not be listed yet. Empty means none were listening at the last successful scan (or no scan has succeeded yet); a failed scan keeps the last successful list.`,
        },
    };
    // The port snapshot refreshes on a timer and is served synchronously: the
    // registry's resolve is sync by contract, so live reads are impossible —
    // the timer bounds staleness instead (see lib/ports.js). A timer starts only
    // for a distro a session actually uses, so multi-distro users do not keep
    // every distro's resident agent warm.
    const ports = new Map();
    const timers = new Map();
    const refreshPorts = async (distro) => {
        try {
            const next = await scanListeningPorts(sharedAgent(distro), 8000);
            if (next === undefined) {
                // A transient agent outage must not read as "no ports": keep the last
                // successful snapshot and leave a debug breadcrumb.
                ctx.logger?.debug?.("wsl-shell-env: port snapshot failed; keeping the last known list");
                return;
            }
            ports.set(distro, next);
        }
        catch {
            // Same posture as a failed scan: keep the last successful list.
        }
    };
    const ensurePorts = (distro) => {
        if (timers.has(distro))
            return;
        void refreshPorts(distro);
        const timer = setInterval(() => void refreshPorts(distro), portsRefreshMs);
        timer.unref?.();
        timers.set(distro, timer);
    };
    const lifecycle = ctx;
    const consider = (agent) => {
        const parsed = uncToPosix(String(agent?.session?.header?.cwd ?? ""));
        if (parsed === undefined)
            return;
        if (pinned !== undefined && parsed.distro.toLowerCase() !== pinned.toLowerCase())
            return;
        if (isDefaultDistro(configured) && defaultName !== undefined && parsed.distro.toLowerCase() !== defaultName.toLowerCase())
            return;
        void ensureFacts(parsed.distro);
        ensurePorts(parsed.distro);
    };
    const off = lifecycle.on?.("agent/created", (payload) => consider(payload?.agent));
    // The live-agent sweep is a convenience, not a dependency: `inject` names
    // only `shellEnv`, so reading `ctx.agents` as a property makes cordis 4
    // throw "cannot get property \"agents\" without inject" and marks the whole
    // component failed. `ctx.get` is the sanctioned read for a service this
    // plugin did not inject, and it answers undefined when no agent loop is
    // composed — the row still activates and resolves facts per shell call.
    const live = ctx.get("agents");
    for (const agent of live?.list?.() ?? [])
        consider(agent);
    const dispose = ctx.shellEnv.register({
        name: "dsh-plugin-wsl-env",
        variables,
        resolve: (execution) => {
            const cwd = execution?.agent?.session?.header?.cwd;
            const parsed = uncToPosix(String(cwd ?? ""));
            if (parsed === undefined)
                return {};
            const named = parsed.distro;
            if (pinned !== undefined && named.toLowerCase() !== pinned.toLowerCase())
                return {};
            if (isDefaultDistro(configured) && defaultName !== undefined && named.toLowerCase() !== defaultName.toLowerCase())
                return {};
            const canonical = [...facts.keys()].find((distro) => distro.toLowerCase() === named.toLowerCase()) ?? named;
            const known = facts.get(canonical);
            ensurePorts(canonical);
            const resolved = {
                DSH_WSL_DISTRO: canonical,
                DSH_WSL_PORTS: (ports.get(canonical) ?? []).join(","),
            };
            if (known?.home !== undefined)
                resolved.DSH_WSL_HOME = known.home;
            if (known?.shell !== undefined)
                resolved.DSH_WSL_SHELL = known.shell;
            return resolved;
        },
    });
    // Disposing matters: a config hot-reload re-runs apply(), and the registry
    // rejects a second contributor claiming the same keys.
    ctx.effect(() => () => {
        off?.();
        for (const timer of timers.values())
            clearInterval(timer);
        timers.clear();
        dispose();
    });
}
