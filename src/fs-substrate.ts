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

import { applyLiteralEdit, FsCodedError, normalizeLineEndings, restoreLineEndings } from "./fsio-text.js";
import { DistroFs } from "./fsio-agent.js";
import { posixToUnc, uncToPosix } from "./paths.js";
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
 * The lib-side `WslAgent` declaration. `lib/fsio-agent.d.ts` is generated from
 * the still-un-migrated `fsio-agent.js`, and its `agent` parameter references
 * the lib-side declaration of the class; a class with private members is
 * nominal, so `src/agent.ts`'s declaration is not assignable to it even though
 * the runtime object is the very same class. This alias names the lib-side
 * type so the boundary needs one documented assertion instead of scattering
 * them — it disappears once `fsio-agent` migrates.
 */
type LibWslAgent = ConstructorParameters<typeof DistroFs>[0]["agent"];

/**
 * Cross the dual-declaration seam (see {@link LibWslAgent}).
 *
 * @param agent - the resident, as this module's declaration types it.
 * @returns the same object, as the un-migrated modules declare it.
 */
const asLibAgent = (agent: WslAgent): LibWslAgent => agent as unknown as LibWslAgent;

/**
 * The provider's stat/lstat row, type-spelled the way the tool layer reads it.
 *
 * @param info - the distro stat row.
 * @returns the provider-shaped row.
 */
function toInfo({ version, type, size }: { version: string, type: string, size: number }): { version: string, type: string, size: number } {
  return {
    version,
    type: type === "f" ? "file" : type === "d" ? "directory" : type === "l" ? "symlink" : "other",
    size,
  };
}

/**
 * One distro's provider-shaped filesystem face.
 */
export class AgentSubstrate {
  /** The pinned distro name, for UNC identity. */
  declare distro: string;
  /** The overwrite-diff bound, mirroring the provider config. */
  declare diffBasisMaxBytes: number;
  /** The resident in-distro agent reads ride. */
  declare agent: WslAgent;
  /** Stage-two routing: the agent a mutation must run on for the resolved policy, when wired. */
  declare agentFor: ((policy: { mode: string, workspaceRoot: string } | undefined) => Promise<WslAgent>) | undefined;
  /** The distro-side filesystem face. */
  declare fs: DistroFs;
  /** Per-targetKey tail promise: the host backend's mutation serialization. */
  declare locks: Map<string, Promise<void>>;

  /**
   * @param deps - the substrate's collaborators.
   */
  constructor({ agent, agentFor, distro, diffBasisMaxBytes = 10 * 1024 * 1024 }: {
    /** The resident in-distro agent reads ride. */
    agent: WslAgent,
    /** The pinned distro name, for UNC identity. */
    distro: string,
    /** The overwrite-diff bound, mirroring the provider config. */
    diffBasisMaxBytes?: number,
    /**
     * Stage-two routing: the agent a MUTATION must run on for this resolved
     * policy — the confined resident whose mount table matches the granted
     * rights. Omitted (or resolving to `deps.agent`) keeps every op on the
     * plain resident, which is stage one's posture.
     */
    agentFor?: (policy: { mode: string, workspaceRoot: string } | undefined) => Promise<WslAgent>,
  }) {
    this.distro = distro;
    this.diffBasisMaxBytes = diffBasisMaxBytes;
    this.agent = agent;
    this.agentFor = agentFor;
    this.fs = new DistroFs({ agent: asLibAgent(agent), distro });
    this.locks = new Map();
  }

  /**
   * The agent a mutation runs on under this resolved policy.
   *
   * @param policy - the resolved file-effect policy, or undefined when the
   *   caller pre-checked.
   * @returns the agent to publish through.
   */
  async mutationAgent(policy: { mode: string, workspaceRoot: string } | undefined): Promise<WslAgent> {
    if (this.agentFor === undefined) return this.agent;
    return this.agentFor(policy);
  }

