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
/** The cache key one (wsl.exe, distro) pair's bwrap verdict lives under. */
const probeKey = (wslPath, distro) => `${wslPath}\u0000${distro}`;
/**
 * The direct install command each detected package family gets in the remedy.
 * The bootstrap script remains the first-choice path — it detects the family
 * itself — but a user pasting the message on a dnf or pacman distro must not
 * be handed an `apt-get` line.
 */
const FAMILY_INSTALL = {
    apt: "apt-get install -y bubblewrap",
    dnf: "dnf install -y bubblewrap",
    pacman: "pacman -S --noconfirm bubblewrap",
    zypper: "zypper --non-interactive install bubblewrap",
};
/** How many characters of the failed probe's output the remedy quotes. */
const PROBE_OUTPUT_CAP = 300;
/**
 * Classify one failed probe's output. `bwrap: ` on the output means the binary
 * RAN and refused — a present-but-unusable bwrap (an old build, a kernel
 * without unprivileged user namespaces), which no reinstall fixes. wsl.exe's
 * own relay for a missing `--exec` binary names the exec instead, which is the
 * install case. Anything else is unclassified and gets the install remedy with
 * the raw output quoted, so neither reading is lost.
 *
 * @param output - the failed probe's combined stdout+stderr, NULs stripped.
 * @returns why the probe failed, as the remedy needs it.
 */
function classifyProbeOutput(output) {
    if (/\bbwrap: /i.test(output))
        return "broken";
    if (/no such file|execv|not found|cannot run|could not be started/i.test(output))
        return "missing";
    return "unknown";
}
/**
 * The package manager the distro offers, for the remedy's direct command. Only
 * consulted on a FAILED probe, so a healthy distro never pays for it; a probe
 * that cannot answer leaves the remedy with the package-manager-agnostic line.
 *
 * @param wslPath - the `wsl.exe` path the failed probe used.
 * @param distro - the distro the failed probe ran in.
 * @param signal - optional cancellation shared with the probe.
 * @returns the first family whose manager exists, or undefined.
 */
