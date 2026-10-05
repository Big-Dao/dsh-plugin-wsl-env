/**
 * The canonical build: `pnpm run build`, run from the repository root.
 *
 * One pass: every module is TypeScript under `src/`, emitted by
 * `tsconfig.build.json` to `lib/` as JavaScript plus its declarations, beside
 * the same export paths the hand-written modules had. (The two-pass build —
 * `rootDirs` merging `src/` and `lib/`, declarations emitted into a scratch
 * directory, a declaration-only second pass for the JSDoc-typed JavaScript —
 * existed for a tree where sources and hand-written modules mixed, and retired
 * with the last migration.)
 *
 * The declarations stay beside their JavaScript (same directory, same export
 * paths), and the artifacts stay committed — a bare checkout must remain
 * loadable (the Windows runtime mirror is a copy, the harness has no build
 * step) and the tests exercise `lib/*.js`, the published artifact. `lint:build`
 * fails the moment a committed artifact drifts from what this script produces.
 *
 * The build also PRUNES: a declaration under `lib/` that no `src/*.ts` owns is
 * a leftover of a rename, and it is deleted rather than left to be resolved as
 * a stale input. The corpus is closed on both sides — `lib/` holds exactly the
 * artifacts of `src/` — which `lint:build` enforces before it compares; the
 * orphan in the other direction (a `lib/*.js` with no source) is reported
 * there too, for a human to delete or give a source, never silently.
 *
 * See CONTRIBUTING, "The build".
 */
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");

/**
 * Run one build config, inheriting stdio so compiler errors are visible.
 * @param {string} config - the build config to run.
 */
function build(config) {
  execFileSync(process.execPath, [TSC, "-p", join(ROOT, config)], { cwd: ROOT, stdio: "inherit" });
}

/**
 * The artifact basenames `src/` owns: one `.js`+`.d.ts` pair per `src/<name>.ts`.
 * @returns {Set<string>} basenames under `lib/`.
 */
function ownedBasenames() {
  return new Set(
    readdirSync(join(ROOT, "src"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => name.slice(0, -3)),
  );
}

build("tsconfig.build.json");

const owned = ownedBasenames();
for (const name of readdirSync(join(ROOT, "lib"))) {
  if (name.endsWith(".d.ts") && !owned.has(name.slice(0, -5))) rmSync(join(ROOT, "lib", name));
}