  /**
   * Run `op` with exclusive access to `targetKey` (FIFO per key).
   *
   * @template T
   * @param targetKey - the mutation's serialization key.
   * @param op - the exclusive section.
   * @returns the section's outcome.
   */
  async lock<T>(targetKey: string, op: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(targetKey) ?? Promise.resolve()).then(op, op);
    const tail = run.then(() => undefined, () => undefined);
    this.locks.set(targetKey, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(targetKey) === tail) this.locks.delete(targetKey);
    }
  }

  /**
   * The Linux path a resolved target names, falling back to its display.
   *
   * @param target - the resolved target.
   * @returns the Linux path to operate on.
   */
  linuxOf(target: ResolvedTarget): string {
    return uncToPosix(target.targetKey)?.linuxPath ?? target.displayPath;
  }

  /**
   * Resolve one absolute Linux path to the target shape the provider returns:
   * the canonical Linux spelling the model sees and the UNC identity the
   * harness keys on. Symlinks resolve here, where they live.
   *
   * @param linuxPath - the absolute Linux path to resolve.
   * @param signal - cancels the round trip.
   */
  async resolve(linuxPath: string, signal?: AbortSignal): Promise<{ displayPath: string, targetKey: string }> {
    const canonical = await this.fs.canonicalPath(linuxPath, signal);
    return { displayPath: canonical, targetKey: posixToUnc(this.distro, canonical) };
  }

  /**
   * Follow-stat one target; `undefined` when absent.
   *
   * @param target - the resolved target.
   * @param signal - cancels the round trip.
   */
  async stat(target: ResolvedTarget, signal?: AbortSignal): Promise<{ version: string, type: string, size: number } | undefined> {
    const info = await this.fs.stat(this.linuxOf(target), { signal });
    return info === null ? undefined : toInfo(info);
  }

  /**
   * No-follow stat one path; `undefined` when absent, `symlink` for a link.
   *
   * @param linuxPath - the absolute Linux path to inspect.
   * @param signal - cancels the round trip.
   */
  async lstat(linuxPath: string, signal?: AbortSignal): Promise<{ version: string, type: string, size: number } | undefined> {
    if (String(linuxPath).trim().length === 0) {
      throw new FsCodedError("file_path must be a non-empty string", "FS_NOT_FOUND");
    }
    const info = await this.fs.stat(linuxPath, { follow: false, signal });
    return info === null ? undefined : toInfo(info);
  }

  /**
   * Read a whole regular UTF-8 file.
   *
   * @param target - the resolved target.
   * @param signal - aborts the read.
   * @returns the full decoded text.
   */
  async readText(target: ResolvedTarget, signal?: AbortSignal): Promise<string> {
    return this.fs.readWholeText(target, signal);
  }

  /**
   * Stream a whole regular UTF-8 file as decoded chunks.
   *
   * @param target - the resolved target.
   * @param signal - aborts the stream.
   * @returns the chunk stream.
   */
  async streamText(target: ResolvedTarget, signal?: AbortSignal): Promise<AsyncGenerator<string>> {
    return this.fs.streamWholeText(target, signal);
  }

  /**
   * Read a whole regular file as raw bytes, bounded.
   *
   * @param target - the resolved target.
   * @param signal - aborts the read.
   * @param maxBytes - inclusive byte cap.
   * @returns the bytes.
   */
  async readBytes(target: ResolvedTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    return this.fs.readWholeBytes(target, signal, maxBytes);
  }

  /**
   * Read one byte window of a regular file.
   *
   * @param target - the resolved target.
   * @param range - the window.
   * @param signal - aborts the read.
   * @returns the window's bytes.
   */
  async readByteRange(target: ResolvedTarget, range: { offset: number, length: number }, signal?: AbortSignal): Promise<Uint8Array> {
    return this.fs.readByteWindow(target, range, signal);
  }

  /**
   * List one directory's direct children.
   *
   * @param target - the resolved directory.
   * @param signal - aborts between children.
   */
  async listDir(target: ResolvedTarget, signal?: AbortSignal): Promise<Array<{ name: string, type: string, target: { displayPath: string, targetKey: string }, version?: string, size?: number }>> {
    return this.fs.listChildren(target, signal);
  }

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
  async writeText(target: ResolvedTarget, content: string, expected: { kind: string, version?: string } | undefined, signal?: AbortSignal, policy?: { mode: string, workspaceRoot: string } | undefined): Promise<{ operation: string, version: string, before: string | null, after: string }> {
    const mutationAgent = await this.mutationAgent(policy);
    return this.lock(target.targetKey, async () => {
      const linuxPath = this.linuxOf(target);
      const existing = await this.fs.stat(linuxPath, { signal });
      if (existing && existing.type !== "f") {
        throw new FsCodedError(`cannot write "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
      }
      if (expected?.kind === "replaceIfVersion") {
        if (!existing) throw new FsCodedError(`cannot write "${target.displayPath}": file no longer exists`, "FS_STALE_VERSION");
        if (existing.version !== expected.version) {
          throw new FsCodedError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
        }
      } else if (expected?.kind === "createIfAbsent" && existing) {
        throw new FsCodedError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
      }
      const before =
        existing !== null && Buffer.byteLength(content, "utf8") < this.diffBasisMaxBytes
          ? await this.fs.readTextForDiff(target, this.diffBasisMaxBytes, signal)
          : null;
      await this.fs.writeFileAtomic(linuxPath, content, {
        mode: existing?.mode,
        createIfAbsent: expected?.kind === "createIfAbsent" ? { displayPath: target.displayPath } : undefined,
        expectedVersion: expected?.kind === "replaceIfVersion" ? expected.version : undefined,
        signal,
        agent: asLibAgent(mutationAgent),
      });
      const after = await this.fs.stat(linuxPath, { signal });
      return {
        operation: existing ? "update" : "create",
        version: after ? after.version : `missing:${target.targetKey}`,
        before,
        after: normalizeLineEndings(content),
      };
    });
  }

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
  async editText(target: ResolvedTarget, edit: { oldString: string, newString: string, replaceAll?: boolean }, expected: { version: string } | undefined, signal?: AbortSignal, policy?: { mode: string, workspaceRoot: string } | undefined): Promise<{ version: string, before: string, after: string }> {
    const mutationAgent = await this.mutationAgent(policy);
    return this.lock(target.targetKey, async () => {
      const linuxPath = this.linuxOf(target);
      const existing = await this.fs.stat(linuxPath, { signal });
      if (!existing) {
        // A file that is not there NOW splits by evidence: an edit grounded
        // in a read (it carries the expected version) lost its file, so the
        // guard is stale; an edit with no read behind it names a file that
        // never answered the stat - the read path's missing-file dialect.
        if (expected) {
          throw new FsCodedError(`cannot edit "${target.displayPath}": file no longer exists`, "FS_STALE_VERSION");
        }
        throw new FsCodedError(`cannot edit "${target.displayPath}": file does not exist`, "FS_NOT_FOUND");
      }
      if (existing.type !== "f") {
        throw new FsCodedError(`cannot edit "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
      }
      if (expected && existing.version !== expected.version) {
        throw new FsCodedError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
      }
      const original = await this.fs.readForEdit(target, signal);
      const edited = applyLiteralEdit(original.content, edit.oldString, edit.newString, edit.replaceAll, target.displayPath);
      const content = restoreLineEndings(edited.content, original.lineEndings);
      await this.fs.writeFileAtomic(linuxPath, content, { mode: existing.mode, expectedVersion: existing.version, signal, agent: asLibAgent(mutationAgent) });
      const after = await this.fs.stat(linuxPath, { signal });
      return {
        version: after ? after.version : `missing:${target.targetKey}`,
        before: original.content,
        after: edited.content,
      };
    });
  }
}

export default AgentSubstrate;
