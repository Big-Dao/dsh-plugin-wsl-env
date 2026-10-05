/**
 * The sandbox's probe and confinement logic, free of DSH peers.
 *
 * `lib/sandbox.js` binds this core to the peer's `SandboxUnavailableError` —
 * the class identity `instanceof` consumers match — which is the ONLY thing
 * that kept the whole policy out of unit tests: a checkout without the peers
 * could not even import the module, so CI skipped every check of the probe
 * caching policy and the argv composition. The core takes the error class as
 * the one injected dependency; the tests inject a stand-in with the same
 * contract (`code: "SANDBOX_UNAVAILABLE"`), and what CI runs is the code that
 * ships.
 *
 * This is a TypeScript source built to `lib/sandbox-core.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/sandbox-core
 */

import { createProbeCache } from "./probe-cache.js";
import { toLinuxPath } from "./paths.js";
import { runCapture } from "./wsl.js";
import { bwrapArgvPrefix } from "./bwrap.js";

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
 * The seam's `ConfinedArgv` settlement facts, plus this core's `windowsDrive`
 * mitigation flag.
 */
export interface WslConfined {
  /** The wrapped argv (bwrap prefix, separator, the caller's argv). */
  argv: string[];
  /**
   * How completely the profile enforces the policy's file effects. Typed as
   * the seam's union (upstream `SandboxEnforcement`) while this core always
   * reports `partial` (see the `ENFORCEMENT` doc above): the value an executor
   * passes through is the seam's, wherever it came from.
   */
  enforcement: "full" | "partial";
  /** The case-insensitive stderr substrings a bwrap denial produces. */
  denialSignatures: string[];
  /** Structured runner-failure evidence rules. */
  runnerFailureRules: Array<{ fatalSignatures: string[], allowedExitCodes?: number[], informationalLines?: string[] }>;
  /** Whether the profile masks the Windows drive at `/mnt`. */
  windowsDrive: "masked" | "visible";
}

/**
 * The sandbox class `createSandboxCore` builds, as its consumers see it.
 */
export interface WslSandboxCoreInstance {
  /** The `wsl.exe` path this instance spawns. */
  wslPath: string;
  /** Whether every profile masks `/mnt`. */
  maskWindowsDrive: boolean;
  /** Probe the distro's `bwrap`. */
  usable: (distro: string, signal?: AbortSignal | undefined) => Promise<boolean>;
  /** Wrap one argv in the profile. */
  confine: (argv: string[], policy: { mode: "read-only" | "workspace-write", workspaceRoot: string }, options: { distro: string, signal?: AbortSignal | undefined }) => Promise<WslConfined>;
}

/**
 * Build the sandbox class, bound to one unavailable-error implementation.
 *
 * @param deps - the injected peer surface.
 * @returns the sandbox class (see `lib/sandbox.js` for the shipped binding).
 */
export function createSandboxCore({ SandboxUnavailableError }: {
  /**
   * The failure type `confine` throws; production binds the peer's class so
   * `instanceof` consumers keep matching, tests bind a stand-in with the same
   * `code`.
   */
  SandboxUnavailableError: new (mode: "read-only" | "workspace-write", detail?: string) => Error,
}): new (config?: { wslPath?: string, maskWindowsDrive?: boolean } | undefined) => WslSandboxCoreInstance {
  return class WslSandboxCore {
    /** The `wsl.exe` path this instance spawns. */
    declare wslPath: string;
    /** Whether every profile masks `/mnt`. */
    declare maskWindowsDrive: boolean;

    /**
     * @param config - the `wsl.exe` path, overridable for a non-standard install.
     */
    constructor(config: { wslPath?: string, maskWindowsDrive?: boolean } = {}) {
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
    async usable(distro: string, signal?: AbortSignal): Promise<boolean> {
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
     * The policy's `workspaceRoot` arrives in whichever coordinate system the
     * caller speaks — a session workspace is a UNC path — and is translated into the
     * Linux path `bwrap` must bind inside the distro.
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
    async confine(argv: string[], policy: { mode: "read-only" | "workspace-write", workspaceRoot: string }, options: { distro: string, signal?: AbortSignal }): Promise<WslConfined> {
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
  };
}
