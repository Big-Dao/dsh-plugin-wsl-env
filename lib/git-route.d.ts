/**
 * Whether a spawn's program is git.
 * @param {unknown} program - the spawn's `argv[0]`.
 * @returns {boolean} true when the spawn is a git launch.
 */
export function isGitProgram(program: unknown): boolean;
/**
 * Translate one `GIT_*` value into the distro's coordinate system.
 *
 * UNC identities (`\\wsl.localhost\<distro>\...`) map onto their Linux paths;
 * drive-letter paths map onto their `/mnt/<drive>` mounts; anything else is
 * not a path we can name and passes through verbatim.
 *
 * @param {string|undefined} value - the env value.
 * @returns {string|undefined} the distro-side spelling of the value.
 */
export function translateGitEnvValue(value: string | undefined): string | undefined;
/**
 * Translate a git spawn's environment for the distro and name the keys that
 * must ride `WSLENV`.
 *
 * @param {Record<string, string|undefined>|undefined} env - the spawn's environment, or undefined.
 * @returns {{env: Record<string, string|undefined>, wslenv: string[]}} the environment to forward (every key, path-shaped values
 *   translated) and the `WSLENV` names.
 */
export function translateGitEnv(env: Record<string, string | undefined> | undefined): {
    env: Record<string, string | undefined>;
    wslenv: string[];
};
/**
 * The distro-side rewrite of one git spawn, when it belongs in the distro.
 *
 * `gitArgv` is the distro command itself; `wslArgv` is the same command
 * wrapped for a one-shot `wsl.exe --exec` launch — git snapshot operations
 * are not latency-sensitive, so the routing stays on the simple transport
 * and does not need the resident agent. `wsl.exe` itself must start in a
 * Windows directory, so the caller supplies its own host cwd.
 *
 * @param {object} object - the spawn's inputs.
 * @param {readonly string[]} [object.argv] - the spawn's argv; `argv[0]` is the program. Absent spawns pass through untouched.
 * @param {string} [object.cwd] - the spawn's working directory, any coordinate system; absent (or not a distro path) keeps the shipped spawn.
 * @param {string} object.wslPath - path to `wsl.exe`.
 * @returns {{distro: string, linuxCwd: string, gitArgv: string[], wslArgv: string[]}|undefined} the
 *   rewrite, or undefined when the spawn is not a routable distro git launch
 *   (non-git programs, host directories, and the absolute-output discovery
 *   flags all keep the shipped spawn).
 */
export function gitSpawnRewrite({ argv, cwd, wslPath }: {
    argv?: readonly string[] | undefined;
    cwd?: string | undefined;
    wslPath: string;
}): {
    distro: string;
    linuxCwd: string;
    gitArgv: string[];
    wslArgv: string[];
} | undefined;
