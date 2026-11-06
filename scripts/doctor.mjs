#!/usr/bin/env node
/**
 * One-command environment doctor for this plugin (P0.2 / WSL-102; the verdict
 * and per-distro shape: WSL-316).
 *
 * Answers "will this plugin work here, and if not, what do I paste?" in one
 * read-only pass: Windows and WSL versions, the distro and its shell, bubblewrap
 * usability, systemd / the user manager / `systemd-run` / Linger, the optional
 * tools, the peer versions the plugin is loaded against, the native-agent cache,
 * a fresh-agent handshake, stale session scopes, the known profile-patch trap,
 * and whether a newer stable release exists on the registry.
 *
 *   node scripts/doctor.mjs [distro] [--json] [--fix] [--install] [--yes] [--read-only]
 *                            [--wsl <path to wsl.exe>]
 *
 * Exit status is 0 when the verdict is `ready` and 1 when it is `blocked`;
 * `ready` means every check that can fail the first command passed **under the
 * effective configuration** (the profile layers the app actually loads, not the
 * shipped defaults). The blocking rule has one invariant: a `fail` blocks —
 * config-awareness downgrades a check's *status* (a missing systemd only fails
 * under `sessionSandbox: true`; `auto` and `false` downgrade it to a warning),
 * so there is no per-id exception table to drift. `skipped` marks a check that
 * could not run because another check failed. `--fix` performs only safe
 * actions: it sweeps stale `dsh-wsl-*.scope` units (the same sweep the session
 * preflight runs). Installing packages needs `--install` *and* an explicit
 * confirmation (`--yes` skips the prompt, not the flag), so a fix run can never
 * install silently.
 *
 * `--read-only` refuses `--fix`/`--install`; `scripts/diagnose.sh` uses it to stay an
 * alias that can never change the machine.
 *
 * `--json` prints one machine-readable report instead of the human sections.
 * The report shape is versioned (`schemaVersion: 2`): `verdict`, `blockers`,
 * `distroVerdicts`, the effective `config`, and per-check `distro` /
 * `blocksFirstCommand` fields.
 *
 * This CLI always probes a **fresh** resident — the app process's live
 * resident's `deaths`/`lastError` are host-private (no IPC), and the report
 * says so at the handshake check. Consumers holding the plugin's context
 * merge them through `doctorReport()` in `lib/index.js` / the
 * `mergeLiveResidentStatus` helper in `lib/doctor-live.js` (WSL-313).
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
import { effectiveMaskWindowsDrive } from "../lib/index.js";
import { AGENT_NAME, PROTOCOL_VERSION, encodeExecFrame, encodeFsbFrame, parseAgentLine } from "../lib/agent-protocol.js";
import { bwrapArgvPrefix } from "../lib/bwrap.js";
import { sessionScopeSweepScript } from "../lib/session-scope.js";
import { parseListeningPorts, procNetScript } from "../lib/ports.js";
import { updateFactMessage } from "../lib/update-check.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let WSL = "wsl.exe";
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
 * @property {"ok"|"warn"|"fail"|"info"|"skipped"} status - the verdict.
 * @property {string} title - what was checked.
 * @property {string} [detail] - the evidence.
 * @property {string} [remedy] - a copy-paste next step when not ok.
 * @property {string} [distro] - the distro the check ran against (distro-scoped checks only).
 * @property {boolean} [blocksFirstCommand] - whether a `fail` here blocks the first command (stamped by `report()`: true for every `fail`; config-awareness downgrades statuses rather than keeping a per-id exception table).
 */

/**
 * The effective configuration the blocking verdict answers under.
 * @typedef {object} EffectiveConfig
 * @property {string} distro - `auto`, `default` or a pinned distro name.
 * @property {string} sessionSandbox - `true`, `false` or `auto`.
 * @property {string} agentBackend - `auto`, `native` or `shell`.
 * @property {string} sandbox - the fs-routing confinement stance.
 * @property {string} maskWindowsDrive - the drive-masking stance (when `interopVisibility` is unset).
 * @property {string} interopVisibility - the one-key stance (`""` unset, `visible`, `masked` or `disabled`); when set it takes precedence over `maskWindowsDrive`.
 * @property {string} source - where the values came from.
 * @property {string[]} overrides - the profile layers that changed keys, "`<name>`: `<keys>`".
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
 * Parse `wsl.exe -l -v`'s table. The state column is localized, so only the
 * shape is trusted: `NAME[*] <state> <version>`; the star marks WSL's own
 * default and the version digit is what `distro.wsl-mode` will classify.
 * @param {string} stdout - the command's output, nulls stripped.
 * @returns {Array<{ name: string, isDefault: boolean, version: string }>} one entry per table row; the header drops out by shape.
 */
export function parseWslVerbose(stdout) {
  /** @type {Array<{ name: string, isDefault: boolean, version: string }>} */
  const entries = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\S+?)(\*)?\s+\S+\s+(\d+)\s*$/.exec(line);
    if (match === null) continue;
    const columns = /** @type {RegExpExecArray} */ (match);
    entries.push({
      name: (columns[1] ?? "").replace(/\*$/, ""),
      isDefault: columns[2] === "*",
      version: columns[3] ?? "",
    });
  }
  return entries;
}

/** The `[wsl2]` keys the `.wslconfig` validator knows; anything else is reported as ignored by WSL. */
const WSLCONFIG_KEYS = new Set([
  "kernel", "kernelCommandLine", "memory", "processors", "swap", "swapFile", "pageReporting",
  "localhostForwarding", "nestedVirtualization", "guiApplications", "debugConsole",
  "earlyBootLogging", "vmIdleTimeout", "safeMode", "defaultVhdSize", "networkingMode",
  "dnsTunneling", "firewall", "autoProxy",
]);
/** The `[experimental]` keys the validator knows. */
const WSLCONFIG_EXPERIMENTAL_KEYS = new Set(["sparseVhd", "autoMemoryReclaim", "hostAddressLoopback", "guiApplications"]);

/**
 * Byte-parse one WSL size scalar ("4GB", "512MB", "8368805888", "0").
 * @param {string} value - the raw scalar.
 * @returns {number | undefined} the size in bytes, or undefined when the shape is not a size.
 */
export function parseWslSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i.exec(value.trim());
  if (match === null) return undefined;
  const columns = /** @type {RegExpExecArray} */ (match);
  const scale = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 }[(columns[2] ?? "b").toLowerCase()] ?? 1;
  return Math.round(Number(columns[1] ?? 0) * scale);
}

/**
 * Parse and validate `%USERPROFILE%\.wslconfig`. WSL **silently ignores** a
 * malformed file and unknown keys, so this parser is the only place the trap
 * gets named; known keys with semantic hazards (no memory, tiny memory, the
 * localhost forwarding the port survey depends on) are called out with their
 * consequence. Findings are warnings, never blockers — the file degrades
 * advice, not the first command.
 * @param {string} text - the file's text.
 * @returns {{ problems: string[], keyCount: number }} the findings, each naming its line.
 */
export function parseWslConfig(text) {
  /** @type {string[]} */
  const problems = [];
  let keyCount = 0;
  let section = "";
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    const heading = /^\[(.+)\]$/.exec(line);
    if (heading !== null) {
      section = (/** @type {RegExpExecArray} */ (heading)[1] ?? "").trim().toLowerCase();
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      problems.push(`line ${index + 1} is not "key = value" — WSL silently ignores a malformed file`);
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    keyCount += 1;
    const known = section === "wsl2" ? WSLCONFIG_KEYS : section === "experimental" ? WSLCONFIG_EXPERIMENTAL_KEYS : null;
    if (known === null) {
      problems.push(`line ${index + 1}: unknown section [${section}] — WSL ignores it`);
      continue;
    }
    if (!known.has(key)) {
      problems.push(`line ${index + 1}: unknown key "${key}" in [${section}] — WSL ignores it`);
      continue;
    }
    if ((key === "memory" || key === "swap") && section === "wsl2") {
      const bytes = parseWslSize(value);
      if (bytes === undefined) problems.push(`line ${index + 1}: ${key}="${value}" is not a size (expect 4GB, 512MB, …)`);
      else if (key === "memory" && bytes === 0) problems.push(`line ${index + 1}: memory=0 — the VM gets no memory and every distro misbehaves`);
      else if (key === "memory" && bytes < 512 * 1024 * 1024) problems.push(`line ${index + 1}: memory="${value}" is below 512MB — the VM will thrash or OOM`);
    }
    if (key === "localhostForwarding" && section === "wsl2" && value === "false") {
      problems.push(`line ${index + 1}: localhostForwarding=false — the port survey's http://localhost:<port> URLs will not resolve on the Windows side`);
    }
  }
  return { problems, keyCount };
}

