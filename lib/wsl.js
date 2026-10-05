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

/**
 * What every `wsl.exe` call may tune: the executable path and cancellation.
 *
 * @typedef {object} WslCallOptions
 * @property {string} [wslPath] - executable name or absolute path; defaults to
 *   `wsl.exe`, resolved through PATH.
 * @property {AbortSignal} [signal] - optional cancellation.
 */

/** Default executable name; resolution is left to PATH. */
export const DEFAULT_WSL_PATH = "wsl.exe";

/**
 * The deadline every `wsl.exe` call runs under, when the caller names none.
 *
 * A resolution call that never returns is worse than a failed one: `wsl.exe`
 * talks to the vmcompute service, and a wedged service would hang the tool
 * call forever — no timeout, no error, a silent dead session. Every call now
 * dies loudly instead. The bound is deliberately generous (a cold distro boot
 * on a slow disk is tens of seconds), and `0` disables it for a caller that
 * genuinely wants to wait forever.
 */
export const DEFAULT_WSL_DEADLINE_MS = 60_000;

/**
 * Run one host command and capture UTF-8 output.
 *
 * `wsl.exe` writes UTF-16LE by default, which would arrive as interleaved NUL
 * bytes on every non-ASCII distro name or path, so `WSL_UTF8=1` is set for
 * every call.
 *
 * @param {string[]} argv - executable plus arguments, spawned without a shell.
 * @param {AbortSignal} [signal] - optional cancellation.
 * @param {number} [deadlineMs] - kill the call after this many milliseconds; the
 *   default is {@link DEFAULT_WSL_DEADLINE_MS}, and `0` waits forever.
 * @returns {Promise<string>} captured stdout.
 * @throws the execFile error, with a hint attached when the cause is the sandbox.
 */
