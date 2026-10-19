/**
 * Check that every relative Markdown link in the user-facing docs resolves.
 *
 * P0.4's link promise: a reader following a relative link from README,
 * CONTRIBUTING, AGENTS or `docs/**` should land on a file in this checkout.
 * Absolute URLs, `mailto:` links and pure in-page anchors are out of scope —
 * they are someone else's availability, not a repository invariant.
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_FILES = ["README.md", "CONTRIBUTING.md", "AGENTS.md"];

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

const files = [
  ...TEXT_FILES.map((name) => join(ROOT, name)).filter((path) => existsSync(path)),
  ...walk(join(ROOT, "docs")),
];

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
console.log(`${checked} relative links checked in ${files.length} files; ${broken.length} broken`);
process.exit(broken.length === 0 ? 0 : 1);
