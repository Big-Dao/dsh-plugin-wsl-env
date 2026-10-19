#!/usr/bin/env node
/**
 * Print or write the complete `- id: preset-wsl` block (P0.3 / WSL-103).
 *
 * `wsl-shell` and `wsl-fs` live inside the `preset-wsl` row's `config.plugins`,
 * so a patch that targets them by id changes nothing — the loader logs
 * `patch: entry "wsl-shell" not found` and boots the shipped values. The only
 * route that works is replacing the whole `preset-wsl` row, which must carry
 * every nested plugin verbatim. This helper extracts that row from the shipped
 * `cordis.patch.yml`, applies the common edits, and can validate or write a
 * profile layer.
 *
 *   node scripts/profile-preset.mjs [--distro Debian] [--session-sandbox false]
 *        [--sandbox false] [--mask-windows-drive true] [--agent-backend native]
 *        [--out <profile/cordis.patch.yml>] [--check <file>] [--force]
 *
 * With no `--out`/`--check`, the block (with the edits) goes to stdout.
 * `--check` fails loudly on a nested id patch and prints the block to paste.
 * `--out` refuses to overwrite a patch that has no `preset-wsl` row unless
 * `--force`, so it cannot silently drop another override.
 *
 * @module dsh-plugin-wsl/scripts/profile-preset
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "cordis.patch.yml");
/** The shipped row's first line: four spaces deep inside the second `insert:` list. */
const ROW_START = /^ {4}- id: preset-wsl\s*$/m;

/**
 * Extract the shipped `preset-wsl` row, dedented to a top-level patch entry.
 * @param {string} source - the `cordis.patch.yml` text.
 * @returns {string} the block, without a trailing newline.
 */
export function presetBlock(source) {
  const match = ROW_START.exec(source);
  if (match === null) throw new Error("profile-preset: cordis.patch.yml carries no `- id: preset-wsl` row");
  return source.slice(match.index).replace(/^ {4}/gm, "").replace(/\s+$/u, "");
}

/**
 * The top-level nested-row ids a profile layer wrongly targets.
 * @param {string} text - a profile patch file.
 * @returns {string[]} the offending ids, in file order.
 */
