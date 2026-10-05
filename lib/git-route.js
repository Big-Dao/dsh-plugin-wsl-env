/**
 * Which git spawns belong inside the distro, and the `wsl.exe` argv they
 * become there.
 *
 * `workspace-changes` snapshots a workspace's git state by spawning the host
 * git through `ctx.subprocess` with the workspace as the working directory.
 * On a distro workspace that spawn runs Windows git against the 9P share —
 * the same slow direction as the search path, and the snapshot's
 * `git add --all` is a full work-tree scan, the most metadata-heavy operation
 * there is. The interception point is the same `spawn` override; the decision
 * lives here, pure and unit-testable, mirroring `search-route.js`.
 *
 * ## What is routed, and what deliberately is not
 *
 * A spawn is routed only when the working directory names the distro (a
 * `\\wsl.localhost\<distro>` UNC) and the argv carries none of the discovery
 * flags (`--show-toplevel`, `--absolute-git-dir`, `--git-path`). Those three
 * print **absolute paths**, which `workspace-changes` resolves against the
 * UNC workspace (`git.ts` `resolve(cwd, line)`) — a distro git would answer
 * in Linux paths and corrupt that resolution. Host git answers in UNC form,
 * which is exactly what the caller wants, and the discovery call is one
 * cheap command rather than a work-tree scan. Everything else — `add`,
 * `write-tree`, `ls-tree`, `cat-file`, `diff-tree`, `ls-files`,
 * `check-ignore` — is safe to route: snapshot calls run in an environment
 * fully isolated from the user's git state (`GIT_INDEX_FILE` /
 * `GIT_OBJECT_DIRECTORY` / `GIT_ALTERNATE_OBJECT_DIRECTORIES` pointing at the
 * tool's private scratch), so the distro git mutates scratch, never the
 * repository.
 *
 * ## Environment translation
 *
 * The routed spawn must forward the caller's `GIT_*` environment into the
 * distro, and its values are paths in Windows form (`\\wsl.localhost\...`
 * identities and drive-letter scratch dirs). `translateGitEnv` rewrites those
 * two shapes into distro paths with the same pure translations the fs seam
 * uses, forwards every other value verbatim (`GIT_CONFIG_COUNT=0` and
 * friends), and returns the names that must ride `WSLENV`. One documented
 * limit: a colon-separated multi-directory value (none of the current
 * callers set one) passes through untranslated.
 *
 * @module dsh-plugin-wsl/git-route
 */

import { isWslUnc, uncToPosix, windowsToLinuxMount } from "./paths.js";

/** The one program this rewrite passes through to the distro. */
const GIT_PROGRAM = "git";

/** Discovery flags print absolute paths — host git keeps that contract. */
const DISCOVERY_FLAGS = ["--show-toplevel", "--absolute-git-dir", "--git-path"];

/**
 * Whether a spawn's program is git.
 * @param {unknown} program - the spawn's `argv[0]`.
 * @returns {boolean} true when the spawn is a git launch.
 */
export function isGitProgram(program) {
  if (typeof program !== "string" || program.length === 0) return false;
  const base = program.slice(Math.max(program.lastIndexOf("/"), program.lastIndexOf("\\")) + 1);
  return base.toLowerCase().replace(/\.exe$/u, "") === GIT_PROGRAM;
}

/**
 * Whether a git argv carries the discovery flags whose absolute output the
 * caller resolves against the UNC world.
 * @param {readonly unknown[]} argv - the spawn's argv; `argv[0]` is the program.
 * @returns {boolean} true when the spawn must stay on host git.
 */
function namesDiscoveryPaths(argv) {
  return argv.some((arg) => typeof arg === "string" && DISCOVERY_FLAGS.includes(arg));
}

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
export function translateGitEnvValue(value) {
  if (typeof value !== "string") return value;
  if (isWslUnc(value)) {
    const parsed = uncToPosix(value);
    return parsed === undefined ? value : parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
  }
  const mounted = windowsToLinuxMount(value);
  return mounted === undefined ? value : mounted;
}

/**
 * Translate a git spawn's environment for the distro and name the keys that
 * must ride `WSLENV`.
 *
 * @param {Record<string, string|undefined>|undefined} env - the spawn's environment, or undefined.
 * @returns {{env: Record<string, string|undefined>, wslenv: string[]}} the environment to forward (every key, path-shaped values
 *   translated) and the `WSLENV` names.
 */
export function translateGitEnv(env) {
  /** @type {Record<string, string|undefined>} */
  const translated = {};
  const names = [];
  for (const [name, value] of Object.entries(env ?? {})) {
    translated[name] = name.startsWith("GIT_") ? translateGitEnvValue(value) : value;
    names.push(name);
  }
  return { env: translated, wslenv: names };
}

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
 * @param {readonly string[]} object.argv - the spawn's argv; `argv[0]` is the program.
 * @param {string} object.cwd - the spawn's working directory, any coordinate system.
 * @param {string} object.wslPath - path to `wsl.exe`.
 * @returns {{distro: string, linuxCwd: string, gitArgv: string[], wslArgv: string[]}|undefined} the
 *   rewrite, or undefined when the spawn is not a routable distro git launch
 *   (non-git programs, host directories, and the absolute-output discovery
 *   flags all keep the shipped spawn).
 */
export function gitSpawnRewrite({ argv, cwd, wslPath }) {
  if (!Array.isArray(argv) || !isGitProgram(argv[0])) return undefined;
  if (namesDiscoveryPaths(argv)) return undefined;
  const named = uncToPosix(cwd);
  if (named === undefined) return undefined;
  const linuxCwd = named.linuxPath.length > 0 ? named.linuxPath : "/";
  const gitArgv = [GIT_PROGRAM, ...argv.slice(1)];
  return {
    distro: named.distro,
    linuxCwd,
    gitArgv,
    wslArgv: [wslPath, "-d", named.distro, "--cd", linuxCwd, "--exec", ...gitArgv],
  };
}
