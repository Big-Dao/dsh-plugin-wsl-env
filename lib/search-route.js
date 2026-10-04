/**
 * Which execution world a file-search spawn belongs to, and the `wsl.exe`
 * argv it becomes there.
 *
 * `dsh-tool-fs-search` spawns the packaged ripgrep binary through
 * `ctx.subprocess` with the session workspace as the working directory. Left
 * alone, that spawn runs the Windows binary over the distro's 9p share — the
 * one model-facing I/O path that still crossed the share, and in the slow
 * direction: measured at ~17 ms per file of metadata round trips where the
 * distro's own ext4 answers in microseconds. The interception point is the
 * subprocess provider's `spawn`, and the decision lives here — pure,
 * peer-free, and unit-testable, mirroring `terminal-route.js`.
 *
 * The rewrite is deliberately narrow. A spawn is intercepted only when the
 * working directory NAMES the distro outright — a `\\wsl.localhost\<distro>`
 * UNC — because that is the form a distro session's search carries and the
 * only one that resolves without an async distro query: `spawn` hands back
 * its handle synchronously, so the override must stay synchronous. A Windows
 * drive directory keeps the host binary, which is native there and touches
 * no share; anything else passes through untouched, exactly as before.
 *
 * The rewritten argv forwards every rg argument verbatim, so the tool reads
 * the output format and exit codes of the distro's own rg. One addition is
 * made: when the tool named no search path — its pattern rides `--regexp=`,
 * and a bare `--` separator is exactly how it spells an explicit path — the
 * rewrite appends `-- .`. Reason: `wsl.exe --exec` hands the distro-side rg a
 * relay FIFO for stdin, and rg's readable-stdin heuristic then searches stdin
 * (instantly empty) instead of walking the working directory; the packaged
 * binary under the old path saw a non-readable NUL stdin and walked it. An
 * explicit path makes the search deterministic on either transport.
 *
 * The distro-side binary must therefore exist — `scripts/bootstrap.sh` reports
 * it — and a distro without one surfaces rg's own "command not found" instead
 * of a silent fall-back to the share.
 *
 * @module dsh-plugin-wsl/search-route
 */

import { uncToPosix } from "./paths.js";

/** The one program this rewrite passes through to the distro. */
const SEARCH_PROGRAM = "rg";

/**
 * Whether a spawn's program is the ripgrep binary.
 *
 * A bare `argv[0]` is judged by its own name, so the packaged binary's
 * absolute path and any other spelling of `rg` match alike.
 *
 * @param unknown - the spawn's `argv[0]`.
 * @returns true when the spawn is a ripgrep launch.
 */
export function isSearchProgram(program) {
  if (typeof program !== "string" || program.length === 0) return false;
  const base = program.slice(Math.max(program.lastIndexOf("/"), program.lastIndexOf("\\")) + 1);
  return base.toLowerCase().replace(/\.exe$/u, "") === SEARCH_PROGRAM;
}

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
 * @param object - the spawn's inputs.
 * @param {unknown[]} object.argv - the spawn's argv; `argv[0]` is the program.
 * @param {unknown} object.cwd - the spawn's working directory, any coordinate system.
 * @param {string} object.wslPath - path to `wsl.exe`.
 * @returns {{distro: string, linuxCwd: string, rgArgv: string[], wslArgv: string[]}|undefined} the
 *   rewrite, or undefined when the spawn is not a distro search and must run
 *   exactly as the shipped implementation would run it.
 */
export function searchSpawnRewrite({ argv, cwd, wslPath }) {
  if (!Array.isArray(argv) || !isSearchProgram(argv[0])) return undefined;
  const named = uncToPosix(cwd);
  if (named === undefined) return undefined;
  const linuxCwd = named.linuxPath.length > 0 ? named.linuxPath : "/";
  // No bare `--` means the tool named no search path; without one, distro-side
  // rg reads the relay fifo on stdin (rg's readable-stdin heuristic) instead of
  // walking the directory. `.` is the working directory — the same directory
  // the packaged binary walked when the host spawned it directly.
  const forwarded = argv.slice(1);
  const tool = forwarded.includes("--") ? forwarded : [...forwarded, "--", "."];
  const rgArgv = [SEARCH_PROGRAM, ...tool];
  return {
    distro: named.distro,
    linuxCwd,
    rgArgv,
    wslArgv: [wslPath, "-d", named.distro, "--cd", linuxCwd, "--exec", ...rgArgv],
  };
}
