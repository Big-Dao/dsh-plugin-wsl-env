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

export default function missingWslProbe(ctx, config) {
  ctx.inject(["shell"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Ask for one confined command, one escalated command, and report what came back.
 * @param ctx - the context carrying the injected `ctx.shell`.
 * @param config - the overlay's missing path, writable root and report path.
 */
async function run(ctx, config) {
  const lines = [];
  const failures = [];
  const report = (line) => {
    lines.push(`MISSINGWSL ${line}`);
    console.log(`MISSINGWSL ${line}`);
  };
  const check = (name, ok, detail = "") => {
    report(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `  — ${detail}`}`);
    if (!ok) failures.push(name);
  };
  const attempt = async (mode) => {
    try {
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
    const message = String(confined.error.message ?? "");
    check("the failure names the executable", message.includes(config.missingWsl), message.slice(0, 96));
    check("it points at wslPath", /wslPath/.test(message), "");
    check("it is not dressed up as a sandbox refusal", confined.error.code !== "SANDBOX_UNAVAILABLE", `code=${String(confined.error.code)}`);
    check("no sandbox facts are claimed for the failed run", confined.error.sandbox === undefined, "");
  }

  const escalated = await attempt("danger-full-access");
  check(
    "an escalated command fails the same way, not as a refusal",
    escalated.error !== undefined && escalated.error.code !== "SANDBOX_UNAVAILABLE",
    escalated.error === undefined ? `it settled: exit=${escalated.settled?.exitCode}` : `code=${String(escalated.error.code)}`,
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
