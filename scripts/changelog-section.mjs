/**
 * Print one CHANGELOG section, so a release can reuse it as its notes.
 *
 *   node scripts/changelog-section.mjs            # the package.json version
 *   node scripts/changelog-section.mjs 0.1.2      # a named version
 *   node scripts/changelog-section.mjs --out release-notes.md
 *
 * The workflow writes the result to a file for `gh release create --notes-file`;
 * the manual path in docs/RELEASING.md prints it. It exits non-zero when the section
 * is missing, which is what catches "version bumped, changelog forgotten".
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const out = outIndex === -1 ? undefined : args[outIndex + 1];
const version = args.find((arg) => !arg.startsWith("--") && arg !== out) ?? pkg.version;

const text = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const heading = `## [${version}]`;
const start = text.indexOf(heading);
if (start === -1) {
  console.error(`FAIL  CHANGELOG.md has no "${heading}" section`);
  process.exit(1);
}

const rest = text.slice(start);
const next = rest.indexOf("\n## [", heading.length);
const section = (next === -1 ? rest : rest.slice(0, next)).trim();

// The heading itself is not repeated: `gh release create --title` already carries it.
const body = section.split("\n").slice(1).join("\n").trim();

if (out === undefined) {
  console.log(body);
} else {
  writeFileSync(join(ROOT, out), `${body}\n`);
  console.log(`PASS  wrote ${out} from CHANGELOG.md ${heading} (${body.length} chars)`);
}
