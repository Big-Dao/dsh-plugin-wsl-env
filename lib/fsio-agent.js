/**
 * The distro-side filesystem substrate: fsio's orchestration, run over the
 * agent's FS frames instead of Node's fs on the 9p share.
 *
 * Where `@deepseek-ai/dsh-fs-local` opens paths on the host, this module asks
 * the resident in-distro agent (`agent/wsl-agent.sh`) to stat, list, read and
 * write on ext4 — where symlinks resolve, mode bits stick, and `find` walks
 * the native filesystem. Everything the peer does HOST-side after the bytes
 * arrive stays here, byte-for-byte: the binary NUL sample, the fatal UTF-8
 * decode, the LF normalization, the edit algorithm (see `fsio-text.js`).
 *
 * Coordinate systems: every method takes and returns LINUX paths; `targetKey`
 * identity remains the distro's UNC form (the whole harness keys caches and
 * guards on it), translated at this boundary via `paths.js`. The module is
 * policy-free — the fence lives in the provider — and peer-free, so it is
 * unit-testable in a bare checkout against a scripted agent.
 *
 * @module dsh-plugin-wsl/fsio-agent
 */

import { FS_READ_CHUNK_BYTES } from "./agent-protocol.js";
import {
  BINARY_SAMPLE_BYTES,
  FsCodedError,
  decodeUtf8,
  decodeUtf8Stream,
  detectLineEndings,
  normalizeLineEndings,
  restoreLineEndings,
  applyLiteralEdit,
  throwIfAborted,
} from "./fsio-text.js";
import { posixToUnc, uncToPosix } from "./paths.js";

/** One FS frame's in-distro watchdog; fs ops are short, writes bounded by content size. */
const FS_OP_TIMEOUT_MS = 30_000;

/**
 * Normalize one agent timestamp ("seconds.frac", 9 or 10 fractional digits
 * depending on whether stat or find produced it) into the peer's nanosecond
 * string: exactly nine fractional digits, no dot.
 * @param {string} value - the wire timestamp.
 * @returns {string} seconds followed by nine fractional digits.
 */
export function nanoseconds(value) {
  const [seconds, fraction = ""] = String(value).split(".");
  return `${seconds}${fraction.padEnd(9, "0").slice(0, 9)}`;
}

/**
 * The peer's `versionOf`: dev, inode, size and both nanosecond timestamps.
 * Self-consistency within this provider is what versions need; the ingredients
 * come from one kernel, so a change in any byte of the file changes the string.
 * @param {object} ingredients - the stat record's identity fields.
 * @returns {string} the opaque version string.
 */
export function versionOf({ dev, ino, size, mtimeNs, ctimeNs }) {
  return `${dev}:${ino}:${size}:${mtimeNs}:${ctimeNs}`;
}

/**
 * Parse one stat record as the agent emits it:
 * `type \t mode \t size \t dev \t ino \t mtime \t ctime`.
 * @param {Buffer} stdout - the op's payload.
 * @returns {{type: string, mode: number, size: number, dev: string, ino: string, version: string}}
 */
export function parseStatRecord(stdout) {
  const [type, mode, size, dev, ino, mtime, ctime] = stdout.toString("utf8").split("\t");
  return {
    type,
    mode: Number.parseInt(mode, 8) & 0o777,
    size: Number(size),
    dev,
    ino,
    version: versionOf({ dev, ino, size, mtimeNs: nanoseconds(mtime), ctimeNs: nanoseconds(ctime) }),
  };
}

const REASON_CODES = {
  notfound: "FS_NOT_FOUND",
  notdir: "FS_NOT_FOUND",
  perm: "FS_IO_ERROR",
  loop: "FS_IO_ERROR",
  exists: "FS_NOT_OBSERVED",
  stale: "FS_STALE_VERSION",
  io: "FS_IO_ERROR",
};

/**
 * The kernel's denial dialect: a write that a read-only bind refused. The
 * command path classifies the same signature into its sandbox denial, so a
 * confined write the mount table refused carries `FS_SANDBOX_DENIED` — the
 * model sees the escalation offer instead of an unexplained I/O failure.
 */
const DENIAL_SIGNATURES = ["read-only file system"];

/**
 * One distro's filesystem face. Owns the agent round trips and the host-side
 * validation; the provider layers the fence on top.
 */
export class DistroFs {
  /**
   * @param {object} deps - the substrate's collaborators.
   * @param {import("./agent.js").WslAgent} deps.agent - the resident in-distro agent.
   * @param {string} deps.distro - the pinned distro name, for UNC translation.
   */
  constructor({ agent, distro }) {
    this.agent = agent;
    this.distro = distro;
  }

