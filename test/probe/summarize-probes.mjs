#!/usr/bin/env node
// Summarize a real-machine probe run into four distinguishable states.
//
// The suite runner (run-all-when-closed.sh) records one line per probe and
// this script turns those lines plus the expected suite into a summary where
// "missing prerequisite", "real failure" and "never attempted" cannot be
// confused with a full pass:
//
//   node summarize-probes.mjs --suite a.sh,b.sh <results-file>
//
// Results-file lines (tab-separated):
//   PASS <name>
//   FAIL <name> <status>
//   SKIP <name> <reason...>
//
// Exit codes: 0 complete pass; 1 at least one FAIL; 2 incomplete (any SKIP,
// or any suite entry with no recorded line — nothing may report a full pass
// over skipped or unattempted probes).
import { readFileSync } from "node:fs";

/** @type {Record<string, (parts: string[]) => string>} */
const parsers = {
  PASS: (parts) => `${parts[1] ?? ""}\tpassed`,
  FAIL: (parts) => `${parts[1] ?? ""}\tFAILED (status ${parts[2] ?? "?"})`,
  SKIP: (parts) => `${parts[1] ?? ""}\tskipped — ${parts.slice(2).join(" ") || "unrecorded reason"}`,
};

const suiteArgIndex = process.argv.indexOf("--suite");
const suiteArg = suiteArgIndex === -1 ? undefined : process.argv[suiteArgIndex + 1];
if (!suiteArg) {
  console.error("usage: summarize-probes.mjs --suite <comma-separated names> <results-file>");
  process.exit(2);
}
const suite = suiteArg.split(",").filter(Boolean);
const resultsPath = /** @type {string} */ (process.argv[process.argv.length - 1]);

/** @type {Map<string, string>} probe name -> rendered line */
const outcomes = new Map();
/** @type {string[]} */
let lines = [];
try {
  lines = readFileSync(resultsPath, "utf8").split("\n").filter(Boolean);
} catch {
  // A missing results file means nothing ran; every entry counts as not run.
}
for (const line of lines) {
  const parts = line.split("\t");
  const render = parsers[parts[0] ?? ""];
  if (!render || !parts[1]) {
    console.error(`summarize-probes: ignoring malformed results line: ${line}`);
    continue;
  }
  outcomes.set(/** @type {string} */ (parts[1]), render(parts));
}

const passed = [];
const failed = [];
const skipped = [];
const notRun = [];
for (const name of suite) {
  const line = outcomes.get(name);
  if (line === undefined) notRun.push(name);
  else if (line.includes("\tpassed")) passed.push(name);
  else if (line.includes("FAILED")) failed.push(name);
  else skipped.push(line);
}

console.log(`probe suite: ${suite.length} probes — pass ${passed.length}, fail ${failed.length}, skipped ${skipped.length}, not run ${notRun.length}`);
for (const line of skipped) console.log(`SKIP  ${line}`);
for (const name of notRun) console.log(`NOT RUN  ${name} (never attempted)`);
if (failed.length > 0) {
  console.log(`INCOMPLETE RUN: ${failed.length} probe(s) failed — see the per-probe sections above`);
  process.exit(1);
}
if (skipped.length > 0 || notRun.length > 0) {
  console.log("INCOMPLETE RUN: skipped and not-run probes are NOT passes — the suite did not fully run");
  process.exit(2);
}
console.log("FULL PASS: every probe in the suite ran and passed");
