/**
 * Parse-check every shipped module with `node --check`.
 *
 * The unit tests cannot cover `lib/index.js`, `lib/picker.js`, `lib/auto-preset.js`
 * or `lib/shell-env.js`: they import DSH peers that a bare checkout does not have,
 * so importing them throws `ERR_MODULE_NOT_FOUND` before any assertion runs. That
 * leaves a real gap — the five rounds of misdiagnosis recorded in README §15.4
 * were caused by a bad insertion into `lib/shell.js`'s import graph, and the only
 * symptom was a `never started` from a *different* layer.
 *
 * This closes the syntax half of that gap. It does NOT evaluate the module, so a
 * temporal-dead-zone `ReferenceError` of the §15.4 kind still slips through:
 * running the probe or the app remains the only way to catch evaluation errors.
 *
 *   node test/syntax.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "..", "lib");

const modules = readdirSync(LIB)
  .filter((name) => name.endsWith(".js"))
  .sort();

let failed = 0;
for (const name of modules) {
  try {
    execFileSync(process.execPath, ["--check", join(LIB, name)], { stdio: "pipe" });
    console.log(`PASS  lib/${name} parses`);
  } catch (error) {
    failed += 1;
    const detail = String(error.stderr ?? error.message).trim().split("\n").slice(0, 6).join("\n      ");
    console.log(`FAIL  lib/${name}\n      ${detail}`);
  }
}

console.log(`\n${modules.length - failed}/${modules.length} modules parse`);
if (failed > 0) process.exitCode = 1;
