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
import z from "@deepseek-ai/schemastery";
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
    /**
     * The distro mode for routed targets: empty/`"auto"` follows each target's
     * UNC distro, `"default"` forces WSL's default, and an explicit name pins.
     */
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
 * Whether a distro target contains another, comparing BOTH the distro
 * coordinate and the normalized Linux path. A child in another distro's
 * share is never contained, even when its Linux spelling is a prefix match —
 * the textual check this replaces said yes there.
 *
 * @param parentKey - the parent's UNC identity.
 * @param childKey - the child's UNC identity.
 * @returns true when the child is the parent or lies under it in the same distro.
 */
export declare function distroContains(parentKey: string, childKey: string): boolean;
export declare function targetIsDistro(targetKey: string): boolean;
/**
 * Whether a raw path-or-cwd input names the distro (used by the operations
 * that take paths before a target exists: resolve, lstat).
 *
 * @param value - a path in any coordinate system, or undefined.
 * @returns true when the input names a distro UNC.
 */
export declare function inputIsDistro(value: string | undefined): boolean;
/**
 * The root-plane filesystem with coordinate routing.
 *
 * The distro backend is built lazily on the first routed target, sharing this
 * context (the root `sandboxPolicy` service provides the deployment default
 * mode the distro side reports through `sandboxMode`).
 */
export declare class WslRoutingFileSystem extends LocalFileSystem {
    static Config: z<RoutingConfig>;
    /**
     * The routed backend's constructor reads the deployment default mode from
     * `ctx.sandboxPolicy`, exactly as the shipped `fs-sandbox` row this class
     * replaces does. The service is provided by a sibling row, not an ancestor,
     * so the fiber must declare the dependency; without it the lazy backend
     * construction fails with "cannot get property sandboxPolicy without inject".
     */
    static inject: string[];
    /**
     * The lazy distro backend, built on first routed use, typed as the concrete
     * class: these routing calls are that class's own surface, and the
     * `processPathFromHostPath` seam it once could not satisfy (async against the
     * peer interface's synchronous contract) is closed — the backend maps
     * synchronously now, from what it already knows.
     *
     * Plain fields on purpose: cordis invokes a service method with a shadow
     * receiver (the traceable proxy `ReflectService` builds), and `#private`
     * members do not cross it — every routed root call then fails with "Cannot
     * read private member #distro from an object whose class did not declare it".
     * The host backend this class extends keeps its own state plain (`config`,
     * `locks`) for the same reason.
     */
    private distroBackend;
    /** The distro knobs, verbatim from the row config. */
    private distroConfig;
    /**
     * The context this router was constructed with. `this.ctx` inside a method is
     * the CALLER's context (cordis re-binds it for dependency tracing), so the
     * backend's scope must not be derived from it: the first routed call may come
     * from any consumer fiber.
     */
    private routeContext;
    /**
     * @param ctx - the cordis context.
     * @param config - the row config, host knobs plus distro knobs.
     */
    constructor(ctx: Context, config: RoutingConfig);
    /** The distro backend for routed targets, built on first use. */
    distro(): WslFileSystem;
    /**
     * @param path - the requested path.
     * @param opts - the resolve options.
     */
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    /**
     * @param path - the requested path.
     * @param opts - the lstat options.
     * @param signal - cancels the round trip.
     */
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<import("@deepseek-ai/dsh-fs").FsPathInfo | undefined>;
    /**
     * @param target - the resolved target.
     * @param signal - cancels the round trip.
     */
    stat(target: FsTarget, signal?: AbortSignal): Promise<import("@deepseek-ai/dsh-fs").FsInfo | undefined>;
    /**
     * @param target - the resolved target.
     * @param signal - cancels the round trip.
     */
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    /**
     * @param target - the resolved target.
     * @param signal - cancels the stream.
     */
    streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    /**
     * @param target - the resolved target.
     * @param signal - cancels the read.
     * @param maxBytes - the inclusive byte cap.
     */
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array<ArrayBufferLike>>;
    /**
     * @param target - the resolved target.
     * @param range - the byte window.
     * @param signal - cancels the read.
     */
    readByteRange(target: FsTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array<ArrayBufferLike>>;
    /**
     * @param target - the resolved directory.
     * @param signal - cancels the listing.
     */
    listDir(target: FsTarget, signal?: AbortSignal): Promise<import("@deepseek-ai/dsh-fs").FsDirEntry[]>;
    /**
     * @param target - the resolved target.
     * @param content - the full new content.
     * @param expected - the guarded-write intent.
     * @param signal - cancels the write.
     * @param sandboxPolicy - the confined policy the distro side honors; the
     *   host backend takes no such parameter.
     */
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<import("@deepseek-ai/dsh-fs").FsWriteOutcome>;
    /**
     * @param target - the resolved target.
     * @param edit - the literal edit.
     * @param expected - the version the edit was based on.
     * @param signal - cancels the edit.
     * @param sandboxPolicy - the confined policy the distro side honors; the
     *   host backend takes no such parameter.
     */
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: FsVersion;
    }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<import("@deepseek-ai/dsh-fs").FsEditOutcome>;
    /**
     * @param target - the resolved target.
     * @param changed - the change callback.
     * @param signal - cancels the watch.
     */
    watch(target: FsTarget, changed: (error?: Error) => void, signal: AbortSignal): Promise<() => Promise<void>>;
    /**
     * @param parent - the container.
     * @param child - the contained candidate.
     */
    contains(parent: FsTarget, child: FsTarget): boolean;
    /**
     * @param target - the resolved target.
     */
    processPath(target: FsTarget): string;
}
export default WslRoutingFileSystem;
