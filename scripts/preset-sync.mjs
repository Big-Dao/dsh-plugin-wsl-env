#!/usr/bin/env node
/**
 * Preset parity: the `preset-wsl` row against the harness's standard preset.
 *
 * `cordis.patch.yml` carries a derived copy of the shipped standard preset
 * (`packages/bundle/web-app/presets/standard.patch.yml`): `preset-wsl` is the
 * standard mode's rows mounted on the distro's shell and filesystem. A row the
 * app adds to its own preset is missing from every WSL session until that copy
 * is regenerated, and nothing in this repository used to notice. The rc.2 line
 * added the office tool, the bundled skill root and a subagent switch, and the
 * copy stayed on rc.1 while the peer pins moved (#82).
 *
 * The comparison is data, not text. Both files are parsed with the include's
 * own `!!js` dialect, the upstream rows pass through exactly the changes the
 * copy documents — the plugin's own rows, and the shell-tool choice the copy
 * fixes where the shipped preset derives it from `process.platform` — and the
 * result is compared with `preset-wsl` row by row, in order, nested groups
 * included.
 *
 *   node scripts/preset-sync.mjs [--upstream <standard.patch.yml>] [--json]
 *
 * With no `--upstream`, the upstream side is the committed snapshot of the
 * line the dev pins name (`test/fixtures/standard.patch.dsh-<version>.yml`):
 * the pinned dependency tree ships no preset of its own, so the snapshot is
 * what ties the comparison to one reproducible line. `--upstream` takes any
 * harness tree's file, to preview a newer line before the pins move. Exit 0 at
 * parity, 1 on a difference or a missing snapshot, 2 on a usage error.
 *
 * To move to a newer line: replace the snapshot with that tag's file, run
 * this script, regenerate `preset-wsl` (see the comment above the row), and
 * raise the pins in the same commit.
 *
 * @module dsh-plugin-wsl/scripts/preset-sync
 */
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import yaml from "js-yaml";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PATCH = join(ROOT, "cordis.patch.yml");
const FIXTURES = join(ROOT, "test", "fixtures");
/** The dev dependency whose exact pin names the harness line the gates verify. */
export const LINE_PEER = "@deepseek-ai/dsh-fs";

/**
 * A parsed patch list, as the include's patch algorithm takes it.
 * @typedef {NonNullable<Parameters<typeof applyEntryPatches>[1]>} PatchList
 */

/**
 * One plugin row as parsed data; every key is narrowed where it is read.
 * @typedef {Record<string, unknown>} Row
 */

/**
 * The plugin's own rows, which the shipped preset does not have.
 * @typedef {object} OwnRows
 * @property {readonly string[]} first - the distro providers, first in the preset so every later row sees them.
 * @property {Readonly<Record<string, readonly string[]>>} after - rows this plugin adds directly after a shipped row, keyed by that row's id.
 */

/** @type {OwnRows} */
export const OWN_ROWS = Object.freeze({
  first: Object.freeze(["wsl-shell", "wsl-fs"]),
  after: Object.freeze({ "tool-jobs": Object.freeze(["wsl-doctor-tool"]) }),
});
/**
 * Row keys the copy fixes where the shipped preset derives them from
 * `process.platform`, keyed by row id.
 * @type {Readonly<Record<string, Readonly<Record<string, unknown>>>>}
 */
export const FIXED_KEYS = Object.freeze({
  "tool-bash": Object.freeze({ disabled: false }),
  "tool-pwsh": Object.freeze({ disabled: true }),
});
/** @type {Readonly<Record<string, string>>} */
const OWN_NAMES = Object.freeze({
  "wsl-shell": "dsh-plugin-wsl-env/shell",
  "wsl-fs": "dsh-plugin-wsl-env/fs",
  "wsl-doctor-tool": "dsh-plugin-wsl-env/wsl-doctor-tool",
});

/** An exact version: no range operator, an optional prerelease or build. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
/** How much of a value a difference quotes. */
const SHOW_LIMIT = 100;

/**
 * Whether a value is a plain object (a parsed row, config or isolate map).
 * @param {unknown} value - any parsed value.
 * @returns {value is Row} true for a non-array object.
 */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parse one patch file with the include's own dialect, so `!!js` nodes stay
 * expression text instead of failing the load.
 * @param {string} text - the file's content.
 * @returns {PatchList} the parsed patch entries.
 * @throws {Error} when the file is not a top-level array.
 */
export function parsePatch(text) {
  const parsed = /** @type {unknown} */ (yaml.load(text, { schema: entryListSchema }));
  if (!Array.isArray(parsed)) throw new Error("preset-sync: the file is not a top-level YAML array of loader patch entries");
  return /** @type {PatchList} */ (parsed);
}

