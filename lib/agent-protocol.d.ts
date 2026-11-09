/**
 * Wire protocol for the resident in-distro agent (`agent/wsl-agent.sh`).
 *
 * Pure by construction — no Node API, no I/O — so the frame codecs and the
 * line parser are unit-testable without a distro. The protocol itself is line
 * oriented with `|` field separators and single-line base64 payloads; see the
 * agent script's header for the grammar. Base64 was chosen over JSON because
 * the agent must run under a bare POSIX sh with nothing but coreutils.
 *
 * This module is the migration's first TypeScript source. The build emits it
 * to `lib/agent-protocol.js`; edit THIS file and run `pnpm run build` — the
 * artifact under `lib/` is generated, and `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/agent-protocol
 */
/** The protocol version this host side speaks. */
export declare const PROTOCOL_VERSION = 7;
/**
 * The oldest agent protocol this host still accepts. A v6 resident keeps
 * working: every v7 frame is gated on the HELLO version, so a half-updated
 * mirror (one side at 6) degrades to v6 behaviour instead of desyncing.
 */
export declare const MIN_PROTOCOL_VERSION = 6;
/**
 * Upper bound on one `read` op's payload, set by the HOST looping over windowed
 * requests. Keeping each frame's decoded payload here means the agent's RES
 * line stays modest even for a large file; the host accumulates chunks.
 */
export declare const FS_READ_CHUNK_BYTES: number;
/** The agent identifies itself with this name in its HELLO line. */
export declare const AGENT_NAME = "wsl-agent";
/**
 * Rough ceiling on one protocol line, chosen well above the executor's own
 * 64 KB output budget spill: stdout and stderr ride ONE line each, so a frame
 * is as large as the largest capture the caller asked for. Documented so a
 * future streaming design does not inherit it silently.
 */
export declare const MAX_FRAME_BYTES: number;
/**
 * Encode a buffer as the protocol's single-line base64 (no line wraps, no
 * padding surprises — standard base64 including `=` padding).
 *
 * @param value - the payload to encode.
 * @returns the wire form.
 */
export declare function encodeB64(value: string | Uint8Array): string;
/**
 * Decode one protocol base64 field.
 *
 * @param value - the wire form.
 * @returns the decoded bytes; a malformed field decodes to empty rather than
 *   throwing, mirroring the agent's own lenient decode.
 */
export declare function decodeB64(value: string): Buffer;
/** One EXEC frame's inputs. */
interface ExecFrameRequest {
    /** Caller-chosen request id (unique per agent). */
    id: string;
    /** Linux path to cd into before exec. */
    cwd: string;
    /** The argv to execute, already bwrap-wrapped. */
    argv: string[];
    /**
     * In-distro timeout; sub-second remainders round up, and `<= 0` disables the
     * timeout.
     */
    timeoutMs?: number;
    /**
     * Per-stream capture ceiling the AGENT enforces: stdout and stderr are each
     * cut at this many bytes and the RES line reports what was cut. 0 (the
     * default) keeps the historical unbounded capture.
     */
    maxOutputBytes?: number;
    /**
     * The child's entire stdin, delivered before the first read. Protocol v6:
     * when present the EXEC header gains a `1` seventh field and one extra
     * base64 line follows the argv words; the agent feeds those bytes to the
     * child and closes its stdin (the child sees EOF at the payload's end). The
     * payload rides one protocol line, so it is bounded by `MAX_FRAME_BYTES` —
     * the shape of every known consumer (`git check-ignore --stdin` pathspecs),
     * none of which streams an unbounded feed. Absent or empty means the child
     * reads an empty stdin and immediate EOF, exactly the v5 behaviour.
     */
    stdin?: Uint8Array;
}
/**
 * Build the request lines for one EXEC frame: a header line naming the cwd,
 * the whole-request timeout in whole seconds (0 = none), the argv word count,
 * the per-stream output capture budget in bytes (0 = unlimited) and — since
 * protocol v6 — the stdin flag (1 when a payload line follows the argv
 * words), followed by one base64 line per argv word and, when flagged, one
 * base64 stdin payload line.
 *
 * @param request - the execution request.
 * @returns the lines to write to the agent's stdin, in order.
 */
export declare function encodeExecFrame({ id, cwd, argv, timeoutMs, maxOutputBytes, stdin }: ExecFrameRequest): string[];
/**
 * Build a SETENV request line. Note the agent's decode strips trailing
 * newlines from the value — the same leniency the shell itself applies.
 *
 * @param key - the variable name.
 * @param value - the variable value.
 * @returns the line to write.
 */
export declare function encodeSetEnv(key: string, value: string): string;
/**
 * Build a KILL request line.
 *
 * @param id - the request id to interrupt.
 * @returns the line to write.
 */
