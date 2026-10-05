/**
 * Wire protocol for the resident in-distro agent (`agent/wsl-agent.sh`).
 *
 * Pure by construction — no Node API, no I/O — so the frame codecs and the
 * line parser are unit-testable without a distro. The protocol itself is line
 * oriented with `|` field separators and single-line base64 payloads; see the
 * agent script's header for the grammar. Base64 was chosen over JSON because
 * the agent must run under a bare POSIX sh with nothing but coreutils.
 *
 * @module dsh-plugin-wsl/agent-protocol
 */

/** The protocol version this host side speaks; the agent must match. */
export const PROTOCOL_VERSION = 4;

/**
 * Upper bound on one `read` op's payload, set by the HOST looping over windowed
 * requests. Keeping each frame's decoded payload here means the agent's RES
 * line stays modest even for a large file; the host accumulates chunks.
 */
export const FS_READ_CHUNK_BYTES = 1024 * 1024;

/** The agent identifies itself with this name in its HELLO line. */
export const AGENT_NAME = "wsl-agent";

/**
 * Rough ceiling on one protocol line, chosen well above the executor's own
 * 64 KB output budget spill: stdout and stderr ride ONE line each, so a frame
 * is as large as the largest capture the caller asked for. Documented so a
 * future streaming design does not inherit it silently.
 */
export const MAX_FRAME_BYTES = 256 * 1024 * 1024;

/**
 * Encode a buffer as the protocol's single-line base64 (no line wraps, no
 * padding surprises — standard base64 including `=` padding).
 * @param {string|Uint8Array} value - the payload to encode.
 * @returns {string} the wire form.
 */
export function encodeB64(value) {
  return Buffer.from(value).toString("base64");
}

/**
 * Decode one protocol base64 field.
 * @param {string} value - the wire form.
 * @returns {Buffer} the decoded bytes; a malformed field decodes to empty
 *   rather than throwing, mirroring the agent's own lenient decode.
 */
export function decodeB64(value) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return Buffer.alloc(0);
  return Buffer.from(value, "base64");
}

/**
 * Build the request lines for one EXEC frame: a header line naming the cwd,
 * the whole-request timeout in whole seconds (0 = none), the argv word count
 * and the per-stream output capture budget in bytes (0 = unlimited), followed
 * by one base64 line per argv word.
 * @param {object} request - the execution request.
 * @param {string} request.id - caller-chosen request id (unique per agent).
 * @param {string} request.cwd - Linux path to cd into before exec.
 * @param {string[]} request.argv - the argv to execute, already bwrap-wrapped.
 * @param {number} [request.timeoutMs] - in-distro timeout; sub-second
 *   remainders round up, and `<= 0` disables the timeout.
 * @param {number} [request.maxOutputBytes] - per-stream capture ceiling the
 *   AGENT enforces: stdout and stderr are each cut at this many bytes and the
 *   RES line reports what was cut. 0 (the default) keeps the historical
 *   unbounded capture.
 * @returns {string[]} the lines to write to the agent's stdin, in order.
 */
export function encodeExecFrame({ id, cwd, argv, timeoutMs = 0, maxOutputBytes = 0 }) {
  const timeoutSeconds = timeoutMs > 0 ? Math.ceil(timeoutMs / 1000) : 0;
  const cap = maxOutputBytes > 0 ? Math.floor(maxOutputBytes) : 0;
  const lines = [
    `EXEC|${id}|${encodeB64(cwd)}|${timeoutSeconds}|${argv.length}|${cap}`,
    ...argv.map((word) => encodeB64(word)),
  ];
  return lines;
}

/**
 * Build a SETENV request line. Note the agent's decode strips trailing
 * newlines from the value — the same leniency the shell itself applies.
 * @param {string} key - the variable name.
 * @param {string} value - the variable value.
 * @returns {string} the line to write.
 */
export function encodeSetEnv(key, value) {
  return `SETENV|${key}|${encodeB64(value)}`;
}

/** @param {string} id - the request id to interrupt. @returns {string} */
export function encodeKill(id) {
  return `KILL|${id}`;
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
 * @param {object} request - the filesystem request.
 * @param {string} request.id - caller-chosen request id (unique per agent).
 * @param {string} request.op - one of the op names above.
 * @param {string[]} request.args - op arguments, base64-line encoded here.
 * @param {number} [request.timeoutMs] - in-distro timeout; sub-second
 *   remainders round up, and `<= 0` disables the timeout.
 * @returns {string[]} the lines to write to the agent's stdin, in order.
 */
export function encodeFsFrame({ id, op, args, timeoutMs = 0 }) {
  const timeoutSeconds = timeoutMs > 0 ? Math.ceil(timeoutMs / 1000) : 0;
  return [
    `FS|${id}|${op}|${timeoutSeconds}|${args.length}`,
    ...args.map((word) => encodeB64(word)),
  ];
}

/** The line parser's verdict for one line of agent stdout. */

/**
 * Parse one line of the agent's stdout.
 * @param {string} line - a line without its terminator.
 * @returns {object} one of:
 *   - `{ type: "hello", name, version, digest }` — `digest` is the sha256 of
 *     the script file the agent is executing (empty when it could not hash
 *     it); the host compares it against its own shipped copy
 *   - `{ type: "pong" }`
 *   - `{ type: "ack", id }` — the agent dequeued the request for execution;
 *     the host arms its stuck-request watchdog here, so queue time never
 *     counts against a budget
 *   - `{ type: "result", id, exitCode, stdout, stderr }` — outputs as Buffers
 *   - `{ type: "agentError", id, reason, message }` — `id` is `""` when the
 *     agent reports a request-less problem (a protocol violation)
 *   - `{ type: "unknown", line }` — never thrown; the host decides whether an
 *     unrecognized line is fatal. (Anything during the handshake is; after it,
 *     garbage on stdout is logged and dropped, because a `RES` for a request
 *     the host already gave up on is expected noise.)
 */
export function parseAgentLine(line) {
  if (line.startsWith("HELLO|")) {
    const [, name, version, digest] = line.split("|");
    return { type: "hello", name, version: Number(version), digest: digest ?? "" };
  }
  if (line === "PONG") return { type: "pong" };
  if (line.startsWith("ACK|")) return { type: "ack", id: line.slice(4) };
  if (line.startsWith("RES|")) {
    const [, id, exitCode, stdout, stderr, outTruncated, errTruncated] = line.split("|");
    // A non-numeric code is protocol garbage, not a success: -1 is a value
    // no `wait` can produce, so a caller can tell it from every real code.
    const code = Number(exitCode);
    return {
      type: "result",
      id,
      exitCode: Number.isSafeInteger(code) ? code : -1,
      stdout: decodeB64(stdout ?? ""),
      stderr: decodeB64(stderr ?? ""),
      // The capture-cap flags the agent appends when the EXEC frame carried a
      // budget; frames without them (fakes, FS ops) are simply not truncated.
      truncated: { stdout: outTruncated === "1", stderr: errTruncated === "1" },
    };
  }
  if (line.startsWith("ERR|")) {
    const [, id, reason, message] = line.split("|");
    return { type: "agentError", id: id ?? "", reason: reason ?? "protocol", message: decodeB64(message ?? "").toString("utf8") };
  }
  return { type: "unknown", line };
}
