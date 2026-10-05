/**
 * Host side of the resident in-distro agent.
 *
 * One {@link WslAgent} instance owns one long-lived `wsl.exe` process per
 * distro. The lifetime rules, in order of importance:
 *
 * 1. **Correctness before speed.** Any agent failure is answered by at most
 *    one rebuild; the requests that were in flight ride it ONLY when their
 *    first execution provably changed nothing (the read-only FS ops). A
 *    command or a write that was in flight has UNKNOWN state — replaying it
 *    would run non-idempotent work twice or report a create that actually
 *    succeeded as a refusal — so it fails instead, and the caller re-reads
 *    before retrying. A second failure marks the agent permanently dead and
 *    every future call rejects with {@link AgentUnavailableError} — the
 *    executor's cue to fall back to the one-shot `wsl.exe` path it shipped
 *    with, so the worst case of the agent is "today's behaviour, plus one
 *    failed round trip".
 * 2. **The in-distro timeout is the real one.** The EXEC frame carries the
 *    timeout in whole seconds and the agent SIGTERMs the child itself, so a
 *    timed-out command dies where it lives instead of leaving an orphan
 *    behind a dead `wsl.exe`. The host-side watchdog is armed on the agent's
 *    `ACK` — the dequeue signal — so it measures EXECUTION, never the queue
 *    wait: a short-budget request queued behind a long one can no longer
 *    kill the shared transport for a stall that was never its own. It still
 *    catches an agent that accepted a request and then stopped answering at
 *    all.
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
import { AgentUnavailableError, CwdError } from "./agent-errors.js";
import { AGENT_NAME, MAX_FRAME_BYTES, PROTOCOL_VERSION, encodeExecFrame, encodeFsFrame, encodeKill, encodeSetEnv, parseAgentLine } from "./agent-protocol.js";

/**
 * One settled command result, as `exec` resolves it.
 *
 * @typedef {object} ExecResult
 * @property {number} exitCode - the command's exit status.
 * @property {Buffer} stdout - captured stdout.
 * @property {Buffer} stderr - captured stderr.
 * @property {{stdout: boolean, stderr: boolean}} truncated - which streams the
 *   capture cap cut.
 */

/**
 * One request in flight on an agent: its frame, its settlement callbacks, and
 * the ACK-armed watchdog.
 *
 * @typedef {object} PendingRequest
 * @property {string} id - the request id, as the agent echoes it.
 * @property {string[]} lines - the frame lines (kept so a rebuild can re-send).
 * @property {(result: ExecResult) => void} resolve - settles a RES.
 * @property {(error: Error) => void} reject - settles a failure.
 * @property {NodeJS.Timeout|null} watchdog - the ACK-armed watchdog timer.
 * @property {AbortSignal|null} signal - the caller's cancellation, when any.
 * @property {(() => void)|null} onAbort - the abort listener, for removal.
 * @property {(() => void)|null} armWatchdog - arms `watchdog`; null when the
 *   request carries no timeout.
 */

/**
 * The parsed protocol messages `parseAgentLine` returns — the union lives with
 * the protocol module now (`src/agent-protocol.ts`, built to the `.d.ts` this
 * import resolves), so no consumer restates it.
 *
 * @typedef {import("./agent-protocol.js").AgentMessage} AgentMessage
 */

/** How long a rebuilt agent has to re-answer the handshake before giving up. */
const HANDSHAKE_TIMEOUT_MS = 15000;

/** Extra time the host watchdog waits past the request's own in-distro timeout. */
const WATCHDOG_GRACE_MS = 13000;

/** How far past its host's idle shutdown the agent's own lease runs. The
 * lease fires only when the host is gone in every way that matters (a wedged
 * relay that never delivers EOF); the host's close() normally wins the race. */
const LEASE_GRACE_MS = 120000;

/** The Windows essentials `wsl.exe` itself needs to start and report cleanly. */
const WINDOWS_ESSENTIALS = /^(systemroot|systemdrive|windir|path|pathext|comspec|os|computername)$/i;

/** The managed facts prefix whose names (and only theirs) may be forwarded. */
const MANAGED_ENV_PREFIX = "DSH_";

