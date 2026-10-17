/**
 * Pure builders and parsers for the distro-routed `workspace-files` service —
 * the GUI file tree and previews for a `\\wsl.localhost\<distro>` workspace,
 * served from inside the distro instead of Windows-side 9P walks.
 *
 * Peer-free by construction (no DSH imports): the service subclass imports
 * this alongside the shipped `dsh-api-workspace-files` base class, and the
 * unit tests import it standalone.
 *
 * This is a TypeScript source built to `lib/workspace-files-route.js`; edit
 * THIS file and run `pnpm run build` — the artifact under `lib/` is generated,
 * and `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/workspace-files-route
 */

import { isWslUnc, uncToPosix, windowsToLinuxMount } from "./paths.js";

/**
 * Translate one path-shaped value into distro coordinates: UNC identities map
 * onto their Linux paths, drive-letter paths onto their `/mnt/<drive>` mounts,
 * everything else passes through verbatim.
 *
 * @param value - the value to translate.
 * @returns the distro-side spelling.
 */
export function distroPath(value: string): string {
  if (typeof value !== "string") return value;
  if (isWslUnc(value)) {
    const parsed = uncToPosix(value);
    return parsed === undefined ? value : parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
  }
  const mounted = windowsToLinuxMount(value);
  return mounted === undefined ? value : mounted;
}

/**
 * Whether a workspace root belongs to a distro (and therefore routes
 * distro-side).
 *
 * @param workspaceRoot - the scope's workspace root, any coordinate system.
 * @returns true for a `\\wsl.localhost\<distro>` UNC root.
 */
export function isDistroWorkspace(workspaceRoot: string): boolean {
  return isWslUnc(workspaceRoot);
}

/**
 * The Linux working path for one request: UNC absolutes map onto their Linux
 * paths, POSIX absolutes and relative paths join onto the root.
 *
 * @param linuxRoot - the workspace root in Linux form.
 * @param path - the requested path, any coordinate system.
 * @returns the absolute Linux path.
 */
export function linuxJoin(linuxRoot: string, path: string): string {
  // The UNC check runs on the RAW spelling: the backslash-to-slash rewrite
  // below would leave `//wsl.localhost/...`, which the identity regex cannot
  // see.
  const parsed = uncToPosix(path);
  if (parsed !== undefined) return parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
  const text = String(path).replaceAll("\\", "/");
  if (text.startsWith("/")) return text.length > 1 ? text.replace(/\/+$/, "") : "/";
  const base = linuxRoot === "/" ? "" : linuxRoot;
  const joined = text.length === 0 ? base : `${base}/${text}`.replace(/\/\.(?=\/|$)/gu, "");
  return joined.length === 0 ? "/" : joined;
}

/**
 * The containment guard every distro-side workspace read shares. `$1` is the
 * requested file, `$2` the workspace root; both are canonicalized with
 * `realpath -L`, and a target that is neither the root itself nor below it is
 * refused with exit 3 (the `workspace-file/outside-workspace` refusal). The
 * resolved file is left in `real` for the rest of the script.
 *
 * A root of `/` admits every absolute path: the workspace IS the distro. The
 * `-L` spelling matches the listing guard's, so symlinked workspace roots and
 * `..` segments resolve the same way on both sides.
 */
const CONTAIN_FN = [
  'contain() {',
  '  real=$(realpath -L -- "$1") || exit 2',
  '  root=$(realpath -L -- "$2") || exit 2',
  '  case "$root" in /) ;; *) case "$real" in "$root"|"$root"/*) ;; *) echo "OUTSIDE:$real" >&2; exit 3;; esac;; esac',
  '}',
].join("\n");

/**
 * The record invocation for one path: line 1 is the no-follow kind (the
 * upstream lstat gate), line 2 the follow-stat fields (the upstream final
 * stat), tab-joined. The path is resolved and contained first — the GUI's
 * workspace is a boundary for every read, not just for listings.
 *
 * @param file - absolute Linux path.
 * @param root - the workspace root in Linux form (containment boundary).
 * @returns the agent argv.
 */
export function statRecordArgv(file: string, root: string): string[] {
  const script = [
    CONTAIN_FN,
    'contain "$1" "$2"',
    'k=$(stat -c %F -- "$real") || exit 2',
    's=$(stat -L -c %s\\t%D\\t%i\\t%Y\\t%Z -- "$real") || exit 2',
    "printf '%s\\t%s\\n' \"$k\" \"$s\"",
  ].join("\n");
  return ["sh", "-c", script, "sh", file, root];
}

/**
 * Parse one stat record (kind + follow fields, tab-joined).
 *
 * @param line - the record line.
 * @returns the upstream kind spelling, the byte size, and the synthesized
 *   opaque version.
 */
export function parseStatRecord(line: string | Buffer): { kind: string, type: string, size: number, version: string } {
  const [kind, size, dev, ino, mtime, ctime] = String(line).trim().split("\t") as [string, string, string, string, string, string];
  return {
    kind,
    type: wireKind(kind),
    size: Number(size),
    version: `${dev}:${ino}:${size}:${mtime}:${ctime}`,
  };
}