export declare function encodeKill(id: string): string;
/** One FS frame's inputs. */
interface FsFrameRequest {
    /** Caller-chosen request id (unique per agent). */
    id: string;
    /** One of the op names `encodeFsFrame` documents. */
    op: string;
    /** Op arguments, base64-line encoded by the frame. */
    args: string[];
    /**
     * In-distro timeout; sub-second remainders round up, and `<= 0` disables the
     * timeout.
     */
    timeoutMs?: number;
}
/**
 * Build the request lines for one FS frame — the filesystem-substrate request
 * that lets the model's file tools run inside the distro. The shape mirrors
 * EXEC: a header naming the op, the timeout in whole seconds and the argument
 * count, followed by one base64 line per argument.
 *
 * Ops (see `agent/wsl-agent.sh` for the server side and the wire grammar):
 * `stat`, `lstat`, `list`, `realpath`, `read`, `write`, and — protocol 7 —
 * `delete` and `move`. Responses reuse the EXEC `ACK`/`RES`/`ERR`/`FSERR`
 * lines, so the request machinery (pending map, KILL, the watchdog) is
 * shared unchanged.
 *
 * The argument contract: callers pass PLAINTEXT values here; this frame is the
 * single base64 boundary, and the agent decodes each argument once. A write's
 * content is no exception — the agent pipes its still-encoded wire line
 * straight to `base64 -d`, so raw bytes never pass through a shell variable.
 *
 * @param request - the filesystem request.
 * @returns the lines to write to the agent's stdin, in order.
 */
export declare function encodeFsFrame({ id, op, args, timeoutMs }: FsFrameRequest): string[];
/** One op inside a batch frame — the same shape as an FS frame's op and args. */
interface FsBatchOp {
    /** The op name (`stat`, `lstat`, `list`, `read`, … — the FS vocabulary). */
    op: string;
    /** Op arguments, one wire line each. */
    args: string[];
}
/**
 * Build the request lines for one batched FS frame — protocol 7. The shape is
 * a `FSB|<id>|<timeout seconds|0>|<n ops>` header followed by `n ops` records,
 * each an `OP|<op>|<n args>` line plus its base64 arguments. The agent runs
 * the ops in order in ONE worker and answers with one RES whose payload is
 * the concatenated per-op records (`OK <i>|<b64 payload>` /
 * `BAD <i>|<reason>|<b64 message>`) — so a GUI-preview-shaped
 * stat+list+read costs one round trip instead of four to six.
 *
 * @param request - the batch request: an id, a timeout and the ordered ops.
 * @returns the lines to write to the agent's stdin, in order.
 */
export declare function encodeFsbFrame({ id, timeoutMs, ops }: {
    id: string;
    timeoutMs?: number;
    ops: FsBatchOp[];
}): string[];
/**
 * `HELLO|name|version|digest|pid|caps` — `digest` is the sha256 of the script file
 * the agent is executing (empty when it could not hash it); the host compares
 * it against its own shipped copy. `pid` is the agent shell's PID inside the
 * distro, present from protocol 5 on: the host uses it to deliver an
 * out-of-band `USR1` cancellation while the agent is blocked in `wait`, which
 * the serial stdin loop cannot do by frame. It is absent when the agent
 * itself runs inside a PID namespace (the confined resident), where that PID
 * is not addressable from a second `wsl.exe`.
 *
 * `caps` (protocol 7) is a comma-separated capability token list — `conc`
 * (FS ops may run concurrently and answer out of order), `batch` (the
 * `FSB` batch frame is accepted). Absent or empty (a v6 peer, a fake)
 * means no capabilities: the host never sends a v7 frame at a peer that
 * did not advertise the capability.
 */
export interface HelloMessage {
    type: "hello";
    name: string;
    version: number;
    digest: string;
    pid?: number;
    caps?: string[];
}
/** `PONG` — the liveness answer to `PING`. */
interface PongMessage {
    type: "pong";
}
/**
 * `ACK|id` — the agent dequeued the request for execution; the host arms its
 * stuck-request watchdog here, so queue time never counts against a budget.
 */
export interface AckMessage {
    type: "ack";
    id: string;
}
/** `RES|id|exitCode|stdout|stderr` — one settled request, outputs as Buffers. */
export interface ResultMessage {
    type: "result";
    id: string;
    exitCode: number;
    stdout: Buffer;
    stderr: Buffer;
    truncated: {
        stdout: boolean;
        stderr: boolean;
    };
}
/**
 * `ERR|id|reason|message` — a refused request; `id` is `""` when the agent
 * reports a request-less problem (a protocol violation).
 */
export interface AgentErrorMessage {
    type: "agentError";
    id: string;
    reason: string;
    message: string;
}
/**
 * `FSERR|id|reason|message` — protocol 7's structured FS failure: a failed FS
 * op answers with this line instead of (or, from an older agent, in addition
 * to) the `dsh-fs|reason|…` first-stderr-line convention. The host maps
 * `reason` onto the `FsErrorCode` vocabulary directly.
 */
export interface FsErrorMessage {
    type: "fsError";
    id: string;
    reason: string;
    message: string;
}
/**
 * Any other line — never thrown; the host decides whether an unrecognized line
 * is fatal. (Anything during the handshake is; after it, garbage on stdout is
 * logged and dropped, because a `RES` for a request the host already gave up
 * on is expected noise.)
 */
interface UnknownMessage {
    type: "unknown";
    line: string;
}
/** The line parser's verdict: the union of every message shape above. */
export type AgentMessage = HelloMessage | PongMessage | AckMessage | ResultMessage | AgentErrorMessage | FsErrorMessage | UnknownMessage;
/**
 * Parse one line of the agent's stdout.
 *
 * @param line - a line without its terminator.
 * @returns the line's verdict; the message interfaces document each variant.
 */
export declare function parseAgentLine(line: string): AgentMessage;
export {};
