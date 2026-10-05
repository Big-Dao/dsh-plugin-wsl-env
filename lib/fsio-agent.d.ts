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
 * This is a TypeScript source built to `lib/fsio-agent.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/fsio-agent
 */
import { normalizeLineEndings, restoreLineEndings, applyLiteralEdit } from "./fsio-text.js";
import type { WslAgent } from "./agent.js";
import type { ResolvedTarget } from "./fs-substrate.js";
/** One agent FS round trip's result — the shape `WslAgent#fs` resolves to. */
export interface AgentFsResult {
    /** The op's exit status. */
    exitCode: number;
    /** The op's payload bytes. */
    stdout: Buffer;
    /** The op's diagnostic line(s). */
    stderr: Buffer;
}
/**
 * Normalize one agent timestamp ("seconds.frac", 9 or 10 fractional digits
 * depending on whether stat or find produced it) into the peer's nanosecond
 * string: exactly nine fractional digits, no dot.
 *
 * @param value - the wire timestamp.
 * @returns seconds followed by nine fractional digits.
 */
export declare function nanoseconds(value: string): string;
/**
 * The peer's `versionOf`: dev, inode, size and both nanosecond timestamps.
 * Self-consistency within this provider is what versions need; the ingredients
 * come from one kernel, so a change in any byte of the file changes the string.
 *
 * @param ingredients - the stat record's identity fields.
 * @returns the opaque version string.
 */
export declare function versionOf({ dev, ino, size, mtimeNs, ctimeNs }: {
    dev: string;
    ino: string;
    size: string | number;
    mtimeNs: string;
    ctimeNs: string;
}): string;
/**
 * Parse one stat record as the agent emits it:
 * `type \t mode \t size \t dev \t ino \t mtime \t ctime`.
 *
 * @param stdout - the op's payload.
 * @returns the parsed row.
 */
export declare function parseStatRecord(stdout: Buffer): {
    type: string;
    mode: number;
    size: number;
    dev: string;
    ino: string;
    version: string;
};
/** One `find` listing row, as `listChildren` shapes it. */
export interface ChildRow {
    name: string;
    type: string;
    target: {
        displayPath: string;
        targetKey: string;
    };
    version?: string;
    size?: number;
}
/** The stat row `stat` returns. */
export interface StatRow {
    type: string;
    mode: number;
    size: number;
    version: string;
}
/**
 * One distro's filesystem face. Owns the agent round trips and the host-side
 * validation; the provider layers the fence on top.
 */
