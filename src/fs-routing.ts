/**
 * The root-plane filesystem with coordinate routing: targets under a
 * `\\wsl.localhost\<distro>` identity are served by the distro substrate
 * (the resident agent, on ext4); every other target — drive-letter paths,
 * the deployment cwd — is served by the host `LocalFileSystem` this class
 * extends, unchanged.
 *
 * ## Why a router, and why here
 *
 * The root `ctx.fs` is session-less: it cannot be switched per session the
 * way a preset's isolated `fs` can, so the two workspace kinds share one
 * backend — and the stock backend serves the distro workspace across the 9p
 * share, in its slow direction, with no usable change notifications. Routing
 * by coordinate makes every root consumer (the workspace-files change feed
 * among them) correct on both workspace kinds without per-consumer patches.
 *
 * The design note is `docs/root-fs-routing.md` (the operation routing table,
 * the intended behavior differences, and the dormant-root-fence rationale).
 *
 * ## What is intentionally not here
 *
 * No write fence: the root plane has no write consumers (the model's writes
 * ride the per-session preset filesystems, which enforce their own
 * containment — the distro side kernel-enforced). If a root-plane write
 * consumer appears, its fence rides with that consumer.
 *
 * This is a TypeScript source built to `lib/fs-routing.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/fs-routing
 */

import { isWslUnc, uncToPosix } from "./paths.js";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { WslFileSystem } from "./index.js";
import type { Context } from "@deepseek-ai/cordis";
import type { FsTarget, FsVersion, FsWriteIntent, FsEditRequest } from "@deepseek-ai/dsh-fs";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";

/**
 * The router's config: the host backend's own knobs plus the distro knobs the
 * routed backend reads. The distro keys are `??`-defaulted, so a host-only
 * config stays valid.
 */
export interface RoutingConfig {
  /** The host backend's base directory. */
  cwd?: string;
  /** The host backend's overwrite-diff byte bound. */
  diffBasisMaxBytes?: number;
  /** The pinned distro for routed targets; empty resolves WSL's default. */
  distro?: string;
  /** The `wsl.exe` path, used only to resolve the default distro. */
  wslPath?: string;
  /** The routed backend's default workdir. */
  distroCwd?: string;
  /** Whether the routed backend fences mutations by `ctx.sandboxPolicy`. */
  sandbox?: boolean;
  /** Whether confined profiles shadow `/mnt`. */
  maskWindowsDrive?: boolean;
  /** Whether the routed backend refuses paths outside the distro. */
  restrictToDistro?: boolean;
  /** How deep the in-distro watch scan walks. */
  watchMaxDepth?: number;
}

/**
 * Whether a resolved target identity belongs to the distro.
 *
 * @param targetKey - the target's identity (a UNC for distro paths).
 * @returns true when the target lives inside a WSL distro.
 */
export function targetIsDistro(targetKey: string): boolean {
  return isWslUnc(targetKey);
}

/**
 * Whether a raw path-or-cwd input names the distro (used by the operations
 * that take paths before a target exists: resolve, lstat).
 *
 * @param value - a path in any coordinate system, or undefined.
 * @returns true when the input names a distro UNC.
 */
export function inputIsDistro(value: string | undefined): boolean {
  return value !== undefined && isWslUnc(value);
}

/**
 * The root-plane filesystem with coordinate routing.
 *
 * The distro backend is built lazily on the first routed target, sharing this
 * context (the root `sandboxPolicy` service provides the deployment default
 * mode the distro side reports through `sandboxMode`).
 */
export class WslRoutingFileSystem extends LocalFileSystem {
  static Config = LocalFileSystem.Config;

  /**
   * The lazy distro backend, built on first routed use. Typed as the concrete
   * class: the peer `FileSystem` interface would need a cast here, because the
   * distro class's `processPathFromHostPath` is async against the interface's
   * synchronous contract — the upstream seam gap `lib/index.js` keeps visible
   * with its own expect-error, and `docs/root-fs-routing.md` records the
   * routing consequences.
   */
  #distro: WslFileSystem | undefined;
  /** The distro knobs, verbatim from the row config. */
  #distroConfig: { distro: string, wslPath: string, cwd: string, diffBasisMaxBytes: number | undefined, sandbox: boolean, maskWindowsDrive: boolean, restrictToDistro: boolean, watchMaxDepth: number };