export function runCapture(argv, signal, deadlineMs = DEFAULT_WSL_DEADLINE_MS) {
  const [file, ...args] = argv;
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env: { ...process.env, WSL_UTF8: "1" }, windowsHide: true, signal, encoding: "utf8", timeout: deadlineMs },
      (error, stdout, stderr) => {
        if (error) {
          // A denied WSL call is the likeliest failure here and its own message
          // is unhelpful, so name the cause when it is recognisable.
          const detail = `${stdout ?? ""}${stderr ?? ""}`.replace(/\u0000/g, "").trim();
          const denied = /E_ACCESSDENIED/i.test(detail) || error.code === "EACCES";
          const missing = error.code === "ENOENT";
          // The deadline kill arrives as a SIGTERM with no WSL diagnostic, so
          // it must be named for what it is — not left looking like WSL's own
          // failure. An abort is cancellation, not a deadline.
          const stuck = error.killed === true && error.name !== "AbortError";
          error.message = `${file} failed: ${detail || error.message}${
            denied
              ? " (WSL is unreachable from a sandboxed process: DSH's Windows ACL sandbox runs commands under a restricted low-integrity token. Compose the non-sandboxing providers.)"
              : ""
          }${
            missing
              ? ` (the executable "${file}" could not be started: check \`wslPath\` in this row, and that WSL is installed)`
              : ""
          }${
            stuck
              ? ` (no completion within ${deadlineMs}ms — the WSL service may be wedged; retry once, then \`wsl.exe --shutdown\` and reopen)`
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
 * @param {WslCallOptions} [options] - the `wsl.exe` path and optional cancellation.
 * @returns {Promise<string[]>} distro names in WSL's own order, default distro first.
 */
export async function listDistros(options = {}) {
  const stdout = await runCapture([options.wslPath ?? DEFAULT_WSL_PATH, "-l", "-q"], options.signal);
  return parseDistroList(stdout);
}

/**
 * Parse `wsl.exe -l -q` output into distro names. A pure seam so the CRLF and
 * blank-line shapes of the real output are unit-testable on hosts without
 * `wsl.exe`.
 * @param {string} stdout - the raw `wsl.exe -l -q` stdout.
 * @returns {string[]} distro names, default distro first.
 */
export function parseDistroList(stdout) {
  return String(stdout)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Resolve the distro to use when none is configured: WSL's own default.
 * @param {WslCallOptions} [options] - the `wsl.exe` path and optional cancellation.
 * @returns {Promise<string>} the first entry of {@link listDistros}.
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
 * @param {string} distro - distro name.
 * @param {WslCallOptions} [options] - the `wsl.exe` path and optional cancellation.
 * @returns {Promise<string>} e.g. `/home/andy`.
 * @throws when the distro cannot be queried or reports no home.
 */
export async function linuxHomePath(distro, options = {}) {
  const stdout = await runCapture(
    [options.wslPath ?? DEFAULT_WSL_PATH, "-d", distro, "--exec", "sh", "-c", 'printf %s "$HOME"'],
    options.signal,
  );
  return parseHomePath(distro, stdout);
}

/**
 * Validate the distro's reported $HOME. A pure seam: the failure shapes
 * (empty output, a Windows path, mojibake) are unit-testable without
 * `wsl.exe`.
 * @param {string} distro - the distro name, for the error message.
 * @param {string} stdout - the raw `printf %s "$HOME"` output.
 * @returns {string} the Linux home path.
 */
export function parseHomePath(distro, stdout) {
  const home = String(stdout).trim();
  if (home.length === 0 || !home.startsWith("/")) {
    throw new Error(`dsh-plugin-wsl: distro "${distro}" reported no usable $HOME (got "${home}")`);
  }
  return home;
}

/**
 * The same home in the world coordinate system, which is what a host-side
 * consumer needs.
 *
 * @param {string} distro - distro name.
 * @param {WslCallOptions} [options] - the `wsl.exe` path and optional cancellation.
 * @returns {Promise<string>} e.g. `\\wsl.localhost\ubuntu\home\andy`.
 * @throws when the distro cannot be queried or reports no home.
 */
export async function linuxHome(distro, options = {}) {
  return posixToUnc(distro, await linuxHomePath(distro, options));
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
 * @param {string} shellPath - absolute path to the shell inside the distro.
 * @param {boolean} login - whether login-shell semantics were requested.
 * @returns {string[]} the flags to place before the command string.
 */
export function shellArgs(shellPath, login) {
  const name = String(shellPath).slice(String(shellPath).lastIndexOf("/") + 1).toLowerCase();
  if (!POSIX_LOGIN_SHELLS.has(name)) return ["-c"];
  return login ? ["-lc"] : ["-c"];
}

/**
 * The working directory `wsl.exe` could not enter, when its relay said so.
 *
 * `wsl.exe --cd <path>` does not fail when `<path>` is missing. It writes a relay
 * error to STDERR, runs the command in `/` anyway, and exits 0 — so a caller would see
 * a successful command that ran somewhere else. The shape is matched here for the
 * callers to turn into a failure.
 *
 * Both markers are required: the relay prefix and `CreateProcessCommon`. A command is
 * free to print "chdir(...) failed" itself, and a false positive would turn a correct
 * run into an error. Verified against `wsl.exe -d <distro> --cd /missing --exec sh`:
 * exit 0, `hi` on stdout, this shape on stderr.
 *
 * @param {string} [stdout] - a command's captured stdout; absent reads as empty.
 * @param {string} [stderr] - its captured stderr; absent reads as empty.
 * @returns {string | undefined} the directory that could not be entered, or undefined.
 */
export function workdirFailure(stdout, stderr) {
  const text = `${stdout ?? ""}\n${stderr ?? ""}`.replace(/\0/g, "");
  const match = /<3>WSL[^\n]*CreateProcessCommon[^\n]*chdir\(([^)]*)\) failed/.exec(text);
  return match?.[1];
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
 * @param {string} shellPath - absolute path to the shell inside the distro.
 * @param {boolean} login - whether login-shell semantics were requested.
 * @returns {string[]} `["-l"]`, or an empty array for a shell whose login flag differs.
 */
export function interactiveShellArgs(shellPath, login) {
  const name = String(shellPath).slice(String(shellPath).lastIndexOf("/") + 1).toLowerCase();
  return login && LOGIN_FLAG_SHELLS.has(name) ? ["-l"] : [];
}

/**
 * What {@link wslTerminalArgv} reads: the `wsl.exe` path, distro, optional
 * shell, its args, working directory and login mode.
 *
 * @typedef {object} WslTerminalOptions
 * @property {string} [wslPath] - executable name or absolute path.
 * @property {string} [distro] - distro name; omitted from the argv when empty.
 * @property {string} [shellPath] - absolute path to a pinned shell inside the distro.
 * @property {string[]} [args] - the shell's own arguments.
 * @property {string} [linuxCwd] - the working directory inside the distro.
 * @property {boolean} [login] - whether login-shell semantics were requested.
 */

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
 * @param {WslTerminalOptions} options - the launch description.
 * @returns {string[]} the argv to spawn on the host.
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
 * @param {string[]} names - env names to reveal to the distro.
 * @returns {string} the `:`-joined WSLENV value.
 */
export function wslEnvValue(names) {
  return names.map((name) => (PATH_TRANSLATED_ENV.has(name) ? `${name}/p` : name)).join(":");
}

/**
 * The `WSL_E_*` code inside `wsl.exe`'s own output, when it reported one.
 *
 * wsl.exe writes these diagnostics to STDOUT, and a build may encode them as
 * UTF-16LE — a NUL byte between every ASCII character. Read as UTF-8 that leaves
 * the code spelled with NULs in the middle, so the search strips them first and
 * finds the code under either encoding. Verified against a missing distro:
 * `wsl.exe -d nosuchdistro --exec …` exits 255 with an empty stderr and
 * `Wsl/Service/WSL_E_DISTRO_NOT_FOUND` on stdout.
 *
 * @param {string} [stdout] - a command's captured stdout; absent reads as empty.
 * @param {string} [stderr] - its captured stderr; absent reads as empty.
 * @returns {string | undefined} the code, for example `WSL_E_DISTRO_NOT_FOUND`, or undefined.
 */
export function wslErrorCode(stdout, stderr) {
  const text = `${stdout ?? ""}\n${stderr ?? ""}`.replace(/\0/g, "");
  return /WSL_E_[A-Z0-9_]+/.exec(text)?.[0];
}

/**
 * What {@link defaultShell} may tune: the `wsl.exe` path and cancellation.
 *
 * @typedef {object} WslShellProbeOptions
 * @property {string} [wslPath] - executable name or absolute path.
 * @property {AbortSignal} [signal] - optional cancellation.
 */

/**
 * Resolve the shell a distro's user actually gets, rather than assuming bash.
 *
 * The authoritative source is the login shell field of the user's passwd entry;
 * `$SHELL` (which `wsl.exe` derives from it) is the fallback for distros without
 * `getent`, and bash is the last resort. The passwd field is preferred because a
 * user can export a different `SHELL` without changing their login shell.
 *
 * @param {string} distro - distro name.
 * @param {WslShellProbeOptions} [options] - the `wsl.exe` path and optional cancellation.
 * @returns {Promise<string | undefined>} an absolute path to the shell inside the
 *   distro, or undefined when both probes failed.
 */
export async function defaultShell(distro, options = {}) {
  const wslPath = options.wslPath ?? DEFAULT_WSL_PATH;
  /**
   * Ask the distro one `sh -c` question; only absolute paths count as answers.
   *
   * @param {string} script - the shell snippet to run.
   * @returns {Promise<string | undefined>} the trimmed answer, or undefined.
   */
  const ask = async (script) => {
    try {
      const value = (await runCapture([wslPath, "-d", distro, "--exec", "sh", "-c", script], options.signal)).trim();
      return value.startsWith("/") ? value : undefined;
    } catch {
      return undefined;
    }
  };
  // No "bash" placeholder: a failed probe (a cold distro, a flaky first
  // `wsl.exe` call) used to be pinned as the literal shell for the
  // executor's lifetime. `undefined` tells the caller both answers failed;
  // it may retry later or fall back itself.
  return (
    (await ask('getent passwd "$(id -u)" | cut -d: -f7')) ??
    (await ask('printf %s "$SHELL"')) ??
    undefined
  );
}

/**
 * What {@link runInDistro} reads: the `wsl.exe` path, an explicit shell, and
 * optional cancellation and login mode.
 *
 * @typedef {object} WslRunOptions
 * @property {string} [wslPath] - executable name or absolute path.
 * @property {string} [shell] - an absolute path to the shell; resolved from the
 *   distro when omitted.
 * @property {AbortSignal} [signal] - optional cancellation.
 * @property {boolean} [loginShell] - whether login-shell semantics were requested;
 *   defaults to true.
 */

/**
 * Run one command inside a distro and return raw stdout. Used by callers that
 * want Linux semantics instead of the UNC share's.
 *
 * @param {string} distro - distro name.
 * @param {string} command - a shell command string.
 * @param {WslRunOptions} [options] - the `wsl.exe` path, an explicit `shell`, and
 *   optional cancellation.
 * @returns {Promise<string>} captured stdout.
 * @throws when neither the caller nor the distro names a usable shell.
 */
export async function runInDistro(distro, command, options = {}) {
  const shell = options.shell ?? (await defaultShell(distro, options));
  if (shell === undefined) {
    throw new Error(`dsh-plugin-wsl: distro "${distro}" named no usable shell (passwd probe and $SHELL both failed)`);
  }
  return runCapture(
    [options.wslPath ?? DEFAULT_WSL_PATH, "-d", distro, "--exec", shell, ...shellArgs(shell, options.loginShell !== false), command],
    options.signal,
  );
}
