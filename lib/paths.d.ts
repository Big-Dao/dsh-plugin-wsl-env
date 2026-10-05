/**
 * Path translation between the three coordinate systems a WSL-backed session
 * touches:
 *
 *   1. Linux/POSIX paths inside the distro   /home/andy/proj/src/a.ts
 *   2. WSL's Windows UNC share               \\wsl.localhost\ubuntu\home\andy\proj\src\a.ts
 *   3. The Windows filesystem itself         C:\Users\andyz\...  ->  /mnt/c/Users/andyz/...
 *
 * The harness host can reach (2) directly with Node's fs, which is what makes
 * reads and ripgrep searches work without any in-distro helper. Commands must
 * run inside the distro, so the shell executor speaks (1).
 *
 * These helpers are pure and dependency-free so they can be unit-tested without
 * booting Cordis.
 *
 * This is a TypeScript source built to `lib/paths.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/paths
 */
/** A distro identity and the Linux path inside it, as {@link uncToPosix} returns. */
export interface DistroPath {
    /** The distro name the UNC named. */
    distro: string;
    /** An absolute POSIX path inside that distro. */
    linuxPath: string;
}
/**
 * What the two world-path translators may consult: the pinned distro and the
 * fallback directory for relative input.
 */
export interface WorldPathOptions {
    /**
     * The pinned distro, which maps a POSIX-absolute input onto its UNC identity
     * in {@link toWorldPath}.
     */
    distro?: string;
    /** The directory relative input resolves against. */
    cwd?: string;
}
/**
 * Whether a string is the WSL UNC share rather than an ordinary Windows path.
 *
 * @param value - candidate path.
 * @returns true for `\\wsl.localhost\...` and `\\wsl$\...`.
 */
export declare function isWslUnc(value: string): boolean;
/**
 * Whether a string is POSIX-absolute. On Windows `path.isAbsolute('/home/x')`
 * is also true, so the WSL mapper must test this before falling back to the
 * host helpers.
 *
 * @param value - candidate path.
 * @returns true when the path starts with a single forward slash.
 */
export declare function isPosixAbsolute(value: string): boolean;
/**
 * Whether a path names a location only relative to a base. The fs provider
 * consults its default workdir exactly for this input; every absolute form —
 * POSIX, drive, WSL UNC, or any other UNC share — is a location in its own
 * right and short-circuits before a base is ever needed.
 *
 * @param value - candidate path.
 * @returns true when the path names no absolute location.
 */
export declare function isRelativeWorldPath(value: string): boolean;
/**
 * Whether a world path is a granted root or lies beneath it, compared in the
 * coordinate system the two spellings share.
 *
 * A grant is written in the vocabulary of the world it governs: the Windows
 * sandbox hands out drive and UNC paths, while a distro-side grant is a Linux
 * path such as `/tmp`. Passing the distro maps a Linux grant onto the same UNC
 * share as the target, so `\\wsl.localhost\ubuntu\home\andy` can be compared
 * with `/home/andy`. Mixed pairs that share no vocabulary report no containment
 * — the conservative answer, never a textual guess.
 *
 * @param target - the path being tested, in any coordinate system.
 * @param root - the granted root, in any coordinate system.
 * @param options - the distro that maps a Linux root onto its UNC share.
 * @returns true when target is root itself or a descendant of it.
 */
export declare function isWorldPathUnder(target: string, root: string, options?: WorldPathOptions): boolean;
/**
 * Map a Linux path inside a distro onto the UNC path the host can read.
 *
 * @param distro - distro name, e.g. `ubuntu`.
 * @param linuxPath - absolute Linux path, e.g. `/home/andy/proj`.
 * @returns the equivalent `\\wsl.localhost\<distro>\...` path.
 */
export declare function posixToUnc(distro: string, linuxPath: string): string;
/**
 * Map a WSL UNC path back onto the distro and Linux path it names.
 *
 * @param uncPath - a `\\wsl.localhost\<distro>\...` path; absent is not a UNC path.
 * @returns the distro and Linux path, or undefined for any other path.
 */