/**
 * The rows a patch file's `insert` lists contribute, composed the way the app
 * mounts it. The entries that target rows by id are the app's business — this
 * plugin's layer disables shipped services it replaces — so their "not found"
 * warnings over an empty base are expected and dropped.
 * @param {PatchList} patches - the parsed file.
 * @returns {Row[]} the inserted rows, in file order.
 */
function composedRows(patches) {
  const composed = applyEntryPatches([], structuredClone(patches), () => {});
  return composed.map((entry) => /** @type {Row} */ (/** @type {unknown} */ (entry)));
}

/**
 * One preset declaration's plugin rows.
 * @param {PatchList} patches - the parsed patch file.
 * @param {string} id - the preset row's id (`preset-standard`, `preset-wsl`).
 * @returns {{ row: Row, plugins: Row[] }} the row and its `config.plugins`.
 * @throws {Error} when the row is absent or carries no plugin list.
 */
export function presetOf(patches, id) {
  const row = composedRows(patches).find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`preset-sync: no "- id: ${id}" row`);
  const config = row.config;
  if (!isObject(config) || !Array.isArray(config.plugins)) throw new Error(`preset-sync: the "${id}" row carries no config.plugins list`);
  return { row, plugins: config.plugins.filter(isObject) };
}

/**
 * A slot the copy must hold: one shipped row (with the fixed keys applied), or
 * one of the plugin's own rows.
 * @typedef {object} Slot
 * @property {string} id - the row id.
 * @property {boolean} own - whether the plugin authored the row.
 * @property {Row} [row] - the shipped row's expected content; absent for an own row.
 */

/**
 * The slots a preset's plugin list must hold, derived from the shipped rows.
 * @param {Row[]} upstream - the shipped preset's rows.
 * @param {boolean} [withOwn] - whether the plugin's own rows belong to this
 *   list; they do at the preset's top level only.
 * @returns {Slot[]} the expected slots, in order.
 */
export function expectedSlots(upstream, withOwn = false) {
  /** @type {Slot[]} */
  const slots = [];
  if (withOwn) for (const id of OWN_ROWS.first) slots.push({ id, own: true });
  for (const row of upstream) {
    const id = String(row.id);
    const fixed = FIXED_KEYS[id];
    slots.push({ id, own: false, row: fixed === undefined ? row : { ...row, ...fixed } });
    if (withOwn) for (const own of OWN_ROWS.after[id] ?? []) slots.push({ id: own, own: true });
  }
  return slots;
}

/**
 * Whether a parsed value is a `!!js` expression node.
 * @param {unknown} value - any parsed value.
 * @returns {value is Row & { __jsExpr: string }} true for an expression node.
 */
function isExpression(value) {
  return isObject(value) && typeof value.__jsExpr === "string";
}

/**
 * One value as a difference quotes it; an expression reads as `!!js <text>`.
 * @param {unknown} value - any parsed value.
 * @returns {string} its JSON, capped.
 */
function show(value) {
  const text = value === undefined
    ? "(absent)"
    : (JSON.stringify(value, (_key, item) => (isExpression(item) ? `!!js ${item.__jsExpr}` : item)) ?? String(value));
  if (text.length <= SHOW_LIMIT) return text;
  // A capped quoted value keeps its closing quote, so the ellipsis reads as "more of the same".
  return `${text.slice(0, SHOW_LIMIT)}…${text.startsWith("\"") ? "\"" : ""}`;
}

/**
 * Differences between two parsed values, each reported under its path.
 *
 * `isDeepStrictEqual` already tells two `!!js` nodes apart by expression text,
 * so a rewritten expression surfaces as a difference at `….__jsExpr`.
 *
 * @param {string} path - where the value sits, for the message.
 * @param {unknown} expected - the upstream side.
 * @param {unknown} actual - what `preset-wsl` holds.
 * @returns {string[]} the differences; empty when the values agree.
 */
export function valueDiffs(path, expected, actual) {
  if (isDeepStrictEqual(expected, actual)) return [];
  // An expression is one value: its text is what a difference quotes.
  if (isExpression(expected) || isExpression(actual)) {
    return [`${path}: upstream has ${show(expected)}, preset-wsl has ${show(actual)}`];
  }
  if (isObject(expected) && isObject(actual)) {
    /** @type {string[]} */
    const diffs = [];
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) diffs.push(`${path}.${key}: missing (upstream has ${show(expected[key])})`);
      else diffs.push(...valueDiffs(`${path}.${key}`, expected[key], actual[key]));
    }
    for (const key of Object.keys(actual)) {
      if (!(key in expected)) diffs.push(`${path}.${key}: not upstream's (preset-wsl has ${show(actual[key])})`);
    }
    return diffs;
  }
  if (Array.isArray(expected) && Array.isArray(actual) && expected.length === actual.length) {
    return expected.flatMap((item, index) => valueDiffs(`${path}[${index}]`, item, actual[index]));
  }
  return [`${path}: upstream has ${show(expected)}, preset-wsl has ${show(actual)}`];
}

