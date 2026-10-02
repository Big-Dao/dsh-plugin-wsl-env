/**
 * The in-distro publication step for `WslFileSystem.writeText`/`editText`.
 *
 * Today's publication is two round trips: `copyModeInDistro` (one `wsl.exe`
 * chmod) plus the staged file's rename over the 9p share. Under the resident
 * agent it collapses into ONE `exec`: a small POSIX shell step that copies the
 * replaced file's mode onto the staged temp (`chmod --reference`, skipped for
 * a creation, where there is nothing to copy from) and renames it into place
 * atomically — the rename preserving the inode's mode bits, exactly as the
 * old path arranged.
 *
 * Pure by construction: this module only builds the argv; execution and
 * fallback belong to the caller.
 *
 * @module dsh-plugin-wsl/fs-publish
 */

/**
 * The publication script. `$1` is the target's Linux path (may not exist —
 * a creation), `$2` the staged temp's Linux path (always exists).
 * @returns {string} the `sh -c` body.
 */
export function publicationScript() {
  return [
    // Creation: there is no source mode; the staged file keeps its umask mode,
    // which is exactly what the old two-step path produced for new files.
    'if [ -e "$1" ]; then',
    '  chmod --reference="$1" "$2" || exit 3',
    'fi',
    'mv -f "$2" "$1" || exit 4',
  ].join("\n");
}

/**
 * The argv to execute inside the distro for one publication.
 * @param {string} targetLinuxPath - the file being written.
 * @param {string} stagedLinuxPath - the staged temp holding the new content.
 * @returns {string[]} the argv, ready for the agent (or a one-shot `wsl.exe`).
 */
export function publicationArgv(targetLinuxPath, stagedLinuxPath) {
  return ["sh", "-c", publicationScript(), "publish", targetLinuxPath, stagedLinuxPath];
}
