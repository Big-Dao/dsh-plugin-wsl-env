/**
 * Host side of the resident in-distro agent.
 *
 * One {@link WslAgent} instance owns one long-lived `wsl.exe` process per
 * distro. The lifetime rules, in order of importance:
 *
 * 1. **Correctness before speed.** Any agent failure is answered by at most
 *    one rebuild; the requests that were in flight ride the rebuild. A second
 *    failure marks the agent permanently dead and every future call rejects
 *    with {@link AgentUnavailableError} — the executor's cue to fall back to
 *    the one-shot `wsl.exe` path it shipped with, so the worst case of the
 *    agent is "today's behaviour, plus one failed round trip".
 * 2. **The in-distro timeout is the real one.** The EXEC frame carries the
 *    timeout in whole seconds and the agent SIGTERMs the child itself, so a
 *    timed-out command dies where it lives instead of leaving an orphan
 *    behind a dead `wsl.exe`. A host-side watchdog only guards an agent that
 *    stopped answering at all.
 * 3. **Idle agents go away.** `idleMs` after the last exchange the process is
 *    killed; the next call starts a fresh one. WSL VMs are shared, but every
 *    process is a promise someone has to keep.
 *
 * The transport is injectable so the lifecycle and the fallback decision are
 * unit-testable without a distro.
 *
 * @module dsh-plugin-wsl/agent
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AgentUnavailableError, CwdError } from "./agent-errors.js";
import { AGENT_NAME, PROTOCOL_VERSION, encodeExecFrame, encodeKill, encodeSetEnv, parseAgentLine } from "./agent-protocol.js";

/** How long a rebuilt agent has to re-answer the handshake before giving up. */
const HANDSHAKE_TIMEOUT_MS = 15000;

/** Extra time the host watchdog waits past the request's own in-distro timeout. */
const WATCHDOG_GRACE_MS = 13000;

/**
 * @param {object} options - the spawn options.
 * @param {string} options.wslPath - the `wsl.exe` path.
 * @param {string} options.distro - the distro name.
 * @param {string} options.scriptPath - the agent script as a Linux path inside
 *   the distro (a `/mnt/<drive>/...` translation of the package's
 *   `agent/wsl-agent.sh`).
 * @returns {import("node:child_process").ChildProcess} the spawned process.
 */
