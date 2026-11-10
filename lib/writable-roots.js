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
import { isPosixAbsolute, isWslUnc, uncToPosix } from "./paths.js";
import { runCapture } from "./wsl.js";
/** A configured grant that cannot be used, with the reason the model-facing error carries. */
export class WritableRootError extends Error {
    /** The entry as configured (or the policy's spelling). */
    root;
    /** Why it was refused. */
    reason;
    /**
     * @param root - the entry as configured.
     * @param reason - the model-facing reason.
     */
    constructor(root, reason) {
        super(`Invalid additional writable directory ${JSON.stringify(root)}: ${reason}`);
        this.name = "WritableRootError";
        this.root = root;
        this.reason = reason;
    }
}
/** The temp areas `workspace-write` makes writable in every confinement shape. */
const TEMP_ROOTS = ["/tmp", "/dev/shm"];
/**
 * Strip duplicate and trailing separators and resolve `.`/`..` lexically.
 * The result is absolute; the caller has already checked the spelling.
 *
 * @param value - an absolute Linux path.
 * @returns the normalized path.
 */
function normalizeLinux(value) {
    const segments = [];
    for (const segment of value.split("/")) {
        if (segment === "" || segment === ".")
            continue;
        if (segment === "..")
            segments.pop();
        else
            segments.push(segment);
    }
    return `/${segments.join("/")}`;
}
/**
 * Whether one Linux path is the other or lies below it.
 *
 * @param path - the normalized candidate.
 * @param parent - the normalized parent.
 * @returns true when `path` is contained in `parent`.
 */
function contains(path, parent) {
    if (parent === "/")
        return true;
    return path === parent || path.startsWith(`${parent}/`);
}
/**
 * Expand and normalize one plugin-configured entry. The entry is a distro
 * path, so a Windows or UNC spelling is a configuration mistake rather than a
 * path the plugin could translate.
 *
 * @param value - the configured entry.
 * @param home - the distro home for `~`.
 * @returns the normalized absolute Linux path.
 * @throws {WritableRootError} when the entry is not a distro absolute path.
 */
function configuredRoot(value, home) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) {
        throw new WritableRootError(String(value), "must be a non-empty Linux path");
    }
    if (value === "~" || value.startsWith("~/")) {
        if (home.length === 0)
            throw new WritableRootError(value, "cannot expand ~ without the distro home");
        return normalizeLinux(value === "~" ? home : `${home}/${value.slice(2)}`);
    }
    if (value.startsWith("~"))
        throw new WritableRootError(value, "use ~/... or an absolute Linux path; ~user grants are not supported");
    if (!isPosixAbsolute(value))
        throw new WritableRootError(value, "must be an absolute Linux path or start with ~/");
    return normalizeLinux(value);
}
/**
 * Translate one shared-policy entry. The policy carries execution-world
 * spelling, so a same-distro UNC is the workspace coordinate of a Linux path;
 * a Linux path is already right; everything else is a different world.
 *
 * @param value - the policy entry.
 * @param distro - the distro the workspace belongs to.
 * @returns the normalized Linux path.
 * @throws {WritableRootError} when the entry names another world.
 */
function policyRoot(value, distro) {
    if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) {
        throw new WritableRootError(String(value), "must be a non-empty path");
    }
    if (isPosixAbsolute(value))
        return normalizeLinux(value);
    if (isWslUnc(value)) {
        const parsed = uncToPosix(value);
        if (parsed !== undefined && parsed.distro.toLowerCase() === distro.toLowerCase())
            return normalizeLinux(parsed.linuxPath);
    }
    throw new WritableRootError(value, `the workspace is inside distro ${JSON.stringify(distro)}; a Windows-path extra directory cannot be granted there`);
}
/**
 * Validate the shape of a row's `writableRoots` before any distro is known.
 * Called from the providers' constructors so a typo fails at boot instead of
 * at the first command.
 *
 * @param values - the configured entries, if present.
 * @throws {Error} naming the first entry that is not a distro path.
 */
