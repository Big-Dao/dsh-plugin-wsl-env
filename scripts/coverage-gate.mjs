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
 *      it is allowlisted — a string entry is the full exemption, an object
 *      entry (`{ reason, line?, branch?, function? }`) lowers only the named
 *      metrics and leaves the rest policed at the default floors;
 *   3. every allowlist entry must name a module that still exists, and every
 *      `excludedScripts` entry a file that still exists, so the lists cannot
 *      rot into silent exemptions for renamed files.
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
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Per-module floors. Lines sit above the global floor in package.json; branch
 * and function sit BELOW it on purpose — they exist to catch a module whose
 * own coverage collapsed, which a healthy global average can hide, not to
 * out-tighten the global gate.
 */
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
 * One module's floor violations against its allowlist entry. A string entry
 * is the full exemption it always was (a module the gated suite cannot load
 * at all); an object entry is a scoped exemption — it lowers only the metrics
 * it names, and every metric it omits stays at the default floor, so a
 * partially-covered module keeps being policed on the sides it does cover.
 *
 * @param {{ line: number, branch: number, function: number }} row - the measured module.
 * @param {string | { reason: string, line?: number, branch?: number, function?: number }} entry - the allowlist entry.
 * @returns {string[]} one message per floor violation, empty when the module holds.
 */
function floorViolations(row, entry) {
  if (typeof entry === "string") return [];
  /** @type {Record<string, number>} */
  const floors = { line: entry.line ?? FLOORS.line, branch: entry.branch ?? FLOORS.branch, function: entry.function ?? FLOORS.function };
  /** @type {string[]} */
  const problems = [];
  if (row.line < floors.line) problems.push(`line ${row.line.toFixed(2)}% < ${floors.line}% floor`);
  if (row.branch < floors.branch) problems.push(`branch ${row.branch.toFixed(2)}% < ${floors.branch}% floor`);
  if (row.function < floors.function) problems.push(`function ${row.function.toFixed(2)}% < ${floors.function}% floor`);
  return problems;
}

/**
 * Collect the gate's violations.
 *
 * @param {Map<string, { line: number, branch: number, function: number }>} rows - the measured modules.
 * @param {Set<string>} libs - every shipped module's basename.
 * @param {Map<string, string | { reason: string, line?: number, branch?: number, function?: number }>} allowlist - exempted modules and their entries.
 * @param {Record<string, string>} excludedScripts - the scripts the coverage command's exclude list names, with the reason.
 * @returns {string[]} one message per violation, empty when the gate holds.
 */
function violations(rows, libs, allowlist, excludedScripts) {
  /** @type {string[]} */
  const problems = [];
  for (const [name, entry] of allowlist) {
    if (!libs.has(name)) problems.push(`${name}: allowlisted but no such module under lib/ — drop the stale entry`);
    else if (typeof entry !== "string" && typeof entry.reason !== "string") problems.push(`${name}: a scoped entry needs a "reason"`);
  }
  for (const name of Object.keys(excludedScripts)) {
    if (!existsSync(join(ROOT, name))) problems.push(`${name}: listed in coverage-allowlist.json's excludedScripts but no such file — drop the stale entry`);
  }
  for (const name of libs) {
    if (allowlist.has(name)) continue;
    const row = rows.get(name);
    if (row === undefined) {
      problems.push(`${name}: not measured — no gated test loads it; add a test, or allowlist it in test/coverage-allowlist.json with the reason`);
      continue;
    }
    for (const problem of floorViolations(row, {})) problems.push(`${name}: ${problem}`);
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

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const libDirectory = fileURLToPath(new URL("../lib/", import.meta.url));
const allowlistPath = fileURLToPath(new URL("../test/coverage-allowlist.json", import.meta.url));
const watchdog = fileURLToPath(new URL("./test-watchdog.mjs", import.meta.url));

const allowlistFile = /** @type {{ modules?: Record<string, string | { reason?: string, line?: number, branch?: number, function?: number }>, excludedScripts?: Record<string, string> }} */ (JSON.parse(readFileSync(allowlistPath, "utf8")));
/** @type {Map<string, string | { reason: string, line?: number, branch?: number, function?: number }>} */
const allowlist = new Map(Object.entries(allowlistFile.modules ?? {}));
const excludedScripts = allowlistFile.excludedScripts ?? {};
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
  const problems = violations(rows, libs, allowlist, excludedScripts);
  console.log(
    `coverage-gate: ${rows.size} of ${libs.size} shipped module(s) measured, ${allowlist.size} allowlisted ` +
      `(floors ${FLOORS.line}/${FLOORS.branch}/${FLOORS.function})`,
  );
  // On CI, the per-module table belongs on the run page, not just in the logs.
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath !== undefined && summaryPath.length > 0) {
    const table = ["| module | lines % | branches % | functions % |", "|---|---|---|---|"];
    for (const [name, row] of [...rows.entries()].sort()) {
      table.push(`| ${name} | ${row.line.toFixed(2)} | ${row.branch.toFixed(2)} | ${row.function.toFixed(2)} |`);
    }
    const verdict = problems.length === 0 ? "all floors met" : `violations: ${problems.join("; ")}`;
    writeFileSync(summaryPath, `${table.join("\n")}\n\n${verdict}\n`);
  }
  if (problems.length > 0) {
    console.error("coverage-gate: FAIL");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("coverage-gate: every shipped module is measured or allowlisted, and every measured module clears the floors");
});
