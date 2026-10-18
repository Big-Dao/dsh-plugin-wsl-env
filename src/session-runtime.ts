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
import { sessionScopePrefix, sessionScopeProblem, sessionScopeProbeArgv, sessionScopeStopArgv, sessionScopeUnit } from "./session-scope.js";

/**
 * Run the session runtime's preflight through an injected host runner and map
 * the answer to a refusal. Shared by the shell executor and the filesystem
 * provider, so both gate the runtime on the same four requirements.
 *
 * @param options - the transport, distro and runner.
 * @returns the remedy-bearing refusal, or null when the platform is usable.
 */
export async function probeSessionRuntime({ wslPath, distro, run }: {
  /** The `wsl.exe` path. */
  wslPath: string;
  /** The distro name. */
  distro: string;
  /** The host runner; throws when the probe could not run. */
  run: (argv: string[]) => Promise<string>;
}): Promise<string | null> {
  /** @type {{ stdout: string, error?: string }} */
  let output;
  try {
    output = { stdout: await run(sessionScopeProbeArgv({ wslPath, distro })) };
  } catch (error) {
    output = { stdout: "", error: String(error) };
  }
  return sessionScopeProblem({ output, distro });
}

/** One request for a session runtime. */
export interface SessionRuntimeRequest {
  /** The distro the runtime lives in. */
  distro: string;
  /** The `wsl.exe` path; defaults to `wsl.exe`. */
  wslPath?: string;
  /** The session workspace root, in any coordinate system. */
  workspaceRoot: string;
  /** The resolved file-effect mode (`read-only`, `workspace-write`, `danger-full-access`). */
  mode: string;
  /** Shadow `/mnt` in the runtime's mount profile. */
  maskWindowsDrive?: boolean;
  /** The agent's client lease; 0 disables. */
  leaseMs?: number;
}

/** One live runtime and its refcount. */
export interface SessionRuntimeEntry {
  /** The registry key (`distro`, workspace, mode, mask). */
  key: string;
  /** The systemd user unit name. */
  unit: string;
  /** The resident agent. */
  agent: WslAgent;
  /** The distro, for the stop command. */
  distro: string;
  /** The `wsl.exe` path, for the stop command. */
  wslPath: string;
  /** How many providers hold the runtime. */
  refs: number;
}

/** The injectable edges, so the registry is testable without systemd. */
export interface SessionRuntimeOptions {
  /** Create the agent; tests substitute a fake. */
  spawnAgent?: (options: {
    /** The distro. */
    distro: string;
    /** The `wsl.exe` path. */
    wslPath: string;
    /** The scope + mount prefix. */
    argvPrefix: string[];
    /** No idle close: the runtime lives for the session. */
    idleMs: number;
    /** The explicit client lease. */
    leaseMs: number;
    /** The prefix has no PID namespace, so USR1 can reach the agent. */
    signalable: boolean;
  }) => WslAgent;
  /** Stop the scope; tests record it. */
  stopScope?: (options: { wslPath: string, distro: string, unit: string }) => void;
  /** The unique token in the unit name; tests pin it. */
  token?: () => string;
}

/** The native binary path and HELLO digest per distro, when opted in. */
const NATIVE_AGENTS = new Map<string, { path: string, digest: string }>();

/**
 * Set (or clear) the native binary the session runtime should spawn for one
 * distro. The host calls this after the copy/verify step; an empty path
 * clears it and restores the shell agent.
 *
 * @param distro - the distro.
 * @param path - the Linux binary path, or empty to clear.
 * @param digest - the binary's sha256, which the HELLO must present.
 */
export function setSessionNativeAgent(distro: string, path: string, digest = ""): void {
  if (path.length === 0) NATIVE_AGENTS.delete(distro);
  else NATIVE_AGENTS.set(distro, { path, digest });
}

