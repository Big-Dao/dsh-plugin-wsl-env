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
 * @module dsh-plugin-wsl/paths
 */

/** The WSL UNC share prefix Node can read. `\\wsl$\<distro>\...` is the legacy spelling. */
const UNC_RE = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(?:\\([\s\S]*))?$/i;
const DRIVE_RE = /^([A-Za-z]):[\\/]([\s\S]*)$/;

/** Normalize Windows separators without touching a POSIX path. */
function toWindowsSlashes(value) {
  return String(value).replace(/\//g, "\\");
}

/**
 * Whether a string is the WSL UNC share rather than an ordinary Windows path.
 * @param value - candidate path.
 * @returns true for `\\wsl.localhost\...` and `\\wsl$\...`.
 */
export function isWslUnc(value) {
  return UNC_RE.test(String(value));
}

/**
 * Whether a string is POSIX-absolute. On Windows `path.isAbsolute('/home/x')`
 * is also true, so the WSL mapper must test this before falling back to the
 * host helpers.
 * @param value - candidate path.
 * @returns true when the path starts with a single forward slash.
 */
export function isPosixAbsolute(value) {
  return /^\/(?!\/)/.test(String(value));
}

/**
 * Whether a path names a location only relative to a base. The fs provider
 * consults its default workdir exactly for this input; every absolute form —
 * POSIX, drive, WSL UNC, or any other UNC share — is a location in its own
 * right and short-circuits before a base is ever needed.
 * @param value - candidate path.
 * @returns true when the path names no absolute location.
 */
export function isRelativeWorldPath(value) {
  const text = String(value ?? "");
  if (text.length === 0) return false;
  return !isWslUnc(text) && !isPosixAbsolute(text) && !DRIVE_RE.test(text) && !text.startsWith("\\");
}

/** Drop trailing separators, keeping a bare root (`C:\`, `\\wsl.localhost\x\`) meaningful. */
function trimTrailingSeparators(value) {
  return value.replace(/[\\/]+$/, "") || value;
}

/**
 * A UNC, drive, or (with a distro) Linux path as a comparable Windows key.
 * Windows semantics are case-insensitive and separator-tolerant, so the key is
 * lowercased and backslashed; a Linux path maps onto the distro's UNC share so
 * it can be compared with a target reached through that share.
 * @param value - the path to key.
 * @param distro - the distro whose share a Linux path maps onto, if any.
 * @returns the key, or undefined when the path is not in that vocabulary.
 */
function toWindowsKey(value, distro) {
  const text = String(value ?? "");
  if (text.length === 0) return undefined;
  if (DRIVE_RE.test(text) || isWslUnc(text)) {
    const key = trimTrailingSeparators(toWindowsSlashes(text)).toLowerCase();
    // A drive root trims to `c:`; without its separator back the prefix test
    // would accept a sibling like `C:\ish` as a child of `C:\`.
    return /^[a-z]:$/.test(key) ? `${key}\\` : key;
  }
  if (distro !== undefined && distro !== "" && isPosixAbsolute(text)) {
    return trimTrailingSeparators(toWindowsSlashes(posixToUnc(distro, text))).toLowerCase();
  }
  return undefined;
}

/** A POSIX-absolute path as a comparable key, without its trailing separators. */
function toPosixKey(value) {
  const text = String(value ?? "");
  if (!isPosixAbsolute(text)) return undefined;
  const trimmed = text.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

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
export function isWorldPathUnder(target, root, options = {}) {
  const winTarget = toWindowsKey(target, options.distro);
  const winRoot = toWindowsKey(root, options.distro);
  if (winTarget !== undefined && winRoot !== undefined) {
    // A drive root keeps its separator in the key, so the child boundary is
    // "root already ends with one" rather than "append another".
    const prefix = winRoot.endsWith("\\") ? winRoot : `${winRoot}\\`;
    return winTarget === winRoot || winTarget.startsWith(prefix);
  }
  const posixTarget = toPosixKey(target);
  const posixRoot = toPosixKey(root);
  if (posixTarget !== undefined && posixRoot !== undefined) {
    return posixRoot === "/" || posixTarget === posixRoot || posixTarget.startsWith(`${posixRoot}/`);
  }
  return false;
}

/**
 * Map a Linux path inside a distro onto the UNC path the host can read.
 * @param distro - distro name, e.g. `ubuntu`.
 * @param linuxPath - absolute Linux path, e.g. `/home/andy/proj`.
 * @returns the equivalent `\\wsl.localhost\<distro>\...` path.
 */
export function posixToUnc(distro, linuxPath) {
  const rest = String(linuxPath).replace(/^\/+/, "").replace(/\//g, "\\");
  return `\\\\wsl.localhost\\${distro}\\${rest}`.replace(/\\+$/, "\\");
}

/**
 * Map a WSL UNC path back onto the distro and Linux path it names.
 * @param uncPath - a `\\wsl.localhost\<distro>\...` path.
 * @returns `{ distro, linuxPath }`, or undefined for any other path.
 */
export function uncToPosix(uncPath) {
  const match = UNC_RE.exec(String(uncPath));
  if (!match?.[1]) return undefined;
  const rest = (match[2] ?? "").replace(/\\/g, "/");
  return { distro: match[1], linuxPath: rest.length > 0 ? `/${rest}` : "/" };
}

/**
 * Whether a UNC path belongs to the named distro. Used to confine the WSL
 * filesystem backend to one distro instead of silently serving every mounted
 * share.
 * @param uncPath - candidate UNC path.
 * @param distro - the distro this session is pinned to.
 * @returns true when the path is the same distro (case-insensitive).
 */
export function isUnderDistro(uncPath, distro) {
  const parsed = uncToPosix(uncPath);
  return parsed !== undefined && parsed.distro.toLowerCase() === String(distro).toLowerCase();
}

/**
 * A WSL UNC that names a distro OTHER than the pinned one — the shape both
 * shell seams refuse: the shell executor will not run commands in it (running
 * there would mean silently switching distros on path similarity), and the
 * shell-env facts describe only the pinned distro, so a foreign session gets
 * no facts rather than another distro's home and shell.
 * @param uncPath - the candidate path (any spelling; non-UNC values are not foreign).
 * @param distro - the pinned distro name.
 * @returns true when the value is a WSL UNC under a different distro.
 */
export function isAnotherDistrosUnc(value, distro) {
  return isWslUnc(value) && !isUnderDistro(value, distro);
}

/**
 * Translate a Windows drive path into its WSL interop mount.
 * @param winPath - e.g. `C:\Users\andyz\Documents`.
 * @returns e.g. `/mnt/c/Users/andyz/Documents`, or undefined for a non-drive path.
 */
export function windowsToLinuxMount(winPath) {
  const match = DRIVE_RE.exec(String(winPath));
  if (!match?.[1]) return undefined;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

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
export function toLinuxPath(value, options) {
  const text = String(value ?? "");
  if (text.length === 0) return text;
  const parsed = uncToPosix(text);
  if (parsed !== undefined) return parsed.linuxPath;
  if (isPosixAbsolute(text)) return text;
  const mounted = windowsToLinuxMount(text);
  if (mounted !== undefined) return mounted;
  // Relative input is resolved against the configured default workdir.
  const base = options?.cwd ?? "/";
  const baseLinux = toLinuxPath(base, { distro: options?.distro });
  return `${baseLinux.replace(/\/+$/, "")}/${text.replace(/^\.\//, "")}`;
}

/**
 * Resolve a caller-supplied path into the UNC coordinate system the host's fs
 * calls use. Linux paths from the model, UNC paths from the harness, and
 * Windows paths from the host all have to land somewhere real.
 *
 * @param value - the path to translate.
 * @param options - the pinned distro and the fallback directory for relative input.
 * @returns an absolute host path (UNC for anything inside the distro).
 */
export function toWorldPath(value, options) {
  const text = String(value ?? "");
  if (text.length === 0) return text;
  if (isWslUnc(text)) return toWindowsSlashes(text);
  if (isPosixAbsolute(text)) return posixToUnc(options?.distro ?? "Ubuntu", text);
  if (DRIVE_RE.test(text)) return toWindowsSlashes(text);
  // Any other UNC share is already a world path in its own right — the host
  // can open it directly, and joining it onto a base would name a file that
  // exists nowhere.
  if (text.startsWith("\\")) return toWindowsSlashes(text);
  const base = options?.cwd ?? process.cwd();
  const baseWorld = toWorldPath(base, { distro: options?.distro });
  return `${baseWorld.replace(/[\\/]+$/, "")}\\${toWindowsSlashes(text).replace(/^\.\\/, "")}`;
}

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
export function toDisplayPath(worldPath, distro) {
  const parsed = uncToPosix(worldPath);
  if (parsed !== undefined && parsed.distro.toLowerCase() === String(distro).toLowerCase()) return parsed.linuxPath;
  return String(worldPath);
}

/** The provider root of the WSL UNC share — the level that holds one entry per distro. */
export const UNC_PROVIDER_ROOT = "\\\\wsl.localhost";

/**
 * The UNC root of one distro, which is the mount point of that distro's `/`.
 * This is a complete UNC path (`\\server\share`), which is what the directory
 * picker's fully-qualified check requires and what the workspace registry
 * accepts as a project directory.
 *
 * @param distro - distro name.
 * @returns e.g. `\\wsl.localhost\ubuntu`.
 */
export function distroRoot(distro) {
  return `${UNC_PROVIDER_ROOT}\\${distro}`;
}

/**
 * Whether a path names the WSL share's root rather than a distro inside it.
 * Both share spellings and a trailing separator are accepted.
 *
 * @param value - candidate path.
 * @returns true for `\\wsl.localhost` and `\\wsl$` in any casing.
 */
export function isProviderRoot(value) {
  const trimmed = String(value).replace(/[\\/]+$/, "").toLowerCase();
  return trimmed === UNC_PROVIDER_ROOT.toLowerCase() || trimmed === "\\\\wsl$";
}
