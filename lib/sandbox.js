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
import { createProbeCache } from "./probe-cache.js";
import { toLinuxPath } from "./paths.js";
import { runCapture } from "./wsl.js";
import { bwrapArgvPrefix, bwrapProfileArgs } from "./bwrap.js";

// The profile and the argv prefix are also what `lib/agent-confined.js` builds
// for its residents, so both live in the peer-free `lib/bwrap.js` and are
// re-exported here, where the sandbox's callers have always found them.
export { bwrapProfileArgs };

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

/**
 * The one mitigation the profile can offer, and its honest ceiling.
 *
 * `maskWindowsDrive` mounts an empty tmpfs over `/mnt`: the Windows drive's
 * files vanish from the command's view, which takes the drive's data off the
 * table and makes the on-drive executables unreachable. It does NOT make the
 * run `full`: binfmt interop dispatches on file CONTENT, so a command that can
 * write the workspace (which `workspace-write` grants) can write a PE there
 * and execute it — binfmt launches it as a Windows process outside the Linux
 * sandbox regardless of where the file sits. The only complete closures are
 * distro-level (`[interop] enabled=false` in `wsl.conf`, which costs every
 * legitimate interop user their tooling) — so the provider reports `partial`
 * either way, and the mask is a decision an operator makes to shrink the hole,
 * recorded as the `windowsDrive: "masked"` fact the model can see.
 */

/**
 * Probe verdicts, keyed by `wslPath\0distro`. The policy — a success is durable, a
 * failure is re-probed, concurrent probes are shared — lives in `probe-cache.js`,
 * where it is unit-testable without the peers this module needs.
 */
const probeVerdicts = createProbeCache();

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
   * @param config.maskWindowsDrive - shadow `/mnt` with an empty tmpfs in every
   *   profile this sandbox builds, hiding the Windows drive from confined
   *   commands (see the module doc above {@link ENFORCEMENT} for what that
   *   does and does not close).
   */
  constructor(config = {}) {
    this.wslPath = config.wslPath ?? "wsl.exe";
    this.maskWindowsDrive = config.maskWindowsDrive ?? false;
  }

  /**
   * Whether `bwrap` can create a profile inside this distro. The probe mirrors
   * upstream's: apply the real read-only profile around `true`, and treat a zero
   * exit as the kernel having accepted and enforced it. A missing `bwrap` fails the
   * spawn and probes unusable, which is what makes the provider fail closed rather
   * than silently run unconfined.
   *
   * A success is remembered for the process lifetime; a failure is not, so a
   * `bubblewrap` installed while the app is running is believed on the next
   * command.
   *
   * @param distro - the distro to probe.
   * @param signal - optional cancellation.
   * @returns true when a confined command can run there.
   */
  async usable(distro, signal) {
    const key = `${this.wslPath}\u0000${distro}`;
    return probeVerdicts.run(key, async () => {
      const prefix = bwrapArgvPrefix({ mode: "read-only", workspaceRoot: "/" });
      await runCapture([this.wslPath, "-d", distro, "--exec", ...prefix, "true"], signal);
      return true;
    });
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
        `bwrap is not usable inside distro "${distro}". Install it with ` +
          `"scripts/bootstrap.sh ${distro} --install" (from the package), or directly: ` +
          `wsl.exe -d ${distro} -u root -- apt-get install -y bubblewrap`,
      );
    }
    const workspaceRoot = toLinuxPath(policy.workspaceRoot, { distro });
    const prefix = bwrapArgvPrefix({ ...policy, workspaceRoot }, { maskWindowsDrive: this.maskWindowsDrive });
    return {
      argv: [...prefix, ...argv],
      enforcement: ENFORCEMENT,
      denialSignatures: DENIAL_SIGNATURES,
      runnerFailureRules: RUNNER_FAILURE_RULES,
      windowsDrive: this.maskWindowsDrive ? "masked" : "visible",
    };
  }
}

export default WslSandbox;