/**
 * The comparable content of one row: everything but `id`, and — for a group —
 * but the nested rows, which are compared as slots of their own.
 * @param {Row} row - a plugin row.
 * @returns {Row} the comparable keys.
 */
function comparable(row) {
  const { id: _id, config, ...rest } = row;
  return Array.isArray(config) ? rest : { ...rest, config };
}

/**
 * A group's nested rows.
 * @param {Row} row - a plugin row.
 * @returns {Row[]} the rows in its list config; empty for a plain row.
 */
function nested(row) {
  return Array.isArray(row.config) ? row.config.filter(isObject) : [];
}

/**
 * Differences between the slots a copy must hold and the rows it does hold.
 * @param {string} path - where the list sits, for the message.
 * @param {Slot[]} expected - the derived slots.
 * @param {Row[]} actual - the copy's rows.
 * @returns {string[]} the differences; empty at parity.
 */
export function slotDiffs(path, expected, actual) {
  /** @type {string[]} */
  const diffs = [];
  const actualById = new Map(actual.map((row) => [String(row.id), row]));
  for (const [index, slot] of expected.entries()) {
    const row = actualById.get(slot.id);
    if (row === undefined) {
      const after = expected[index - 1]?.id;
      diffs.push(`${path}: "${slot.id}" is missing (${slot.own ? "the plugin's own row" : "an upstream row"}${after === undefined ? "" : `, after "${after}"`})`);
      continue;
    }
    if (slot.own) {
      const name = OWN_NAMES[slot.id];
      if (name !== undefined && row.name !== name) diffs.push(`${path}.${slot.id}.name: the plugin's own row is "${name}", not ${show(row.name)}`);
      continue;
    }
    const shipped = /** @type {Row} */ (slot.row);
    diffs.push(...valueDiffs(`${path}.${slot.id}`, comparable(shipped), comparable(row)));
    if (shipped.group === true || row.group === true) diffs.push(...slotDiffs(`${path}.${slot.id}.config`, expectedSlots(nested(shipped)), nested(row)));
  }
  const wanted = expected.map((slot) => slot.id);
  const expectedIds = new Set(wanted);
  /** @type {string[]} */
  const strangers = [];
  for (const row of actual) {
    if (!expectedIds.has(String(row.id))) strangers.push(`${path}: "${String(row.id)}" is neither an upstream row nor one of the plugin's own`);
  }
  diffs.push(...strangers);
  // Order is worth reporting only once both sides hold the same rows: a missing
  // or stranger row already moves everything after it.
  if (diffs.length === strangers.length && strangers.length === 0) {
    const order = actual.map((row) => String(row.id));
    const first = order.findIndex((id, index) => id !== wanted[index]);
    if (first >= 0) diffs.push(`${path}: row order differs at "${order[first]}": upstream has "${wanted[first]}" there`);
  }
  return diffs;
}

/**
 * Whether `preset-wsl` is the shipped standard preset plus the documented
 * changes.
 *
 * Two things differ by design and are checked, not compared. The identity:
 * the preset is `wsl`, keeps the shipped `order`, and carries the display
 * metadata the mode selector reads. The realm: every row mounts inside one
 * `wsl-env` group, which isolates `shell` and `fs` so the preset's tools see
 * the distro's; the shipped rows are compared inside that group.
 *
 * @param {{ upstream: PatchList, actual: PatchList }} files - the two parsed files.
 * @returns {string[]} the differences; empty at parity.
 * @throws {Error} when either file carries no preset row.
 */
