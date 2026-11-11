#!/usr/bin/env node
/**
 * One-command environment doctor for this plugin (P0.2 / WSL-102; the verdict
 * and per-distro shape: WSL-316).
 *
 * Answers "will this plugin work here, and if not, what do I paste?" in one
 * read-only pass: the Windows/WSL platform, the distro identity, bubblewrap
 * usability, systemd / the user manager / `systemd-run` / Linger, the optional
 * tools, the peer versions the plugin is loaded against, the native agent and
 * its cache, a fresh-agent handshake, the shell and native smoke legs, stale
 * session scopes, the host volume and the Windows share, and the known
 * profile-patch / deprecated-key traps. The update check is deliberately NOT
 * here: it is not a diagnosis, and the plugin's delegated update service plus
 * the app's Versions page already answer it without a registry GET per run.
 *
 *   node scripts/doctor.mjs [distro] [--json] [--fix] [--fix-owned] [--install] [--yes] [--read-only]
 *                            [--wsl <path to wsl.exe>]
 *
 * Exit status is 0 when the verdict is `ready` and 1 when it is `blocked`;
 * `ready` means every check that can fail the first command passed **under the
 * effective configuration** (the profile layers the app actually loads, not the
 * shipped defaults). The blocking rule has one invariant: a `fail` blocks —
 * config-awareness downgrades a check's *status* (a missing systemd only fails
 * under `sessionSandbox: true`; `auto` and `false` downgrade it to a warning),
 * so there is no per-id exception table to drift. `skipped` marks a check that
 * could not run because another check failed. `unknown` marks a read the
 * wsl.exe transport could not vouch for (a flake that survived one retry) —
 * it never blocks and never feeds a config verdict; rerun for a clean answer. `--fix` performs only safe
 * actions: it sweeps stale `dsh-wsl-*.scope` units (the same sweep the session
 * preflight runs) and purges the plugin-owned agent cache when an entry is not
 * executable, re-probing both afterwards. Installing packages needs `--install`
 * *and* an explicit confirmation (`--yes` skips the prompt, not the flag), so a
 * fix run can never install silently. `--fix-owned` narrows the fix loop to the
 * plugin-owned state (the scope sweep and the cache purge): it skips the
 * package install and the Windows git whitelist, and it cannot be combined
 * with `--install`. The sidebar's status panel uses it for its repair action.
 *
 * `--read-only` refuses `--fix`/`--install`; `scripts/diagnose.sh` uses it to stay an
 * alias that can never change the machine.
 *
 * `--json` prints one machine-readable report instead of the human sections.
 * The report shape is versioned (`schemaVersion: 2`): `verdict`, `blockers`,
 * `distroVerdicts`, the effective `config`, and per-check `distro` /
 * `blocksFirstCommand` fields.
 *
 * The doctor is the standalone surface by design: it loads **no peer
 * dependency and no host service**, so it still starts when the plugin's own
 * runtime is the thing that is broken (the chicken-and-egg failure the
 * in-process tool path cannot escape). Only pure, peer-free lib modules are
 * imported; the one helper that lived behind a peer-tainted module is inlined
 * below and drift-pinned by test.
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
import { existsSync, readdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
// Pure, peer-free lib modules stay imported: `lint:build` pins them byte-for-byte
// to `src/`, so the doctor probes exactly the shipped behavior without loading
// any peer dependency (see the inlining note below).
import { parseDistroList } from "../lib/wsl.js";
import { AGENT_NAME, PROTOCOL_VERSION, encodeExecFrame, encodeFsbFrame, parseAgentLine } from "../lib/agent-protocol.js";
import { bwrapArgvPrefix } from "../lib/bwrap.js";
import { sessionScopeSweepScript } from "../lib/session-scope.js";
import { parseListeningPorts, procNetScript } from "../lib/ports.js";

// ── Peer-free inlining of the one peer-tainted helper ─────────────────────────
//
// The doctor must start even when the plugin's runtime is the thing that is
// broken. `lib/index.js` pulls the whole plugin graph and every
// `@deepseek-ai/dsh-*` peer dependency at load time, and the helper below is a
// pure two-liner, so it is inlined here instead. A test in
// `test/doctor.test.mjs` compares the copy against the lib export to pin it
// against drift.
//
// Inlined from `src/provider-common.ts` `effectiveMaskWindowsDrive`:
/**
 * Whether confined profiles shadow `/mnt` under this config.
 *
 * @param {{ interopVisibility?: "visible" | "masked" | "disabled", maskWindowsDrive?: boolean }} config - anything carrying the two keys.
 * @returns {boolean} whether confined profiles shadow `/mnt`.
 */
export function effectiveMaskWindowsDrive(config) {
  if (config.interopVisibility !== undefined) return config.interopVisibility !== "visible";
  return config.maskWindowsDrive === true;
}

/**
 * The path one distro sees for a host file. A POSIX host path (the doctor
 * running inside a distro) is returned as-is; a Windows drive path is
 * translated through the distro's automount root, so the Windows entry can
 * hand `wsl.exe` a script path the distro can actually read. Anything else
 * (a UNC root, an unreadable root) is undefined — the caller reports why
 * instead of passing a Windows path to `sh`.
 *
 * @param {string} hostPath - the path as this host names it.
 * @param {string} mountRoot - the distro's automount root (`/mnt` when unset).
 * @returns {string | undefined} the distro-side path, or undefined when it cannot be expressed.
 */
export function distroPath(hostPath, mountRoot) {
  if (hostPath.startsWith("/")) return hostPath;
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(hostPath);
  if (match === null) return undefined;
  const drive = (match[1] ?? "").toLowerCase();
  const rest = (match[2] ?? "").replace(/\\/g, "/");
  return `${mountRoot.replace(/\/+$/, "")}/${drive}/${rest}`;
}

/**
 * The host-volume verdict: the Windows drive holding the distro (the VHDX)
 * fails writes the moment it is full, even while the distro's own `df` looks
 * healthy, so this row answers that volume rather than the ext4 one.
 *
 * @param {number} freeBytes - bytes available to the current user.
 * @param {number} totalBytes - the volume's size.
 * @returns {{ status: "ok" | "warn" | "fail", detail: string, remedy: string | undefined }} the verdict.
 */
export function hostDiskVerdict(freeBytes, totalBytes) {
  const gib = (/** @type {number} */ bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  const detail = `${gib(freeBytes)} free of ${gib(totalBytes)}`;
  if (freeBytes < 2 * 1024 ** 3) {
    return {
      status: "fail",
      detail: `${detail} — the Windows volume holding the distro is nearly full; writes into the ext4 VHDX fail even when the distro's own df looks fine`,
      remedy: 'free space on that Windows volume, or move the distro ("wsl --export" then "wsl --import" to another drive); sparseVhd plus "wsl.exe --shutdown" reclaims deleted data',
    };
  }
  if (freeBytes < 5 * 1024 ** 3) {
    return {
      status: "warn",
      detail: `${detail} — plan a cleanup before writes start failing`,
      remedy: 'free space on the Windows volume holding the distro, or enable sparseVhd and "wsl.exe --shutdown" to shrink the VHDX',
    };
  }
  return { status: "ok", detail, remedy: undefined };
}

// ── Host-locale output catalogs ──────────────────────────────────────────────
//
// The human output renders in the host's language: the doctor detects the
// Windows locale through the registry (fast, no PowerShell startup), the
// `--locale` flag and `DSH_WSL_DOCTOR_LOCALE` override it, and `--json` stays
// language-independent. Only the fixed skeleton is cataloged (verdict,
// summary, section marks, hints); per-check titles/details/remedies stay
// English — remedies carry copy-paste commands. The catalogs live in
// `locale/doctor/{en,zh}.json`; a test pins their key parity.

/** The languages the doctor's own catalogs ship. @type {Record<string, Record<string, string> | undefined>} */
const CATALOGS = {};
/** The active catalog language; English until a detection or flag selects otherwise. */
let LOCALE = "en";

/**
 * Load one catalog, falling back to the English file when the requested one
 * is missing or unreadable (a truncated install must not break the run).
 *
 * @param {string} name - the catalog language id.
 * @returns {Record<string, string>} the catalog table.
 */
function doctorCatalog(name) {
  if (CATALOGS[name] === undefined) {
    try {
      CATALOGS[name] = JSON.parse(readFileSync(join(ROOT, "locale", "doctor", `${name}.json`), "utf8"));
    } catch {
      CATALOGS[name] = {};
    }
  }
  return CATALOGS[name] ?? {};
}

/**
 * Select the output language. `zh` requires its catalog to have loaded; any
 * other id renders English.
 *
 * @param {string} name - the requested language id.
 */
export function setDoctorLocale(name) {
  LOCALE = name === "zh" && Object.keys(doctorCatalog("zh")).length > 0 ? "zh" : "en";
}

/**
 * Render one catalog message in the active language, substituting
 * `{placeholder}` tokens; a key the active catalog lacks falls back to the
 * English entry.
 *
 * @param {string} key - the catalog key.
 * @param {Record<string, string | number>} [params] - the placeholder values.
 * @returns {string} the rendered line.
 */
export function doctorT(key, params = {}) {
  const template = doctorCatalog(LOCALE)[key] ?? doctorCatalog("en")[key] ?? key;
  return template.replace(/\{(\w+)\}/gu, (whole, name) => (params[name] === undefined ? whole : String(params[name])));
}

/**
 * Extract the locale name from a `reg query ... /v LocaleName` answer.
 *
 * @param {string} text - the command's stdout.
 * @returns {string} the `LocaleName` value, or "" when the answer names none.
 */
export function localeNameFromReg(text) {
  const match = text.match(/LocaleName\s+REG_SZ\s+(\S+)/);
  return match === null ? "" : match[1] ?? "";
}

/**
 * Map a BCP 47-style tag onto a catalog language: `zh*` renders Chinese,
 * everything else English.
 *
 * @param {string} tag - the locale tag (may be empty).
 * @returns {"en" | "zh"} the catalog language.
 */
export function localeFromTag(tag) {
  return /^zh/iu.test(tag) ? "zh" : "en";
}

/**
 * Resolve the output language: the `--locale` flag wins, then
 * `DSH_WSL_DOCTOR_LOCALE`, then English (the caller probes the registry only
 * when neither override is set).
 *
 * @param {string} flag - the `--locale` value, possibly empty.
 * @returns {"en" | "zh"} the catalog language the overrides select, when they select one.
 */
export function overrideLocale(flag) {
  const tag = flag.length > 0 ? flag : process.env.DSH_WSL_DOCTOR_LOCALE ?? "";
  return tag.length > 0 ? localeFromTag(tag) : "en";
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let WSL = "wsl.exe";
const CMD = "cmd.exe";
const TIMEOUT_MS = 60_000;

/** The package families the install remedies know, in probe order. */
const FAMILIES = ["apt-get", "dnf", "pacman", "zypper", "apk"];
/** The package names the plugin uses, per family. */
const PACKAGES = "bubblewrap git ripgrep inotify-tools";
/** One install command per family; `zypper` spells its non-interactive flag differently. */
const INSTALL = /** @type {Record<string, string>} */ ({
  "apt-get": `apt-get install -y ${PACKAGES}`,
  dnf: `dnf install -y ${PACKAGES}`,
  pacman: `pacman -Sy --noconfirm ${PACKAGES}`,
  zypper: `zypper --non-interactive install ${PACKAGES}`,
  apk: `apk add --no-cache ${PACKAGES}`,
});
/** The one package the shell agent needs beyond the generic set: GNU find. */
const FINDUTILS = /** @type {Record<string, string>} */ ({
  "apt-get": "apt-get install -y findutils",
  dnf: "dnf install -y findutils",
  pacman: "pacman -S --noconfirm findutils",
  zypper: "zypper --non-interactive install findutils",
  apk: "apk add --no-cache findutils",
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
  '  name=$(basename "$(dirname "$f")")',
  // The cache is content-addressed: only a 64-hex directory name is an agent
  // entry. A stray directory (a probe fixture, a hand-made copy) is not, and
  // must not turn into a cache warning the user cannot explain.
  '  printf "%s" "$name" | grep -Eq "^[0-9a-f]{64}$" || continue',
  '  if [ ! -x "$f" ]; then echo "noexec $f"; continue; fi',
  '  if command -v timeout >/dev/null 2>&1; then',
  '    if timeout 3 "$f" </dev/null >/dev/null 2>&1; then echo "exec $f"; else echo "broken $f"; fi',
  '  else',
  '    if "$f" </dev/null >/dev/null 2>&1; then echo "exec $f"; else echo "broken $f"; fi',
  '  fi',
  "done",
].join("\n");

/**
 * One check result.
 * @typedef {object} Check
 * @property {string} id - stable dotted id.
 * @property {"ok"|"warn"|"fail"|"info"|"skipped"|"unknown"} status - the verdict.
 *   `unknown` marks a read the transport could not vouch for (a wsl.exe flake
 *   that survived one retry): it never blocks, and it never feeds a config
 *   verdict — a flaked read of `wsl.conf` must not report the file broken.
 * @property {string} title - what was checked.
 * @property {string} [detail] - the evidence.
 * @property {string} [remedy] - a copy-paste next step when not ok.
 * @property {string} [distro] - the distro the check ran against (distro-scoped checks only).
 * @property {boolean} [blocksFirstCommand] - whether a `fail` here blocks the first command (stamped by `report()`: true for every `fail`; config-awareness downgrades statuses rather than keeping a per-id exception table).
 */

/** The check sections a scoped run can select, in the order the tool names them. */
export const SECTIONS = ["host", "sandbox", "session", "conf", "net", "agent"];

/**
 * The section one check id belongs to — the single mapping the CLI's
 * `--sections` filter and the `wsl_doctor` tool's per-section summary both
 * read, so a tool digest and the report can never disagree about where a
 * check lives. `host` is the default: the cheap environment basics every
 * scoped run still probes.
 * @param {string} id - the check id.
 * @returns {"host"|"sandbox"|"session"|"conf"|"net"|"agent"} the section.
 */
export function sectionOf(id) {
  if (id.startsWith("sandbox.") || id === "functional.sandbox") return "sandbox";
  if (id.startsWith("session.") || id === "runtime.scopes" || id === "distro.wsl-conf-boot") return "session";
  if (id.startsWith("config.") || id === "distro.wsl-conf-interop" || id === "distro.wsl-conf-automount") return "conf";
  if (id === "distro.dns") return "net";
  if (id.startsWith("agent.") || id === "functional.exec" || id === "functional.fs" || id === "functional.native") return "agent";
  return "host";
}

/** The sections a `--quick` run selects: first-command prerequisites only. */
const QUICK_SECTIONS = ["host", "session", "sandbox"];

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
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code?: string, timedOut?: boolean }>} the capture.
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
      const timedOut = error !== null && /** @type {NodeJS.ErrnoException & { signal?: string }} */ (error).signal === "SIGTERM";
      settle({ ok: error === null, stdout: stdout ?? "", stderr: stderr ?? "", code, timedOut });
    };
    execFile(file, args, { encoding: "utf8", timeout: TIMEOUT_MS, windowsHide: true, env: { ...process.env, WSL_UTF8: "1" } }, done);
  });
}

