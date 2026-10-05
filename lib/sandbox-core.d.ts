/**
 * The seam's `ConfinedArgv` settlement facts, plus this core's `windowsDrive`
 * mitigation flag.
 *
 * @typedef {object} WslConfined
 * @property {string[]} argv - the wrapped argv (bwrap prefix, separator, the caller's argv).
 * @property {"full"|"partial"} enforcement - how completely the profile enforces the policy's file effects. Typed
 *   as the seam's union (upstream `SandboxEnforcement`) while this core always reports `partial` (see the
 *   `ENFORCEMENT` doc above): the value an executor passes through is the seam's, wherever it came from.
 * @property {string[]} denialSignatures - the case-insensitive stderr substrings a bwrap denial produces.
 * @property {Array<{fatalSignatures: string[], allowedExitCodes?: number[], informationalLines?: string[]}>} runnerFailureRules - structured runner-failure evidence rules.
 * @property {("masked"|"visible")} windowsDrive - whether the profile masks the Windows drive at `/mnt`.
 */
/**
 * The sandbox class `createSandboxCore` builds, as its consumers see it.
 *
 * @typedef {object} WslSandboxCoreInstance
 * @property {string} wslPath - the `wsl.exe` path this instance spawns.
 * @property {boolean} maskWindowsDrive - whether every profile masks `/mnt`.
 * @property {(distro: string, signal?: AbortSignal|undefined) => Promise<boolean>} usable - probe the distro's `bwrap`.
 * @property {(argv: string[], policy: {mode: "read-only"|"workspace-write", workspaceRoot: string}, options: {distro: string, signal?: AbortSignal|undefined}) => Promise<WslConfined>} confine - wrap one argv in the profile.
 */
/**
 * Build the sandbox class, bound to one unavailable-error implementation.
 *
 * @param {object} deps - the injected peer surface.
 * @param {new (mode: "read-only"|"workspace-write", detail?: string) => Error} deps.SandboxUnavailableError
 *   the failure type `confine` throws; production binds the peer's class so
 *   `instanceof` consumers keep matching, tests bind a stand-in with the same
 *   `code`.
 * @returns {new (config?: {wslPath?: string, maskWindowsDrive?: boolean}|undefined) => WslSandboxCoreInstance} the sandbox class (see `lib/sandbox.js` for
 *   the shipped binding).
 */
export function createSandboxCore({ SandboxUnavailableError }: {
    SandboxUnavailableError: new (mode: "read-only" | "workspace-write", detail?: string) => Error;
}): new (config?: {
    wslPath?: string;
    maskWindowsDrive?: boolean;
} | undefined) => WslSandboxCoreInstance;
/**
 * The seam's `ConfinedArgv` settlement facts, plus this core's `windowsDrive`
 * mitigation flag.
 */
export type WslConfined = {
    /**
     * - the wrapped argv (bwrap prefix, separator, the caller's argv).
     */
    argv: string[];
    /**
     * - how completely the profile enforces the policy's file effects. Typed
     * as the seam's union (upstream `SandboxEnforcement`) while this core always reports `partial` (see the
     * `ENFORCEMENT` doc above): the value an executor passes through is the seam's, wherever it came from.
     */
    enforcement: "full" | "partial";
    /**
     * - the case-insensitive stderr substrings a bwrap denial produces.
     */
    denialSignatures: string[];
    /**
     * - structured runner-failure evidence rules.
     */
    runnerFailureRules: Array<{
        fatalSignatures: string[];
        allowedExitCodes?: number[];
        informationalLines?: string[];
    }>;
    /**
     * - whether the profile masks the Windows drive at `/mnt`.
     */
    windowsDrive: ("masked" | "visible");
};
/**
 * The sandbox class `createSandboxCore` builds, as its consumers see it.
 */
export type WslSandboxCoreInstance = {
    /**
     * - the `wsl.exe` path this instance spawns.
     */
    wslPath: string;
    /**
     * - whether every profile masks `/mnt`.
     */
    maskWindowsDrive: boolean;
    /**
     * - probe the distro's `bwrap`.
     */
    usable: (distro: string, signal?: AbortSignal | undefined) => Promise<boolean>;
    /**
     * - wrap one argv in the profile.
     */
    confine: (argv: string[], policy: {
        mode: "read-only" | "workspace-write";
        workspaceRoot: string;
    }, options: {
        distro: string;
        signal?: AbortSignal | undefined;
    }) => Promise<WslConfined>;
};