/** The default agent factory: the same script/digest the shared resident pins. */
const spawnSessionAgent = (options: { distro: string, wslPath: string, argvPrefix: string[], idleMs: number, leaseMs: number, signalable: boolean }): WslAgent => {
  const native = NATIVE_AGENTS.get(options.distro);
  if (native !== undefined) {
    // The native agent reads its own KILL frame while a command runs, so USR1
    // is both unnecessary and fatal (it has no handler); cancellation is the
    // frame path. The HELLO digest binds the process to the copied binary.
    return new WslAgent({
      distro: options.distro,
      wslPath: options.wslPath,
      scriptPath: native.path,
      expectedDigest: native.digest,
      argvPrefix: options.argvPrefix,
      idleMs: options.idleMs,
      leaseMs: options.leaseMs,
      signalable: false,
      spawnTransport: ({ wslPath, distro, argvPrefix }) =>
        spawn(wslPath, ["-d", distro, "--exec", ...argvPrefix, native.path], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: pinnedWindowsEnv(process.env),
        }),
    });
  }
  return new WslAgent({
    distro: options.distro,
    wslPath: options.wslPath,
    scriptPath: toLinuxPath(agentScriptPath),
    expectedDigest: agentScriptDigest,
    argvPrefix: options.argvPrefix,
    idleMs: options.idleMs,
    leaseMs: options.leaseMs,
    signalable: options.signalable,
  });
};

/** The default stop: a second `wsl.exe` asks the user manager to stop the unit. */
const stopSessionScope = ({ wslPath, distro, unit }: { wslPath: string, distro: string, unit: string }): void => {
  const argv = sessionScopeStopArgv({ wslPath, distro, unit });
  const child = spawn(argv[0] ?? wslPath, argv.slice(1), {
    stdio: "ignore",
    windowsHide: true,
    env: pinnedWindowsEnv(process.env),
  });
  // The scope may already be gone (the agent's exit, a restart). The stop is
  // best effort; a stale unit is visible to `systemctl --user list-units`.
  child.on("error", () => {});
};

/** The default token: short, unique, and sanitized by {@link sessionScopeUnit}. */
const defaultToken = (): string => randomUUID().replace(/-/gu, "").slice(0, 12);

/**
 * The refcounted registry. One instance lives for the process; providers share
 * it so the shell and filesystem sides address the same runtime for a session.
 */
export class SessionRuntimes {
  /** The live runtimes, by key. */
  private readonly runtimes = new Map<string, SessionRuntimeEntry>();
  /** The agent factory. */
  private readonly spawnAgent: NonNullable<SessionRuntimeOptions["spawnAgent"]>;
  /** The scope stopper. */
  private readonly stopScope: NonNullable<SessionRuntimeOptions["stopScope"]>;
  /** The unit-token generator. */
  private readonly token: () => string;

  /**
   * @param options - the injectable edges; production passes none.
   */
  constructor(options: SessionRuntimeOptions = {}) {
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
  static key(request: Pick<SessionRuntimeRequest, "distro" | "workspaceRoot" | "mode" | "maskWindowsDrive">): string {
    return [request.distro, request.workspaceRoot, request.mode, request.maskWindowsDrive === true ? "masked" : "visible"].join("\u0000");
  }

  /**
   * Acquire the runtime for one key, creating it on first use.
   *
   * @param request - the runtime request.
   * @returns the live entry; the caller holds one reference.
   */
  acquire(request: SessionRuntimeRequest): SessionRuntimeEntry {
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
      prefix.push(...bwrapArgvPrefix(
        { mode: request.mode, workspaceRoot: toLinuxPath(request.workspaceRoot, { distro: request.distro }) },
        { maskWindowsDrive: request.maskWindowsDrive, realTmp: true, pidNamespace: false },
      ));
    }
    const agent = this.spawnAgent({
      distro: request.distro,
      wslPath,
      argvPrefix: prefix,
      idleMs: 0,
      leaseMs: request.leaseMs ?? 0,
      signalable: true,
    });
    const entry: SessionRuntimeEntry = { key, unit, agent, distro: request.distro, wslPath, refs: 1 };
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
  async release(key: string): Promise<void> {
    const entry = this.runtimes.get(key);
    if (entry === undefined) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.runtimes.delete(key);
    try {
      await entry.agent.close();
    } finally {
      this.stopScope({ wslPath: entry.wslPath, distro: entry.distro, unit: entry.unit });
    }
  }

  /**
   * Release every runtime, for a host shutdown or a test. Sequential on
   * purpose: concurrent closes would race the shared agent's state.
   *
   * @returns resolved once every runtime is torn down.
   */
  async disposeAll(): Promise<void> {
    for (const key of [...this.runtimes.keys()]) {
      const entry = this.runtimes.get(key);
      if (entry !== undefined) entry.refs = 1;
      await this.release(key);
    }
  }
}

/** The process-wide registry the providers will share. */
export const sessionRuntimes = new SessionRuntimes();
