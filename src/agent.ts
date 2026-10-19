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
 * This is a TypeScript source built to `lib/agent.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/agent
 */

import { spawn } from "node:child_process";
import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { AgentUnavailableError, BASH_TIMEOUT_REASON, CwdError, SpawnError } from "./agent-errors.js";
import { AGENT_NAME, MAX_FRAME_BYTES, PROTOCOL_VERSION, encodeExecFrame, encodeFsFrame, encodeKill, encodeSetEnv, parseAgentLine } from "./agent-protocol.js";
import type { AgentMessage } from "./agent-protocol.js";

/** One settled command result, as `exec` resolves it. */
export interface ExecResult {
  /** The command's exit status. */
  exitCode: number;
  /** Captured stdout. */
  stdout: Buffer;
  /** Captured stderr. */
  stderr: Buffer;
  /** Which streams the capture cap cut. */
  truncated: { stdout: boolean, stderr: boolean };
}

/**
 * One request in flight on an agent: its frame, its settlement callbacks, and
 * the ACK-armed watchdog.
 */
export interface PendingRequest {
  /** The request id, as the agent echoes it. */
  id: string;
  /** The request's numeric sequence; newer requests have a larger one. */
  seq: number;
  /** Which metric bucket this request belongs to. */
  kind: "fs" | "exec";
  /** When the frame was written, for the queue measurement. */
  sentAt: number;
  /** When the agent ACKed it, for the execution measurement. */
  ackedAt?: number;
  /** Whether the metrics recorded this request's settle. */
  measured: boolean;
  /** The frame lines (kept so a rebuild can re-send). */
  lines: string[];
  /** Settles a RES. */
  resolve: (result: ExecResult) => void;
  /** Settles a failure. */
  reject: (error: Error) => void;
  /** The ACK-armed watchdog timer. */
  watchdog: NodeJS.Timeout | null;
  /** The caller's cancellation, when any. */
  signal: AbortSignal | null;
  /** The abort listener, for removal. */
  onAbort: (() => void) | null;
  /** Arms `watchdog`; null when the request carries no timeout. */
  armWatchdog: (() => void) | null;
  /** Whether the agent has ACKed this request (it is the running one). */
  started: boolean;
  /** The caller cancelled it; the entry stays until the agent answers. */
  cancelled: boolean;
  /** The caller was already settled; a late answer only cleans up. */
  settled: boolean;
  /** Whether the agent has answered (RES or ERR); a late signal is then unsafe. */
  answered: boolean;
  /** The delayed cancel signal, so it can be dropped when the request settles. */
  signalTimer: NodeJS.Timeout | null;
}

/** Per-kind request metrics. */
export interface RequestMetrics {
  /** Requests that settled (successful, failed or cancelled). */
  requests: number;
  /** Total queue wait (sent -> ACK), ms. */
  queueMs: number;
  /** Largest single queue wait, ms. */
  queueMaxMs: number;
  /** Total execution time (ACK -> settle), ms. */
  execMs: number;
  /** Largest single execution time, ms. */
  execMaxMs: number;
  /** Settled with an error (not cancellation). */
  failed: number;
  /** Cancelled by the caller. */
  cancelled: number;
  /** Rejected before tracking: queue full, already aborted, or send failed. */
  rejected: number;
}

/** The agent's cumulative request metrics. */
export interface AgentMetrics {
  /** FS frames. */
  fs: RequestMetrics;
  /** EXEC frames (commands, ping). */
  exec: RequestMetrics;
  /** Peak number of pending requests. */
  inFlightMax: number;
}

/**
 * A zeroed per-kind metrics record.
 * @returns the record.
 */
function emptyRequestMetrics(): RequestMetrics {
  return { requests: 0, queueMs: 0, queueMaxMs: 0, execMs: 0, execMaxMs: 0, failed: 0, cancelled: 0, rejected: 0 };
}

/**
 * A zeroed metrics snapshot.
 * @returns the snapshot.
 */
function emptyAgentMetrics(): AgentMetrics {
  return { fs: emptyRequestMetrics(), exec: emptyRequestMetrics(), inFlightMax: 0 };
}

/** The entry an async preparation may select before the first spawn. */
export interface WslAgentPrepared {
  /** The agent entrypoint (the shell script or the native cache path). */
  scriptPath: string;
  /** The HELLO digest to verify. */
  expectedDigest?: string;
  /** Whether USR1 can reach the agent (false for the native KILL-frame path). */
  signalable?: boolean;
  /** The process factory for this entry. */
  spawnTransport?: (options: { wslPath: string, distro: string, scriptPath: string, argvPrefix: string[], leaseMs: number }) => ChildProcess;
}

/** How long a rebuilt agent has to re-answer the handshake before giving up. */
const HANDSHAKE_TIMEOUT_MS = 15000;

/** Extra time the host watchdog waits past the request's own in-distro timeout. */
const WATCHDOG_GRACE_MS = 13000;
/**
 * How long a cancel waits before the out-of-band USR1. Long enough for the
 * agent's own timeout kill to answer, short enough that a killed command still
 * dies promptly.
 */
const CANCEL_SIGNAL_GRACE_MS = 60;

/**
 * How many requests one resident may hold in flight before refusing more. The
 * agent is serial, so a large queue only delays every entry; the cap keeps a
 * burst from growing the pending map (and the retained frame lines) without
 * bound.
 */
const MAX_PENDING_REQUESTS = 64;

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
 * @param parent - this process's environment.
 * @returns the pinned environment for `wsl.exe`.
 */
export function pinnedWindowsEnv(parent: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
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
 * The spawn environment for one resident, with the client lease folded in.
 * The pinned environment forwards only the managed `DSH_` namespace, and it
 * forwards exactly the names the parent `WSLENV` lists — so the lease rides
 * both: the value on the variable, the name on `WSLENV`. A non-positive
 * lease leaves the environment as the pin built it (the script treats an
 * unset variable as no lease).
 *
 * @param env - the pinned environment.
 * @param leaseMs - the agent's client lease in ms; 0 disables.
 * @returns the environment to spawn with.
 */
export function agentLeaseEnv(env: Record<string, string>, leaseMs: number): Record<string, string> {
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
 * @param options - the spawn spec.
 * @returns the spawned process.
 */
function spawnDefault({ wslPath, distro, scriptPath, argvPrefix = [], leaseMs = 0 }: {
  /** The `wsl.exe` path. */
  wslPath: string,
  /** The distro name. */
  distro: string,
  /** The agent script as a Linux path inside the distro. */
  scriptPath: string,
  /**
   * Arguments between `--exec` and the `sh script` pair (the confinement
   * wrapper when confined).
   */
  argvPrefix?: string[],
  /** The agent's client lease in ms; 0 disables. */
  leaseMs?: number,
}): ChildProcess {
  return spawn(wslPath, ["-d", distro, "--exec", ...argvPrefix, "sh", scriptPath], {
    env: agentLeaseEnv(pinnedWindowsEnv(process.env), leaseMs),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

/** The resident agent for one distro. */
export class WslAgent {
  /** The distro this agent serves. */
  declare distro: string;
  /** The agent script as a Linux path inside the distro (see {@link spawnDefault}). */
  declare scriptPath: string;
  /** The `wsl.exe` path. */
  declare wslPath: string;
  /** Arguments between `wsl.exe --exec` and the `sh script` pair. */
  declare argvPrefix: string[];
  /** Idle shutdown delay; 0 disables. */
  declare idleMs: number;
  /** The sha256 of the agent script as this package shipped it. */
  declare expectedDigest: string | undefined;
  /**
   * Hard ceiling on one stdout protocol line; a longer line is a broken or
   * hostile agent, not data to hold — readline used to accumulate it all.
   */
  declare frameCapBytes: number;
  /** The injectable process factory, when the caller supplied one. */
  declare configuredSpawn: ((options: { wslPath: string, distro: string, scriptPath: string, argvPrefix: string[], leaseMs: number }) => ChildProcess) | undefined;
  /** The explicit lease, when the caller supplied one (independent of idleMs). */
  declare configuredLease: number | undefined;
  /** The injectable signal sender, when the caller supplied one. */
  declare configuredSignal: ((options: { wslPath: string, distro: string, pid: number, signal: NodeJS.Signals }) => void) | undefined;
  /** The agent shell's PID from its HELLO, when a second wsl.exe can address it. */
  declare agentPid: number | undefined;
  /**
   * Whether a second `wsl.exe` can deliver `USR1` to the agent's HELLO pid.
   * True for the plain agent; false for a resident inside a PID namespace. A
   * session runtime has a prefix (scope + mounts) but no PID namespace, so it
   * opts in explicitly.
   */
  declare signalable: boolean;
  /** The maximum requests allowed in flight on this resident. */
  declare maxPending: number;
  /** The live resident process, when any. */
  declare process: ChildProcess | null;
  /** The lifecycle state. */
  declare state: "idle" | "starting" | "ready" | "dead";
  /** The in-flight start, shared by concurrent callers. */
  declare startPromise: Promise<void> | null;
  /** The in-flight start's settler, so close() can fail a start it interrupts. */
  declare startSettler: ((error?: unknown) => void) | null;
  /** The next request id. */
  declare nextRequestId: number;
  /** The requests in flight, keyed by their current id. */
  declare pending: Map<string, PendingRequest>;
  /** The newest request the agent has ACKed; a cancel older than this is stale. */
  declare lastAckedSeq: number;
  /** Whether the one permitted rebuild has been spent. */
  declare rebuildUsed: boolean;
  /** The idle-shutdown timer. */
  declare idleTimer: NodeJS.Timeout | null;
  /** The last failure, for `unavailableReason` and log messages. */
  declare lastError: string;
  /** Cumulative request metrics; see {@link metrics}. */
  declare requestMetrics: AgentMetrics;
  /** The optional async preparation hook. */
  declare prepare: (() => Promise<WslAgentPrepared | undefined>) | undefined;

  /**
   * @param config - the agent configuration.
   */
  constructor(config: {
    /** The distro this agent serves. */
    distro: string,
    /**
     * The agent script as a Linux path inside the distro (see
     * {@link spawnDefault}).
     */
    scriptPath: string,
    /** The `wsl.exe` path. */
    wslPath?: string,
    /** Idle shutdown delay; 0 disables. */
    idleMs?: number,
    /**
     * The client lease in ms, independent of `idleMs`. A session runtime holds
     * the agent for the session's lifetime (no idle close) but still wants the
     * lease's last-resort self-termination; a positive value here overrides the
     * idle-derived lease.
     */
    leaseMs?: number,
    /**
     * The sha256 of the agent script as this package shipped it; a HELLO whose
     * digest differs is refused the same way a version mismatch is (the script
     * is read in place, so a stale or half-synced runtime copy is the failure
     * this catches).
     */
    expectedDigest?: string,
    /**
     * Arguments inserted between `wsl.exe --exec` and the `sh script` pair —
     * the confinement wrapper (`bwrap … --`) a confined agent runs its whole
     * lifetime under, so every filesystem op it performs is kernel-enforced.
     * Empty for the plain agent.
     */
    argvPrefix?: string[],
    /**
     * Whether a second `wsl.exe` can signal the agent's pid. Defaults to
     * "true when the argv prefix is empty": the plain agent shares the distro's
     * PID namespace, a confined resident does not, and a session runtime has a
     * prefix but no PID namespace and must opt in.
     */
    signalable?: boolean,
    /** Hard ceiling in bytes on one stdout protocol line; defaults to {@link MAX_FRAME_BYTES}. */
    frameCapBytes?: number,
    /** Injectable process factory for tests. */
    spawnTransport?: (options: { wslPath: string, distro: string, scriptPath: string, argvPrefix: string[], leaseMs: number }) => ChildProcess,
    /**
     * Injectable out-of-band signal delivery for tests. The real path spawns a
     * second `wsl.exe` to send USR1 to the agent's PID.
     */
    signalTransport?: (options: { wslPath: string, distro: string, pid: number, signal: NodeJS.Signals }) => void,
    /**
     * Maximum requests in flight on one resident; a submission past it is
     * refused instead of growing the request map without bound.
     */
    maxPending?: number,
    /** Optional async preparation selecting the entry before the first spawn. */
    prepare?: () => Promise<WslAgentPrepared | undefined>,
  }) {
    this.distro = config.distro;
    this.scriptPath = config.scriptPath;
    this.wslPath = config.wslPath ?? "wsl.exe";
    this.argvPrefix = config.argvPrefix ?? [];
    this.signalable = config.signalable ?? this.argvPrefix.length === 0;
    this.idleMs = config.idleMs ?? 600000;
    this.expectedDigest = config.expectedDigest;
    this.frameCapBytes = config.frameCapBytes ?? MAX_FRAME_BYTES;
    this.configuredSpawn = config.spawnTransport;
    this.configuredSignal = config.signalTransport;
    this.configuredLease = config.leaseMs;
    this.maxPending = config.maxPending ?? MAX_PENDING_REQUESTS;
    this.agentPid = undefined;
    this.process = null;
    this.state = "idle";
    this.startPromise = null;
    this.startSettler = null;
    this.nextRequestId = 0;
    this.pending = new Map();
    this.lastAckedSeq = 0;
    this.rebuildUsed = false;
    this.idleTimer = null;
    this.lastError = "";
    this.requestMetrics = emptyAgentMetrics();
    this.prepare = config.prepare;
  }

  /**
   * Whether the agent is permanently out — the executor's fallback cue.
   *
   * @returns true once the rebuild budget is spent.
   */
  get unavailable(): boolean {
    return this.state === "dead";
  }

  /** Human-readable reason for the last transition to `dead`, for logging. */
  get unavailableReason(): string {
    return this.lastError;
  }

  /**
   * Start the process and wait for the handshake. Re-entrant: concurrent
   * callers share the one start.
   *
   * @returns resolved once the state is `ready`.
   */
  start(): Promise<void> {
    if (this.state === "dead") {
      return Promise.reject(new AgentUnavailableError(this.lastError));
    }
    if (this.state === "ready") return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    const prepared = this.prepare?.();
    if (prepared === undefined) {
      const started = this.beginStart();
      this.startPromise = started;
      return started;
    }
    const started = prepared.then((entry) => {
      if (entry !== undefined) this.applyPrepared(entry);
      return this.beginStart();
    });
    this.startPromise = started;
    return started;
  }

  /**
   * Apply an async preparation entry to this agent before the first spawn.
   *
   * @param entry - the selected entry.
   */
  private applyPrepared(entry: WslAgentPrepared): void {
    this.scriptPath = entry.scriptPath;
    this.expectedDigest = entry.expectedDigest;
    if (entry.signalable !== undefined) this.signalable = entry.signalable;
    if (entry.spawnTransport !== undefined) this.configuredSpawn = entry.spawnTransport;
  }

  /**
   * Spawn the process and run the handshake.
   *
   * @returns resolved once the state is `ready`.
   */
  private beginStart(): Promise<void> {
    this.state = "starting";
    this.agentPid = undefined;
    return new Promise((resolve, reject) => {
      // stdio is all-pipe (the spawn options above), so every standard stream
      // exists; the broad ChildProcess type models them as nullable.
      const child = (this.process = (this.configuredSpawn ?? spawnDefault)({
        wslPath: this.wslPath,
        distro: this.distro,
        scriptPath: this.scriptPath,
        argvPrefix: this.argvPrefix,
        leaseMs: this.configuredLease ?? (this.idleMs > 0 ? this.idleMs + LEASE_GRACE_MS : 0),
      })) as ChildProcessWithoutNullStreams;
      // One generation, one owner: every closure below belongs to THIS child.
      // A stale child's exit must not settle a newer start, null a newer
      // transport, or answer a newer request.
      const current = () => this.process === child;
      const handshakeTimer = setTimeout(() => {
        if (!current()) return;
        this.lastError = `agent handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`;
        child.kill();
      }, HANDSHAKE_TIMEOUT_MS);
      const settleStart = (error?: unknown) => {
        clearTimeout(handshakeTimer);
        this.startSettler = null;
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
      this.startSettler = settleStart;
      child.on("error", (error) => {
        if (!current()) return;
        this.lastError = String(error);
        settleStart(error);
      });
      // The write side can hit EPIPE after the child exits — a failed
      // handshake followed by close(), or a scope stop. The failure is already
      // reflected in the state/pending requests; an unhandled stream error
      // would crash the host process instead.
      child.stdin?.on("error", () => {});
      child.on("exit", (code, signalName) => {
        if (!current()) {
          // A stale child's exit: release its pipes, but never touch the
          // generation that replaced it.
          this.teardownStreams(child);
          return;
        }
        if (this.state === "starting") {
          this.lastError = `agent exited during handshake (code=${code} signal=${signalName ?? "none"})`;
          settleStart(new Error(this.lastError));
        }
        this.handleProcessExit(child, code, signalName);
      });
      // A bounded line splitter instead of readline: readline accumulates an
      // over-long line whole before anyone can object, which is exactly the
      // unbounded-capture hole. Protocol lines are ASCII by construction
      // (ids, numbers, base64), so chunk-boundary decoding is not a concern.
      let buffered = "";
      child.stdout.on("data", (chunk) => {
        if (!current()) return;
        buffered += chunk.toString("utf8");
        for (;;) {
          const newline = buffered.indexOf("\n");
          if (newline === -1) {
            if (buffered.length > this.frameCapBytes) {
              this.lastError = `agent frame of ${buffered.length} bytes exceeded the ${this.frameCapBytes}-byte protocol cap`;
              buffered = "";
              child.kill();
            }
            return;
          }
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          if (line.length > this.frameCapBytes) {
            this.lastError = `agent frame of ${line.length} bytes exceeded the ${this.frameCapBytes}-byte protocol cap`;
            buffered = "";
            child.kill();
            return;
          }
          this.handleLine(line, settleStart, handshakeTimer);
        }
      });
      child.stderr?.on("data", (chunk) => {
        if (!current()) return;
        // Diagnostics only; `wsl.exe` and the shell chatter here on failure.
        this.lastError = String(chunk).trim().slice(0, 2000) || this.lastError;
      });
    });
  }

  /**
   * One stdout line from the agent. The first must be a matching HELLO.
   *
   * @param line - one protocol line, terminator stripped.
   * @param settleStart - the handshake settler.
   * @param handshakeTimer - the handshake watchdog.
   */
  private handleLine(line: string, settleStart: (error?: unknown) => void, handshakeTimer: NodeJS.Timeout): void {
    const message = parseAgentLine(line) as AgentMessage;
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
          this.lastError = `agent digest mismatch: the file the distro read at ${this.scriptPath} hashes to ${message.digest || "(nothing)"}, but this package shipped ${this.expectedDigest} — resync the runtime copy (npm run sync:windows) or reinstall the plugin`;
          settleStart(new Error(this.lastError));
          this.process?.kill();
          return;
        }
        clearTimeout(handshakeTimer);
        this.agentPid = message.pid;
        settleStart();
        break;
      }
      case "ack": {
        // Dequeue signal: start this request's own budget clock NOW. Armed
        // here instead of at submission, a queued request can no longer time
        // out on a queue it never chose to join — and its watchdog can never
        // kill the shared transport for a stall that was never its own. A
        // request cancelled while it was queued is killed only now, when it is
        // the one running.
        const pending = this.pending.get(message.id);
        if (pending) {
          pending.started = true;
          this.lastAckedSeq = pending.seq;
          this.recordAck(pending);
          if (pending.cancelled) this.armCancelSignal(pending);
          pending.armWatchdog?.();
        }
        break;
      }
      case "result": {
        const pending = this.pending.get(message.id);
        if (!pending) break; // answered after its caller gave up — noise
        pending.answered = true;
        this.clearPending(pending);
        this.pending.delete(message.id);
        this.rearmIdleTimer();
        // A cancelled request keeps its entry only until this answer arrives.
        if (pending.settled) break;
        pending.settled = true;
        pending.resolve({ exitCode: message.exitCode, stdout: message.stdout, stderr: message.stderr, truncated: message.truncated });
        break;
      }
      case "agentError": {
        const pending = this.pending.get(message.id);
        if (!pending) break;
        pending.answered = true;
        this.clearPending(pending);
        this.pending.delete(message.id);
        this.rearmIdleTimer();
        if (pending.settled) break;
        pending.settled = true;
        // A cwd rejection is the command's own failure, not the agent's — it
        // becomes a CwdError so the execution layer can report it exactly like
        // the one-shot path's relay text. A `spawn` rejection is the same
        // class of failure on the native agent (it cannot distinguish a
        // missing workdir), so it gets its own class and the executor retries
        // it one-shot.
        if (message.reason === "cwd") {
          pending.reject(new CwdError(message.message));
        } else if (message.reason === "spawn") {
          pending.reject(new SpawnError(message.message));
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
   *
   * @param child - the process that exited.
   * @param code - the exit code, null when killed by a signal.
   * @param signalName - the killing signal, null on a normal exit.
   */
  private handleProcessExit(child: ChildProcessWithoutNullStreams, code: number | null, signalName: NodeJS.Signals | null): void {
    // The exit handler has already proved this child is the current generation;
    // that check is the one place a stale exit can be rejected.
    this.process = null;
    this.agentPid = undefined;
    this.teardownStreams(child);
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
      const relayable: PendingRequest[] = [];
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
          if (pending.settled) continue;
          pending.settled = true;
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
              if (pending.settled) continue;
              pending.settled = true;
              pending.reject(new AgentUnavailableError(`agent exited before request ${id} could be re-sent; its state is unknown`));
            }
          }
        })
        .catch((error) => {
          for (const pending of relayable) {
            this.clearPending(pending);
            if (pending.settled) continue;
            pending.settled = true;
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
      if (pending.settled) continue;
      pending.settled = true;
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
   *
   * @param request - the request to register.
   */
  private track({ id, kind = "exec", lines, resolve, reject, timeoutMs, signal }: {
    /** The request's id. */
    id: string,
    /** The metric bucket. */
    kind?: "fs" | "exec",
    /** The frame lines to write. */
    lines: string[],
    /** Settles a RES. */
    resolve: (result: ExecResult) => void,
    /** Settles a failure. */
    reject: (error: Error) => void,
    /** The in-distro timeout in ms; 0 means none. */
    timeoutMs: number,
    /** The caller's cancellation. */
    signal?: AbortSignal,
  }): void {
    if (this.pending.size >= this.maxPending) {
      this.noteRejected(kind);
      reject(new Error(`the resident agent has ${this.pending.size} requests in flight (max ${this.maxPending}); retry when the queue drains`));
      return;
    }
    const pending: PendingRequest = {
      id,
      seq: Number(id.slice(1)),
      kind,
      sentAt: performance.now(),
      measured: false,
      lines,
      resolve: (result) => {
        this.recordSettle(pending, undefined);
        resolve(result);
      },
      reject: (error) => {
        this.recordSettle(pending, error);
        reject(error);
      },
      watchdog: null,
      signal: signal ?? null,
      onAbort: null,
      started: false,
      cancelled: false,
      settled: false,
      answered: false,
      signalTimer: null,
      armWatchdog:
        timeoutMs > 0
          ? () => {
              if (pending.watchdog) return;
              // Bind the watchdog to the generation it was armed on: a rebuild
              // must not let a stale timer kill the new transport.
              const child = this.process;
              if (!child) return;
              // The in-distro timeout does the killing; this only catches an
              // agent that accepted the request and then stopped answering
              // even to its own timer.
              pending.watchdog = setTimeout(() => {
                if (this.process !== child) return;
                this.lastError = `agent did not answer request ${pending.id} within ${timeoutMs + WATCHDOG_GRACE_MS}ms of its dispatch`;
                child.kill();
              }, timeoutMs + WATCHDOG_GRACE_MS);
            }
          : null,
    };
    this.pending.set(id, pending);
    this.requestMetrics.inFlightMax = Math.max(this.requestMetrics.inFlightMax, this.pending.size);
    if (signal) {
      if (signal.aborted) {
        this.pending.delete(id);
        this.noteRejected(kind);
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        return;
      }
      pending.onAbort = () => {
        pending.cancelled = true;
        // The frame is the fallback for an agent that cannot be signalled (a
        // confined resident, a build without the USR1 trap); the signal is what
        // interrupts the command the agent is blocked on right now.
        this.writeLines([encodeKill(pending.id)]);
        if (pending.settled) return;
        pending.settled = true;
        // Keep the entry until the agent answers: a request cancelled while it
        // was QUEUED is killed when its ACK arrives, and its late RES only
        // cleans the map.
        this.clearPending(pending);
        pending.reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        // Arm AFTER clearPending: the clear releases the per-request timers,
        // and the signal is the one timer that must outlive this rejection.
        // A host timeout is excluded: the distro-side watcher already kills
        // that command, and a USR1 delivered after it settled would hit the
        // request that took its place (observed as an exit-138 "completed").
        const reason = pending.signal?.reason;
        const timedOut = reason instanceof Error && reason.message === BASH_TIMEOUT_REASON;
        if (pending.started && !timedOut) this.armCancelSignal(pending);
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
      this.noteRejected(kind);
      reject(new AgentUnavailableError("the agent exited before the request could be sent; it never ran"));
      return;
    }
    this.rearmIdleTimer();
  }

  /**
   * Run one command inside the distro through the agent.
   *
   * @param request - the execution request.
   * @returns the settled result.
   * @throws {AgentUnavailableError} when the agent is out for this process.
   */
  async exec({ cwd, argv, timeoutMs = 0, maxOutputBytes = 0, env, signal }: {
    /** Linux path to run in. */
    cwd: string,
    /** The argv, already bwrap-wrapped when the caller confines. */
    argv: string[],
    /**
     * In-distro timeout, whole seconds upward, measured from the agent's
     * dequeue ACK; `<= 0` or omitted means none. Queue time ahead of the
     * dispatch is never counted.
     */
    timeoutMs?: number,
    /**
     * Extra environment for this request only; values lose trailing newlines
     * (protocol limitation).
     */
    env?: Record<string, string>,
    /**
     * Per-stream capture ceiling the agent enforces (carried on the EXEC
     * frame); the RES line reports which streams were cut. 0 (the default)
     * keeps the unbounded capture.
     */
    maxOutputBytes?: number,
    /** Cancels the request (KILL + reject). */
    signal?: AbortSignal,
  }): Promise<{ exitCode: number, stdout: Buffer, stderr: Buffer, truncated: { stdout: boolean, stderr: boolean } }> {
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
      this.track({ id, kind: "exec", lines, resolve, reject, timeoutMs, signal });
    });
  }

  /**
   * Run one filesystem-substrate op inside the distro through the agent.
   * Responses reuse the EXEC `ACK`/`RES` lines, so cancellation and the
   * watchdog are exactly the command path's. The rebuild relay differs by op:
   * a read-only op rides a rebuild, a `write` in flight fails with an
   * unknown-state error instead of being replayed.
   *
   * @param request - the filesystem request.
   * @returns the settled result.
   * @throws {AgentUnavailableError} when the agent is out for this process.
   */
  async fs({ op, args, timeoutMs = 0, signal }: {
    /**
     * Op name (`stat`, `lstat`, `list`, `realpath`, `read`, `write`),
     * dispatched by `agent/wsl-agent.sh`.
     */
    op: string,
    /** Op arguments; each rides one base64 line. */
    args: string[],
    /**
     * In-distro timeout, whole seconds upward, measured from the agent's
     * dequeue ACK; `<= 0` or omitted means none.
     */
    timeoutMs?: number,
    /** Cancels the request (KILL + reject). */
    signal?: AbortSignal,
  }): Promise<{ exitCode: number, stdout: Buffer, stderr: Buffer }> {
    if (this.state === "dead") {
      throw new AgentUnavailableError(this.lastError);
    }
    await this.start();
    const id = `r${this.nextRequestId++}`;
    const lines = encodeFsFrame({ id, op, args, timeoutMs });
    return new Promise((resolve, reject) => {
      this.track({ id, kind: "fs", lines, resolve, reject, timeoutMs, signal });
    });
  }

  /**
   * Liveness probe, also used to warm the agent up.
   *
   * @param signal - cancels the wait.
   * @returns resolved on PONG.
   */
  async ping(signal?: AbortSignal): Promise<void> {
    if (this.state === "dead") throw new AgentUnavailableError(this.lastError);
    await this.start();
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
    return new Promise((resolve, reject) => {
      const id = `r${this.nextRequestId++}`;
      const lines = encodeExecFrame({ id, cwd: "/", argv: ["true"], timeoutMs: 0 });
      this.track({ id, kind: "exec", lines, resolve: () => resolve(), reject, timeoutMs: HANDSHAKE_TIMEOUT_MS, signal });
    });
  }

  /**
   * Deliver an out-of-band signal to the resident shell. The serial stdin loop
   * cannot consume a frame while a command runs, so cancellation is a signal;
   * a second `wsl.exe` is the only channel that reaches the agent while it is
   * blocked in `wait`.
   *
   * Only an agent that shares the distro's PID namespace is addressable: the
   * plain agent, or a session runtime (its prefix is a scope plus mounts, but
   * no PID namespace). A confined resident runs inside a PID namespace whose
   * PIDs do not exist in the distro, so signalling its HELLO PID could hit an
   * unrelated process; there the KILL frame remains the (delayed) fallback.
   *
   * @param signal - the signal to deliver (`SIGUSR1` is the cancel trap).
   */
  /**
   * The cumulative request metrics: queue wait (sent -> ACK) and execution
   * time (ACK -> settle) per request kind, plus the peak in-flight count.
   *
   * @returns a snapshot the caller can keep.
   */
  metrics(): AgentMetrics {
    return {
      fs: { ...this.requestMetrics.fs },
      exec: { ...this.requestMetrics.exec },
      inFlightMax: this.requestMetrics.inFlightMax,
    };
  }

  /** Reset the cumulative metrics (diagnostics/probes). */
  resetMetrics(): void {
    this.requestMetrics = emptyAgentMetrics();
  }

  /**
   * The metric bucket for a request kind.
   * @param kind - fs or exec.
   * @returns the bucket.
   */
  private kindMetrics(kind: "fs" | "exec"): RequestMetrics {
    return kind === "fs" ? this.requestMetrics.fs : this.requestMetrics.exec;
  }

  /**
   * Record a request that never entered the pending map.
   * @param kind - the bucket.
   */
  private noteRejected(kind: "fs" | "exec"): void {
    this.kindMetrics(kind).rejected += 1;
  }

  /**
   * Record the dequeue ACK: the request's queue wait.
   * @param pending - the request.
   */
  private recordAck(pending: PendingRequest): void {
    if (pending.ackedAt !== undefined) return;
    const now = performance.now();
    pending.ackedAt = now;
    const stats = this.kindMetrics(pending.kind);
    const wait = now - pending.sentAt;
    stats.queueMs += wait;
    stats.queueMaxMs = Math.max(stats.queueMaxMs, wait);
  }

  /**
   * Record a settle: the requests count, the execution time (or the queue wait
   * for a request that never ACKed), and the outcome.
   * @param pending - the request.
   * @param error - the failure, when any.
   */
  private recordSettle(pending: PendingRequest, error?: Error): void {
    if (pending.measured) return;
    pending.measured = true;
    const now = performance.now();
    const stats = this.kindMetrics(pending.kind);
    stats.requests += 1;
    if (pending.ackedAt !== undefined) {
      const exec = now - pending.ackedAt;
      stats.execMs += exec;
      stats.execMaxMs = Math.max(stats.execMaxMs, exec);
    } else {
      const wait = now - pending.sentAt;
      stats.queueMs += wait;
      stats.queueMaxMs = Math.max(stats.queueMaxMs, wait);
    }
    if (pending.cancelled) stats.cancelled += 1;
    else if (error !== undefined) stats.failed += 1;
  }

  private signalAgent(signal: NodeJS.Signals): void {
    const pid = this.agentPid;
    if (pid === undefined || !this.signalable) return;
    if (this.configuredSignal) {
      this.configuredSignal({ wslPath: this.wslPath, distro: this.distro, pid, signal });
      return;
    }
    const distroArgs = this.distro.length > 0 ? ["-d", this.distro] : [];
    const child = spawn(
      this.wslPath,
      [...distroArgs, "--exec", "sh", "-c", 'kill -s "$1" "$2" 2>/dev/null', "sh", signal.replace(/^SIG/, ""), String(pid)],
      { stdio: "ignore", windowsHide: true, env: pinnedWindowsEnv(process.env) },
    );
    // The agent may already be gone; the KILL frame remains the fallback.
    child.on("error", () => {});
  }

  /**
   * Shut the agent down: SHUTDOWN first, then kill after a short grace. The
   * agent becomes reusable — a later `exec` starts a fresh process.
   *
   * @returns resolved once the process is gone.
   */
  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const child = this.process;
    if (!child) return;
    // A close during a start must settle that start: the handshake will never
    // complete once the process is being shut down, and the caller would wait
    // for it forever.
    if (this.state === "starting") this.startSettler?.(new AgentUnavailableError("the agent was closed during start"));
    this.state = "idle";
    this.process = null;
    this.agentPid = undefined;
    if (this.pending.size > 0) {
      const reason = new AgentUnavailableError("the agent was closed before this request answered");
      for (const pending of this.pending.values()) {
        this.clearPending(pending);
        if (pending.settled) continue;
        pending.settled = true;
        pending.reject(reason);
      }
      this.pending.clear();
    }
    this.writeLinesSafe(child, ["SHUTDOWN"]);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 1000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    // The transport is always spawned with pipes, so the streams exist; the
    // field's broader type is Node's, not the spawn's.
    this.teardownStreams(child as ChildProcessWithoutNullStreams);
  }

  /**
   * Release the host's ends of a dead child's stdio. A descendant that
   * inherited a pipe's write end would otherwise keep the read side — and the
   * fd — open until that descendant exits; the agent's own helpers are
   * redirected at their spawn sites, but the host must not depend on it.
   *
   * @param child - the process whose streams are being released.
   */
  private teardownStreams(child: ChildProcessWithoutNullStreams): void {
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr?.destroy();
  }

  /**
   * Write one frame to the live process.
   *
   * @param lines - the frame lines to write.
   * @returns whether the frame was written.
   */
  private writeLines(lines: string[]): boolean {
    const child = this.process;
    if (!child || !child.stdin || !child.stdin.writable) return false;
    child.stdin.write(`${lines.join("\n")}\n`);
    this.rearmIdleTimer();
    return true;
  }

  /**
   * Write one frame to a specific process, tolerating a dead pipe.
   *
   * @param child - the process being shut down.
   * @param lines - the lines to write.
   */
  private writeLinesSafe(child: ChildProcess, lines: string[]): void {
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

  /** Restart the idle-shutdown countdown. */
  private rearmIdleTimer(): void {
    if (!this.idleMs) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) void this.close();
    }, this.idleMs);
  }

  /**
   * Detach an entry's timer and abort listener.
   *
   * @param pending - the entry to clear.
   */
  private clearPending(pending: PendingRequest): void {
    if (pending.watchdog) clearTimeout(pending.watchdog);
    if (pending.signalTimer) clearTimeout(pending.signalTimer);
    pending.signalTimer = null;
    if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
  }

  /**
   * Deliver the out-of-band cancel signal after a short grace, and only while
   * the request it was meant for is still the agent's current one.
   *
   * The signal has no request id: it interrupts whatever command the agent is
   * blocked in. A timeout request is usually already being killed by the
   * in-distro watcher, so an immediate signal can land after the agent moved
   * on — the next request then dies with exit 138 (SIGUSR1) and looks
   * `completed`. A newer ACK means the agent has answered the old request, so
   * the signal is dropped; an answered request is dropped too.
   *
   * @param pending - the cancelled request.
   */
  private armCancelSignal(pending: PendingRequest): void {
    if (pending.signalTimer !== null) return;
    pending.signalTimer = setTimeout(() => {
      pending.signalTimer = null;
      if (pending.answered || this.pending.get(pending.id) !== pending) return;
      if (this.lastAckedSeq > pending.seq) return;
      this.signalAgent("SIGUSR1");
    }, CANCEL_SIGNAL_GRACE_MS);
    pending.signalTimer.unref?.();
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
 *
 * @param lines - the stored frame.
 * @returns true when the frame may be replayed.
 */
function isReplayableFrame(lines: string[]): boolean {
  const header = lines[0] ?? "";
  if (!header.startsWith("FS|")) return false;
  const op = header.split("|")[2];
  return op !== undefined && REPLAYABLE_FS_OPS.has(op);
}

/**
 * Rewrite the request id inside a stored frame so a resent request does not
 * collide with ids the new process has already seen. SETENV lines pass
 * through unchanged (they are id-less and idempotent).
 *
 * @param lines - the stored frame.
 * @param newId - the new request id.
 * @returns the relabelled frame.
 */
export function relabelFrame(lines: string[], newId: string): string[] {
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
