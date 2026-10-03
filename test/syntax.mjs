/**
 * Parse-check every shipped module with `node --check`, and check the
 * schemastery surface the modules call against the surface the pinned peer has.
 *
 * The unit tests cannot cover `lib/index.js`, `lib/picker.js`, `lib/auto-preset.js`
 * or `lib/shell-env.js`: they import DSH peers that a bare checkout does not have,
 * so importing them throws `ERR_MODULE_NOT_FOUND` before any assertion runs. That
 * leaves a real gap — the five rounds of misdiagnosis recorded in the archived record's §15.4
 * (docs/archive/engineering-record.zh.md)
 * were caused by a bad insertion into `lib/shell.js`'s import graph, and the only
 * symptom was a `never started` from a *different* layer.
 *
 * This closes the syntax half of that gap. It does NOT evaluate the module, so a
 * temporal-dead-zone `ReferenceError` of that §15.4 kind still slips through:
 * running the probe or the app remains the only way to catch evaluation errors.
 *
 * One evaluation error is worth catching statically because it is silent and it
 * takes down exactly the rows that load `lib/index.js` — the preset's `wsl-shell`
 * and `wsl-fs`. A Config schema is a class field, so a member the peer does not
 * publish is called while the module is still being imported; the loader logs the
 * `TypeError` and leaves the row with no fiber, which the preset audit reports as
 * `never started`, naming neither the member nor the file. `z.enum([...])` in
 * `WslFileSystem.Config` did exactly that: the pinned schemastery publishes no
 * `enum`, and the Desktop app reported those two rows and nothing else. The list
 * below is that peer's own surface, read from `@deepseek-ai/schemastery` 3.18.4
 * (the version every `@deepseek-ai/dsh-*` peer pins as `~3.18.4`):
 *
 *     ValidationError any array arrayBuffer bitset boolean const date dict
 *     extend from function intersect is lazy natural never number object
 *     percent regExp resolve string transform tuple union
 *
 *   node test/syntax.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "lib");

/** Members the pinned schemastery publishes; see the module doc for provenance. */
const SCHEMASTERY_SURFACE = new Set([
  "ValidationError",
  "any",
  "array",
  "arrayBuffer",
  "bitset",
  "boolean",
  "const",
  "date",
  "dict",
  "extend",
  "from",
  "function",
  "intersect",
  "is",
  "lazy",
  "natural",
  "never",
  "number",
  "object",
  "percent",
  "regExp",
  "resolve",
  "string",
  "transform",
  "tuple",
  "union",
]);

const modules = readdirSync(LIB)
  .filter((name) => name.endsWith(".js"))
  .sort();

/** Source with comments blanked, so a mention in prose is not read as a call. */
function codeOf(name) {
  return readFileSync(join(LIB, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ");
}

let failed = 0;
for (const name of modules) {
  try {
    execFileSync(process.execPath, ["--check", join(LIB, name)], { stdio: "pipe" });
    console.log(`PASS  lib/${name} parses`);
  } catch (error) {
    failed += 1;
    const detail = String(error.stderr ?? error.message).trim().split("\n").slice(0, 6).join("\n      ");
    console.log(`FAIL  lib/${name}\n      ${detail}`);
  }
}

console.log(`\n${modules.length - failed}/${modules.length} modules parse`);

const members = new Map();
for (const name of modules) {
  for (const match of codeOf(name).matchAll(/\bz\.([A-Za-z_$][A-Za-z0-9_$]*)/gu)) {
    const member = match[1];
    if (!members.has(member)) members.set(member, []);
    if (!members.get(member).includes(name)) members.get(member).push(name);
  }
}

const unknown = [...members].filter(([member]) => !SCHEMASTERY_SURFACE.has(member));
for (const [member, files] of unknown) {
  failed += 1;
  console.log(`FAIL  z.${member} is not on the pinned schemastery surface\n      called from ${files.map((name) => `lib/${name}`).join(", ")}`);
}

const called = [...members.keys()].sort();
console.log(`\n${unknown.length === 0 ? "PASS" : "FAIL"}  schemastery members used: ${called.join(", ")}`);
console.log(`${called.length - unknown.length}/${called.length} members exist on the pinned peer`);
if (failed > 0) process.exitCode = 1;
