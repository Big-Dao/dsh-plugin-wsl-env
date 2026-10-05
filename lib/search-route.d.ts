/**
 * Whether a spawn's program is the ripgrep binary.
 *
 * A bare `argv[0]` is judged by its own name, so the packaged binary's
 * absolute path and any other spelling of `rg` match alike.
 *
 * @param {unknown} program - the spawn's `argv[0]`.
 * @returns {boolean} true when the spawn is a ripgrep launch.
 */
export function isSearchProgram(program: unknown): boolean;
/**
 * The distro-side rewrite of one search spawn, when it belongs in the distro.
 *
 * Two argv forms come back for one decision. `rgArgv` is the distro command
 * itself (`rg` and its arguments) — what the resident agent execs. `wslArgv`
 * is the same command wrapped for a one-shot `wsl.exe --exec` launch — the
 * fallback transport for when the agent is out. The working directory becomes
 * the `--cd` the distro starts in; `wsl.exe` itself must start in a Windows
 * directory, so the caller supplies its own host cwd when applying `wslArgv`.
 *
 * @param {object} object - the spawn's inputs.
 * @param {readonly string[]} object.argv - the spawn's argv; `argv[0]` is the program.
 * @param {string} object.cwd - the spawn's working directory, any coordinate system.
 * @param {string} object.wslPath - path to `wsl.exe`.
 * @returns {{distro: string, linuxCwd: string, rgArgv: string[], wslArgv: string[]}|undefined} the
 *   rewrite, or undefined when the spawn is not a distro search and must run
 *   exactly as the shipped implementation would run it.
 */
export function searchSpawnRewrite({ argv, cwd, wslPath }: {
    argv: readonly string[];
    cwd: string;
    wslPath: string;
}): {
    distro: string;
    linuxCwd: string;
    rgArgv: string[];
    wslArgv: string[];
} | undefined;
