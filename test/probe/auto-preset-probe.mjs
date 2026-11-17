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
  const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

  // The auto-preset row installs its wrapper from a `ctx.inject` callback. The
  // loader does not guarantee that callback has run before this probe applies,
  // so wait for the entry's fiber and then for the method to change identity.
  // A probe that calls too early would report the default preset as a failure
  // of the plugin.
  const original = facade.createSession;
  let autoEntry;
  try {
    const loader = /** @type {any} */ (ctx.get("loader", false));
    autoEntry = [...(loader?.entries?.() ?? [])].find(
      (/** @type {any} */ row) => row?.options?.id === "auto-preset" || row?.options?.name === "dsh-plugin-wsl-env/auto-preset",
    );
  } catch {
    autoEntry = undefined;
  }
  if (autoEntry?.fiber?.await !== undefined) {
    try {
      await autoEntry.fiber.await();
    } catch {
      // A failed row is reported through the seam state below.
    }
  }
  let seam = "missing";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (facade.createSession !== original) {
      seam = "installed";
      break;
    }
    await sleep(50);
  }
  let presets;
  try {
    presets = /** @type {any} */ (ctx.get("agentPresets", false));
  } catch {
    presets = undefined;
  }
  let defaultId = null;
  try {
    defaultId = presets?.defaultId ?? null;
  } catch {
    defaultId = null;
  }
  let available = null;
  try {
    if (typeof presets?.list === "function") available = presets.list().map((/** @type {any} */ entry) => entry?.id ?? entry);
    else if (typeof presets?.get === "function") available = ["wsl"].filter((id) => presets.get(id) !== undefined);
  } catch (error) {
    available = `error: ${/** @type {Error} */ (error)?.message ?? String(error)}`;
  }
  lines.push(`AUTOPRESET seam=${seam} entry=${autoEntry === undefined ? "missing" : "found"} default=${JSON.stringify(defaultId)} presets=${JSON.stringify(available)} cwd=${JSON.stringify(config.workspaceCwd)}`);

  let created;
  let creationError = null;
  try {
    created = await facade.createSession({ cwd: config.workspaceCwd, reusable: () => false });
  } catch (error) {
    creationError = /** @type {Error} */ (error)?.message ?? String(error);
  }
  const creation = created?.agentPreset ?? null;
  lines.push(`AUTOPRESET creation=${JSON.stringify(creation)} agent=${JSON.stringify(created?.agent?.agentPreset ?? null)} error=${JSON.stringify(creationError)}`);
  if (creation !== "wsl") {
    try {
      const forced = await facade.createSession({ cwd: config.workspaceCwd, agentPreset: "wsl", reusable: () => false });
      lines.push(`AUTOPRESET explicit=ok preset=${JSON.stringify(forced?.agentPreset ?? null)} agent=${JSON.stringify(forced?.agent?.agentPreset ?? null)}`);
    } catch (error) {
      lines.push(`AUTOPRESET explicit=error ${JSON.stringify(/** @type {Error} */ (error)?.message ?? String(error))}`);
    }
  }
  if (creation === "wsl") {
    lines.push(`AUTOPRESET OK preset=${creation}`);
    finish(0);
  }
  lines.push(`AUTOPRESET FAIL creation=${JSON.stringify(creation)} expected "wsl" (seam=${seam}, default=${JSON.stringify(defaultId)})`);
  finish(1);
}
