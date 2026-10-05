/**
 * Build-artifact freshness check: every module under `src/` must be built
 * (`pnpm run build`) and the result committed under `lib/`.
 *
 * The repository keeps its built artifacts checked in on purpose: a bare
 * checkout is loadable (the Windows runtime mirror is a copy, the harness has
 * no build step), and the tests exercise `lib/*.js` — the published artifact —
 * rather than the sources. That property only holds while the artifacts stay
 * in sync, so this check builds `src/**` into a scratch directory with the
 * same config the real build uses and byte-compares the result against `lib/`.
 * It compares against the WORKING TREE, not the index, so the check is green
 * the moment the artifact is rebuilt — committing is a separate step.
 *
 * Generated files are excluded from the `checkJs` gate (`tsconfig.json`):
 * they are type-checked as their TypeScript sources, which is strictly
 * stronger; this check keeps them honest as artifacts.
 *
 *   node test/build-freshness.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");

/**
 * Every file under `dir`, as paths relative to it.
 * @param {string} dir - the directory to walk.
 * @returns {string[]} its files, as paths relative to `dir`.
 */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path).map((child) => join(entry.name, child)));
    else out.push(entry.name);
  }
  return out;
}

const scratch = mkdtempSync(join(tmpdir(), "dsh-wsl-build-"));
/** @type {string[]} */
let emitted;
try {
  execFileSync(process.execPath, [TSC, "-p", join(ROOT, "tsconfig.build.json"), "--outDir", scratch], { cwd: ROOT, stdio: "pipe" });
  emitted = walk(scratch);
} catch (error) {
  const detail = String(/** @type {{stdout?: unknown}} */ (error).stdout ?? (/** @type {Error} */ (error)).message).trim();
  console.error(`FAIL  the build itself fails:\n${detail}`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
}

const drifted = [];
for (const file of emitted) {
  const built = join(scratch, file);
  const committed = join(ROOT, "lib", file);
  let same;
  try {
    same = statSync(committed).isFile() && readFileSync(committed).equals(readFileSync(built));
  } catch {
    same = false;
  }
  if (!same) drifted.push(relative(ROOT, committed));
}
rmSync(scratch, { recursive: true, force: true });

if (drifted.length > 0) {
  console.error(`FAIL  ${drifted.length} built artifact(s) are stale or missing:`);
  for (const path of drifted) console.error(`      ${path}`);
  console.error("      run `pnpm run build` and commit the result");
  process.exit(1);
}
console.log(`PASS  ${emitted.length} build artifact(s) match src/ (${emitted.map((file) => `lib/${file}`).join(", ")})`);
