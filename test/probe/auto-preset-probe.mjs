/**
 * Probe: does a session created on a WSL workspace get the `wsl` preset?
 *
 * `auto-preset` wraps `sessionController.agents.createSession` so the preset
 * is chosen before the first mount. The unit suite fakes that seam; only a
 * real host answers whether the frame still exists and whether the composed
 * `wsl` preset resolves. This probe boots under the throwaway `wslfs` profile
 * with the package's own `cordis.patch.yml` layered on top (the profile does
 * not compose the plugin bundle, so the preset and the auto-preset row come
 * from that layer), creates one session on the checkout's UNC workspace, and
 * reports the preset the controller says it ran.
 *
 * The probe declares the two services as injects, so the loader starts it after
 * they exist; `apply` then calls the real controller. A host without the seam
 * reports FAIL with the reason instead of a silent skip.
 *
 *   node --check test/probe/auto-preset-probe.mjs
 */
import { writeFileSync } from "node:fs";

/** @import { Context } from "@deepseek-ai/cordis" */

export const name = "auto-preset-probe";

/** Wait for the controller and roster the adoption path reads. */
export const inject = ["sessionController", "agentPresets"];

/**
 * The probe's config, as the overlay composes it.
 * @typedef {object} ProbeConfig
 * @property {string} workspaceCwd - the WSL UNC workspace for the new session.
 * @property {string} report - where the report is written (UNC).
 */

/**
 * Run the one check and stop the booted host.
 * @param {Context} ctx - the probe context.
 * @param {ProbeConfig} config - the workspace and the report path.
 * @returns {Promise<void>} resolves only on a failed write; the probe exits.
 */
export async function apply(ctx, config) {
  /** @type {string[]} */
  const lines = [];
  /**
   * Write the report and end the host with the probe's verdict.
   * @param {number} status - 0 pass, 1 fail.
   */
  const finish = (status) => {
    writeFileSync(config.report, `${lines.join("\n")}\n`);
    process.exit(status);
  };
  const facade = /** @type {any} */ (ctx.get("sessionController"))?.agents;
  if (facade === undefined || typeof facade.createSession !== "function") {
    lines.push("AUTOPRESET FAIL sessionController exposes no agents.createSession");
    finish(1);
    return;
  }
  try {
    const created = await facade.createSession({ cwd: config.workspaceCwd, reusable: () => false });
    const preset = created?.agentPreset ?? null;
    if (preset === "wsl") {
      lines.push(`AUTOPRESET OK preset=${preset}`);
      finish(0);
    }
    lines.push(`AUTOPRESET FAIL preset=${JSON.stringify(preset)} expected "wsl"`);
    finish(1);
  } catch (error) {
    lines.push(`AUTOPRESET FAIL createSession threw: ${/** @type {Error} */ (error)?.message ?? String(error)}`);
    finish(1);
  }
}
