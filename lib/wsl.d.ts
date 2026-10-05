/**
 * `wsl.exe` interop primitives shared by the shell executor, the filesystem
 * backend and the directory picker.
 *
 * This module is deliberately separate from `index.js`: the picker runs as its
 * own Loader entry and must not drag the shell executor's and filesystem
 * backend's peer dependencies into that row.
 *
 * This is a TypeScript source built to `lib/wsl.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/wsl
 */
/**
 * What every `wsl.exe` call may tune: the executable path and cancellation.
 */
export interface WslCallOptions {
    /**
     * Executable name or absolute path; defaults to `wsl.exe`, resolved through
     * PATH.
     */
    wslPath?: string;
    /** Optional cancellation. */
    signal?: AbortSignal;
}
/** Default executable name; resolution is left to PATH. */
export declare const DEFAULT_WSL_PATH = "wsl.exe";
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
export declare const DEFAULT_WSL_DEADLINE_MS = 60000;
/**
 * Run one host command and capture UTF-8 output.
 *
 * `wsl.exe` writes UTF-16LE by default, which would arrive as interleaved NUL
 * bytes on every non-ASCII distro name or path, so `WSL_UTF8=1` is set for
 * every call.
 *
 * @param argv - executable plus arguments, spawned without a shell.
 * @param signal - optional cancellation.
 * @param deadlineMs - kill the call after this many milliseconds; the
 *   default is {@link DEFAULT_WSL_DEADLINE_MS}, and `0` waits forever.
 * @returns captured stdout.
 * @throws the execFile error, with a hint attached when the cause is the sandbox.
 */
export declare function runCapture(argv: string[], signal?: AbortSignal, deadlineMs?: number): Promise<string>;
/**
 * List installed distros with `wsl.exe -l -q`.
 *
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns distro names in WSL's own order, default distro first.
 */
export declare function listDistros(options?: WslCallOptions): Promise<string[]>;
/**
 * Parse `wsl.exe -l -q` output into distro names. A pure seam so the CRLF and
 * blank-line shapes of the real output are unit-testable on hosts without
 * `wsl.exe`.
 *
 * @param stdout - the raw `wsl.exe -l -q` stdout.
 * @returns distro names, default distro first.
 */
export declare function parseDistroList(stdout: string): string[];
/**
 * Resolve the distro to use when none is configured: WSL's own default.
 *
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns the first entry of {@link listDistros}.
 * @throws when no distro is installed.
 */
export declare function defaultDistro(options?: WslCallOptions): Promise<string>;
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
export declare function linuxHomePath(distro: string, options?: WslCallOptions): Promise<string>;
/**
 * Validate the distro's reported $HOME. A pure seam: the failure shapes
 * (empty output, a Windows path, mojibake) are unit-testable without
 * `wsl.exe`.
 *
 * @param distro - the distro name, for the error message.
 * @param stdout - the raw `printf %s "$HOME"` output.
 * @returns the Linux home path.
 */
export declare function parseHomePath(distro: string, stdout: string): string;
/**
 * The same home in the world coordinate system, which is what a host-side
 * consumer needs.
 *
 * @param distro - distro name.
 * @param options - the `wsl.exe` path and optional cancellation.
 * @returns e.g. `\\wsl.localhost\ubuntu\home\andy`.
 * @throws when the distro cannot be queried or reports no home.
 */
export declare function linuxHome(distro: string, options?: WslCallOptions): Promise<string>;
/**
 * The argv flags that make `shell` run `command`, with login semantics when the
 * shell supports them.
 *
 * @param shellPath - absolute path to the shell inside the distro.
 * @param login - whether login-shell semantics were requested.
 * @returns the flags to place before the command string.
 */
export declare function shellArgs(shellPath: string, login: boolean): string[];
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
 * @param stdout - a command's captured stdout; absent reads as empty.
 * @param stderr - its captured stderr; absent reads as empty.
 * @returns the directory that could not be entered, or undefined.
 */
export declare function workdirFailure(stdout?: string, stderr?: string): string | undefined;
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
export declare function interactiveShellArgs(shellPath: string, login: boolean): string[];
/**
 * What {@link wslTerminalArgv} reads: the `wsl.exe` path, distro, optional
 * shell, its args, working directory and login mode.
 */
export interface WslTerminalOptions {
    /** Executable name or absolute path. */
    wslPath?: string;
    /** Distro name; omitted from the argv when empty. */
    distro?: string;
    /** Absolute path to a pinned shell inside the distro. */
    shellPath?: string;
    /** The shell's own arguments. */
    args?: string[];
    /** The working directory inside the distro. */
    linuxCwd?: string;
    /** Whether login-shell semantics were requested. */
    login?: boolean;
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
 * @param options - the launch description.
 * @returns the argv to spawn on the host.
 */
export declare function wslTerminalArgv(options: WslTerminalOptions): string[];
/**
 * Render WSLENV's value from the env names a call wants the distro to import.
 *
 * `wsl.exe` imports only the names listed here; everything else in the Windows
 * process environment stops at the distro boundary.
 *
 * @param names - env names to reveal to the distro.
 * @returns the `:`-joined WSLENV value.
 */
export declare function wslEnvValue(names: string[]): string;
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
 * @param stdout - a command's captured stdout; absent reads as empty.
 * @param stderr - its captured stderr; absent reads as empty.
 * @returns the code, for example `WSL_E_DISTRO_NOT_FOUND`, or undefined.
 */
export declare function wslErrorCode(stdout?: string, stderr?: string): string | undefined;
/**
 * What {@link defaultShell} may tune: the `wsl.exe` path and cancellation.
 */
export interface WslShellProbeOptions {
    /** Executable name or absolute path. */
    wslPath?: string;
    /** Optional cancellation. */
    signal?: AbortSignal;
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
 * @returns an absolute path to the shell inside the distro, or undefined when
 *   both probes failed.
 */
export declare function defaultShell(distro: string, options?: WslShellProbeOptions): Promise<string | undefined>;
/**
 * What {@link runInDistro} reads: the `wsl.exe` path, an explicit shell, and
 * optional cancellation and login mode.
 */
export interface WslRunOptions {
    /** Executable name or absolute path. */
    wslPath?: string;
    /**
     * An absolute path to the shell; resolved from the distro when omitted.
     */
    shell?: string;
    /** Optional cancellation. */
    signal?: AbortSignal;
    /**
     * Whether login-shell semantics were requested; defaults to true.
     */
    loginShell?: boolean;
}
/**
 * Run one command inside a distro and return raw stdout. Used by callers that
 * want Linux semantics instead of the UNC share's.
 *
 * @param distro - distro name.
 * @param command - a shell command string.
 * @param options - the `wsl.exe` path, an explicit `shell`, and optional
 *   cancellation.
 * @returns captured stdout.
 * @throws when neither the caller nor the distro names a usable shell.
 */
export declare function runInDistro(distro: string, command: string, options?: WslRunOptions): Promise<string>;
