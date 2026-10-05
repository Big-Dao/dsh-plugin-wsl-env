/**
 * The worldPath decision: a path that resolves into another WSL distro is
 * refused while `restrictToDistro` holds — deliberately NOT a sandbox denial,
 * because no wider permission can lift a configuration choice.
 * @param {object} input - the decision's inputs.
 * @param {string} input.path - the path as the caller spelled it.
 * @param {string} input.world - the resolved world path (a UNC for distro paths).
 * @param {string} input.distro - the pinned distro name.
 * @param {boolean} input.restrictToDistro - the configuration fence.
 * @returns {{message: string, code: string}|null} the refusal, or null to proceed.
 */
export function outsideDistroRefusal({ path, world, distro, restrictToDistro }: {
    path: string;
    world: string;
    distro: string;
    restrictToDistro: boolean;
}): {
    message: string;
    code: string;
} | null;
/**
 * The mutationAgent decision: does THIS mutation route to the confined
 * resident? An absent policy (caller pre-checked), a disabled sandbox, and an
 * approved escalation all address the plain resident — which is what those
 * mean.
 * @param {object} input - the decision's inputs.
 * @param {{mode: string, workspaceRoot: string}|undefined} input.policy - the
 *   resolved file-effect policy.
 * @param {boolean} input.sandboxEnabled - the provider's `sandbox` configuration.
 * @returns {boolean} true when the mutation belongs to the confined resident.
 */
export function isConfinedMutation({ policy, sandboxEnabled }: {
    policy: {
        mode: string;
        workspaceRoot: string;
    } | undefined;
    sandboxEnabled: boolean;
}): boolean;
/**
 * The mode-level mutation decision: `read-only` refuses every write outright;
 * `danger-full-access` is the approved escalation and refuses nothing.
 * `workspace-write` refuses nothing HERE — its containment check needs the
 * fresh target and runs in the provider.
 * @param {string} mode - the resolved policy mode.
 * @param {string} displayPath - the caller-facing path for the message.
 * @returns {{message: string, code: string}|null} the refusal, or null to proceed.
 */
export function mutationModeRefusal(mode: string, displayPath: string): {
    message: string;
    code: string;
} | null;
/**
 * The containment denial for a `workspace-write` mutation whose fresh target
 * sat under no writable root.
 * @param {string} displayPath - the caller-facing path for the message.
 * @returns {{message: string, code: string}} the refusal descriptor.
 */
export function workspaceWriteDenial(displayPath: string): {
    message: string;
    code: string;
};
/**
 * The substrate configuration decision: the Windows-side share no longer
 * serves the file tools. Every distro read and write runs on the resident
 * agent, so no model-facing I/O crosses the 9p share at all — the share
 * backend it replaces was the one path that still could. The provider throws
 * this at construction time, before any session forms, so a profile carrying
 * the old value fails loudly with the migration instead of silently serving
 * I/O the configuration did not mean to allow.
 * @param {string} [substrate] - the configured substrate value; absent on a
 *   direct construction, which is not the retired share.
 * @returns {{message: string}|null} the refusal, or null to proceed.
 */
export function shareSubstrateRefusal(substrate?: string): {
    message: string;
} | null;
/**
 * The substrate failure mapping: what the tool layer should surface for an
 * error that crossed the `ctx.fs` seam. A coded refusal keeps its code and
 * message byte-for-byte; anything else is the substrate being UNAVAILABLE —
 * the resident agent that serves every distro read and write is out — and the
 * message names the recovery path, because there is no fallback I/O for it to
 * point at.
 * @param {unknown} error - what the substrate raised.
 * @returns {{message: string, code: string, cause: unknown}} the refusal the
 *   provider wraps in `FsError`.
 */
export function substrateFailure(error: unknown): {
    message: string;
    code: string;
    cause: unknown;
};
