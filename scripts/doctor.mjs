#!/usr/bin/env node
/**
 * One-command environment doctor for this plugin (P0.2 / WSL-102).
 *
 * Answers "will this plugin work here, and if not, what do I paste?" in one
 * read-only pass: Windows and WSL versions, the distro and its shell, bubblewrap
 * usability, systemd / the user manager / `systemd-run` / Linger, the optional
 * tools, the peer versions the plugin is loaded against, the native-agent cache,
 * a fresh-agent handshake, stale session scopes, and the known profile-patch trap.
 *
 *   node scripts/doctor.mjs [distro] [--json] [--fix] [--install] [--yes] [--read-only]
 *
 * Exit status is 0 when nothing failed and 1 when a `fail` check did; warnings
 * (optional tools, a missing cache) do not fail the run. `--fix` performs only
 * safe actions: it sweeps stale `dsh-wsl-*.scope` units (the same sweep the
 * session preflight runs). Installing packages needs `--install` *and* an
 * explicit confirmation (`--yes` skips the prompt, not the flag), so a fix run
 * can never install silently.
 *
 * `--read-only` refuses `--fix`/`--install`; `scripts/diagnose.sh` uses it to stay an
 * alias that can never change the machine.
 *
 * `--json` prints one machine-readable report instead of the human sections.
 * The report shape is versioned (`schemaVersion`).
 *
 * @module dsh-plugin-wsl/scripts/doctor
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseDistroList } from "../lib/wsl.js";
import { AGENT_NAME, PROTOCOL_VERSION } from "../lib/agent-protocol.js";
import { sessionScopeSweepScript } from "../lib/session-scope.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WSL = "wsl.exe";
const CMD = "cmd.exe";
const TIMEOUT_MS = 60_000;

/** The package families the install remedies know, in probe order. */
const FAMILIES = ["apt-get", "dnf", "pacman", "zypper"];
/** The package names the plugin uses, per family. */
const PACKAGES = "bubblewrap git ripgrep inotify-tools";
/** One install command per family; `zypper` spells its non-interactive flag differently. */
const INSTALL = /** @type {Record<string, string>} */ ({
  "apt-get": `apt-get install -y ${PACKAGES}`,
  dnf: `dnf install -y ${PACKAGES}`,
  pacman: `pacman -Sy --noconfirm ${PACKAGES}`,
  zypper: `zypper --non-interactive install ${PACKAGES}`,
});
/** The read-only stale-scope report; `--fix` runs the shipped sweep instead. */
const STALE_SCOPE_REPORT = [
  "systemctl --user is-system-running >/dev/null 2>&1 || { echo none; exit 0; }",
  "systemctl --user list-units 'dsh-wsl-*.scope' --all --plain --no-legend --no-pager 2>/dev/null | while read -r unit _; do",
  '  [ -n "$unit" ] || continue',
  '  cg=$(systemctl --user show -p ControlGroup --value "$unit" 2>/dev/null)',
  "  alive=0",
  '  if [ -n "$cg" ] && [ -r "/sys/fs/cgroup$cg/cgroup.procs" ]; then',
  '    while read -r pid; do',
  '      [ -n "$pid" ] || continue',
  "      if tr '\\0' ' ' < \"/proc/$pid/cmdline\" 2>/dev/null | grep -q -e 'wsl-agent.sh' -e 'dsh-wsl-agent'; then alive=1; pids=\"$pids $pid\"; fi",
  '    done < "/sys/fs/cgroup$cg/cgroup.procs"',
  "  fi",
  '  echo "$unit $([ "$alive" -eq 1 ] && echo active || echo stale) pids:${pids:-none}"',
  "done",
].join("\n");
/** The agent-cache inventory: one `state digest` line per cached binary. */
const CACHE_REPORT = [
  'd="$HOME/.cache/dsh-wsl/agent"',
  '[ -d "$d" ] || { echo none; exit 0; }',
  'for f in "$d"/*/dsh-wsl-agent; do',
  "  [ -e \"$f\" ] || continue",
  '  if [ -x "$f" ]; then echo "exec $(basename "$(dirname "$f")")"; else echo "noexec $(basename "$(dirname "$f")")"; fi',
  "done",
].join("\n");

