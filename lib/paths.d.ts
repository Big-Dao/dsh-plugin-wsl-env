/**
 * Whether a string is the WSL UNC share rather than an ordinary Windows path.
 * @param {string} value - candidate path.
 * @returns {boolean} true for `\\wsl.localhost\...` and `\\wsl$\...`.
 */
export function isWslUnc(value: string): boolean;
/**
 * Whether a string is POSIX-absolute. On Windows `path.isAbsolute('/home/x')`
 * is also true, so the WSL mapper must test this before falling back to the
 * host helpers.
 * @param {string} value - candidate path.
 * @returns {boolean} true when the path starts with a single forward slash.
 */
export function isPosixAbsolute(value: string): boolean;
/**
 * Whether a path names a location only relative to a base. The fs provider
 * consults its default workdir exactly for this input; every absolute form —
 * POSIX, drive, WSL UNC, or any other UNC share — is a location in its own
 * right and short-circuits before a base is ever needed.
 * @param {string} value - candidate path.
 * @returns {boolean} true when the path names no absolute location.
 */
export function isRelativeWorldPath(value: string): boolean;
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
 * @param {string} target - the path being tested, in any coordinate system.
 * @param {string} root - the granted root, in any coordinate system.
 * @param {WorldPathOptions} [options] - the distro that maps a Linux root onto its UNC share.
 * @returns {boolean} true when target is root itself or a descendant of it.
 */
export function isWorldPathUnder(target: string, root: string, options?: WorldPathOptions): boolean;
/**
 * Map a Linux path inside a distro onto the UNC path the host can read.
 * @param {string} distro - distro name, e.g. `ubuntu`.
 * @param {string} linuxPath - absolute Linux path, e.g. `/home/andy/proj`.
 * @returns {string} the equivalent `\\wsl.localhost\<distro>\...` path.
 */
export function posixToUnc(distro: string, linuxPath: string): string;
/**
 * Map a WSL UNC path back onto the distro and Linux path it names.
 * @param {string} [uncPath] - a `\\wsl.localhost\<distro>\...` path; absent is not a UNC path.
 * @returns {DistroPath | undefined} the distro and Linux path, or undefined for any other path.
 */
export function uncToPosix(uncPath?: string): DistroPath | undefined;
/**
 * Whether a UNC path belongs to the named distro. Used to confine the WSL
 * filesystem backend to one distro instead of silently serving every mounted
 * share.
 * @param {string} uncPath - candidate UNC path.
 * @param {string} distro - the distro this session is pinned to.
 * @returns {boolean} true when the path is the same distro (case-insensitive).
 */
export function isUnderDistro(uncPath: string, distro: string): boolean;
/**
 * A WSL UNC that names a distro OTHER than the pinned one — the shape both
 * shell seams refuse: the shell executor will not run commands in it (running
 * there would mean silently switching distros on path similarity), and the
 * shell-env facts describe only the pinned distro, so a foreign session gets
 * no facts rather than another distro's home and shell.
 * @param {string} value - the candidate path (any spelling; non-UNC values are not foreign).
 * @param {string} distro - the pinned distro name.
 * @returns {boolean} true when the value is a WSL UNC under a different distro.
 */
export function isAnotherDistrosUnc(value: string, distro: string): boolean;
/**
 * Translate a Windows drive path into its WSL interop mount.
 * @param {string} winPath - e.g. `C:\Users\andyz\Documents`.
 * @returns {string | undefined} e.g. `/mnt/c/Users/andyz/Documents`, or undefined for a non-drive path.
 */
export function windowsToLinuxMount(winPath: string): string | undefined;
/**
 * Resolve a caller-supplied workdir into a path `wsl.exe --cd` accepts.
 *
 * Accepts every coordinate system, because the tool layer passes whatever the
 * session cwd is (a UNC path once the workspace is a WSL folder) while a human
 * editing the profile is likely to write a plain Linux path.
 *
 * @param {string} value - the path to translate.
 * @param {WorldPathOptions} [options] - the pinned distro and the fallback directory for relative input.
 * @returns {string} an absolute Linux path, or the input unchanged when it cannot be mapped.
 */
export function toLinuxPath(value: string, options?: WorldPathOptions): string;
/**
 * Resolve a caller-supplied path into the UNC coordinate system the host's fs
 * calls use. Linux paths from the model, UNC paths from the harness, and
 * Windows paths from the host all have to land somewhere real.
 *
 * @param {string} value - the path to translate.
 * @param {WorldPathOptions} [options] - the PINNED DISTRO (required: a POSIX-absolute input mints
 *   its UNC identity) and the fallback directory for relative input.
 * @returns {string} an absolute host path (UNC for anything inside the distro).
 */
export function toWorldPath(value: string, options?: WorldPathOptions): string;
/**
 * Render a world path back into the form the model and the UI should see: a
 * Linux path inside the distro, and the ordinary Windows path everywhere else.
 * `FsTarget.targetKey` stays the UNC path (the contract treats it as opaque);
 * only `displayPath` is rewritten.
 *
 * @param {string} worldPath - an absolute host path.
 * @param {string} distro - the distro whose paths should be shown as Linux paths.
 * @returns {string} the display path.
 */
export function toDisplayPath(worldPath: string, distro: string): string;
/**
 * The UNC root of one distro, which is the mount point of that distro's `/`.
 * This is a complete UNC path (`\\server\share`), which is what the directory
 * picker's fully-qualified check requires and what the workspace registry
 * accepts as a project directory.
 *
 * @param {string} distro - distro name.
 * @returns {string} e.g. `\\wsl.localhost\ubuntu`.
 */
export function distroRoot(distro: string): string;
/**
 * Whether a path names the WSL share's root rather than a distro inside it.
 * Both share spellings and a trailing separator are accepted.
 *
 * @param {string} value - candidate path.
 * @returns {boolean} true for `\\wsl.localhost` and `\\wsl$` in any casing.
 */
export function isProviderRoot(value: string): boolean;
/** The provider root of the WSL UNC share — the level that holds one entry per distro. */
export const UNC_PROVIDER_ROOT: "\\\\wsl.localhost";
/**
 * A distro identity and the Linux path inside it, as {@link uncToPosix} returns.
 */
export type DistroPath = {
    /**
     * - the distro name the UNC named.
     */
    distro: string;
    /**
     * - an absolute POSIX path inside that distro.
     */
    linuxPath: string;
};
/**
 * What the two world-path translators may consult: the pinned distro and the
 * fallback directory for relative input.
 */
export type WorldPathOptions = {
    /**
     * - the pinned distro, which maps a POSIX-absolute
     * input onto its UNC identity in {@link toWorldPath}.
     */
    distro?: string | undefined;
    /**
     * - the directory relative input resolves against.
     */
    cwd?: string | undefined;
};