  /**
   * @param ctx - the cordis context.
   * @param config - the row config, host knobs plus distro knobs.
   */
  constructor(ctx: Context, config: RoutingConfig) {
    super(ctx, config);
    this.#distroConfig = {
      distro: config.distro ?? "",
      wslPath: config.wslPath ?? "wsl.exe",
      cwd: config.distroCwd ?? "",
      diffBasisMaxBytes: config.diffBasisMaxBytes,
      sandbox: config.sandbox ?? true,
      maskWindowsDrive: config.maskWindowsDrive ?? false,
      restrictToDistro: config.restrictToDistro ?? true,
      watchMaxDepth: config.watchMaxDepth ?? 0,
    };
  }

  /** The distro backend for routed targets, built on first use. */
  distro(): WslFileSystem {
    return (this.#distro ??= new WslFileSystem(this.ctx, this.#distroConfig));
  }

  /**
   * @param path - the requested path.
   * @param opts - the resolve options.
   */
  async resolve(path: string, opts?: { cwd?: string, signal?: AbortSignal }) {
    if (inputIsDistro(path) || inputIsDistro(opts?.cwd)) return (await this.distro()).resolve(path, opts);
    return super.resolve(path, opts);
  }

  /**
   * @param path - the requested path.
   * @param opts - the lstat options.
   * @param signal - cancels the round trip.
   */
  async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal) {
    if (inputIsDistro(path) || inputIsDistro(opts?.cwd)) return (await this.distro()).lstat(path, opts, signal);
    return super.lstat(path, opts, signal);
  }

  /**
   * @param target - the resolved target.
   * @param signal - cancels the round trip.
   */
  async stat(target: FsTarget, signal?: AbortSignal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).stat(target, signal);
    return super.stat(target, signal);
  }

  /**
   * @param target - the resolved target.
   * @param signal - cancels the round trip.
   */
  async readText(target: FsTarget, signal?: AbortSignal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readText(target, signal);
    return super.readText(target, signal);
  }

  /**
   * @param target - the resolved target.
   * @param signal - cancels the stream.
   */
  async streamText(target: FsTarget, signal?: AbortSignal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).streamText(target, signal);
    return super.streamText(target, signal);
  }

  /**
   * @param target - the resolved target.
   * @param signal - cancels the read.
   * @param maxBytes - the inclusive byte cap.
   */
  async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readBytes(target, signal, maxBytes);
    return super.readBytes(target, signal, maxBytes);
  }

  /**
   * @param target - the resolved target.
   * @param range - the byte window.
   * @param signal - cancels the read.
   */
  async readByteRange(target: FsTarget, range: { offset: number, length: number }, signal?: AbortSignal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readByteRange(target, range, signal);
    return super.readByteRange(target, range, signal);
  }

  /**
   * @param target - the resolved directory.
   * @param signal - cancels the listing.
   */
  async listDir(target: FsTarget, signal?: AbortSignal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).listDir(target, signal);
    return super.listDir(target, signal);
  }

  /**
   * @param target - the resolved target.
   * @param content - the full new content.
   * @param expected - the guarded-write intent.
   * @param signal - cancels the write.
   * @param sandboxPolicy - the confined policy the distro side honors; the
   *   host backend takes no such parameter.
   */
  async writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy) {
    if (targetIsDistro(target.targetKey)) {
      return (await this.distro()).writeText(target, content, expected, signal, sandboxPolicy);
    }
    return super.writeText(target, content, expected, signal);
  }

  /**
   * @param target - the resolved target.
   * @param edit - the literal edit.
   * @param expected - the version the edit was based on.
   * @param signal - cancels the edit.
   * @param sandboxPolicy - the confined policy the distro side honors; the
   *   host backend takes no such parameter.
   */
  async editText(target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy) {
    if (targetIsDistro(target.targetKey)) {
      return (await this.distro()).editText(target, edit, expected, signal, sandboxPolicy);
    }
    return super.editText(target, edit, expected, signal);
  }

  /**
   * @param target - the resolved target.
   * @param changed - the change callback.
   * @param signal - cancels the watch.
   */
  async watch(target: FsTarget, changed: (error?: Error) => void, signal: AbortSignal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).watch(target, changed, signal);
    return super.watch(target, changed, signal);
  }

  /**
   * @param parent - the container.
   * @param child - the contained candidate.
   */
  contains(parent: FsTarget, child: FsTarget): boolean {
    if (targetIsDistro(parent.targetKey)) {
      // Both targets came from this router's distro resolve, so the plain
      // POSIX containment over their process paths is the same check the
      // distro substrate performs for its own guarded writes.
      const base = this.processPath(parent);
      const full = this.processPath(child);
      return full === base || full.startsWith(base.endsWith("/") ? base : `${base}/`);
    }
    return super.contains(parent, child);
  }

  /**
   * @param target - the resolved target.
   */
  processPath(target: FsTarget): string {
    const parsed = uncToPosix(target.targetKey);
    if (parsed !== undefined) return parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
    return super.processPath(target);
  }
}

export default WslRoutingFileSystem;