/**
 * Parse an INI-shaped file (`wsl.conf` and `.wslconfig` share the shape) into
 * sections. Section and key names are lowercased for lookup; the last value
 * per key wins; comment lines and lines without `=` are skipped.
 * @param {string} text - the file's text.
 * @returns {Record<string, Record<string, string>>} the sections, keyed by their lowercase name.
 */
export function parseIni(text) {
  /** @type {Record<string, Record<string, string>>} */
  const sections = {};
  let current = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith(";")) continue;
    const heading = /^\[(.+)\]$/.exec(line);
    if (heading !== null) {
      current = (/** @type {RegExpExecArray} */ (heading)[1] ?? "").trim().toLowerCase();
      sections[current] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const section = sections[current] ?? (sections[current] = {});
    section[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return sections;
}

/**
 * The text of one patch row (`- id: <rowId>` down to the next row at the same
 * or shallower indent). This is the same line discipline the preset helper
 * applies to the shipped patch, so both tools read rows identically by
 * construction.
 * @param {string} text - the patch file's text.
 * @param {string} rowId - the row id to extract.
 * @returns {string} the row's text, or "" when the file names no such row.
 */
export function rowBlock(text, rowId) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^\\s*- id: ${rowId}\\s*$`).test(line));
  if (start < 0) return "";
  const header = /** @type {string} */ (lines[start]);
  const indent = header.length - header.trimStart().length;
  let end = start + 1;
  while (end < lines.length) {
    const line = /** @type {string} */ (lines[end]);
    if (line.trim().length > 0 && line.length - line.trimStart().length <= indent) break;
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

/**
 * The value one key sets inside a row block: the FIRST occurrence wins, which
 * inside `preset-wsl` means the `wsl-shell` row's value (the command plane is
 * the first-command gate this verdict answers for). Comment lines never match
 * — the anchor requires the key at line start after indent.
 * @param {string} block - the row block's text.
 * @param {string} key - the YAML key.
 * @returns {string | undefined} the scalar with quotes stripped, or undefined when unset.
 */
export function rowKey(block, key) {
  const match = new RegExp(`^\\s*${key}: (.*)$`, "m").exec(block);
  if (match === null) return undefined;
  return (/** @type {RegExpExecArray} */ (match)[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

/**
 * Read the configuration the blocking verdict must answer under: the shipped
 * preset's values, overlaid by every profile layer under `$DSH_HOME/profiles/*`
 * that carries a `preset-wsl` row (the preset helper's output shape) or an
 * `fs-routing` patch (a root-plane row, patchable by id). A profile file whose
 * rows name none of the five keys changes nothing and is not an error — the
 * recognizer only claims the shapes it knows, and the `config.effective` check
 * reports exactly what was read and from where.
 * @param {string} dshHome - the harness home (`DSH_HOME` or `~/.dsh`).
 * @param {string} root - the package root holding the shipped `cordis.patch.yml`.
 * @returns {{ config: EffectiveConfig, recognized: boolean }} the effective values and whether the shipped rows were recognized at all.
 */
export function effectiveConfig(dshHome, root) {
  /** @type {EffectiveConfig} */
  let config = { distro: "auto", sessionSandbox: "true", agentBackend: "auto", sandbox: "true", maskWindowsDrive: "false", interopVisibility: "", source: "the shipped preset", overrides: [] };
  let recognized = false;
  const shipped = readFileSync(join(root, "cordis.patch.yml"), "utf8");
  const preset = rowBlock(shipped, "preset-wsl");
  const routing = rowBlock(shipped, "fs-routing");
  const distro = rowKey(preset, "distro");
  const sessionSandbox = rowKey(preset, "sessionSandbox");
  const agentBackend = rowKey(preset, "agentBackend");
  const sandbox = rowKey(routing, "sandbox");
  const maskWindowsDrive = rowKey(routing, "maskWindowsDrive");
  if (sessionSandbox !== undefined) {
    recognized = true;
    config = {
      distro: distro === "" || distro === undefined ? "auto" : distro,
      sessionSandbox: sessionSandbox === "false" ? "false" : sessionSandbox === "auto" ? "auto" : "true",
      agentBackend: agentBackend ?? "auto",
      sandbox: sandbox ?? "true",
      maskWindowsDrive: maskWindowsDrive ?? "false",
      interopVisibility: rowKey(routing, "interopVisibility") ?? "",
      source: "the shipped preset",
      overrides: [],
    };
  }
  const profilesDir = join(dshHome, "profiles");
  if (!existsSync(profilesDir)) return { config, recognized };
  for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const patch = join(profilesDir, entry.name, "cordis.patch.yml");
    if (!existsSync(patch)) continue;
    const text = readFileSync(patch, "utf8");
    /** @type {string[]} */
    const changed = [];
    const next = { ...config };
    const layerPreset = rowBlock(text, "preset-wsl");
    const layerRouting = rowBlock(text, "fs-routing");
    for (const [block, keys] of [[layerPreset, ["distro", "sessionSandbox", "agentBackend"]], [layerRouting, ["sandbox", "maskWindowsDrive"]]]) {
      const source = /** @type {string} */ (block);
      /** The scalar keys the overlay may change; `source`/`overrides` are bookkeeping, not overlay inputs. */
      const scalar = /** @type {const} */ (["distro", "sessionSandbox", "agentBackend", "sandbox", "maskWindowsDrive", "interopVisibility"]);
      for (const key of /** @type {string[]} */ (keys)) {
        const value = rowKey(source, key);
        if (value === undefined || value === next[/** @type {keyof EffectiveConfig} */ (key)]) continue;
        const normalized = key === "distro" && value === "" ? "auto" : key === "sessionSandbox" ? (value === "false" ? "false" : value === "auto" ? "auto" : "true") : value;
        if (normalized === next[/** @type {keyof EffectiveConfig} */ (key)]) continue;
        next[/** @type {(typeof scalar)[number]} */ (key)] = normalized;
        changed.push(key);
      }
    }
    if (changed.length > 0) {
      next.source = `profile "${entry.name}"`;
      next.overrides = [...config.overrides, `${entry.name}: ${changed.join(", ")}`];
      config = next;
    }
  }
  return { config, recognized };
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
 * @returns {{ distro: string, wsl: string, json: boolean, fix: boolean, install: boolean, yes: boolean, readOnly: boolean, all: boolean, help: boolean }} the options.
 */
function parseArgs(argv) {
  const options = {
    distro: "",
    wsl: "",
    json: false,
    fix: false,
    install: false,
    yes: false,
    readOnly: false,
    all: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--json") options.json = true;
    else if (arg === "--fix") options.fix = true;
    else if (arg === "--install") options.install = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--read-only") options.readOnly = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--distro") options.distro = argv[++i] ?? "";
    else if (arg.startsWith("--distro=")) options.distro = arg.slice("--distro=".length);
    else if (arg === "--wsl") options.wsl = argv[++i] ?? "";
    else if (arg.startsWith("--wsl=")) options.wsl = arg.slice("--wsl=".length);
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

/** The registries the update check asks, in order; the official one first. */
const UPDATE_REGISTRIES = ["https://registry.npmjs.org", "https://registry.npmmirror.com"];

/**
 * The registries one run asks: `DSH_UPDATE_REGISTRIES` overrides the defaults
 * (comma-separated, for an operator pinned to one mirror); set it empty to ask
 * none at all — an air-gapped machine's way to keep the check silent without
 * paying two connect timeouts.
 * @returns {string[]} the registry base URLs.
 */
function updateRegistries() {
  const configured = process.env.DSH_UPDATE_REGISTRIES;
  if (configured !== undefined) return configured.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return UPDATE_REGISTRIES;
}

/**
 * Read the stable channel's newest release off one registry packument. The
 * full document (not the abbreviated one) is requested, because only it
 * carries the per-version deprecation message.
 * @param {unknown} body - the parsed packument JSON.
 * @returns {{ version: string, deprecated?: string, publishedAt?: string } | undefined} the release, or undefined when the document names none.
 */
export function latestFromPackument(body) {
  if (typeof body !== "object" || body === null) return undefined;
  const packument = /** @type {{ "dist-tags"?: Record<string, unknown>, versions?: Record<string, unknown> }} */ (body);
  const tags = packument["dist-tags"];
  const versions = packument.versions;
  if (typeof tags !== "object" || tags === null || typeof versions !== "object" || versions === null) return undefined;
  const latest = tags.latest;
  if (typeof latest !== "string" || latest.length === 0) return undefined;
  const manifest = /** @type {{ deprecated?: unknown } | undefined} */ (versions[latest]);
  if (manifest === undefined || typeof manifest !== "object") return undefined;
  return {
    version: latest,
    ...(typeof manifest.deprecated === "string" && manifest.deprecated.length > 0 ? { deprecated: manifest.deprecated } : {}),
  };
}

/**
 * Ask the registries for the stable channel's newest release, official first,
 * mirror second — the same fallback order the harness's plugin install uses.
 * A short timeout keeps an offline run from stalling; every failure is an
 * undefined, never a throw.
 * @param {string[]} [registries] - the registries to ask; absent, `DSH_UPDATE_REGISTRIES` or the defaults (see {@link updateRegistries}).
 * @param {number} [timeoutMs] - per-registry timeout, for tests.
 * @returns {Promise<{ version: string, deprecated?: string, registry: string } | undefined>} the release and the registry that answered.
 */
export async function fetchLatestRelease(registries, timeoutMs = 5_000) {
  for (const registry of registries ?? updateRegistries()) {
    try {
      const response = await fetch(`${registry}/dsh-plugin-wsl-env`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      const latest = latestFromPackument(await response.json());
      if (latest !== undefined) return { ...latest, registry };
    } catch {
      // Offline, a blocked proxy, or a mirror that does not answer: the next
      // registry (or the undefined) speaks for this run.
    }
  }
  return undefined;
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
  console.error("doctor: --read-only refuses --fix/--install; run `pnpm run doctor --fix` instead");
  return 2;
}

/**
 * Run the doctor.
  * @param {{ distro: string, wsl: string, json: boolean, fix: boolean, install: boolean, yes: boolean, readOnly: boolean, all: boolean, help: boolean }} options - the parsed options.
 * @returns {Promise<number>} the exit status.
 */
async function main(options) {
  if (options.readOnly && (options.fix || options.install)) return rejectReadOnly();
  // One rebinding covers every probe below (`-l -q`, `inDistro`, the
  // resident handshake, the sessions survey): an explicit `--wsl` replaces
  // the module-level default for this whole run.
  const wslExe = options.wsl.length > 0 ? options.wsl : WSL;
  WSL = wslExe;
  /** @type {Check[]} */
  const checks = [];
  // A5: per-phase wall clock. The doctor must be fast enough to run twice;
  // the timings make a slow machine visible instead of felt, and give support
  // triage the per-section duration without a separate durations column.
  const runStart = Date.now();
  let phaseStart = Date.now();
  /** @type {Record<string, number>} */
  const timingsMs = {};
  /** Close the open phase under `name` and open the next one.
   * @param {string} name - the phase that just ended. */
  const phase = (name) => {
    timingsMs[name] = Date.now() - phaseStart;
    phaseStart = Date.now();
  };
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

  const version = await run([wslExe, "--version"]);
  const wslVersion = version.stdout.replace(/\0/g, "").split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 2).join(" ");
  if (version.ok && wslVersion.length > 0) check("host.wsl", "ok", "WSL version", wslVersion);
  else check("host.wsl", "warn", "WSL version", "wsl.exe --version failed; WSL 1 or a very old build", "wsl.exe --update, then confirm the distro runs as WSL 2 (wsl.exe -l -v shows VERSION 2)");

  phase("host");
  // ---- .wslconfig (the global VM config; host-level) ------------------------
  // WSL silently ignores a malformed file, so interop/masking advice can fail
  // to apply without a trace; this parser is where the trap gets named. The
  // read rides cmd.exe (the same interop path `host.windows` uses), which
  // works from Windows and from a WSL with interop regardless of where the
  // automount root sits — the route's own failure is reported, not guessed.
  const userProfile = (await run([CMD, "/c", "echo %USERPROFILE%"])).stdout.replace(/\0/g, "").trim();
  if (!/^[A-Za-z]:\\/.test(userProfile)) {
    check("config.wslconfig", "info", ".wslconfig", "USERPROFILE unreadable through cmd.exe — run the doctor from Windows or a WSL with interop to inspect the global VM config");
  } else {
    const answer = await run([CMD, "/c", `type "${userProfile}\\.wslconfig"`]);
    const text = answer.ok ? answer.stdout.replace(/\0/g, "") : "";
    if (text.trim().length === 0) {
      check("config.wslconfig", "ok", ".wslconfig", `no content in ${userProfile}\\.wslconfig (WSL defaults apply)`);
    } else {
      const { problems, keyCount } = parseWslConfig(text);
      if (problems.length > 0) {
        check("config.wslconfig", "warn", ".wslconfig", `${keyCount} key(s) read; ${problems.length} finding(s): ${problems.join("; ")}`, `fix ${userProfile}\\.wslconfig, then run "wsl.exe --shutdown" — the VM returns ~8 s later and reads the file fresh`);
      } else {
        check("config.wslconfig", "ok", ".wslconfig", `${keyCount} key(s) parsed from ${userProfile}\\.wslconfig, no findings`);
      }
    }
  }

  const listed = await run([wslExe, "-l", "-q"]);
  const distros = listed.ok ? parseDistroList(listed.stdout.replace(/\0/g, "")) : [];
  if (distros.length === 0) {
    check("host.distros", "fail", "Installed distros", "none", "wsl.exe --list --online lists names; wsl.exe --install -d <name> installs one, then reopen the session");
  } else {
    check("host.distros", "ok", "Installed distros", distros.join(", "));
  }
  // ---- effective configuration (read once, before anything config-gated) ---
  // The blocking verdict answers under the values the user actually runs, so
  // the shipped preset is overlaid by the profile layers before the target
  // set is derived (an effective `distro` pin narrows it) and the session
  // checks below assign their statuses. The `config.effective` row is emitted
  // later, in the config section, so the human output keeps its grouping.
  const dshHomeEarly = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
  const { config: effective, recognized: configRecognized } = effectiveConfig(dshHomeEarly, ROOT);
  const scopeMode = effective.sessionSandbox;
  /** The status a session-scope prerequisite gets when it is missing. */
  const sessionStatus = () => (scopeMode === "true" ? "fail" : "warn");
  const scopeNote = scopeMode === "auto"
    ? " — sessionSandbox: auto falls back to the per-command bwrap profile"
    : scopeMode === "false"
      ? " — sessionSandbox: false does not use the session scope"
      : "";
  /** Append the config-aware note to a prerequisite's evidence when the scope is not required.
   * @param {string} detail - the prerequisite's own evidence.
   * @returns {string} the evidence, with the fallback named when the scope is optional. */
  const withScopeNote = (detail) => (scopeMode === "true" ? detail : `${detail}${scopeNote}`);
  /** The drive-masking stance in effect, computed with the shipped precedence (interopVisibility over maskWindowsDrive). */
  const interopMasked = effectiveMaskWindowsDrive({
    interopVisibility: effective.interopVisibility === "" ? undefined : /** @type {"visible" | "masked" | "disabled"} */ (effective.interopVisibility),
    maskWindowsDrive: effective.maskWindowsDrive === "true",
  });

  phase("wslconfig");
  // ---- target selection ----------------------------------------------------
  // An explicit `--distro` wins; `--all` checks every installed distro;
  // otherwise the effective configuration decides: `auto` (the shipped
  // default) means the workspace decides, so every installed distro is a
  // candidate and all are checked; `default` resolves to the distro WSL
  // itself marks as default; a pinned name checks exactly that one.
  const runInfo = /** @type {{ distros: string[], config?: EffectiveConfig, timingsMs?: Record<string, number> }} */ ({ distros: [], timingsMs });
  runInfo.config = { ...effective };
  /** The `wsl.exe -l -v` table, parsed once: the default marker feeds target selection, the VERSION column feeds `distro.wsl-mode`. */
  const wslTable = parseWslVerbose((await run([wslExe, "-l", "-v"])).stdout.replace(/\0/g, ""));
  /** @type {string[]} */
  const targets = [];
  if (options.distro.length > 0) targets.push(options.distro);
  else if (options.all) targets.push(...distros);
  else if (effective.distro === "auto") targets.push(...distros);
  else if (effective.distro === "default") {
    const defaultDistro = wslTable.find((entry) => entry.isDefault)?.name;
    targets.push(...(defaultDistro !== undefined ? [defaultDistro] : distros));
  } else targets.push(effective.distro);

  const missing = targets.filter((target) => !distros.includes(target));
  if (missing.length > 0) {
    for (const name of missing) {
      checks.push({ id: "distro.present", status: "fail", title: `Distro "${name}"`, detail: `not in [${distros.join(", ")}]`, remedy: `wsl.exe --install -d ${name}; this doctor never installs a distro for you`, distro: name });
    }
    runInfo.distros = missing;
    return report(checks, { json: options.json }, runInfo);
  }
  if (targets.length === 0) return report(checks, { json: options.json }, runInfo);
  runInfo.distros = targets;

  /**
   * The distro-scoped checks for one target, pushed with the distro stamped
   * so the report can aggregate per-distro verdicts. An unreachable distro
   * fails its own reachability check and contributes nothing further — one
   * wedged distro must not mask the others.
   * @param {string} target - the distro name.
   * @returns {Promise<{ reachable: boolean, bwrapPath: string, stale: number, family: string }>} the state the fix section needs.
   */
  const collectDistroChecks = async (target) => {
    const check = (/** @type {string} */ id, /** @type {Check["status"]} */ status, /** @type {string} */ title, /** @type {string | undefined} */ detail = undefined, /** @type {string | undefined} */ remedy = undefined) => {
      checks.push({ id, status, title, ...(detail === undefined ? {} : { detail }), ...(remedy === undefined ? {} : { remedy }), distro: target });
    };
    const alive = await inDistro(target, "printf %s ok");
    if (!alive.ok || alive.stdout.trim() !== "ok") {
      check("distro.reachable", "fail", `Distro "${target}"`, "wsl.exe could not run a command in it (stopped, wedged, or missing)", `wsl.exe -d ${target} -- true; if that hangs, wsl.exe --shutdown, then retry`);
      return { reachable: false, bwrapPath: "", stale: 0, family: "unknown" };
    }
    check("distro.reachable", "ok", `Distro "${target}"`, "answers commands");

    // ---- distro facts --------------------------------------------------------
    const shellAnswer = await inDistro(target, 's=$(getent passwd "$(id -u)" | cut -d: -f7); [ -n "$s" ] || s=$SHELL; printf %s "$s"');
    const shell = shellAnswer.stdout.trim();
    if (shell.startsWith("/")) check("distro.shell", "ok", "Login shell", shell);
    else check("distro.shell", "fail", "Login shell", shell.length === 0 ? "no shell reported" : shell, `check the user's /etc/passwd entry in "${target}": getent passwd "$(id -u)"`);

    const homeAnswer = await inDistro(target, 'printf %s "$HOME"');
    const home = homeAnswer.stdout.trim();
    if (home.startsWith("/")) check("distro.home", "ok", "Home", home);
    else check("distro.home", "fail", "Home", home.length === 0 ? "no home reported" : home, `check the default user's home in "${target}": getent passwd "$(id -u)"`);

    const kernel = (await inDistro(target, "uname -r")).stdout.trim();
    check("distro.kernel", "info", "Kernel", kernel.length > 0 ? kernel : "unreadable");

    const familyAnswer = await inDistro(target, `for f in ${FAMILIES.join(" ")}; do command -v "$f" >/dev/null 2>&1 && { echo "$f"; exit 0; }; done; echo unknown`);
    const family = familyAnswer.stdout.trim();
    check("distro.family", "info", "Package family", family.length > 0 ? family : "unknown");

    // ---- WSL mode ------------------------------------------------------------
    // WSL1 is a declared non-goal, but until now it failed unexplained: the
    // session prerequisites named remedies, never the root cause. The -l -v
    // table carries the VERSION per distro, so name the cause.
    const wslMode = wslTable.find((entry) => entry.name === target)?.version ?? "";
    if (wslMode === "1") {
      check("distro.wsl-mode", "fail", "WSL mode", `WSL 1 — a declared non-goal: no systemd (no session scope, no Linger) and no unprivileged user namespaces (no bubblewrap)`, `wsl.exe --set-version ${target} 2 (the distro's files stay), then "wsl.exe --shutdown" and reopen the session`);
    } else if (wslMode === "") {
      check("distro.wsl-mode", "info", "WSL mode", `unreadable — the -l -v table named no version for "${target}"`);
    } else {
      check("distro.wsl-mode", "ok", "WSL mode", `WSL ${wslMode}`);
    }

    // ---- disk -----------------------------------------------------------------
    // A full root is the classic WSL "everything mysteriously fails" class:
    // the ext4 VHDX stops growing (or the Windows drive holding it is full)
    // and every write failure surfaces as something unrelated. One df call;
    // the fail line at 97% is where the first cache write starts to break.
    const dfAnswer = await inDistro(target, "df -Pm /");
    const dfLine = dfAnswer.stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)[1] ?? "";
    const dfFields = dfLine.split(/\s+/);
    const dfCapacity = Number((dfFields[4] ?? "").replace(/%$/, ""));
    const dfTotal = dfFields[1] ?? "?";
    const dfAvail = dfFields[3] ?? "?";
    if (!Number.isFinite(dfCapacity)) {
      check("distro.disk", "info", "Disk", "unreadable — df did not answer in the expected shape");
    } else if (dfCapacity >= 97) {
      check("distro.disk", "fail", "Disk", `/${dfCapacity}% used (${dfAvail} MiB free of ${dfTotal} MiB) — writes into the distro will start failing`, `free space inside "${target}" or on the Windows drive holding the ext4 VHDX; sparse VHD (the .wslconfig sparseVhd key) lets "wsl.exe --shutdown" shrink it back`);
    } else if (dfCapacity >= 90) {
      check("distro.disk", "warn", "Disk", `/${dfCapacity}% used (${dfAvail} MiB free of ${dfTotal} MiB)`, "plan a cleanup before the 97% line, where writes start to fail");
    } else {
      check("distro.disk", "ok", "Disk", `/${dfCapacity}% used (${dfAvail} MiB free of ${dfTotal} MiB)`);
    }

    // ---- sandbox prerequisites ----------------------------------------------
    let bwrapUsable = false;
    const bwrapPath = (await inDistro(target, "command -v bwrap")).stdout.trim();
    const install = installRemedy(target, family);
    if (bwrapPath.length === 0) {
      check("sandbox.bwrap", "fail", "bubblewrap", "missing; every confined command fails closed without it", `${install}, or run "pnpm run bootstrap ${target} --install"`);
    } else {
      check("sandbox.bwrap", "ok", "bubblewrap", bwrapPath);
      const userns = await inDistro(target, "bwrap --ro-bind / / -- true");
      if (userns.ok) {
        check("sandbox.bwrap-usable", "ok", "bubblewrap usability", "a read-only profile runs");
        bwrapUsable = true;
      } else check("sandbox.bwrap-usable", "fail", "bubblewrap usability", "installed but the read-only profile failed", "the kernel likely disables unprivileged user namespaces; reinstalling will not help — see docs/LIMITATIONS.md");
    }

    // ---- session sandbox prerequisites --------------------------------------
    // The statuses are config-aware: the scope is only *required* under
    // `sessionSandbox: true` (the shipped default); `auto` falls back to the
    // per-command bwrap profile and `false` does not use the scope at all, so
    // in both cases a missing prerequisite downgrades to a warning — a `fail`
    // always blocks, which is the invariant the verdict leans on.
    const systemd = await inDistro(target, 'if [ -d /run/systemd/system ]; then printf "systemd %s" "$(cat /proc/1/comm)"; else printf "none %s" "$(cat /proc/1/comm)"; fi');
    if (!systemd.stdout.startsWith("systemd")) {
      check("session.systemd", sessionStatus(), "systemd as PID 1", withScopeNote(systemd.stdout.trim().length > 0 ? systemd.stdout.trim() : "not systemd"), `set [boot] systemd=true in /etc/wsl.conf inside "${target}", run "wsl.exe --shutdown", then reopen the session. Without it, sessionSandbox cannot run`);
    } else check("session.systemd", "ok", "systemd as PID 1", "running");

    const systemdRun = (await inDistro(target, "command -v systemd-run")).stdout.trim();
    if (systemdRun.length > 0) check("session.systemd-run", "ok", "systemd-run", systemdRun);
    else check("session.systemd-run", sessionStatus(), "systemd-run", withScopeNote("missing; the distro's systemd package is incomplete"), `reinstall systemd inside "${target}" (apt-get install --reinstall systemd, or the family's equivalent)`);

    const userManager = (await inDistro(target, "systemctl --user is-system-running 2>/dev/null || true")).stdout.trim();
    if (userManager === "running" || userManager === "degraded") check("session.user-manager", "ok", "systemd user manager", userManager);
    else check("session.user-manager", sessionStatus(), "systemd user manager", withScopeNote(userManager.length > 0 ? userManager : "unreachable"), `log in to "${target}" once, or enable lingering (next remedy), then retry`);

    const linger = (await inDistro(target, 'loginctl show-user "$(id -un)" -p Linger 2>/dev/null')).stdout.trim();
    if (linger === "Linger=yes") check("session.linger", "ok", "Linger", linger);
    else check("session.linger", sessionStatus(), "Linger", withScopeNote(linger.length > 0 ? linger : "unset"), `wsl.exe -d ${target} -- loginctl enable-linger "$(id -un)" (this needs the user's own session; run it inside the distro)`);

    // ---- /etc/wsl.conf cross-checks ------------------------------------------
    // The distro-level settings the plugin cannot change (LIMITATIONS): boot,
    // interop, automount. Each check reads the conf against the runtime facts
    // the probes above collected and names the terminate semantics — a conf
    // value that is not in effect is a different problem from one that is.
    const confAnswer = await inDistro(target, "cat /etc/wsl.conf 2>/dev/null || true");
    const conf = parseIni(confAnswer.stdout);
    const noConf = confAnswer.stdout.trim().length === 0;
    const runtimeSystemd = systemd.stdout.startsWith("systemd");
    const bootSystemd = ((noConf ? undefined : conf.boot?.systemd) ?? "").trim().toLowerCase();
    if (noConf) {
      check("distro.wsl-conf-boot", "info", "/etc/wsl.conf [boot]", "no /etc/wsl.conf — the default (systemd off) applies, and the runtime matches it");
    } else if (bootSystemd === "true" && !runtimeSystemd) {
      check("distro.wsl-conf-boot", "warn", "/etc/wsl.conf [boot]", `[boot] systemd=true but PID 1 is ${systemd.stdout.trim() || "not systemd"} — the value is set but not in effect`, `wsl.exe --terminate ${target} (or "wsl.exe --shutdown"), then reopen the session`);
    } else if (bootSystemd === "false" && runtimeSystemd) {
      check("distro.wsl-conf-boot", "warn", "/etc/wsl.conf [boot]", "[boot] systemd=false but PID 1 is systemd — the running boot predates the value", `wsl.exe --terminate ${target} applies it; check sessionSandbox first, because the scope needs systemd`);
    } else {
      check("distro.wsl-conf-boot", "ok", "/etc/wsl.conf [boot]", bootSystemd === "" ? "no [boot] systemd line (the off default) — the runtime matches" : `[boot] systemd=${bootSystemd} — the runtime matches`);
    }

    const interopEnabled = ((noConf ? undefined : conf.interop?.enabled) ?? "").trim().toLowerCase();
    if (interopEnabled === "false") {
      const binfmt = (await inDistro(target, "[ -e /proc/sys/fs/binfmt_misc/WSLInterop ] && printf yes || printf no")).stdout.trim();
      check("distro.wsl-conf-interop", "warn", "/etc/wsl.conf [interop]", `interop is disabled in wsl.conf${binfmt === "yes" ? " but the WSLInterop handler is still loaded (stale boot)" : ""} — Windows git, open-in-app and the cmd.exe probes are unreachable from this distro`, `remove the [interop] enabled=false line in /etc/wsl.conf, then wsl.exe --terminate ${target}`);
    } else {
      const appendWindowsPath = ((noConf ? undefined : conf.interop?.appendWindowsPath) ?? "").trim().toLowerCase();
      check("distro.wsl-conf-interop", "ok", "/etc/wsl.conf [interop]", noConf
        ? "no /etc/wsl.conf — interop on (the default)"
        : `enabled=${interopEnabled || "true (the default)"}${appendWindowsPath === "false" ? "; appendWindowsPath=false (Windows PATH not appended — Windows tools need full paths)" : ""}`);
    }

    const automountEnabled = ((noConf ? undefined : conf.automount?.enabled) ?? "").trim().toLowerCase();
    const automountRoot = ((noConf ? undefined : conf.automount?.root) ?? "").trim();
    if (automountEnabled === "false") {
      check("distro.wsl-conf-automount", "warn", "/etc/wsl.conf [automount]", "automount is disabled — /mnt has no Windows drives and Windows files are unreachable from this distro; the masking stance is moot", `remove [automount] enabled=false in /etc/wsl.conf, then wsl.exe --terminate ${target}`);
    } else if (automountRoot.length > 0 && automountRoot !== "/mnt" && interopMasked) {
      check("distro.wsl-conf-automount", "warn", "/etc/wsl.conf [automount]", `the automount root is ${automountRoot}, not /mnt — the drive-masking stance is in effect and targets /mnt, so ${automountRoot} is not covered`, `reset [automount] root to /mnt in /etc/wsl.conf, then wsl.exe --terminate ${target}`);
    } else {
      check("distro.wsl-conf-automount", "ok", "/etc/wsl.conf [automount]", noConf
        ? "no /etc/wsl.conf — /mnt mounts (the default)"
        : `enabled=${automountEnabled || "true (the default)"}, root=${automountRoot || "/mnt"}`);
    }

    // ---- clock ----------------------------------------------------------------
    // A sleeping host desyncs the WSL clock (the VM's clock stops with it);
    // the classic symptom is TLS and git failing with certificate or
    // timestamp errors minutes after resume. One comparison, one remedy.
    const distroEpoch = Number((await inDistro(target, "date +%s")).stdout.trim());
    if (!Number.isFinite(distroEpoch) || distroEpoch <= 0) {
      check("distro.clock", "info", "Clock", "unreadable — date did not answer an epoch");
    } else {
      const skew = Math.abs(distroEpoch - Math.floor(Date.now() / 1000));
      if (skew > 60) {
        check("distro.clock", "warn", "Clock", `the distro clock is ${skew}s off the host — TLS and git fail with certificate/timestamp errors after a host sleep`, `"wsl.exe --shutdown", then reopen — the VM resyncs on boot`);
      } else {
        check("distro.clock", "ok", "Clock", `within ${skew}s of the host`);
      }
    }

    // ---- dns ------------------------------------------------------------------
    // Name resolution breaks in two WSL-specific ways: the auto-generated
    // /etc/resolv.conf lost its nameserver (or generation was disabled), and
    // the VPN-tunnel class where the file looks fine but queries die. The
    // probe is warn-grade and honest about offline — a machine without a
    // network answers the same as a broken resolver.
    const resolvBytes = Number((await inDistro(target, "wc -c < /etc/resolv.conf 2>/dev/null || printf 0")).stdout.trim());
    if (!Number.isFinite(resolvBytes) || resolvBytes === 0) {
      check("distro.dns", "warn", "DNS", "/etc/resolv.conf is missing or empty — name resolution fails (npm, git fetch, bootstrap installs)", `wsl.conf [network] generateResolvConf controls the file; "wsl.exe --shutdown" regenerates it unless disabled`);
    } else {
      const resolved = (await inDistro(target, "getent hosts deb.debian.org 2>/dev/null | head -1")).stdout.trim();
      if (resolved.length > 0) {
        check("distro.dns", "ok", "DNS", `resolv.conf present (${resolvBytes} bytes); ${(resolved.split(/\s+/)[0] ?? "?")} resolved the probe name`);
      } else {
        check("distro.dns", "warn", "DNS", `resolv.conf present (${resolvBytes} bytes) but the probe name did not resolve — offline, or the resolver is broken (the VPN-tunnel class)`, "check the network; with a VPN up, see the WSL DNS tunneling notes in docs/CONFIGURATION.md");
      }
    }

    // ---- optional tools ------------------------------------------------------
    /** The optional tools, in the order users notice them losing. */
    /** @type {Array<[string, string]>} */
    const optionalTools = [["rg", "in-distro search"], ["git", "workspace-change baselines"], ["inotifywait", "the watcher's primary backend"]];
    for (const [tool, purpose] of optionalTools) {
      const found = (await inDistro(target, `command -v ${tool}`)).stdout.trim();
      if (found.length > 0) check(`tools.${tool}`, "ok", tool, found);
      else check(`tools.${tool}`, "warn", tool, `missing; ${purpose} degrades to a slower fallback`, install);
    }

    // ---- agents and caches ---------------------------------------------------
    const arch = (await inDistro(target, "uname -m")).stdout.trim();
    const packaged = ["x86_64", "aarch64"].includes(arch) ? join(ROOT, "agent", "native", `linux-${arch}`, "dsh-wsl-agent") : "";
    if (arch.length === 0) check("agent.arch", "info", "Distro architecture", "unreadable");
    else if (packaged.length === 0) check("agent.arch", "info", "Distro architecture", `${arch} has no packaged native agent; the shell agent is the only backend`);
    else if (existsSync(packaged)) check("agent.native", "ok", "Packaged native agent", packaged.slice(ROOT.length + 1));
    else check("agent.native", "warn", "Packaged native agent", `missing for ${arch}`, "reinstall the plugin (the binaries ship with the package), or use agentBackend: shell");

    const cache = (await inDistro(target, CACHE_REPORT)).stdout.trim();
    if (cache === "none" || cache.length === 0) check("agent.cache", "info", "Agent cache", "empty (a first command populates it)");
    else {
      const entries = cache.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const bad = entries.filter((line) => line.startsWith("noexec ")).length;
      check("agent.cache", bad > 0 ? "warn" : "ok", "Agent cache", `${entries.length} cached binary(ies)${bad > 0 ? `, ${bad} not executable` : ""}`, bad > 0 ? `rm -rf ~/.cache/dsh-wsl/agent inside "${target}"; the next command repopulates it` : undefined);
    }

    const scopes = (await inDistro(target, STALE_SCOPE_REPORT)).stdout.trim();
    const scopeLines = scopes === "none" || scopes.length === 0 ? [] : scopes.split(/\r?\n/);
    const stale = scopeLines.filter((line) => /\sstale(\s|$)/.test(line)).length;
    const livePids = scopeLines.flatMap((line) => {
      const m = /\spids:([0-9 ]+)$/.exec(line);
      if (m === null) return [];
      return (m[1] ?? "").trim().split(/\s+/).filter((p) => p.length > 0);
    });

    // ---- resident handshake --------------------------------------------------
    const agentScript = join(ROOT, "agent", "wsl-agent.sh");
    let handshakeOk = false;
    if (!agentScript.startsWith("/")) {
      check("agent.handshake", "info", "Agent handshake", "skipped: run the doctor from inside the distro (the script path is a Windows path)");
    } else if (!existsSync(agentScript)) {
      check("agent.handshake", "fail", "Agent handshake", "agent/wsl-agent.sh is missing from this install", "reinstall the plugin; the shell agent ships with the package");
    } else {
      const handshake = await probeResident(target, agentScript, wslExe);
      handshakeOk = handshake.ok && handshake.digestMatches;
      if (handshake.ok) {
        const live = livePids.length > 0
          ? `; a live resident (pid${livePids.length > 1 ? "s" : ""} ${livePids.join(", ")}) is already running in this distro — this check starts a fresh one, which cannot read its last error; the app-side doctorReport() merge surfaces it`
          : "";
        check("agent.handshake", handshake.digestMatches ? "ok" : "fail", "Agent handshake",
          `probed: a fresh resident, pid ${handshake.pid}, protocol ${PROTOCOL_VERSION}, digest ${handshake.digestMatches ? "matches" : "MISMATCH — the distro reads a different script than this package"}${live}`,
          handshake.digestMatches ? undefined : "resync the runtime copy (pnpm run sync:windows), then restart the app");
      } else {
        check("agent.handshake", "fail", "Agent handshake", handshake.detail, "restart the DSH app; if it persists, delete ~/.cache/dsh-wsl/agent inside the distro and rerun the doctor");
      }
    }

    // ---- stale session scopes ------------------------------------------------
    if (scopeLines.length === 0) check("runtime.scopes", "info", "Session scopes", "none (no user manager, or none left behind)");
    else if (stale === 0) check("runtime.scopes", "ok", "Session scopes", `${scopeLines.length} live, none stale`);
    else check("runtime.scopes", "warn", "Session scopes", `${stale} stale of ${scopeLines.length}`, "--fix stops them (the same sweep the session preflight runs); they are safe to stop when no agent process is inside");

    // ---- smoke legs ----------------------------------------------------------
    // The handshake proves HELLO; the legs prove the chain the session rides:
    // one EXEC round trip, the confined profile's allow/refuse shape, and one
    // FSB stat+list batch over a temp dir (cleaned after). A leg whose
    // prerequisite failed is `skipped` with the blocker named — absence is
    // never silent, and a skipped leg never blocks (its blocker already does).
    const residentBlocked = !agentScript.startsWith("/") || !existsSync(agentScript) || !handshakeOk;
    const sandboxBlocked = bwrapPath.length === 0 || !bwrapUsable;
    if (residentBlocked) {
      check("functional.exec", "skipped", "Smoke: EXEC", "skipped: blocked by agent.handshake");
      check("functional.fs", "skipped", "Smoke: FSB batch", "skipped: blocked by agent.handshake");
    } else {
      const smoke = await runSmokeLegs(target, agentScript, wslExe);
      check("functional.exec", smoke.execOk ? "ok" : "fail", "Smoke: EXEC", smoke.execDetail, smoke.execOk ? undefined : "restart the DSH app; if it persists, delete ~/.cache/dsh-wsl/agent inside the distro and rerun the doctor");
      check("functional.fs", smoke.fsOk ? "ok" : "fail", "Smoke: FSB batch", smoke.fsDetail, smoke.fsOk ? undefined : "restart the DSH app; if it persists, delete ~/.cache/dsh-wsl/agent inside the distro and rerun the doctor");
    }
    if (sandboxBlocked) {
      check("functional.sandbox", "skipped", "Smoke: confined profile", `skipped: blocked by ${bwrapPath.length === 0 ? "sandbox.bwrap" : "sandbox.bwrap-usable"}`);
    } else {
      const sandbox = await runSandboxSmoke(target);
      check("functional.sandbox", sandbox.ok ? "ok" : "fail", "Smoke: confined profile", sandbox.detail, sandbox.ok ? undefined : "the shipped profile refused a write it must allow, or allowed one it must refuse — see docs/LIMITATIONS.md and pnpm run probe:sandbox");
    }

    return { reachable: true, bwrapPath, stale, family };
  };

  phase("target");
  /** @type {Map<string, { reachable: boolean, bwrapPath: string, stale: number, family: string }>} */
  const states = new Map();
  for (const target of targets) {
    const distroStart = Date.now();
    states.set(target, await collectDistroChecks(target));
    timingsMs[`distro:${target}`] = Date.now() - distroStart;
    phaseStart = Date.now();
  }

  // ---- Windows git trust (WSL change review) ------------------------------
  // The change-review pipeline's discovery call runs the WINDOWS git against
  // a \\wsl.localhost UNC when Windows git is installed; git's
  // dubious-ownership check refuses the share unless it is whitelisted, and
  // the pipeline silently degrades to "git is unavailable" (no diff cards for
  // WSL workspaces). A machine without Windows git is fine too — the provider
  // resolves git to a distro sentinel and routes everything. What the doctor
  // can probe cheaply from here is interop git.exe and its whitelist.
  const winGitVersion = await run(["git.exe", "--version"]);
  if (!winGitVersion.ok) {
    check("git.win-safe", "info", "Windows git trust", "Windows git not found through interop — WSL change review uses the distro fallback; host (C:\\...) workspaces would need git for their own review");
  } else {
    const entries = (await run(["git.exe", "config", "--global", "--get-all", "safe.directory"])).stdout.split(/\r?\n/).filter(Boolean);
    const whitelisted = entries.some((entry) => /wsl\.localhost/i.test(entry));
    check("git.win-safe", whitelisted ? "ok" : "warn", "Windows git trust",
      whitelisted ? `the \\\\wsl.localhost share is whitelisted (${entries.length} entr${entries.length === 1 ? "y" : "ies"})`
        : "Windows git does not trust the \\\\wsl.localhost share; WSL workspaces' change review silently degrades to file-tool edits",
      whitelisted ? undefined : 'on Windows: git config --global --add safe.directory "//wsl.localhost/*", then restart the app');
  }

  phase("git");
  // ---- sessions across running distros (WSL-309) ----------------------------
  // The single-distro checks above answer "is this distro healthy?"; this
  // survey answers "what is running right now, everywhere?" — the concurrent
  // sessions coordinate routing makes possible, made visible. Idle timers are
  // the host process's private state and stay out: a scope's presence and its
  // resident pids are the facts the distro side can attest.
  // The distro lists both surveys share: `run` settles an object
  // ({ ok, stdout, code }); `-q` prints plain names, and the running list's
  // header is dropped by the intersection with them. The default distro
  // carries a localized marker ("ubuntu (默认值)" / "ubuntu (default)") —
  // strip a trailing parenthesized note before the intersection.
  const distroNames = ((await run([WSL, "--list", "-q"])).stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const running = ((await run([WSL, "--list", "--running"])).stdout ?? "").split(/\r?\n/).map((line) => line.trim().replace(/\s+\([^)]*\)$/, "")).filter((line) => distroNames.includes(line));
  if (!options.json) {
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

  // ---- listening ports across running distros (WSL-308) ----------------------
  // The port poller serves the model's session (DSH_WSL_PORTS); this survey
  // serves the human, with the two actions the facts imply: the localhost URL
  // WSL2's forwarding already makes reachable, and the netsh line that would
  // extend reach beyond the host (printed, never applied).
  if (!options.json) {
    const portScript = procNetScript();
    let anyPorts = false;
    for (const d of running) {
      const answer = await inDistro(d, portScript);
      const ports = parseListeningPorts(answer.stdout);
      if (ports.length === 0) continue;
      anyPorts = true;
      const ip = ((await inDistro(d, "hostname -I")).stdout ?? "").trim().split(/\s+/)[0] ?? "";
      console.log("");
      console.log(`listening ports in ${d}`);
      for (const port of ports) {
        console.log(`  :${port}  http://localhost:${port}   (LAN: netsh interface portproxy add v4tov4 listenport=${port} listenaddress=0.0.0.0 connectport=${port} connectaddress=${ip})`);
      }
    }
    if (!anyPorts && running.length > 0) console.log("\nno listening ports in the running distros");
  }

  // ---- peers ---------------------------------------------------------------
  const manifest = /** @type {{ version?: string, peerDependencies?: Record<string, string> }} */ (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")));
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

  phase("surveys");
  // ---- update check ----------------------------------------------------------
  // The same question the app's Versions page asks, answered on demand: the
  // stable channel's newest release against this checkout's version. A
  // registry the doctor cannot reach is normal (offline, a proxy), so it
  // reports as `info` and points at the page that asks it live — never a
  // warning, and never a network side effect beyond the two GETs.
  const installedVersion = manifest.version ?? "";
  const latest = installedVersion.length > 0 ? await fetchLatestRelease() : undefined;
  if (latest === undefined) {
    check("update.latest", "info", "Update check", "the registry was unreachable (offline, or a proxy is in the way); the app's Versions page asks the same question live");
  } else if (compareVersions(latest.version, installedVersion) > 0) {
    const message = updateFactMessage({ installed: installedVersion, latest: latest.version, incompatible: false, ...(latest.deprecated === undefined ? {} : { deprecated: latest.deprecated }), checkedAt: 0 });
    check("update.latest", "info", "Update check", `${message} (from ${latest.registry})`, "the app's Plugins page, Versions section, or `dsh plugin --profile <name> add dsh-plugin-wsl-env`, then restart DSH");
  } else {
    check("update.latest", "ok", "Update check", `${installedVersion} is the newest stable release`);
  }

  // ---- effective configuration (verdict inputs, reported) ------------------
  check("config.effective", configRecognized ? "ok" : "info", "Effective configuration",
    configRecognized
      ? `distro=${effective.distro}, sessionSandbox=${effective.sessionSandbox}, agentBackend=${effective.agentBackend}, sandbox=${effective.sandbox}, maskWindowsDrive=${effective.maskWindowsDrive}, interopVisibility=${effective.interopVisibility || "unset"} — from ${effective.source}${effective.overrides.length > 0 ? ` (overrides: ${effective.overrides.join("; ")})` : ""}`
      : "the shipped preset rows were not recognized; the conservative defaults apply (sessionSandbox: true, so a missing systemd blocks) — see docs/CONFIGURATION.md");

  phase("update-peers");
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
      check("config.preset-trap", "warn", "Profile patches", `nested rows patched by id in: ${trapped.join(", ")}`, "wsl-shell and wsl-fs live inside preset-wsl; an id patch matches nothing and is ignored with a warning. Run \"pnpm run preset --check <patch>\" to get the complete block, or see docs/CONFIGURATION.md#configure-wsl-shell-and-wsl-fs");
    } else {
      check("config.profiles", "ok", "Profile patches", `${seen} profile patch(es) scanned`);
    }
  }

  phase("config");
  // ---- fixes ---------------------------------------------------------------
  // Safe actions only, per target: the sweep the session preflight runs, and
  // package installation behind --install plus an explicit confirmation. A
  // distro that never became reachable has no state to fix.
  if (options.fix) {
    for (const [target, state] of states) {
      if (!state.reachable) continue;
      const fixCheck = (/** @type {string} */ id, /** @type {Check["status"]} */ status, /** @type {string} */ title, /** @type {string | undefined} */ detail = undefined, /** @type {string | undefined} */ remedy = undefined) => {
        checks.push({ id, status, title, ...(detail === undefined ? {} : { detail }), ...(remedy === undefined ? {} : { remedy }), distro: target });
      };
      if (state.stale > 0) {
        const swept = await inDistro(target, sessionScopeSweepScript());
        fixCheck("fix.scopes", swept.ok ? "ok" : "warn", "Swept stale scopes", swept.ok ? `${state.stale} stale scope(s) stopped` : "the sweep failed", swept.ok ? undefined : `systemctl --user list-units 'dsh-wsl-*.scope' inside "${target}"`);
      }
      if (state.bwrapPath.length === 0) {
        const install = installRemedy(target, state.family);
        if (!options.install) {
          fixCheck("fix.install", "info", "Package installation", "not attempted", "re-run with --fix --install (and --yes for a non-interactive run)");
        } else if (!(await confirm(`Install ${PACKAGES} in "${target}" as root?`, options.yes))) {
          fixCheck("fix.install", "info", "Package installation", "declined", install);
        } else {
          const command = INSTALL[state.family] ?? INSTALL["apt-get"] ?? `apt-get install -y ${PACKAGES}`;
          const installed = await run([WSL, "-d", target, "-u", "root", "--", "sh", "-c", command]);
          fixCheck("fix.install", installed.ok ? "ok" : "warn", "Package installation", installed.ok ? "completed" : "failed; see the output above", installed.ok ? undefined : install);
        }
      }
    }
  }

  phase("fix");
  timingsMs.total = Date.now() - runStart;
  return report(checks, { json: options.json }, runInfo);
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
function probeResident(distro, scriptPath, wslExe = WSL) {
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
    const child = spawn(wslExe, ["-d", distro, "--exec", "sh", scriptPath], {
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
 * One smoke session against a fresh resident: spawn it, read the HELLO, run
 * one EXEC round trip (`uname -m`), create a temp dir over the same transport,
 * send one FSB batch (stat + list) against it, remove the dir, shut the
 * resident down. This is the chain the session actually rides — frame I/O and
 * the protocol v7 substrate — not a parallel probe path. Every failure names
 * its leg; a resident that dies mid-smoke fails fast instead of hanging.
 *
 * @param {string} distro - the distro.
 * @param {string} scriptPath - the agent script as a Linux path inside the distro.
 * @param {string} wslExe - the wsl.exe to spawn.
 * @returns {Promise<{ execOk: boolean, execDetail: string, fsOk: boolean, fsDetail: string }>} the two resident-leg verdicts.
 */
function runSmokeLegs(distro, scriptPath, wslExe = WSL) {
  return new Promise((settle) => {
    const child = spawn(wslExe, ["-d", distro, "--exec", "sh", scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, WSL_UTF8: "1" },
    });
    let settled = false;
    let buffer = "";
    let helloSeen = false;
    /** @type {Map<string, (line: string) => void>} */
    const waiters = new Map();
    let helloResolve = /** @type {((value: boolean) => void) | undefined} */ (undefined);
    const helloPromise = new Promise((resolve) => { helloResolve = resolve; });
    const timer = setTimeout(() => finish({ execOk: false, execDetail: "the smoke session timed out", fsOk: false, fsDetail: "the smoke session timed out" }), 30_000);
    /** @param {{ execOk: boolean, execDetail: string, fsOk: boolean, fsDetail: string }} value - the leg verdicts. */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.write("SHUTDOWN\n"); } catch { /* the resident may already be gone */ }
      setTimeout(() => {
        try { child.kill(); } catch { /* already gone */ }
        settle(value);
      }, 150);
    };
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0) continue;
        const parsed = parseAgentLine(line);
        if (parsed.type === "hello") {
          helloSeen = true;
          helloResolve?.(true);
          continue;
        }
        if (parsed.type === "ack" || parsed.type === "pong" || parsed.type === "unknown") continue;
        const id = parsed.type === "result" || parsed.type === "agentError" || parsed.type === "fsError" ? parsed.id : "";
        const waiter = waiters.get(id);
        if (waiter !== undefined) {
          waiters.delete(id);
          waiter(line);
        }
      }
    });
    let childGone = false;
    child.on("error", (error) => finish({ execOk: false, execDetail: error.message, fsOk: false, fsDetail: error.message }));
    // A dead resident's pipe surfaces as EPIPE on the write side; the exit
    // handler names the cause, so the write-side error is swallowed.
    child.stdin.on("error", () => { /* named by the exit handler */ });
    child.on("exit", () => {
      childGone = true;
      if (!settled && waiters.size > 0) finish({ execOk: false, execDetail: "the resident exited mid-smoke", fsOk: false, fsDetail: "the resident exited mid-smoke" });
    });
    /** Send one request and resolve with the reply line that answers it.
     * @param {string} id - the request id.
     * @param {string[]} lines - the frame's lines. */
    const request = (id, lines) => new Promise((resolve) => {
      waiters.set(id, resolve);
      child.stdin.write(`${lines.join("\n")}\n`);
    });
    (async () => {
      // The race's losing timer must be cleared: a live timer keeps the
      // process lingering ~5 s past the report — per invocation.
      await new Promise((resolve) => {
        const wait = setTimeout(resolve, 5000);
        helloPromise.then(() => { clearTimeout(wait); resolve(true); });
      });
      if (!helloSeen) return finish({ execOk: false, execDetail: "no HELLO", fsOk: false, fsDetail: "no HELLO" });
      if (childGone) return finish({ execOk: false, execDetail: "the resident exited mid-smoke", fsOk: false, fsDetail: "the resident exited mid-smoke" });
      const execId = "smoke-exec";
      const execLine = await request(execId, encodeExecFrame({ id: execId, cwd: "/tmp", argv: ["uname", "-m"], timeoutMs: 15_000, maxOutputBytes: 4096 }));
      const execParsed = parseAgentLine(execLine);
      const execAnswer = execParsed.type === "result" ? execParsed.stdout.toString("utf8").trim() : "";
      const execOk = execParsed.type === "result" && execParsed.exitCode === 0 && execAnswer.length > 0;
      const execDetail = execOk
        ? `uname -m answered "${execAnswer}" over the frame round trip`
        : execParsed.type === "result"
          ? `exit ${execParsed.exitCode}: ${execParsed.stderr.toString("utf8").slice(0, 120)}`
          : execParsed.type === "agentError"
            ? `${execParsed.reason}: ${execParsed.message}`
            : `unexpected reply: ${execLine.slice(0, 80)}`;
      const mkId = "smoke-mktemp";
      const mkLine = await request(mkId, encodeExecFrame({ id: mkId, cwd: "/tmp", argv: ["mktemp", "-d", "/tmp/dsh-doctor-smoke-XXXXXXXX"], timeoutMs: 15_000, maxOutputBytes: 4096 }));
      const mkParsed = parseAgentLine(mkLine);
      const dir = mkParsed.type === "result" && mkParsed.exitCode === 0 ? mkParsed.stdout.toString("utf8").trim() : "";
      if (dir.length === 0) {
        return finish({ execOk, execDetail, fsOk: false, fsDetail: "the temp dir for the batch leg could not be created" });
      }
      const fsbId = "smoke-fsb";
      const fsbLine = await request(fsbId, encodeFsbFrame({ id: fsbId, timeoutMs: 15_000, ops: [{ op: "stat", args: [dir] }, { op: "list", args: [dir] }] }));
      const fsbParsed = parseAgentLine(fsbLine);
      const payload = fsbParsed.type === "result" ? fsbParsed.stdout.toString("utf8") : "";
      const fsOk = fsbParsed.type === "result" && fsbParsed.exitCode === 0 && payload.includes("OK 0") && payload.includes("OK 1");
      const rmId = "smoke-cleanup";
      const rmLine = await request(rmId, encodeExecFrame({ id: rmId, cwd: "/tmp", argv: ["rm", "-rf", dir], timeoutMs: 15_000, maxOutputBytes: 4096 }));
      const rmParsed = parseAgentLine(rmLine);
      const cleanupOk = rmParsed.type === "result" && rmParsed.exitCode === 0;
      const fsDetail = fsOk
        ? `stat + list over ${dir} answered one batch round trip${cleanupOk ? "; the dir is removed" : `; CLEANUP FAILED — ${dir} is left behind`}`
        : fsbParsed.type === "result"
          ? `exit ${fsbParsed.exitCode}: ${payload.slice(0, 120)}${cleanupOk ? "" : `; cleanup failed, ${dir} is left behind`}`
          : fsbParsed.type === "fsError"
            ? `${fsbParsed.reason}: ${fsbParsed.message}`
            : `unexpected reply: ${fsbLine.slice(0, 80)}`;
      return finish({ execOk, execDetail, fsOk, fsDetail });
    })().catch((error) => finish({ execOk: false, execDetail: /** @type {Error} */ (error).message, fsOk: false, fsDetail: /** @type {Error} */ (error).message }));
  });
}

