/**
 * Check that the requirement traceability matrix (`docs/REQUIREMENTS.zh.md`)
 * only cites unit tests that exist and are wired into the gate chain.
 *
 * The matrix promises a verifier per requirement ("验证" column). That promise
 * is textual, so nothing stopped a test rename from leaving the matrix pointing
 * at a file that no longer exists, or a cited test from silently dropping out
 * of `test:unit` / `test:coverage`. This script turns both into gate failures.
 *
 * Checked per matrix row:
 *   - every cited `<name>.test.mjs` exists under `test/`;
 *   - every cited test is listed in BOTH the `test:unit` and the `test:coverage`
 *     npm scripts (the two lists are the shipped gates);
 *   - a row citing no test is reported (not failed): documented-manual and
 *     document-only rows are allowed, but the count must stay visible.
 *
 * `probe:` citations are NOT checked: probe names are prose aliases
 * (`probe:sandbox-shell` runs `test/probe/mode.sh`), so there is no mechanical
 * name mapping to enforce.
 *
 *   node scripts/check-requirements.mjs
 *
 * Runs from the package root (the npm script's cwd).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX = join(ROOT, "docs", "REQUIREMENTS.zh.md");
const TEST_DIR = join(ROOT, "test");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const problems = [];
const unverifiedRows = [];

const matrix = readFileSync(MATRIX, "utf8");
const rows = matrix.split("\n").filter((line) => /^\| R\d/.test(line));

const seen = new Map();
for (const row of rows) {
  const id = (row.match(/^\|\s*(R\d+)\s*\|/) ?? [])[1] ?? "?";
  if (seen.has(id)) problems.push(`duplicate requirement ID ${id} (first used by: "${seen.get(id)}")`);
  else seen.set(id, row.slice(0, 80));
}

for (const row of rows) {
  const id = (row.match(/^\|\s*(R\d+)\s*\|/) ?? [])[1] ?? "?";
  const cited = [...row.matchAll(/[a-z0-9.-]+\.test\.mjs/g)].map((m) => m[0]);

  if (cited.length === 0) {
    unverifiedRows.push(id);
    continue;
  }

  for (const name of new Set(cited)) {
    if (!existsSync(join(TEST_DIR, name))) {
      problems.push(`${id}: cited test test/${name} does not exist`);
      continue;
    }
    for (const script of ["test:unit", "test:coverage"]) {
      const command = PACKAGE.scripts[script] ?? "";
      if (!command.split(" ").includes(`test/${name}`)) {
        problems.push(`${id}: cited test test/${name} is missing from the "${script}" script`);
      }
    }
  }
}

if (unverifiedRows.length > 0) {
  console.log(`requirements: ${unverifiedRows.length} row(s) cite no unit test (allowed, kept visible): ${unverifiedRows.join(", ")}`);
}
if (problems.length > 0) {
  console.error(`requirements: ${problems.length} broken citation(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`requirements: ${rows.length - unverifiedRows.length}/${rows.length} rows cite existing, gate-wired tests`);