/**
 * Parse `wsl.exe -l -v`'s table. The state column is localized, so only the
 * shape is trusted: `NAME[*] <state> <version>` — with the default marker
 * BEFORE the name on WSL 3.x (`* ubuntu`) and after it on 2.x (`ubuntu*`).
 * The version digit is what `distro.wsl-mode` classifies.
 * @param {string} stdout - the command's output, nulls stripped.
 * @returns {Array<{ name: string, isDefault: boolean, version: string }>} one entry per table row; the header drops out by shape.
 */
export function parseWslVerbose(stdout) {
  /** @type {Array<{ name: string, isDefault: boolean, version: string }>} */
  const entries = [];
  for (const line of stdout.split(/\r?\n/)) {
    let rest = line.trim();
    let isDefault = false;
    if (rest.startsWith("* ")) {
      isDefault = true;
      rest = rest.slice(2).trim();
    }
    const match = /^(\S+?)(\*)?\s+\S+\s+(\d+)\s*$/.exec(rest);
    if (match === null) continue;
    const columns = /** @type {RegExpExecArray} */ (match);
    entries.push({
      name: (columns[1] ?? "").replace(/\*$/, ""),
      isDefault: isDefault || columns[2] === "*",
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
  // Confinement is on when ANY surface turns it on: the command row
  // (`wsl-shell`), the file row (`wsl-fs`), or the mutation fence
  // (`fs-routing`). The single effective key answers "does anything need
  // bubblewrap", which is the question the sandbox checks and the verdict ask.
  const shellSandbox = rowKey(rowBlock(preset, "wsl-shell"), "sandbox");
  const fsSandbox = rowKey(rowBlock(preset, "wsl-fs"), "sandbox");
  const routingSandbox = rowKey(routing, "sandbox");
  const sandbox = shellSandbox ?? fsSandbox ?? routingSandbox;
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
    for (const [block, keys] of [[layerPreset, ["distro", "sessionSandbox", "agentBackend", "sandbox"]], [layerRouting, ["sandbox", "maskWindowsDrive"]]]) {
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
 * Whether one capture smells like a `wsl.exe` transport flake rather than an
 * answer from the distro: the execFile deadline fired, or the output carries
 * WSL's own wedged-service error (`Wsl/Service/WSAETIMEDOUT` and friends —
 * localized text is fine, the error class rides every language). Under the
 * doctor's concurrent probing of several distros on one VM, these flakes
 * arrive exactly when a cold distro is mid-boot, and trusting them produced
 * the wrong class of report: static config (`wsl.conf`, resolv.conf) read as
 * broken when the read itself was the casualty.
 * @param {{ ok: boolean, stdout: string, stderr: string, timedOut?: boolean }} answer - the capture.
 * @returns {boolean} true when the capture must not feed a config verdict.
 */
export function isFlake(answer) {
  return answer.timedOut === true || /WSAETIMEDOUT|Wsl\/Service/i.test(`${answer.stderr}\n${answer.stdout}`);
}

/** How long one retry waits for the VM to settle before probing again. */
const FLAKE_SETTLE_MS = 2_000;

/**
 * One in-distro probe with a transport-flake retry: a capture that smells like
 * a flake is retried once after a settle delay, and the result carries whether
 * the FINAL answer is still untrusted (`flaked`), so a caller can report
 * `unknown` instead of a configuration verdict built on a wedged read.
 * @param {string} distro - the distro name.
 * @param {string} script - the shell script.
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code?: string, timedOut?: boolean, flaked: boolean }>} the capture plus the flake flag.
 */
async function askDistro(distro, script) {
  const first = await inDistro(distro, script);
  if (first.ok || !isFlake(first)) return { ...first, flaked: isFlake(first) };
  await new Promise((resolve) => setTimeout(resolve, FLAKE_SETTLE_MS));
  const second = await inDistro(distro, script);
  return { ...second, flaked: isFlake(second) };
}

/**
 * Parse the doctor's own arguments.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {{ distro: string, wsl: string, json: boolean, fix: boolean, fixOwned: boolean, install: boolean, yes: boolean, readOnly: boolean, all: boolean, bundle: string, redact: boolean, sections: string, quick: boolean, help: boolean, locale: string }} the options.
 */
function parseArgs(argv) {
  const options = {
    distro: "",
    wsl: "",
    json: false,
    fix: false,
    fixOwned: false,
    install: false,
    yes: false,
    readOnly: false,
    all: false,
    bundle: "",
    redact: false,
    sections: "",
    quick: false,
    help: false,
    locale: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--json") options.json = true;
    else if (arg === "--locale") options.locale = argv[++i] ?? "";
    else if (arg.startsWith("--locale=")) options.locale = arg.slice("--locale=".length);
    else if (arg === "--fix") options.fix = true;
    else if (arg === "--fix-owned") options.fixOwned = true;
    else if (arg === "--install") options.install = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--read-only") options.readOnly = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--quick") options.quick = true;
    else if (arg === "--sections") options.sections = argv[++i] ?? "";
    else if (arg.startsWith("--sections=")) options.sections = arg.slice("--sections=".length);
    else if (arg === "--bundle") options.bundle = argv[++i] ?? "";
    else if (arg.startsWith("--bundle=")) options.bundle = arg.slice("--bundle=".length);
    else if (arg === "--redact") options.redact = true;
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
  console.error(doctorT("refusal.read-only"));
  return 2;
}

/**
 * Map over items with at most `limit` workers running at once, preserving the
 * input order in the results. The distro collection uses this: the distros
 * are independent (the two-distro probe proves the wsl.exe command path is
 * concurrent), and the A5 measurement says the wall clock is real — nine
 * distros cost 151 s sequentially on the Tier 1 machine.
 * @template T, R
 * @param {T[]} items - the items.
 * @param {number} limit - the worker count.
 * @param {(item: T, index: number) => Promise<R>} worker - one item's work.
 * @returns {Promise<R[]>} the results, in input order.
 */
async function mapWithConcurrency(items, limit, worker) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(/** @type {T} */ (items[index]), index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** The distro-collection worker count: three concurrent distros keep the
 * wsl.exe fan-out polite while cutting the nine-distro wall clock to about
 * a third. */
const DISTRO_CONCURRENCY = 3;

/**
 * Run the doctor.
  * @param {{ distro: string, wsl: string, json: boolean, fix: boolean, fixOwned: boolean, install: boolean, yes: boolean, readOnly: boolean, all: boolean, bundle: string, redact: boolean, help: boolean }} options - the parsed options.
 * @returns {Promise<number>} the exit status.
 */
/**
 * The doctor run: collect the checks under the effective configuration and
 * the requested scope, then report.
 * @param {ReturnType<typeof parseArgs>} options - the parsed arguments.
 * @returns {Promise<number>} 0 when the verdict is `ready`, 1 when `blocked`.
 */
async function main(options) {
  // The output language: an explicit `--locale` / `DSH_WSL_DOCTOR_LOCALE`
  // wins without probing; otherwise a human run detects the Windows locale
  // through the registry (fast, no PowerShell startup) — the refusals below
  // render in the detected language too. `--json` stays language-independent
  // and pays no extra subprocess.
  if (options.json) setDoctorLocale("en");
  else setDoctorLocale(overrideLocale(options.locale));
  if (!options.json && options.locale.length === 0 && (process.env.DSH_WSL_DOCTOR_LOCALE ?? "").length === 0) {
    const query = await run([CMD, "/c", "reg query \"HKCU\\Control Panel\\International\" /v LocaleName"]);
    setDoctorLocale(localeFromTag(localeNameFromReg(query.stdout)));
  }
  if (options.fixOwned && options.install) {
    console.error(doctorT("refusal.owned-install"));
    return 2;
  }
  // `--fix-owned` names a fix subset, so it implies the fix loop; the
  // read-only gate below then still refuses it.
  if (options.fixOwned) options.fix = true;
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
  // The package manifest, read once: the peers check and the bundle both need it.
  const manifest = /** @type {{ name?: string, version?: string, peerDependencies?: Record<string, string> }} */ (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")));
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

  // ---- scope ----------------------------------------------------------------
  // `--quick` and `--sections` bound what this run probes and reports: a
  // scoped run still probes `distro.reachable` (the transport gate) but its
  // report carries only the requested sections, and the expensive legs — the
  // resident smokes, the fence smoke, the registry query, the port survey —
  // run only when their section is selected and the run is not quick. A full
  // run (the default) sets `wanted = null`: every section, no gating.
  const wanted = options.quick
    ? new Set(QUICK_SECTIONS)
    : options.sections.length > 0
      ? (() => {
        /** @param {string} s - one comma-separated section token. @returns {boolean} whether it names a section. */
        const known = (s) => SECTIONS.includes(s);
        const picked = options.sections.split(",").map((s) => s.trim()).filter(known);
        if (picked.length === 0) return null;
        return new Set(picked);
      })()
      : null;
  const quick = options.quick;
  /** Whether a section is in this run's scope. */
  const want = (/** @type {string} */ section) => wanted === null || wanted.has(section);
  /** @type {{ sections: string[], quick: boolean } | undefined} */
  let scope;
  if (wanted !== null) scope = { sections: [...wanted], quick };

  // ---- host platform -------------------------------------------------------
  // One row for the two facts that gate WSL 2 itself: the Windows build (WSL 2
  // needs 19041 or later) and the WSL version string. A build below that floor
  // cannot run the plugin at all, so it fails rather than reading as context;
  // an unreadable host (the doctor running inside a distro without interop)
  // stays `info` — the distro checks below still speak for themselves.
  const windows = await run([CMD, "/c", "ver"]);
  const buildText = /[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?/.exec(windows.stdout.replace(/\0/g, ""))?.[0] ?? "";
  const buildNumber = buildText === "" ? 0 : Number(buildText.split(".")[2] ?? 0);
  const version = await run([wslExe, "--version"]);
  const wslVersion = version.stdout.replace(/\0/g, "").split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 2).join(" ").trim();
  const platformDetail = [buildText === "" ? "" : `Windows ${buildText}`, wslVersion].filter((part) => part.length > 0).join("; ");
  if (buildText === "" && wslVersion === "") {
    check("host.platform", "info", "Windows and WSL", "neither the Windows build nor the WSL version is readable through cmd.exe — run the doctor from Windows or a WSL with interop enabled");
  } else if (buildNumber > 0 && buildNumber < 19041) {
    check("host.platform", "fail", "Windows and WSL", `${platformDetail} — WSL 2 needs Windows 10 build 19041 or later`, "upgrade Windows to a WSL 2-capable build; this plugin runs commands only in WSL 2 distros");
  } else if (!version.ok || wslVersion === "") {
    check("host.platform", "warn", "Windows and WSL", `${buildText === "" ? "the Windows build is unreadable" : `Windows ${buildText}`}; wsl.exe --version failed — WSL 1 or an old WSL 2 build`, "wsl.exe --update, then confirm the distro runs as WSL 2 (wsl.exe -l -v shows VERSION 2)");
  } else {
    check("host.platform", "ok", "Windows and WSL", platformDetail);
  }

  phase("host");
  // ---- .wslconfig (the global VM config; host-level) ------------------------
  // WSL silently ignores a malformed file, so interop/masking advice can fail
  // to apply without a trace; this parser is where the trap gets named. The
  // read rides cmd.exe (the same interop path `host.platform` uses), which
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

  // ---- host volume (the drive holding the distro) ---------------------------
  // `distro.disk` reads the ext4 volume's own `df`; when the Windows volume
  // that holds the VHDX is full, that df still looks healthy and every write
  // fails anyway. The default distro location lives under `%LOCALAPPDATA%`, so
  // that drive is the one this check answers for.
  if (process.platform !== "win32") {
    check("host.disk", "info", "Host disk", "only the Windows entry can read the volume holding the distro (this doctor runs inside a distro)");
  } else {
    const drive = /^([A-Za-z]):/.exec(process.env.LOCALAPPDATA ?? "")?.[1] ?? /^([A-Za-z]):/.exec(ROOT)?.[1] ?? "";
    if (drive === "") {
      check("host.disk", "info", "Host disk", "the volume holding the distro is unknown (%LOCALAPPDATA% is unreadable)");
    } else {
      try {
        const stats = statfsSync(`${drive}:\\`);
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        const totalBytes = Number(stats.blocks) * Number(stats.bsize);
        const verdict = hostDiskVerdict(freeBytes, totalBytes);
        check("host.disk", verdict.status, "Host disk", `${drive}: ${verdict.detail} (the default distro location under %LOCALAPPDATA%)`, verdict.remedy);
      } catch (error) {
        check("host.disk", "info", "Host disk", `unreadable (${/** @type {Error} */ (error).message})`);
      }
    }
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
  const runInfo = /** @type {{ distros: string[], config?: EffectiveConfig, timingsMs?: Record<string, number>, scope?: { sections: string[], quick: boolean }, bundle?: { path: string, redact: boolean, manifest: { name?: string, version?: string, peerDependencies?: Record<string, string> } } }} */ ({ distros: [], timingsMs });
  if (options.bundle.length > 0) runInfo.bundle = { path: options.bundle, redact: options.redact, manifest };
  runInfo.config = { ...effective };
  if (options.fix && wanted !== null) {
    console.error(doctorT("refusal.scoped-fix"));
    return 2;
  }
  if (scope !== undefined) runInfo.scope = scope;
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
   * @returns {Promise<{ checks: Check[], reachable: boolean, bwrapPath: string, stale: number, cacheEntries: number, cacheBad: number, cacheExecPath: string, family: string, agentScriptDistro: string | undefined }>} the distro's own checks and the state the fix section needs.
   */
  const collectDistroChecks = async (target) => {
    /** @type {Check[]} */
    const collected = [];
    /** The shipped shell agent, as this host names it (Windows or POSIX). */
    const agentScript = join(ROOT, "agent", "wsl-agent.sh");
    const check = (/** @type {string} */ id, /** @type {Check["status"]} */ status, /** @type {string} */ title, /** @type {string | undefined} */ detail = undefined, /** @type {string | undefined} */ remedy = undefined) => {
      collected.push({ id, status, title, ...(detail === undefined ? {} : { detail }), ...(remedy === undefined ? {} : { remedy }), distro: target });
    };
    /** One in-distro probe with the flake retry. */
    const probe = (/** @type {string} */ script) => askDistro(target, script);
    /** The `unknown` row a transport flake earns instead of a config verdict. */
    const flakeCheck = (/** @type {string} */ id, /** @type {string} */ title, /** @type {{ stderr: string, stdout: string }} */ answer) => check(id, "unknown", title,
      `transport flake — wsl.exe timed out or wedged (${(answer.stderr || answer.stdout || "no output").trim().split(/\r?\n/)[0]?.slice(0, 80) || "no output"}); this read is not trusted as a configuration verdict`,
      `rerun the doctor; if the flake repeats, "wsl.exe -t ${target}" (terminate just this distro) and rerun again`);
    const alive = await probe("printf %s ok");
    if (!alive.ok && alive.flaked) {
      flakeCheck("distro.reachable", `Distro "${target}"`, alive);
      return { checks: collected, reachable: false, bwrapPath: "", stale: 0, cacheEntries: 0, cacheBad: 0, cacheExecPath: "", family: "unknown", agentScriptDistro: undefined };
    }
    if (!alive.ok || alive.stdout.trim() !== "ok") {
      check("distro.reachable", "fail", `Distro "${target}"`, "wsl.exe could not run a command in it (stopped, wedged, or missing)", `wsl.exe -d ${target} -- true; if that hangs, wsl.exe --shutdown, then retry`);
      return { checks: collected, reachable: false, bwrapPath: "", stale: 0, cacheEntries: 0, cacheBad: 0, cacheExecPath: "", family: "unknown", agentScriptDistro: undefined };
    }
    check("distro.reachable", "ok", `Distro "${target}"`, "answers commands");

    // ---- Windows share reachability (host section) ---------------------------
    // The GUI file service, the workspace picker and open-in-app read the
    // `\\wsl.localhost` share from the WINDOWS side; the agent path does not.
    // A share Windows cannot read is a silent feature loss, so name it. The
    // probe is meaningless from inside a distro (and from another distro's
    // filesystem), so it reports that instead of guessing.
    if (process.platform === "win32") {
      const unc = `\\\\wsl.localhost\\${target}`;
      const readable = existsSync(unc);
      check("distro.unc", readable ? "ok" : "warn", "Windows share",
        readable ? `${unc} is readable from Windows` : `Windows cannot read ${unc} — the GUI file service, workspace picker and open-in-app use this share`,
        readable ? undefined : `wsl.exe --terminate ${target}, then retry; if it persists, check that the 9p/Plan9 service is not blocked by security software`);
    } else {
      check("distro.unc", "info", "Windows share", "only the Windows entry can test the \\\\wsl.localhost share (this doctor runs inside a distro)");
    }

    // ---- distro identity -----------------------------------------------------
    // The login shell and the home directory are one fact (the passwd entry)
    // and one probe: both are consumed by the executor's shell resolution and
    // the agent cache, and a broken entry fails both at once. The family probe
    // stays (the install remedy needs it) but no longer has a row of its own.
    let family = "unknown";
    const identityAnswer = await probe('s=$(getent passwd "$(id -u)" | cut -d: -f7); [ -n "$s" ] || s=$SHELL; printf "SH=%s\\nHM=%s\\n" "$s" "$HOME"');
    if (!identityAnswer.ok && identityAnswer.flaked) flakeCheck("distro.identity", "Login shell and home", identityAnswer);
    else {
      const shell = /^SH=(.*)$/m.exec(identityAnswer.stdout)?.[1]?.trim() ?? "";
      const home = /^HM=(.*)$/m.exec(identityAnswer.stdout)?.[1]?.trim() ?? "";
      const shellOk = shell.startsWith("/");
      const homeOk = home.startsWith("/");
      if (shellOk && homeOk) check("distro.identity", "ok", "Login shell and home", `${shell}, ${home}`);
      else check("distro.identity", "fail", "Login shell and home", `shell=${shell.length === 0 ? "(none)" : shell}, home=${home.length === 0 ? "(none)" : home}`, `check the user's /etc/passwd entry in "${target}": getent passwd "$(id -u)"`);
    }

    const familyAnswer = await probe(`for f in ${FAMILIES.join(" ")}; do command -v "$f" >/dev/null 2>&1 && { echo "$f"; exit 0; }; done; echo unknown`);
    if (familyAnswer.ok) family = familyAnswer.stdout.trim();

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
    const dfAnswer = await probe("df -Pm /");
    if (!dfAnswer.ok && dfAnswer.flaked) flakeCheck("distro.disk", "Disk", dfAnswer);
    else {
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
    }

    // ---- sandbox prerequisites ----------------------------------------------
    // Config-aware like the session rows: with `sandbox: false` on every row
    // AND `sessionSandbox: false`, nothing this plugin runs is confined, so a
    // missing bwrap is not a failure — but it is a security posture worth a
    // loud warning, not a silent `info`. The fence smoke is skipped with it.
    let bwrapUsable = false;
    let bwrapPath = "";
    const sandboxDisabled = effective.sandbox === "false" && effective.sessionSandbox === "false";
    const install = installRemedy(target, family);
    if (!want("sandbox")) {
      // sandbox section out of scope: bwrapPath stays "" and the fence smoke
      // below is skipped with it.
    } else if (sandboxDisabled) {
      check("sandbox.bwrap", "warn", "bubblewrap (sandbox disabled)",
        "the effective configuration disables confinement (sandbox: false on every row and sessionSandbox: false) — commands and writes run UNCONFINED; bubblewrap is not required",
        'set sandbox: true on wsl-shell, wsl-fs and fs-routing (and sessionSandbox: true) to enforce the fence, then rerun the doctor');
      check("sandbox.bwrap-usable", "skipped", "bubblewrap usability", "skipped: the sandbox is disabled by configuration");
    } else {
      const bwrapAnswer = await probe("command -v bwrap");
      if (!bwrapAnswer.ok && bwrapAnswer.flaked) flakeCheck("sandbox.bwrap", "bubblewrap", bwrapAnswer);
      else {
      bwrapPath = bwrapAnswer.stdout.trim();
      if (bwrapPath.length === 0) {
        check("sandbox.bwrap", "fail", "bubblewrap", "missing; every confined command fails closed without it", `${install}, or run "pnpm run bootstrap ${target} --install"`);
      } else {
        check("sandbox.bwrap", "ok", "bubblewrap", bwrapPath);
        const userns = await probe("bwrap --ro-bind / / -- true");
        if (!userns.ok && userns.flaked) flakeCheck("sandbox.bwrap-usable", "bubblewrap usability", userns);
        else if (userns.ok) {
          check("sandbox.bwrap-usable", "ok", "bubblewrap usability", "a read-only profile runs");
          bwrapUsable = true;
        } else check("sandbox.bwrap-usable", "fail", "bubblewrap usability", "installed but the read-only profile failed", "the kernel likely disables unprivileged user namespaces; reinstalling will not help — see docs/LIMITATIONS.md");
      }
      }
    }

    // ---- session sandbox prerequisites --------------------------------------
    // The statuses are config-aware: the scope is only *required* under
    // `sessionSandbox: true` (the shipped default); `auto` falls back to the
    // per-command bwrap profile and `false` does not use the scope at all, so
    // in both cases a missing prerequisite downgrades to a warning — a `fail`
    // always blocks, which is the invariant the verdict leans on.
    let runtimeSystemd = false;
    let systemdPid = "";
    /** The agent-cache inventory the fix loop consumes: entries and unusable ones. */
    let cacheEntries = 0;
    let cacheBad = 0;
    /** The first cached native binary that passed its own exec check. */
    let cacheExecPath = "";
    /** Whether this package ships a native agent for the distro's architecture. */
    let nativePackaged = false;
    /** Whether the effective config makes the native backend mandatory. */
    const nativeRequired = effective.agentBackend === "native";
    if (want("session")) {
    const systemd = await probe('if [ -d /run/systemd/system ]; then printf "systemd %s" "$(cat /proc/1/comm)"; else printf "none %s" "$(cat /proc/1/comm)"; fi');
    if (!systemd.ok && systemd.flaked) flakeCheck("session.systemd", "systemd as PID 1", systemd);
    else if (!systemd.stdout.startsWith("systemd")) {
      check("session.systemd", sessionStatus(), "systemd as PID 1", withScopeNote(systemd.stdout.trim().length > 0 ? systemd.stdout.trim() : "not systemd"), `set [boot] systemd=true in /etc/wsl.conf inside "${target}", run "wsl.exe --shutdown", then reopen the session. Without it, sessionSandbox cannot run`);
    } else check("session.systemd", "ok", "systemd as PID 1", "running");

    const systemdRun = await probe("command -v systemd-run");
    if (!systemdRun.ok && systemdRun.flaked) flakeCheck("session.systemd-run", "systemd-run", systemdRun);
    else {
      const systemdRunPath = systemdRun.stdout.trim();
      if (systemdRunPath.length > 0) check("session.systemd-run", "ok", "systemd-run", systemdRunPath);
      else check("session.systemd-run", sessionStatus(), "systemd-run", withScopeNote("missing; the distro's systemd package is incomplete"), `reinstall systemd inside "${target}" (apt-get install --reinstall systemd, or the family's equivalent)`);
    }

    const userManager = await probe("systemctl --user is-system-running 2>/dev/null || true");
    if (!userManager.ok && userManager.flaked) flakeCheck("session.user-manager", "systemd user manager", userManager);
    else {
      const userState = userManager.stdout.trim();
      if (userState === "running" || userState === "degraded") check("session.user-manager", "ok", "systemd user manager", userState);
      else check("session.user-manager", sessionStatus(), "systemd user manager", withScopeNote(userState.length > 0 ? userState : "unreachable"), `log in to "${target}" once, or enable lingering (next remedy), then retry`);
    }

    const linger = await probe('loginctl show-user "$(id -un)" -p Linger 2>/dev/null');
    if (!linger.ok && linger.flaked) flakeCheck("session.linger", "Linger", linger);
    else {
      const lingerState = linger.stdout.trim();
      if (lingerState === "Linger=yes") check("session.linger", "ok", "Linger", lingerState);
      else check("session.linger", sessionStatus(), "Linger", withScopeNote(lingerState.length > 0 ? lingerState : "unset"), `wsl.exe -d ${target} -- loginctl enable-linger "$(id -un)" (this needs the user's own session; run it inside the distro)`);
    }
    runtimeSystemd = systemd.stdout.startsWith("systemd");
    systemdPid = systemd.stdout.trim();
    }

    // ---- /etc/wsl.conf cross-checks ------------------------------------------
    // The distro-level settings the plugin cannot change (LIMITATIONS): boot,
    // interop, automount. Each check reads the conf against the runtime facts
    // the probes above collected and names the terminate semantics — a conf
    // value that is not in effect is a different problem from one that is.
    // A flaked read earns three `unknown` rows, never a verdict: the conf is
    // on disk, and the read — not the file — is what failed.
    const confAnswer = await probe("cat /etc/wsl.conf 2>/dev/null || true");
    const confFlaked = !confAnswer.ok && confAnswer.flaked;
    const conf = parseIni(confAnswer.stdout);
    const noConf = confAnswer.stdout.trim().length === 0;
    const automountEnabled = ((noConf ? undefined : conf.automount?.enabled) ?? "").trim().toLowerCase();
    const automountRoot = ((noConf ? undefined : conf.automount?.root) ?? "").trim();
    /** Where the distro mounts Windows drives; the host->distro translation uses it. */
    const mountRoot = automountRoot.length > 0 ? automountRoot : "/mnt";
    /** The shell agent as the distro sees it; undefined when it cannot be reached from there. */
    const agentScriptDistro = automountEnabled === "false" ? undefined : distroPath(agentScript, mountRoot);
    const confWanted = want("session") || want("conf");
    if (!confWanted) {
      // Scoped run: neither the boot cross-check nor the interop/automount
      // rows are in scope — the conf read above stays (one cheap call that
      // the section rows share), but no rows report.
    } else if (confFlaked) {
      if (want("session")) flakeCheck("distro.wsl-conf-boot", "/etc/wsl.conf [boot]", confAnswer);
      if (want("conf")) {
        flakeCheck("distro.wsl-conf-interop", "/etc/wsl.conf [interop]", confAnswer);
        flakeCheck("distro.wsl-conf-automount", "/etc/wsl.conf [automount]", confAnswer);
      }
    } else {
    const bootSystemd = ((noConf ? undefined : conf.boot?.systemd) ?? "").trim().toLowerCase();
    if (!want("session")) {
      // boot row out of scope
    } else if (noConf) {
      check("distro.wsl-conf-boot", "info", "/etc/wsl.conf [boot]", "no /etc/wsl.conf — the default (systemd off) applies, and the runtime matches it");
    } else if (bootSystemd === "true" && !runtimeSystemd) {
      check("distro.wsl-conf-boot", "warn", "/etc/wsl.conf [boot]", `[boot] systemd=true but PID 1 is ${systemdPid || "not systemd"} — the value is set but not in effect`, `wsl.exe --terminate ${target} (or "wsl.exe --shutdown"), then reopen the session`);
    } else if (bootSystemd === "false" && runtimeSystemd) {
      check("distro.wsl-conf-boot", "warn", "/etc/wsl.conf [boot]", "[boot] systemd=false but PID 1 is systemd — the running boot predates the value", `wsl.exe --terminate ${target} applies it; check sessionSandbox first, because the scope needs systemd`);
    } else {
      check("distro.wsl-conf-boot", "ok", "/etc/wsl.conf [boot]", bootSystemd === "" ? "no [boot] systemd line (the off default) — the runtime matches" : `[boot] systemd=${bootSystemd} — the runtime matches`);
    }

    const interopEnabled = ((noConf ? undefined : conf.interop?.enabled) ?? "").trim().toLowerCase();
    if (!want("conf")) {
      // interop/automount rows out of scope
    } else {
      // The binfmt handler is the runtime fact behind the conf value: a conf
      // that says enabled while the handler is absent is a stale boot (or a
      // /proc that was not mounted), and every Windows-tool path — git.exe,
      // explorer.exe, the cmd.exe probes — fails with a confusing command-not-
      // found instead of naming interop. Probe it in BOTH directions.
      const binfmtProbe = await probe("[ -e /proc/sys/fs/binfmt_misc/WSLInterop ] && printf yes || printf no");
      if (!binfmtProbe.ok && binfmtProbe.flaked) flakeCheck("distro.wsl-conf-interop", "/etc/wsl.conf [interop]", binfmtProbe);
      else {
        const binfmt = binfmtProbe.ok ? binfmtProbe.stdout.trim() : "unreadable";
        if (interopEnabled === "false") {
          check("distro.wsl-conf-interop", "warn", "/etc/wsl.conf [interop]", `interop is disabled in wsl.conf${binfmt === "yes" ? " but the WSLInterop handler is still loaded (stale boot)" : ""} — Windows git, open-in-app and the cmd.exe probes are unreachable from this distro`, `remove the [interop] enabled=false line in /etc/wsl.conf, then wsl.exe --terminate ${target}`);
        } else if (binfmt === "no") {
          check("distro.wsl-conf-interop", "warn", "/etc/wsl.conf [interop]", `interop is enabled${noConf ? " (the default)" : " in wsl.conf"} but the WSLInterop handler is not registered — a stale boot, or /proc/sys/fs/binfmt_misc was not mounted; Windows git, open-in-app and the cmd.exe probes fail from this distro`, `wsl.exe --terminate ${target}; if it persists, check that /proc/sys/fs/binfmt_misc is mounted (WSL mounts it at boot)`);
        } else {
          const appendWindowsPath = ((noConf ? undefined : conf.interop?.appendWindowsPath) ?? "").trim().toLowerCase();
          check("distro.wsl-conf-interop", "ok", "/etc/wsl.conf [interop]", noConf
            ? "no /etc/wsl.conf — interop on (the default), and the WSLInterop handler is registered"
            : `enabled=${interopEnabled || "true (the default)"}, the WSLInterop handler is registered${appendWindowsPath === "false" ? "; appendWindowsPath=false (Windows PATH not appended — Windows tools need full paths)" : ""}`);
        }
      }
    }

    if (!want("conf")) {
      // automount row out of scope
    } else if (automountEnabled === "false") {
      check("distro.wsl-conf-automount", "warn", "/etc/wsl.conf [automount]", "automount is disabled — /mnt has no Windows drives and Windows files are unreachable from this distro; the masking stance is moot", `remove [automount] enabled=false in /etc/wsl.conf, then wsl.exe --terminate ${target}`);
    } else if (automountRoot.length > 0 && automountRoot !== "/mnt" && interopMasked) {
      check("distro.wsl-conf-automount", "warn", "/etc/wsl.conf [automount]", `the automount root is ${automountRoot}, not /mnt — the drive-masking stance is in effect and targets /mnt, so ${automountRoot} is not covered`, `reset [automount] root to /mnt in /etc/wsl.conf, then wsl.exe --terminate ${target}`);
    } else {
      check("distro.wsl-conf-automount", "ok", "/etc/wsl.conf [automount]", noConf
        ? "no /etc/wsl.conf — /mnt mounts (the default)"
        : `enabled=${automountEnabled || "true (the default)"}, root=${automountRoot || "/mnt"}`);
    }
    }

    // ---- clock ----------------------------------------------------------------
    // A sleeping host desyncs the WSL clock (the VM's clock stops with it);
    // the classic symptom is TLS and git failing with certificate or
    // timestamp errors minutes after resume. One comparison, one remedy.
    const clockAnswer = await probe("date +%s");
    if (!clockAnswer.ok && clockAnswer.flaked) flakeCheck("distro.clock", "Clock", clockAnswer);
    else {
      const distroEpoch = Number(clockAnswer.stdout.trim());
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
    }

    // ---- dns ------------------------------------------------------------------
    // Name resolution breaks in two WSL-specific ways: the auto-generated
    // /etc/resolv.conf lost its nameserver (or generation was disabled), and
    // the VPN-tunnel class where the file looks fine but queries die. The
    // probe is warn-grade and honest about offline — a machine without a
    // network answers the same as a broken resolver.
    const resolvAnswer = want("net") ? await probe("wc -c < /etc/resolv.conf 2>/dev/null || printf 0") : undefined;
    if (resolvAnswer !== undefined && !resolvAnswer.ok && resolvAnswer.flaked) flakeCheck("distro.dns", "DNS", resolvAnswer);
    else if (resolvAnswer !== undefined) {
      const resolvBytes = Number(resolvAnswer.stdout.trim());
      if (!Number.isFinite(resolvBytes) || resolvBytes === 0) {
        check("distro.dns", "warn", "DNS", "/etc/resolv.conf is missing or empty — name resolution fails (npm, git fetch, bootstrap installs)", `wsl.conf [network] generateResolvConf controls the file; "wsl.exe --shutdown" regenerates it unless disabled`);
      } else {
        const resolved = (await probe("getent hosts deb.debian.org 2>/dev/null | head -1")).stdout.trim();
        if (resolved.length > 0) {
          check("distro.dns", "ok", "DNS", `resolv.conf present (${resolvBytes} bytes); ${(resolved.split(/\s+/)[0] ?? "?")} resolved the probe name`);
        } else {
          check("distro.dns", "warn", "DNS", `resolv.conf present (${resolvBytes} bytes) but the probe name did not resolve — offline, or the resolver is broken (the VPN-tunnel class)`, "check the network; with a VPN up, see the WSL DNS tunneling notes in docs/CONFIGURATION.md");
        }
      }
    }

    // ---- optional tools ------------------------------------------------------
    // Feature-degradation warnings, not first-command prerequisites: the quick
    // profile skips them (three process spawns a distro) and the full run names
    // what each missing tool costs. None is a fallback-free break — a missing
    // rg still leaves the model bash grep, a missing git still leaves
    // file-tool edits, a missing inotifywait still polls.
    if (!quick) {
      /** The optional tools, in the order users notice them losing. */
      /** @type {Array<[string, string]>} */
      const optionalTools = [["rg", "the fs-search tool needs rg; the model can still run grep in a shell, slower"], ["git", "change review falls back to file-tool edits"], ["inotifywait", "the watcher falls back to polling"]];
      for (const [tool, cost] of optionalTools) {
        const toolAnswer = await probe(`command -v ${tool}`);
        if (!toolAnswer.ok && toolAnswer.flaked) flakeCheck(`tools.${tool}`, tool, toolAnswer);
        else {
          const found = toolAnswer.stdout.trim();
          if (found.length > 0) check(`tools.${tool}`, "ok", tool, found);
          else check(`tools.${tool}`, "warn", tool, `missing; ${cost}`, install);
        }
      }
    }

    // ---- agents and caches ---------------------------------------------------
    // Gated on the agent section: this region is the expensive chain (arch,
    // cache inventory, handshake, resident smokes). A scoped run without it
    // (quick included) stops after the session rows.
    if (want("agent")) {
    // The native backend is preferred by `auto` and required by `native`; the
    // check is config-aware because the consequence differs: a missing or
    // unrunnable binary degrades to the shell agent under `auto`, but fails
    // the first command (and every file operation) under `native`.
    const archAnswer = await probe("uname -m");
    if (!archAnswer.ok && archAnswer.flaked) flakeCheck("agent.native", "Native agent", archAnswer);
    else {
      const arch = archAnswer.stdout.trim();
      const packaged = ["x86_64", "aarch64"].includes(arch) ? join(ROOT, "agent", "native", `linux-${arch}`, "dsh-wsl-agent") : "";
      if (arch === "") {
        check("agent.native", nativeRequired ? "fail" : "info", "Native agent", "the distro architecture is unreadable, so the packaged native agent cannot be named", nativeRequired ? "probe the distro by hand (uname -m), or use agentBackend: auto" : undefined);
      } else if (packaged === "") {
        check("agent.native", nativeRequired ? "fail" : "info", "Native agent", `${arch} has no packaged native agent; only the shell agent can serve this distro`, nativeRequired ? "use agentBackend: auto (falls back to the shell agent) or shell" : undefined);
      } else if (existsSync(packaged)) {
        nativePackaged = true;
        check("agent.native", "ok", "Native agent", `${packaged.slice(ROOT.length + 1)} for ${arch}${effective.agentBackend === "shell" ? " (agentBackend: shell does not use it)" : ""}`);
      } else {
        check("agent.native", nativeRequired ? "fail" : effective.agentBackend === "shell" ? "info" : "warn", "Native agent", `missing for ${arch}${effective.agentBackend === "shell" ? "; agentBackend: shell does not use it" : ""}`, "reinstall the plugin (the binaries ship with the package), or use agentBackend: auto/shell");
      }
    }

    const cacheAnswer = await probe(CACHE_REPORT);
    if (!cacheAnswer.ok && cacheAnswer.flaked) flakeCheck("agent.cache", "Agent cache", cacheAnswer);
    else {
      const cache = cacheAnswer.stdout.trim();
      if (cache === "none" || cache.length === 0) check("agent.cache", "info", "Agent cache", "empty (a first command populates it)");
      else {
        const entries = cache.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const bad = entries.filter((line) => line.startsWith("noexec ") || line.startsWith("broken ")).length;
        cacheEntries = entries.length;
        cacheBad = bad;
        cacheExecPath = entries.find((line) => line.startsWith("exec "))?.slice("exec ".length).trim() ?? "";
        const badNote = bad > 0 ? `, ${bad} not executable or not runnable` : "";
        const cacheTone = bad === 0 ? "ok" : nativeRequired ? "fail" : effective.agentBackend === "shell" ? "info" : "warn";
        check("agent.cache", cacheTone, "Agent cache", `${entries.length} cached binary(ies)${badNote}${bad > 0 && effective.agentBackend === "shell" ? " (agentBackend: shell does not use the cache)" : ""}`, bad > 0 ? `rm -rf ~/.cache/dsh-wsl/agent inside "${target}"; the next command repopulates it` : undefined);
      }
    }

    // ---- home writability and execution -------------------------------------
    // The native agent is streamed into `$HOME/.cache/dsh-wsl/agent` and
    // executed from there; a read-only home, or a home on a `noexec` mount
    // (DrvFs when HOME points at /mnt/c), breaks that before any command runs.
    // One temp dir answers both facts and is removed again.
    const homeProbe = await probe('d=$(mktemp -d "$HOME/.dsh-doctor-XXXXXXXX" 2>/dev/null) || { echo nowrite; exit 0; }; printf "#!/bin/sh\\n" > "$d/x" && chmod 755 "$d/x" && "$d/x" >/dev/null 2>&1 && printf ok || printf noexec; rm -rf "$d"');
    if (!homeProbe.ok && homeProbe.flaked) flakeCheck("agent.home-writable", "Home writability", homeProbe);
    else {
      const homeState = homeProbe.stdout.trim();
      const homeTone = (/** @type {"fail" | "warn" | "info"} */ tone) => nativeRequired ? "fail" : effective.agentBackend === "shell" ? "info" : tone;
      if (homeState === "ok") check("agent.home-writable", "ok", "Home writability", "a temp dir under $HOME was writable and executable (the native cache can live there)");
      else if (homeState === "noexec") check("agent.home-writable", homeTone("warn"), "Home writability", `$HOME is writable but files there cannot execute (a noexec mount) — the native agent cache cannot run${effective.agentBackend === "shell" ? "; agentBackend: shell does not need it" : "; auto falls back to the shell agent"}`, "move HOME onto an exec-capable Linux filesystem (DrvFs is often noexec), or use agentBackend: shell");
      else check("agent.home-writable", homeTone("warn"), "Home writability", `a temp dir under $HOME could not be created — the native agent cache cannot be extracted${effective.agentBackend === "shell" ? "; agentBackend: shell does not need it" : "; auto falls back to the shell agent"}`, "make $HOME writable (it is a read-only mount, or the user's entry is wrong), or use agentBackend: shell");
    }
    }

    // ---- session scopes (section: session) ------------------------------------
    const scopesAnswer = want("session") ? await probe(STALE_SCOPE_REPORT) : undefined;
    let stale = 0;
    /** @type {string[]} */
    let livePids = [];
    /** @type {string[]} */
    let scopeLines = [];
    /** ok | fail | info — the handshake state the smoke legs read. */
    let handshakeState = "info";
    /** The shell-agent smoke, kept so the native legs can say whether the fallback works. */
    let shellSmoke = /** @type {{ execOk: boolean, fsOk: boolean } | undefined} */ (undefined);
    if (scopesAnswer !== undefined && !scopesAnswer.ok && scopesAnswer.flaked) flakeCheck("runtime.scopes", "Session scopes", scopesAnswer);
    else if (scopesAnswer !== undefined) {
      const scopes = scopesAnswer.stdout.trim();
      scopeLines = scopes === "none" || scopes.length === 0 ? [] : scopes.split(/\r?\n/);
      stale = scopeLines.filter((line) => /\sstale(\s|$)/.test(line)).length;
      livePids = scopeLines.flatMap((line) => {
        const m = /\spids:([0-9 ]+)$/.exec(line);
        if (m === null) return [];
        return (m[1] ?? "").trim().split(/\s+/).filter((p) => p.length > 0);
      });
    }

    // ---- resident handshake (section: agent) ----------------------------------
    /** ok | fail | info — the legs skip with a story that matches. */
    handshakeState = "info";
    if (!want("agent")) {
      // agent section out of scope: no handshake, no resident smokes.
    } else if (!existsSync(agentScript)) {
      check("agent.handshake", "fail", "Agent handshake", "agent/wsl-agent.sh is missing from this install", "reinstall the plugin; the shell agent ships with the package");
      handshakeState = "fail";
    } else if (agentScriptDistro === undefined) {
      check("agent.handshake", "info", "Agent handshake", `skipped: the package root (${ROOT}) has no path inside "${target}" — ${automountEnabled === "false" ? "automount is disabled in /etc/wsl.conf, so Windows drives are not mounted there" : "run the doctor from Windows or from inside the target"}`);
    } else {
      // The script is a Linux path in the checkout's OWN distro; another
      // distro cannot read it, and "exited before its HELLO" would be a
      // lie about a broken install. Probe readability first, honestly.
      const readable = (await inDistro(target, `[ -f "${agentScriptDistro}" ] && printf yes || printf no`)).stdout.trim() === "yes";
      if (!readable) {
        check("agent.handshake", "info", "Agent handshake", `skipped: agent/wsl-agent.sh is not readable at ${agentScriptDistro} inside "${target}" — this doctor runs from the ${(process.env.WSL_DISTRO_NAME ?? "host")} filesystem; run it from Windows or inside "${target}"`);
      } else {
        const handshake = await probeResident(target, agentScriptDistro, wslExe, agentScript);
        handshakeState = handshake.ok && handshake.digestMatches ? "ok" : "fail";
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
    }

    // ---- stale session scopes ------------------------------------------------
    if (!want("session")) {
      // session section out of scope
    } else if (scopeLines.length === 0) check("runtime.scopes", "info", "Session scopes", "none (no user manager, or none left behind)");
    else if (stale === 0) check("runtime.scopes", "ok", "Session scopes", `${scopeLines.length} live, none stale`);
    else check("runtime.scopes", "warn", "Session scopes", `${stale} stale of ${scopeLines.length}`, "--fix stops them (the same sweep the session preflight runs); they are safe to stop when no agent process is inside");

    // ---- smoke legs ----------------------------------------------------------
    // The handshake proves HELLO; the legs prove the chain the session rides:
    // one EXEC round trip, the confined profile's allow/refuse shape, and one
    // FSB stat+list batch over a temp dir (cleaned after). A leg whose
    // prerequisite failed is `skipped` with the blocker named — absence is
    // never silent, and a skipped leg never blocks (its blocker already does).
    const residentBlocked = handshakeState !== "ok";
    const sandboxBlocked = !sandboxDisabled && (bwrapPath.length === 0 || !bwrapUsable);
    const residentBlocker = handshakeState === "fail" ? "blocked by agent.handshake" : "the handshake could not run in this distro";
    // A quick run skips both smokes — their worth is the deep verdict, and
    // the quick profile's promise is a fast prerequisite answer.
    const residentSmokeWanted = want("agent") && !quick;
    const sandboxSmokeWanted = want("sandbox") && !quick;
    if (!residentSmokeWanted) {
      // resident smokes out of scope (or quick)
    } else if (residentBlocked) {
      check("functional.exec", "skipped", "Smoke: EXEC", `skipped: ${residentBlocker}`);
      check("functional.fs", "skipped", "Smoke: FSB batch", `skipped: ${residentBlocker}`);
    } else {
      // One retry for both smoke sessions: under concurrent probing a wedge
      // can kill an otherwise healthy chain, and a smoke `fail` is the most
      // alarming row the report can carry — it must not rest on one flaked
      // transport.
      let smoke = await runSmokeLegs(target, ["sh", agentScriptDistro ?? ""], wslExe);
      if (!smoke.execOk || !smoke.fsOk) {
        await new Promise((resolve) => setTimeout(resolve, FLAKE_SETTLE_MS));
        smoke = await runSmokeLegs(target, ["sh", agentScriptDistro ?? ""], wslExe);
      }
      // The shell agent is the fallback once `auto` can use the native binary
      // (and the only path under `agentBackend: shell`). A BusyBox distro
      // without GNU findures breaks the fallback's FSB enumeration, not the
      // selected path — so it warns with the real cause instead of blocking.
      const shellFallback = effective.agentBackend !== "shell" && nativePackaged;
      const shellTone = shellFallback ? "warn" : "fail";
      const fallbackNote = shellFallback ? ` (the shell agent is the fallback; agentBackend: ${effective.agentBackend} runs the native agent)` : "";
      const findutilsHint = smoke.fsError !== undefined && /find: unrecognized: -printf|BusyBox/i.test(smoke.fsError.message)
        ? `the shell agent needs GNU findutils (BusyBox find lacks -printf): wsl.exe -d ${target} -u root -- ${FINDUTILS[family] ?? FINDUTILS["apt-get"]}; or set agentBackend: auto/native`
        : "restart the DSH app; if it persists, delete ~/.cache/dsh-wsl/agent inside the distro and rerun the doctor";
      shellSmoke = smoke;
      check("functional.exec", smoke.execOk ? "ok" : shellTone, "Smoke: EXEC", `shell agent: ${smoke.execDetail}${smoke.execOk ? "" : fallbackNote}`, smoke.execOk ? undefined : "restart the DSH app; if it persists, delete ~/.cache/dsh-wsl/agent inside the distro and rerun the doctor");
      check("functional.fs", smoke.fsOk ? "ok" : shellTone, "Smoke: FSB batch", `shell agent: ${smoke.fsDetail}${smoke.fsOk ? "" : fallbackNote}`, smoke.fsOk ? undefined : findutilsHint);
    }

    // ---- native smoke (section: agent) ---------------------------------------
    // The legs above prove the SHELL agent; `auto` prefers the native binary,
    // so the binary the session will actually exec runs the SAME chain here:
    // HELLO, one EXEC round trip, one FSB batch. The cache directory is named
    // after the binary's sha256, so the HELLO self-digest binds the running
    // process to the cache entry without reading the bytes again. A fresh
    // machine has no cache yet (the first command extracts one), and `shell`
    // never uses it.
    if (!residentSmokeWanted) {
      // out of scope (quick runs skip it too)
    } else if (effective.agentBackend === "shell") {
      check("functional.native", "skipped", "Smoke: native agent", "skipped: agentBackend: shell");
    } else if (cacheExecPath === "") {
      check("functional.native", "skipped", "Smoke: native agent", "skipped: no executable native binary in ~/.cache/dsh-wsl/agent yet — the first command extracts one");
    } else {
      const cachedDigest = cacheExecPath.split("/").slice(-2)[0] ?? "";
      let native = await runSmokeLegs(target, [cacheExecPath], wslExe, cachedDigest);
      if (!native.execOk || !native.fsOk) {
        await new Promise((resolve) => setTimeout(resolve, FLAKE_SETTLE_MS));
        native = await runSmokeLegs(target, [cacheExecPath], wslExe, cachedDigest);
      }
      const nativeOk = native.execOk && native.fsOk && native.digestMatches;
      // `auto` falls back to the shell agent, so a native failure alone is a
      // warning — unless the fallback fails too (then neither backend serves
      // the session) or the backend is pinned.
      const shellWorks = shellSmoke !== undefined && shellSmoke.execOk && shellSmoke.fsOk;
      if (nativeOk) {
        check("functional.native", "ok", "Smoke: native agent", `native agent: ${native.execDetail}; ${native.fsDetail}`);
      } else if (!native.digestMatches) {
        check("functional.native", nativeRequired ? "fail" : "warn", "Smoke: native agent", "native agent: the HELLO self-digest does not match the cache directory — the entry is stale or corrupt", "purge ~/.cache/dsh-wsl/agent inside the distro; the next command re-extracts it");
      } else {
        const nativeTone = nativeRequired || (effective.agentBackend === "auto" && !shellWorks) ? "fail" : "warn";
        check("functional.native", nativeTone, "Smoke: native agent", `native agent: ${native.execDetail}; ${native.fsDetail}${nativeTone === "fail" && !nativeRequired ? " (the shell fallback failed too — neither backend answers the chain)" : ""}`, nativeTone === "fail" ? "agentBackend: native cannot fall back; use auto/shell, or reinstall the plugin" : "auto falls back to the shell agent; purge ~/.cache/dsh-wsl/agent to re-extract");
      }
    }
    if (!sandboxSmokeWanted) {
      // fence smoke out of scope (or quick)
    } else if (sandboxDisabled) {
      check("functional.sandbox", "skipped", "Smoke: confined profile", "skipped: the sandbox is disabled by configuration");
    } else if (sandboxBlocked) {
      check("functional.sandbox", "skipped", "Smoke: confined profile", `skipped: blocked by ${bwrapPath.length === 0 ? "sandbox.bwrap" : "sandbox.bwrap-usable"}`);
    } else {
      let sandbox = await runSandboxSmoke(target);
      if (!sandbox.ok && !sandbox.flaked) {
        await new Promise((resolve) => setTimeout(resolve, FLAKE_SETTLE_MS));
        sandbox = await runSandboxSmoke(target);
      }
      if (sandbox.flaked) flakeCheck("functional.sandbox", "Smoke: confined profile", { stderr: sandbox.detail, stdout: "" });
      else check("functional.sandbox", sandbox.ok ? "ok" : "fail", "Smoke: confined profile", sandbox.detail, sandbox.ok ? undefined : "the shipped profile refused a write it must allow, or allowed one it must refuse — see docs/LIMITATIONS.md and pnpm run probe:sandbox");
    }

    return { checks: collected, reachable: true, bwrapPath, stale, cacheEntries, cacheBad, cacheExecPath, family, agentScriptDistro };
  };

  phase("target");
  /** @type {Map<string, { checks: Check[], reachable: boolean, bwrapPath: string, stale: number, cacheEntries: number, cacheBad: number, cacheExecPath: string, family: string, agentScriptDistro: string | undefined }>} */
  const states = new Map();
  const outcomes = await mapWithConcurrency(targets, DISTRO_CONCURRENCY, async (target) => {
    const distroStart = Date.now();
    const outcome = await collectDistroChecks(target);
    return { target, outcome, ms: Date.now() - distroStart };
  });
  for (const { target, outcome, ms } of outcomes) {
    checks.push(...outcome.checks);
    states.set(target, outcome);
    timingsMs[`distro:${target}`] = ms;
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
  let winGitOk = false;
  if (quick) {
    // quick profile: the trust check needs interop git.exe and is advice, not
    // a prerequisite — a scoped run leaves it out.
  } else {
  const winGitVersion = await run(["git.exe", "--version"]);
  if (!winGitVersion.ok) {
    check("git.win-safe", "info", "Windows git trust", "Windows git not found through interop — WSL change review uses the distro fallback; host (C:\\...) workspaces would need git for their own review");
  } else {
    winGitOk = true;
    const entries = (await run(["git.exe", "config", "--global", "--get-all", "safe.directory"])).stdout.split(/\r?\n/).filter(Boolean);
    const whitelisted = entries.some((entry) => /wsl\.localhost/i.test(entry));
    check("git.win-safe", whitelisted ? "ok" : "warn", "Windows git trust",
      whitelisted ? `the \\\\wsl.localhost share is whitelisted (${entries.length} entr${entries.length === 1 ? "y" : "ies"})`
        : "Windows git does not trust the \\\\wsl.localhost share; WSL workspaces' change review silently degrades to file-tool edits",
      whitelisted ? undefined : 'on Windows: git config --global --add safe.directory "//wsl.localhost/*", then restart the app');
  }
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
    console.log(doctorT("sessions.title"));
    if (running.length === 0) {
      console.log(doctorT("sessions.none"));
    } else {
      for (const d of running) {
        const report = (await inDistro(d, STALE_SCOPE_REPORT)).stdout.trim();
        const lines = report === "none" || report.length === 0 ? [] : report.split(/\r?\n/);
        if (report === "none") {
          console.log(`  ${d}  ${doctorT("sessions.no-user-manager")}`);
          continue;
        }
        if (lines.length === 0) {
          console.log(`  ${d}  ${doctorT("sessions.no-scopes")}`);
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
  if (!options.json && !quick) {
    const portScript = procNetScript();
    let anyPorts = false;
    for (const d of running) {
      const answer = await inDistro(d, portScript);
      const ports = parseListeningPorts(answer.stdout);
      if (ports.length === 0) continue;
      anyPorts = true;
      const ip = ((await inDistro(d, "hostname -I")).stdout ?? "").trim().split(/\s+/)[0] ?? "";
      console.log("");
      console.log(doctorT("ports.title", { distro: d }));
      for (const port of ports) {
        console.log(`  :${port}  http://localhost:${port}   (LAN: netsh interface portproxy add v4tov4 listenport=${port} listenaddress=0.0.0.0 connectport=${port} connectaddress=${ip})`);
      }
    }
    if (!anyPorts && running.length > 0) console.log(doctorT("ports.none"));
  }

  // ---- peers ---------------------------------------------------------------
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
  // ---- effective configuration (verdict inputs, reported) ------------------
  check("config.effective", configRecognized ? "ok" : "info", "Effective configuration",
    configRecognized
      ? `distro=${effective.distro}, sessionSandbox=${effective.sessionSandbox}, agentBackend=${effective.agentBackend}, sandbox=${effective.sandbox}, maskWindowsDrive=${effective.maskWindowsDrive}, interopVisibility=${effective.interopVisibility || "unset"} — from ${effective.source}${effective.overrides.length > 0 ? ` (overrides: ${effective.overrides.join("; ")})` : ""}`
      : "the shipped preset rows were not recognized; the conservative defaults apply (sessionSandbox: true, so a missing systemd blocks) — see docs/CONFIGURATION.md");

  phase("profiles");
  // ---- profile-patch trap and deprecated keys ------------------------------
  const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
  const profilesDir = join(dshHome, "profiles");
  if (!existsSync(profilesDir)) {
    check("config.deprecated", "info", "Deprecated keys", `no profile layers under ${profilesDir} to scan`);
  } else {
    /** @type {string[]} */
    const trapped = [];
    /** @type {string[]} */
    const retired = [];
    /** @type {string[]} */
    const emptyDistro = [];
    let seen = 0;
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const patch = join(profilesDir, entry.name, "cordis.patch.yml");
      if (!existsSync(patch)) continue;
      seen += 1;
      const text = readFileSync(patch, "utf8");
      // Only a ROOT-level `- id:` entry is a patch by id. An entry indented
      // under `insert:` adds a real top-level row (the probe profiles do
      // exactly that), so matching it would warn about a patch that is not
      // there.
      if (/^-\s*id:\s*(wsl-shell|wsl-fs)\s*(?:#.*)?$/m.test(text)) trapped.push(entry.name);
      if (/substrate:\s*["']?share["']?/m.test(text)) retired.push(entry.name);
      if (/^\s*distro:\s*['"]['"]\s*$/m.test(text)) emptyDistro.push(entry.name);
    }
    if (trapped.length > 0) {
      check("config.preset-trap", "warn", "Nested row patches",
        `root-level id patch for a nested row in: ${trapped.join(", ")} — the wsl-shell / wsl-fs entry matches no top-level row and is ignored`,
        'those names are profile directories; to add these providers at the top level use "- insert:", and to change the preset\'s nested rows replace the whole preset-wsl row. Run "pnpm run preset --check <patch>" for the complete block, or see docs/CONFIGURATION.md#configure-wsl-shell-and-wsl-fs');
    }
    if (retired.length > 0) {
      check("config.deprecated", "fail", "Deprecated keys", `substrate: share in ${retired.join(", ")} — the plugin refuses to boot this profile, because serving the 9p share is exactly what it must not do`, "delete the substrate line (the agent substrate is the only shape), then restart the session — docs/MIGRATION.md#keeping-the-old-spelling");
    } else if (emptyDistro.length > 0) {
      check("config.deprecated", "info", "Deprecated keys", `distro: '' in ${emptyDistro.join(", ")} — empty has meant auto (follow the workspace) since 0.12.0, not WSL's default`, `pin distro: default on both rows to keep the old posture — docs/MIGRATION.md#case-study-distro-0120`);
    } else {
      check("config.deprecated", "ok", "Deprecated keys", `${seen} profile patch(es) scanned, none carry retired keys`);
    }
  }

  phase("config");
  // ---- fixes (the loop ends in a re-verified report) ------------------------
  // Safe, reversible actions only, per target: the sweep the session preflight
  // runs, a purge of the plugin-owned agent cache, and — outside
  // `--fix-owned` — package installation behind --install plus an explicit
  // confirmation and the Windows git whitelist behind the same gate. Every
  // fix is followed by a fresh probe of what it claims to have fixed — the
  // revised check carries the after state (so the verdict at the end is the
  // post-fix verdict, ready or the remaining blockers), and the fix.* row
  // narrates the before → after transition. A distro that never became
  // reachable has no state to fix.
  if (options.fix) {
    /** Replace one pushed check's verdict in place — the fix loop's "after".
     * @param {string} id - the check id.
     * @param {string | undefined} distro - the distro scope, for distro-scoped ids.
     * @param {Partial<Check>} patch - the fields to revise. */
    const reviseCheck = (/** @type {string} */ id, /** @type {string | undefined} */ distro, /** @type {Partial<Check>} */ patch, /** @type {string | undefined} */ title = undefined) => {
      const entry = checks.find((entry) => entry.id === id && (distro === undefined || entry.distro === distro));
      if (entry === undefined) {
        // A check the first pass never pushed (its prerequisite was missing)
        // still deserves an after-state row once the fix created it.
        if (title === undefined) return;
        const created = /** @type {Check} */ ({ id, status: "ok", title: title ?? id, detail: "", ...(distro === undefined ? {} : { distro }) });
        Object.assign(created, patch);
        checks.push(created);
        return;
      }
      Object.assign(entry, patch);
    };
    for (const [target, state] of states) {
      if (!state.reachable) continue;
      const fixCheck = (/** @type {string} */ id, /** @type {Check["status"]} */ status, /** @type {string} */ title, /** @type {string | undefined} */ detail = undefined, /** @type {string | undefined} */ remedy = undefined) => {
        checks.push({ id, status, title, ...(detail === undefined ? {} : { detail }), ...(remedy === undefined ? {} : { remedy }), distro: target });
      };
      if (state.stale > 0) {
        const swept = await inDistro(target, sessionScopeSweepScript());
        const afterReport = (await inDistro(target, STALE_SCOPE_REPORT)).stdout.trim();
        const afterLines = afterReport === "none" || afterReport.length === 0 ? [] : afterReport.split(/\r?\n/);
        const afterStale = afterLines.filter((line) => /\sstale(\s|$)/.test(line)).length;
        const fixed = swept.ok && afterStale === 0;
        fixCheck("fix.scopes", fixed ? "ok" : "warn", "Swept stale scopes", `${state.stale} stale before → ${afterStale} after`, fixed ? undefined : `systemctl --user list-units 'dsh-wsl-*.scope' inside "${target}"`);
        reviseCheck("runtime.scopes", target, afterLines.length === 0
          ? { status: "info", detail: "none (the fix above swept them)", remedy: undefined }
          : { status: afterStale === 0 ? "ok" : "warn", detail: `${afterLines.length} live, ${afterStale} stale after the fix`, remedy: afterStale === 0 ? undefined : "--fix stops them; they are safe to stop when no agent process is inside" });
      }
      if (state.cacheBad > 0) {
        // The cache is plugin-owned and content-addressed: every entry is
        // re-extracted from the shipped agent on the next command, so purging
        // it is safe and reversible. The after-state is a fresh inventory, and
        // a failed handshake is re-probed because a corrupt cache is one of its
        // causes.
        const purged = await inDistro(target, 'rm -rf "$HOME/.cache/dsh-wsl/agent"');
        const afterRaw = (await inDistro(target, CACHE_REPORT)).stdout.trim();
        const afterLines = afterRaw === "none" || afterRaw.length === 0 ? [] : afterRaw.split(/\r?\n/).filter((line) => line.trim().length > 0);
        const afterBad = afterLines.filter((line) => line.startsWith("noexec ") || line.startsWith("broken ")).length;
        const fixed = purged.ok && afterBad === 0;
        const cacheTone = fixed ? "ok" : effective.agentBackend === "native" ? "fail" : "warn";
        fixCheck("fix.cache", fixed ? "ok" : "warn", "Purged the agent cache",
          `${state.cacheEntries} cached, ${state.cacheBad} invalid before → ${afterLines.length} cached, ${afterBad} invalid after`,
          fixed ? undefined : `rm -rf ~/.cache/dsh-wsl/agent inside "${target}"; the next command repopulates it`);
        reviseCheck("agent.cache", target, afterLines.length === 0
          ? { status: cacheTone === "ok" ? "info" : cacheTone, detail: "empty after the fix (the next command repopulates it)", remedy: undefined }
          : { status: cacheTone, detail: `${afterLines.length} cached binary(ies)${afterBad > 0 ? `, ${afterBad} not executable or not runnable after the fix` : ""}`, remedy: fixed ? undefined : `rm -rf ~/.cache/dsh-wsl/agent inside "${target}"; the next command repopulates it` });
        const handshakeEntry = checks.find((entry) => entry.id === "agent.handshake" && entry.distro === target);
        const scriptPath = state.agentScriptDistro;
        const scriptProbe = scriptPath !== undefined && existsSync(join(ROOT, "agent", "wsl-agent.sh"))
          ? (await inDistro(target, `[ -f "${scriptPath}" ] && printf yes || printf no`)).stdout.trim()
          : "no";
        if (handshakeEntry !== undefined && handshakeEntry.status === "fail" && scriptProbe === "yes" && scriptPath !== undefined) {
          const again = await probeResident(target, scriptPath, wslExe, join(ROOT, "agent", "wsl-agent.sh"));
          reviseCheck("agent.handshake", target, again.ok && again.digestMatches
            ? { status: "ok", detail: `re-probed after the cache purge: pid ${again.pid}, protocol ${PROTOCOL_VERSION}, digest matches`, remedy: undefined }
            : { detail: `re-probed after the cache purge: ${again.ok ? "digest MISMATCH — the distro reads a different script than this package" : again.detail}` });
        }
      }
      if (state.bwrapPath.length === 0 && !options.fixOwned) {
        const install = installRemedy(target, state.family);
        if (!options.install) {
          fixCheck("fix.install", "info", "Package installation", "not attempted", "re-run with --fix --install (and --yes for a non-interactive run)");
        } else if (!(await confirm(doctorT("confirm.install", { packages: PACKAGES, distro: target }), options.yes))) {
          fixCheck("fix.install", "info", "Package installation", "declined", install);
        } else {
          const command = INSTALL[state.family] ?? INSTALL["apt-get"] ?? `apt-get install -y ${PACKAGES}`;
          const installed = await run([WSL, "-d", target, "-u", "root", "--", "sh", "-c", command]);
          const bwrapAfter = (await inDistro(target, "command -v bwrap")).stdout.trim();
          const usableAfter = bwrapAfter.length > 0 ? (await inDistro(target, "bwrap --ro-bind / / -- true")).ok : false;
          const done = installed.ok && bwrapAfter.length > 0;
          fixCheck("fix.install", done ? "ok" : "warn", "Package installation", installed.ok
            ? `completed; bubblewrap ${bwrapAfter.length > 0 ? `now at ${bwrapAfter}${usableAfter ? ", a read-only profile runs" : ", but the read-only profile still fails"}` : "STILL MISSING after the install"}`
            : "failed; see the output above", done ? undefined : install);
          reviseCheck("sandbox.bwrap", target, bwrapAfter.length > 0
            ? { status: "ok", detail: bwrapAfter, remedy: undefined }
            : { status: "fail", detail: "still missing after the install", remedy: install });
          reviseCheck("sandbox.bwrap-usable", target, bwrapAfter.length > 0
            ? { status: usableAfter ? "ok" : "fail", detail: usableAfter ? "a read-only profile runs" : "installed but the read-only profile failed", remedy: usableAfter ? undefined : "the kernel likely disables unprivileged user namespaces; reinstalling will not help — see docs/LIMITATIONS.md" }
            : {}, "bubblewrap usability");
        }
      }
    }
    // B3: the Windows git whitelist is user-scoped and reversible — the same
    // confirmation gate as a package install, then a fresh probe. Without a
    // TTY the fix declines loudly instead of silently doing nothing. A
    // `--fix-owned` run leaves Windows-owned state alone.
    if (winGitOk && !options.fixOwned) {
      const gitEntry = checks.find((entry) => entry.id === "git.win-safe");
      if (gitEntry !== undefined && gitEntry.status === "warn") {
        if (await confirm('Add "//wsl.localhost/*" to the Windows git safe.directory whitelist?', options.yes)) {
          const added = await run(["git.exe", "config", "--global", "--add", "safe.directory", "//wsl.localhost/*"]);
          const entries = (await run(["git.exe", "config", "--global", "--get-all", "safe.directory"])).stdout.split(/\r?\n/).filter(Boolean);
          const whitelisted = entries.some((entry) => /wsl\.localhost/i.test(entry));
          reviseCheck("git.win-safe", undefined, whitelisted
            ? { status: "ok", detail: `the \\wsl.localhost share is whitelisted (${entries.length} entr${entries.length === 1 ? "y" : "ies"}) — it was untrusted before this run's fix`, remedy: undefined }
            : {});
          checks.push({ id: "fix.git-trust", status: added.ok && whitelisted ? "ok" : "warn", title: "Git trust whitelist", detail: added.ok && whitelisted ? 'added "//wsl.localhost/*" to the Windows git safe.directory whitelist' : "the add did not take effect; see the output above", remedy: added.ok && whitelisted ? undefined : 'on Windows: git config --global --add safe.directory "//wsl.localhost/*", then restart the app' });
        } else {
          checks.push({ id: "fix.git-trust", status: "info", title: "Git trust whitelist", detail: "declined", remedy: 're-run with --fix (and --yes for a non-interactive run), or on Windows: git config --global --add safe.directory "//wsl.localhost/*"' });
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
 * @param {string} [wslExe] - the wsl.exe to spawn.
 * @param {string} [hostPath] - the same script as this host names it, for the digest (defaults to scriptPath).
 * @returns {Promise<{ ok: true, pid: number, digestMatches: boolean } | { ok: false, detail: string }>} the verdict, with the pid on success.
 */
function probeResident(distro, scriptPath, wslExe = WSL, hostPath = scriptPath) {
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
      const expected = createHash("sha256").update(readFileSync(hostPath)).digest("hex");
      finish({ ok: true, pid: Number(pid), digestMatches: digest === expected });
    });
    child.on("error", (error) => finish({ ok: false, detail: error.message }));
    child.on("close", () => {
      if (settled) return;
      // 'exit' can fire before the stdio pipes are drained — the HELLO sits
      // in the pipe while the parent-side buffer looks empty (a loaded host
      // widens the window). 'close' fires after the streams flush, so the
      // harvest here sees everything the agent wrote.
      const first = buffered.split("\n")[0]?.trim() ?? "";
      if (first.startsWith("HELLO|")) {
        const [kind, name, version, digest, pid] = first.split("|");
        if (kind === "HELLO" && name === AGENT_NAME && Number(version) === PROTOCOL_VERSION) {
          const expected = createHash("sha256").update(readFileSync(hostPath)).digest("hex");
          finish({ ok: true, pid: Number(pid), digestMatches: digest === expected });
          return;
        }
      }
      finish({ ok: false, detail: `agent exited before its HELLO (${buffered.trim().slice(0, 80)})` });
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
 * @param {string[]} residentArgv - the argv that starts the resident: `["sh", script]` for the shell agent, `[binaryPath]` for the native one.
 * @param {string} [wslExe] - the wsl.exe to spawn.
 * @param {string} [expectedDigest] - the sha256 the HELLO self-digest must equal (the native cache directory's name); empty for the shell agent, whose digest is compared separately.
 * @returns {Promise<{ execOk: boolean, execDetail: string, fsOk: boolean, fsDetail: string, digestMatches: boolean, fsError: { op: number, reason: string, message: string } | undefined }>} the leg verdicts.
 */
function runSmokeLegs(distro, residentArgv, wslExe = WSL, expectedDigest = "") {
  return new Promise((settle) => {
    const child = spawn(wslExe, ["-d", distro, "--exec", ...residentArgv], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, WSL_UTF8: "1" },
    });
    let settled = false;
    let buffer = "";
    let helloSeen = false;
    /** Whether the HELLO self-digest matches the expected one (true when none is expected). */
    let digestMatches = true;
    /** The first refused batch operation, decoded — the panel's actual cause. */
    let fsError = /** @type {{ op: number, reason: string, message: string } | undefined} */ (undefined);
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
        settle({ digestMatches, fsError, ...value });
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
          if (expectedDigest.length > 0 && parsed.digest !== expectedDigest) digestMatches = false;
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
    child.on("close", () => {
      childGone = true;
      if (settled) return;
      // The same pipe-ordering race the handshake probe guards: a buffered
      // HELLO counts even when the data event has not fired yet.
      if (!helloSeen && buffer.includes("HELLO|")) {
        helloSeen = true;
        helloResolve?.(true);
      }
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
      const fsOk = fsbParsed.type === "result" && fsbParsed.exitCode === 0 && payload.includes("OK 1") && payload.includes("OK 2");
      // A refused batch answers `BAD <op>|<reason>|<base64 message>` inside
      // the RES payload. Decode it here so the report names the cause instead
      // of printing base64 at the user.
      if (!fsOk && fsbParsed.type === "result") {
        const bad = /^BAD (\d+)\|([a-z]+)\|([A-Za-z0-9+/=]+)/.exec(payload);
        if (bad !== null) {
          let message = "";
          try {
            message = Buffer.from(bad[3] ?? "", "base64").toString("utf8").trim();
          } catch {
            // Undecodable payload: the raw head below still names the op.
          }
          fsError = { op: Number(bad[1] ?? 0), reason: bad[2] ?? "io", message };
        }
      }
      const rmId = "smoke-cleanup";
      const rmLine = await request(rmId, encodeExecFrame({ id: rmId, cwd: "/tmp", argv: ["rm", "-rf", dir], timeoutMs: 15_000, maxOutputBytes: 4096 }));
      const rmParsed = parseAgentLine(rmLine);
      const cleanupOk = rmParsed.type === "result" && rmParsed.exitCode === 0;
      const fsDetail = fsOk
        ? `stat + list over ${dir} answered one batch round trip${cleanupOk ? "; the dir is removed" : `; CLEANUP FAILED — ${dir} is left behind`}`
        : fsbParsed.type === "result"
          ? fsError === undefined
            ? `exit ${fsbParsed.exitCode}: ${payload.slice(0, 120)}${cleanupOk ? "" : `; cleanup failed, ${dir} is left behind`}`
            : `operation ${fsError.op} (${fsError.reason}): ${fsError.message.slice(0, 160) || payload.slice(0, 120)}${cleanupOk ? "" : `; cleanup failed, ${dir} is left behind`}`
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
 * @returns {Promise<{ ok: boolean, flaked: boolean, detail: string }>} the fence verdict.
 */
async function runSandboxSmoke(distro) {
  const dirAnswer = await askDistro(distro, 'd=$(mktemp -d /tmp/dsh-doctor-smoke-XXXXXXXX) && printf %s "$d"');
  const dir = dirAnswer.stdout.trim();
  if (dir.length === 0) return { ok: false, flaked: !dirAnswer.ok && dirAnswer.flaked, detail: "the temp dir for the fence leg could not be created" };
  const prefix = bwrapArgvPrefix({ mode: "workspace-write", workspaceRoot: dir }, {});
  const inside = await run([WSL, "-d", distro, "--exec", ...prefix, "sh", "-c", 'printf ok > "$0" && cat "$0"', `${dir}/inside`]);
  const outside = await run([WSL, "-d", distro, "--exec", ...prefix, "sh", "-c", 'printf no > "$0" 2>/dev/null', "/etc/dsh-doctor-smoke-refuse"]);
  const cleanup = await askDistro(distro, `rm -rf "${dir}"`);
  const flaked = [inside, outside, cleanup].some((answer) => isFlake(answer));
  const insideOk = inside.ok && inside.stdout.trim() === "ok";
  const outsideRefused = !outside.ok;
  const ok = insideOk && outsideRefused;
  return {
    ok,
    flaked,
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
 * @param {{ distros?: string[], config?: EffectiveConfig, timingsMs?: Record<string, number>, scope?: { sections: string[], quick: boolean }, bundle?: { path: string, redact: boolean, manifest: { name?: string, version?: string, peerDependencies?: Record<string, string> } } }} [runInfo] - the target distros, the effective configuration, the run scope, the per-phase wall clock, and the bundle request.
 * @returns {number} 0 when the verdict is `ready`, 1 when `blocked`.
 */
function report(checks, options, runInfo = {}) {
  // Scoped run: keep only the requested sections. `distro.reachable` is the
  // transport gate every scoped run probes, so it always stays — a scoped
  // verdict answers "is this distro healthy *within the requested scope*".
  const wantedSections = runInfo.scope === undefined ? null : new Set(runInfo.scope.sections);
  /** @param {{ id: string }} entry - the check. @returns {boolean} whether it survives the scope. */
  const inScope = (entry) => wantedSections === null || wantedSections.has(sectionOf(entry.id)) || entry.id === "distro.reachable";
  const scoped = checks.filter(inScope);
  const stamped = scoped.map((entry) => ({
    ...entry,
    blocksFirstCommand: entry.status === "fail",
  }));
  /** @param {string} status - the status to count. @returns {number} how many checks carry it. */
  const count = (status) => stamped.filter((entry) => entry.status === status).length;
  const summary = { ok: count("ok"), warn: count("warn"), fail: count("fail"), info: count("info"), skipped: count("skipped"), unknown: count("unknown") };
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
      ...(runInfo.scope === undefined ? {} : { scope: runInfo.scope }),
      checks: stamped,
      summary,
      distroVerdicts,
      verdict,
      blockers,
      ...(runInfo.timingsMs === undefined ? {} : { timingsMs: runInfo.timingsMs }),
    }, null, 2));
  } else {
    console.log(doctorT("app"));
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
      const mark = doctorT(`mark.${entry.status}`);
      console.log(`  ${mark}  ${entry.title}${entry.detail === undefined ? "" : ` — ${entry.detail}`}`);
      if (entry.remedy !== undefined) console.log(doctorT("fix.prefix", { remedy: entry.remedy }));
    }
    const summaryLine = doctorT("summary", { ok: summary.ok, warn: summary.warn, fail: summary.fail, info: summary.info })
      + (summary.skipped > 0 ? doctorT("summary.skipped", { n: summary.skipped }) : "")
      + (summary.unknown > 0 ? doctorT("summary.unknown", { n: summary.unknown }) : "");
    console.log(`\n${summaryLine}`);
    const timingLine = Object.entries(runInfo.timingsMs ?? {}).filter(([key]) => key !== "total").map(([key, ms]) => `${key} ${ms}ms`).join(", ");
    if (timingLine.length > 0) console.log(doctorT("timings", { line: timingLine, total: runInfo.timingsMs?.total ?? "?" }));
    if (verdict === "ready") console.log(targets.length === 1 && targets[0] !== undefined
      ? doctorT("verdict.ready.one", { target: targets[0] })
      : targets.length > 1
        ? doctorT("verdict.ready.many", { targets: targets.join(", ") })
        : doctorT("verdict.ready.none"));
    else console.log(doctorT("verdict.blocked", { blockers: blockers.join(", ") }));
    if (summary.fail > 0 || summary.skipped > 0) console.log(doctorT("fix.hint"));
  }
  if (runInfo.bundle !== undefined) {
    const bundle = {
      kind: "dsh-plugin-wsl-env doctor bundle",
      contentNote: "the doctor report, the plugin and peer versions, and the effective configuration. No file contents, no environment variables, no telemetry — attach this file to a setup report.",
      plugin: { name: runInfo.bundle.manifest.name ?? "dsh-plugin-wsl-env", version: runInfo.bundle.manifest.version ?? "", peers: runInfo.bundle.manifest.peerDependencies ?? {} },
      ...(runInfo.config === undefined ? {} : { config: runInfo.config }),
      report: { schemaVersion: 2, generatedAt: new Date().toISOString(), checks: stamped, summary, distroVerdicts, verdict, blockers, ...(runInfo.timingsMs === undefined ? {} : { timingsMs: runInfo.timingsMs }) },
      redacted: runInfo.bundle.redact ? "home and DSH paths replaced with <redacted-*>" : false,
    };
    let payload = `${JSON.stringify(bundle, null, 2)}\n`;
    if (runInfo.bundle.redact) {
      const homeReal = homedir();
      const dshReal = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homeReal, ".dsh");
      payload = payload.split(homeReal).join("<redacted-home>").split(dshReal).join("<redacted-dsh-home>");
    }
    writeFileSync(runInfo.bundle.path, payload);
    console.log(doctorT("bundle.written", { path: runInfo.bundle.path, bytes: payload.length, redacted: runInfo.bundle.redact ? doctorT("bundle.redacted") : "" }));
  }
  return verdict === "blocked" ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("node scripts/doctor.mjs [distro] [--all] [--json] [--quick] [--sections host,sandbox,session,conf,net,agent] [--fix] [--fix-owned] [--install] [--yes] [--read-only] [--bundle <path>] [--redact] [--locale <tag>]");
  } else {
    process.exitCode = await main(options);
  }
}