/**
 * One check result.
 * @typedef {object} Check
 * @property {string} id - stable dotted id.
 * @property {"ok"|"warn"|"fail"|"info"} status - the verdict.
 * @property {string} title - what was checked.
 * @property {string} [detail] - the evidence.
 * @property {string} [remedy] - a copy-paste next step when not ok.
 */

/**
 * Run one host command; never throws.
 * @param {string[]} argv - executable and arguments.
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code?: string }>} the capture.
 */
function run(argv) {
  return new Promise((settle) => {
    const [file, ...args] = argv;
    if (file === undefined) throw new Error("doctor: empty argv");
    /**
     * @param {Error | null} error - the spawn/exit error, if any.
     * @param {string} stdout - captured stdout.
     * @param {string} stderr - captured stderr.
     */
    const done = (error, stdout, stderr) => {
      const code = error === null ? undefined : /** @type {NodeJS.ErrnoException} */ (error).code ?? "1";
      settle({ ok: error === null, stdout: stdout ?? "", stderr: stderr ?? "", code });
    };
    execFile(file, args, { encoding: "utf8", timeout: TIMEOUT_MS, windowsHide: true, env: { ...process.env, WSL_UTF8: "1" } }, done);
  });
}

/**
 * Run one `sh -c` script inside the distro.
 * @param {string} distro - the distro name.
 * @param {string} script - the shell script.
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code?: string }>} the capture.
 */
function inDistro(distro, script) {
  return run([WSL, "-d", distro, "--exec", "sh", "-c", script]);
}

/**
 * Parse the doctor's own arguments.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {{ distro: string, json: boolean, fix: boolean, install: boolean, yes: boolean, readOnly: boolean, help: boolean }} the options.
 */
function parseArgs(argv) {
  const options = { distro: "", json: false, fix: false, install: false, yes: false, readOnly: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--json") options.json = true;
    else if (arg === "--fix") options.fix = true;
    else if (arg === "--install") options.install = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--read-only") options.readOnly = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--distro") options.distro = argv[++i] ?? "";
    else if (arg.startsWith("--distro=")) options.distro = arg.slice("--distro=".length);
    else if (arg.startsWith("-")) throw new Error(`doctor: unknown option "${arg}"`);
    else options.distro = arg;
  }
  return options;
}

/**
 * Whether an installed version satisfies one peer range. The manifest's peer
 * ranges are floor ranges (`>=`) and caret ranges (`^`), and the
 * devDependencies carry exact pins — those three shapes are all this
 * understands; anything else is reported as unchecked rather than guessed at.
 * The floor is the plugin's own compatibility claim, so it compares plainly
 * against the floor version; the semver gate that excludes other lines'
 * prereleases is an installer concern, not this check's.
 * @param {string} installed - the installed version.
 * @param {string} range - the declared peer range.
 * @returns {boolean | undefined} true/false, or undefined for an unsupported shape.
 */
export function peerSatisfied(installed, range) {
  if (range.startsWith(">=")) return compareVersions(installed, range.slice(2)) >= 0;
  if (range.startsWith("^")) {
    const [major, minor, patch] = range.slice(1).split(".");
    return compareVersions(installed, `${major}.${minor}.${patch ?? "0"}`) >= 0
      && installed.split(".")[0] === major
      && (major !== "0" || installed.split(".")[1] === minor);
  }
  if (/^[0-9]/.test(range)) return installed === range;
  return undefined;
}

/**
 * Compare two semver-ish versions (prerelease sorts below its release).
 * @param {string} left - the first version.
 * @param {string} right - the second version.
 * @returns {number} negative, zero or positive like a comparator.
 */
