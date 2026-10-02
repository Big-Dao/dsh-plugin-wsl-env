/**
 * `wsl.exe` interop primitives shared by the shell executor, the filesystem
 * backend and the directory picker.
 *
 * This module is deliberately separate from `index.js`: the picker runs as its
 * own Loader entry and must not drag the shell executor's and filesystem
 * backend's peer dependencies into that row.
 *
 * @module dsh-plugin-wsl/wsl
 */

import { execFile } from "node:child_process";
import { posixToUnc } from "./paths.js";

/** Default executable name; resolution is left to PATH. */
export const DEFAULT_WSL_PATH = "wsl.exe";

/**
 * Run one host command and capture UTF-8 output.
 *
 * `wsl.exe` writes UTF-16LE by default, which would arrive as interleaved NUL
 * bytes on every non-ASCII distro name or path, so `WSL_UTF8=1` is set for
 * every call.
 *
 * @param argv - executable plus arguments, spawned without a shell.
 * @param signal - optional cancellation.
 * @returns captured stdout.
 * @throws the execFile error, with a hint attached when the cause is the sandbox.
 */
export function runCapture(argv, signal) {
  const [file, ...args] = argv;
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env: { ...process.env, WSL_UTF8: "1" }, windowsHide: true, signal, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          // A denied WSL call is the likeliest failure here and its own message
          // is unhelpful, so name the cause when it is recognisable.
          const detail = `${stdout ?? ""}${stderr ?? ""}`.replace(/\u0000/g, "").trim();
          const denied = /E_ACCESSDENIED/i.test(detail) || error.code === "EACCES";
          error.message = `${file} failed: ${detail || error.message}${
            denied
              ? " (WSL is unreachable from a sandboxed process: DSH's Windows ACL sandbox runs commands under a restricted low-integrity token. Compose the non-sandboxing providers.)"
              : ""
          }`;
          reject(error);
          return;
        }
        resolve(String(stdout ?? "").replace(/\u0000/g, ""));
      },
    );
  });
}

/**
 * List installed distros with `wsl.exe -l -q`.
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns distro names in WSL's own order, default distro first.
 */