export declare class DistroFs {
    /** The resident in-distro agent. */
    agent: WslAgent;
    /** The pinned distro name, for UNC translation. */
    distro: string;
    /**
     * @param deps - the substrate's collaborators.
     */
    constructor({ agent, distro }: {
        /** The resident in-distro agent. */
        agent: WslAgent;
        /** The pinned distro name, for UNC translation. */
        distro: string;
    });
    /**
     * Run one FS op, mapping an aborted request onto the structured code the
     * provider's callers expect. A mutation may name the agent that must run it
     * — the confined resident whose mount table matches the granted rights —
     * while reads ride the plain resident.
     *
     * @param op - the FS op name (`stat`, `lstat`, `realpath`, `list`, `read`, `write`).
     * @param args - the op's arguments, one wire line each.
     * @param signal - the caller's cancellation.
     * @param agent - the agent that must run the op; the plain resident by default.
     * @returns the op's result.
     */
    private request;
    /**
     * Turn a failed op into the coded error, reading the agent's
     * `dsh-fs|<reason>|<b64 message>` line; a frame without one is a raw I/O
     * fault carrying whatever stderr the agent did produce. On a WRITE, the
     * kernel's read-only-bind denial is classified as the sandbox refusal it is,
     * mirroring the command path's denial signatures.
     *
     * @param op - the failed op (`read` or `write`).
     * @param result - the failed round trip's result.
     * @param displayPath - the caller-facing path for the message.
     * @returns the structured failure.
     */
    private fail;
    /**
     * Stat one Linux path, following or not. A missing path is `null`, exactly
     * like the peer's `probe`; everything else that is not found-class is a
     * structured failure.
     *
     * @param linuxPath - the path inside the distro.
     * @param options - the stat flavour.
     * @returns the stat row, or null when the path is absent.
     */
    stat(linuxPath: string, { follow, signal }?: {
        follow?: boolean;
        signal?: AbortSignal;
    }): Promise<StatRow | null>;
    /**
     * The distro-side identity of one path: the strict realpath, or on a missing
     * target the nearest existing ancestor with the missing suffix — the peer's
     * `resolveLocalTarget`, run where the symlinks live.
     *
     * @param linuxPath - the absolute Linux path to resolve.
     * @param signal - cancels the round trip.
     * @returns the canonical Linux path.
     */
    canonicalPath(linuxPath: string, signal?: AbortSignal): Promise<string>;
    /**
     * Resolve one Linux path to the target shape the provider and tooling use:
     * the Linux spelling the model sees and the UNC identity the harness keys on.
     *
     * @param linuxPath - the absolute Linux path to resolve.
     * @param signal - cancels the round trip.
     * @returns the resolved target.
     */
    resolveTarget(linuxPath: string, signal?: AbortSignal): Promise<{
        displayPath: string;
        targetKey: string;
    }>;
    /**
     * List one directory's direct children in name order — one `find` pass in
     * the distro, sorted and shaped host-side like the peer's `listDirectory`.
     * The wire type is the entry's own (lstat): a symlink child then gets one
     * follow-up stat (its target's version and size) plus a realpath (its
     * identity), and a dangling symlink degrades to the peer's `other` with no
     * version — exactly what the peer's null follow-probe produces.
     *
     * @param target - the resolved directory to list.
     * @param signal - aborts between children.
     * @returns the child rows, name-sorted.
     */
    listChildren(target: ResolvedTarget, signal?: AbortSignal): Promise<ChildRow[]>;
    /**
     * Stat the target as a regular file or refuse, mirroring the peer's
     * `statRegularFile` messages.
     *
     * @param target - the resolved file.
     * @param verb - the operation name for the messages.
     * @param signal - the caller's cancellation.
     * @returns the stat row of the regular file.
     */
    private statRegularFile;
    /**
     * Read the whole file's bytes through windowed frames.
     *
     * @param target - the resolved file.
     * @param signal - the caller's cancellation.
     * @param maxBytes - inclusive byte cap on the complete content.
     * @returns the file's bytes.
     */
    private readWhole;
    /**
     * Read a whole regular UTF-8 file, rejecting binaries and invalid UTF-8.
     *
     * @param target - the resolved file.
     * @param signal - aborts the read.
     * @returns the full decoded text, byte-for-byte.
     */
    readWholeText(target: ResolvedTarget, signal?: AbortSignal): Promise<string>;
    /**
     * Read a whole regular file as raw bytes, bounded by `maxBytes`.
     *
     * @param target - the resolved file.
     * @param signal - aborts the read.
     * @param maxBytes - inclusive byte cap on the complete content.
     * @returns the full raw content, at most `maxBytes` long.
     */
    readWholeBytes(target: ResolvedTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /**
     * Read the bytes at `[offset, offset + length)` of a regular file. A window
     * at or past the end is empty.
     *
     * @param target - the resolved file.
     * @param range - the byte window.
     * @param signal - aborts the read.
     * @returns the window's bytes.
     */
    readByteWindow(target: ResolvedTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    /**
     * Stream a whole regular UTF-8 file as decoded text chunks — the binary
     * sample scan and cross-chunk decoding stay host-side, exactly the peer's.
     *
     * @param target - the resolved file.
     * @param signal - aborts the stream.
     * @returns decoded text chunks in file order.
     */
    streamWholeText(target: ResolvedTarget, signal?: AbortSignal): AsyncGenerator<string>;
    /**
     * Publish `content` over `linuxPath` the POSIX way: the agent stages into a
     * private 0700 sibling, fsyncs, chmods, and renames — or hard links for a
     * guarded create. A `replace` publish carrying `expectedVersion` is
     * re-verified by the agent against a fresh stat one syscall before the
     * rename: a concurrent writer (an editor save, a `git stash`) wins, and the
     * stale write refuses with `FS_STALE_VERSION` instead of landing.
     *
     * @param linuxPath - the target path inside the distro.
     * @param content - the full new content.
     * @param options - the publish options.
     * @returns resolves when the publish landed.
     */
    writeFileAtomic(linuxPath: string, content: string | Uint8Array, { mode, createIfAbsent, expectedVersion, signal, agent }?: {
        /**
         * The mode to publish (omitted keeps the temp's 0600 for a create; the
         * caller passes the incumbent's for an edit).
         */
        mode?: number;
        /**
         * Guarded-create intent: publish with a no-replace link carrying this
         * display path in errors.
         */
        createIfAbsent?: {
            displayPath: string;
        };
        /**
         * The version string this write was based on (a stat-derived one);
         * re-verified distro-side before the rename.
         */
        expectedVersion?: string;
        /** Aborts the write. */
        signal?: AbortSignal;
        /**
         * The agent this mutation rides (the confined resident under a confined
         * policy).
         */
        agent?: WslAgent;
    }): Promise<void>;
    /**
     * Read and decode a file for editing: LF-normalized content plus the style
     * to restore on write-back.
     *
     * @param target - the resolved file.
     * @param signal - aborts the read.
     * @returns the LF-normalized content and its line-ending style.
     */
    readForEdit(target: ResolvedTarget, signal?: AbortSignal): Promise<{
        content: string;
        lineEndings: "LF" | "CRLF";
    }>;
    /**
     * Best-effort overwrite diff basis: `null` whenever the file cannot serve
     * one (binary, at/above the bound, vanished), so the write still succeeds
     * and presentation falls back to a whole-file diff.
     *
     * @param target - the resolved file.
     * @param maxBytes - exclusive upper bound for the held basis.
     * @param signal - cancellation propagates, unlike I/O failure.
     * @returns the LF-normalized text, or null.
     */
    readTextForDiff(target: ResolvedTarget, maxBytes: number, signal?: AbortSignal): Promise<string | null>;
}
export { applyLiteralEdit, normalizeLineEndings, restoreLineEndings };
export default DistroFs;
