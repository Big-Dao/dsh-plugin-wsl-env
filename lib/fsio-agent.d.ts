/**
 * One agent FS round trip's result — the shape `WslAgent#fs` resolves to.
 *
 * @typedef {object} AgentFsResult
 * @property {number} exitCode - the op's exit status.
 * @property {Buffer} stdout - the op's payload bytes.
 * @property {Buffer} stderr - the op's diagnostic line(s).
 */
/**
 * Normalize one agent timestamp ("seconds.frac", 9 or 10 fractional digits
 * depending on whether stat or find produced it) into the peer's nanosecond
 * string: exactly nine fractional digits, no dot.
 * @param {string} value - the wire timestamp.
 * @returns {string} seconds followed by nine fractional digits.
 */
export function nanoseconds(value: string): string;
/**
 * The peer's `versionOf`: dev, inode, size and both nanosecond timestamps.
 * Self-consistency within this provider is what versions need; the ingredients
 * come from one kernel, so a change in any byte of the file changes the string.
   * @param {object} ingredients - the stat record's identity fields.
   * @param {string} ingredients.dev - the device id.
   * @param {string} ingredients.ino - the inode number.
   * @param {string|number} ingredients.size - the byte size as the wire carries it.
   * @param {string} ingredients.mtimeNs - the mtime in nanoseconds.
   * @param {string} ingredients.ctimeNs - the ctime in nanoseconds.
   * @returns {string} the opaque version string.
   */
export function versionOf({ dev, ino, size, mtimeNs, ctimeNs }: {
    dev: string;
    ino: string;
    size: string | number;
    mtimeNs: string;
    ctimeNs: string;
}): string;
/**
 * Parse one stat record as the agent emits it:
 * `type \t mode \t size \t dev \t ino \t mtime \t ctime`.
 * @param {Buffer} stdout - the op's payload.
 * @returns {{type: string, mode: number, size: number, dev: string, ino: string, version: string}}
 */
