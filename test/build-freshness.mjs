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
 * It also enforces that the corpus is CLOSED. `lib/` is entirely generated:
 * every JavaScript module there needs its `src/<name>.ts` (nothing regenerates
 * an orphan, so it would drift silently), and every source needs both of its
 * artifacts. Delegating to the real build keeps the check honest — a second
 * implementation that built elsewhere would be checking a different artifact
 * than the one the repository actually regenerates with.
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
 * The artifact basenames `src/` owns: one `.js`+`.d.ts` pair per `src/<name>.ts`.
 * @returns {Set<string>} basenames under `lib/`.
 */
function sourceBasenames() {
  return new Set(
    readdirSync(join(ROOT, "src"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.slice(0, -3)),
  );
}

const sources = sourceBasenames();
const libNames = readdirSync(join(ROOT, "lib"));
const orphans = libNames.filter((name) => name.endsWith(".js") && !sources.has(name.slice(0, -3)));
const missing = [...sources].filter((name) => !libNames.includes(`${name}.js`) || !libNames.includes(`${name}.d.ts`));
if (orphans.length > 0 || missing.length > 0) {
  console.error("FAIL  lib/ is not exactly the artifacts of src/:");
  for (const name of orphans) {
    console.error(`      lib/${name} has no src/${name.slice(0, -3)}.ts — lib/ is entirely generated; delete it or give it a source`);
  }
  for (const name of missing) {
    console.error(`      src/${name}.ts is missing lib/${name}.js or lib/${name}.d.ts — run \`pnpm run build\` and commit`);
  }
  process.exit(1);
}

/**
 * The generated artifacts the build owns: every declaration under `lib/`, plus
 * the JavaScript emitted from a `src/<name>.ts` counterpart.
 * @returns {string[]} absolute paths.
 */
function generatedPaths() {
  return readdirSync(join(ROOT, "lib"))
    .filter((name) => name.endsWith(".d.ts") || (name.endsWith(".js") && sources.has(name.slice(0, -3))))
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
