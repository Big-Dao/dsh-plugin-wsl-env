/**
 * Probe: drive two distros' shell calls through the auto-routing executor on a
 * real machine, concurrently.
 *
 * The unit suite exercises multi-distro routing with fakes; this probe answers
 * the question the unit suite cannot (WSL-101's last unchecked leg): when two
 * distros' commands run through one composition — sequentially and then
 * concurrently — does each command land in its OWN distro (its own
 * filesystem — each leg plant a marker only its distro's `/tmp` holds — and
 * its cwd), or do the per-distro residents and route caches cross wires under
 * interleave?
 *
 * It boots under the throwaway `wslfs` profile (see `test/probe/run.sh`) with
 * an overlay that swaps the shell executor for the WSL one in auto mode
 * (`two-distro-probe.yml`). The suite skips the probe when fewer than two
 * distros exist (`two-distro.sh`'s `# prereq:` header).
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

  // The per-distro identity marker. The session env's `DSH_WSL_DISTRO` is NOT
  // a usable vehicle here: the `dsh-plugin-wsl-env/shell-env` row resolves it
  // from `execution.agent.session.header.cwd`, and this probe drives
  // `ctx.shell` directly with no agent session, so the managed `DSH_*`
  // namespace is legitimately absent on this seam. Each distro's `/tmp` is a
  // separate filesystem, which is exactly the isolation under test: each leg
  // plant a marker in its own distro and report which one it sees.
  const markerA = "/tmp/.two-distro-probe.marker-A";
  const markerB = "/tmp/.two-distro-probe.marker-B";
  const who = `printf "%s" "$(ls ${markerA} ${markerB} 2>/dev/null | tail -1)"`;
  const plantA = `touch ${markerA}`;
  const plantB = `touch ${markerB}`;
  await drive(ctx, config.distroA, config.rootA, plantA);
  await drive(ctx, config.distroB, config.rootB, plantB);
  const tokenA = markerA;
  const tokenB = markerB;
  const where = "pwd";

  // 1. Sequentially: each distro's command reports its own distro and cwd.
  /** @type {Array<[string, string, string]>} */
  const legs = [["A", config.distroA, config.rootA], ["B", config.distroB, config.rootB]];
  for (const [name, distro, root] of legs) {
    const result = await drive(ctx, distro, root, who);
    check(`distro ${name}'s command sees only its own marker`, result.stdout.text.trim() === (name === "A" ? tokenA : tokenB), `got=${JSON.stringify(result.stdout.text.trim())} stderr=${JSON.stringify(result.stderr.text.slice(0, 200))}`);
    const cwd = await drive(ctx, distro, root, where);
    check(`distro ${name}'s command runs in the requested workdir`, cwd.stdout.text.trim() === root, `got=${JSON.stringify(cwd.stdout.text.trim())}`);
  }

  // 2. Concurrently: the interleaved legs must not cross wires — the whole
  // point of the per-distro agent singletons this probe exists to exercise.
  const [concurrentA, concurrentB] = await Promise.all([
    drive(ctx, config.distroA, config.rootA, who),
    drive(ctx, config.distroB, config.rootB, who),
  ]);
  check("the concurrent A leg stays in distro A", concurrentA.stdout.text.trim() === tokenA, `got=${JSON.stringify(concurrentA.stdout.text.trim())}`);
  check("the concurrent B leg stays in distro B", concurrentB.stdout.text.trim() === tokenB, `got=${JSON.stringify(concurrentB.stdout.text.trim())}`);

  // 3. A burst: several interleaved rounds through both distros at once, the
  // shape a two-distro user's sessions actually produce.
  const burst = await Promise.all([
    drive(ctx, config.distroA, config.rootA, who),
    drive(ctx, config.distroB, config.rootB, who),
    drive(ctx, config.distroA, config.rootA, where),
    drive(ctx, config.distroB, config.rootB, where),
  ]);
  check("the burst's A distro answers stay in A", burst[0]?.stdout.text.trim() === tokenA && burst[2]?.stdout.text.trim() === trimTrailingSlash(config.rootA), `got=${JSON.stringify([burst[0]?.stdout.text.trim(), burst[2]?.stdout.text.trim()])}`);
  check("the burst's B distro answers stay in B", burst[1]?.stdout.text.trim() === tokenB && burst[3]?.stdout.text.trim() === config.rootB, `got=${JSON.stringify([burst[1]?.stdout.text.trim(), burst[3]?.stdout.text.trim()])}`);

  // The markers live in the distros' /tmp; remove them so a rerun starts clean.
  await drive(ctx, config.distroA, config.rootA, `rm -f ${markerA} ${markerB}`);
  await drive(ctx, config.distroB, config.rootB, `rm -f ${markerA} ${markerB}`);

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
