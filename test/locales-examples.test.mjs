/**
 * The shipped locale metadata and the example patch layers.
 *
 * The runtime refusal/remedy catalogs live in `src/messages.ts`, where the `zh`
 * table is type-checked against the `en` union, so those keys cannot drift.
 * The per-row locale JSONs (auto-preset, picker, preflight, shell-env,
 * subprocess) are plain metadata with no such check: a missing `zh.json` or a
 * key present in one language only silently renders a raw key or English in a
 * Chinese UI.
 *
 * `examples/profile.cordis.patch.yml` is copied by hand and is not part of the
 * bundle: it must parse as a patch layer, must not repeat the plugin's own
 * rows, and every entry must be addressable. The real host rows are not in a
 * checkout, so this validates the layer's shape rather than the values.
 *
 *   node test/locales-examples.test.mjs
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALE = join(ROOT, "locale");
const EXAMPLES = join(ROOT, "examples");

/**
 * Flatten a catalog into leaf entries. Keys may themselves contain dots (the
 * doctor catalog does), so the path is display-only and the value is carried
 * directly.
 * @param {unknown} value - the parsed catalog.
 * @param {string} [prefix] - the display path so far.
 * @param {Array<[string, unknown]>} [out] - the accumulator.
 * @returns {Array<[string, unknown]>} leaf entries.
 */
function flatten(value, prefix = "", out = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    out.push([prefix, value]);
    return out;
  }
  for (const [key, child] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    flatten(child, prefix === "" ? key : `${prefix}.${key}`, out);
  }
  return out;
}

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/** @param {string} name @param {() => void | Promise<void>} fn */
const check = (name, fn) => checks.push([name, fn]);
/** @param {string} name @param {() => void | Promise<void>} fn */
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

check("every locale namespace ships both languages with the same keys", () => {
  /** @type {string[]} */
  const namespaces = [];
  for (const entry of readdirSync(LOCALE, { withFileTypes: true })) {
    if (entry.isDirectory()) namespaces.push(entry.name);
  }
  assert.ok(namespaces.length >= 5, `the row catalogs are present (found ${namespaces.join(", ")})`);
  for (const namespace of namespaces.sort()) {
    const en = JSON.parse(readFileSync(join(LOCALE, namespace, "en.json"), "utf8"));
    const zh = JSON.parse(readFileSync(join(LOCALE, namespace, "zh.json"), "utf8"));
    const enLeaves = flatten(en);
    const zhLeaves = new Map(flatten(zh));
    assert.deepEqual([...zhLeaves.keys()].sort(), enLeaves.map(([key]) => key).sort(), `locale/${namespace}: en and zh expose the same key paths`);
    for (const [key, enValue] of enLeaves) {
      const zhValue = zhLeaves.get(key);
      assert.equal(typeof enValue, "string", `locale/${namespace}: en ${key} is text`);
      assert.equal(typeof zhValue, "string", `locale/${namespace}: zh ${key} is text`);
      assert.ok(/** @type {string} */ (enValue).trim().length > 0, `locale/${namespace}: en ${key} is non-empty`);
      assert.ok(/** @type {string} */ (zhValue).trim().length > 0, `locale/${namespace}: zh ${key} is non-empty`);
    }
  }
});

check("the root client locale files agree on their keys", () => {
  const en = JSON.parse(readFileSync(join(LOCALE, "en.json"), "utf8"));
  const zh = JSON.parse(readFileSync(join(LOCALE, "zh.json"), "utf8"));
  assert.deepEqual(flatten(zh).map(([key]) => key).sort(), flatten(en).map(([key]) => key).sort(), "locale/en.json and locale/zh.json expose the same key paths");
});

check("every example patch parses, is addressable, and leaves the bundle rows alone", () => {
  const files = readdirSync(EXAMPLES).filter((name) => name.endsWith(".yml"));
  assert.ok(files.length > 0, "at least one example patch ships");
  // The rows this package's own patch inserts; an example that repeats one
  // would shadow the bundle's row by id.
  const bundle = /** @type {any[]} */ (yaml.load(readFileSync(join(ROOT, "cordis.patch.yml"), "utf8"), { schema: entryListSchema }));
  /** @type {Set<string>} */
  const bundleRowIds = new Set();
  /** @param {any[]} entries */
  const collect = (entries) => {
    for (const entry of entries ?? []) {
      if (typeof entry.id === "string") bundleRowIds.add(entry.id);
      if (typeof entry.name === "string" && entry.name.startsWith("dsh-plugin-wsl-env/")) bundleRowIds.add(entry.name);
      if (entry.group && Array.isArray(entry.config)) collect(entry.config);
    }
  };
  for (const layer of bundle) if (Array.isArray(layer.insert)) collect(layer.insert);

  for (const file of files) {
    const text = readFileSync(join(EXAMPLES, file), "utf8");
    const entries = yaml.load(text, { schema: entryListSchema });
    assert.ok(Array.isArray(entries), `${file}: a top-level patch array`);
    /** @type {Set<string>} */
    const seen = new Set();
    for (const entry of /** @type {any[]} */ (entries)) {
      assert.equal(typeof entry.id, "string", `${file}: every entry is addressable (id)`);
      assert.ok(!seen.has(entry.id), `${file}: id ${entry.id} appears once`);
      seen.add(entry.id);
      assert.ok(!bundleRowIds.has(entry.id), `${file}: ${entry.id} is the bundle's row, not a profile override`);
      if (entry.name !== undefined) assert.equal(typeof entry.name, "string", `${file}: ${entry.id} names a string`);
      if (entry.insert !== undefined) assert.ok(Array.isArray(entry.insert), `${file}: ${entry.id} insert is a list`);
    }
  }
});

for (const [name, fn] of checks) await runCheck(name, fn);
console.log(`\n${passed}/${checks.length} locale/example checks pass`);
if (passed < checks.length) process.exitCode = 1;
