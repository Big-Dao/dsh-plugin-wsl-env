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