  /**
   * Run one FS op, mapping an aborted request onto the structured code the
   * provider's callers expect. A mutation may name the agent that must run it
   * — the confined resident whose mount table matches the granted rights —
   * while reads ride the plain resident.
   * @private
   */
  async request(op, args, signal, agent = this.agent) {
    try {
      return await agent.fs({ op, args, timeoutMs: FS_OP_TIMEOUT_MS, signal });
    } catch (error) {
      if (signal?.aborted) {
        throw new FsCodedError(`${op === "write" ? "write" : "read"} aborted`, "FS_ABORTED", error instanceof Error ? error : undefined);
      }
      throw error;
    }
  }

  /**
   * Turn a failed op into the coded error, reading the agent's
   * `dsh-fs|<reason>|<b64 message>` line; a frame without one is a raw I/O
   * fault carrying whatever stderr the agent did produce. On a WRITE, the
   * kernel's read-only-bind denial is classified as the sandbox refusal it is,
   * mirroring the command path's denial signatures.
   * @private
   */
  fail(op, result, displayPath) {
    const text = result.stderr.toString("utf8");
    const first = text.split("\n")[0] ?? "";
    if (first.startsWith("dsh-fs|")) {
      const [, reason, encoded] = first.split("|");
      const message = Buffer.from(encoded ?? "", "base64").toString("utf8");
      if (op === "write" && DENIAL_SIGNATURES.some((signature) => message.toLowerCase().includes(signature))) {
        return new FsCodedError(`cannot write "${displayPath}": ${message}`, "FS_SANDBOX_DENIED");
      }
      return new FsCodedError(message, REASON_CODES[reason] ?? "FS_IO_ERROR");
    }
    return new FsCodedError(`cannot ${op} "${displayPath}": ${text.trim() || "distro I/O failure"}`, "FS_IO_ERROR");
  }

  /**
   * Stat one Linux path, following or not. A missing path is `null`, exactly
   * like the peer's `probe`; everything else that is not found-class is a
   * structured failure.
   * @param {string} linuxPath - the path inside the distro.
   * @param {object} [options] - the stat flavour.
   * @param {boolean} [options.follow] - follow symlinks (default true).
   * @param {AbortSignal} [options.signal] - cancels the round trip.
   * @returns {Promise<{type: string, mode: number, size: number, version: string}|null>}
   */
  async stat(linuxPath, { follow = true, signal } = {}) {
    throwIfAborted(signal, "stat");
    const result = await this.request(follow ? "stat" : "lstat", [linuxPath], signal);
    if (result.exitCode === 0) return parseStatRecord(result.stdout);
    const failure = this.fail("stat", result, linuxPath);
    if (failure.code === "FS_NOT_FOUND") return null;
    throw failure;
  }

  /**
   * The distro-side identity of one path: the strict realpath, or on a missing
   * target the nearest existing ancestor with the missing suffix — the peer's
   * `resolveLocalTarget`, run where the symlinks live.
   * @param {string} linuxPath - the absolute Linux path to resolve.
   * @param {AbortSignal} [signal] - cancels the round trip.
   * @returns {Promise<string>} the canonical Linux path.
   */
  async canonicalPath(linuxPath, signal) {
    throwIfAborted(signal, "resolve");
    if (String(linuxPath).trim().length === 0) {
      throw new FsCodedError("file_path must be a non-empty string", "FS_NOT_FOUND");
    }
    const result = await this.request("realpath", [linuxPath], signal);
    if (result.exitCode !== 0) throw this.fail("resolve", result, linuxPath);
    return result.stdout.toString("utf8");
  }

  /**
   * Resolve one Linux path to the target shape the provider and tooling use:
   * the Linux spelling the model sees and the UNC identity the harness keys on.
   * @param {string} linuxPath - the absolute Linux path to resolve.
   * @param {AbortSignal} [signal] - cancels the round trip.
   * @returns {Promise<{displayPath: string, targetKey: string}>}
   */
  async resolveTarget(linuxPath, signal) {
    const canonical = await this.canonicalPath(linuxPath, signal);
    return { displayPath: linuxPath, targetKey: posixToUnc(this.distro, canonical) };
  }