/**
 * The Windows environment the transport starts from, pinned.
 *
 * Spawned bare, `wsl.exe` would inherit this process's whole environment — and
 * the `WSLENV` variable riding along decides which of those names are
 * FORWARDED into the distro, where every model command inherits them. Dev
 * machines routinely route secrets that way (`WSLENV=GITHUB_TOKEN/u` is the
 * documented example), so the resident's env is built from scratch instead:
 * the Windows essentials `wsl.exe` itself needs, the managed `DSH_*` facts,
 * and a `WSLENV` that names only those managed entries — preserving their
 * original forwarding flags. Nothing else on the Windows side can reach a
 * model command.
 *
 * Deliberately NOT here: the executor's `forwardEnv` names. They ride the
 * one-shot path's WSLENV (`spawnSpec` builds it per call); the resident path
 * has never forwarded them, and this pin keeps that posture instead of
 * widening it silently.
 *
 * @param {Record<string, string|undefined>} parent - this process's environment.
 * @returns {Record<string, string>} the pinned environment for `wsl.exe`.
 */
export function pinnedWindowsEnv(parent) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (WINDOWS_ESSENTIALS.test(name) || name.startsWith(MANAGED_ENV_PREFIX)) env[name] = value;
  }
  env.WSLENV = String(parent.WSLENV ?? "")
    .split(":")
    .filter((entry) => entry.startsWith(MANAGED_ENV_PREFIX))
    .join(":");
  // wsl.exe writes its own diagnostics as UTF-16LE without this, and a UTF-16
  // message read as UTF-8 is mojibake — including the `WSL_E_*` codes. Same
  // pin the one-shot path applies to every spawn.
  env.WSL_UTF8 = "1";
  return env;
}

/**
 * @param {object} options - the spawn options.
 * @param {string} options.wslPath - the `wsl.exe` path.
 * @param {string} options.distro - the distro name.
 * @param {string} options.scriptPath - the agent script as a Linux path inside
 *   the distro (a `/mnt/<drive>/...` translation of the package's
 *   `agent/wsl-agent.sh`).
 * @param {number} [options.leaseMs] - the agent's own client lease, forwarded
 *   through the managed `DSH_` namespace so the script can self-terminate
 *   when a wedged relay stops carrying traffic without ever delivering EOF.
 * @returns {import("node:child_process").ChildProcess} the spawned process.
 */
/**
 * The spawn environment for one resident, with the client lease folded in.
 * The pinned environment forwards only the managed `DSH_` namespace, and it
 * forwards exactly the names the parent `WSLENV` lists — so the lease rides
 * both: the value on the variable, the name on `WSLENV`. A non-positive
 * lease leaves the environment as the pin built it (the script treats an
 * unset variable as no lease).
 * @param {Record<string, string>} env - the pinned environment.
 * @param {number} leaseMs - the agent's client lease in ms; 0 disables.
 * @returns {Record<string, string>} the environment to spawn with.
 */
export function agentLeaseEnv(env, leaseMs) {
  if (!(leaseMs > 0)) return env;
  return {
    ...env,
    DSH_AGENT_LEASE_MS: String(leaseMs),
    WSLENV: [env.WSLENV, "DSH_AGENT_LEASE_MS"].filter(Boolean).join(":"),
  };
}

/**
 * The default transport: `wsl.exe -d <distro> --exec [prefix] sh <script>`.
 *
 * @param {object} options - the spawn spec.
 * @param {string} options.wslPath - the `wsl.exe` path.
 * @param {string} options.distro - the distro name.
 * @param {string} options.scriptPath - the agent script as a Linux path inside
 *   the distro.
 * @param {string[]} [options.argvPrefix] - arguments between `--exec` and the
 *   `sh script` pair (the confinement wrapper when confined).
 * @param {number} [options.leaseMs] - the agent's client lease in ms; 0 disables.
 * @returns {import("node:child_process").ChildProcess} the spawned process.
 */