/**
 * Map a `stat` kind onto the wire's kind token.
 *
 * @param kind - the `stat -c %F` spelling.
 * @returns the wire kind token.
 */
export function wireKind(kind: string): string {
  const mapped: Record<string, string> = { "regular file": "file", directory: "directory", "symbolic link": "symlink" };
  return mapped[kind] ?? kind;
}

/**
 * The read invocation for one line-paged text read: the stat record rides
 * stderr (the caller builds the stat half of the response), the page rides
 * stdout — one line beyond the page, so EOF is decidable from the yield.
 * `$1` is the file, `$2` the 1-based first line, `$3` the line count.
 *
 * @param file - absolute Linux path.
 * @param offset - first line to return (1-based).
 * @param limit - maximum lines to return.
 * @param root - the workspace root in Linux form (containment boundary).
 * @returns the agent argv.
 */
export function pageArgv(file: string, offset: number, limit: number, root: string): string[] {
  const script = [
    CONTAIN_FN,
    'contain "$1" "$4"',
    'k=$(stat -c %F -- "$real") || exit 2',
    's=$(stat -L -c %s\\t%D\\t%i\\t%Y\\t%Z -- "$real") || exit 2',
    "printf '%s\\t%s\\n' \"$k\" \"$s\" >&2",
    'sed -n "${2},$(( $2 + $3 ))p" -- "$real"',
  ].join("\n");
  return ["sh", "-c", script, "sh", file, String(offset), String(limit), root];
}

/**
 * The byte-window invocation: the stat record rides stderr, the window rides
 * stdout. `$1` is the file, `$2` the byte offset, `$3` the byte count.
 *
 * @param file - absolute Linux path.
 * @param offset - byte offset (0-based).
 * @param length - byte count.
 * @param root - the workspace root in Linux form (containment boundary).
 * @returns the agent argv.
 */
export function bytesArgv(file: string, offset: number, length: number, root: string): string[] {
  const script = [
    CONTAIN_FN,
    'contain "$1" "$4"',
    's=$(stat -L -c %s\\t%D\\t%i\\t%Y\\t%Z -- "$real") || exit 2',
    "printf '%s\\n' \"$s\" >&2",
    'tail -c "+$(( $2 + 1 ))" -- "$real" | head -c "$3"',
  ].join("\n");
  return ["sh", "-c", script, "sh", file, String(offset), String(length), root];
}

/**
 * Parse the stat record a read or byte-window relayed on stderr.
 *
 * @param stderr - the relay's raw stderr.
 * @returns the parsed stat record, or undefined when stderr carries none.
 */
export function parseStatRecordFromStderr(stderr: string | Buffer): { kind: string, type: string, size: number, version: string } | undefined {
  const line = String(stderr)
    .split("\n")
    .find((candidate) => candidate.includes("\t"));
  return line === undefined ? undefined : parseStatRecord(line);
}

/**
 * The listing invocation for one directory: resolve the final component
 * through symlinks, refuse paths outside the root and non-directories, then
 * list one more entry than the cap so truncation is decidable from the yield.
 * `-L` matches the upstream child semantics (a symlink to a directory lists
 * as a directory, a broken link drops out); `-p` marks directories with the
 * trailing `/` the parser keys on.
 *
 * @param linuxRoot - the workspace root in Linux form (containment boundary).
 * @param linuxDir - the directory to list.
 * @param maxEntries - the caller's entry cap.
 * @returns the agent argv.
 */
export function listDistroArgv(linuxRoot: string, linuxDir: string, maxEntries: number): string[] {
  const script = [
    "root=$1 dir=$2 max=$3",
    'real=$(realpath -L -- "$dir") || exit 2',
    'case "$real" in "$root") ;; "$root"/*) ;; *) echo "OUTSIDE:$real" >&2; exit 3;; esac',
    '[ -d "$real" ] || { echo "NOTDIR:$real" >&2; exit 4; }',
    'ls -1ALp -- "$real" | head -n "$max"',
  ].join("\n");
  return ["sh", "-c", script, "sh", linuxRoot, linuxDir, String(maxEntries + 1)];
}

/**
 * Parse one capped `ls -1ALp` listing into wire entries.
 *
 * @param stdout - the listing's raw stdout.
 * @param maxEntries - the entry cap the caller configured.
 * @returns at most `maxEntries` entries and whether the level had more.
 */
export function parseDirListing(stdout: string | Buffer, maxEntries: number): { entries: Array<{ name: string, type: "file" | "directory" }>, truncated: boolean } {
  const lines = String(stdout).split("\n").filter((line) => line.length > 0);
  const truncated = lines.length > maxEntries;
  const entries = lines.slice(0, maxEntries).map((line) => {
    const directory = line.endsWith("/");
    const name = directory ? line.slice(0, -1) : line;
    return { name, type: directory ? "directory" : "file" } as { name: string, type: "file" | "directory" };
  });
  return { entries, truncated };
}
