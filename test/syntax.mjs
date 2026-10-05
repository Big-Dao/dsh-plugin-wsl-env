/**
 * Parse-check every shipped module with `node --check`, and check the
 * schemastery surface the modules call — the static members and the members
 * chained onto a factory's instance — against the surface the pinned peer has.
 *
 * The unit tests cover `lib/index.js`'s guard chain directly since the DSH
 * peers landed in devDependencies (test/provider.test.mjs). Still syntax-only
 * here: `lib/picker.js`, `lib/auto-preset.js` and `lib/shell-env.js`, which
 * also import DSH peers,
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
 * The static list is only half the surface. A chain member is called on the
 * INSTANCE a factory returns — `z.natural().min(1)` — and the same import-time
 * TypeError applies there: the `watchMaxDepth` key of the M10 fix called
 * `z.number().int()` in `WslFileSystem.Config`, the pinned schemastery has no
 * `int` on any schema instance (`z.natural()` is the pinned spelling of
 * "integer >= 0"), and the Desktop app again reported `wsl-shell` and `wsl-fs`
 * and nothing else. The second list is that peer's instance prototype — every
 * factory's instance shares it — read from the same 3.18.4:
 *
 *     collapse comment default deprecated description disabled experimental
 *     extra hidden i18n link loose max min pattern push required role set
 *     simplify step toJSON toString volatile
 *
 * The chained half is read with a balanced walk rather than a regex, so nested
 * call arguments, string literals and template interpolations cannot end a
 * chain early or splice two statements into one.
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

/**
 * Members every schemastery instance publishes — the chain half of the surface;
 * see the module doc for provenance. Every factory's instance shares one
 * prototype, so one list serves `z.number().min(0)` and `z.natural().max(4)`
 * alike; a member absent here fails at import exactly like an absent static.
 */
const SCHEMASTERY_INSTANCE_SURFACE = new Set([
  "collapse",
  "comment",
  "default",
  "deprecated",
  "description",
  "disabled",
  "experimental",
  "extra",
  "hidden",
  "i18n",
  "link",
  "loose",
  "max",
  "min",
  "pattern",
  "push",
  "required",
  "role",
  "set",
  "simplify",
  "step",
  "toJSON",
  "toString",
  "volatile",
]);

const modules = readdirSync(LIB)
  .filter((name) => name.endsWith(".js"))
  .sort();

/** Source with comments blanked, so a mention in prose is not read as a call. */
/**
 * @param {string} name - the module's file name under `lib/`.
 * @returns {string} its source with comments blanked.
 */
function codeOf(name) {
  return readFileSync(join(LIB, name), "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1 ");
}

/**
 * Index just past the `)` that closes the group opening at `start` — the caller
 * points `start` at a `(`. Walks the three string literals and template
 * interpolations so a quoted paren cannot close the group early; an
 * interpolation's `${...}` is code again, so it recurses through the same
 * rules. A file whose groups never balance (truncation) ends at `code.length`.
 * @param {string} code - the source to walk.
 * @param {number} start - the index of the opening `(`.
 * @returns {number} the index just past the matching `)`.
 */
function endOfGroup(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    } else if (ch === '"' || ch === "'") {
      i = endOfQuoted(code, i, ch);
    } else if (ch === "`") {
      i = endOfTemplate(code, i);
    }
  }
  return code.length;
}

/**
 * Index of the closing quote at or after `start`; a trailing escape is tolerated.
 * @param {string} code - the source to walk.
 * @param {number} start - the index of the opening quote.
 * @param {string} quote - the quote character to close on.
 * @returns {number} the index of the closing quote, or `code.length`.
 */
function endOfQuoted(code, start, quote) {
  for (let i = start + 1; i < code.length; i += 1) {
    if (code[i] === "\\") {
      i += 1;
    } else if (code[i] === quote) {
      return i;
    }
  }
  return code.length;
}