export function validateWritableRootsConfig(values) {
    for (const value of values ?? []) {
        if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) {
            throw new Error(`writableRoots: every entry must be a non-empty Linux path, got ${JSON.stringify(value)}`);
        }
        if (value === "~" || value.startsWith("~/"))
            continue;
        if (value.startsWith("~"))
            throw new Error(`writableRoots: use ~/... or an absolute Linux path, got ${JSON.stringify(value)}`);
        if (!isPosixAbsolute(value))
            throw new Error(`writableRoots: every entry must be an absolute Linux path or start with ~/, got ${JSON.stringify(value)}`);
    }
}
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
export function resolveWritableRoots(input) {
    const candidates = [];
    for (const value of input.configured ?? [])
        candidates.push(configuredRoot(value, input.home));
    for (const value of input.policy ?? [])
        candidates.push(policyRoot(value, input.distro));
    const workspace = normalizeLinux(input.workspaceRoot);
    const alreadyWritable = [workspace, ...TEMP_ROOTS.map(normalizeLinux)];
    const effective = [];
    for (const candidate of [...new Set(candidates)].sort((a, b) => a.length - b.length || a.localeCompare(b))) {
        if (alreadyWritable.some((root) => contains(candidate, root)))
            continue;
        if (effective.some((root) => contains(candidate, root)))
            continue;
        effective.push(candidate);
    }
    return effective;
}
/** The one-time check script: missing, unreadable and symlinked roots report index|reason. */
const CHECK_SCRIPT = [
    "i=0",
    'for r in "$@"; do',
    '  if [ ! -d "$r" ]; then printf "%s|missing\\n" "$i"; exit 3; fi',
    '  p=$(cd "$r" 2>/dev/null && pwd -P) || { printf "%s|unreadable\\n" "$i"; exit 4; }',
    '  if [ "$p" != "$r" ]; then printf "%s|symlink -> %s\\n" "$i" "$p"; exit 5; fi',
    "  i=$((i+1))",
    "done",
].join("\n");
/** The argv of the one-time physical-directory check, exported for tests and diagnostics. */
export function writableRootsCheckArgv(wslPath, distro, roots) {
    return [wslPath, "-d", distro, "--exec", "sh", "-c", CHECK_SCRIPT, "wsl-writable-roots", ...roots];
}
/** The successful checks, keyed by the exact root list; a success is durable. */
const checked = new Map();
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
export async function ensureWritableRoots(options) {
    if (options.roots.length === 0)
        return;
    const key = `${options.wslPath}\u0000${options.distro}\u0000${options.roots.join("\u0000")}`;
    const cached = checked.get(key);
    if (cached !== undefined)
        return cached;
    const run = options.run ?? ((argv) => runCapture(argv, options.signal));
    const pending = (async () => {
        try {
            await run(writableRootsCheckArgv(options.wslPath, options.distro, options.roots));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const match = /(\d+)\|(missing|unreadable|symlink)(?: -> (.*))?/u.exec(message);
            const index = match === null ? Number.NaN : Number(match[1]);
            const root = Number.isInteger(index) ? options.roots[index] : undefined;
            if (root === undefined)
                throw error;
            const reason = match?.[2] === "missing"
                ? "expected an existing directory; create it inside the distro first"
                : match?.[2] === "unreadable"
                    ? "cannot read the directory"
                    : `use the physical directory path ${JSON.stringify(match?.[3] ?? "")}; symlinked grants are not supported`;
            throw new WritableRootError(root, reason);
        }
    })();
    checked.set(key, pending);
    try {
        await pending;
    }
    catch (error) {
        checked.delete(key);
        throw error;
    }
}
/** Test hook: forget the remembered checks. */
export function resetWritableRootsChecks() {
    checked.clear();
}
