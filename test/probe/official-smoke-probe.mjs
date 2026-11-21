/**
 * Probe: the official-package smoke's through-plugin checks.
 *
 * The package smoke composes the tarball-installed plugin into the official
 * Desktop profile. Composition alone proves nothing about the plugin's
 * runtime seams, so this probe drives the three the design's minimum subset
 * names: one shell command through the plugin's WSL shell executor, one
 * workspace file operation through the routed filesystem, and one confined
 * command that the sandbox policy must refuse. A failure in the agent
 * bootstrap, the FS routing, or the bwrap chain therefore fails the smoke
 * instead of passing it green.
 *
 * The official-package smoke appends an overlay row pointing at this module to
 * the profile's `cordis.patch.yml` before starting the Desktop app, and polls
 * for the report this probe writes. Like the other probes, findings go to a
 * file because the harness process's console does not reach the terminal.
 *
 * @module dsh-plugin-wsl/test/probe/official-smoke-probe
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Type-only imports: the harness context and the policy vocabulary this probe drives.
 * @import { Context } from "@deepseek-ai/cordis";
 * @import { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
 */

/**
 * The probe's config, as the smoke's overlay composes it. The workspace root
 * and the refusal target sit under the distro HOME: workspace-write mounts an
 * ephemeral tmpfs over /tmp (the mode's promised temp area, where a write is
 * accepted by design), so a refusal can only be witnessed in the read-only
 * HOME.
 * @typedef {{
 *   distro: string,
 *   root: string,
 *   outside: string,
 *   report: string,
 * }} ProbeConfig
 */

/**
 * Drive the three through-plugin checks once the services are up.
 * @param {Context} ctx - the composed profile's context.
 * @param {ProbeConfig} config - the overlay's distro, POSIX workspace root,
 *   POSIX outside path, and the Windows report path.
 */