  /**
   * List one directory's direct children in name order — one `find -L` pass in
   * the distro, sorted and shaped host-side like the peer's `listDirectory`.
   * A symlink child's identity is resolved with one extra round trip, because
   * the follow-stat the list already carried belongs to its target.
   * @param {object} target - the resolved directory to list.
   * @param {string} target.displayPath - the Linux directory spelling.
   * @param {string} target.targetKey - the directory's UNC identity (canonical).
   * @param {AbortSignal} [signal] - aborts between children.
   * @returns {Promise<Array<{name: string, type: string, target: {displayPath: string, targetKey: string}, version?: string, size?: number}>>}
   */
  /**
   * List one directory's direct children in name order — one `find` pass in
   * the distro, sorted and shaped host-side like the peer's `listDirectory`.
   * The wire type is the entry's own (lstat): a symlink child then gets one
   * follow-up stat (its target's version and size) plus a realpath (its
   * identity), and a dangling symlink degrades to the peer's `other` with no
   * version — exactly what the peer's null follow-probe produces.
   * @param {object} target - the resolved directory to list.
   * @param {string} target.displayPath - the Linux directory spelling.
   * @param {string} target.targetKey - the directory's UNC identity (canonical).
   * @param {AbortSignal} [signal] - aborts between children.
   * @returns {Promise<Array<{name: string, type: string, target: {displayPath: string, targetKey: string}, version?: string, size?: number}>>}
   */
  async listChildren(target, signal) {
    throwIfAborted(signal, "list");
    const linuxDir = uncToPosix(target.targetKey)?.linuxPath ?? target.displayPath;
    const info = await this.stat(linuxDir, { signal });
    if (!info) throw new FsCodedError(`cannot list "${target.displayPath}": not found`, "FS_NOT_FOUND");
    if (info.type !== "d") throw new FsCodedError(`cannot list "${target.displayPath}": not a directory`, "FS_NOT_DIRECTORY");
    const result = await this.request("list", [linuxDir], signal);
    if (result.exitCode !== 0) throw this.fail("list", result, target.displayPath);
    const parentCanonical = linuxDir;
    const records = result.stdout.toString("utf8").split("\0").filter((record) => record.length > 0);
    const entries = [];
    for (const record of records) {
      throwIfAborted(signal, "list");
      const fields = record.split("\t");
      const wireType = fields[0];
      const [, , dev, ino, mtime, ctime] = fields;
      const path = fields.slice(6).join("\t");
      // `find` joins each child onto the parent path. A root listing's parent
      // is bare "/", where `slice(length + 1)` sheared the first character off
      // EVERY name ("/etc" -> "tc") and the next write then created "/tc" — so
      // strip the exact prefix plus any separators instead. The join below
      // then owes its own slash: an empty spelling is what "/" contributes.
      const directory = parentCanonical === "/" ? "" : parentCanonical;
      const name = path.slice(parentCanonical.length).replace(/^\/+/, "");
      const displayPath = `${directory}/${name}`;
      // Non-link entries: the record's own stat IS the follow stat. A link
      // costs one stat plus one realpath, where the symlink actually lives.
      let { type, version, size } = { type: wireType, version: undefined, size: undefined };
      let childCanonical = `${directory}/${name}`;
      if (wireType === "l") {
        const followed = await this.stat(childCanonical, { signal }).catch(() => null);
        if (followed) {
          type = followed.type;
          version = followed.version;
          if (followed.type === "f") size = followed.size;
          childCanonical = await this.canonicalPath(childCanonical, signal);
        }
      } else {
        version = versionOf({ dev, ino, size: fields[1], mtimeNs: nanoseconds(mtime), ctimeNs: nanoseconds(ctime) });
        if (type === "f") size = Number(fields[1]);
      }
      entries.push({
        name,
        type: type === "f" ? "file" : type === "d" ? "directory" : "other",
        target: { displayPath, targetKey: posixToUnc(this.distro, childCanonical) },
        ...(version !== undefined ? { version } : {}),
        ...(size !== undefined ? { size } : {}),
      });
    }
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  }

