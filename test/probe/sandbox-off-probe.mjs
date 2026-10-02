/**
 * Behavioural probe for the documented opt-out: `sandbox: false` on both providers.
 *
 * The documentation promises that `sandboxMode` then returns `undefined` and that the
 * tool layer tells the model these operations are not confined. It also has to be
 * distinguishable from a backend that is merely broken, which is the state
 * `test/probe/missing-wsl.sh` covers. Both are asserted here, or the two would look
 * alike from the outside.
 *
 * The report is written beside this module; `test/probe/sandbox-off.sh` prints it and
 * exits with this probe's status.
 *
 *   node --check test/probe/sandbox-off-probe.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROBE_DIR } from "./env.mjs";

export default function sandboxOffProbe(ctx, config) {
  ctx.inject(["shell", "fs"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Prove the absence of confinement on both providers, then clean up.
 * @param ctx - the context carrying the injected `ctx.shell` and `ctx.fs`.
 * @param config - the overlay's outside path and report path.
 */
async function run(ctx, config) {
  const lines = [];
  const failures = [];
  const report = (line) => {
    lines.push(`SANDBOXOFF ${line}`);
    console.log(`SANDBOXOFF ${line}`);
  };
  const check = (name, ok, detail = "") => {
    report(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `  — ${detail}`}`);
    if (!ok) failures.push(name);
  };

  check("the shell provider stops advertising a mode", ctx.shell.sandboxMode === undefined, `sandboxMode=${String(ctx.shell.sandboxMode)}`);
  check("the filesystem provider stops advertising a mode", ctx.fs.sandboxMode === undefined, `sandboxMode=${String(ctx.fs.sandboxMode)}`);

  // A shell write outside any workspace root: refused under workspace-write, and the
  // point of the opt-out is that it now happens.
  try {
    const execution = await ctx.shell.execute(ctx.shell.resolve({ command: `echo unconfined > ${config.outside} && cat ${config.outside}` }));
    const result = await execution.result();
    check("a command outside the workspace runs", result.exitCode === 0 && result.stdout.text.includes("unconfined"), `exit=${result.exitCode} stderr=${JSON.stringify(result.stderr.text.slice(0, 80))}`);
    check("the shell result claims no sandbox", result.sandbox === undefined, `sandbox=${JSON.stringify(result.sandbox)}`);
  } catch (error) {
    check("a command outside the workspace runs", false, `${error?.code ?? error?.name}: ${error?.message}`);
  }

  // The filesystem fence: with no policy passed at all, a write outside the root would
  // be `FS_SANDBOX_DENIED` under `sandbox: true`. Here it must succeed.
  const target = `${config.outside}.fs`;
  try {
    const resolved = await ctx.fs.resolve(target);
    const written = await ctx.fs.writeText(resolved, "unconfined\n");
    const text = await ctx.fs.readText(resolved);
    check("a write outside the workspace root is not fenced", written?.operation !== undefined && text === "unconfined\n", `operation=${String(written?.operation)} text=${JSON.stringify(text)}`);
  } catch (error) {
    check("a write outside the workspace root is not fenced", false, `${error?.code ?? error?.name}: ${error?.message}`);
  }

  // Clean up unconfined, since that is all that is available here.
  try {
    await ctx.shell.execute(ctx.shell.resolve({ command: `rm -f ${config.outside} ${target}` })).then((execution) => execution.result());
  } catch {
    /* leftover files are outside every workspace and named after this probe */
  }

  report(failures.length === 0 ? "RESULT: all checks passed" : `RESULT: ${failures.length} check(s) failed`);
  try {
    const destination = typeof config.report === "string" && config.report.length > 0 ? config.report : join(PROBE_DIR, "sandbox-off-report.txt");
    writeFileSync(destination, `${lines.join("\n")}\n`);
  } catch (error) {
    console.log(`SANDBOXOFF report write failed: ${String(error)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