export function parityDiffs({ upstream, actual }) {
  const shipped = presetOf(upstream, "preset-standard");
  const copy = presetOf(actual, "preset-wsl");
  /** @type {string[]} */
  const diffs = [];
  const shippedConfig = shipped.row.config;
  const config = copy.row.config;
  /** @type {Row} */
  const copyConfig = isObject(config) ? config : {};
  if (copyConfig.id !== "wsl") diffs.push(`preset-wsl.config.id: must be "wsl", not ${show(copyConfig.id)}`);
  if (!isDeepStrictEqual(copyConfig.order, isObject(shippedConfig) ? shippedConfig.order : undefined)) {
    diffs.push(`preset-wsl.config.order: upstream has ${show(isObject(shippedConfig) ? shippedConfig.order : undefined)}, preset-wsl has ${show(copyConfig.order)}`);
  }
  for (const key of ["name", "description"]) {
    const value = copyConfig[key];
    if (typeof value !== "string" || value.trim().length === 0) diffs.push(`preset-wsl.config.${key}: the mode selector needs a non-empty string`);
  }
  const [realm, ...others] = copy.plugins;
  if (realm === undefined || others.length > 0) {
    diffs.push(`preset-wsl.config.plugins: must hold exactly one row, the "wsl-env" group every row mounts inside`);
    return diffs;
  }
  if (realm.name !== "cordis:group" || realm.group !== true) {
    diffs.push(`preset-wsl.config.plugins.wsl-env: must be a cordis:group (name ${show(realm.name)}, group ${show(realm.group)})`);
  }
  if (!isObject(realm.isolate) || realm.isolate.shell !== true || realm.isolate.fs !== true) {
    diffs.push(`preset-wsl.config.plugins.wsl-env.isolate: must isolate shell and fs, not ${show(realm.isolate)}`);
  }
  diffs.push(...slotDiffs("wsl-env", expectedSlots(shipped.plugins, true), nested(realm)));
  return diffs;
}

/**
 * The harness line the dev pins name.
 * @param {{ devDependencies?: Record<string, unknown> }} manifest - this package's manifest.
 * @returns {string} the exact version `LINE_PEER` is pinned at.
 * @throws {Error} when the pin is missing or not an exact version.
 */
export function pinnedLine(manifest) {
  const pin = manifest.devDependencies?.[LINE_PEER];
  if (typeof pin !== "string" || !EXACT_VERSION.test(pin)) {
    throw new Error(`preset-sync: devDependencies["${LINE_PEER}"] must be an exact version, not ${JSON.stringify(pin)}`);
  }
  return pin;
}

/**
 * The committed snapshot of one line's standard preset.
 * @param {string} line - the harness version.
 * @returns {string} the snapshot's path.
 */
export const snapshotPath = (line) => join(FIXTURES, `standard.patch.dsh-${line}.yml`);

/**
 * Where the upstream side of a comparison comes from.
 * @typedef {object} Upstream
 * @property {string} label - what to print as the compared line.
 * @property {string} path - the file the rows were read from.
 */

/**
 * Resolve the upstream side: the file given, else the pinned line's snapshot.
 * @param {string | undefined} file - the `--upstream` argument.
 * @returns {Upstream} the resolved source.
 * @throws {Error} when no snapshot exists for the pinned line.
 */
export function resolveUpstream(file) {
  if (file !== undefined) return { label: basename(file), path: resolve(file) };
  const line = pinnedLine(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")));
  const path = snapshotPath(line);
  if (!existsSync(path)) {
    throw new Error(`preset-sync: no snapshot of the standard preset for the pinned line ${line}. Copy that tag's packages/bundle/web-app/presets/standard.patch.yml to ${relative(ROOT, path)} and regenerate preset-wsl.`);
  }
  return { label: `dsh-${line}`, path };
}

/** A command-line mistake: reported without a stack trace, exit 2. */
class UsageError extends Error {}

/**
 * Run the comparison.
 * @param {string[]} argv - the arguments after the script path.
 * @returns {number} the exit code.
 * @throws {UsageError} on an unknown argument; {Error} when a file cannot be read.
 */
export function main(argv) {
  /** @type {string | undefined} */
  let upstreamFile;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--upstream") {
      const file = argv[index + 1];
      if (file === undefined) throw new UsageError("--upstream needs a file");
      upstreamFile = file;
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new UsageError(`unknown argument "${arg}"`);
    }
  }
  const upstream = resolveUpstream(upstreamFile);
  const differences = parityDiffs({
    upstream: parsePatch(readFileSync(upstream.path, "utf8")),
    actual: parsePatch(readFileSync(PATCH, "utf8")),
  });
  if (json) {
    process.stdout.write(`${JSON.stringify({ upstream: upstream.label, differences }, null, 2)}\n`);
  } else if (differences.length === 0) {
    console.log(`ok: preset-wsl is the standard preset of ${upstream.label} plus the documented changes`);
  } else {
    console.log(`preset-wsl differs from the standard preset of ${upstream.label} (${differences.length}):`);
    for (const difference of differences) console.log(`  - ${difference}`);
  }
  return differences.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
