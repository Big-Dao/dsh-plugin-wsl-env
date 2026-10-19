/**
 * Probe: drive the root-plane coordinate router (`dsh-plugin-wsl-env/fs-routing`)
 * on a real machine.
 *
 * The unit suite exercises the resolver with a fake distro backend; this probe
 * answers the question the unit suite cannot: when the shipped root `fs` row is
 * the router, does a `\\wsl.localhost\<distro>` target read from the distro's
 * ext4 substrate (not from the 9p share, and not from the host backend), does a
 * drive-letter target still read through the host backend, and does a target in
 * another distro still refuse?
 *
 * It boots under the throwaway `wslfs` profile (see `test/probe/run.sh`) with an
 * overlay that disables the profile's `wsl-fs` row and inserts the router plus
 * this module. The probe-only profile is pinned to one distro so that the
 * cross-distro fence has something foreign to refuse.
 *
 * The report is written beside this module; `test/probe/fs-routing.sh` prints it
 * and exits with this probe's status.
 *
 *   node --check test/probe/fs-routing-probe.mjs
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
 * @typedef {object} ProbeConfig
 * @property {string} distro - the pinned distro name.
 * @property {string} distroPath - the planted file's UNC spelling.
 * @property {string} distroLinux - the same file's Linux spelling.
 * @property {string} distroText - the planted distro-side content.
 * @property {string} hostPath - the planted host file's Windows spelling.
 * @property {string} hostText - the planted host-side content.
 * @property {string} [report] - where the report is written.
 */

/** What a refused step throws: the ordinary `Error` surface plus its optional code. */
/** @typedef {Error & {code?: string}} CodedError */

/**
 * The router's surface this probe drives: the routed reads, the coordinate
 * identity, and the containment predicate.
 * @typedef {import("../../lib/fs-routing.js").WslRoutingFileSystem} WslRoutingFileSystem
 */

/**
 * A resolved target, as the probe hands it back to the reads.
 * @typedef {import("@deepseek-ai/dsh-fs").FsTarget} FsTarget
 */

/**
 * The probe's plugin entry: wait for the root `fs`, then run the checks.
 * @param {Context} ctx - the probe context.
 * @param {ProbeConfig} config - the planted files and the report path.
 */
export default function fsRoutingProbe(ctx, config) {
  ctx.inject(["fs"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Ask the router the questions the documentation answers.
 * @param {Context} ctx - the context carrying the root `fs`.
 * @param {ProbeConfig} config - the planted files and the report path.
 * @returns {Promise<void>} the process exits with the verdict.
 */
async function run(ctx, config) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const failures = [];
  /**
   * @param {string} name - the check's name.
   * @param {boolean} ok - the verdict.
   * @param {string} [detail] - the evidence line.
   */
  const check = (name, ok, detail = "") => {
    lines.push(`ROUTINGPROBE ${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `  — ${detail}`}`);
    console.log(lines[lines.length - 1]);
    if (!ok) failures.push(name);
  };

  const fs = /** @type {WslRoutingFileSystem} */ (/** @type {unknown} */ (ctx.fs));
  const foreign = `\\\\wsl.localhost\\__dsh_routing_probe_foreign__\\etc\\hostname`;

  // 1. The distro coordinate is served by the distro backend: the target keeps
  // the UNC identity and the content comes from ext4.
  const distroTarget = await fs.resolve(config.distroPath);
  check("a distro UNC resolves to its own coordinate", distroTarget.targetKey.toLowerCase() === config.distroPath.toLowerCase(), `key=${distroTarget.targetKey}`);
  const distroText = await fs.readText(distroTarget);
  check("a distro UNC reads the planted ext4 file", distroText === config.distroText, `got=${JSON.stringify(distroText)}`);
  check("a distro target maps to its Linux spelling", fs.processPath(distroTarget) === config.distroLinux, `got=${fs.processPath(distroTarget)}`);

  // 2. The host plane is untouched: drive-letter paths still take the
  // inherited LocalFileSystem path, and their identity stays a drive path.
  const hostTarget = await fs.resolve(config.hostPath);
  check("a drive-letter path resolves as a host target", hostTarget.targetKey === config.hostPath, `key=${hostTarget.targetKey}`);
  const hostText = await fs.readText(hostTarget);
  check("a drive-letter path reads the planted host file", hostText === config.hostText, `got=${JSON.stringify(hostText)}`);
  check("a host target keeps its Windows spelling", fs.processPath(hostTarget) === config.hostPath, `got=${fs.processPath(hostTarget)}`);

  // 3. The pinned router fences another distro instead of routing to it.
  /** @type {CodedError | undefined} */
  let refusal;
  try {
    await fs.resolve(foreign);
  } catch (error) {
    refusal = /** @type {CodedError} */ (error);
  }
  check("another distro's UNC refuses with FS_OUTSIDE_DISTRO", refusal?.code === "FS_OUTSIDE_DISTRO", refusal === undefined ? "it resolved" : `code=${refusal.code}`);

  // 4. Containment compares distro coordinates, not textual prefixes.
  const child = /** @type {FsTarget} */ ({ targetKey: `${distroTarget.targetKey}\\nested.txt`, displayPath: "nested.txt" });
  const foreignChild = /** @type {FsTarget} */ ({ targetKey: foreign, displayPath: "hostname" });
  check("a child in the same distro is contained", fs.contains(distroTarget, child) === true);
  check("a child in another distro is not contained", fs.contains(distroTarget, foreignChild) === false);

  lines.push(failures.length === 0 ? "ROUTINGPROBE RESULT: all checks passed" : `ROUTINGPROBE RESULT: ${failures.length} check(s) failed`);
  console.log(lines[lines.length - 1]);
  try {
    const destination = typeof config.report === "string" && config.report.length > 0 ? config.report : join(PROBE_DIR, "fs-routing-report.txt");
    writeFileSync(destination, `${lines.join("\n")}\n`);
  } catch (error) {
    console.log(`ROUTINGPROBE report write failed: ${String(error)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