export function parseStatRecord(stdout: Buffer): {
    type: string;
    mode: number;
    size: number;
    dev: string;
    ino: string;
    version: string;
};
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
    constructor({ agent, distro }: {
        agent: import("./agent.js").WslAgent;
        distro: string;
    });
    agent: import("./agent.js").WslAgent;
    distro: string;
    /**
     * Run one FS op, mapping an aborted request onto the structured code the
     * provider's callers expect. A mutation may name the agent that must run it
     * — the confined resident whose mount table matches the granted rights —
     * while reads ride the plain resident.
     * @param {string} op - the FS op name (`stat`, `lstat`, `realpath`, `list`, `read`, `write`).
     * @param {Array<string|Uint8Array>} args - the op's arguments, one wire line each.
     * @param {AbortSignal|undefined} signal - the caller's cancellation.
     * @param {import("./agent.js").WslAgent} [agent] - the agent that must run the
     *   op; the plain resident by default.
     * @returns {Promise<AgentFsResult>} the op's result.
     * @private
     */
    private request;
    /**
     * Turn a failed op into the coded error, reading the agent's
     * `dsh-fs|<reason>|<b64 message>` line; a frame without one is a raw I/O
     * fault carrying whatever stderr the agent did produce. On a WRITE, the
     * kernel's read-only-bind denial is classified as the sandbox refusal it is,
     * mirroring the command path's denial signatures.
     * @param {string} op - the failed op (`read` or `write`).
     * @param {AgentFsResult} result - the failed round trip's result.
     * @param {string} displayPath - the caller-facing path for the message.
     * @returns {FsCodedError} the structured failure.
     * @private
     */
    private fail;
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
    stat(linuxPath: string, { follow, signal }?: {
        follow?: boolean | undefined;
        signal?: AbortSignal | undefined;
    }): Promise<{
        type: string;
        mode: number;
        size: number;
        version: string;
    } | null>;
    /**
     * The distro-side identity of one path: the strict realpath, or on a missing
     * target the nearest existing ancestor with the missing suffix — the peer's
     * `resolveLocalTarget`, run where the symlinks live.
     * @param {string} linuxPath - the absolute Linux path to resolve.
     * @param {AbortSignal} [signal] - cancels the round trip.
     * @returns {Promise<string>} the canonical Linux path.
     */
    canonicalPath(linuxPath: string, signal?: AbortSignal): Promise<string>;
    /**
     * Resolve one Linux path to the target shape the provider and tooling use:
     * the Linux spelling the model sees and the UNC identity the harness keys on.
     * @param {string} linuxPath - the absolute Linux path to resolve.
     * @param {AbortSignal} [signal] - cancels the round trip.
     * @returns {Promise<{displayPath: string, targetKey: string}>}
     */
    resolveTarget(linuxPath: string, signal?: AbortSignal): Promise<{
        displayPath: string;
        targetKey: string;
    }>;
    /**
     * List one directory's direct children in name order — one `find -L` pass in
     * the distro, sorted and shaped host-side like the peer's `listDirectory`.
     * A symlink child's identity is resolved with one extra round trip, because
     * the follow-stat the list already carried belongs to its target.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved directory to list.
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
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved directory to list.
     * @param {AbortSignal} [signal] - aborts between children.
     * @returns {Promise<Array<{name: string, type: string, target: {displayPath: string, targetKey: string}, version?: string, size?: number}>>}
     */
    listChildren(target: import("./fs-substrate.js").ResolvedTarget, signal?: AbortSignal): Promise<Array<{
        name: string;
        type: string;
        target: {
            displayPath: string;
            targetKey: string;
        };
        version?: string;
        size?: number;
    }>>;
    /**
     * Stat the target as a regular file or refuse, mirroring the peer's
     * `statRegularFile` messages.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved file.
     * @param {string} verb - the operation name for the messages.
     * @param {AbortSignal|undefined} signal - the caller's cancellation.
     * @private
     */
    private statRegularFile;
    /**
     * Read the whole file's bytes through windowed frames.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved file.
     * @param {AbortSignal|undefined} signal - the caller's cancellation.
     * @param {number} [maxBytes] - inclusive byte cap on the complete content.
     * @private
     */
    private readWhole;
    /**
     * Read a whole regular UTF-8 file, rejecting binaries and invalid UTF-8.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved file.
     * @param {AbortSignal} [signal] - aborts the read.
     * @returns {Promise<string>} the full decoded text, byte-for-byte.
     */
    readWholeText(target: import("./fs-substrate.js").ResolvedTarget, signal?: AbortSignal): Promise<string>;
    /**
     * Read a whole regular file as raw bytes, bounded by `maxBytes`.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved file.
     * @param {AbortSignal|undefined} signal - aborts the read.
     * @param {number} maxBytes - inclusive byte cap on the complete content.
     * @returns {Promise<Uint8Array>} the full raw content, at most `maxBytes` long.
     */
    readWholeBytes(target: import("./fs-substrate.js").ResolvedTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /**
     * Read the bytes at `[offset, offset + length)` of a regular file. A window
     * at or past the end is empty.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved file.
     * @param {{offset: number, length: number}} range - the byte window.
     * @param {AbortSignal} [signal] - aborts the read.
     * @returns {Promise<Uint8Array>} the window's bytes.
     */
    readByteWindow(target: import("./fs-substrate.js").ResolvedTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    /**
     * Stream a whole regular UTF-8 file as decoded text chunks — the binary
     * sample scan and cross-chunk decoding stay host-side, exactly the peer's.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved file.
     * @param {AbortSignal} [signal] - aborts the stream.
     * @returns {AsyncGenerator<string>} decoded text chunks in file order.
     */
    streamWholeText(target: import("./fs-substrate.js").ResolvedTarget, signal?: AbortSignal): AsyncGenerator<string>;
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
     * @param {import("./agent.js").WslAgent} [options.agent] - the agent this mutation rides (the
     *   confined resident under a confined policy).
     * @returns {Promise<void>} resolves when the publish landed.
     */
    writeFileAtomic(linuxPath: string, content: string | Uint8Array, { mode, createIfAbsent, expectedVersion, signal, agent }?: {
        mode?: number | undefined;
        createIfAbsent?: {
            displayPath: string;
        } | undefined;
        expectedVersion?: string | undefined;
        signal?: AbortSignal | undefined;
        agent?: import("./agent.js").WslAgent | undefined;
    }): Promise<void>;
    /**
     * Read and decode a file for editing: LF-normalized content plus the style
     * to restore on write-back.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved file.
     * @param {AbortSignal} [signal] - aborts the read.
     * @returns {Promise<{content: string, lineEndings: "LF"|"CRLF"}>}
     */
    readForEdit(target: import("./fs-substrate.js").ResolvedTarget, signal?: AbortSignal): Promise<{
        content: string;
        lineEndings: "LF" | "CRLF";
    }>;
    /**
     * Best-effort overwrite diff basis: `null` whenever the file cannot serve
     * one (binary, at/above the bound, vanished), so the write still succeeds
     * and presentation falls back to a whole-file diff.
     * @param {import("./fs-substrate.js").ResolvedTarget} target - the resolved file.
     * @param {number} maxBytes - exclusive upper bound for the held basis.
     * @param {AbortSignal} [signal] - cancellation propagates, unlike I/O failure.
     * @returns {Promise<string|null>} the LF-normalized text, or null.
     */
    readTextForDiff(target: import("./fs-substrate.js").ResolvedTarget, maxBytes: number, signal?: AbortSignal): Promise<string | null>;
}
export default DistroFs;
/**
 * One agent FS round trip's result — the shape `WslAgent#fs` resolves to.
 */
export type AgentFsResult = {
    /**
     * - the op's exit status.
     */
    exitCode: number;
    /**
     * - the op's payload bytes.
     */
    stdout: Buffer;
    /**
     * - the op's diagnostic line(s).
     */
    stderr: Buffer;
};
import { applyLiteralEdit } from "./fsio-text.js";
import { normalizeLineEndings } from "./fsio-text.js";
import { restoreLineEndings } from "./fsio-text.js";
export { applyLiteralEdit, normalizeLineEndings, restoreLineEndings };
