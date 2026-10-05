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
 * @module dsh-plugin-wsl/fs-routing
 */

import { isWslUnc, uncToPosix, windowsToLinuxMount } from "./paths.js";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { linuxJoin } from "./workspace-files-route.js";
import { WslFileSystem } from "./index.js";

/**
 * The router's config: the host backend's own knobs plus the distro knobs the
 * routed backend reads. The distro keys are `??`-defaulted, so a host-only
 * config stays valid.
 *
 * @typedef {object} RoutingConfig
 * @property {string} [cwd] - the host backend's base directory.
 * @property {number} [diffBasisMaxBytes] - the host backend's overwrite-diff byte bound.
 * @property {string} [distro] - the pinned distro for routed targets; empty resolves WSL's default.
 * @property {string} [wslPath] - the `wsl.exe` path, used only to resolve the default distro.
 * @property {string} [distroCwd] - the routed backend's default workdir.
 * @property {boolean} [sandbox] - whether the routed backend fences mutations by `ctx.sandboxPolicy`.
 * @property {boolean} [maskWindowsDrive] - whether confined profiles shadow `/mnt`.
 * @property {boolean} [restrictToDistro] - whether the routed backend refuses paths outside the distro.
 * @property {number} [watchMaxDepth] - how deep the in-distro watch scan walks.
 */

/**
 * Whether a resolved target identity belongs to the distro.
 *
 * @param {string} targetKey - the target's identity (a UNC for distro paths).
 * @returns true when the target lives inside a WSL distro.
 */
export function targetIsDistro(targetKey) {
  return isWslUnc(targetKey);
}

/**
 * Whether a raw path-or-cwd input names the distro (used by the operations
 * that take paths before a target exists: resolve, lstat).
 *
 * @param {string|undefined} value - a path in any coordinate system, or undefined.
 * @returns true when the input names a distro UNC.
 */
export function inputIsDistro(value) {
  return value !== undefined && isWslUnc(value);
}

/**
 * The Linux working path for one request: UNC absolutes map onto their Linux
 * paths, POSIX absolutes and relative paths join onto the root.
 *
 * @param linuxRoot - the workspace root in Linux form.
 * @param path - the requested path, any coordinate system.
 * @returns the absolute Linux path.
 */
/**
 * The root-plane filesystem with coordinate routing.
 *
 * The distro backend is built lazily on the first routed target, sharing this
 * context (the root `sandboxPolicy` service provides the deployment default
 * mode the distro side reports through `sandboxMode`).
 */
export class WslRoutingFileSystem extends LocalFileSystem {
  static Config = LocalFileSystem.Config;

  /** @type {import("@deepseek-ai/dsh-fs").FileSystem | undefined} The lazy distro backend, built on first routed use. */
  #distro;
  /** The distro knobs, verbatim from the row config. */
  #distroConfig;

  /**
   * @param {import("@deepseek-ai/cordis").Context} ctx - the cordis context.
   * @param {RoutingConfig} config - the row config, host knobs plus distro knobs.
   */
  constructor(ctx, config) {
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
  distro() {
    return (this.#distro ??= /** @type {import("@deepseek-ai/dsh-fs").FileSystem} */ (/** @type {any} */ (new WslFileSystem(this.ctx, this.#distroConfig))));
  }

  /**
   * @param {string} path - the requested path.
   * @param {{cwd?: string, signal?: AbortSignal}} [opts] - the resolve options.
   */
  async resolve(path, opts) {
    if (inputIsDistro(path) || inputIsDistro(opts?.cwd)) return (await this.distro()).resolve(path, opts);
    return super.resolve(path, opts);
  }

  /**
   * @param {string} path - the requested path.
   * @param {{cwd?: string}} [opts] - the lstat options.
   * @param {AbortSignal} [signal] - cancels the round trip.
   */
  async lstat(path, opts, signal) {
    if (inputIsDistro(path) || inputIsDistro(opts?.cwd)) return (await this.distro()).lstat(path, opts, signal);
    return super.lstat(path, opts, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   * @param {AbortSignal} [signal] - cancels the round trip.
   */
  async stat(target, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).stat(target, signal);
    return super.stat(target, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   * @param {AbortSignal} [signal] - cancels the round trip.
   */
  async readText(target, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readText(target, signal);
    return super.readText(target, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   * @param {AbortSignal} [signal] - cancels the stream.
   */
  async streamText(target, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).streamText(target, signal);
    return super.streamText(target, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   * @param {AbortSignal|undefined} signal - cancels the read.
   * @param {number} maxBytes - the inclusive byte cap.
   */
  async readBytes(target, signal, maxBytes) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readBytes(target, signal, maxBytes);
    return super.readBytes(target, signal, maxBytes);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   * @param {{offset: number, length: number}} range - the byte window.
   * @param {AbortSignal} [signal] - cancels the read.
   */
  async readByteRange(target, range, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readByteRange(target, range, signal);
    return super.readByteRange(target, range, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved directory.
   * @param {AbortSignal} [signal] - cancels the listing.
   */
  async listDir(target, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).listDir(target, signal);
    return super.listDir(target, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   * @param {string} content - the full new content.
   * @param {import("@deepseek-ai/dsh-fs").FsWriteIntent} [expected] - the guarded-write intent.
   * @param {AbortSignal} [signal] - cancels the write.
   * @param {import("@deepseek-ai/dsh-sandbox").SandboxExecutionPolicy} [sandboxPolicy] - the confined
   *   policy the distro side honors; the host backend takes no such parameter.
   */
  async writeText(target, content, expected, signal, sandboxPolicy) {
    if (targetIsDistro(target.targetKey)) {
      return (await this.distro()).writeText(target, content, expected, signal, sandboxPolicy);
    }
    return super.writeText(target, content, expected, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   * @param {import("@deepseek-ai/dsh-fs").FsEditRequest} edit - the literal edit.
   * @param {{version: import("@deepseek-ai/dsh-fs").FsVersion}} [expected] - the version the edit was based on.
   * @param {AbortSignal} [signal] - cancels the edit.
   * @param {import("@deepseek-ai/dsh-sandbox").SandboxExecutionPolicy} [sandboxPolicy] - the confined
   *   policy the distro side honors; the host backend takes no such parameter.
   */
  async editText(target, edit, expected, signal, sandboxPolicy) {
    if (targetIsDistro(target.targetKey)) {
      return (await this.distro()).editText(target, edit, expected, signal, sandboxPolicy);
    }
    return super.editText(target, edit, expected, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   * @param {(error?: Error) => void} changed - the change callback.
   * @param {AbortSignal} signal - cancels the watch.
   */
  async watch(target, changed, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).watch(target, changed, signal);
    return super.watch(target, changed, signal);
  }

  /**
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} parent - the container.
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} child - the contained candidate.
   */
  contains(parent, child) {
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
   * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
   */
  processPath(target) {
    const parsed = uncToPosix(target.targetKey);
    if (parsed !== undefined) return parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
    return super.processPath(target);
  }
}

export default WslRoutingFileSystem;
