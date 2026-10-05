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
export function targetIsDistro(targetKey: string): boolean;
/**
 * Whether a raw path-or-cwd input names the distro (used by the operations
 * that take paths before a target exists: resolve, lstat).
 *
 * @param {string|undefined} value - a path in any coordinate system, or undefined.
 * @returns true when the input names a distro UNC.
 */
export function inputIsDistro(value: string | undefined): boolean;
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
    /**
     * @param {import("@deepseek-ai/cordis").Context} ctx - the cordis context.
     * @param {RoutingConfig} config - the row config, host knobs plus distro knobs.
     */
    constructor(ctx: import("@deepseek-ai/cordis").Context, config: RoutingConfig);
    /** The distro backend for routed targets, built on first use. */
    distro(): import("@deepseek-ai/dsh-fs").FileSystem;
    /**
     * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
     * @param {string} content - the full new content.
     * @param {import("@deepseek-ai/dsh-fs").FsWriteIntent} [expected] - the guarded-write intent.
     * @param {AbortSignal} [signal] - cancels the write.
     * @param {import("@deepseek-ai/dsh-sandbox").SandboxExecutionPolicy} [sandboxPolicy] - the confined
     *   policy the distro side honors; the host backend takes no such parameter.
     */
    writeText(target: import("@deepseek-ai/dsh-fs").FsTarget, content: string, expected?: import("@deepseek-ai/dsh-fs").FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: import("@deepseek-ai/dsh-sandbox").SandboxExecutionPolicy): Promise<import("@deepseek-ai/dsh-fs").FsWriteOutcome>;
    /**
     * @param {import("@deepseek-ai/dsh-fs").FsTarget} target - the resolved target.
     * @param {import("@deepseek-ai/dsh-fs").FsEditRequest} edit - the literal edit.
     * @param {{version: import("@deepseek-ai/dsh-fs").FsVersion}} [expected] - the version the edit was based on.
     * @param {AbortSignal} [signal] - cancels the edit.
     * @param {import("@deepseek-ai/dsh-sandbox").SandboxExecutionPolicy} [sandboxPolicy] - the confined
     *   policy the distro side honors; the host backend takes no such parameter.
     */
    editText(target: import("@deepseek-ai/dsh-fs").FsTarget, edit: import("@deepseek-ai/dsh-fs").FsEditRequest, expected?: {
        version: import("@deepseek-ai/dsh-fs").FsVersion;
    }, signal?: AbortSignal, sandboxPolicy?: import("@deepseek-ai/dsh-sandbox").SandboxExecutionPolicy): Promise<import("@deepseek-ai/dsh-fs").FsEditOutcome>;
    #private;
}
export default WslRoutingFileSystem;
/**
 * The router's config: the host backend's own knobs plus the distro knobs the
 * routed backend reads. The distro keys are `??`-defaulted, so a host-only
 * config stays valid.
 */
export type RoutingConfig = {
    /**
     * - the host backend's base directory.
     */
    cwd?: string | undefined;
    /**
     * - the host backend's overwrite-diff byte bound.
     */
    diffBasisMaxBytes?: number | undefined;
    /**
     * - the pinned distro for routed targets; empty resolves WSL's default.
     */
    distro?: string | undefined;
    /**
     * - the `wsl.exe` path, used only to resolve the default distro.
     */
    wslPath?: string | undefined;
    /**
     * - the routed backend's default workdir.
     */
    distroCwd?: string | undefined;
    /**
     * - whether the routed backend fences mutations by `ctx.sandboxPolicy`.
     */
    sandbox?: boolean | undefined;
    /**
     * - whether confined profiles shadow `/mnt`.
     */
    maskWindowsDrive?: boolean | undefined;
    /**
     * - whether the routed backend refuses paths outside the distro.
     */
    restrictToDistro?: boolean | undefined;
    /**
     * - how deep the in-distro watch scan walks.
     */
    watchMaxDepth?: number | undefined;
};
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
