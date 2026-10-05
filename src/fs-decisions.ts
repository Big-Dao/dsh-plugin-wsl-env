/**
 * The filesystem provider's POLICY DECISIONS, extracted from
 * `lib/index.js` so they are unit-testable in a bare checkout: which paths are
 * refused for naming another distro, which mode refuses a mutation outright,
 * which write guards refuse which intents, and how a substrate failure maps
 * onto the refusal the tool layer surfaces. Pure in, descriptor out — no I/O,
 * no peers (the provider wraps these descriptors in `FsError` at one choke
 * point, keeping the peer import out of this module and the decisions honest).
 *
 * Every message here is model-facing and must stay byte-identical to what the
 * provider produced before the extraction — the tool layer and the model match
 * on these strings.
 *
 * This is a TypeScript source built to `lib/fs-decisions.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/fs-decisions
 */

import { isAnotherDistrosUnc } from "./paths.js";

/** A refusal descriptor the provider wraps in `FsError` at one choke point. */
export interface Refusal {
  /** The model-facing refusal text. */
  message: string;
  /** The `FS_*` token. */
  code: string;
}

/**
 * Build one refusal descriptor.
 *
 * @param message - the model-facing refusal text.
 * @param code - the `FS_*` token.
 * @returns the descriptor.
 */
const refusal = (message: string, code: string): Refusal => ({ message, code });

/**
 * The worldPath decision: a path that resolves into another WSL distro is
 * refused while `restrictToDistro` holds — deliberately NOT a sandbox denial,
 * because no wider permission can lift a configuration choice.
 *
 * @param input - the decision's inputs.
 * @returns the refusal, or null to proceed.
 */
export function outsideDistroRefusal({ path, world, distro, restrictToDistro }: { path: string, world: string, distro: string, restrictToDistro: boolean }): Refusal | null {
  if (!restrictToDistro || !isAnotherDistrosUnc(world, distro)) return null;
  return refusal(
    `"${path}" names a path in another WSL distro, and this profile pins its filesystem to "${distro}" ` +
      `(restrictToDistro: true). Open a session in that distro, or set restrictToDistro: false.`,
    "FS_OUTSIDE_DISTRO",
  );
}

/**
 * The mutationAgent decision: does THIS mutation route to the confined
 * resident? An absent policy (caller pre-checked), a disabled sandbox, and an
 * approved escalation all address the plain resident — which is what those
 * mean.
 *
 * @param input - the decision's inputs.
 * @returns true when the mutation belongs to the confined resident.
 */
export function isConfinedMutation({ policy, sandboxEnabled }: { policy: { mode: string, workspaceRoot: string } | undefined, sandboxEnabled: boolean }): boolean {
  return policy !== undefined && Boolean(sandboxEnabled) && policy.mode !== "danger-full-access";
}

/**
 * The mode-level mutation decision: `read-only` refuses every write outright;
 * `danger-full-access` is the approved escalation and refuses nothing.
 * `workspace-write` refuses nothing HERE — its containment check needs the
 * fresh target and runs in the provider.
 *
 * @param mode - the resolved policy mode.
 * @param displayPath - the caller-facing path for the message.
 * @returns the refusal, or null to proceed.
 */
export function mutationModeRefusal(mode: string, displayPath: string): Refusal | null {
  if (mode !== "read-only") return null;
  return refusal(`cannot write "${displayPath}": file access denied under read-only mode`, "FS_SANDBOX_DENIED");
}

/**
 * The containment denial for a `workspace-write` mutation whose fresh target
 * sat under no writable root.
 *
 * @param displayPath - the caller-facing path for the message.
 * @returns the refusal descriptor.
 */
export function workspaceWriteDenial(displayPath: string): Refusal {
  return refusal(`cannot write "${displayPath}": file access denied under workspace-write mode`, "FS_SANDBOX_DENIED");
}

/**
 * The substrate configuration decision: the Windows-side share no longer
 * serves the file tools. Every distro read and write runs on the resident
 * agent, so no model-facing I/O crosses the 9p share at all — the share
 * backend it replaces was the one path that still could. The provider throws
 * this at construction time, before any session forms, so a profile carrying
 * the old value fails loudly with the migration instead of silently serving
 * I/O the configuration did not mean to allow.
 *
 * @param substrate - the configured substrate value; absent on a
 *   direct construction, which is not the retired share.
 * @returns the refusal, or null to proceed.
 */
export function shareSubstrateRefusal(substrate?: string): { message: string } | null {
  if (substrate !== "share") return null;
  return {
    message:
      'wsl-fs: substrate "share" is no longer available — the resident agent serves every ' +
      "distro read and write, and no file tool crosses the 9p share. Delete the substrate " +
      'line from the provider config, or set it to "agent".',
  };
}

/**
 * The substrate failure mapping: what the tool layer should surface for an
 * error that crossed the `ctx.fs` seam. A coded refusal keeps its code and
 * message byte-for-byte; anything else is the substrate being UNAVAILABLE —
 * the resident agent that serves every distro read and write is out — and the
 * message names the recovery path, because there is no fallback I/O for it to
 * point at.
 *
 * @param error - what the substrate raised.
 * @returns the refusal the provider wraps in `FsError`.
 */
export function substrateFailure(error: unknown): { message: string, code: string, cause: unknown } {
  if (isCoded(error)) return { message: error.message, code: error.code, cause: error };
  const message = error instanceof Error ? error.message : String(error);
  return {
    message:
      `the distro file substrate is unavailable: ${message}. ` +
      `The resident agent serves every distro read and write; check the distro is running ` +
      `("wsl.exe -l -v") and restart the session if it stays out.`,
    code: "FS_IO_ERROR",
    cause: error instanceof Error ? error : undefined,
  };
}

/**
 * A coded refusal: our `FsCodedError` duck (a message, a string `FS_*` code).
 *
 * @param error - what the substrate raised.
 * @returns true when `error` carries a string `FS_*` code.
 */
function isCoded(error: unknown): error is Error & { code: string } {
  return error instanceof Error && typeof (error as Error & { code?: unknown }).code === "string" && (error as Error & { code: string }).code.startsWith("FS_");
}
