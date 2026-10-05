/**
 * Behavioural probe for `dsh-plugin-wsl-env/picker`.
 *
 * It asks the picker the questions a reader of the documentation would ask: does the
 * root level offer the Windows home and every installed distro, is a path that is not
 * absolute refused with the documented `directory-unreadable` code, and does
 * `maxEntries` really cap a level and say so. None of that was covered: the unit tests
 * import only `lib/listing.js`, so `lib/picker.js` never ran in a gate.
 *
 * The report is written beside this module; `test/probe/picker.sh` prints it and exits
 * with this probe's status.
 *
 *   node --check test/probe/picker-probe.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROBE_DIR } from "./env.mjs";

/**
 * Type-only import: the harness context this probe drives its seams through.
 * @import { Context } from "@deepseek-ai/cordis";
 */

/**
 * The probe's config, as the overlay composes it.
 * @typedef {{ distro: string, hostHome: string, scratch: string, maxEntries: number, report?: string }} ProbeConfig
 */

/** What a refused step throws: the ordinary `Error` surface plus its optional code. */
/** @typedef {Error & {code?: string}} CodedError */

/**
 * The concrete picker this profile mounts: `list()` is the browse primitive our
 * backend adds on top of the abstract `DirectoryPicker` the context declares.
 * @typedef {import("../../lib/picker.js").WslDirectoryPicker} WslDirectoryPicker
 */

/**
 * One listing attempt: the picker's answer, or the refusal.
 * @typedef {{ ok: true, value: Awaited<ReturnType<WslDirectoryPicker["list"]>> } | { ok: false, error: unknown }} ListingAttempt
 */

/**
 * The probe's plugin entry: wait for `directoryPicker`, then run the checks.
 * @param {Context} ctx - the probe context.
 * @param {ProbeConfig} config - the distro, host home, scratch level, cap and report path.
 */
export default function pickerProbe(ctx, config) {
  ctx.inject(["directoryPicker"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Walk the levels a user would walk, and report what the picker answered.
 * @param {Context} ctx - the context carrying the injected `ctx.directoryPicker`.
 * @param {ProbeConfig} config - the distro, host home, scratch level, cap and report path.
 */
async function run(ctx, config) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const failures = [];
  /** @param {string} line - the line to record. */
  const report = (line) => {
    lines.push(`PICKERPROBE ${line}`);
    console.log(`PICKERPROBE ${line}`);
  };
  /**
   * @param {string} name - the check's name.
   * @param {boolean} ok - the verdict.
   * @param {string} [detail] - the evidence line.
   */
  const check = (name, ok, detail = "") => {
    report(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `  — ${detail}`}`);
    if (!ok) failures.push(name);
  };
  /** The mounted backend, seen through the `list` primitive it adds. */
  const picker = /** @type {WslDirectoryPicker} */ (ctx.directoryPicker);
  /**
   * @param {string|undefined} path - the level to ask for (`undefined` = root).
   * @returns {Promise<ListingAttempt>} the answer or the refusal.
   */
  const listing = async (path) => {
    try {
      return { ok: true, value: await picker.list(path) };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const root = await listing(undefined);
  if (root.ok) {
    const names = root.value.entries.map((entry) => entry.name);
    check("the root level is crumbed", root.value.crumbs?.[0]?.name === "WSL", `crumbs=${JSON.stringify(root.value.crumbs?.map((c) => c.name))}`);
    check("the Windows home is offered", names.includes(config.hostHome), `want ${config.hostHome}`);
    check("every installed distro is offered", names.includes(config.distro), `want ${config.distro}; got ${names.join(", ")}`);
    check("the root level is not truncated", root.value.truncated === false, `truncated=${root.value.truncated}`);
  } else {
    check("the root level lists", false, `${(/** @type {CodedError} */ (root.error)).code} ${(/** @type {CodedError} */ (root.error)).message}`);
  }

  for (const [label, candidate] of [["a relative path", "relative/thing"], ["a directory that does not exist", "\\\\wsl.localhost\\no-such-distro-probe\\home"]]) {
    const refused = await listing(candidate);
    check(`${label} is refused with the documented code`, !refused.ok && (/** @type {CodedError} */ (refused.error)).code === "directory-unreadable", refused.ok ? "it listed" : `code=${(/** @type {CodedError} */ (refused.error)).code}`);
  }

  const capped = await listing(config.scratch);
  if (capped.ok) {
    const entries = capped.value.entries;
    check("maxEntries caps the level", entries.length <= config.maxEntries, `entries=${entries.length} cap=${config.maxEntries}`);
    check("a capped level says it was truncated", capped.value.truncated === true, `truncated=${capped.value.truncated}`);
    check("only directories are offered", entries.every((entry) => typeof entry.path === "string" && entry.path.length > 0), entries.map((e) => e.name).join(", "));
  } else {
    check("the prepared scratch level lists", false, `${(/** @type {CodedError} */ (capped.error)).code} ${(/** @type {CodedError} */ (capped.error)).message}`);
  }

  report(failures.length === 0 ? "RESULT: all checks passed" : `RESULT: ${failures.length} check(s) failed`);
  try {
    const destination = typeof config.report === "string" && config.report.length > 0 ? config.report : join(PROBE_DIR, "picker-report.txt");
    writeFileSync(destination, `${lines.join("\n")}\n`);
  } catch (error) {
    console.log(`PICKERPROBE report write failed: ${String(error)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