export async function listDistros(options = {}) {
  const stdout = await runCapture([options.wslPath ?? DEFAULT_WSL_PATH, "-l", "-q"], options.signal);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Resolve the distro to use when none is configured: WSL's own default.
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns the first entry of {@link listDistros}.
 * @throws when no distro is installed.
 */
export async function defaultDistro(options = {}) {
  const [first] = await listDistros(options);
  if (first === undefined) throw new Error("dsh-plugin-wsl: no WSL distro is installed (`wsl.exe -l -q` returned nothing)");
  return first;
}

/**
 * The Linux home directory of a distro's default user, as a Linux path. `$HOME`
 * is set by `wsl.exe` itself from the distro's default user, so this needs no
 * passwd parsing.
 *
 * @param distro - distro name.
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns e.g. `/home/andy`.
 * @throws when the distro cannot be queried or reports no home.
 */
export async function linuxHomePath(distro, options = {}) {
  const stdout = await runCapture(
    [options.wslPath ?? DEFAULT_WSL_PATH, "-d", distro, "--exec", "sh", "-c", 'printf %s "$HOME"'],
    options.signal,
  );
  const home = stdout.trim();
  if (home.length === 0 || !home.startsWith("/")) {
    throw new Error(`dsh-plugin-wsl: distro "${distro}" reported no usable $HOME (got "${home}")`);
  }
  return home;
}

/**
 * The same home in the world coordinate system, which is what a host-side
 * consumer needs.
 *
 * @param distro - distro name.
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns e.g. `\\wsl.localhost\ubuntu\home\andy`.
 * @throws when the distro cannot be queried or reports no home.
 */
export async function linuxHome(distro, options = {}) {
  return posixToUnc(distro, await linuxHomePath(distro, options));
}

/**
 * Resolve a Linux path to its canonical form INSIDE the distro with
 * `readlink -f`.
 *
 * This exists because the UNC share cannot traverse Linux symlinks: the share
 * exposes one as a Windows reparse point whose relative POSIX target has no
 * meaning to Windows path resolution, so `stat`/`realpath`/`read` on a path such
 * as `/etc/os-release` (-> ../usr/lib/os-release) or `/lib` (-> usr/lib) fail
 * with `ENOENT`, even though `lstat` reaches the link. Asking the distro for the
 * real path is the only reliable answer, at one process per distinct path.
 *
 * @param distro - distro name.
 * @param linuxPath - the Linux path to canonicalize.
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns the canonical absolute Linux path, or undefined when it cannot be
 *   determined (missing file, broken link, or a failed query).
 */
export async function canonicalLinuxPath(distro, linuxPath, options = {}) {
  try {
    const stdout = await runCapture(
      [options.wslPath ?? DEFAULT_WSL_PATH, "-d", distro, "--exec", "readlink", "-f", linuxPath],
      options.signal,
    );
    const resolved = stdout.trim();
    return resolved.startsWith("/") ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Give `targetLinux` the same POSIX mode `sourceLinux` has, inside the distro.
 *
 * The UNC share does not carry POSIX modes to the host: a host-side `chmod` on a
 * share path is silently ignored, and a host-side `stat` reports 0666 no matter
 * what the distro sees. The distro itself has the real mode, so the mode has to
 * be applied there — and because a rename preserves the inode's mode, applying
 * it to a staged temp file *before* publication is enough for the published file
 * to come out with the right bits.
 *
 * `stat` + `chmod` rather than `chmod --reference` keeps this working on distros
 * whose chmod is busybox's.
 *
 * @param distro - distro name.
 * @param sourceLinux - absolute Linux path whose mode is copied.
 * @param targetLinux - absolute Linux path that receives the mode.
 * @param options - the `wsl.exe` path and optional cancellation.
 * @throws when the mode cannot be applied.
 */
export async function copyModeInDistro(distro, sourceLinux, targetLinux, options = {}) {
  const script = 'if [ -e "$1" ]; then mode=$(stat -c %a "$1") && chmod "$mode" "$2"; fi';
  await runCapture(
    [options.wslPath ?? DEFAULT_WSL_PATH, "-d", distro, "--exec", "sh", "-c", script, "sh", sourceLinux, targetLinux],
    options.signal,
  );
}

/**
 * Shells known to accept the combined POSIX `-lc` login-plus-command form.
 *
 * `-l` is not universal: csh/tcsh signal login through argv[0] instead, and
 * fish/nushell/xonsh take different flags. Anything outside this set therefore
 * gets a bare `-c`, so a distro whose user runs one of those shells still works
 * — it just does not get login-shell semantics.
 */
const POSIX_LOGIN_SHELLS = new Set(["sh", "bash", "dash", "zsh", "ksh", "ksh93", "mksh", "ash", "busybox"]);

/**
 * The argv flags that make `shell` run `command`, with login semantics when the
 * shell supports them.
 *
 * @param shellPath - absolute path to the shell inside the distro.
 * @param login - whether login-shell semantics were requested.
 * @returns the flags to place before the command string.
 */
export function shellArgs(shellPath, login) {
  const name = String(shellPath).slice(String(shellPath).lastIndexOf("/") + 1).toLowerCase();
  if (!POSIX_LOGIN_SHELLS.has(name)) return ["-c"];
  return login ? ["-lc"] : ["-c"];
}

/**
 * Shells whose `-l` flag means a login shell.
 *
 * Fish is included although it is absent from {@link POSIX_LOGIN_SHELLS}: fish
 * rejects the combined `-lc` form that set guards, but it does accept `-l` for
 * an interactive login shell. csh/tcsh signal login through argv[0] and
 * nushell/xonsh use long flags, so they deliberately get nothing.
 */
const LOGIN_FLAG_SHELLS = new Set([...POSIX_LOGIN_SHELLS, "fish"]);

/**
 * The flags that make an interactive shell a login shell.
 *
 * Separate from {@link shellArgs} because an interactive terminal passes no
 * command: `-lc` has no meaning there, and the login flag has to sit beside the
 * caller's own `-i` (or its dialect equivalent) rather than replace it.
 *
 * @param shellPath - absolute path to the shell inside the distro.
 * @param login - whether login-shell semantics were requested.
 * @returns `["-l"]`, or an empty array for a shell whose login flag differs.
 */
export function interactiveShellArgs(shellPath, login) {
  const name = String(shellPath).slice(String(shellPath).lastIndexOf("/") + 1).toLowerCase();
  return login && LOGIN_FLAG_SHELLS.has(name) ? ["-l"] : [];
}

/**
 * The `wsl.exe` argv that opens one interactive shell inside a distro.
 *
 * This is the terminal twin of the command form built in `lib/index.js`, with
 * three deliberate differences:
 *
 *   - There is no command string. With no pinned shell the launch ends here and
 *     `wsl.exe` itself starts the distro user's login shell, which is the same
 *     shell an interactive `wsl.exe` gives a person — no shell has to be
 *     guessed, and the distro's own passwd entry decides.
 *   - A pinned `shellPath` is passed after `--exec`, which is as load-bearing
 *     here as it is for commands: without it `wsl.exe` routes the launch through
 *     the distro's default shell, which would expand and re-split the arguments
 *     before the requested interactive shell ever sees them.
 *   - `--cd` is omitted when no working directory is known, because `wsl.exe`
 *     rejects an empty `--cd` argument whereas its own default starts in the
 *     distro user's home.
 *
 * @param options - the `wsl.exe` path, distro, optional shell, its args, cwd and login mode.
 * @returns the argv to spawn on the host.
 */
export function wslTerminalArgv(options) {
  const { wslPath = DEFAULT_WSL_PATH, distro = "", shellPath, args = [], linuxCwd, login = true } = options;
  const directory = typeof linuxCwd === "string" && linuxCwd.length > 0 ? ["--cd", linuxCwd] : [];
  const shell =
    typeof shellPath === "string" && shellPath.length > 0
      ? ["--exec", shellPath, ...interactiveShellArgs(shellPath, login), ...args]
      : [];
  return [wslPath, ...(distro.length > 0 ? ["-d", distro] : []), ...directory, ...shell];
}

/**
 * Managed facts of the `DSH_*` namespace that carry a Windows path. WSL's
 * `WSLENV` `/p` flag translates them on the way into the distro, so a command
 * there sees `/mnt/c/...` instead of `C:\...`. `DSH_WSL_HOME` is deliberately
 * absent: it is already a POSIX path, and translating it would corrupt it.
 */
const PATH_TRANSLATED_ENV = new Set(["DSH_HOME", "DSH_PROFILE_DIR"]);

/**
 * Render WSLENV's value from the env names a call wants the distro to import.
 *
 * `wsl.exe` imports only the names listed here; everything else in the Windows
 * process environment stops at the distro boundary.
 *
 * @param names - env names to reveal to the distro.
 * @returns the `:`-joined WSLENV value.
 */
export function wslEnvValue(names) {
  return names.map((name) => (PATH_TRANSLATED_ENV.has(name) ? `${name}/p` : name)).join(":");
}

/**
 * Resolve the shell a distro's user actually gets, rather than assuming bash.
 *
 * The authoritative source is the login shell field of the user's passwd entry;
 * `$SHELL` (which `wsl.exe` derives from it) is the fallback for distros without
 * `getent`, and bash is the last resort. The passwd field is preferred because a
 * user can export a different `SHELL` without changing their login shell.
 *
 * @param distro - distro name.
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns an absolute path to the shell inside the distro.
 */
export async function defaultShell(distro, options = {}) {
  const wslPath = options.wslPath ?? DEFAULT_WSL_PATH;
  const ask = async (script) => {
    try {
      const value = (await runCapture([wslPath, "-d", distro, "--exec", "sh", "-c", script], options.signal)).trim();
      return value.startsWith("/") ? value : undefined;
    } catch {
      return undefined;
    }
  };
  return (
    (await ask('getent passwd "$(id -u)" | cut -d: -f7')) ??
    (await ask('printf %s "$SHELL"')) ??
    "bash"
  );
}

/**
 * Run one command inside a distro and return raw stdout. Used by callers that
 * want Linux semantics instead of the UNC share's.
 *
 * @param distro - distro name.
 * @param command - a shell command string.
 * @param options - the `wsl.exe` path, an explicit `shell`, and optional cancellation.
 * @returns captured stdout.
 */
export async function runInDistro(distro, command, options = {}) {
  const shell = options.shell ?? (await defaultShell(distro, options));
  return runCapture(
    [options.wslPath ?? DEFAULT_WSL_PATH, "-d", distro, "--exec", shell, ...shellArgs(shell, options.loginShell !== false), command],
    options.signal,
  );
}