/**
 * The confined-profile smoke: the shipped bwrap builder's per-command shape,
 * run against a distro temp dir — a write inside the granted root must run,
 * a write outside it (into the read-only-bound /etc) must be refused. These
 * are the two assertions `probe:sandbox` makes, in miniature, so the doctor's
 * verdict covers the fence and not just the binary.
 * @param {string} distro - the distro.
 * @returns {Promise<{ ok: boolean, detail: string }>} the fence verdict.
 */
async function runSandboxSmoke(distro) {
  const dirAnswer = await inDistro(distro, 'd=$(mktemp -d /tmp/dsh-doctor-smoke-XXXXXXXX) && printf %s "$d"');
  const dir = dirAnswer.stdout.trim();
  if (dir.length === 0) return { ok: false, detail: "the temp dir for the fence leg could not be created" };
  const prefix = bwrapArgvPrefix({ mode: "workspace-write", workspaceRoot: dir }, {});
  const inside = await run([WSL, "-d", distro, "--exec", ...prefix, "sh", "-c", 'printf ok > "$0" && cat "$0"', `${dir}/inside`]);
  const outside = await run([WSL, "-d", distro, "--exec", ...prefix, "sh", "-c", 'printf no > "$0" 2>/dev/null', "/etc/dsh-doctor-smoke-refuse"]);
  const cleanup = await inDistro(distro, `rm -rf "${dir}"`);
  const insideOk = inside.ok && inside.stdout.trim() === "ok";
  const outsideRefused = !outside.ok;
  const ok = insideOk && outsideRefused;
  return {
    ok,
    detail: `a write inside ${dir} ${insideOk ? "ran" : "was REFUSED (the profile broke)"} and a write to /etc ${outsideRefused ? "was refused" : "RAN (the fence is open)"} — the shipped workspace-write shape${cleanup.ok ? "" : `; CLEANUP FAILED — ${dir} is left behind`}`,
  };
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
 * Assemble the report: stamp the blocking flag onto every check, compute the
 * per-distro and overall verdicts, print, and return the exit status.
 *
 * The blocking invariant is structural: a `fail` blocks, everything else does
 * not — config-awareness lives in the statuses (see the session checks), never
 * in a per-id exception here. A `skipped` check is a consequence of a blocker,
 * not a blocker itself.
 *
 * @param {Check[]} checks - the collected checks (distro-scoped ones carry their `distro`).
 * @param {{ json: boolean }} options - the output mode.
 * @param {{ distros?: string[], config?: EffectiveConfig, timingsMs?: Record<string, number> }} [runInfo] - the target distros, the effective configuration, and the per-phase wall clock.
 * @returns {number} 0 when the verdict is `ready`, 1 when `blocked`.
 */
function report(checks, options, runInfo = {}) {
  const stamped = checks.map((entry) => ({
    ...entry,
    blocksFirstCommand: entry.status === "fail",
  }));
  /** @param {string} status - the status to count. @returns {number} how many checks carry it. */
  const count = (status) => stamped.filter((entry) => entry.status === status).length;
  const summary = { ok: count("ok"), warn: count("warn"), fail: count("fail"), info: count("info"), skipped: count("skipped") };
  const blockers = stamped.filter((entry) => entry.blocksFirstCommand).map((entry) => entry.id);
  const verdict = blockers.length === 0 ? "ready" : "blocked";
  /** The blockers a distro verdict owns: its own fails plus the host-level ones.
   * @param {string} name - the distro name.
   * @returns {string[]} the blocking ids. */
  const distroBlockers = (name) => stamped
    .filter((entry) => entry.blocksFirstCommand && (entry.distro === name || entry.distro === undefined))
    .map((entry) => entry.id);
  const targets = runInfo.distros ?? [];
  const distroVerdicts = targets.map((name) => ({
    name,
    verdict: distroBlockers(name).length === 0 ? "ready" : "blocked",
    blockers: distroBlockers(name),
  }));
  if (options.json) {
    console.log(JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      ...(runInfo.config === undefined ? {} : { config: runInfo.config }),
      checks: stamped,
      summary,
      distroVerdicts,
      verdict,
      blockers,
      ...(runInfo.timingsMs === undefined ? {} : { timingsMs: runInfo.timingsMs }),
    }, null, 2));
  } else {
    console.log("dsh-plugin-wsl-env doctor");
    let section = "";
    let lastDistro = /** @type {string | undefined} */ (undefined);
    for (const entry of stamped) {
      if (entry.distro !== undefined && entry.distro !== lastDistro && targets.length > 1) {
        console.log(`\n[${entry.distro}]`);
        section = "";
        lastDistro = entry.distro;
      }
      const current = entry.id.split(".")[0] ?? "";
      if (current !== section) {
        section = current;
        console.log(`\n${section}`);
      }
      const mark = entry.status === "ok" ? "ok  " : entry.status === "warn" ? "warn" : entry.status === "fail" ? "fail" : entry.status === "skipped" ? "skip" : "info";
      console.log(`  ${mark}  ${entry.title}${entry.detail === undefined ? "" : ` — ${entry.detail}`}`);
      if (entry.remedy !== undefined) console.log(`        fix: ${entry.remedy}`);
    }
    console.log(`\n${summary.ok} ok, ${summary.warn} warn, ${summary.fail} fail, ${summary.info} info${summary.skipped > 0 ? `, ${summary.skipped} skipped` : ""}`);
    const timingLine = Object.entries(runInfo.timingsMs ?? {}).filter(([key]) => key !== "total").map(([key, ms]) => `${key} ${ms}ms`).join(", ");
    if (timingLine.length > 0) console.log(`timings: ${timingLine}; total ${runInfo.timingsMs?.total ?? "?"}ms`);
    if (verdict === "ready") console.log(`verdict: READY — the first command should succeed${targets.length === 1 ? ` in ${targets[0]}` : targets.length > 1 ? ` in each of: ${targets.join(", ")}` : ""}`);
    else console.log(`verdict: BLOCKED by: ${blockers.join(", ")} — apply the fixes above, then rerun`);
    if (summary.fail > 0 || summary.skipped > 0) console.log("run with --fix to sweep stale scopes; --fix --install asks before installing packages");
  }
  return verdict === "blocked" ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("node scripts/doctor.mjs [distro] [--all] [--json] [--fix] [--install] [--yes] [--read-only]");
  } else {
    process.exitCode = await main(options);
  }
}