function spawnDefault({ wslPath, distro, scriptPath }) {
  return spawn(wslPath, ["-d", distro, "--exec", "sh", scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

/**
 * The resident agent for one distro.
 */
export class WslAgent {
  /**
   * @param {object} config - the agent configuration.
   * @param {string} config.distro - the distro this agent serves.
   * @param {string} config.scriptPath - the agent script as a Linux path
   *   inside the distro (see {@link spawnDefault}).
   * @param {string} [config.wslPath] - the `wsl.exe` path.
   * @param {number} [config.idleMs] - idle shutdown delay; 0 disables.
   * @param {(options: {wslPath: string, distro: string, scriptPath: string}) => import("node:child_process").ChildProcess} [config.spawnTransport]
   *   injectable process factory for tests.
   */
  constructor(config) {
    this.distro = config.distro;
    this.scriptPath = config.scriptPath;
    this.wslPath = config.wslPath ?? "wsl.exe";
    this.idleMs = config.idleMs ?? 600000;
    this.configuredSpawn = config.spawnTransport;
    /** @type {import("node:child_process").ChildProcess|null} */
    this.process = null;
    /** @type {"idle"|"starting"|"ready"|"dead"} */
    this.state = "idle";
    /** @type {Promise<void>|null} */
    this.startPromise = null;
    this.nextRequestId = 0;
    /** @type {Map<string, {lines: string[], resolve: Function, reject: Function, watchdog: NodeJS.Timeout|null, signal: AbortSignal|null, onAbort: Function|null}>} */
    this.pending = new Map();
    this.rebuildUsed = false;
    /** @type {NodeJS.Timeout|null} */
    this.idleTimer = null;
    this.lastError = "";
  }

  /**
   * Whether the agent is permanently out — the executor's fallback cue.
   * @returns {boolean}
   */
  get unavailable() {
    return this.state === "dead";
  }

  /** Human-readable reason for the last transition to `dead`, for logging. */
  get unavailableReason() {
    return this.lastError;
  }

  /**
   * Start the process and wait for the handshake. Re-entrant: concurrent
   * callers share the one start.
   * @returns {Promise<void>} resolved once the state is `ready`.
   */
  start() {
    if (this.state === "dead") {
      return Promise.reject(new AgentUnavailableError(this.lastError));
    }
    if (this.state === "ready") return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.state = "starting";
    this.startPromise = new Promise((resolve, reject) => {
      const child = (this.process = (this.configuredSpawn ?? spawnDefault)({
        wslPath: this.wslPath,
        distro: this.distro,
        scriptPath: this.scriptPath,
      }));
      const handshakeTimer = setTimeout(() => {
        this.lastError = `agent handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`;
        child.kill();
      }, HANDSHAKE_TIMEOUT_MS);
      const settleStart = (error) => {
        clearTimeout(handshakeTimer);
        this.startPromise = null;
        if (error) {
          this.state = this.rebuildUsed ? "dead" : "idle";
          if (this.rebuildUsed) this.lastError = this.lastError || String(error);
          reject(error instanceof AgentUnavailableError ? error : new AgentUnavailableError(String(error)));
        } else {
          this.state = "ready";
          resolve();
        }
      };
      child.on("error", (error) => {
        this.lastError = String(error);
        settleStart(error);
      });
      child.on("exit", (code, signalName) => {
        if (this.state === "starting") {
          this.lastError = `agent exited during handshake (code=${code} signal=${signalName ?? "none"})`;
          settleStart(new Error(this.lastError));
        }
        this.handleProcessExit(code, signalName);
      });
      const out = createInterface({ input: child.stdout });
      out.on("line", (line) => this.handleLine(line, settleStart, handshakeTimer));
      child.stderr?.on("data", (chunk) => {
        // Diagnostics only; `wsl.exe` and the shell chatter here on failure.
        this.lastError = String(chunk).trim().slice(0, 2000) || this.lastError;
      });
    });
    return this.startPromise;
  }

  /**
   * One stdout line from the agent. The first must be a matching HELLO.
   * @private
   */
  handleLine(line, settleStart, handshakeTimer) {
    const message = parseAgentLine(line);
    switch (message.type) {
      case "hello": {
        if (message.name !== AGENT_NAME || message.version !== PROTOCOL_VERSION) {
          this.lastError = `agent handshake mismatch: got ${message.name}@${message.version}, want ${AGENT_NAME}@${PROTOCOL_VERSION}`;
          this.process?.kill();
          settleStart(new Error(this.lastError));
          return;
        }
        clearTimeout(handshakeTimer);
        settleStart();
        break;
      }
      case "result": {
        const pending = this.pending.get(message.id);
        if (!pending) break; // answered after its caller gave up — noise
        this.clearPending(pending);
        this.pending.delete(message.id);
        this.rearmIdleTimer();
        pending.resolve({ exitCode: message.exitCode, stdout: message.stdout, stderr: message.stderr });
        break;
      }
      case "agentError": {
        const pending = this.pending.get(message.id);
        if (!pending) break;
        this.clearPending(pending);
        this.pending.delete(message.id);
        this.rearmIdleTimer();
        // A cwd rejection is the command's own failure, not the agent's — it
        // becomes a CwdError so the execution layer can report it exactly like
        // the one-shot path's relay text.
        if (message.reason === "cwd") {
          pending.reject(new CwdError(message.message));
        } else {
          pending.reject(new AgentUnavailableError(`agent rejected request ${message.id} (${message.reason}): ${message.message}`));
        }
        break;
      }
      default:
        // Garbage after the handshake is logged and dropped: a late RES for an
        // abandoned request is expected noise, not a broken pipe.
        break;
    }
  }

  /**
   * The process died. Requests in flight ride exactly one rebuild; a second
   * death is permanent.
   * @private
   */
  handleProcessExit(code, signalName) {
    this.process = null;
    if (this.pending.size === 0) {
      if (this.state !== "dead") this.state = "idle";
      return;
    }
    if (!this.rebuildUsed) {
      this.rebuildUsed = true;
      this.lastError = `agent exited unexpectedly (code=${code} signal=${signalName ?? "none"}); rebuilding once`;
      this.state = "idle";
      this.startPromise = null;
      const carrying = [...this.pending.values()];
      this.pending.clear();
      this.start()
        .then(() => {
          for (const pending of carrying) {
            const id = `r${this.nextRequestId++}`;
            this.pending.set(id, pending);
            this.writeLines(relabelFrame(pending.lines, id));
          }
        })
        .catch((error) => {
          for (const pending of carrying) {
            this.clearPending(pending);
            pending.reject(error);
          }
          this.state = "dead";
        });
      return;
    }
    this.lastError = `agent exited again (code=${code} signal=${signalName ?? "none"}); falling back permanently`;
    this.state = "dead";
    for (const pending of this.pending.values()) {
      this.clearPending(pending);
      pending.reject(new AgentUnavailableError(this.lastError));
    }
    this.pending.clear();
  }

  /**
   * Run one command inside the distro through the agent.
   * @param {object} request - the execution request.
   * @param {string} request.cwd - Linux path to run in.
   * @param {string[]} request.argv - the argv, already bwrap-wrapped when the
   *   caller confines.
   * @param {number} [request.timeoutMs] - in-distro timeout, whole seconds
   *   upward; `<= 0` or omitted means none.
   * @param {Record<string, string>} [request.env] - extra environment for this
   *   request only; values lose trailing newlines (protocol limitation).
   * @param {AbortSignal} [request.signal] - cancels the request (KILL + reject).
   * @returns {Promise<{exitCode: number, stdout: Buffer, stderr: Buffer}>}
   * @throws {AgentUnavailableError} when the agent is out for this process.
   */
  async exec({ cwd, argv, timeoutMs = 0, env, signal }) {
    if (this.state === "dead") {
      throw new AgentUnavailableError(this.lastError);
    }
    await this.start();
    const id = `r${this.nextRequestId++}`;
    const lines = [
      ...(env ? Object.entries(env).map(([key, value]) => encodeSetEnv(key, value)) : []),
      ...encodeExecFrame({ id, cwd, argv, timeoutMs }),
    ];
    return new Promise((resolve, reject) => {
      const pending = { lines, resolve, reject, watchdog: null, signal, onAbort: null };
      this.pending.set(id, pending);
      if (signal) {
        if (signal.aborted) {
          this.pending.delete(id);
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
          return;
        }
        pending.onAbort = () => {
          this.writeLines([encodeKill(id)]);
          this.clearPending(pending);
          this.pending.delete(id);
          reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      if (timeoutMs > 0) {
        // The in-distro timeout does the killing; this only catches an agent
        // that stopped answering even to its own timer.
        pending.watchdog = setTimeout(() => {
          this.lastError = `agent did not answer request ${id} within ${timeoutMs + WATCHDOG_GRACE_MS}ms`;
          this.process?.kill();
        }, timeoutMs + WATCHDOG_GRACE_MS);
      }
      this.writeLines(lines);
      this.rearmIdleTimer();
    });
  }

  /**
   * Liveness probe, also used to warm the agent up.
   * @param {AbortSignal} [signal] - cancels the wait.
   * @returns {Promise<void>} resolved on PONG.
   */
  async ping(signal) {
    if (this.state === "dead") throw new AgentUnavailableError(this.lastError);
    await this.start();
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
    return new Promise((resolve, reject) => {
      const id = `r${this.nextRequestId++}`;
      const lines = encodeExecFrame({ id, cwd: "/", argv: ["true"], timeoutMs: 0 });
      const pending = {
        lines,
        resolve: () => resolve(),
        reject,
        watchdog: setTimeout(() => {
          this.lastError = "agent did not answer ping";
          this.process?.kill();
        }, HANDSHAKE_TIMEOUT_MS),
        signal: null,
        onAbort: null,
      };
      this.pending.set(id, pending);
      this.writeLines(lines);
    });
  }

  /**
   * Shut the agent down: SHUTDOWN first, then kill after a short grace. The
   * agent becomes reusable — a later `exec` starts a fresh process.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const child = this.process;
    if (!child) return;
    this.state = "idle";
    this.process = null;
    this.writeLinesSafe(child, ["SHUTDOWN"]);
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** @private */
  writeLines(lines) {
    const child = this.process;
    if (!child || !child.stdin.writable) return;
    child.stdin.write(`${lines.join("\n")}\n`);
    this.rearmIdleTimer();
  }

  /** @private */
  writeLinesSafe(child, lines) {
    try {
      child.stdin?.write(`${lines.join("\n")}\n`);
    } catch {
      // A dead pipe is what close() is cleaning up after.
    }
  }

  /** @private */
  rearmIdleTimer() {
    if (!this.idleMs) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) void this.close();
    }, this.idleMs);
  }

  /** @private */
  clearPending(pending) {
    if (pending.watchdog) clearTimeout(pending.watchdog);
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
  }
}

/**
 * Rewrite the request id inside a stored frame so a resent request does not
 * collide with ids the new process has already seen. SETENV lines pass
 * through unchanged (they are id-less and idempotent).
 * @param {string[]} lines - the stored frame.
 * @param {string} newId - the new request id.
 * @returns {string[]} the relabelled frame.
 */
export function relabelFrame(lines, newId) {
  return lines.map((line) => {
    const separator = line.indexOf("|");
    if (separator === -1) return line;
    const kind = line.slice(0, separator);
    if (kind !== "EXEC" && kind !== "KILL") return line;
    const rest = line.slice(separator + 1);
    const pipe = rest.indexOf("|");
    const tail = pipe === -1 ? "" : rest.slice(pipe);
    return `${kind}|${newId}${tail}`;
  });
}

export default WslAgent;