async function detectPackageFamily(wslPath, distro, signal) {
    try {
        const script = "for m in apt-get dnf pacman zypper; do command -v $m && break; done";
        // `command -v` answers with the PATH-resolved path, so matching on the
        // trailing name is exact — a bare manager name never comes back.
        const manager = (await runCapture([wslPath, "-d", distro, "--exec", "sh", "-c", script], signal)).trim().split("\n")[0]?.trim() ?? "";
        if (manager.endsWith("/apt-get"))
            return "apt";
        if (manager.endsWith("/dnf"))
            return "dnf";
        if (manager.endsWith("/pacman"))
            return "pacman";
        if (manager.endsWith("/zypper"))
            return "zypper";
        return undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Compose the remedy one failed probe reports. Pure apart from the optional
 * family probe it may issue (a failed probe only), so the text is unit-testable
 * through a fake `wsl.exe`.
 *
 * @param wslPath - the `wsl.exe` path the probe used.
 * @param distro - the distro the probe ran in.
 * @param cause - the raw probe failure.
 * @param signal - optional cancellation shared with the probe.
 * @returns the operator-facing remedy text.
 */
async function composeBwrapFailure(wslPath, distro, cause, signal) {
    const output = String(cause?.message ?? cause ?? "").slice(0, PROBE_OUTPUT_CAP).trim();
    const kind = classifyProbeOutput(output);
    if (kind === "broken") {
        // A broken verdict requires the bwrap banner, so the output is never empty here.
        return (`bwrap is installed inside distro "${distro}" but failed the usability probe: ${output}. ` +
            `This is usually the kernel (unprivileged user namespaces disabled) or an unusable bwrap build rather than a missing package, so reinstalling will not help. ` +
            `Check \`wsl.exe -d ${distro} --exec bwrap --version\` inside the distro, or set \`sandbox: false\` on the wsl-shell and wsl-fs rows to run unconfined.`);
    }
    const remedy = missingBwrapRemedy(distro, await detectPackageFamily(wslPath, distro, signal));
    return kind === "unknown" && output.length > 0 ? `${remedy} The probe failed with: ${output}` : remedy;
}
/**
 * The canonical remedy for a distro whose `bwrap` is missing — also the
 * fallback for callers that know only "the probe failed", without a classified
 * reason. The direct command is family-aware when the caller knows the family;
 * the bootstrap script is always the first-choice path because it detects the
 * family itself.
 *
 * @param distro - the distro to install into.
 * @param family - the detected package family, when known.
 * @returns the operator-facing remedy text.
 */
export function missingBwrapRemedy(distro, family) {
    const direct = family === undefined ? undefined : FAMILY_INSTALL[family];
    if (direct === undefined) {
        return (`bwrap is not usable inside distro "${distro}". Install it with ` +
            `"scripts/bootstrap.sh ${distro} --install" (from the package), or install the ` +
            `"bubblewrap" package with the distro's package manager.`);
    }
    return (`bwrap is not usable inside distro "${distro}". Install it with ` +
        `"scripts/bootstrap.sh ${distro} --install" (from the package), or directly: ` +
        `wsl.exe -d ${distro} -u root -- ${direct}`);
}
/**
 * The remedy for a bwrap that PROBED healthy but failed a run — the runtime
 * twin of {@link missingBwrapRemedy}. No family knowledge exists on this path
 * (the probe succeeded, so no family probe ever ran), and reinstalling is only
 * one of the plausible fixes, so the hint leads with diagnosis.
 *
 * @param distro - the distro whose bwrap failed at run time.
 * @returns the operator-facing hint text.
 */
export function bwrapInstallHint(distro) {
    return (`bwrap failed at run time inside distro "${distro}". Check \`bwrap --version\` there, ` +
        `or reinstall it: "scripts/bootstrap.sh ${distro} --install".`);
}
/**
 * Append {@link bwrapInstallHint} to a runner-failure detail that names bwrap.
 * A probe-time failure composes its own classified remedy; this covers the
 * OTHER order — bwrap probed healthy, then failed a real command — where no
 * probe failure is on record and the raw `bwrap: …` line is all the model
 * would see. Details that do not name bwrap pass through untouched: the
 * runner-failure rules match the confinement runner, and the confinement
 * runner is always bwrap here, but the wording stays the decider so a future
 * rule change cannot attach a bwrap remedy to a foreign failure.
 *
 * @param detail - the classified runner-failure detail.
 * @param distro - the distro the command ran in.
 * @returns the detail, with the remedy appended when it names bwrap.
 */
export function withBwrapHint(detail, distro) {
    return /\bbwrap\b/i.test(detail) ? `${detail} — ${bwrapInstallHint(distro)}` : detail;
}
/**
 * Probe one distro's `bwrap` under the shared verdict cache. The probe mirrors
 * upstream's: apply the real read-only profile around `true`, and treat a zero
 * exit as the kernel having accepted and enforced it. A missing `bwrap` fails
 * the spawn and probes unusable, which is what makes the providers fail closed
 * rather than silently run unconfined.
 *
 * A success is remembered for the process lifetime; a failure is not, so a
 * `bubblewrap` installed while the app is running is believed on the next
 * command. The failure's composed remedy stays readable through
 * {@link bwrapFailure}, which is how every refusal and the preflight surface it.
 *
 * @param options - the `wsl.exe` path and the distro to probe.
 * @param options.wslPath - the `wsl.exe` path.
 * @param options.distro - the distro to probe.
 * @param options.signal - optional cancellation.
 * @returns true when a confined command can run there.
 */
export async function bwrapUsable(options) {
    const { wslPath, distro, signal } = options;
    return probeVerdicts.run(probeKey(wslPath, distro), async () => {
        const prefix = bwrapArgvPrefix({ mode: "read-only", workspaceRoot: "/" });
        try {
            await runCapture([wslPath, "-d", distro, "--exec", ...prefix, "true"], signal);
            return true;
        }
        catch (cause) {
            throw new Error(await composeBwrapFailure(wslPath, distro, cause, signal));
        }
    });
}
/**
 * The remedy text of a key's last failed probe, as {@link bwrapUsable} composed
 * it — the same string the providers' refusals carry. Undefined while the probe
 * never failed (or last succeeded).
 *
 * @param wslPath - the `wsl.exe` path the probe used.
 * @param distro - the distro the probe ran in.
 * @returns the composed remedy, or undefined.
 */
export function bwrapFailure(wslPath, distro) {
    return probeVerdicts.failure(probeKey(wslPath, distro));
}
/**
 * Build the sandbox class, bound to one unavailable-error implementation.
 *
 * @param deps - the injected peer surface.
 * @returns the sandbox class (see `lib/sandbox.js` for the shipped binding).
 */
export function createSandboxCore({ SandboxUnavailableError }) {
    return class WslSandboxCore {
        /**
         * @param config - the `wsl.exe` path, overridable for a non-standard install.
         */
        constructor(config = {}) {
            this.wslPath = config.wslPath ?? "wsl.exe";
            this.maskWindowsDrive = config.maskWindowsDrive ?? false;
        }
        /**
         * Whether `bwrap` can create a profile inside this distro. Delegates to the
         * shared free probe — the same cache the preflight service and every other
         * instance instance read, so a verdict paid once is paid once per process.
         *
         * @param distro - the distro to probe.
         * @param signal - optional cancellation.
         * @returns true when a confined command can run there.
         */
        async usable(distro, signal) {
            return bwrapUsable({ wslPath: this.wslPath, distro, signal });
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
        async confine(argv, policy, options) {
            const { distro, signal } = options;
            if (!(await this.usable(distro, signal))) {
                throw new SandboxUnavailableError(policy.mode, bwrapFailure(this.wslPath, distro) ?? missingBwrapRemedy(distro));
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