/**
 * Index of the closing backtick at or after `start`, interpolations included.
 * @param {string} code - the source to walk.
 * @param {number} start - the index of the opening backtick.
 * @returns {number} the index of the closing backtick, or `code.length`.
 */
function endOfTemplate(code, start) {
  for (let i = start + 1; i < code.length; i += 1) {
    if (code[i] === "\\") {
      i += 1;
    } else if (code[i] === "`") {
      return i;
    } else if (code[i] === "$" && code[i + 1] === "{") {
      i = endOfBraces(code, i + 1);
    }
  }
  return code.length;
}

/**
 * Index of the `}` closing the `${` whose `{` sits at `start`, code rules inside.
 * @param {string} code - the source to walk.
 * @param {number} start - the index of the `${`'s `{`.
 * @returns {number} the index of the matching `}`.
 */
function endOfBraces(code, start) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === '"' || ch === "'") {
      i = endOfQuoted(code, i, ch);
    } else if (ch === "`") {
      i = endOfTemplate(code, i);
    }
  }
  return code.length;
}

/**
 * The members chained after each `z.<factory>(...)` call, as one flat list per
 * match site: `z.natural().min(1).default(1)` reads `["min", "default"]`. The
 * lookbehind keeps `wsl.exe (`-shaped prose and `a.z.foo()` out; the balanced
 * walk keeps nested-call arguments from ending a chain early.
 * @param {string} code - the source to walk.
 * @returns {string[][]} one flat member list per match site.
 */
function chainedMembers(code) {
  /** @type {string[][]} */
  const found = [];
  const opener = /(?<![\w$."'])z\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let open;
  while ((open = opener.exec(code)) !== null) {
    let at = endOfGroup(code, opener.lastIndex - 1);
    const chain = [];
    for (;;) {
      const next = /^\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(code.slice(at, at + 200));
      if (next === null) break;
      chain.push(next[1]);
      at = endOfGroup(code, at + next[0].length - 1);
    }
    if (chain.length > 0) found.push(chain);
  }
  return found;
}

let failed = 0;
for (const name of modules) {
  try {
    execFileSync(process.execPath, ["--check", join(LIB, name)], { stdio: "pipe" });
    console.log(`PASS  lib/${name} parses`);
  } catch (error) {
    failed += 1;
    const detail = String((/** @type {{stderr?: unknown}} */ (error)).stderr ?? (/** @type {Error} */ (error)).message).trim().split("\n").slice(0, 6).join("\n      ");
    console.log(`FAIL  lib/${name}\n      ${detail}`);
  }
}

console.log(`\n${modules.length - failed}/${modules.length} modules parse`);

/** @type {Map<string, string[]>} */
const members = new Map();
for (const name of modules) {
  for (const match of codeOf(name).matchAll(/\bz\.([A-Za-z_$][A-Za-z0-9_$]*)/gu)) {
    const member = match[1];
    const callers = members.get(member) ?? [];
    if (!callers.includes(name)) callers.push(name);
    members.set(member, callers);
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

/** @type {Map<string, string[]>} */
const chainedFiles = new Map();
for (const name of modules) {
  for (const chain of chainedMembers(codeOf(name))) {
    for (const member of chain) {
      const callers = chainedFiles.get(member) ?? [];
      if (!callers.includes(name)) callers.push(name);
      chainedFiles.set(member, callers);
    }
  }
}

const chainUnknown = [...chainedFiles].filter(([member]) => !SCHEMASTERY_INSTANCE_SURFACE.has(member));
for (const [member, files] of chainUnknown) {
  failed += 1;
  console.log(`FAIL  .${member}() is not on the pinned schemastery instance surface\n      called from ${files.map((name) => `lib/${name}`).join(", ")}`);
}

const chained = [...chainedFiles.keys()].sort();
console.log(`\n${chainUnknown.length === 0 ? "PASS" : "FAIL"}  chained members used: ${chained.join(", ")}`);
console.log(`${chained.length - chainUnknown.length}/${chained.length} chained members exist on the pinned peer`);
if (failed > 0) process.exitCode = 1;
