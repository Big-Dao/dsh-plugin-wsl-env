/**
 * Probe: kill the live resident inside the distro and watch the next command
 * come back through the rebuild.
 *
 * The unit suite covers the rebuild with a scripted transport (a fake child
 * "exits" and a scripted second transport answers); this probe answers the
 * question the unit suite cannot (WSL-207's residue): on a real machine, does
 * `pkill`-ing the live resident leave the NEXT command working — through the
 * executor's one rebuild — without operator action?
 *
 * It boots under the throwaway `wslfs` profile (see `test/probe/run.sh`) with
 * an overlay that pins the shell executor to the profile's distro
 * (`agent-restart-probe.yml`; confinement off — the rebuild, not the sandbox,
 * is the target). The kill is deliberately fired THROUGH the resident, so the
 * killing command's own outcome is genuinely unknowable: the probe accepts
 * either settlement for it and demands only that recovery happen.
 *
 * The report is written beside this module; `test/probe/agent-restart.sh`
 * prints it and exits with this probe's status.
 *
 *   node --check test/probe/agent-restart-probe.mjs
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
 * @property {string} [report] - where the report is written.
 */

/**
 * A settled shell result, shaped like the bash tool's canonical view.
 * @typedef {{ exitCode: number | null, stdout: { text: string }, stderr: { text: string } }} ShellResult
 */

/**
 * The probe's plugin entry: wait for `shell`, then run the checks.
 * @param {Context} ctx - the probe context.
 * @param {ProbeConfig} config - the report path.
 */
export default function agentRestartProbe(ctx, config) {
  ctx.inject(["shell"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Run one shell call and return its settled result.
 * @param {Context} ctx - the context carrying `ctx.shell`.
 * @param {string} command - the shell line to run.
 * @returns {Promise<ShellResult>} the settled result.
 */
async function drive(ctx, command) {
  const spec = ctx.shell.resolve({ command, workdir: "/tmp" });
  const execution = await ctx.shell.execute(spec);
  const result = await execution.result();
  return /** @type {ShellResult} */ (/** @type {unknown} */ (result));
}

/**
 * Warm the resident, kill it, and prove the next commands recover.
 * @param {Context} ctx - the context carrying the injected `ctx.shell`.
 * @param {ProbeConfig} config - the report path.
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
    lines.push(`RESTARTPROBE ${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `  — ${detail}`}`);
    console.log(lines[lines.length - 1]);
    if (!ok) failures.push(name);
  };

  // 1. Warm the resident so the kill has a live target.
  const warm = await drive(ctx, "true");
  check("a first command runs on a warm resident", warm.exitCode === 0, `exit=${warm.exitCode}`);

  // 2. Kill every resident from inside. The kill command rides the resident it
  // is killing, so its own outcome is genuinely unknowable — the process may
  // answer before it dies, or die with the resident. Either settlement is
  // acceptable; what is demanded is the RECOVERY, not this leg's verdict.
  /** @type {ShellResult | { rejected: string }} */
  let killOutcome;
  try {
    const result = await drive(ctx, "pkill -f wsl-agent || true");
    killOutcome = result;
  } catch (error) {
    killOutcome = { rejected: /** @type {Error} */ (error).message.slice(0, 200) };
  }
  check(
    "the kill leg settles one way or the other",
    "exitCode" in killOutcome ? killOutcome.exitCode !== undefined : typeof killOutcome.rejected === "string",
    "exitCode" in killOutcome ? `exit=${killOutcome.exitCode}` : `rejected: ${killOutcome.rejected}`,
  );

  // 3. The next command must recover through the executor's one rebuild —
  // no operator action, no permanent agent-down.
  const recovered = await drive(ctx, 'printf "recovered"');
  check("the next command recovers through the rebuild", recovered.exitCode === 0 && recovered.stdout.text === "recovered", `exit=${recovered.exitCode} got=${JSON.stringify(recovered.stdout.text)} stderr=${JSON.stringify(recovered.stderr.text.slice(0, 200))}`);

  // 4. The rebuilt resident keeps serving: the rebuild is not a one-shot mode.
  const again = await drive(ctx, 'printf "again"');
  check("the rebuilt resident keeps serving", again.exitCode === 0 && again.stdout.text === "again", `exit=${again.exitCode} got=${JSON.stringify(again.stdout.text)}`);

  lines.push(failures.length === 0 ? "RESTARTPROBE RESULT: all checks passed" : `RESTARTPROBE RESULT: ${failures.length} check(s) failed`);
  console.log(lines[lines.length - 1]);
  try {
    const destination = typeof config.report === "string" && config.report.length > 0 ? config.report : join(PROBE_DIR, "agent-restart-report.txt");
    writeFileSync(destination, `${lines.join("\n")}\n`);
  } catch (error) {
    console.log(`RESTARTPROBE report write failed: ${String(error)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
