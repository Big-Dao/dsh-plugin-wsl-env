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
 * Whether a resolved target identity belongs to the distro.
 *
 * @param targetKey - the target's identity (a UNC for distro paths).
 * @returns true when the target lives inside a WSL distro.
 */
export function targetIsDistro(targetKey) {
  return isWslUnc(targetKey);
}

/**
 * Whether a raw path-or-cwd input names the distro (used by the operations
 * that take paths before a target exists: resolve, lstat).
 *
 * @param value - a path in any coordinate system, or undefined.
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

  /** The lazy distro backend, built on first routed use. */
  #distro;
  /** The distro knobs, verbatim from the row config. */
  #distroConfig;

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
    return (this.#distro ??= new WslFileSystem(this.ctx, this.#distroConfig));
  }

  async resolve(path, opts) {
    if (inputIsDistro(path) || inputIsDistro(opts?.cwd)) return (await this.distro()).resolve(path, opts);
    return super.resolve(path, opts);
  }

  async lstat(path, opts, signal) {
    if (inputIsDistro(path) || inputIsDistro(opts?.cwd)) return (await this.distro()).lstat(path, opts, signal);
    return super.lstat(path, opts, signal);
  }

  async stat(target, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).stat(target, signal);
    return super.stat(target, signal);
  }

  async readText(target, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readText(target, signal);
    return super.readText(target, signal);
  }

  async streamText(target, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).streamText(target, signal);
    return super.streamText(target, signal);
  }

  async readBytes(target, signal, maxBytes) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readBytes(target, signal, maxBytes);
    return super.readBytes(target, signal, maxBytes);
  }

  async readByteRange(target, range, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).readByteRange(target, range, signal);
    return super.readByteRange(target, range, signal);
  }

  async listDir(target, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).listDir(target, signal);
    return super.listDir(target, signal);
  }

  async writeText(target, content, expected, signal, sandboxPolicy) {
    if (targetIsDistro(target.targetKey)) {
      return (await this.distro()).writeText(target, content, expected, signal, sandboxPolicy);
    }
    return super.writeText(target, content, expected, signal, sandboxPolicy);
  }

  async editText(target, edit, expected, signal, sandboxPolicy) {
    if (targetIsDistro(target.targetKey)) {
      return (await this.distro()).editText(target, edit, expected, signal, sandboxPolicy);
    }
    return super.editText(target, edit, expected, signal, sandboxPolicy);
  }

  async watch(target, changed, signal) {
    if (targetIsDistro(target.targetKey)) return (await this.distro()).watch(target, changed, signal);
    return super.watch(target, changed, signal);
  }

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

  processPath(target) {
    const parsed = uncToPosix(target.targetKey);
    if (parsed !== undefined) return parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
    return super.processPath(target);
  }
}

export default WslRoutingFileSystem;
