import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** @import { Context } from "@deepseek-ai/cordis"; */
/** @typedef {{ mode: "resident" | "oneshot", mask: "visible" | "masked", workspaceRoot: string, report: string }} ProbeConfig */
/** @typedef {{ exitCode: number | null, sandbox?: { mode?: string, enforcement?: string, windowsDrive?: string, sessionScope?: string } | undefined }} ProbeResult */
/** @typedef {(command: string, mode: "workspace-write" | "danger-full-access") => Promise<ProbeResult>} ProbeExec */

/**
 * @param {string} value - Shell argument.
 * @returns {string} Single-quoted shell argument.
 */
function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * @param {ProbeResult} result - Result whose confinement facts must match.
 * @param {{mode: "resident" | "oneshot", mask: "visible" | "masked"}} config - Expected path and mask.
 * @param {string[]} failures - Failures found by the probe.
 */
function checkSandboxFacts(result, config, failures) {
  const expectedScope = config.mode === "resident" ? "session" : "per-command";
  const facts = result.sandbox;
  if (facts?.mode !== "workspace-write" || facts.enforcement !== "partial" || facts.windowsDrive !== config.mask || facts.sessionScope !== expectedScope) {
    failures.push(`unexpected sandbox facts: ${JSON.stringify(facts)}`);
  }
}

/**
 * @param {ProbeExec} exec - The shell executor under test.
 * @param {{mode: "resident" | "oneshot", mask: "visible" | "masked"}} config - Expected path and mask.
 * @param {string} marker - Unique Windows-side marker path.
 * @returns {Promise<string[]>} Failed checks, or an empty array.
 */
export async function runInteropChecks(exec, config, marker) {
  /** @type {string[]} */
  const failures = [];
  const executable = "/mnt/c/Windows/System32/cmd.exe";
  const launch = `${quote(executable)} /d /v:off /c echo DSH_INTEROP_PROBE '>' ${quote(marker)}`;
  const baseline = await exec(launch, "danger-full-access");
  if (baseline.exitCode !== 0 || !existsSync(marker) || readFileSync(marker, "utf8").trim() !== "DSH_INTEROP_PROBE") {
    return ["INCONCLUSIVE: Windows interop or the temporary marker is unavailable outside the sandbox"];
  }
  unlinkSync(marker);

  if (config.mask === "masked") {
    const hidden = await exec(`test ! -e ${quote(executable)}`, "workspace-write");
    checkSandboxFacts(hidden, config, failures);
    if (hidden.exitCode !== 0) failures.push("the Windows executable remains visible under /mnt");
  }

  const result = await exec(launch, "workspace-write");
  checkSandboxFacts(result, config, failures);
  if (config.mask === "visible") {
    if (result.exitCode !== 0 || !existsSync(marker) || readFileSync(marker, "utf8").trim() !== "DSH_INTEROP_PROBE") {
      failures.push(`the expected interop escape was not observed: exit=${String(result.exitCode)}`);
    }
  } else if (typeof result.exitCode !== "number" || result.exitCode === 0 || existsSync(marker)) {
    failures.push(`the masked executable was not blocked: exit=${String(result.exitCode)}`);
  }
  return failures;
}

/**
 * @param {ProbeExec} exec - The shell executor under test.
 * @param {{mode: "resident" | "oneshot", mask: "visible" | "masked", workspaceRoot: string}} config - Expected path and workspace.
 * @param {string} marker - Unique Windows-side marker path.
 * @returns {Promise<string[]>} Failed checks, or an empty array.
 */
export async function runCopiedInteropChecks(exec, config, marker) {
  /** @type {string[]} */
  const failures = [];
  const executable = `${config.workspaceRoot.replace(/\/+$/, "")}/copied-cmd-${config.mode}-${config.mask}.exe`;
  const source = "/mnt/c/Windows/System32/cmd.exe";
  const setup = await exec(`cp -- ${quote(source)} ${quote(executable)} && chmod u+x -- ${quote(executable)}`, "danger-full-access");
  if (setup.exitCode !== 0) return ["INCONCLUSIVE: could not copy the Windows executable into the probe workspace"];

  const launch = `${quote(executable)} /d /v:off /c echo DSH_INTEROP_PROBE '>' ${quote(marker)}`;
  const baseline = await exec(launch, "danger-full-access");
  if (baseline.exitCode !== 0 || !existsSync(marker) || readFileSync(marker, "utf8").trim() !== "DSH_INTEROP_PROBE") {
    return ["INCONCLUSIVE: the copied Windows executable could not create the marker outside the sandbox"];
  }
  unlinkSync(marker);

  const result = await exec(launch, "workspace-write");
  checkSandboxFacts(result, config, failures);
  if (result.exitCode !== 0 || !existsSync(marker) || readFileSync(marker, "utf8").trim() !== "DSH_INTEROP_PROBE") {
    failures.push(`the copied executable did not demonstrate interop escape: exit=${String(result.exitCode)}`);
  }
  return failures;
}

/**
 * @param {Context} ctx - Harness context.
 * @param {ProbeConfig} config - Probe configuration from the overlay.
 */
export default function interopShellProbe(ctx, config) {
  ctx.inject(["shell"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * @param {Context} ctx - Harness context with the shell service.
 * @param {ProbeConfig} config - Probe configuration from the overlay.
 */
async function run(ctx, config) {
  /** @type {string[]} */
  const failures = [];
  let temporary;
  try {
    temporary = mkdtempSync(join(tmpdir(), "dsh interop probe-"));
    const marker = join(temporary, "marker.txt");
    /** @type {ProbeExec} */
    const exec = async (command, mode) => {
      const request = ctx.shell.resolve({
        command,
        workdir: config.workspaceRoot,
        sandboxPolicy: { mode, workspaceRoot: config.workspaceRoot },
      });
      const execution = await ctx.shell.execute(request);
      return execution.result();
    };
    failures.push(...await runInteropChecks(exec, config, marker));
    failures.push(...await runCopiedInteropChecks(exec, config, join(temporary, "copied-marker.txt")));
  } catch (error) {
    failures.push(`probe error: ${String(error)}`);
  } finally {
    if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true });
  }
  const lines = failures.map((failure) => `INTEROPPROBE FAIL ${failure}`);
  if (failures.length === 0) lines.push(`INTEROPPROBE PASS ${config.mode} ${config.mask}: drive and copied executable baselines, sandbox facts and Windows-side markers verified`);
  lines.push(`INTEROPPROBE RESULT: ${failures.length === 0 ? "pass" : "fail"} ${config.mode} ${config.mask}`);
  try {
    writeFileSync(config.report, `${lines.join("\n")}\n`);
  } catch (error) {
    console.error(`INTEROPPROBE report write failed: ${String(error)}`);
    process.exit(1);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