export function compareVersions(left, right) {
  /**
   * @param {string} value - one version.
   * @returns {{ major: number, minor: number, patch: number, pre: string }} its parts.
   */
  const split = (value) => {
    const [rawBase, pre = ""] = value.split("-", 2);
    const base = rawBase ?? "";
    const parts = base.split(".").map((part) => Number(part.replace(/\D.*$/u, "")) || 0);
    return { major: parts[0] ?? 0, minor: parts[1] ?? 0, patch: parts[2] ?? 0, pre };
  };
  const a = split(left);
  const b = split(right);
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre === b.pre) return 0;
  if (a.pre === "") return 1;
  if (b.pre === "") return -1;
  return comparePrerelease(a.pre, b.pre);
}

/**
 * Compare two prerelease strings by semver §11: dot-separated identifiers,
 * numeric ones numerically and below alphanumeric ones, the rest lexically,
 * a longer list above its own prefix. Plain `localeCompare` would order
 * `rc.10` below `rc.9`.
 * @param {string} left - the first prerelease.
 * @param {string} right - the second prerelease.
 * @returns {number} negative, zero or positive like a comparator.
 */
function comparePrerelease(left, right) {
  const a = left.split(".");
  const b = right.split(".");
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const numericX = /^\d+$/.test(x);
    const numericY = /^\d+$/.test(y);
    if (numericX && numericY) return Number(x) - Number(y);
    if (numericX) return -1;
    if (numericY) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Read the installed version of one peer, or undefined when it cannot resolve.
 * @param {string} packageName - the peer package.
 * @returns {string | undefined} the installed version.
 */
function installedPeer(packageName) {
  const require = createRequire(join(ROOT, "package.json"));
  try {
    const manifest = /** @type {{ version?: string }} */ (JSON.parse(readFileSync(require.resolve(`${packageName}/package.json`), "utf8")));
    return manifest.version;
  } catch {
    return undefined;
  }
}

/**
 * The install remedy for one distro and family.
 * @param {string} distro - the distro name.
 * @param {string} family - the detected family, or `unknown`.
 * @returns {string} the copy-paste command.
 */
function installRemedy(distro, family) {
  return `wsl.exe -d ${distro} -u root -- ${INSTALL[family] ?? INSTALL["apt-get"]}`;
}

/**
 * Refuse a fix through the read-only alias.
 * @returns {number} the exit status.
 */
function rejectReadOnly() {
  console.error("doctor: --read-only refuses --fix/--install; run `pnpm run doctor -- --fix` instead");
  return 2;
}

/**
 * Run the doctor.
 * @param {{ distro: string, json: boolean, fix: boolean, install: boolean, yes: boolean, readOnly: boolean }} options - the parsed options.
 * @returns {Promise<number>} the exit status.
 */
async function main(options) {
  if (options.readOnly && (options.fix || options.install)) return rejectReadOnly();
  /** @type {Check[]} */
  const checks = [];
  /**
   * @param {string} id - the check id.
   * @param {Check["status"]} status - the verdict.
   * @param {string} title - what was checked.
   * @param {string} [detail] - the evidence.
   * @param {string} [remedy] - the next step.
   */
  const check = (id, status, title, detail, remedy) => {
    checks.push({ id, status, title, ...(detail === undefined ? {} : { detail }), ...(remedy === undefined ? {} : { remedy }) });
  };

  // ---- host ----------------------------------------------------------------
  const windows = await run([CMD, "/c", "ver"]);
  const build = /[0-9][0-9.]*/.exec(windows.stdout.replace(/\0/g, ""));
  if (build !== null) check("host.windows", "ok", "Windows build", build[0]);
  else check("host.windows", "info", "Windows build", "unreadable through cmd.exe; run this from Windows or a WSL with interop enabled");

  const version = await run([WSL, "--version"]);
  const wslVersion = version.stdout.replace(/\0/g, "").split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 2).join(" ");
  if (version.ok && wslVersion.length > 0) check("host.wsl", "ok", "WSL version", wslVersion);
  else check("host.wsl", "warn", "WSL version", "wsl.exe --version failed; WSL 1 or a very old build", "wsl.exe --update, then confirm the distro runs as WSL 2 (wsl.exe -l -v shows VERSION 2)");

  const listed = await run([WSL, "-l", "-q"]);
  const distros = listed.ok ? parseDistroList(listed.stdout.replace(/\0/g, "")) : [];
  if (distros.length === 0) {
    check("host.distros", "fail", "Installed distros", "none", "wsl.exe --list --online lists names; wsl.exe --install -d <name> installs one, then reopen the session");
  } else {
    check("host.distros", "ok", "Installed distros", distros.join(", "));
  }
  const distro = options.distro.length > 0 ? options.distro : distros[0] ?? "";
  if (distro.length === 0) return report(checks, { json: options.json });

  if (options.distro.length > 0 && !distros.includes(options.distro)) {
    check("distro.present", "fail", `Distro "${distro}"`, `not in [${distros.join(", ")}]`, `wsl.exe --install -d ${distro}; this doctor never installs a distro for you`);
    return report(checks, { json: options.json });
  }

  const alive = await inDistro(distro, "printf %s ok");
  if (!alive.ok || alive.stdout.trim() !== "ok") {
    check("distro.reachable", "fail", `Distro "${distro}"`, "wsl.exe could not run a command in it (stopped, wedged, or missing)", `wsl.exe -d ${distro} -- true; if that hangs, wsl.exe --shutdown, then retry`);
    return report(checks, { json: options.json });
  }
  check("distro.reachable", "ok", `Distro "${distro}"`, "answers commands");

  // ---- distro facts --------------------------------------------------------
  const shellAnswer = await inDistro(distro, 's=$(getent passwd "$(id -u)" | cut -d: -f7); [ -n "$s" ] || s=$SHELL; printf %s "$s"');
  const shell = shellAnswer.stdout.trim();
  if (shell.startsWith("/")) check("distro.shell", "ok", "Login shell", shell);
  else check("distro.shell", "fail", "Login shell", shell.length === 0 ? "no shell reported" : shell, `check the user's /etc/passwd entry in "${distro}": getent passwd "$(id -u)"`);

  const homeAnswer = await inDistro(distro, 'printf %s "$HOME"');
  const home = homeAnswer.stdout.trim();
  if (home.startsWith("/")) check("distro.home", "ok", "Home", home);
  else check("distro.home", "fail", "Home", home.length === 0 ? "no home reported" : home, `check the default user's home in "${distro}": getent passwd "$(id -u)"`);

  const kernel = (await inDistro(distro, "uname -r")).stdout.trim();
  check("distro.kernel", "info", "Kernel", kernel.length > 0 ? kernel : "unreadable");

  const familyAnswer = await inDistro(distro, `for f in ${FAMILIES.join(" ")}; do command -v "$f" >/dev/null 2>&1 && { echo "$f"; exit 0; }; done; echo unknown`);
  const family = familyAnswer.stdout.trim();
  check("distro.family", "info", "Package family", family.length > 0 ? family : "unknown");

  // ---- sandbox prerequisites ----------------------------------------------
  const bwrapPath = (await inDistro(distro, "command -v bwrap")).stdout.trim();
  const install = installRemedy(distro, family);
  if (bwrapPath.length === 0) {
    check("sandbox.bwrap", "fail", "bubblewrap", "missing; every confined command fails closed without it", `${install}, or run "pnpm run bootstrap -- ${distro} --install"`);
  } else {
    check("sandbox.bwrap", "ok", "bubblewrap", bwrapPath);
    const userns = await inDistro(distro, "bwrap --ro-bind / / -- true");
    if (userns.ok) check("sandbox.bwrap-usable", "ok", "bubblewrap usability", "a read-only profile runs");
    else check("sandbox.bwrap-usable", "fail", "bubblewrap usability", "installed but the read-only profile failed", "the kernel likely disables unprivileged user namespaces; reinstalling will not help — see docs/LIMITATIONS.md");
  }

  // ---- session sandbox prerequisites --------------------------------------
  const systemd = await inDistro(distro, 'if [ -d /run/systemd/system ]; then printf "systemd %s" "$(cat /proc/1/comm)"; else printf "none %s" "$(cat /proc/1/comm)"; fi');
  if (!systemd.stdout.startsWith("systemd")) {
    check("session.systemd", "fail", "systemd as PID 1", systemd.stdout.trim().length > 0 ? systemd.stdout.trim() : "not systemd", `set [boot] systemd=true in /etc/wsl.conf inside "${distro}", run "wsl.exe --shutdown", then reopen the session. Without it, sessionSandbox cannot run`);
  } else check("session.systemd", "ok", "systemd as PID 1", "running");

  const systemdRun = (await inDistro(distro, "command -v systemd-run")).stdout.trim();
  if (systemdRun.length > 0) check("session.systemd-run", "ok", "systemd-run", systemdRun);
  else check("session.systemd-run", "fail", "systemd-run", "missing; the distro's systemd package is incomplete", `reinstall systemd inside "${distro}" (apt-get install --reinstall systemd, or the family's equivalent)`);

  const userManager = (await inDistro(distro, "systemctl --user is-system-running 2>/dev/null || true")).stdout.trim();
  if (userManager === "running" || userManager === "degraded") check("session.user-manager", "ok", "systemd user manager", userManager);
  else check("session.user-manager", "fail", "systemd user manager", userManager.length > 0 ? userManager : "unreachable", `log in to "${distro}" once, or enable lingering (next remedy), then retry`);

  const linger = (await inDistro(distro, 'loginctl show-user "$(id -un)" -p Linger 2>/dev/null')).stdout.trim();
  if (linger === "Linger=yes") check("session.linger", "ok", "Linger", linger);
  else check("session.linger", "fail", "Linger", linger.length > 0 ? linger : "unset", `wsl.exe -d ${distro} -- loginctl enable-linger "$(id -un)" (this needs the user's own session; run it inside the distro)`);

  // ---- optional tools ------------------------------------------------------
  /** The optional tools, in the order users notice them losing. */
  /** @type {Array<[string, string]>} */
  const optionalTools = [["rg", "in-distro search"], ["git", "workspace-change baselines"], ["inotifywait", "the watcher's primary backend"]];
  for (const [tool, purpose] of optionalTools) {
    const found = (await inDistro(distro, `command -v ${tool}`)).stdout.trim();
    if (found.length > 0) check(`tools.${tool}`, "ok", tool, found);
    else check(`tools.${tool}`, "warn", tool, `missing; ${purpose} degrades to a slower fallback`, install);
  }

  // ---- agents and caches ---------------------------------------------------
  const arch = (await inDistro(distro, "uname -m")).stdout.trim();
  const packaged = ["x86_64", "aarch64"].includes(arch) ? join(ROOT, "agent", "native", `linux-${arch}`, "dsh-wsl-agent") : "";
  if (arch.length === 0) check("agent.arch", "info", "Distro architecture", "unreadable");
  else if (packaged.length === 0) check("agent.arch", "info", "Distro architecture", `${arch} has no packaged native agent; the shell agent is the only backend`);
  else if (existsSync(packaged)) check("agent.native", "ok", "Packaged native agent", packaged.slice(ROOT.length + 1));
  else check("agent.native", "warn", "Packaged native agent", `missing for ${arch}`, "reinstall the plugin (the binaries ship with the package), or use agentBackend: shell");

  const cache = (await inDistro(distro, CACHE_REPORT)).stdout.trim();
  if (cache === "none" || cache.length === 0) check("agent.cache", "info", "Agent cache", "empty (a first command populates it)");
  else {
    const entries = cache.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const bad = entries.filter((line) => line.startsWith("noexec ")).length;
    check("agent.cache", bad > 0 ? "warn" : "ok", "Agent cache", `${entries.length} cached binary(ies)${bad > 0 ? `, ${bad} not executable` : ""}`, bad > 0 ? `rm -rf ~/.cache/dsh-wsl/agent inside "${distro}"; the next command repopulates it` : undefined);
  }

  const scopes = (await inDistro(distro, STALE_SCOPE_REPORT)).stdout.trim();
  const scopeLines = scopes === "none" || scopes.length === 0 ? [] : scopes.split(/\r?\n/);
  const stale = scopeLines.filter((line) => /\sstale(\s|$)/.test(line)).length;
  const livePids = scopeLines.flatMap((line) => {
    const m = /\spids:([0-9 ]+)$/.exec(line);
    if (m === null) return [];
    return (m[1] ?? "").trim().split(/\s+/).filter((p) => p.length > 0);
  });
  // ---- resident handshake --------------------------------------------------
  const agentScript = join(ROOT, "agent", "wsl-agent.sh");
  if (!agentScript.startsWith("/")) {
    check("agent.handshake", "info", "Agent handshake", "skipped: run the doctor from inside the distro (the script path is a Windows path)");
  } else if (!existsSync(agentScript)) {
    check("agent.handshake", "fail", "Agent handshake", "agent/wsl-agent.sh is missing from this install", "reinstall the plugin; the shell agent ships with the package");
  } else {
    const handshake = await probeResident(distro, agentScript);
    if (handshake.ok) {
      const live = livePids.length > 0
        ? `; a live resident (pid${livePids.length > 1 ? "s" : ""} ${livePids.join(", ")}) is already running in this distro — this check starts a fresh one, which cannot read its last error`
        : "";
      check("agent.handshake", handshake.digestMatches ? "ok" : "fail", "Agent handshake",
        `pid ${handshake.pid}, protocol ${PROTOCOL_VERSION}, digest ${handshake.digestMatches ? "matches" : "MISMATCH — the distro reads a different script than this package"}${live}`,
        handshake.digestMatches ? undefined : "resync the runtime copy (pnpm run sync:windows), then restart the app");
    } else {
      check("agent.handshake", "fail", "Agent handshake", handshake.detail, "restart the DSH app; if it persists, delete ~/.cache/dsh-wsl/agent inside the distro and rerun the doctor");
    }
  }

  // ---- stale session scopes ------------------------------------------------
  if (scopeLines.length === 0) check("runtime.scopes", "info", "Session scopes", "none (no user manager, or none left behind)");
  else if (stale === 0) check("runtime.scopes", "ok", "Session scopes", `${scopeLines.length} live, none stale`);
  else check("runtime.scopes", "warn", "Session scopes", `${stale} stale of ${scopeLines.length}`, "--fix stops them (the same sweep the session preflight runs); they are safe to stop when no agent process is inside");

  // ---- sessions across running distros (WSL-309) ----------------------------
  // The single-distro checks above answer "is this distro healthy?"; this
  // survey answers "what is running right now, everywhere?" — the concurrent
  // sessions coordinate routing makes possible, made visible. Idle timers are
  // the host process's private state and stay out: a scope's presence and its
  // resident pids are the facts the distro side can attest.
  if (!options.json) {
    // `run` settles an object ({ ok, stdout, code }); `-q` prints plain names,
    // and the running list's header is dropped by the intersection with them.
    const names = ((await run([WSL, "--list", "-q"])).stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    // The default distro carries a localized marker ("ubuntu (默认值)" /
    // "ubuntu (default)") — strip a trailing parenthesized note before the
    // intersection with the name list.
    const running = ((await run([WSL, "--list", "--running"])).stdout ?? "").split(/\r?\n/).map((line) => line.trim().replace(/\s+\([^)]*\)$/, "")).filter((line) => names.includes(line));
    console.log("");
    console.log("sessions across running distros");
    if (running.length === 0) {
      console.log("  (none)");
    } else {
      for (const d of running) {
        const report = (await inDistro(d, STALE_SCOPE_REPORT)).stdout.trim();
        const lines = report === "none" || report.length === 0 ? [] : report.split(/\r?\n/);
        if (report === "none") {
          console.log(`  ${d}  no user manager — scopes unavailable`);
          continue;
        }
        if (lines.length === 0) {
          console.log(`  ${d}  no session scopes`);
          continue;
        }
        for (const line of lines) {
          const m = /^(\S+) (active|stale) pids:(.*)$/.exec(line);
          if (m === null) { console.log(`  ${d}  ${line}`); continue; }
          const scope = m[1] ?? line;
          const state = m[2] ?? "";
          const pidNote = m[3] === "none" ? "" : `  resident pids:${(m[3] ?? "").trim()}`;
          console.log(`  ${d}  ${scope}  ${state}${pidNote}`);
        }
      }
    }
  }

  // ---- peers ---------------------------------------------------------------
  const manifest = /** @type {{ peerDependencies?: Record<string, string> }} */ (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")));
  const peers = Object.entries(manifest.peerDependencies ?? {});
  const badPeers = [];
  const unknownPeers = [];
  for (const [name, range] of peers) {
    const installed = installedPeer(name);
    if (installed === undefined) badPeers.push(`${name}: not installed (want ${range})`);
    else if (peerSatisfied(installed, range) === false) badPeers.push(`${name}: ${installed} (want ${range})`);
    else if (peerSatisfied(installed, range) === undefined) unknownPeers.push(`${name}: ${installed} (range ${range} unchecked)`);
  }
  if (badPeers.length === 0) check("peers.versions", "ok", "Peer versions", `${peers.length} pinned peer(s) match${unknownPeers.length > 0 ? `; ${unknownPeers.length} unchecked` : ""}`);
  else check("peers.versions", "fail", "Peer versions", badPeers.join("; "), "install the peer set this plugin pins (pnpm install in the plugin, or reinstall/upgrade it against this harness); see docs/PEER-PARITY.md");

  // ---- profile-patch trap --------------------------------------------------
  const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
  const profilesDir = join(dshHome, "profiles");
  if (!existsSync(profilesDir)) {
    check("config.profiles", "info", "Profile patches", `no profiles under ${profilesDir}`);
  } else {
    /** @type {string[]} */
    const trapped = [];
    let seen = 0;
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const patch = join(profilesDir, entry.name, "cordis.patch.yml");
      if (!existsSync(patch)) continue;
      seen += 1;
      const text = readFileSync(patch, "utf8");
      if (/^\s*-\s*id:\s*(wsl-shell|wsl-fs)\s*$/m.test(text)) trapped.push(entry.name);
    }
    if (trapped.length > 0) {
      check("config.preset-trap", "warn", "Profile patches", `nested rows patched by id in: ${trapped.join(", ")}`, "wsl-shell and wsl-fs live inside preset-wsl; an id patch matches nothing and is silently ignored. Run \"pnpm run preset -- --check <patch>\" to get the complete block, or see docs/CONFIGURATION.md#overriding-the-rows-inside-preset-wsl");
    } else {
      check("config.profiles", "ok", "Profile patches", `${seen} profile patch(es) scanned`);
    }
  }

  // ---- fixes ---------------------------------------------------------------
  if (options.fix) {
    if (stale > 0) {
      const swept = await inDistro(distro, sessionScopeSweepScript());
      check("fix.scopes", swept.ok ? "ok" : "warn", "Swept stale scopes", swept.ok ? `${stale} stale scope(s) stopped` : "the sweep failed", swept.ok ? undefined : `systemctl --user list-units 'dsh-wsl-*.scope' inside "${distro}"`);
    }
    if (bwrapPath.length === 0) {
      if (!options.install) {
        check("fix.install", "info", "Package installation", "not attempted", "re-run with --fix --install (and --yes for a non-interactive run)");
      } else if (!(await confirm(`Install ${PACKAGES} in "${distro}" as root?`, options.yes))) {
        check("fix.install", "info", "Package installation", "declined", install);
      } else {
        const command = INSTALL[family] ?? INSTALL["apt-get"] ?? `apt-get install -y ${PACKAGES}`;
        const installed = await run([WSL, "-d", distro, "-u", "root", "--", "sh", "-c", command]);
        check("fix.install", installed.ok ? "ok" : "warn", "Package installation", installed.ok ? "completed" : "failed; see the output above", installed.ok ? undefined : install);
      }
    }
  }

  return report(checks, { json: options.json });
}

