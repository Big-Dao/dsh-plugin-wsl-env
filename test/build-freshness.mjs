/**
 * Build-artifact freshness check: the committed artifacts under `lib/` must
 * match what the canonical build (`scripts/build.mjs`) produces.
 *
 * The repository keeps its built artifacts checked in on purpose: a bare
 * checkout is loadable (the Windows runtime mirror is a copy, the harness has
 * no build step), and the tests exercise `lib/*.js` — the published artifact —
 * rather than the sources. That property only holds while the artifacts stay
 * in sync, so this check builds the same program into a scratch directory and
 * byte-compares what it emitted with what is committed — a check, not a
 * rebuild; the remedy for drift is `pnpm run build` plus a commit.
 *
 * It never writes under `lib/`. It used to run the real build over the tree
 * and restore from a snapshot, and a check killed midway — Ctrl-C, the
 * watchdog — left the artifacts rewritten and any new one behind.
 *
 * It also enforces that the corpus is CLOSED. `lib/` is entirely generated:
 * every JavaScript module there needs its `src/<name>.ts` (nothing regenerates
 * an orphan, so it would drift silently), and every source needs both of its
 * artifacts. Delegating to the real build script keeps the check honest — a
 * second implementation would be checking a different artifact than the one
 * the repository actually regenerates with — so the check runs that script
 * with `--outDir`, its only allowance for building somewhere else.
 *
 *   node test/build-freshness.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
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

const committed = generatedPaths();
const scratch = mkdtempSync(join(tmpdir(), "dsh-build-freshness-"));
/** @type {string[]} */
const drifted = [];
/** The compiler's output when the build cannot run to the end; reported once the scratch directory is gone. */
let buildFailure;
try {
  try {
    execFileSync(process.execPath, [BUILD, "--outDir", scratch], { cwd: ROOT, stdio: "pipe" });
  } catch (error) {
    // Not `process.exit` here: that would skip the cleanup below and leave the scratch directory behind.
    buildFailure = String(/** @type {{stdout?: unknown}} */ (error).stdout ?? (/** @type {Error} */ (error)).message).trim();
  }
  if (buildFailure === undefined) {
    for (const path of committed) {
      let built;
      try {
        built = readFileSync(join(scratch, basename(path)));
      } catch {
        built = undefined;
      }
      if (built === undefined || !built.equals(readFileSync(path))) drifted.push(`${relative(ROOT, path)} is stale`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (buildFailure !== undefined) {
  console.error(`FAIL  the build itself fails:\n${buildFailure}`);
  process.exit(1);
}

if (drifted.length > 0) {
  console.error(`FAIL  ${drifted.length} generated artifact(s) drifted from the build:`);
  for (const line of drifted) console.error(`      ${line}`);
  console.error("      run `pnpm run build` and commit the result");
  process.exit(1);
}
console.log(`PASS  ${committed.length} generated artifact(s) match the build`);
