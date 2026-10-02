/**
 * Fail unless the git tag being built is exactly `v<package.json version>`.
 *
 *   node scripts/check-release-tag.mjs v0.1.2
 *
 * The workflow calls it with `$GITHUB_REF_NAME`; the manual release path in
 * docs/RELEASING.md calls it with the tag about to be pushed. Tagging one version
 * and publishing another is the mistake this exists to make impossible.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));
const tag = process.argv[2] ?? "";

if (tag === "") {
  console.error("usage: node scripts/check-release-tag.mjs <tag>");
  process.exit(2);
}
if (tag !== `v${pkg.version}`) {
  console.error(`FAIL  tag ${tag} does not match package.json version ${pkg.version}`);
  process.exit(1);
}
console.log(`PASS  tag ${tag} matches ${pkg.name}@${pkg.version}`);
