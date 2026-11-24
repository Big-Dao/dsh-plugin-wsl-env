/**
 * Deferred verdicts for the script-style suites.
 *
 * Several suites have their own `check(name, fn)` runner that printed PASS as
 * soon as the body returned. A body that returned early because the host
 * cannot run it — a `#!/bin/sh` fake on Windows — therefore printed PASS
 * without having tested anything: on the Windows CI leg the only unit test of
 * the host's real cancel path read as green while it never ran (#84).
 *
 * Such a body now calls {@link skip} instead of returning, and the runner —
 * {@link runCheck}, or a file's own — prints SKIP with the reason and counts
 * it apart, so a skipped check is visible in the log and in the summary line
 * ({@link summaryLine}) instead of borrowing a PASS.
 *
 *   import { runCheck, skip, summaryLine } from "./skip.mjs";
 *   const tally = newTally();
 *   const check = (name, fn) => checks.push([name, fn]);
 *   // inside a body:
 *   if (process.platform === "win32") skip("the fake wsl.exe is a POSIX script");
 *   for (const [name, fn] of checks) await runCheck(name, fn, tally);
 *   console.log(summaryLine(tally, "agent lifecycle"));
 *
 * @module dsh-plugin-wsl-env/test/skip
 */

/**
 * Thrown by {@link skip}: the check's body found that this host cannot run
 * it. Carries a reason, not a stack anyone needs.
 */
export class Skipped {
  /**
   * @param {string} reason - why this host cannot run the check.
   */
  constructor(reason) {
    /** @type {string} */
    this.reason = reason;
  }
}

/**
 * Defer the current check: its body has established that this host cannot
 * run it. Throws, so nothing after the call executes.
 * @param {string} reason - why; printed with the SKIP line.
 * @returns {never}
 */
export function skip(reason) {
  throw new Skipped(reason);
}

/**
 * One suite's running totals.
 * @typedef {object} Tally
 * @property {number} passed - the checks whose bodies ran to the end.
 * @property {number} skipped - the checks a body deferred.
 * @property {Array<{ name: string, reason: string }>} skipReasons - each deferred check with the reason its body gave.
 */

/**
 * A fresh tally.
 * @returns {Tally} zeroes.
 */
export function newTally() {
  return { passed: 0, skipped: 0, skipReasons: [] };
}

/**
 * Run one check's body and print its verdict: PASS, SKIP for a body that
 * called {@link skip}, FAIL for anything else — a FAIL also sets the process
 * exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the body.
 * @param {Tally} tally - the suite's totals, updated in place.
 * @returns {Promise<"pass" | "skip" | "fail">} the verdict.
 */
export async function runCheck(name, fn, tally) {
  try {
    await fn();
    tally.passed += 1;
    console.log(`PASS  ${name}`);
    return "pass";
  } catch (error) {
    if (error instanceof Skipped) {
      tally.skipped += 1;
      tally.skipReasons.push({ name, reason: error.reason });
      console.log(`SKIP  ${name} (${error.reason})`);
      return "skip";
    }
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
    return "fail";
  }
}

/**
 * The skipped part of a summary: how many checks were deferred, and each
 * distinct reason once — with a count when one reason covers several checks,
 * since seven POSIX fakes on Windows give seven identical reasons. The SKIP
 * lines above the summary name the individual checks.
 * @param {Tally} tally - the suite's totals.
 * @returns {string} e.g. `7 skipped: the fake wsl.exe is a POSIX script`, or an empty string when nothing was skipped.
 */
export function skipNote(tally) {
  if (tally.skipped === 0) return "";
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const { reason } of tally.skipReasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const reasons = [...counts].map(([reason, count]) => (count > 1 ? `${reason} ×${count}` : reason));
  return `${tally.skipped} skipped: ${reasons.join("; ")}`;
}

/**
 * A suite's summary line. The skipped count and its reasons appear whenever a
 * check was deferred, so a log reader sees what did not run without
 * scrolling for SKIP lines.
 * @param {Tally} tally - the suite's totals.
 * @param {string} label - the suite's name, as in "watcher checks pass".
 * @returns {string} the line, without the leading blank line.
 */
export function summaryLine(tally, label) {
  const base = `${tally.passed} ${label} checks pass`;
  const note = skipNote(tally);
  return note.length === 0 ? base : `${base} (${note})`;
}
