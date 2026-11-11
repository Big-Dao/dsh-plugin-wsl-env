import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
interface DistroHomeOwner {
    config: unknown;
    resolvedDistro: string;
    resolvedHome: string | undefined;
    resolvedHomes: Map<string, string>;
}
/**
 * The configured default workdir, or an empty string when the operator left it
 * unset. `cwd` is a volatile field on both providers, so it is read through
 * `.get()`, and it may be absent entirely.
 */
export declare function configuredCwd(config: {
    cwd?: {
        get(): string | undefined;
    };
}): string;
/**
 * The distro user's home as a Linux path, cached on the provider instance whose
 * `distro`/`wslPath` config it belongs to.
 */
export declare function distroHome(owner: DistroHomeOwner, distro: string): Promise<string>;
/**
 * Translate workspace-write grants into the vocabulary used by the target
 * filesystem. WSL workspaces receive distro-local temporary and extra roots;
 * Windows workspaces retain the upstream grant.
 */
export declare function wslWritableRoots(policy: SandboxExecutionPolicy, distro: string, linuxExtraRoots: readonly string[]): string[];
/**
 * Resolve configured and policy-provided roots for one distro, then verify
 * their physical directories before they are bound into a confinement profile.
 */
export declare function effectiveWritableRoots(input: {
    configured?: readonly string[] | undefined;
    policy?: SandboxExecutionPolicy | undefined;
    distro: string;
    home: string;
    wslPath: string;
    signal?: AbortSignal | undefined;
    run?: ((argv: string[]) => Promise<string>) | undefined;
    check?: boolean;
}): Promise<string[]>;
/** Whether confined profiles shadow `/mnt`, with the explicit stance winning. */
export declare function effectiveMaskWindowsDrive(config: {
    interopVisibility?: "visible" | "masked" | "disabled";
    maskWindowsDrive?: boolean;
}): boolean;
/** Resolve the distro for an operation from its configuration and candidates. */
export declare function resolveOperationDistro(configured: string, candidates: ReadonlyArray<string | undefined>, probeDefault: () => Promise<string>): Promise<string>;
/**
 * Choose the session runtime policy for one distro, retrying an automatic
 * failed probe after its short cache expires.
 */
export declare function sessionRuntimeWanted(value: boolean | "auto", distro: string, ensure: () => Promise<void>, cache: Map<string, {
    usable: boolean;
    checkedAt: number;
}>): Promise<boolean>;
export {};
