import { canonicalPath, SandboxInvalidRootError, writableRoots } from "@deepseek-ai/dsh-sandbox";
import { isWslUnc, posixToUnc, toLinuxPath } from "./paths.js";
import { distroOfUnc, isDefaultDistro, pinnedDistro } from "./distro-route.js";
import { linuxHomePath } from "./wsl.js";
import { WritableRootError, ensureWritableRoots, resolveWritableRoots } from "./writable-roots.js";
const AUTO_SCOPE_RECHECK_MS = 60_000;
/**
 * The configured default workdir, or an empty string when the operator left it
 * unset. `cwd` is a volatile field on both providers, so it is read through
 * `.get()`, and it may be absent entirely.
 */
export function configuredCwd(config) {
    return String(config.cwd?.get?.() ?? "").trim();
}
/**
 * The distro user's home as a Linux path, cached on the provider instance whose
 * `distro`/`wslPath` config it belongs to.
 */
export async function distroHome(owner, distro) {
    const cached = owner.resolvedHomes.get(distro);
    if (cached !== undefined)
        return cached;
    if (owner.resolvedHome !== undefined && owner.resolvedDistro.length > 0 && distro === owner.resolvedDistro) {
        owner.resolvedHomes.set(distro, owner.resolvedHome);
        return owner.resolvedHome;
    }
    const config = owner.config;
    const home = await linuxHomePath(distro, { wslPath: config.wslPath });
    owner.resolvedHomes.set(distro, home);
    if (owner.resolvedDistro.length > 0 && distro === owner.resolvedDistro)
        owner.resolvedHome = home;
    return home;
}
/**
 * Translate workspace-write grants into the vocabulary used by the target
 * filesystem. WSL workspaces receive distro-local temporary and extra roots;
 * Windows workspaces retain the upstream grant.
 */
export function wslWritableRoots(policy, distro, linuxExtraRoots) {
    if (policy.mode !== "workspace-write")
        return [];
    const roots = new Set([canonicalPath(policy.workspaceRoot)]);
    if (isWslUnc(policy.workspaceRoot)) {
        roots.add(canonicalPath(posixToUnc(distro, "/tmp")));
        for (const root of linuxExtraRoots)
            roots.add(canonicalPath(posixToUnc(distro, root)));
    }
    else {
        for (const root of writableRoots(policy))
            roots.add(root);
    }
    return [...roots];
}
/**
 * Resolve configured and policy-provided roots for one distro, then verify
 * their physical directories before they are bound into a confinement profile.
 */
export async function effectiveWritableRoots(input) {
    try {
        const roots = resolveWritableRoots({
            configured: input.configured,
            policy: input.policy?.additionalWritableRoots,
            home: input.home,
            distro: input.distro,
            workspaceRoot: toLinuxPath(input.policy?.workspaceRoot ?? input.home),
        });
        if (input.check !== false) {
            await ensureWritableRoots({ wslPath: input.wslPath, distro: input.distro, roots, signal: input.signal, ...(input.run === undefined ? {} : { run: input.run }) });
        }
        return roots;
    }
    catch (error) {
        if (error instanceof WritableRootError)
            throw new SandboxInvalidRootError(error.root, error.reason);
        throw error;
    }
}
/** Whether confined profiles shadow `/mnt`, with the explicit stance winning. */
export function effectiveMaskWindowsDrive(config) {
    if (config.interopVisibility !== undefined)
        return config.interopVisibility !== "visible";
    return config.maskWindowsDrive === true;
}
/** Resolve the distro for an operation from its configuration and candidates. */
export async function resolveOperationDistro(configured, candidates, probeDefault) {
    const pinned = pinnedDistro(configured);
    if (pinned !== undefined)
        return pinned;
    if (!isDefaultDistro(configured)) {
        for (const candidate of candidates) {
            const named = distroOfUnc(candidate);
            if (named !== undefined)
                return named;
        }
    }
    return probeDefault();
}
/**
 * Choose the session runtime policy for one distro, retrying an automatic
 * failed probe after its short cache expires.
 */
export async function sessionRuntimeWanted(value, distro, ensure, cache) {
    if (value === false)
        return false;
    if (value === true) {
        await ensure();
        return true;
    }
    const cached = cache.get(distro);
    if (cached?.usable === true)
        return true;
    if (cached !== undefined && Date.now() - cached.checkedAt < AUTO_SCOPE_RECHECK_MS)
        return false;
    try {
        await ensure();
        cache.set(distro, { usable: true, checkedAt: Date.now() });
        return true;
    }
    catch {
        cache.set(distro, { usable: false, checkedAt: Date.now() });
        return false;
    }
}
