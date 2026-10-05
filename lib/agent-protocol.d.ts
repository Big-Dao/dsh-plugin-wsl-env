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
 * @module dsh-plugin-wsl/agent-protocol
 */
/** The protocol version this host side speaks; the agent must match. */
export declare const PROTOCOL_VERSION = 4;
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
export interface ExecFrameRequest {
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
}
/**
 * Build the request lines for one EXEC frame: a header line naming the cwd,
 * the whole-request timeout in whole seconds (0 = none), the argv word count
 * and the per-stream output capture budget in bytes (0 = unlimited), followed
 * by one base64 line per argv word.
 *
 * @param request - the execution request.
 * @returns the lines to write to the agent's stdin, in order.
 */
export declare function encodeExecFrame({ id, cwd, argv, timeoutMs, maxOutputBytes }: ExecFrameRequest): string[];
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
export interface FsFrameRequest {
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
 * `stat`, `lstat`, `list`, `realpath`, `read`, `write`. Responses reuse the
 * EXEC `ACK`/`RES`/`ERR` lines, so the request machinery (pending map, KILL,
 * the watchdog) is shared unchanged.
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
/**
 * `HELLO|name|version|digest` — `digest` is the sha256 of the script file the
 * agent is executing (empty when it could not hash it); the host compares it
 * against its own shipped copy.
 */
export interface HelloMessage {
    type: "hello";
    name: string;
    version: number;
    digest: string;
}
/** `PONG` — the liveness answer to `PING`. */
export interface PongMessage {
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
 * Any other line — never thrown; the host decides whether an unrecognized line
 * is fatal. (Anything during the handshake is; after it, garbage on stdout is
 * logged and dropped, because a `RES` for a request the host already gave up
 * on is expected noise.)
 */
export interface UnknownMessage {
    type: "unknown";
    line: string;
}
/** The line parser's verdict: the union of every message shape above. */
export type AgentMessage = HelloMessage | PongMessage | AckMessage | ResultMessage | AgentErrorMessage | UnknownMessage;
/**
 * Parse one line of the agent's stdout.
 *
 * @param line - a line without its terminator.
 * @returns the line's verdict; the message interfaces document each variant.
 */
export declare function parseAgentLine(line: string): AgentMessage;