export default function officialSmokeProbe(ctx, config) {
  ctx.inject(["shell", "fs"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * The UNC spelling of a POSIX path inside the distro, for the harness
 * process's filesystem APIs. The distro name must be followed by a
 * backslash: `\\wsl.localhost\<distro>/tmp/…` parses as the distro
 * `<distro>/tmp/…` and the path `/`, because the plugin's UNC parsing takes
 * the separator it meets first — every `/` below the distro must be a `\`.
 * @param {string} distro - the distro name.
 * @param {string} posixPath - absolute POSIX path inside the distro.
 * @returns {string} the UNC path spelling for the filesystem backend.
 */
export function uncFor(distro, posixPath) {
  return `\\\\wsl.localhost\\${distro}${posixPath.replaceAll("/", "\\")}`;
}

/**
 * Run one check, recording a thrown error instead of aborting the run.
 * @param {string[]} lines - the report lines, mutated in place.
 * @param {(ok: boolean, detail?: string) => void} record - the check's verdict sink.
 * @param {string} name - the check's report name.
 * @param {() => Promise<string>} body - the check; resolves with evidence detail.
 */
async function step(lines, record, name, body) {
  try {
    const detail = await body();
    lines.push(`PASS ${name}${detail === "" ? "" : ` — ${detail}`}`);
    record(true);
  } catch (error) {
    const coded = /** @type {Error & {code?: string}} */ (error);
    lines.push(`FAIL ${name} — ${coded.code ?? coded.name ?? "Error"}: ${coded.message ?? String(error)}`);
    record(false);
  }
}

/**
 * Run the three checks and write the report.
 * @param {Context} ctx - the context carrying `ctx.shell` and `ctx.fs`.
 * @param {ProbeConfig} config - the overlay's config.
 */
async function run(ctx, config) {
  /** @type {string[]} */
  const lines = [];
  let failures = 0;
  /** @param {boolean} ok */
  const record = (ok) => {
    if (!ok) failures += 1;
  };

  /**
   * Run one command under an explicit policy and settle it.
   * @param {string} command - the shell line to run.
   * @param {SandboxExecutionPolicy} policy - the per-call policy.
   * @param {string} [workdir] - the directory to run in; omitted means the
   *   provider's own default (the distro home on this profile), which is what
   *   the setup needs: it creates the root it would otherwise be run from.
   */
  const exec = async (command, policy, workdir) => {
    const request = /** @type {Parameters<Context["shell"]["resolve"]>[0]} */ ({ command, sandboxPolicy: policy });
    if (workdir !== undefined) request.workdir = workdir;
    const execution = await ctx.shell.execute(ctx.shell.resolve(request));
    return execution.result();
  };

  /** @returns {SandboxExecutionPolicy} the workspace-write grant over the POSIX probe root — the shell's sandbox binds distro paths. */
  const confined = () => ({ mode: "workspace-write", workspaceRoot: config.root });

  /** @returns {SandboxExecutionPolicy} the same grant for the filesystem backend, whose targets are UNC paths. */
  const fsConfined = () => ({ mode: "workspace-write", workspaceRoot: uncFor(config.distro, config.root) });

  try {
    // The workspace root must exist before a workspace-write policy can grant
    // it (bwrap refuses a bind whose source is missing), so the setup creates
    // it — running from the provider's default directory, because the root it
    // creates cannot also be the directory the command starts in. Like the
    // operators' approved escalation in sandbox-shell-probe.
    const setup = await exec(`mkdir -p ${config.root}`, { mode: "danger-full-access", workspaceRoot: config.root });
    if (setup.exitCode !== 0) throw new Error(`mkdir -p ${config.root} exited ${setup.exitCode}: ${setup.stderr.text.slice(0, 120)}`);
  } catch (error) {
    // A setup failure must surface as a FAIL line: a report with no FAIL rows
    // and no steps would otherwise read as a pass to the smoke's poller.
    failures += 1;
    const coded = /** @type {Error & {code?: string}} */ (error);
    lines.push(`FAIL probe-setup — ${coded.code ?? coded.name ?? "Error"}: ${coded.message ?? String(error)}`);
  }
  try {
    await step(lines, record, "a command runs through the plugin's WSL shell", async () => {
      const out = await exec("echo dsh-smoke-plugin", confined(), config.root);
      if (out.exitCode !== 0) throw new Error(`exited ${out.exitCode}: ${out.stderr.text.slice(0, 120)}`);
      if (!out.stdout.text.includes("dsh-smoke-plugin")) throw new Error(`unexpected output ${JSON.stringify(out.stdout.text.slice(0, 120))}`);
      return `mode=${out.sandbox?.mode ?? "none"} enforcement=${out.sandbox?.enforcement ?? "none"}`;
    });

    await step(lines, record, "a workspace file operation routes through the plugin", async () => {
      const unc = uncFor(config.distro, `${config.root}/probe-fs.txt`);
      const target = await ctx.fs.resolve(unc);
      await ctx.fs.writeText(target, "dsh-smoke-fs", undefined, undefined, fsConfined());
      const read = await ctx.fs.readText(await ctx.fs.resolve(unc));
      if (read !== "dsh-smoke-fs") throw new Error(`read-back mismatch: ${JSON.stringify(read.slice(0, 120))}`);
      return unc;
    });

    await step(lines, record, "a confined command outside the workspace is refused", async () => {
      const denied = await exec(`echo x > ${config.outside}`, confined(), config.root);
      if (denied.exitCode === 0) throw new Error("the write outside the workspace was accepted");
      if (denied.sandbox?.denied !== true) throw new Error(`not classified as a denial: ${JSON.stringify(denied.sandbox)}`);
      return JSON.stringify(denied.stderr.text.slice(0, 120));
    });
  } finally {
    lines.push(failures === 0 ? "RESULT: all steps passed" : `RESULT: ${failures} step(s) failed`);
    mkdirSync(dirname(config.report), { recursive: true });
    writeFileSync(config.report, `${lines.join("\n")}\n`, "utf8");
  }
}
