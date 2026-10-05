/**
 * Behavioural probe for the WSL shell executor's confinement.
 *
 * The bwrap profile itself is measured without a harness by
 * `test/probe/sandbox.sh`; this probe measures the *wiring*: that
 * `ctx.shell.sandboxMode` advertises the mode, that `resolve()` carries the
 * per-call policy into `execute()`, that a request defaulting its workdir
 * lands on the distro user's home, that the command really is wrapped in
 * `bwrap` inside the distro, and that the tool-facing result carries the
 * denial and enforcement facts `dsh-tool-bash` renders.
 *
 * The report is written to `sandbox-shell-report.txt` beside this module —
 * like `fs-probe.txt`, because the harness process's console does not reach
 * the terminal. `test/probe/sandbox-shell.sh` prints the file and exits with
 * the probe's own status.
 *
 *   node --check test/probe/sandbox-shell-probe.mjs
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
 * @typedef {{ workspaceRoot: string, outside: string, home: string, report?: string }} ProbeConfig
 */

/**
 * The probe's plugin entry: wait for `shell`, then run the checks.
 * @param {Context} ctx - the probe context.
 * @param {ProbeConfig} config - the overlay's writable root, the outside path to refuse, and the distro home.
 */
export default function shellSandboxProbe(ctx, config) {
  ctx.inject(["shell"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Drive one confined command per mode and report what the seam answered.
 * @param {Context} ctx - the context carrying the injected `ctx.shell`.
 * @param {ProbeConfig} config - the overlay's writable root, the outside path to refuse, and
 *   the distro home a defaulted workdir must land on.
 */
async function run(ctx, config) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} line - the line to record. */
  const report = (line) => {
    lines.push(`SHELLPROBE ${line}`);
    console.log(`SHELLPROBE ${line}`);
  };
  /** @type {string[]} */
  const failures = [];
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
   * @param {SandboxMode} mode - the mode to run under.
   * @returns {SandboxExecutionPolicy} the per-call policy.
   */
  const policy = (mode) => ({ mode, workspaceRoot: config.workspaceRoot });

  /** Run one command under an explicit policy and settle it. */
  /**
   * @param {string} command - the shell line to run.
   * @param {SandboxMode} mode - the mode to run it under.
   */
  const exec = async (command, mode) => {
    const spec = ctx.shell.resolve({ command, workdir: config.workspaceRoot, sandboxPolicy: policy(mode) });
    const execution = await ctx.shell.execute(spec);
    return execution.result();
  };

  /** Run one command that DEFAULTS its workdir, and settle it. */
  /**
   * @param {string} command - the shell line to run.
   * @param {string|undefined} workdir - the workdir to request, or undefined to default it.
   * @param {SandboxMode} mode - the mode to run it under.
   * @param {number} [timeoutMs] - the deadline, when the check needs one.
   */
  const execDefaulted = async (command, workdir, mode, timeoutMs) => {
    const request = /** @type {Parameters<Context["shell"]["resolve"]>[0]} */ ({ command, sandboxPolicy: policy(mode) });
    if (workdir !== undefined) request.workdir = workdir;
    if (timeoutMs !== undefined) request.timeoutMs = timeoutMs;
    const execution = await ctx.shell.execute(ctx.shell.resolve(request));
    return execution.result();
  };

  /** The distro-side view of a path, without going through the executor. */
  /**
   * @param {string} path - the distro path to test.
   * @returns {Promise<boolean>} whether the path exists in the distro.
   */
  const exists = async (path) => (await exec(`test -e ${path} && echo yes || echo no`, "danger-full-access")).stdout.text.includes("yes");

  try {
    // The capability fact the tool layer reads to advertise escalation.
    check("sandboxMode is advertised", ctx.shell.sandboxMode === "workspace-write", `sandboxMode=${String(ctx.shell.sandboxMode)}`);

    // A workspace-write profile binds the root read-write, and `bwrap` refuses a
    // bind whose source does not exist — so the root must exist before it can be
    // granted. Creating it runs unconfined on purpose: that is the same
    // approved-escalation path an operator uses, and it keeps the assertions
    // below about confinement rather than about a missing directory.
    // It runs from the distro home rather than from the root it is creating: a
    // directory that does not exist yet cannot be entered, and the provider now
    // reports that as a failure instead of letting the command run in `/` — the
    // assertion further down pins exactly that.
    const setup = await execDefaulted(`mkdir -p ${config.workspaceRoot}`, config.home, "danger-full-access");
    check("the writable root exists before it is granted", setup.exitCode === 0, `exit=${setup.exitCode} stderr=${JSON.stringify(setup.stderr.text.slice(0, 120))}`);

    // The default workdir. The profile configures no `cwd`, so a request that
    // names no directory — or names it only RELATIVELY — is placed by the
    // provider's own default: the distro user's home. This is the branch
    // `resolve()`/`withDefaultWorkdir` own, and the profile leaves it un-pinned
    // precisely so this probe is the one that pins it.
    const homePwd = await execDefaulted("pwd", undefined, "danger-full-access");
    check("a request with no workdir lands in the distro home", homePwd.exitCode === 0 && homePwd.stdout.text.trim() === config.home, `pwd=${JSON.stringify(homePwd.stdout.text.trim())} home=${JSON.stringify(config.home)}`);
    const tail = config.workspaceRoot.split("/").pop() ?? "";
    const relativePwd = await execDefaulted("pwd", tail, "danger-full-access");
    check("a relative workdir is joined under the distro home", relativePwd.exitCode === 0 && relativePwd.stdout.text.trim() === `${config.home}/${tail}`, `pwd=${JSON.stringify(relativePwd.stdout.text.trim())} expected=${JSON.stringify(`${config.home}/${tail}`)}`);

    // `wsl.exe --cd <missing>` does not fail: it warns on stderr, runs the command in
    // `/`, and exits 0. A command that ran somewhere else must not be reported as a
    // success, so the provider turns that shape into an error naming the directory.
    const absentWorkdir = `${config.workspaceRoot}/absent-dir`;
    /** @type {unknown} */
    let wrongDir;
    try {
      await execDefaulted("pwd", absentWorkdir, "danger-full-access");
    } catch (error) {
      wrongDir = error;
    }
    check(
      "a workdir that does not exist fails instead of running in /",
      wrongDir !== undefined && String((/** @type {Error} */ (wrongDir)).message).includes(absentWorkdir),
      wrongDir === undefined ? "it settled as a success" : String((/** @type {Error} */ (wrongDir)).message).slice(0, 120),
    );

    // workspace-write grants the root.
    const inside = await exec(`echo ok > ${config.workspaceRoot}/inside.txt && cat ${config.workspaceRoot}/inside.txt`, "workspace-write");
    check("workspace-write runs inside the workspace", inside.exitCode === 0 && inside.stdout.text.includes("ok"), `exit=${inside.exitCode} stderr=${JSON.stringify(inside.stderr.text.slice(0, 120))}`);
    check("the result carries the mode and enforcement", inside.sandbox?.mode === "workspace-write" && inside.sandbox?.enforcement === "partial", `sandbox=${JSON.stringify(inside.sandbox)}`);

    // workspace-write refuses everything else, in bwrap's dialect.
    const denied = await exec(`echo x > ${config.outside}`, "workspace-write");
    check("workspace-write refuses a write outside the workspace", denied.exitCode !== 0, `exit=${denied.exitCode}`);
    check("the refusal is classified as a denial", denied.sandbox?.denied === true, `sandbox=${JSON.stringify(denied.sandbox)}`);
    check("the refusal speaks bwrap's dialect", /read-only file system/i.test(denied.stderr.text), JSON.stringify(denied.stderr.text.slice(0, 120)));
    check("the refused write left no file", (await exists(config.outside)) === false);

    // read-only refuses even the granted root.
    const readOnly = await exec(`echo x > ${config.workspaceRoot}/refused.txt`, "read-only");
    check("read-only refuses a write inside the workspace", readOnly.exitCode !== 0 && readOnly.sandbox?.denied === true, `exit=${readOnly.exitCode} sandbox=${JSON.stringify(readOnly.sandbox)}`);

    // danger-full-access is the approved escalation and is not wrapped.
    const escalated = await exec(`echo x > ${config.outside} && cat ${config.outside}`, "danger-full-access");
    check("danger-full-access is not confined", escalated.exitCode === 0 && escalated.stdout.text.includes("x"), `exit=${escalated.exitCode} stderr=${JSON.stringify(escalated.stderr.text.slice(0, 120))}`);

    // A command that outlives its deadline must not leave a process behind in the
    // distro. The escalated path is the conservative case: a confined command also
    // dies with its `bwrap` parent, so this one relies on the subprocess service's
    // kill actually reaching the distro. The count is scoped to this probe's own
    // command line on purpose — the distro legitimately holds other `sleep`s (the
    // resident agent's lease watchdog among them), and a global `pgrep -x sleep`
    // measures those instead of the kill under test.
    const killed = await execDefaulted("sleep 137", config.home, "danger-full-access", 1500);
    check("a command past its deadline is reported as timed out", killed.timedOut === true || killed.exitCode !== 0, `timedOut=${String(killed.timedOut)} exit=${killed.exitCode}`);
    let survivors = "?";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const counted = await execDefaulted("pgrep -f '^sleep 137$' | wc -l", config.home, "danger-full-access");
      survivors = counted.stdout.text.trim();
      if (survivors === "0") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    check("a killed command leaves no process behind in the distro", survivors === "0", `pgrep -f '^sleep 137$' = ${survivors}`);

    // Clean up through the unconfined path: the sandbox cannot remove what it
    // never wrote.
    await exec(`rm -rf ${config.workspaceRoot} ${config.outside}`, "danger-full-access");
  } catch (error) {
    check("the probe ran to completion", false, String((/** @type {Error} */ (error))?.stack ?? error));
  }

  report(failures.length === 0 ? "RESULT: all checks passed" : `RESULT: ${failures.length} check(s) failed`);
  try {
    // The report lands at the path the overlay hands in — an absolute UNC path
    // into the checkout's probe directory, where sandbox-shell.sh reads it
    // back. The fallback beside the module only exists for a direct `node`
    // run; the overlay's path is what makes the report deterministic, because
    // the harness process's console does not reach the terminal and a relative
    // name would resolve against an unknown base.
    const destination =
      typeof config.report === "string" && config.report.length > 0 ? config.report : join(PROBE_DIR, "sandbox-shell-report.txt");
    writeFileSync(destination, `${lines.join("\n")}\n`);
  } catch (error) {
    console.log(`SHELLPROBE report write failed: ${String(error)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