  /**
   * Stat the target as a regular file or refuse, mirroring the peer's
   * `statRegularFile` messages.
   * @private
   */
  async statRegularFile(target, verb, signal) {
    throwIfAborted(signal, verb);
    const info = await this.stat(uncToPosix(target.targetKey)?.linuxPath ?? target.displayPath, { signal });
    if (!info) throw new FsCodedError(`cannot ${verb} "${target.displayPath}": not found`, "FS_NOT_FOUND");
    if (info.type !== "f") throw new FsCodedError(`cannot ${verb} "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
    return info;
  }

  /**
   * Read the whole file's bytes through windowed frames.
   * @private
   */
  async readWhole(target, signal, maxBytes = Number.MAX_SAFE_INTEGER) {
    const linuxPath = uncToPosix(target.targetKey)?.linuxPath ?? target.displayPath;
    const chunks = [];
    let offset = 0;
    for (;;) {
      throwIfAborted(signal, "read");
      const result = await this.request("read", [linuxPath, String(offset), String(maxBytes === Number.MAX_SAFE_INTEGER ? FS_READ_CHUNK_BYTES : maxBytes - offset + 1)], signal);
      if (result.exitCode !== 0) throw this.fail("read", result, target.displayPath);
      const chunk = result.stdout;
      if (chunk.length === 0) break;
      chunks.push(chunk);
      offset += chunk.length;
      if (offset > maxBytes) {
        throw new FsCodedError(`cannot read "${target.displayPath}": content exceeds the ${maxBytes}-byte limit`, "FS_TOO_LARGE");
      }
      if (chunk.length < FS_READ_CHUNK_BYTES) break;
    }
    return Buffer.concat(chunks, offset);
  }

  /**
   * Read a whole regular UTF-8 file, rejecting binaries and invalid UTF-8.
   * @param {object} target - the resolved file.
   * @param {AbortSignal} [signal] - aborts the read.
   * @returns {Promise<string>} the full decoded text, byte-for-byte.
   */
  async readWholeText(target, signal) {
    await this.statRegularFile(target, "read", signal);
    const raw = await this.readWhole(target, signal);
    if (raw.subarray(0, BINARY_SAMPLE_BYTES).includes(0)) {
      throw new FsCodedError(`cannot read "${target.displayPath}": binary file`, "FS_NOT_TEXT");
    }
    return decodeUtf8(raw, "read", target.displayPath);
  }

  /**
   * Read a whole regular file as raw bytes, bounded by `maxBytes`.
   * @param {object} target - the resolved file.
   * @param {AbortSignal|undefined} signal - aborts the read.
   * @param {number} maxBytes - inclusive byte cap on the complete content.
   * @returns {Promise<Uint8Array>} the full raw content, at most `maxBytes` long.
   */
  async readWholeBytes(target, signal, maxBytes) {
    const info = await this.statRegularFile(target, "read", signal);
    if (info.size > maxBytes) {
      throw new FsCodedError(`cannot read "${target.displayPath}": ${info.size} bytes exceeds the ${maxBytes}-byte limit`, "FS_TOO_LARGE");
    }
    return this.readWhole(target, signal, maxBytes);
  }

  /**
   * Read the bytes at `[offset, offset + length)` of a regular file. A window
   * at or past the end is empty.
   * @param {object} target - the resolved file.
   * @param {{offset: number, length: number}} range - the byte window.
   * @param {AbortSignal} [signal] - aborts the read.
   * @returns {Promise<Uint8Array>} the window's bytes.
   */
  async readByteWindow(target, range, signal) {
    await this.statRegularFile(target, "read", signal);
    if (range.length === 0) return new Uint8Array(0);
    const linuxPath = uncToPosix(target.targetKey)?.linuxPath ?? target.displayPath;
    const result = await this.request("read", [linuxPath, String(range.offset), String(range.length)], signal);
    if (result.exitCode !== 0) throw this.fail("read", result, target.displayPath);
    return result.stdout;
  }

  /**
   * Stream a whole regular UTF-8 file as decoded text chunks — the binary
   * sample scan and cross-chunk decoding stay host-side, exactly the peer's.
   * @param {object} target - the resolved file.
   * @param {AbortSignal} [signal] - aborts the stream.
   * @returns {AsyncGenerator<string>} decoded text chunks in file order.
   */
  async *streamWholeText(target, signal) {
    await this.statRegularFile(target, "read", signal);
    const linuxPath = uncToPosix(target.targetKey)?.linuxPath ?? target.displayPath;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let sampledBytes = 0;
    let offset = 0;
    const scanBinarySample = (chunk) => {
      if (sampledBytes >= BINARY_SAMPLE_BYTES) return;
      const sample = chunk.subarray(0, Math.min(chunk.length, BINARY_SAMPLE_BYTES - sampledBytes));
      if (sample.includes(0)) throw new FsCodedError(`cannot read "${target.displayPath}": binary file`, "FS_NOT_TEXT");
      sampledBytes += sample.length;
    };
    for (;;) {
      throwIfAborted(signal, "read");
      const result = await this.request("read", [linuxPath, String(offset), String(FS_READ_CHUNK_BYTES)], signal);
      if (result.exitCode !== 0) throw this.fail("read", result, target.displayPath);
      const chunk = result.stdout;
      if (chunk.length === 0) break;
      scanBinarySample(chunk);
      yield decodeUtf8Stream(decoder, chunk, "read", target.displayPath);
      offset += chunk.length;
      if (chunk.length < FS_READ_CHUNK_BYTES) break;
    }
    yield decodeUtf8Stream(decoder, undefined, "read", target.displayPath);
  }

  /**
   * Publish `content` over `linuxPath` the POSIX way: the agent stages into a
   * private 0700 sibling, fsyncs, chmods, and renames — or hard links for a
   * guarded create. A `replace` publish carrying `expectedVersion` is
   * re-verified by the agent against a fresh stat one syscall before the
   * rename: a concurrent writer (an editor save, a `git stash`) wins, and the
   * stale write refuses with `FS_STALE_VERSION` instead of landing.
   * @param {string} linuxPath - the target path inside the distro.
   * @param {string|Uint8Array} content - the full new content.
   * @param {object} [options]
   * @param {number} [options.mode] - the mode to publish (omitted keeps the
   *   temp's 0600 for a create; the caller passes the incumbent's for an edit).
   * @param {{displayPath: string}} [options.createIfAbsent] - guarded-create
   *   intent: publish with a no-replace link carrying this display path in errors.
   * @param {string} [options.expectedVersion] - the version string this write
   *   was based on (a stat-derived one); re-verified distro-side before the rename.
   * @param {AbortSignal} [options.signal] - aborts the write.
   * @param {object} [options.agent] - the agent this mutation rides (the
   *   confined resident under a confined policy).
   * @returns {Promise<void>} resolves when the publish landed.
   */
  async writeFileAtomic(linuxPath, content, { mode, createIfAbsent, expectedVersion, signal, agent } = {}) {
    throwIfAborted(signal, "write");
    const displayPath = createIfAbsent?.displayPath ?? linuxPath;
    const result = await this.request(
      "write",
      [
        linuxPath,
        mode === undefined ? "-" : (mode & 0o777).toString(8),
        createIfAbsent ? "no-replace" : "replace",
        expectedVersion ?? "-",
        content,
      ],
      signal,
      agent,
    );
    if (result.exitCode === 0) return;
    const failure = this.fail("write", result, displayPath);
    if (failure.code !== "FS_NOT_OBSERVED") throw failure;
    // The guarded create hit an existing target: classify it the way the
    // peer's throwGuardedCreateFailure does — a non-regular incumbent is a
    // different refusal than an unread file.
    const incumbent = await this.stat(linuxPath, { follow: false, signal }).catch(() => null);
    if (incumbent && incumbent.type !== "f") {
      throw new FsCodedError(`cannot write "${displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE", failure);
    }
    throw new FsCodedError(`cannot overwrite existing "${displayPath}" without reading it first`, "FS_NOT_OBSERVED", failure);
  }

  /**
   * Read and decode a file for editing: LF-normalized content plus the style
   * to restore on write-back.
   * @param {object} target - the resolved file.
   * @param {AbortSignal} [signal] - aborts the read.
   * @returns {Promise<{content: string, lineEndings: "LF"|"CRLF"}>}
   */
  async readForEdit(target, signal) {
    const raw = await this.readWholeText(target, signal);
    const lineEndings = detectLineEndings(raw);
    return { content: normalizeLineEndings(raw), lineEndings };
  }

  /**
   * Best-effort overwrite diff basis: `null` whenever the file cannot serve
   * one (binary, at/above the bound, vanished), so the write still succeeds
   * and presentation falls back to a whole-file diff.
   * @param {object} target - the resolved file.
   * @param {number} maxBytes - exclusive upper bound for the held basis.
   * @param {AbortSignal} [signal] - cancellation propagates, unlike I/O failure.
   * @returns {Promise<string|null>} the LF-normalized text, or null.
   */
  async readTextForDiff(target, maxBytes, signal) {
    throwIfAborted(signal, "read");
    try {
      const info = await this.stat(uncToPosix(target.targetKey)?.linuxPath ?? target.displayPath, { signal });
      if (!info || info.type !== "f" || info.size >= maxBytes) return null;
      const raw = await this.readWhole(target, signal, maxBytes - 1);
      if (raw.includes(0)) return null;
      return normalizeLineEndings(decodeUtf8(raw, "read", target.displayPath));
    } catch (error) {
      if (error instanceof FsCodedError && error.code === "FS_ABORTED") throw error;
      return null;
    }
  }
}

export { applyLiteralEdit, normalizeLineEndings, restoreLineEndings };
export default DistroFs;
