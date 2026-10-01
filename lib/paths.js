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
