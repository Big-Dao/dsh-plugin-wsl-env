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

/** The three virtual roots, mirrored from lib/picker.js without importing it. */
const PICKER_ROOT = "\\\\dsh.localhost\\picker";
const HOST_ROOT = "\\\\dsh.localhost\\windows";
const WSL_ROOT = "\\\\wsl.localhost";

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
    const paths = root.value.entries.map((entry) => entry.path);
    const crumbPaths = root.value.crumbs?.map((crumb) => crumb.path) ?? [];
    check("the root level is crumbed", crumbPaths.length === 1 && crumbPaths[0] === PICKER_ROOT, `crumbPaths=${JSON.stringify(crumbPaths)}`);
    check("the Windows branch is offered", paths.includes(HOST_ROOT), `got ${names.join(", ")}`);
    check("the WSL branch is offered", paths.includes(WSL_ROOT), `got ${names.join(", ")}`);
    check("the root level is not truncated", root.value.truncated === false, `truncated=${root.value.truncated}`);
  } else {
    check("the root level lists", false, `${(/** @type {CodedError} */ (root.error)).code} ${(/** @type {CodedError} */ (root.error)).message}`);
  }

  // The two branches: drives under Windows, distros under WSL. The literals
  // mirror PICKER_ROOT / HOST_ROOT in lib/picker.js without importing it.
  const windows = await listing("\\\\dsh.localhost\\windows");
  if (windows.ok) {
    const drives = windows.value.entries.map((entry) => entry.name);
    check("the Windows branch lists drive roots", drives.length > 0 && drives.every((name) => /^[A-Z]:\\$/.test(name)), drives.join(", "));
    const windowsCrumbPaths = windows.value.crumbs?.map((crumb) => crumb.path) ?? [];
    check("the Windows branch is crumbed", windowsCrumbPaths.length === 2 && windowsCrumbPaths[0] === PICKER_ROOT && windowsCrumbPaths[1] === HOST_ROOT, `crumbPaths=${JSON.stringify(windowsCrumbPaths)}`);
    // The drive root spelling must survive as a volume root: trimming its
    // trailing separator here once made `C:\` fail the qualified-path check.
    const firstDrive = windows.value.entries[0]?.path;
    if (firstDrive !== undefined) {
      const drive = await listing(firstDrive);
      check("a drive root lists", drive.ok, drive.ok ? drive.value.path : `${(/** @type {CodedError} */ (drive.error)).code} ${(/** @type {CodedError} */ (drive.error)).message}`);
      if (drive.ok) {
        const driveCrumbPaths = drive.value.crumbs?.map((crumb) => crumb.path) ?? [];
        check("a drive root is crumbed under the Windows branch", driveCrumbPaths.length === 3 && driveCrumbPaths[0] === PICKER_ROOT && driveCrumbPaths[1] === HOST_ROOT && driveCrumbPaths[2] === firstDrive, `crumbPaths=${JSON.stringify(driveCrumbPaths)}`);
      }
    }
  } else {
    check("the Windows branch lists", false, `${(/** @type {CodedError} */ (windows.error)).code} ${(/** @type {CodedError} */ (windows.error)).message}`);
  }

  const wsl = await listing("\\\\wsl.localhost");
  if (wsl.ok) {
    const distros = wsl.value.entries.map((entry) => entry.name);
    check("the WSL branch offers every installed distro", distros.includes(config.distro), `want ${config.distro}; got ${distros.join(", ")}`);
    const wslCrumbPaths = wsl.value.crumbs?.map((crumb) => crumb.path) ?? [];
    check("the WSL branch is crumbed", wslCrumbPaths.length === 2 && wslCrumbPaths[0] === PICKER_ROOT && wslCrumbPaths[1] === WSL_ROOT, `crumbPaths=${JSON.stringify(wslCrumbPaths)}`);
  } else {
    check("the WSL branch lists", false, `${(/** @type {CodedError} */ (wsl.error)).code} ${(/** @type {CodedError} */ (wsl.error)).message}`);
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
    const newlineName = "0-has\nnewline";
    check("a newline-named directory lists as one exact row (WSL-306)", entries.some((entry) => entry.name === newlineName), JSON.stringify(entries.map((e) => e.name)));
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
