/**
 * The agent-backed filesystem substrate: the provider-shaped operations the
 * model's file tools call, orchestrated over the distro's FS frames.
 *
 * This is the `ctx.fs` seam's mechanics for `substrate: "agent"` — resolve,
 * stat, reads, and the write/edit orchestration the host backend owns on a
 * share-backed session (probe, guards, diff basis, publication, outcome
 * shape), mirroring `@deepseek-ai/dsh-fs-local`'s `writeText` and `editText`
 * byte-for-byte in message and code. Two deliberate differences from the share
 * backend it replaces:
 *
 * 1. **The mutation guard survives to the write — per intent.** A guarded
 *    create publishes with the distro-side no-replace link, a real atomic
 *    primitive that refuses to replace. An overwrite or edit carries the
 *    version it was based on INTO the write op, and the agent re-verifies it
 *    with a fresh stat one syscall before the rename: a concurrent writer
 *    (an editor save, `git stash`, another session) wins, and the stale
 *    write refuses with `FS_STALE_VERSION` instead of clobbering. That
 *    narrows the share backend's check-then-write window from a host round
 *    trip to kernel-adjacent — the honest wording; "closed" was true only
 *    for the create case.
 * 2. A symlink needs no retry machinery: every identity is resolved where the
 *    symlinks live.
 *
 * Peer-free by construction: refusals are `FsCodedError`s from
 * `lib/fsio-text.js`, mapped onto the peer's `FsError` at the provider
 * boundary, so this module is unit-testable in a bare checkout against the
 * real agent script.
 *
 * This is a TypeScript source built to `lib/fs-substrate.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/fs-substrate
 */
import { DistroFs } from "./fsio-agent.js";
import type { WslAgent } from "./agent.js";
/**
 * A resolved target: the Linux spelling the model sees and the UNC identity
 * the harness keys on, as returned by {@linkcode AgentSubstrate#resolve}.
 */
export interface ResolvedTarget {
    /** The canonical Linux path spelling. */
    displayPath: string;
    /** The UNC identity this target keys on. */
    targetKey: string;
}
/**
 * One distro's provider-shaped filesystem face.
 */
