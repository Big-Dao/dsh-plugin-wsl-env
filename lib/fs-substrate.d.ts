/**
 * One distro's provider-shaped filesystem face.
 */
export class AgentSubstrate {
    /**
     * @param {object} deps - the substrate's collaborators.
     * @param {import("./agent.js").WslAgent} deps.agent - the resident in-distro agent reads ride.
     * @param {string} deps.distro - the pinned distro name, for UNC identity.
     * @param {number} [deps.diffBasisMaxBytes] - the overwrite-diff bound, mirroring the provider config.
     * @param {(policy: {mode: string, workspaceRoot: string}|undefined) => Promise<import("./agent.js").WslAgent>} [deps.agentFor]
     *   stage-two routing: the agent a MUTATION must run on for this resolved
     *   policy — the confined resident whose mount table matches the granted
     *   rights. Omitted (or resolving to `deps.agent`) keeps every op on the
     *   plain resident, which is stage one's posture.
     */
    constructor({ agent, agentFor, distro, diffBasisMaxBytes }: {
        agent: import("./agent.js").WslAgent;
        distro: string;
        diffBasisMaxBytes?: number | undefined;
        agentFor?: ((policy: {
            mode: string;
            workspaceRoot: string;
        } | undefined) => Promise<import("./agent.js").WslAgent>) | undefined;
    });
    distro: string;
    diffBasisMaxBytes: number;
    agent: import("./agent.js").WslAgent;
    agentFor: ((policy: {
        mode: string;
        workspaceRoot: string;
    } | undefined) => Promise<import("./agent.js").WslAgent>) | undefined;
    fs: DistroFs;
    /** Per-targetKey tail promise: the host backend's mutation serialization. */
    locks: Map<any, any>;
    /**
     * The agent a mutation runs on under this resolved policy.
     * @param {{mode: string, workspaceRoot: string}|undefined} policy - the
     *   resolved file-effect policy, or undefined when the caller pre-checked.
     * @returns {Promise<import("./agent.js").WslAgent>} the agent to publish through.
     */
    mutationAgent(policy: {
        mode: string;
        workspaceRoot: string;
    } | undefined): Promise<import("./agent.js").WslAgent>;
    /**
     * Run `op` with exclusive access to `targetKey` (FIFO per key).
     * @template T
     * @param {string} targetKey - the mutation's serialization key.
     * @param {() => Promise<T>} op - the exclusive section.
     * @returns {Promise<T>} the section's outcome.
     */
    lock<T>(targetKey: string, op: () => Promise<T>): Promise<T>;
    /**
     * The Linux path a resolved target names, falling back to its display.
     * @param {ResolvedTarget} target - the resolved target.
     * @returns {string} the Linux path to operate on.
     */
    linuxOf(target: ResolvedTarget): string;
    /**
     * Resolve one absolute Linux path to the target shape the provider returns:
     * the canonical Linux spelling the model sees and the UNC identity the
     * harness keys on. Symlinks resolve here, where they live.
     * @param {string} linuxPath - the absolute Linux path to resolve.
     * @param {AbortSignal} [signal] - cancels the round trip.
     * @returns {Promise<{displayPath: string, targetKey: string}>}
     */
    resolve(linuxPath: string, signal?: AbortSignal): Promise<{
        displayPath: string;
        targetKey: string;
    }>;
    /**
     * Follow-stat one target; `undefined` when absent.
     * @param {ResolvedTarget} target - the resolved target.
     * @param {AbortSignal} [signal] - cancels the round trip.
     * @returns {Promise<{version: string, type: string, size: number}|undefined>}
     */
    stat(target: ResolvedTarget, signal?: AbortSignal): Promise<{
        version: string;
        type: string;
        size: number;
    } | undefined>;
    /**
     * No-follow stat one path; `undefined` when absent, `symlink` for a link.
     * @param {string} linuxPath - the absolute Linux path to inspect.
     * @param {AbortSignal} [signal] - cancels the round trip.
     * @returns {Promise<{version: string, type: string, size: number}|undefined>}
     */
    lstat(linuxPath: string, signal?: AbortSignal): Promise<{
        version: string;
        type: string;
        size: number;
    } | undefined>;
    /**
     * Read a whole regular UTF-8 file.
     * @param {ResolvedTarget} target - the resolved target.
     * @param {AbortSignal} [signal] - aborts the read.
     * @returns {Promise<string>} the full decoded text.
     */
    readText(target: ResolvedTarget, signal?: AbortSignal): Promise<string>;
    /**
     * Stream a whole regular UTF-8 file as decoded chunks.
     * @param {ResolvedTarget} target - the resolved target.
     * @param {AbortSignal} [signal] - aborts the stream.
     * @returns {Promise<AsyncGenerator<string>>} the chunk stream.
     */
    streamText(target: ResolvedTarget, signal?: AbortSignal): Promise<AsyncGenerator<string>>;
    /**
     * Read a whole regular file as raw bytes, bounded.
     * @param {ResolvedTarget} target - the resolved target.
     * @param {AbortSignal|undefined} signal - aborts the read.
     * @param {number} maxBytes - inclusive byte cap.
     * @returns {Promise<Uint8Array>} the bytes.
     */
    readBytes(target: ResolvedTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /**
     * Read one byte window of a regular file.
     * @param {ResolvedTarget} target - the resolved target.
     * @param {{offset: number, length: number}} range - the window.
     * @param {AbortSignal} [signal] - aborts the read.
     * @returns {Promise<Uint8Array>} the window's bytes.
     */
    readByteRange(target: ResolvedTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    /**
     * List one directory's direct children.
     * @param {ResolvedTarget} target - the resolved directory.
     * @param {AbortSignal} [signal] - aborts between children.
     * @returns {Promise<Array<{name: string, type: string, target: {displayPath: string, targetKey: string}, version?: string, size?: number}>>}
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
     * @param {ResolvedTarget} target - the resolved target.
     * @param {string} content - the full new file content.
     * @param {{kind: string, version?: string}|undefined} expected - the write intent.
     * @param {AbortSignal} [signal] - cancels the write.
     * @param {{mode: string, workspaceRoot: string}|undefined} [policy] - the
     *   resolved policy this write was fenced with; selects the confined
     *   resident when stage-two routing is wired.
     * @returns {Promise<{operation: string, version: string, before: string|null, after: string}>}
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
     * @param {ResolvedTarget} target - the resolved target.
     * @param {{oldString: string, newString: string, replaceAll?: boolean}} edit - the literal request.
     * @param {{version: string}|undefined} expected - the version guard.
     * @param {AbortSignal} [signal] - cancels the edit.
     * @param {{mode: string, workspaceRoot: string}|undefined} [policy] - the
     *   resolved policy this edit was fenced with; selects the confined
     *   resident when stage-two routing is wired.
     * @returns {Promise<{version: string, before: string, after: string}>}
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
/**
 * A resolved target: the Linux spelling the model sees and the UNC identity
 * the harness keys on, as returned by {@linkcode AgentSubstrate#resolve}.
 */
export type ResolvedTarget = {
    /**
     * - the canonical Linux path spelling.
     */
    displayPath: string;
    /**
     * - the UNC identity this target keys on.
     */
    targetKey: string;
};
import { DistroFs } from "./fsio-agent.js";
