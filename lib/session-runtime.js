/**
 * The session-scoped runtime registry (ADR 0001).
 *
 * One long-lived agent per `(distro, workspaceRoot, policy)`, shared by the
 * providers that need it and refcounted: the first `acquire` spawns the agent
 * inside a systemd user scope, the last `release` closes the agent and stops
 * the scope (the cgroup then reaps any background dev server a command left
 * behind). The agent runs with no idle close — its lifetime is the session's —
 * but an explicit client lease still catches a wedged host.
 *
 * The confinement here is the agent's own bwrap mount profile, WITHOUT a PID
 * namespace: commands are the agent's children, so a background process
 * survives the command, `/tmp` is the distro's real `/tmp` under
 * `workspace-write`, and `ps` sees the session. `danger-full-access` gets the
 * scope but no mounts.
 *
 * Nothing in this module touches `wsl.exe` by default except through the
 * injectable factories; `test/session-runtime.test.mjs` drives the refcount,
 * the prefix composition and the stop ordering without systemd.
 *
 * This is a TypeScript source built to `lib/session-runtime.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/session-runtime
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { WslAgent, pinnedWindowsEnv } from "./agent.js";
import { agentScriptDigest, agentScriptPath } from "./agent-shared.js";
import { bwrapArgvPrefix } from "./bwrap.js";
import { toLinuxPath } from "./paths.js";
import { sessionScopePrefix, sessionScopeStopArgv, sessionScopeUnit } from "./session-scope.js";
/** The default agent factory: the same script/digest the shared resident pins. */
const spawnSessionAgent = (options) => new WslAgent({
    distro: options.distro,
    wslPath: options.wslPath,
    scriptPath: toLinuxPath(agentScriptPath),
    expectedDigest: agentScriptDigest,
    argvPrefix: options.argvPrefix,
    idleMs: options.idleMs,
    leaseMs: options.leaseMs,
});
/** The default stop: a second `wsl.exe` asks the user manager to stop the unit. */
const stopSessionScope = ({ wslPath, distro, unit }) => {
    const argv = sessionScopeStopArgv({ wslPath, distro, unit });
    const child = spawn(argv[0] ?? wslPath, argv.slice(1), {
        stdio: "ignore",
        windowsHide: true,
        env: pinnedWindowsEnv(process.env),
    });
    // The scope may already be gone (the agent's exit, a restart). The stop is
    // best effort; a stale unit is visible to `systemctl --user list-units`.
    child.on("error", () => { });
};
/** The default token: short, unique, and sanitized by {@link sessionScopeUnit}. */
const defaultToken = () => randomUUID().replace(/-/gu, "").slice(0, 12);
/**
 * The refcounted registry. One instance lives for the process; providers share
 * it so the shell and filesystem sides address the same runtime for a session.
 */
export class SessionRuntimes {
    /** The live runtimes, by key. */
    runtimes = new Map();
    /** The agent factory. */
    spawnAgent;
    /** The scope stopper. */
    stopScope;
    /** The unit-token generator. */
    token;
    /**
     * @param options - the injectable edges; production passes none.
     */
    constructor(options = {}) {
        this.spawnAgent = options.spawnAgent ?? spawnSessionAgent;
        this.stopScope = options.stopScope ?? stopSessionScope;
        this.token = options.token ?? defaultToken;
    }
    /**
     * The key a request addresses: distro, workspace, mode and mask. A policy
     * change is a different runtime, because the mount profile is fixed for the
     * agent's lifetime.
     *
     * @param request - the runtime request.
     * @returns the registry key.
     */
    static key(request) {
        return [request.distro, request.workspaceRoot, request.mode, request.maskWindowsDrive === true ? "masked" : "visible"].join("\u0000");
    }
    /**
     * Acquire the runtime for one key, creating it on first use.
     *
     * @param request - the runtime request.
     * @returns the live entry; the caller holds one reference.
     */
    acquire(request) {
        const key = SessionRuntimes.key(request);
        const existing = this.runtimes.get(key);
        if (existing !== undefined) {
            existing.refs += 1;
            return existing;
        }
        const wslPath = request.wslPath ?? "wsl.exe";
        const unit = sessionScopeUnit(request.distro, this.token());
        const prefix = sessionScopePrefix(unit);
        if (request.mode !== "danger-full-access") {
            prefix.push(...bwrapArgvPrefix({ mode: request.mode, workspaceRoot: toLinuxPath(request.workspaceRoot, { distro: request.distro }) }, { maskWindowsDrive: request.maskWindowsDrive, realTmp: true, pidNamespace: false }));
        }
        const agent = this.spawnAgent({
            distro: request.distro,
            wslPath,
            argvPrefix: prefix,
            idleMs: 0,
            leaseMs: request.leaseMs ?? 0,
        });
        const entry = { key, unit, agent, distro: request.distro, wslPath, refs: 1 };
        this.runtimes.set(key, entry);
        return entry;
    }
    /**
     * Release one reference. The last release closes the agent and stops the
     * scope, in that order: the agent's exit ends the protocol, the stop reaps
     * whatever the session left running.
     *
     * @param key - the entry's key.
     * @returns resolved once the last holder's teardown finished.
     */
    async release(key) {
        const entry = this.runtimes.get(key);
        if (entry === undefined)
            return;
        entry.refs -= 1;
        if (entry.refs > 0)
            return;
        this.runtimes.delete(key);
        try {
            await entry.agent.close();
        }
        finally {
            this.stopScope({ wslPath: entry.wslPath, distro: entry.distro, unit: entry.unit });
        }
    }
    /**
     * Release every runtime, for a host shutdown or a test. Sequential on
     * purpose: concurrent closes would race the shared agent's state.
     *
     * @returns resolved once every runtime is torn down.
     */
    async disposeAll() {
        for (const key of [...this.runtimes.keys()]) {
            const entry = this.runtimes.get(key);
            if (entry !== undefined)
                entry.refs = 1;
            await this.release(key);
        }
    }
}
/** The process-wide registry the providers will share. */
export const sessionRuntimes = new SessionRuntimes();