export declare class AgentSubstrate {
    /** The pinned distro name, for UNC identity. */
    distro: string;
    /** The overwrite-diff bound, mirroring the provider config. */
    diffBasisMaxBytes: number;
    /** The resident in-distro agent reads ride. */
    agent: WslAgent;
    /** Stage-two routing: the agent a mutation must run on for the resolved policy, when wired. */
    agentFor: ((policy: {
        mode: string;
        workspaceRoot: string;
    } | undefined) => Promise<WslAgent>) | undefined;
    /** The distro-side filesystem face. */
    fs: DistroFs;
    /** Per-targetKey tail promise: the host backend's mutation serialization. */
    locks: Map<string, Promise<void>>;
    /**
     * @param deps - the substrate's collaborators.
     */
    constructor({ agent, agentFor, distro, diffBasisMaxBytes }: {
        /** The resident in-distro agent reads ride. */
        agent: WslAgent;
        /** The pinned distro name, for UNC identity. */
        distro: string;
        /** The overwrite-diff bound, mirroring the provider config. */
        diffBasisMaxBytes?: number;
        /**
         * Stage-two routing: the agent a MUTATION must run on for this resolved
         * policy — the confined resident whose mount table matches the granted
         * rights. Omitted (or resolving to `deps.agent`) keeps every op on the
         * plain resident, which is stage one's posture.
         */
        agentFor?: (policy: {
            mode: string;
            workspaceRoot: string;
        } | undefined) => Promise<WslAgent>;
    });
    /**
     * The agent a mutation runs on under this resolved policy.
     *
     * @param policy - the resolved file-effect policy, or undefined when the
     *   caller pre-checked.
     * @returns the agent to publish through.
     */
    mutationAgent(policy: {
        mode: string;
        workspaceRoot: string;
    } | undefined): Promise<WslAgent>;
    /**
     * Run `op` with exclusive access to `targetKey` (FIFO per key).
     *
     * @template T
     * @param targetKey - the mutation's serialization key.
     * @param op - the exclusive section.
     * @returns the section's outcome.
     */
    lock<T>(targetKey: string, op: () => Promise<T>): Promise<T>;
    /**
     * The Linux path a resolved target names, falling back to its display.
     *
     * @param target - the resolved target.
     * @returns the Linux path to operate on.
     */
    linuxOf(target: ResolvedTarget): string;
    /**
     * Resolve one absolute Linux path to the target shape the provider returns:
     * the canonical Linux spelling the model sees and the UNC identity the
     * harness keys on. Symlinks resolve here, where they live.
     *
     * @param linuxPath - the absolute Linux path to resolve.
     * @param signal - cancels the round trip.
     */
    resolve(linuxPath: string, signal?: AbortSignal): Promise<{
        displayPath: string;
        targetKey: string;
    }>;
    /**
     * Follow-stat one target; `undefined` when absent.
     *
     * @param target - the resolved target.
     * @param signal - cancels the round trip.
     */
    stat(target: ResolvedTarget, signal?: AbortSignal): Promise<{
        version: string;
        type: string;
        size: number;
    } | undefined>;
    /**
     * No-follow stat one path; `undefined` when absent, `symlink` for a link.
     *
     * @param linuxPath - the absolute Linux path to inspect.
     * @param signal - cancels the round trip.
     */
    lstat(linuxPath: string, signal?: AbortSignal): Promise<{
        version: string;
        type: string;
        size: number;
    } | undefined>;
    /**
     * Read a whole regular UTF-8 file.
     *
     * @param target - the resolved target.
     * @param signal - aborts the read.
     * @returns the full decoded text.
     */
    readText(target: ResolvedTarget, signal?: AbortSignal): Promise<string>;
    /**
     * Stream a whole regular UTF-8 file as decoded chunks.
     *
     * @param target - the resolved target.
     * @param signal - aborts the stream.
     * @returns the chunk stream.
     */
    streamText(target: ResolvedTarget, signal?: AbortSignal): Promise<AsyncGenerator<string>>;
    /**
     * Read a whole regular file as raw bytes, bounded.
     *
     * @param target - the resolved target.
     * @param signal - aborts the read.
     * @param maxBytes - inclusive byte cap.
     * @returns the bytes.
     */
    readBytes(target: ResolvedTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /**
     * Read one byte window of a regular file.
     *
     * @param target - the resolved target.
     * @param range - the window.
     * @param signal - aborts the read.
     * @returns the window's bytes.
     */
    readByteRange(target: ResolvedTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    /**
     * List one directory's direct children.
     *
     * @param target - the resolved directory.
     * @param signal - aborts between children.
     */
    listDir(target: ResolvedTarget, signal?: AbortSignal): Promise<Array<{
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
     * Write a whole text file with the host backend's orchestration: probe,
     * guard, best-effort diff basis, atomic publication, outcome shape. The
     * guard is FORWARDED — a guarded create publishes with the distro-side
     * no-replace link (atomic), and a `replaceIfVersion` write carries its
     * version into the op, where the agent re-verifies it one syscall before
     * the rename and refuses with `FS_STALE_VERSION` on a mismatch.
     *
     * @param target - the resolved target.
     * @param content - the full new file content.
     * @param expected - the write intent.
     * @param signal - cancels the write.
     * @param policy - the resolved policy this write was fenced with; selects
     *   the confined resident when stage-two routing is wired.
     */
    writeText(target: ResolvedTarget, content: string, expected: {
        kind: string;
        version?: string;
    } | undefined, signal?: AbortSignal, policy?: {
        mode: string;
        workspaceRoot: string;
    } | undefined): Promise<{
        operation: string;
        version: string;
        before: string | null;
        after: string;
    }>;
    /**
     * Edit a text file with the host backend's orchestration: probe, version
     * guard, LF-normalized read, literal replacement, line-ending restore,
     * atomic publication, outcome shape. The version the edit was based on
     * rides the write op and is re-verified distro-side one syscall before the
     * rename, so a concurrent writer wins instead of being clobbered.
     *
     * @param target - the resolved target.
     * @param edit - the literal request.
     * @param expected - the version guard.
     * @param signal - cancels the edit.
     * @param policy - the resolved policy this edit was fenced with; selects
     *   the confined resident when stage-two routing is wired.
     */
    editText(target: ResolvedTarget, edit: {
        oldString: string;
        newString: string;
        replaceAll?: boolean;
    }, expected: {
        version: string;
    } | undefined, signal?: AbortSignal, policy?: {
        mode: string;
        workspaceRoot: string;
    } | undefined): Promise<{
        version: string;
        before: string;
        after: string;
    }>;
}
export default AgentSubstrate;