function spawnDefault({ wslPath, distro, scriptPath, argvPrefix = [], leaseMs = 0 }) {
  return spawn(wslPath, ["-d", distro, "--exec", ...argvPrefix, "sh", scriptPath], {
    env: agentLeaseEnv(pinnedWindowsEnv(process.env), leaseMs),
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
 * @param {string} [config.expectedDigest] - the sha256 of the agent script
 *   as this package shipped it; a HELLO whose digest differs is refused the
 *   same way a version mismatch is (the script is read in place, so a stale
 *   or half-synced runtime copy is the failure this catches).
 * @param {string[]} [config.argvPrefix] - arguments inserted between
   *   `wsl.exe --exec` and the `sh script` pair — the confinement wrapper
   *   (`bwrap … --`) a confined agent runs its whole lifetime under, so every
   *   filesystem op it performs is kernel-enforced. Empty for the plain agent.
 * @param {number} [config.frameCapBytes] - hard ceiling in bytes on one stdout
 *   protocol line; defaults to {@link MAX_FRAME_BYTES}.
 * @param {(options: {wslPath: string, distro: string, scriptPath: string, argvPrefix: string[]}) => import("node:child_process").ChildProcess} [config.spawnTransport]
   *   injectable process factory for tests.
   */
  constructor(config) {
    this.distro = config.distro;
    this.scriptPath = config.scriptPath;
    this.wslPath = config.wslPath ?? "wsl.exe";
    this.argvPrefix = config.argvPrefix ?? [];
    this.idleMs = config.idleMs ?? 600000;
    this.expectedDigest = config.expectedDigest;
    /** Hard ceiling on one stdout protocol line; a longer line is a broken or
     * hostile agent, not data to hold — readline used to accumulate it all. */
    this.frameCapBytes = config.frameCapBytes ?? MAX_FRAME_BYTES;
    this.configuredSpawn = config.spawnTransport;
    /** @type {import("node:child_process").ChildProcess|null} */
    this.process = null;
    /** @type {"idle"|"starting"|"ready"|"dead"} */
    this.state = "idle";
    /** @type {Promise<void>|null} */
    this.startPromise = null;
    this.nextRequestId = 0;
    /** @type {Map<string, PendingRequest>} */
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
      // stdio is all-pipe (the spawn options above), so every standard stream
      // exists; the broad ChildProcess type models them as nullable.
      const child = /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */ ((this.process = (this.configuredSpawn ?? spawnDefault)({
        wslPath: this.wslPath,
        distro: this.distro,
        scriptPath: this.scriptPath,
        argvPrefix: this.argvPrefix,
        leaseMs: this.idleMs > 0 ? this.idleMs + LEASE_GRACE_MS : 0,
      })));
      const handshakeTimer = setTimeout(() => {
        this.lastError = `agent handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`;
        child.kill();
      }, HANDSHAKE_TIMEOUT_MS);
      const settleStart = /** @type {(error?: unknown) => void} */ ((error) => {
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
      });
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
      // A bounded line splitter instead of readline: readline accumulates an
      // over-long line whole before anyone can object, which is exactly the
      // unbounded-capture hole. Protocol lines are ASCII by construction
      // (ids, numbers, base64), so chunk-boundary decoding is not a concern.
      let buffered = "";
      child.stdout.on("data", (chunk) => {
        buffered += chunk.toString("utf8");
        for (;;) {
          const newline = buffered.indexOf("\n");
          if (newline === -1) {
            if (buffered.length > this.frameCapBytes) {
              this.lastError = `agent frame of ${buffered.length} bytes exceeded the ${this.frameCapBytes}-byte protocol cap`;
              buffered = "";
              this.process?.kill();
            }
            return;
          }
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (line.length > this.frameCapBytes) {
            this.lastError = `agent frame of ${line.length} bytes exceeded the ${this.frameCapBytes}-byte protocol cap`;
            buffered = "";
            this.process?.kill();
            return;
          }
          this.handleLine(line, settleStart, handshakeTimer);
        }
      });
      child.stderr?.on("data", (chunk) => {
        // Diagnostics only; `wsl.exe` and the shell chatter here on failure.
        this.lastError = String(chunk).trim().slice(0, 2000) || this.lastError;
      });
    });
    return this.startPromise;
  }

  /**
   * One stdout line from the agent. The first must be a matching HELLO.
   * @param {string} line - one protocol line, terminator stripped.
   * @param {(error?: unknown) => void} settleStart - the handshake settler.
   * @param {NodeJS.Timeout} handshakeTimer - the handshake watchdog.
   * @private
   */
  handleLine(line, settleStart, handshakeTimer) {
    const message = /** @type {AgentMessage} */ (parseAgentLine(line));
    switch (message.type) {
      case "hello": {
        if (message.name !== AGENT_NAME || message.version !== PROTOCOL_VERSION) {
          // Settle BEFORE killing: the exit event must not overwrite the real
          // reason with the generic handshake message (the fake transports
          // emit exit synchronously inside kill(); a real wsl.exe races it).
          this.lastError = `agent handshake mismatch: got ${message.name}@${message.version}, want ${AGENT_NAME}@${PROTOCOL_VERSION}`;
          settleStart(new Error(this.lastError));
          this.process?.kill();
          return;
        }
        if (this.expectedDigest !== undefined && message.digest !== this.expectedDigest) {
          // The script is read in place from the distro-visible path — in the
          // deployed layout a /mnt/c mirror — so a digest that differs from
          // the copy this package shipped means the runtime copy is stale,
          // half-synced, or edited. Fail closed with the fix in the message.
          this.lastError = `agent script digest mismatch: the file the distro read at ${this.scriptPath} hashes to ${message.digest || "(nothing)"}, but this package shipped ${this.expectedDigest} — resync the runtime copy (npm run sync:windows) or reinstall the plugin`;
          settleStart(new Error(this.lastError));
          this.process?.kill();
          return;
        }
        clearTimeout(handshakeTimer);
        settleStart();
        break;
      }
      case "ack": {
        // Dequeue signal: start this request's own budget clock NOW. Armed
        // here instead of at submission, a queued request can no longer time
        // out on a queue it never chose to join — and its watchdog can never
        // kill the shared transport for a stall that was never its own.
        const pending = this.pending.get(message.id);
        pending?.armWatchdog?.();
        break;
      }
      case "result": {
        const pending = this.pending.get(message.id);
        if (!pending) break; // answered after its caller gave up — noise
        this.clearPending(pending);
        this.pending.delete(message.id);
        this.rearmIdleTimer();
        pending.resolve({ exitCode: message.exitCode, stdout: message.stdout, stderr: message.stderr, truncated: message.truncated });
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
   * @param {number | null} code - the exit code, null when killed by a signal.
   * @param {NodeJS.Signals | null} signalName - the killing signal, null on a
   *   normal exit.
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
      // Only provably read-only FS requests ride the rebuild: whatever their
      // first execution did, it changed nothing. A command or a write that was
      // in flight has UNKNOWN state — replaying it would run non-idempotent
      // work a second time, or report a guarded create that actually
      // succeeded as a refusal — so it fails with that fact instead. A stale
      // watchdog must not survive either: its closure kills `this.process`,
      // which after the rebuild is the NEW transport.
      /** @type {PendingRequest[]} */
      const relayable = [];
      for (const pending of carrying) {
        if (pending.signal?.aborted) {
          // Already rejected to its caller by the abort listener; do not
          // resurrect it on the rebuilt agent.
          this.clearPending(pending);
          continue;
        }
        if (isReplayableFrame(pending.lines)) {
          if (pending.watchdog) {
            clearTimeout(pending.watchdog);
            pending.watchdog = null;
          }
          relayable.push(pending);
        } else {
          this.clearPending(pending);
          pending.reject(new AgentUnavailableError(
            `agent exited while request ${pending.id} was in flight; its state is unknown — inspect the distro before retrying`,
          ));
        }
      }
      this.start()
        .then(() => {
          for (const pending of relayable) {
            const id = `r${this.nextRequestId++}`;
            pending.id = id;
            this.pending.set(id, pending);
            // The rebuilt transport can itself be gone by now; a frame that
            // cannot be written must fail its caller, not strand the entry.
            if (!this.writeLines(relabelFrame(pending.lines, id))) {
              this.clearPending(pending);
              this.pending.delete(id);
              pending.reject(new AgentUnavailableError(`agent exited before request ${id} could be re-sent; its state is unknown`));
            }
          }
        })
        .catch((error) => {
          for (const pending of relayable) {
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
   * Register one request's pending entry and write its frame: the shared
   * request machinery (abort, submission, the ACK-armed watchdog). The
   * watchdog is deliberately NOT armed here — it starts at the agent's
   * dequeue `ACK`, so time spent queued behind an earlier request never
   * spends this request's budget and never kills the shared transport for a
   * stall that was not its own.
   * @param {object} request - the request to register.
   * @param {string} request.id - the request's id.
   * @param {string[]} request.lines - the frame lines to write.
   * @param {(result: ExecResult) => void} request.resolve - settles a RES.
   * @param {(error: Error) => void} request.reject - settles a failure.
   * @param {number} request.timeoutMs - the in-distro timeout in ms; 0 means none.
   * @param {AbortSignal} [request.signal] - the caller's cancellation.
   * @private
   */
  track({ id, lines, resolve, reject, timeoutMs, signal }) {
    const pending = /** @type {PendingRequest} */ ({
      id,
      lines,
      resolve,
      reject,
      watchdog: null,
      signal: signal ?? null,
      onAbort: null,
      armWatchdog:
        timeoutMs > 0
          ? () => {
              if (pending.watchdog) return;
              // The in-distro timeout does the killing; this only catches an
              // agent that accepted the request and then stopped answering
              // even to its own timer.
              pending.watchdog = setTimeout(() => {
                this.lastError = `agent did not answer request ${pending.id} within ${timeoutMs + WATCHDOG_GRACE_MS}ms of its dispatch`;
                this.process?.kill();
              }, timeoutMs + WATCHDOG_GRACE_MS);
            }
          : null,
    });
    this.pending.set(id, pending);
    if (signal) {
      if (signal.aborted) {
        this.pending.delete(id);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        return;
      }
      pending.onAbort = () => {
        // Address by the entry's CURRENT id: a request relayed across a
        // rebuild was re-registered under a fresh one, and a stale KILL (or a
        // stale map delete) would strand the entry and leave the command
        // running to its own timeout.
        this.writeLines([encodeKill(pending.id)]);
        this.clearPending(pending);
        this.pending.delete(pending.id);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      };
      signal.addEventListener("abort", pending.onAbort, { once: true });
    }
    // A frame that cannot be WRITTEN must fail its caller now. Silently
    // dropping it used to strand the request: nothing would ever answer, the
    // watchdog (armed on an ACK that will not come) had no process to kill,
    // and with no timeout the caller waited forever.
    if (!this.writeLines(lines)) {
      this.clearPending(pending);
      this.pending.delete(pending.id);
      reject(new AgentUnavailableError("the agent exited before the request could be sent; it never ran"));
      return;
    }
    this.rearmIdleTimer();
  }

  /**
   * Run one command inside the distro through the agent.
   * @param {object} request - the execution request.
   * @param {string} request.cwd - Linux path to run in.
   * @param {string[]} request.argv - the argv, already bwrap-wrapped when the
   *   caller confines.
   * @param {number} [request.timeoutMs] - in-distro timeout, whole seconds
   *   upward, measured from the agent's dequeue ACK; `<= 0` or omitted means
   *   none. Queue time ahead of the dispatch is never counted.
   * @param {Record<string, string>} [request.env] - extra environment for this
   *   request only; values lose trailing newlines (protocol limitation).
   * @param {number} [request.maxOutputBytes] - per-stream capture ceiling the
   *   agent enforces (carried on the EXEC frame); the RES line reports which
   *   streams were cut. 0 (the default) keeps the unbounded capture.
   * @param {AbortSignal} [request.signal] - cancels the request (KILL + reject).
   * @returns {Promise<{exitCode: number, stdout: Buffer, stderr: Buffer, truncated: {stdout: boolean, stderr: boolean}}>}
   * @throws {AgentUnavailableError} when the agent is out for this process.
   */
  async exec({ cwd, argv, timeoutMs = 0, maxOutputBytes = 0, env, signal }) {
    if (this.state === "dead") {
      throw new AgentUnavailableError(this.lastError);
    }
    await this.start();
    const id = `r${this.nextRequestId++}`;
    const lines = [
      ...(env ? Object.entries(env).map(([key, value]) => encodeSetEnv(key, value)) : []),
      ...encodeExecFrame({ id, cwd, argv, timeoutMs, maxOutputBytes }),
    ];
    return new Promise((resolve, reject) => {
      this.track({ id, lines, resolve, reject, timeoutMs, signal });
    });
  }

  /**
   * Run one filesystem-substrate op inside the distro through the agent.
   * Responses reuse the EXEC `ACK`/`RES` lines, so cancellation and the
   * watchdog are exactly the command path's. The rebuild relay differs by op:
   * a read-only op rides a rebuild, a `write` in flight fails with an
   * unknown-state error instead of being replayed.
   * @param {object} request - the filesystem request.
   * @param {string} request.op - op name (`stat`, `lstat`, `list`, `realpath`,
   *   `read`, `write`), dispatched by `agent/wsl-agent.sh`.
   * @param {string[]} request.args - op arguments; each rides one base64 line.
   * @param {number} [request.timeoutMs] - in-distro timeout, whole seconds
   *   upward, measured from the agent's dequeue ACK; `<= 0` or omitted means
   *   none.
   * @param {AbortSignal} [request.signal] - cancels the request (KILL + reject).
   * @returns {Promise<{exitCode: number, stdout: Buffer, stderr: Buffer}>}
   * @throws {AgentUnavailableError} when the agent is out for this process.
   */
  async fs({ op, args, timeoutMs = 0, signal }) {
    if (this.state === "dead") {
      throw new AgentUnavailableError(this.lastError);
    }
    await this.start();
    const id = `r${this.nextRequestId++}`;
    const lines = encodeFsFrame({ id, op, args, timeoutMs });
    return new Promise((resolve, reject) => {
      this.track({ id, lines, resolve, reject, timeoutMs, signal });
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
      this.track({ id, lines, resolve: () => resolve(), reject, timeoutMs: HANDSHAKE_TIMEOUT_MS, signal });
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
    await /** @type {Promise<void>} */ (new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    }));
  }

  /**
   * @param {string[]} lines - the frame lines to write.
   * @returns {boolean} whether the frame was written.
   * @private
   */
  writeLines(lines) {
    const child = this.process;
    if (!child || !child.stdin || !child.stdin.writable) return false;
    child.stdin.write(`${lines.join("\n")}\n`);
    this.rearmIdleTimer();
    return true;
  }

  /**
   * @param {import("node:child_process").ChildProcess} child - the process being
   *   shut down.
   * @param {string[]} lines - the lines to write.
   * @private
   */
  writeLinesSafe(child, lines) {
    // The writable check matters beyond politeness: a write to an ENDED stdin
    // does not throw here — it emits an async 'error' event the caller never
    // listens for, which crashes the process during its own shutdown.
    if (!child.stdin || !child.stdin.writable) return;
    try {
      child.stdin.write(`${lines.join("\n")}\n`);
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

  /**
   * @param {PendingRequest} pending - the entry to detach its timer and abort
   *   listener from.
   * @private
   */
  clearPending(pending) {
    if (pending.watchdog) clearTimeout(pending.watchdog);
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
  }
}

/** The read-only FS ops: replaying them across a rebuild changes nothing. */
const REPLAYABLE_FS_OPS = new Set(["stat", "lstat", "list", "realpath", "read"]);

/**
 * Whether a stored request frame's first execution provably had no side
 * effects, so the frame may ride the one permitted rebuild. An EXEC never
 * qualifies — a command's effects are unknowable after the agent died — and
 * neither does an FS `write`. (A SETENV prefix line never decides: the frame
 * header sits at `lines[0]` only for FS frames, which carry no SETENV.)
 * @param {string[]} lines - the stored frame.
 * @returns {boolean}
 */
function isReplayableFrame(lines) {
  const header = lines[0] ?? "";
  if (!header.startsWith("FS|")) return false;
  return REPLAYABLE_FS_OPS.has(header.split("|")[2]);
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
    if (kind !== "EXEC" && kind !== "FS" && kind !== "KILL") return line;
    const rest = line.slice(separator + 1);
    const pipe = rest.indexOf("|");
    const tail = pipe === -1 ? "" : rest.slice(pipe);
    return `${kind}|${newId}${tail}`;
  });
}

export default WslAgent;
