/**
 * Style and packaging checks, with no dependencies.
 *
 * This repository deliberately ships no devDependencies, so there is no linter and
 * no formatter. What the editor config promises, and what npm will actually pack,
 * is checked here instead:
 *
 *   1. LF line endings, a final newline, no trailing whitespace (Markdown excepted,
 *      where two trailing spaces are a hard line break), no tabs in code or YAML,
 *      and no UTF-8 BOM — the rules `.editorconfig` states.
 *   2. Every `files` entry in `package.json` still matches tracked content, so a
 *      renamed file cannot silently drop out of the published tarball.
 *   3. Every `exports` subpath still points at a file that exists.
 *   4. Exactly ONE npm readme candidate sits at the package root. With two
 *      candidates, the readme that ends up in the registry is not something to
 *      rely on: 0.1.1 published `README.md` and `README.zh.md` side by side and the
 *      packument came back with `readmeFilename: README.zh.md`, so the npm page
 *      rendered Chinese. Neither explanation fits: the npm CLI's own selection
 *      (`@npmcli/package-json/lib/normalize.js`, `glob('{README,README.*}')` plus
 *      `/\.m?a?r?k?d?o?w?n$/i/`) does not even match a `.md` name, and the tarball
 *      listed README.md first. Whatever the registry does, one candidate removes the
 *      question, and this check keeps it removed.
 *
 *   node test/style.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .sort();

/**
 * Tracked files that are text as far as these checks are concerned.
 * @param {string} file - the tracked path, relative to the repo root.
 * @returns {string|undefined} its text, or undefined for binary content.
 */
function readText(file) {
  const buffer = readFileSync(join(ROOT, file));
  if (buffer.includes(0)) return undefined;
  return buffer.toString("utf8");
}

/** @type {Array<{name: string, offenders: string[]}>} */
const results = [];
/**
 * @param {string} name - the check's name.
 * @param {string[]} offenders - the offending paths.
 * @param {string} [total] - the count line to print on success.
 */
function check(name, offenders, total) {
  results.push({ name, offenders });
  if (offenders.length === 0) {
    console.log(`PASS  ${name}${total === undefined ? "" : ` (${total})`}`);
    return;
  }
  console.log(`FAIL  ${name}`);
  for (const offender of offenders.slice(0, 6)) console.log(`      ${offender}`);
  if (offenders.length > 6) console.log(`      ... and ${offenders.length - 6} more`);
}

const BOM = "\uFEFF";
const CRLF_EXTENSIONS = [".js", ".mjs", ".json", ".yml", ".yaml", ".sh", ".md", ".editorconfig", ""];
/** @param {string} file - the tracked path. @returns {boolean} whether it is code/config. */
const isSource = (file) => [".js", ".mjs", ".json", ".yml", ".yaml"].includes(extension(file));
/** @param {string} file - the tracked path. @returns {boolean} whether it is Markdown. */
const isMarkdown = (file) => file.endsWith(".md");
/**
 * @param {string} file - the tracked path.
 * @returns {string} its extension, dot included, or "" when it has none.
 */
function extension(file) {
  const base = file.slice(file.lastIndexOf("/") + 1);
  return base.startsWith(".") ? base : base.includes(".") ? base.slice(base.indexOf(".")) : "";
}

/** @type {Map<string, string>} */
const texts = new Map();
for (const file of tracked) {
  const text = readText(file);
  if (text !== undefined) texts.set(file, text);
}

check(
  "line endings are LF",
  [...texts].filter(([file]) => CRLF_EXTENSIONS.includes(extension(file)) && texts.get(file)?.includes("\r\n")).map(([file]) => file),
);
check(
  "every text file ends with a newline",
  [...texts].filter(([, text]) => text.length > 0 && !text.endsWith("\n")).map(([file]) => file),
  `${texts.size} files`,
);
check(
  "no trailing whitespace (Markdown excluded)",
  [...texts]
    .filter(([file, text]) => !isMarkdown(file) && text.split("\n").some((line) => /[ \t]+$/.test(line)))
    .map(([file]) => file),
);
check(
  "no tab characters in code or YAML",
  [...texts].filter(([file, text]) => isSource(file) && text.includes("\t")).map(([file]) => file),
);
check(
  "no UTF-8 BOM",
  [...texts].filter(([, text]) => text.startsWith(BOM)).map(([file]) => file),
);

// package.json is a tracked text file, so the map holds it.
const pkg = JSON.parse(/** @type {string} */ (texts.get("package.json")));

/**
 * Translate one `files` entry into a matcher over tracked paths (posix).
 * @param {string} entry - one `package.json` `files` entry.
 * @returns {RegExp} the matcher over tracked paths.
 */
function filesEntryToRegExp(entry) {
  // `?` is escaped rather than expanded: no entry uses it as a wildcard, and a
  // literal avoids colliding with the `?` inside the (?:.*/)? fragment inserted below.
  const pattern = entry
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?");
  return new RegExp(`^${pattern}$`);
}

const unmatched = pkg.files.filter((/** @type {string} */ entry) => !tracked.some((file) => filesEntryToRegExp(entry).test(file)));
check(
  "every \"files\" entry matches tracked content",
  unmatched.map((/** @type {string} */ entry) => `"${entry}" matches nothing`),
  `${pkg.files.length} entries`,
);

/**
 * Every file target one `exports` entry names: a bare string entry, or the
 * condition values of an object entry (`types`, `default`, ...).
 * @param {string | Record<string, string>} target - one `exports` value.
 * @returns {string[]} its file targets.
 */
function exportTargets(target) {
  return typeof target === "string" ? [target] : Object.values(target);
}

const missingTargets = Object.entries(pkg.exports)
  .flatMap(([subpath, target]) =>
    exportTargets(/** @type {string | Record<string, string>} */ (target))
      .filter((file) => !tracked.includes(file.replace(/^\.\//, "")))
      .map((file) => `${subpath} -> ${file}`));
check("every \"exports\" target exists", missingTargets, `${Object.keys(pkg.exports).length} subpaths`);

// A JavaScript export without its `types` condition is a surface downstream
// cannot see; each `.js` target names its declaration as the sibling file the
// build emits, so the two can only drift visibly.
const missingTypes = Object.entries(pkg.exports)
  .map(([subpath, target]) => {
    const conditions = typeof target === "string" ? { default: target } : /** @type {Record<string, string>} */ (target);
    const main = conditions.default;
    if (typeof main !== "string" || !main.endsWith(".js")) return undefined;
    const expected = main.replace(/\.js$/, ".d.ts");
    return conditions.types === expected ? undefined : `${subpath}: ${main} needs "types": "${expected}"`;
  })
  .filter((line) => typeof line === "string");
check("every JavaScript export carries its declaration", missingTypes);

const rootFiles = tracked.filter((file) => !file.includes("/"));
const readmeCandidates = rootFiles.filter((file) => /^readme(\..*)?$/i.test(file));
check(
  "exactly one readme candidate at the package root",
  readmeCandidates.length === 1 ? [] : [`found ${readmeCandidates.length}: ${readmeCandidates.join(", ") || "none"}`],
  readmeCandidates.join(", "),
);

const failed = results.filter((result) => result.offenders.length > 0).length;
console.log(`\n${results.length - failed}/${results.length} style and packaging checks pass`);
if (failed > 0) process.exitCode = 1;