export declare function uncToPosix(uncPath?: string): DistroPath | undefined;
/**
 * Whether a UNC path belongs to the named distro. Used to confine the WSL
 * filesystem backend to one distro instead of silently serving every mounted
 * share.
 *
 * @param uncPath - candidate UNC path.
 * @param distro - the distro this session is pinned to.
 * @returns true when the path is the same distro (case-insensitive).
 */
export declare function isUnderDistro(uncPath: string, distro: string): boolean;
/**
 * A WSL UNC that names a distro OTHER than the pinned one — the shape both
 * shell seams refuse: the shell executor will not run commands in it (running
 * there would mean silently switching distros on path similarity), and the
 * shell-env facts describe only the pinned distro, so a foreign session gets
 * no facts rather than another distro's home and shell.
 *
 * @param value - the candidate path (any spelling; non-UNC values are not foreign).
 * @param distro - the pinned distro name.
 * @returns true when the value is a WSL UNC under a different distro.
 */
export declare function isAnotherDistrosUnc(value: string, distro: string): boolean;
/**
 * Translate a Windows drive path into its WSL interop mount.
 *
 * @param winPath - e.g. `C:\Users\andyz\Documents`.
 * @returns e.g. `/mnt/c/Users/andyz/Documents`, or undefined for a non-drive path.
 */
export declare function windowsToLinuxMount(winPath: string): string | undefined;
/**
 * Resolve a caller-supplied workdir into a path `wsl.exe --cd` accepts.
 *
 * Accepts every coordinate system, because the tool layer passes whatever the
 * session cwd is (a UNC path once the workspace is a WSL folder) while a human
 * editing the profile is likely to write a plain Linux path.
 *
 * @param value - the path to translate.
 * @param options - the pinned distro and the fallback directory for relative input.
 * @returns an absolute Linux path, or the input unchanged when it cannot be mapped.
 */
export declare function toLinuxPath(value: string, options?: WorldPathOptions): string;
/**
 * Resolve a caller-supplied path into the UNC coordinate system the host's fs
 * calls use. Linux paths from the model, UNC paths from the harness, and
 * Windows paths from the host all have to land somewhere real.
 *
 * @param value - the path to translate.
 * @param options - the PINNED DISTRO (required: a POSIX-absolute input mints
 *   its UNC identity) and the fallback directory for relative input.
 * @returns an absolute host path (UNC for anything inside the distro).
 */
export declare function toWorldPath(value: string, options?: WorldPathOptions): string;
/**
 * Render a world path back into the form the model and the UI should see: a
 * Linux path inside the distro, and the ordinary Windows path everywhere else.
 * `FsTarget.targetKey` stays the UNC path (the contract treats it as opaque);
 * only `displayPath` is rewritten.
 *
 * @param worldPath - an absolute host path.
 * @param distro - the distro whose paths should be shown as Linux paths.
 * @returns the display path.
 */
export declare function toDisplayPath(worldPath: string, distro: string): string;
/** The provider root of the WSL UNC share — the level that holds one entry per distro. */
export declare const UNC_PROVIDER_ROOT = "\\\\wsl.localhost";
/**
 * The UNC root of one distro, which is the mount point of that distro's `/`.
 * This is a complete UNC path (`\\server\share`), which is what the directory
 * picker's fully-qualified check requires and what the workspace registry
 * accepts as a project directory.
 *
 * @param distro - distro name.
 * @returns e.g. `\\wsl.localhost\ubuntu`.
 */
export declare function distroRoot(distro: string): string;
/**
 * Whether a path names the WSL share's root rather than a distro inside it.
 * Both share spellings and a trailing separator are accepted.
 *
 * @param value - candidate path.
 * @returns true for `\\wsl.localhost` and `\\wsl$` in any casing.
 */
export declare function isProviderRoot(value: string): boolean;
