/**
 * The extra directories a WSL confinement grants read-write under
 * `workspace-write`, and the one-time check that they are usable.
 *
 * `workspace-write` grants the session workspace and the distro's temp areas —
 * nothing under the user's home. Toolchains do not stay inside the workspace:
 * npm writes `~/.npm`, pnpm writes its store under `~/.local/share/pnpm`,
 * cargo writes `~/.cargo/registry`, and a linked Git worktree writes the
 * shared `.git` directory. This module turns the operator's grants (the plugin
 * rows' `writableRoots` plus the shared policy's `additionalWritableRoots`)
 * into the Linux paths the bwrap profile binds.
 *
 * ## Why the roots are filtered
 *
 * A grant is bound rw into the distro's mount table. If the bound path could
 * be replaced by a symlink after the check, the next command would bind the
 * link's target — the classic grant-redirection escape. The model can write
 * only the workspace and the temp areas, so a grant whose parent is writable
 * is not merely redundant, it is a redirection risk. Candidates already
 * writable (inside the workspace, `/tmp` or `/dev/shm`) and candidates nested
 * inside another grant are therefore dropped, not bound. Every effective root
 * has a read-only parent, which is what makes the one-time physical-path
 * check below sufficient for the model threat model.
 *
 * This module is peer-free so the rules are unit-testable in a bare checkout;
 * `lib/index.js` converts {@link WritableRootError} into the peer's
 * `SandboxInvalidRootError` at the call sites.
 *
 * This is a TypeScript source built to `lib/writable-roots.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/writable-roots
 */
/** A configured grant that cannot be used, with the reason the model-facing error carries. */
export declare class WritableRootError extends Error {
    /** The entry as configured (or the policy's spelling). */
    readonly root: string;
    /** Why it was refused. */
    readonly reason: string;
    /**
     * @param root - the entry as configured.
     * @param reason - the model-facing reason.
     */
    constructor(root: string, reason: string);
}
/** The inputs of {@link resolveWritableRoots}. */
export interface WritableRootsInput {
    /** The plugin rows' `writableRoots` (distro paths; `~` expands to the distro home). */
    configured?: readonly string[] | undefined;
    /** The shared policy's `additionalWritableRoots` (UNC of this distro, or Linux paths). */
    policy?: readonly string[] | undefined;
    /** The resolved distro user's home, for `~` and `~/...` entries. */
    home: string;
    /** The distro the workspace belongs to, for the UNC check and the embedded error text. */
    distro: string;
    /** The workspace root in Linux form; grants inside it are already writable. */
    workspaceRoot: string;
}
/**
 * Validate the shape of a row's `writableRoots` before any distro is known.
 * Called from the providers' constructors so a typo fails at boot instead of
 * at the first command.
 *
 * @param values - the configured entries, if present.
 * @throws {Error} naming the first entry that is not a distro path.
 */
export declare function validateWritableRootsConfig(values: readonly string[] | undefined): void;
/**
 * Turn the configured and policy grants into the effective Linux roots.
 *
 * Entries already writable (inside the workspace, `/tmp` or `/dev/shm`) and
 * entries nested inside another grant are dropped: they add no permission, and
 * binding them would let the model redirect the bind through a symlink. The
 * rest are deduplicated, sorted and returned.
 *
 * @param input - the configured grants, policy grants, home and workspace.
 * @returns the effective roots, in deterministic order.
 * @throws {WritableRootError} for an entry that names another world or is malformed.
 */
export declare function resolveWritableRoots(input: WritableRootsInput): string[];
/** The argv of the one-time physical-directory check, exported for tests and diagnostics. */
export declare function writableRootsCheckArgv(wslPath: string, distro: string, roots: readonly string[]): string[];
/**
 * Check once per process that every effective root exists, is readable and is
 * its own physical directory. A missing root reports the operator-facing
 * failure instead of letting bwrap die with an opaque mount error; a symlinked
 * root is refused with the physical-path rule the peer's extra-root contract
 * uses.
 *
 * A success is remembered for the process lifetime: the effective roots have
 * read-only parents, so the model cannot replace them, and the common roots
 * (`~/.npm`, `~/.cache`, …) are stable. A failed check is not remembered, so a
 * directory the operator creates while the app runs is believed next time.
 *
 * @param options - the `wsl.exe` path, distro, effective roots and optional run override.
 * @returns resolved when every root is usable.
 * @throws {WritableRootError} naming the first unusable root.
 */
export declare function ensureWritableRoots(options: {
    wslPath: string;
    distro: string;
    roots: readonly string[];
    signal?: AbortSignal | undefined;
    /** The runner, overridable in tests; defaults to the shared capture. */
    run?: (argv: string[]) => Promise<string>;
}): Promise<void>;
/** Test hook: forget the remembered checks. */
export declare function resetWritableRootsChecks(): void;
