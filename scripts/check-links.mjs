/**
 * Check that every relative Markdown link in the user-facing docs resolves.
 *
 * P0.4's link promise: a reader following a relative link from any Markdown
 * file at the package root — README, CONTRIBUTING (both languages), SECURITY,
 * SUPPORT, CODE_OF_CONDUCT, AGENTS — or from `docs/**` should land on a file
 * in this checkout. Absolute URLs, `mailto:` links and pure in-page anchors
 * are out of scope — they are someone else's availability, not a repository
 * invariant.
 *
 * `docs/archive/` is excluded on purpose: those files are historical snapshots
 * whose links were written repo-root-relative in their original context, and
 * rewriting an archive to satisfy a link checker would falsify the record.
 *
 *   node scripts/check-links.mjs
 *
 * Runs from the package root (the npm script's cwd).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Root Markdown files the check leaves alone. `CHANGELOG.md`'s relative links
 * belong to the releases they were written in, and `canary-summary.md` is
 * what the peer-canary writes for a step summary, not a maintained document.
 * @type {Set<string>}
 */
const ROOT_SKIPPED = new Set(["CHANGELOG.md", "canary-summary.md"]);
/** Every other Markdown file at the package root, in directory order. */
const ROOT_MARKDOWN = readdirSync(ROOT).filter((name) => name.endsWith(".md") && !ROOT_SKIPPED.has(name));

/**
 * Every Markdown file under `directory`, excluding archives and dot dirs.
 * @param {string} directory - the absolute directory to walk.
 * @returns {string[]} absolute file paths.
 */
function walk(directory) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path === join(ROOT, "docs", "archive")) continue;
      found.push(...walk(path));
    } else if (entry.name.endsWith(".md")) {
      found.push(path);
    }
  }
  return found;
}

const files = [...ROOT_MARKDOWN.map((name) => join(ROOT, name)), ...walk(join(ROOT, "docs"))];

/** @type {string[]} */
const broken = [];
let checked = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const links = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = links.exec(text)) !== null) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = target.split("#")[0];
    if (path === "") continue;
    checked += 1;
    const resolved = resolve(dirname(file), decodeURIComponent(path));
    if (!existsSync(resolved)) broken.push(`${file.slice(ROOT.length + 1)}: ${target}`);
  }
}

for (const line of broken) console.log(`BROKEN  ${line}`);

// Bilingual pairing: every `.zh.md` file must have its counterpart next to
// it. The docs map fixes the direction — the Chinese side is the authority
// and the English side follows it — so a missing pair means a half-shipped
// doc. A document that is Chinese-only by decision is named here with its
// reason. The list is held to its word: an exemption whose counterpart has
// appeared since has outlived itself, and is reported rather than honoured.
const CHINESE_ONLY = new Map([
  // The requirements register ships, and both architectures link it. An
  // English copy would be a second matrix for `check-requirements.mjs` to
  // keep in step, so the register stays Chinese-only on purpose.
  ["docs/REQUIREMENTS.zh.md", "the requirements register is Chinese-only by decision"],
]);
// The repo rule keeps one README at the package root and its Chinese
// translation under `docs/`, so that pair maps across directories.
const ENGLISH_COUNTERPART = (name) =>
  name === "docs/README.zh.md" ? "README.md" : name.replace(/\.zh\.md$/, ".md");
// Pairing compares forward-slash names on every platform: on Windows the
// walker yields backslash separators, which would miss both the CHINESE_ONLY
// exemptions and the cross-directory README pair (root README.md <>
// docs/README.zh.md) and report false breakage.
const unpaired = files
  .map((file) => file.slice(ROOT.length + 1).split(sep).join("/"))
  .filter((name) => name.endsWith(".zh.md") && !CHINESE_ONLY.has(name))
  .filter((name) => !existsSync(join(ROOT, ENGLISH_COUNTERPART(name))))
  .map((name) => `${name}: no English counterpart`);
for (const line of unpaired) console.log(`BROKEN  ${line}`);
const staleExemptions = [...CHINESE_ONLY]
  .filter(([name]) => existsSync(join(ROOT, ENGLISH_COUNTERPART(name))))
  .map(([name, reason]) => `${name}: exempt from pairing (${reason}) but ${ENGLISH_COUNTERPART(name)} exists — drop the exemption`);
for (const line of staleExemptions) console.log(`BROKEN  ${line}`);

const failures = broken.length + unpaired.length + staleExemptions.length;
console.log(`${checked} relative links checked in ${files.length} files (${ROOT_MARKDOWN.length} at the root); ${failures} broken`);
process.exit(failures === 0 ? 0 : 1);
