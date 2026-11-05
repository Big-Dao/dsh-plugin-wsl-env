/**
 * Probe: drive two distros' shell calls through the auto-routing executor on a
 * real machine, concurrently.
 *
 * The unit suite exercises multi-distro routing with fakes; this probe answers
 * the question the unit suite cannot (WSL-101's last unchecked leg): when two
 * distros' commands run through one composition — sequentially and then
 * concurrently — does each command land in its OWN distro (its
 * `DSH_WSL_DISTRO`, its cwd), or do the per-distro residents and route caches
 * cross wires under interleave?
 *
 * It boots under the throwaway `wslfs` profile (see `test/probe/run.sh`) with
 * an overlay that swaps the shell executor for the WSL one in auto mode
 * (`two-distro-probe.yml`). The suite skips the probe when fewer than two
 * distros exist (`two-distro.sh`'s `# prereq:` header).
 *
 * The report is written beside this module; `test/probe/two-distro.sh` prints
 * it and exits with this probe's status.
 *
 *   node --check test/probe/two-distro-probe.mjs
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
 * @property {string} distroA - the first (default) distro's name.
 * @property {string} distroB - the second distro's name.
 * @property {string} rootA - an existing Linux directory in distro A.
 * @property {string} rootB - an existing Linux directory in distro B.
 * @property {string} [report] - where the report is written.
 */

/**
 * A settled shell result, shaped like the bash tool's canonical view.
 * @typedef {{ exitCode: number | null, stdout: { text: string }, stderr: { text: string } }} ShellResult
 */

/**
 * The probe's plugin entry: wait for `shell`, then run the checks.
 * @param {Context} ctx - the probe context.
 * @param {ProbeConfig} config - the two distros and their scratch roots.
 */
export default function twoDistroProbe(ctx, config) {
  ctx.inject(["shell"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Run one shell call inside one distro and return its settled result.
 * @param {Context} ctx - the context carrying `ctx.shell`.
 * @param {string} distro - the distro the workdir names.
 * @param {string} root - an existing Linux directory in that distro.
 * @param {string} command - the shell line to run.
 * @returns {Promise<ShellResult>} the settled result.
 */
async function drive(ctx, distro, root, command) {
  const workdir = `\\\\wsl.localhost\\${distro}${root.replaceAll("/", "\\")}`;
  const spec = ctx.shell.resolve({ command, workdir });
  const execution = await ctx.shell.execute(spec);
  const result = await execution.result();
  return /** @type {ShellResult} */ (/** @type {unknown} */ (result));
}

/**
 * Ask both distros the routing questions, sequentially and concurrently.
 * @param {Context} ctx - the context carrying the injected `ctx.shell`.
 * @param {ProbeConfig} config - the two distros and their scratch roots.
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
    lines.push(`TWODISTROPROBE ${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `  — ${detail}`}`);
    console.log(lines[lines.length - 1]);
    if (!ok) failures.push(name);
  };

  const who = 'printf "%s" "$DSH_WSL_DISTRO"';
  const where = "pwd";

  // 1. Sequentially: each distro's command reports its own distro and cwd.
  /** @type {Array<[string, string, string]>} */
  const legs = [["A", config.distroA, config.rootA], ["B", config.distroB, config.rootB]];
  for (const [name, distro, root] of legs) {
    const result = await drive(ctx, distro, root, who);
    check(`distro ${name}'s command reports its own DSH_WSL_DISTRO`, result.stdout.text.trim() === distro, `got=${JSON.stringify(result.stdout.text.trim())} stderr=${JSON.stringify(result.stderr.text.slice(0, 200))}`);
    const cwd = await drive(ctx, distro, root, where);
    check(`distro ${name}'s command runs in the requested workdir`, cwd.stdout.text.trim() === root, `got=${JSON.stringify(cwd.stdout.text.trim())}`);
  }

  // 2. Concurrently: the interleaved legs must not cross wires — the whole
  // point of the per-distro agent singletons this probe exists to exercise.
  const [concurrentA, concurrentB] = await Promise.all([
    drive(ctx, config.distroA, config.rootA, who),
    drive(ctx, config.distroB, config.rootB, who),
  ]);
  check("the concurrent A leg stays in distro A", concurrentA.stdout.text.trim() === config.distroA, `got=${JSON.stringify(concurrentA.stdout.text.trim())}`);
  check("the concurrent B leg stays in distro B", concurrentB.stdout.text.trim() === config.distroB, `got=${JSON.stringify(concurrentB.stdout.text.trim())}`);

  // 3. A burst: several interleaved rounds through both distros at once, the
  // shape a two-distro user's sessions actually produce.
  const burst = await Promise.all([
    drive(ctx, config.distroA, config.rootA, who),
    drive(ctx, config.distroB, config.rootB, who),
    drive(ctx, config.distroA, config.rootA, where),
    drive(ctx, config.distroB, config.rootB, where),
  ]);
  check("the burst's A distro answers stay in A", burst[0]?.stdout.text.trim() === config.distroA && burst[2]?.stdout.text.trim() === trimTrailingSlash(config.rootA), `got=${JSON.stringify([burst[0]?.stdout.text.trim(), burst[2]?.stdout.text.trim()])}`);
  check("the burst's B distro answers stay in B", burst[1]?.stdout.text.trim() === config.distroB && burst[3]?.stdout.text.trim() === config.rootB, `got=${JSON.stringify([burst[1]?.stdout.text.trim(), burst[3]?.stdout.text.trim()])}`);

  lines.push(failures.length === 0 ? "TWODISTROPROBE RESULT: all checks passed" : `TWODISTROPROBE RESULT: ${failures.length} check(s) failed`);
  console.log(lines[lines.length - 1]);
  try {
    const destination = typeof config.report === "string" && config.report.length > 0 ? config.report : join(PROBE_DIR, "two-distro-report.txt");
    writeFileSync(destination, `${lines.join("\n")}\n`);
  } catch (error) {
    console.log(`TWODISTROPROBE report write failed: ${String(error)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

/**
 * The root spelling `pwd` returns may differ in trailing separators from the
 * configured one; compare on the trimmed common form.
 * @param {string} value - the configured root.
 * @returns {string} the root without a trailing slash.
 */
function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
