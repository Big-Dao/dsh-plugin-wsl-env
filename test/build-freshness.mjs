/**
 * Build-artifact freshness check: the committed artifacts under `lib/` must
 * match what the canonical build (`scripts/build.mjs`) produces.
 *
 * The repository keeps its built artifacts checked in on purpose: a bare
 * checkout is loadable (the Windows runtime mirror is a copy, the harness has
 * no build step), and the tests exercise `lib/*.js` — the published artifact —
 * rather than the sources. That property only holds while the artifacts stay
 * in sync, so this check snapshots every generated file, runs the real build,
 * byte-compares, and RESTORES the snapshot — a check, not a rebuild; the
 * remedy for drift is `pnpm run build` plus a commit.
 *
 * Delegating to the real build is deliberate: the declaration pass has to run
 * against a clean tree (a stale `.d.ts` is resolved as an input and degrades
 * the re-emit — see `scripts/build.mjs`), so a second implementation that
 * built elsewhere would be checking a different artifact than the one the
 * repository actually regenerates with.
 *
 *   node test/build-freshness.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BUILD = join(ROOT, "scripts", "build.mjs");

/**
 * The generated artifacts the build owns: every declaration under `lib/`,
 * plus the JavaScript emitted from a `src/*.ts` counterpart.
 * @returns {string[]} absolute paths.
 */
function generatedPaths() {
  const fromSrc = new Set(
    readdirSync(join(ROOT, "src"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.slice(0, -3)),
  );
  return readdirSync(join(ROOT, "lib"))
    .filter((name) => name.endsWith(".d.ts") || (name.endsWith(".js") && fromSrc.has(name.slice(0, -3))))
    .map((name) => join(ROOT, "lib", name));
}

/** @type {Map<string, Buffer>} */
const snapshot = new Map();
for (const path of generatedPaths()) snapshot.set(path, readFileSync(path));

try {
  execFileSync(process.execPath, [BUILD], { cwd: ROOT, stdio: "pipe" });
} catch (error) {
  const detail = String(/** @type {{stdout?: unknown}} */ (error).stdout ?? (/** @type {Error} */ (error)).message).trim();
  console.error(`FAIL  the build itself fails:\n${detail}`);
  process.exit(1);
}

const drifted = [];
for (const [path, before] of snapshot) {
  let now;
  try {
    now = readFileSync(path);
  } catch {
    now = undefined;
  }
  if (now === undefined || !now.equals(before)) drifted.push(`${relative(ROOT, path)} is stale`);
}
for (const path of generatedPaths()) {
  if (!snapshot.has(path)) drifted.push(`${relative(ROOT, path)} is not committed`);
}

// Restore: a check leaves the working tree as it found it.
for (const [path, content] of snapshot) writeFileSync(path, content);
for (const path of generatedPaths()) {
  if (!snapshot.has(path)) rmSync(path);
}

if (drifted.length > 0) {
  console.error(`FAIL  ${drifted.length} generated artifact(s) drifted from the build:`);
  for (const line of drifted) console.error(`      ${line}`);
  console.error("      run `pnpm run build` and commit the result");
  process.exit(1);
}
console.log(`PASS  ${snapshot.size} generated artifact(s) match the build`);
