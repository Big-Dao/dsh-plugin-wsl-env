/**
 * The Linux-side confinement this plugin applies to commands that run inside a
 * distro.
 *
 * ## Why this is not `ctx.sandbox`
 *
 * DSH's local sandbox provider selects its runner chain by `process.platform`.
 * This harness process is Windows, so it selects the windows-acl runner — and
 * that runner's restricted, low-integrity token **cannot reach WSL at all**
 * (`wsl.exe` fails with `Wsl/E_ACCESSDENIED`). The confinement that governs a
 * distro command therefore has to be *built* on the host and *executed* inside
 * the distro, which is what this module produces: an argv whose program is
 * `bwrap`, handed to `wsl.exe --exec` like any other distro command.
 *
 * Consuming the seam is deliberately not part of this: `dsh-tool-bash` reads
 * `ctx.shell.sandboxMode` (the executor's capability fact) plus
 * `ctx.sandboxPolicy`, and never asks `ctx.sandbox` for anything. A WSL
 * executor can therefore own its confinement without shadowing the
 * composition-level provider that host sessions still need.
 *
 * ## Fidelity to the upstream Linux rung
 *
 * The profile arguments, the denial dialect and the runner-failure rules mirror
 * `@deepseek-ai/dsh-sandbox-local`'s `bwrap` rung, so a denial reads the same to
 * the tool layer whether the command ran on a Linux host or inside a distro.
 * The one deliberate difference is {@link ENFORCEMENT}: see its doc.
 *
 * @module dsh-plugin-wsl/sandbox
 */

import { SandboxUnavailableError } from "@deepseek-ai/dsh-sandbox";
import { toLinuxPath } from "./paths.js";
import { runCapture } from "./wsl.js";

/**
 * bwrap's denial dialect: a write outside the granted mounts fails with EROFS,
 * whose message is "Read-only file system". Classified case-insensitively.
 */
const DENIAL_SIGNATURES = ["read-only file system"];

/**
 * Runner-side diagnostics. Bubblewrap reports its own failures with a `bwrap: `
 * prefix and exits 1; exit status alone never proves runner failure (the
 * upstream rule is signature-only for exactly that reason), so a confined
 * command that merely prints the signature is not misread as "never ran".
 */
const RUNNER_FAILURE_RULES = [{ fatalSignatures: ["bwrap: "] }];

/**
 * Enforcement is **partial**, not `full` like upstream's Linux rung.
 *
 * `SandboxMode` governs file effects. A Linux process under bwrap is fully
 * governed — but a WSL distro process can execute a *Windows* binary through
 * interop (`/mnt/c/**\*.exe`), and that Windows process runs outside the Linux
 * sandbox entirely, under the user's ordinary Windows token: it can write
 * anywhere the user can. `npm run probe:sandbox` demonstrates it. Claiming
 * `full` would advertise a boundary that does not hold, so the provider reports
 * the honest `partial` and README states where the hole is.
 */
const ENFORCEMENT = "partial";

/** Probe verdicts, keyed by `wslPath\0distro`; the probe spawns once per pair. */
const probeVerdicts = new Map();

/**
 * Build the bwrap profile arguments for one file-effect policy, exactly as
 * upstream's `bwrapProfileArgs` does.
 *
 * `--ro-bind / /` makes the whole distro read-only, `--dev /dev` supplies the
 * `/dev/null` sink a shell needs, `--unshare-pid` keeps the sandbox's process
 * view its own, and `--proc /proc` gives it a matching `/proc`. Under
 * `workspace-write` the workspace is bound read-write and `/tmp` becomes an
 * ephemeral tmpfs — the temp area the mode promises, without exposing the
 * distro's real `/tmp`.
 *
 * @param policy - the policy to express as bwrap mounts.
 * @returns profile arguments, before the `--` separator and the command argv.
 */
export function bwrapProfileArgs(policy) {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc", "--die-with-parent"];
  if (policy.mode === "workspace-write") {
    args.push("--tmpfs", "/tmp");
    args.push("--bind", policy.workspaceRoot, policy.workspaceRoot);
  }
  return args;
}

/**
 * Confine commands inside one distro with `bwrap`.
 *
 * The policy's `workspaceRoot` arrives in whichever coordinate system the
 * caller speaks — a session workspace is a UNC path — and is translated into the
 * Linux path `bwrap` must bind inside the distro.
 */
export class WslSandbox {
  /**
   * @param config - the `wsl.exe` path, overridable for a non-standard install.
   */
  constructor(config = {}) {
    this.wslPath = config.wslPath ?? "wsl.exe";
  }

  /**
   * Whether `bwrap` can create a profile inside this distro, probed once per
   * (`wslPath`, distro) pair. The probe mirrors upstream's: apply the real
   * read-only profile around `true`, and treat a zero exit as the kernel having
   * accepted and enforced it. A missing `bwrap` fails the spawn and probes
   * unusable, which is what makes the provider fail closed rather than silently
   * run unconfined.
   *
   * @param distro - the distro to probe.
   * @param signal - optional cancellation.
   * @returns true when a confined command can run there.
   */
  async usable(distro, signal) {
    const key = `${this.wslPath}\u0000${distro}`;
    const cached = probeVerdicts.get(key);
    if (cached !== undefined) return cached;
    let verdict = false;
    try {
      const profile = bwrapProfileArgs({ mode: "read-only", workspaceRoot: "/" });
      await runCapture([this.wslPath, "-d", distro, "--exec", "bwrap", ...profile, "--", "true"], signal);
      verdict = true;
    } catch {
      verdict = false;
    }
    probeVerdicts.set(key, verdict);
    return verdict;
  }

  /**
   * Wrap one distro-side argv in the bwrap profile the policy asks for.
   *
   * @param argv - the argv to run INSIDE the distro (shell, its flags, command).
   * @param policy - the resolved confined policy (`mode` is never
   *   `danger-full-access`; the caller does not confine that case at all).
   * @param options - the distro to run in and optional cancellation.
   * @returns the wrapped argv plus the settlement-classification facts, in the
   *   seam's `ConfinedArgv` shape.
   * @throws SandboxUnavailableError when the distro has no usable `bwrap`, so a
   *   requested confinement never degrades into an unconfined run.
   */
  async confine(argv, policy, options) {
    const { distro, signal } = options;
    if (!(await this.usable(distro, signal))) {
      throw new SandboxUnavailableError(
        policy.mode,
        `bwrap is not usable inside distro "${distro}" (install it: sudo apt install bubblewrap)`,
      );
    }
    const workspaceRoot = toLinuxPath(policy.workspaceRoot, { distro });
    const profile = bwrapProfileArgs({ ...policy, workspaceRoot });
    return {
      argv: ["bwrap", ...profile, "--", ...argv],
      enforcement: ENFORCEMENT,
      denialSignatures: DENIAL_SIGNATURES,
      runnerFailureRules: RUNNER_FAILURE_RULES,
    };
  }
}

export default WslSandbox;