/**
 * Probe a fresh resident: start the shipped shell agent in the distro, read its
 * HELLO, verify the script digest, and stop it. This proves the agent path can
 * start and that the file the distro reads is the one this package shipped.
 *
 * @param {string} distro - the distro to probe.
 * @param {string} scriptPath - the agent script as a Linux path inside the distro.
 * @returns {Promise<{ ok: true, pid: number, digestMatches: boolean } | { ok: false, detail: string }>} the verdict, with the pid on success.
 */
function probeResident(distro, scriptPath) {
  return new Promise((settle) => {
    let settled = false;
    /** @param {{ ok: true, pid: number, digestMatches: boolean } | { ok: false, detail: string }} value - the verdict. */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      settle(value);
    };
    const child = spawn(WSL, ["-d", distro, "--exec", "sh", scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, WSL_UTF8: "1" },
    });
    const timer = setTimeout(() => finish({ ok: false, detail: "no HELLO within 5 s" }), 5000);
    let buffered = "";
    child.stdout.on("data", (chunk) => {
      buffered += String(chunk);
      const newline = buffered.indexOf("\n");
      if (newline < 0 || settled) return;
      const line = buffered.slice(0, newline).trim();
      const [kind, name, version, digest, pid] = line.split("|");
      if (kind !== "HELLO" || name !== AGENT_NAME) {
        finish({ ok: false, detail: `unexpected first line: ${line.slice(0, 80)}` });
        return;
      }
      if (Number(version) !== PROTOCOL_VERSION) {
        finish({ ok: false, detail: `protocol ${version}, expected ${PROTOCOL_VERSION}` });
        return;
      }
      const expected = createHash("sha256").update(readFileSync(scriptPath)).digest("hex");
      finish({ ok: true, pid: Number(pid), digestMatches: digest === expected });
    });
    child.on("error", (error) => finish({ ok: false, detail: error.message }));
    child.on("exit", () => {
      if (!settled) finish({ ok: false, detail: `agent exited before its HELLO (${buffered.trim().slice(0, 80)})` });
    });
    child.stdin.end();
  });
}

