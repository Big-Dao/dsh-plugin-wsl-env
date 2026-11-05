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
 * `\\wsl.localhost\\<distro>` UNC). Inside that, two cases:
 *
 * - **Snapshot calls** (`add`, `write-tree`, `ls-tree`, `cat-file`,
 *   `diff-tree`, `ls-files`, `check-ignore`) route whenever the program is
 *   git — the runs are fully isolated from the user's git state
 *   (`GIT_INDEX_FILE` / `GIT_OBJECT_DIRECTORY` /
 *   `GIT_ALTERNATE_OBJECT_DIRECTORIES` pointing at the tool's private
 *   scratch), so the distro git mutates scratch, never the repository.
 * - **Discovery calls** (`--show-toplevel`, `--absolute-git-dir`, `--git-path`)
 *   print absolute paths that the caller resolves against the UNC workspace,
 *   so a distro answer in Linux paths would corrupt that resolution. They
 *   route only when the program is the SENTINEL path `DISTRO_GIT_SENTINEL` —
 *   the guard `resolveExecutable` returns when the HOST has no git — and the
 *   facade translates the output lines into UNC form before the caller sees
 *   them (`translateDiscoveryOutput`). A host-resolved git keeps the shipped
 *   host-side discovery, which answers UNC natively (and needs the documented
 *   `safe.directory` whitelist for WSL shares).
 *
 * The split means a machine without Windows git still gets full WSL change
 * review: the sentinel resolves, every spawn routes, nothing touches the
 * host. See `lib/git-exec.js` for the facade side.
 *
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
 * This is a TypeScript source built to `lib/git-route.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/git-route
 */
import { isWslUnc, uncToPosix, windowsToLinuxMount } from "./paths.js";
/** The one program this rewrite passes through to the distro. */
const GIT_PROGRAM = "git";
/**
 * The program path `resolveExecutable` returns for git when the HOST has no
 * git: a Linux absolute path that only makes sense inside the distro, so any
 * spawn carrying it must route (and a discovery spawn's output must come back
 * translated). Chosen to match a standard distro install so the argv stays
 * honest even where it is read verbatim.
 */
export const DISTRO_GIT_SENTINEL = "/usr/bin/git";
/** Discovery flags print absolute paths — the caller resolves them. */
const DISCOVERY_FLAGS = ["--show-toplevel", "--absolute-git-dir", "--git-path"];
/**
 * Whether a spawn's program is git.
 *
 * @param program - the spawn's `argv[0]`.
 * @returns true when the spawn is a git launch.
 */
export function isGitProgram(program) {
    if (typeof program !== "string" || program.length === 0)
        return false;
    const base = program.slice(Math.max(program.lastIndexOf("/"), program.lastIndexOf("\\")) + 1);
    return base.toLowerCase().replace(/\.exe$/u, "") === GIT_PROGRAM;
}
/**
 * Whether a git argv carries the discovery flags whose absolute output the
 * caller resolves against the UNC world.
 *
 * @param argv - the spawn's argv; `argv[0]` is the program.
 * @returns true when the spawn must stay on host git.
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
 * @param value - the env value.
 * @returns the distro-side spelling of the value.
 */
export function translateGitEnvValue(value) {
    if (typeof value !== "string")
        return value;
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
 * @param env - the spawn's environment, or undefined.
 * @returns the environment to forward (every key, path-shaped values
 *   translated) and the `WSLENV` names.
 */
export function translateGitEnv(env) {
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
 * @param object - the spawn's inputs.
 * @returns the rewrite, or undefined when the spawn is not a routable distro
 *   git launch (non-git programs, host directories, and the absolute-output
 *   discovery flags all keep the shipped spawn).
 */
export function gitSpawnRewrite({ argv, cwd, wslPath }) {
    if (!Array.isArray(argv) || !isGitProgram(argv[0]))
        return undefined;
    const sentinel = argv[0] === DISTRO_GIT_SENTINEL;
    if (namesDiscoveryPaths(argv) && !sentinel)
        return undefined;
    const named = uncToPosix(cwd);
    if (named === undefined)
        return undefined;
    const linuxCwd = named.linuxPath.length > 0 ? named.linuxPath : "/";
    const gitArgv = [GIT_PROGRAM, ...argv.slice(1)];
    return {
        distro: named.distro,
        linuxCwd,
        gitArgv,
        wslArgv: [wslPath, "-d", named.distro, "--cd", linuxCwd, "--exec", ...gitArgv],
        discovery: sentinel && namesDiscoveryPaths(argv),
    };
}
/**
 * Translate one routed discovery call's stdout into the caller's UNC
 * coordinate system: every absolute Linux path line becomes
 * `\\wsl.localhost\<distro><path>`; relative lines (`--git-path` answers
 * `.git/objects` when the repository is not bare) pass through untouched,
 * because the caller resolves them against the UNC cwd natively.
 *
 * @param distro - the distro the discovery ran in.
 * @param stdout - the distro git's captured stdout.
 * @returns the stdout with absolute path lines rewritten.
 */
export function translateDiscoveryOutput(distro, stdout) {
    const text = stdout.toString("utf8");
    if (!text.includes("\n") && !text.startsWith("/"))
        return stdout;
    const translated = text.split("\n").map((line) => line.startsWith("/")
        ? `\\\\wsl.localhost\\${distro}${line.replaceAll("/", "\\")}`
        : line);
    return Buffer.from(translated.join("\n"), "utf8");
}
