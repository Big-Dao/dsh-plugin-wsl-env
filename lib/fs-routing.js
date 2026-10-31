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
import z from "@deepseek-ai/schemastery";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { WslFileSystem } from "./index.js";
/**
 * Whether a resolved target identity belongs to the distro.
 *
 * @param targetKey - the target's identity (a UNC for distro paths).
 * @returns true when the target lives inside a WSL distro.
 */
/**
 * Lexically normalize a Linux path (`/a/./b/../c` → `/a/c`). The resolver
 * canonicalizes real paths, so this is a guard for target keys that did not
 * come through it; it cannot follow symlinks, and does not pretend to.
 *
 * @param path - the Linux path.
 * @returns the normalized absolute path.
 */
function normalizeLinuxPath(path) {
    const segments = [];
    for (const segment of path.split("/")) {
        if (segment === "" || segment === ".")
            continue;
        if (segment === "..")
            segments.pop();
        else
            segments.push(segment);
    }
    return `/${segments.join("/")}`;
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
export function distroContains(parentKey, childKey) {
    const parent = uncToPosix(parentKey);
    const child = uncToPosix(childKey);
    if (parent === undefined || child === undefined)
        return false;
    if (parent.distro.toLowerCase() !== child.distro.toLowerCase())
        return false;
    const base = normalizeLinuxPath(parent.linuxPath);
    const full = normalizeLinuxPath(child.linuxPath);
    return full === base || full.startsWith(base.endsWith("/") ? base : `${base}/`);
}
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
 * The root-plane filesystem with coordinate routing.
 *
 * The distro backend is built lazily on the first routed target, sharing this
 * context (the root `sandboxPolicy` service provides the deployment default
 * mode the distro side reports through `sandboxMode`).
 */
export class WslRoutingFileSystem extends LocalFileSystem {
    static Config = z.intersect([
        LocalFileSystem.Config,
        z.object({
            distro: z.string().default(""),
            wslPath: z.string().default("wsl.exe"),
            distroCwd: z.string().default(""),
            sandbox: z.boolean().default(true),
            maskWindowsDrive: z.boolean().default(false),
            restrictToDistro: z.boolean().default(true),
            watchMaxDepth: z.natural().default(0),
        }),
    ]);
    /**
     * The routed backend's constructor reads the deployment default mode from
     * `ctx.sandboxPolicy`, exactly as the shipped `fs-sandbox` row this class
     * replaces does. The service is provided by a sibling row, not an ancestor,
     * so the fiber must declare the dependency; without it the lazy backend
     * construction fails with "cannot get property sandboxPolicy without inject".
     */
    static inject = ["sandboxPolicy"];
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
    distroBackend;
    /** The distro knobs, verbatim from the row config. */
    distroConfig;
    /**
     * The context this router was constructed with. `this.ctx` inside a method is
     * the CALLER's context (cordis re-binds it for dependency tracing), so the
     * backend's scope must not be derived from it: the first routed call may come
     * from any consumer fiber.
     */
    routeContext;
    /**
     * @param ctx - the cordis context.
     * @param config - the row config, host knobs plus distro knobs.
     */
    constructor(ctx, config) {
        super(ctx, config);
        this.routeContext = ctx;
        this.distroConfig = {
            distro: config.distro ?? "",
            wslPath: config.wslPath ?? "wsl.exe",
            cwd: config.distroCwd ?? "",
            diffBasisMaxBytes: config.diffBasisMaxBytes,
            sandbox: config.sandbox ?? true,
            maskWindowsDrive: config.maskWindowsDrive ?? false,
            restrictToDistro: config.restrictToDistro ?? true,
            watchMaxDepth: config.watchMaxDepth ?? 0,
            // The root router is app-level, not session-owned: its backend must not
            // acquire a session runtime (that would live for the app, not the
            // session). Preset-scoped `wsl-fs` is the owner of the session runtime.
            sessionSandbox: false,
        };
    }
    /** The distro backend for routed targets, built on first use. */
    distro() {
        // The backend is a `Service` that registers itself as `fs`. Constructing it
        // with this router's own context would collide with the router's
        // registration ("service fs has been registered"), so it gets a scope of its
        // own: the backend is used directly through this field, never resolved as
        // the context's `fs`. Isolation re-keys only `fs`; `sandboxPolicy`, which
        // the backend reads, still resolves from the parent scope.
        return (this.distroBackend ??= new WslFileSystem(this.routeContext.isolate("fs"), this.distroConfig));
    }
    /**
     * @param path - the requested path.
     * @param opts - the resolve options.
     */
    async resolve(path, opts) {
        if (inputIsDistro(path) || inputIsDistro(opts?.cwd))
            return (await this.distro()).resolve(path, opts);
        return super.resolve(path, opts);
    }
    /**
     * @param path - the requested path.
     * @param opts - the lstat options.
     * @param signal - cancels the round trip.
     */
    async lstat(path, opts, signal) {
        if (inputIsDistro(path) || inputIsDistro(opts?.cwd))
            return (await this.distro()).lstat(path, opts, signal);
        return super.lstat(path, opts, signal);
    }
    /**
     * @param target - the resolved target.
     * @param signal - cancels the round trip.
     */
    async stat(target, signal) {
        if (targetIsDistro(target.targetKey))
            return (await this.distro()).stat(target, signal);
        return super.stat(target, signal);
    }
    /**
     * @param target - the resolved target.
     * @param signal - cancels the round trip.
     */
    async readText(target, signal) {
        if (targetIsDistro(target.targetKey))
            return (await this.distro()).readText(target, signal);
        return super.readText(target, signal);
    }
    /**
     * @param target - the resolved target.
     * @param signal - cancels the stream.
     */
    async streamText(target, signal) {
        if (targetIsDistro(target.targetKey))
            return (await this.distro()).streamText(target, signal);
        return super.streamText(target, signal);
    }
    /**
     * @param target - the resolved target.
     * @param signal - cancels the read.
     * @param maxBytes - the inclusive byte cap.
     */
    async readBytes(target, signal, maxBytes) {
        if (targetIsDistro(target.targetKey))
            return (await this.distro()).readBytes(target, signal, maxBytes);
        return super.readBytes(target, signal, maxBytes);
    }
    /**
     * @param target - the resolved target.
     * @param range - the byte window.
     * @param signal - cancels the read.
     */
    async readByteRange(target, range, signal) {
        if (targetIsDistro(target.targetKey))
            return (await this.distro()).readByteRange(target, range, signal);
        return super.readByteRange(target, range, signal);
    }
    /**
     * @param target - the resolved directory.
     * @param signal - cancels the listing.
     */
    async listDir(target, signal) {
        if (targetIsDistro(target.targetKey))
            return (await this.distro()).listDir(target, signal);
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
    async writeText(target, content, expected, signal, sandboxPolicy) {
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
    async editText(target, edit, expected, signal, sandboxPolicy) {
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
    async watch(target, changed, signal) {
        if (targetIsDistro(target.targetKey))
            return (await this.distro()).watch(target, changed, signal);
        return super.watch(target, changed, signal);
    }
    /**
     * @param parent - the container.
     * @param child - the contained candidate.
     */
    contains(parent, child) {
        if (targetIsDistro(parent.targetKey))
            return distroContains(parent.targetKey, child.targetKey);
        return super.contains(parent, child);
    }
    /**
     * @param target - the resolved target.
     */
    processPath(target) {
        const parsed = uncToPosix(target.targetKey);
        if (parsed !== undefined)
            return parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
        return super.processPath(target);
    }
}
export default WslRoutingFileSystem;