/**
 * Ask one yes/no question on the terminal.
 * @param {string} question - the prompt.
 * @param {boolean} yes - skip the prompt when true.
 * @returns {Promise<boolean>} the answer; false without a TTY.
 */
async function confirm(question, yes) {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Print the report and return the exit status.
 * @param {Check[]} checks - the collected checks.
 * @param {{ json: boolean }} options - the output mode.
 * @returns {number} 0 when nothing failed, 1 otherwise.
 */
function report(checks, options) {
  /** @param {string} status - the status to count. @returns {number} how many checks carry it. */
  const count = (status) => checks.filter((entry) => entry.status === status).length;
  const summary = { ok: count("ok"), warn: count("warn"), fail: count("fail"), info: count("info") };
  if (options.json) {
    console.log(JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), checks, summary }, null, 2));
  } else {
    console.log("dsh-plugin-wsl-env doctor");
    let section = "";
    for (const entry of checks) {
      const current = entry.id.split(".")[0] ?? "";
      if (current !== section) {
        section = current;
        console.log(`\n${section}`);
      }
      const mark = entry.status === "ok" ? "ok  " : entry.status === "warn" ? "warn" : entry.status === "fail" ? "fail" : "info";
      console.log(`  ${mark}  ${entry.title}${entry.detail === undefined ? "" : ` — ${entry.detail}`}`);
      if (entry.remedy !== undefined) console.log(`        fix: ${entry.remedy}`);
    }
    console.log(`\n${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail, ${summary.info} info`);
    if (summary.fail > 0) console.log("run with --fix to sweep stale scopes; --fix --install asks before installing packages");
  }
  return summary.fail > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("node scripts/doctor.mjs [distro] [--json] [--fix] [--install] [--yes] [--read-only]");
  } else {
    process.exitCode = await main(options);
  }
}
