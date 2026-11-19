/**
 * Probe: does an HMR update of a Git-pinned bundle keep its selection?
 *
 * `pluginManager.updateBundle` removes the installed bundle before installing
 * the target. On 0.2.2-rc.3 the Git path was observed to finish with the bundle
 * missing from `dsh.profile.bundles`; the registry path kept it. This probe
 * drives that path on a real host and reports three service implementations
 * before and after a restart, while `hmr-gate.sh` watches the profile manifest
 * at each boundary.
 *
 * The overlay composes this as an ordinary profile row. `apply` must return
 * immediately: the update removes the bundle that is being replaced, so
 * awaiting it inside `apply` makes the loader wait on the probe's own fiber.
 * The injected `hmr` child starts the work from a timer instead.
 *
 * `update` mode creates a `standard` session (best effort: a profile without a
 * model provider still exercises the update), calls `updateBundle`, and writes
 * its verdict. `verify` mode only reads the three takeover services, for the
 * restart leg.
 */
import { appendFileSync } from "node:fs";

/** @import { Context } from "@deepseek-ai/cordis" */

export const name = "hmr-gate-probe";

/** The update runs through this service; every mode reports on it. */
export const inject = ["pluginManager"];

/**
 * The probe's config, as the generated overlay composes it.
 * @typedef {object} ProbeConfig
 * @property {"update" | "verify"} mode - update the Git copy, or read providers only.
 * @property {string} name - installed bundle name.
 * @property {string} version - target version.
 * @property {string} spec - target Git spec pinned to a full commit.
 * @property {string} workspace - directory the probe's session is created in.
 * @property {string} report - where the probe appends its lines.
 */

/**
 * Append one line to the report; a missing report path must not hide the verdict.
 * @param {string} path - report path.
 * @returns {(line: string) => void} the line writer.
 */
function reporter(path) {
  return (line) => {
    try {
      appendFileSync(path, `${line}\n`);
    } catch {
      // The CLI's stdout still carries the same lines when the path is unusable.
    }
  };
}

/**
 * Class names of the three takeover services, or why one cannot be read.
 * @param {Context} ctx - probe context.
 * @returns {{subprocess: string, fs: string, directoryPicker: string}} the implementations.
 */
function providers(ctx) {
  /**
   * @param {string} serviceName - service to read.
   * @returns {string} its constructor name, or a diagnostic.
   */
  const read = (serviceName) => {
    try {
      const service = /** @type {any} */ (ctx.get(serviceName));
      if (service === undefined) return "(missing)";
      return service.constructor?.name ?? "(anonymous)";
    } catch {
      return "(error)";
    }
  };
  return {
    subprocess: read("subprocess"),
    fs: read("fs"),
    directoryPicker: read("directoryPicker"),
  };
}

/**
 * Whether every takeover service resolves to a live implementation.
 * @param {ReturnType<typeof providers>} read - the three implementations.
 * @returns {boolean} false when one is missing or unreadable.
 */
function allPresent(read) {
  return Object.values(read).every((value) => value !== "(missing)" && value !== "(error)");
}

/**
 * Run the one update and end the booted host with the probe's verdict.
 * @param {Context} scoped - context with the `hmr` service mounted.
 * @param {ProbeConfig} config - target bundle, session directory, and report path.
 * @param {(line: string) => void} emit - report writer.
 * @returns {Promise<void>} resolves after the report; the process exits.
 */
async function update(scoped, config, emit) {
  let ok = false;
  emit(`HMRPROBE hmr=${scoped.get("hmr") === undefined ? "missing" : "present"}`);
  emit(`HMRPROBE profileContext=${scoped.get("profileContext") === undefined ? "missing" : "present"}`);
  try {
    const controller = /** @type {any} */ (scoped.get("sessionController"));
    if (controller?.agents?.createSession === undefined) {
      emit("HMRPROBE session skipped: no sessionController");
    } else {
      const created = await controller.agents.createSession({
        cwd: config.workspace,
        agentPreset: "standard",
        reusable: () => false,
      });
      emit(`HMRPROBE session="${created.agentPreset ?? "?"}" id=${created.agent?.id ?? "?"}`);
    }
  } catch (error) {
    emit(`HMRPROBE session-error=${String(error)}`);
  }
  try {
    emit("HMRPROBE update starting");
    const manager = /** @type {any} */ (scoped.get("pluginManager"));
    if (manager === undefined) throw new Error("no pluginManager in the hmr child");
    const updated = await manager.updateBundle(config.name, config.version, { spec: config.spec });
    emit(`HMRPROBE update from=${updated.from} to=${updated.to} step=${updated.step}`);
    emit(
      `HMRPROBE result application=${updated.result.application} changed=${updated.result.changed} `
        + `stage=${updated.result.stage} error=${updated.result.error?.code ?? "null"}`,
    );
    if (updated.result.error?.diagnostic !== undefined) {
      emit(`HMRPROBE diagnostic=${updated.result.error.diagnostic}`);
    }
    if (updated.result.packageResult?.output !== undefined) {
      emit(`HMRPROBE pnpm=${updated.result.packageResult.output.slice(-400).replaceAll("\n", " | ")}`);
    }
    emit(`HMRPROBE restore=${updated.restore === undefined ? "null" : updated.restore.application}`);
    emit(`HMRPROBE providers-now=${JSON.stringify(providers(scoped))}`);
    ok = updated.result.application === "applied" && updated.restore === undefined;
    emit(ok ? "HMRPROBE UPDATE OK" : "HMRPROBE UPDATE FAIL");
  } catch (error) {
    emit(`HMRPROBE update-error=${String(error)}`);
    emit("HMRPROBE UPDATE FAIL");
  }
  setTimeout(() => process.exit(ok ? 0 : 1), 100);
}

/**
 * The probe entry: schedule the update from an injected `hmr` child, or read the
 * providers for the restart leg.
 * @param {Context} ctx - probe context.
 * @param {ProbeConfig} config - mode and report path.
 * @returns {void} the probe exits from a timer.
 */
export function apply(ctx, config) {
  const emit = reporter(config.report);
  if (config.mode === "verify") {
    setTimeout(() => {
      const read = providers(ctx);
      const ok = allPresent(read);
      emit(`HMRPROBE providers=${JSON.stringify(read)}`);
      emit(ok ? "HMRPROBE VERIFY OK" : "HMRPROBE VERIFY FAIL");
      setTimeout(() => process.exit(ok ? 0 : 1), 50);
    }, 500);
    return;
  }

  let mounted = false;
  let finished = false;
  ctx.inject(["hmr"], (scoped) => {
    mounted = true;
    // A timer, not a returned promise: apply() must not keep the loader waiting.
    setTimeout(() => {
      void update(scoped, config, emit).finally(() => {
        finished = true;
      });
    }, 300);
  });
  // If hmr never mounts the injected child never runs; report that instead of
  // leaving the CLI to its own timeout.
  setTimeout(() => {
    if (mounted) return;
    emit("HMRPROBE hmr=never-mounted");
    emit("HMRPROBE UPDATE FAIL");
    process.exit(1);
  }, 20000);
  // A wedged update must not leave the probe boot running forever.
  setTimeout(() => {
    if (finished) return;
    emit("HMRPROBE update=timeout");
    emit("HMRPROBE UPDATE FAIL");
    process.exit(1);
  }, 240000);
}
