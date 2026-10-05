/**
 * Behavioural probe for a `wslPath` that cannot start.
 *
 * A mistyped `wslPath`, or a machine with no WSL, must produce a failure an operator
 * can act on: the executable is named, `wslPath` is suggested, the failure is not
 * reported as a sandbox refusal, and no sandbox facts are claimed for a command that
 * never ran. None of that was covered before this probe existed.
 *
 * The report is written beside this module; `test/probe/missing-wsl.sh` prints it and
 * exits with this probe's status.
 *
 *   node --check test/probe/missing-wsl-probe.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROBE_DIR } from "./env.mjs";

/**
 * Type-only imports: the harness context and the policy vocabulary this probe drives.
 * @import { Context } from "@deepseek-ai/cordis";
 * @import { SandboxExecutionPolicy, SandboxMode } from "@deepseek-ai/dsh-sandbox";
 */

/**
 * The probe's config, as the overlay composes it.
 * @typedef {{ missingWsl: string, workspaceRoot: string, report?: string }} ProbeConfig
 */

/** What a failed step throws: the ordinary `Error` surface plus its optional facts. */
/** @typedef {Error & {code?: string, sandbox?: unknown}} CodedError */

/**
 * One attempt's outcome: the settled result, or the thrown value.
 * @typedef {{ settled?: {exitCode?: number|null}|undefined, error?: unknown }} Attempt
 */

/**
 * The probe's plugin entry: wait for `shell`, then run the checks.
 * @param {Context} ctx - the probe context.
 * @param {ProbeConfig} config - the overlay's missing path, writable root and report path.
 */
export default function missingWslProbe(ctx, config) {
  ctx.inject(["shell"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Ask for one confined command, one escalated command, and report what came back.
 * @param {Context} ctx - the context carrying the injected `ctx.shell`.
 * @param {ProbeConfig} config - the overlay's missing path, writable root and report path.
 */
async function run(ctx, config) {
  /** @type {string[]} */
  const lines = [];
  /** @type {string[]} */
  const failures = [];
  /** @param {string} line - the line to record. */
  const report = (line) => {
    lines.push(`MISSINGWSL ${line}`);
    console.log(`MISSINGWSL ${line}`);
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
  /**
   * @param {SandboxMode} mode - the sandbox mode to request.
   * @returns {Promise<Attempt>} the settled result or the refusal.
   */
  const attempt = async (mode) => {
    try {
      /** @type {SandboxExecutionPolicy} */
      const policy = { mode, workspaceRoot: config.workspaceRoot };
      const execution = await ctx.shell.execute(ctx.shell.resolve({ command: "echo ran", sandboxPolicy: policy }));
      return { settled: await execution.result() };
    } catch (error) {
      return { error };
    }
  };

  check("a mode is advertised for a row that confines by configuration", ctx.shell.sandboxMode !== undefined, `sandboxMode=${String(ctx.shell.sandboxMode)}`);

  const confined = await attempt("workspace-write");
  if (confined.error === undefined) {
    check("a command with an unusable executable fails", false, `it settled: exit=${confined.settled?.exitCode}`);
  } else {
    const failure = /** @type {CodedError} */ (confined.error);
    const message = String(failure.message ?? "");
    check("the failure names the executable", message.includes(config.missingWsl), message.slice(0, 96));
    check("it points at wslPath", /wslPath/.test(message), "");
    check("it is not dressed up as a sandbox refusal", failure.code !== "SANDBOX_UNAVAILABLE", `code=${String(failure.code)}`);
    check("no sandbox facts are claimed for the failed run", failure.sandbox === undefined, "");
  }

  const escalated = await attempt("danger-full-access");
  check(
    "an escalated command fails the same way, not as a refusal",
    escalated.error !== undefined && (/** @type {CodedError} */ (escalated.error)).code !== "SANDBOX_UNAVAILABLE",
    escalated.error === undefined ? `it settled: exit=${escalated.settled?.exitCode}` : `code=${String((/** @type {CodedError} */ (escalated.error)).code)}`,
  );

  report(failures.length === 0 ? "RESULT: all checks passed" : `RESULT: ${failures.length} check(s) failed`);
  try {
    const destination = typeof config.report === "string" && config.report.length > 0 ? config.report : join(PROBE_DIR, "missing-wsl-report.txt");
    writeFileSync(destination, `${lines.join("\n")}\n`);
  } catch (error) {
    console.log(`MISSINGWSL report write failed: ${String(error)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
