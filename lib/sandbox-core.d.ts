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
export declare function missingBwrapRemedy(distro: string, family?: string): string;
/**
 * The remedy for a bwrap that PROBED healthy but failed a run — the runtime
 * twin of {@link missingBwrapRemedy}. No family knowledge exists on this path
 * (the probe succeeded, so no family probe ever ran), and reinstalling is only
 * one of the plausible fixes, so the hint leads with diagnosis.
 *
 * @param distro - the distro whose bwrap failed at run time.
 * @returns the operator-facing hint text.
 */
export declare function bwrapInstallHint(distro: string): string;
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
export declare function bwrapUsable(options: {
    wslPath: string;
    distro: string;
    signal?: AbortSignal | undefined;
}): Promise<boolean>;
/**
 * The remedy text of a key's last failed probe, as {@link bwrapUsable} composed
 * it — the same string the providers' refusals carry. Undefined while the probe
 * never failed (or last succeeded).
 *
 * @param wslPath - the `wsl.exe` path the probe used.
 * @param distro - the distro the probe ran in.
 * @returns the composed remedy, or undefined.
 */
export declare function bwrapFailure(wslPath: string, distro: string): string | undefined;
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
    runnerFailureRules: Array<{
        fatalSignatures: string[];
        allowedExitCodes?: number[];
        informationalLines?: string[];
    }>;
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
    confine: (argv: string[], policy: {
        mode: "read-only" | "workspace-write";
        workspaceRoot: string;
    }, options: {
        distro: string;
        signal?: AbortSignal | undefined;
    }) => Promise<WslConfined>;
}
/**
 * Build the sandbox class, bound to one unavailable-error implementation.
 *
 * @param deps - the injected peer surface.
 * @returns the sandbox class (see `lib/sandbox.js` for the shipped binding).
 */
export declare function createSandboxCore({ SandboxUnavailableError }: {
    /**
     * The failure type `confine` throws; production binds the peer's class so
     * `instanceof` consumers keep matching, tests bind a stand-in with the same
     * `code`.
     */
    SandboxUnavailableError: new (mode: "read-only" | "workspace-write", detail?: string) => Error;
}): new (config?: {
    wslPath?: string;
    maskWindowsDrive?: boolean;
} | undefined) => WslSandboxCoreInstance;
