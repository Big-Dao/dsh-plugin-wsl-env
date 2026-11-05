#!/usr/bin/env node
/**
 * Coverage gate: run the coverage command, then require that every shipped
 * module is accounted for.
 *
 * `node --test`'s coverage is load-based. A module no test imports has no row
 * at all, so the global percentage is computed over whatever happened to run —
 * `lib/git-exec.js` and the three peer-bound rows sat outside the denominator
 * behind a 96.65% headline, and the thresholds could not see them. This gate
 * closes that hole after the command finishes:
 *
 *   1. every `lib/*.js` must appear in the report, or be named in
 *      `test/coverage-allowlist.json` with the reason it cannot be loaded
 *      by the gated suite;
 *   2. every measured module must clear the per-module floors below, unless
 *      it is allowlisted (an allowlisted module that now passes is fine);
 *   3. every allowlist entry must name a module that still exists, so the
 *      list cannot rot into a silent exemption for a renamed file.
 *
 * The global thresholds stay on the command line (Node enforces them); this
 * script only adds what a global number cannot express.
 *
 *   node scripts/coverage-gate.mjs -- <command...>
 *
 * The command runs under `scripts/test-watchdog.mjs`, so a wedged test file
 * cannot outlive the watchdog deadline. The command's own failure is passed
 * through unchanged.
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Per-module floors, deliberately above the global ones in package.json. */
const FLOORS = /** @type {const} */ ({ line: 85, branch: 70, function: 60 });

/**
 * Parse the rows of Node's coverage table.
 *
 * @param {string} output - everything the coverage command wrote to stdout.
 * @returns {Map<string, { line: number, branch: number, function: number }>} rows by module basename.
 */
function parseReport(output) {
  /** @type {Map<string, { line: number, branch: number, function: number }>} */
  const rows = new Map();
  for (const line of output.split("\n")) {
    const match = /^ℹ\s+([\w.-]+\.js)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/u.exec(line);
    if (match === null) continue;
    rows.set(match[1], { line: Number(match[2]), branch: Number(match[3]), function: Number(match[4]) });
  }
  return rows;
}

/**
 * Collect the gate's violations.
 *
 * @param {Map<string, { line: number, branch: number, function: number }>} rows - the measured modules.
 * @param {Set<string>} libs - every shipped module's basename.
 * @param {Map<string, string>} allowlist - exempted modules and their reasons.
 * @returns {string[]} one message per violation, empty when the gate holds.
 */
function violations(rows, libs, allowlist) {
  /** @type {string[]} */
  const problems = [];
  for (const name of allowlist.keys()) {
    if (!libs.has(name)) problems.push(`${name}: allowlisted but no such module under lib/ — drop the stale entry`);
  }
  for (const name of libs) {
    if (allowlist.has(name)) continue;
    const row = rows.get(name);
    if (row === undefined) {
      problems.push(`${name}: not measured — no gated test loads it; add a test, or allowlist it in test/coverage-allowlist.json with the reason`);
      continue;
    }
    if (row.line < FLOORS.line) problems.push(`${name}: line ${row.line.toFixed(2)}% < ${FLOORS.line}% floor`);
    if (row.branch < FLOORS.branch) problems.push(`${name}: branch ${row.branch.toFixed(2)}% < ${FLOORS.branch}% floor`);
    if (row.function < FLOORS.function) problems.push(`${name}: function ${row.function.toFixed(2)}% < ${FLOORS.function}% floor`);
  }
  return problems;
}

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
const command = separator === -1 ? argv : argv.slice(separator + 1);
if (command.length === 0) {
  console.error("coverage-gate: no command given; usage: coverage-gate.mjs -- <command...>");
  process.exit(2);
}

const libDirectory = fileURLToPath(new URL("../lib/", import.meta.url));
const allowlistPath = fileURLToPath(new URL("../test/coverage-allowlist.json", import.meta.url));
const watchdog = fileURLToPath(new URL("./test-watchdog.mjs", import.meta.url));

/** @type {Map<string, string>} */
const allowlist = new Map(Object.entries(JSON.parse(readFileSync(allowlistPath, "utf8")).modules ?? {}));
const libs = new Set(readdirSync(libDirectory).filter((name) => name.endsWith(".js")));

const child = spawn(process.execPath, [watchdog, "--", ...command], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});
let report = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  report += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("error", (error) => {
  console.error(`coverage-gate: cannot start the coverage command: ${error.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  if (code !== 0) {
    // A failed coverage command (global threshold, wedged file, test failure)
    // is already the verdict; do not bury it under a gate message.
    process.exitCode = code ?? 1;
    return;
  }
  const rows = parseReport(report);
  if (rows.size === 0) {
    console.error("coverage-gate: no coverage rows found in the command's output");
    process.exitCode = 1;
    return;
  }
  const problems = violations(rows, libs, allowlist);
  console.log(
    `coverage-gate: ${rows.size} of ${libs.size} shipped module(s) measured, ${allowlist.size} allowlisted ` +
      `(floors ${FLOORS.line}/${FLOORS.branch}/${FLOORS.function})`,
  );
  if (problems.length > 0) {
    console.error("coverage-gate: FAIL");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("coverage-gate: every shipped module is measured or allowlisted, and every measured module clears the floors");
});