export function nestedRowIds(text) {
  /** @type {string[]} */
  const found = [];
  for (const line of text.split("\n")) {
    const match = /^ {0,4}-\s*id:\s*(wsl-shell|wsl-fs)\s*$/u.exec(line);
    if (match?.[1] !== undefined && !found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * The line range of one nested row inside the block.
 * @param {string[]} lines - the block's lines.
 * @param {string} id - `wsl-shell` or `wsl-fs`.
 * @returns {{ start: number, end: number }} the range, end exclusive.
 */
function rowRange(lines, id) {
  const start = lines.findIndex((line) => line.trim() === `- id: ${id}`);
  if (start < 0) throw new Error(`profile-preset: the preset block carries no "${id}" row`);
  const indent = /^\s*/u.exec(lines[start] ?? "")?.[0].length ?? 0;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const head = /^(\s*)- id: /u.exec(lines[i] ?? "");
    if (head !== null && head[1]?.length === indent) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Set one config key inside one nested row, keeping every other line byte-for-byte.
 * @param {string[]} lines - the block's lines.
 * @param {string} id - the nested row.
 * @param {string} key - the config key.
 * @param {string} value - the rendered YAML value.
 */
function setKey(lines, id, key, value) {
  const { start, end } = rowRange(lines, id);
  const keyLine = new RegExp(`^(\\s*)${key}:\\s`, "u");
  for (let i = start; i < end; i += 1) {
    const match = keyLine.exec(lines[i] ?? "");
    if (match !== null) {
      lines[i] = `${match[1]}${key}: ${value}`;
      return;
    }
  }
  // Absent keys go under `distro:` (or `config:`), at the same depth as the
  // keys around them.
  const anchor = lines.slice(start, end).findIndex((line) => /^\s*distro:/u.test(line));
  const config = lines.slice(start, end).findIndex((line) => /^\s*config:\s*$/u.test(line));
  const offset = anchor >= 0 ? start + anchor : start + config;
  const base = /^\s*/u.exec(lines[offset] ?? "")?.[0] ?? "";
  // Alongside `distro:` the new key takes the same depth; under a bare
  // `config:` it takes the next level.
  const indent = anchor >= 0 ? base : `${base}  `;
  lines.splice(offset + 1, 0, `${indent}${key}: ${value}`);
}

/**
 * Apply the supported edits to a preset block.
 * @param {string} block - the block from {@link presetBlock}.
 * @param {{ distro?: string, sessionSandbox?: boolean, sandbox?: boolean, maskWindowsDrive?: boolean, agentBackend?: string }} edits - the edits.
 * @returns {string} the edited block.
 */
export function applyEdits(block, edits) {
  const lines = block.split("\n");
  const both = /** @type {Array<[string, string | undefined]>} */ ([
    ["distro", edits.distro],
    ["sessionSandbox", edits.sessionSandbox === undefined ? undefined : String(edits.sessionSandbox)],
    ["sandbox", edits.sandbox === undefined ? undefined : String(edits.sandbox)],
    ["maskWindowsDrive", edits.maskWindowsDrive === undefined ? undefined : String(edits.maskWindowsDrive)],
  ]);
  for (const [key, value] of both) {
    if (value === undefined) continue;
    setKey(lines, "wsl-shell", key, value);
    setKey(lines, "wsl-fs", key, value);
  }
  if (edits.agentBackend !== undefined) setKey(lines, "wsl-shell", "agentBackend", edits.agentBackend);
  return lines.join("\n");
}

/**
 * Parse the helper's arguments.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {{ edits: Record<string, string | boolean>, out?: string, check?: string, force: boolean }} the options.
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const edits = {};
  /** @type {{ edits: Record<string, string | boolean>, out?: string, check?: string, force: boolean }} */
  const options = { edits, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = inline ?? argv[++i] ?? "";
    if (flag === "--distro") {
      if (value.length === 0) throw new Error("profile-preset: --distro needs a name");
      edits.distro = value;
    } else if (flag === "--session-sandbox") edits.sessionSandbox = parseBoolean(flag, value);
    else if (flag === "--sandbox") edits.sandbox = parseBoolean(flag, value);
    else if (flag === "--mask-windows-drive") edits.maskWindowsDrive = parseBoolean(flag, value);
    else if (flag === "--agent-backend") {
      if (!["auto", "native", "shell"].includes(value)) throw new Error(`profile-preset: --agent-backend must be auto, native or shell (got "${value}")`);
      edits.agentBackend = value;
    } else if (flag === "--out") options.out = value;
    else if (flag === "--check") options.check = value;
    else if (flag === "--force") {
      options.force = true;
      i -= 1;
    } else if (flag === "--help" || flag === "-h") {
      console.log("node scripts/profile-preset.mjs [--distro NAME] [--session-sandbox true|false] [--sandbox true|false] [--mask-windows-drive true|false] [--agent-backend auto|native|shell] [--out FILE] [--check FILE] [--force]");
      process.exit(0);
    } else throw new Error(`profile-preset: unknown option "${arg}"`);
  }
  return options;
}

/**
 * Parse one boolean flag value.
 * @param {string} flag - the flag, for the error.
 * @param {string} value - the value.
 * @returns {boolean} the boolean.
 */
function parseBoolean(flag, value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`profile-preset: ${flag} takes true or false (got "${value}")`);
}

/**
 * Report a nested id patch with the exact block to paste.
 * @param {string} file - the profile patch.
 * @param {string[]} ids - the offending ids.
 * @param {string} block - the corrected block.
 * @returns {number} the exit status.
 */
function nestedFailure(file, ids, block) {
  console.error(`profile-preset: ${file} patches ${ids.map((id) => `"${id}"`).join(" and ")} by id.`);
  console.error("Those rows live inside preset-wsl's config.plugins; the loader ignores the");
  console.error("entry and boots the shipped values. Replace that entry with this complete");
  console.error("preset-wsl block (it also carries the edits you asked for):");
  console.error("");
  console.error(block);
  return 1;
}

/**
 * Run the helper.
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {number} the exit status.
 */
function main(argv) {
  const options = parseArgs(argv);
  const block = applyEdits(presetBlock(readFileSync(SOURCE, "utf8")), options.edits);

  if (options.check !== undefined) {
    if (!existsSync(options.check)) throw new Error(`profile-preset: no such patch: ${options.check}`);
    const ids = nestedRowIds(readFileSync(options.check, "utf8"));
    if (ids.length > 0) return nestedFailure(options.check, ids, block);
    console.log(`ok: ${options.check} has no nested wsl-shell/wsl-fs id patch`);
  }

  if (options.out !== undefined) {
    if (existsSync(options.out)) {
      const existing = readFileSync(options.out, "utf8");
      const ids = nestedRowIds(existing);
      if (ids.length > 0) return nestedFailure(options.out, ids, block);
      if (!existing.includes("- id: preset-wsl") && !options.force) {
        console.error(`profile-preset: ${options.out} exists and has no preset-wsl row; refusing to replace its other overrides (pass --force to overwrite)`);
        return 1;
      }
    }
    mkdirSync(dirname(options.out), { recursive: true });
    const temporary = join(tmpdir(), `dsh-preset-${process.pid}.yml`);
    writeFileSync(temporary, `${block}\n`);
    renameSync(temporary, options.out);
    console.log(`wrote ${options.out}`);
    return 0;
  }

  if (options.check === undefined) process.stdout.write(`${block}\n`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exitCode = 1;
  }
}
