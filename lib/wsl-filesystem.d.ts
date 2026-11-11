import z from "@deepseek-ai/schemastery";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { FsError } from "@deepseek-ai/dsh-fs";
import { WslSandbox } from "./sandbox.js";
import type { WslAgent } from "./agent.js";
import { AgentSubstrate } from "./fs-substrate.js";
import { SessionRuntimes } from "./session-runtime.js";
import type { SessionRuntimeEntry } from "./session-runtime.js";
import type { Context } from "@deepseek-ai/cordis";
import type { FileSystem, FsDeleteOutcome, FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsMoveOutcome, FsPathInfo, FsTarget, FsVersion, FsWriteIntent, FsWriteOutcome } from "@deepseek-ai/dsh-fs";
import type { SandboxExecutionPolicy, SandboxMode } from "@deepseek-ai/dsh-sandbox";
type PatchHunks = Parameters<FileSystem["patchText"]>[1];
type MoveFileOptions = Parameters<FileSystem["moveFile"]>[2];
/**
 * The WSL filesystem provider's validated config — the keys of
 * {@link WslFileSystem.Config}, which the upstream `LocalFileSystem` config
 * type does not know. This provider has no volatile fields: every key is read
 * as its plain value.
 */
interface WslFileSystemConfig {
    /** The pinned distro; empty resolves WSL's default. */
    distro: string;
    /** The base directory for relative input. */
    cwd: string;
    /** The `wsl.exe` path, for default-distro resolution. */
    wslPath: string;
    /**
     * The overwrite-diff byte bound per side; schema-defaulted when mounted
     * through cordis, and defaulted again by the substrate when absent.
     */
    diffBasisMaxBytes?: number;
    /** Whether mutations are fenced by the policy. */
    sandbox: boolean;
    /** Session runtime: `true` requires it, `false` disables it, `"auto"` uses it when usable. */
    sessionSandbox: boolean | "auto";
    /** Whether confined profiles mask `/mnt`. */
    maskWindowsDrive: boolean;
    /** Extra distro directories granted read-write under `workspace-write`. */
    writableRoots?: string[];
    /** Whether paths leaving the distro are refused. */
    restrictToDistro: boolean;
    /** The in-distro watch scan depth bound. */
    watchMaxDepth: number;
    /**
     * Which I/O substrate serves the file tools; schema-defaulted when mounted
     * through cordis, absent on direct construction (the router), which the
     * constructor's refusal treats as `"agent"`.
     */
    substrate?: string;
}
/**
 * Filesystem backend over a WSL distro's UNC share.
 *
 * Reads, listings, stats and searches reuse the host backend verbatim: the
 * share is a real filesystem to Node, and the packaged ripgrep walks it too.
 * Two things are deliberately replaced.
 *
 * **Resolution** accepts Linux paths (`/home/andy/proj/src/a.ts`) and shows them
 * back as Linux paths, while `targetKey` stays the UNC path the host I/O uses —
 * the seam treats `targetKey` as opaque and reserves `displayPath` for model and
 * UI output, so this rewrite is contract-legal.
 *
 * **Mutation guards are hoisted.** The host backend publishes a guarded
 * *creation* by hard-linking a staged file into place, and the WSL UNC share
 * rejects hard links with `ENOTSUP`; it also refuses `symlink` with `EPERM`.
 * Guarded creation through the share would therefore fail with `FS_IO_ERROR` on
 * the most common write there is — creating a new file. This backend checks the
 * caller's guard itself and then delegates the unguarded publication, which the
 * share does support. The residual window is the same check-then-act race
 * `dsh-fs-sandbox` already documents and accepts.
 *
 * **Publication is replaced.** Unguarded is not enough on its own: the host
 * backend's Windows branch also copies the replaced file's security descriptor
 * and publishes with `ReplaceFileW`, and neither exists on a 9p share — the
 * descriptor read fails every write to an existing file outright. See the
 * constructor for what runs instead.
 */
export declare class WslFileSystem extends LocalFileSystem {
    static inject: string[];
    static Config: z<Schemastery.ObjectS<NoInfer<{
        /**
         * Distro mode: empty/`"auto"` follows the target path, `"default"` forces
         * WSL's default, and an explicit name pins the filesystem.
         */
        distro: z<string, string, "defined">;
        /**
         * Default workdir for relative input; accepts a Linux path, a UNC path, or
         * `C:\...`. Empty — the default — means the distro user's home, resolved
         * inside the distro.
         */
        cwd: z<string, string, "defined">;
        /** Path to `wsl.exe`, used only to resolve the default distro. */
        wslPath: z<string, string, "defined">;
        /** UTF-8 byte limit per overwrite-diff side, mirroring the host backend. */
        diffBasisMaxBytes: z<number, number, "defined">;
        /**
         * Fence mutations by `ctx.sandboxPolicy`, and report the mode through
         * {@link sandboxMode}. `false` restores the pre-sandbox behaviour exactly —
         * an unfenced backend that reports `undefined` — for an operator who wants
         * the old posture and accepts what it means: the model is told these
         * operations are unconfined.
         */
        sandbox: z<boolean, boolean, "defined">;
        /**
         * Run confined mutations in the session's systemd user scope — the same
         * runtime the shell executor acquires for the same session, distro,
         * workspace and policy — instead of a per-policy confined resident. A
         * missing session ID keeps the providers separate. The kernel enforcement
         * is the runtime's mount profile; the scope stops when its providers
         * release it. Requires systemd + `Linger`, like `wsl-shell`'s
         * `sessionSandbox`; the preflight refuses with the remedy. Off for direct
         * constructions; on in the shipped preset.
         */
        sessionSandbox: z<boolean | "auto", boolean | "auto", "defined">;
        /**
         * Shadow `/mnt` with an empty tmpfs in every confined profile, hiding the
         * Windows drive from confined commands — same meaning and same honest
         * limits as the `wsl-shell` key of the same name (its doc carries the
         * full story). Confined fs mutations publish through the masked resident;
         * reads and the share substrate are unaffected.
         */
        maskWindowsDrive: z<boolean, boolean, "defined">;
        /**
         * Extra directories under `workspace-write`, in distro spelling — the
         * same list and same rules as `wsl-shell`'s key. Confined writes bind
         * them, and the fs fence accepts them; keep the two rows' lists equal so
         * a command and its write see one mount table.
         */
        writableRoots: z<string[], string[], "defined">;
        /**
         * Refuse any path that leaves the pinned distro. A WSL filesystem is a
         * whole-Linux view whose `/mnt/c` also reaches the Windows disk, so without
         * this the backend would silently widen the session far beyond the
         * workspace the operator selected.
         */
        restrictToDistro: z<boolean, boolean, "defined">;
        /**
         * How deep the in-distro watch scan walks, `1` = the watched directory and
         * its direct children. `0` — the default — walks the whole tree, which is
         * what the invalidation contract asks for but a real cost every poll over
         * a tree containing a `node_modules`; a bound trades that cost for a
         * documented blind spot: a change below the bound is not seen until
         * another change above it fires the same callback.
         */
        watchMaxDepth: z<number, number, "defined">;
        /**
         * Which I/O substrate serves the file tools. Only `"agent"` exists — the
         * resident in-distro agent (`lib/fs-substrate.js`): reads, writes and
         * identities run where the files live, symlinks and mode bits are native,
         * and the mutation guard survives to the write's no-replace publication,
         * kernel-enforced by the confined resident when the policy is confined.
         * The former `"share"` opt-out — the Windows-side host filesystem stack
         * over the distro's 9p share — is retired: it was the one model-facing
         * I/O path that still crossed the share, and the agent has no fallback
         * that needs it. A profile carrying `"share"` is refused at construction
         * with the migration (`shareSubstrateRefusal`). `watch()` rides the
         * in-distro poll loop for the substrate regardless (`lib/watcher.js`) —
         * it never ran through either substrate. The substrate never changes
         * `sandboxMode`'s honesty.
         */
        substrate: z<"agent" | "share", "agent" | "share", "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /**
         * Distro mode: empty/`"auto"` follows the target path, `"default"` forces
         * WSL's default, and an explicit name pins the filesystem.
         */
        distro: z<string, string, "defined">;
        /**
         * Default workdir for relative input; accepts a Linux path, a UNC path, or
         * `C:\...`. Empty — the default — means the distro user's home, resolved
         * inside the distro.
         */
        cwd: z<string, string, "defined">;
        /** Path to `wsl.exe`, used only to resolve the default distro. */
        wslPath: z<string, string, "defined">;
        /** UTF-8 byte limit per overwrite-diff side, mirroring the host backend. */
        diffBasisMaxBytes: z<number, number, "defined">;
        /**
         * Fence mutations by `ctx.sandboxPolicy`, and report the mode through
         * {@link sandboxMode}. `false` restores the pre-sandbox behaviour exactly —
         * an unfenced backend that reports `undefined` — for an operator who wants
         * the old posture and accepts what it means: the model is told these
         * operations are unconfined.
         */
        sandbox: z<boolean, boolean, "defined">;
        /**
         * Run confined mutations in the session's systemd user scope — the same
         * runtime the shell executor acquires for the same session, distro,
         * workspace and policy — instead of a per-policy confined resident. A
         * missing session ID keeps the providers separate. The kernel enforcement
         * is the runtime's mount profile; the scope stops when its providers
         * release it. Requires systemd + `Linger`, like `wsl-shell`'s
         * `sessionSandbox`; the preflight refuses with the remedy. Off for direct
         * constructions; on in the shipped preset.
         */
        sessionSandbox: z<boolean | "auto", boolean | "auto", "defined">;
        /**
         * Shadow `/mnt` with an empty tmpfs in every confined profile, hiding the
         * Windows drive from confined commands — same meaning and same honest
         * limits as the `wsl-shell` key of the same name (its doc carries the
         * full story). Confined fs mutations publish through the masked resident;
         * reads and the share substrate are unaffected.
         */
        maskWindowsDrive: z<boolean, boolean, "defined">;
        /**
         * Extra directories under `workspace-write`, in distro spelling — the
         * same list and same rules as `wsl-shell`'s key. Confined writes bind
         * them, and the fs fence accepts them; keep the two rows' lists equal so
         * a command and its write see one mount table.
         */
        writableRoots: z<string[], string[], "defined">;
        /**
         * Refuse any path that leaves the pinned distro. A WSL filesystem is a
         * whole-Linux view whose `/mnt/c` also reaches the Windows disk, so without
         * this the backend would silently widen the session far beyond the
         * workspace the operator selected.
         */
        restrictToDistro: z<boolean, boolean, "defined">;
        /**
         * How deep the in-distro watch scan walks, `1` = the watched directory and
         * its direct children. `0` — the default — walks the whole tree, which is
         * what the invalidation contract asks for but a real cost every poll over
         * a tree containing a `node_modules`; a bound trades that cost for a
         * documented blind spot: a change below the bound is not seen until
         * another change above it fires the same callback.
         */
        watchMaxDepth: z<number, number, "defined">;
        /**
         * Which I/O substrate serves the file tools. Only `"agent"` exists — the
         * resident in-distro agent (`lib/fs-substrate.js`): reads, writes and
         * identities run where the files live, symlinks and mode bits are native,
         * and the mutation guard survives to the write's no-replace publication,
         * kernel-enforced by the confined resident when the policy is confined.
         * The former `"share"` opt-out — the Windows-side host filesystem stack
         * over the distro's 9p share — is retired: it was the one model-facing
         * I/O path that still crossed the share, and the agent has no fallback
         * that needs it. A profile carrying `"share"` is refused at construction
         * with the migration (`shareSubstrateRefusal`). `watch()` rides the
         * in-distro poll loop for the substrate regardless (`lib/watcher.js`) —
         * it never ran through either substrate. The substrate never changes
         * `sandboxMode`'s honesty.
         */
        substrate: z<"agent" | "share", "agent" | "share", "defined">;
    }>>, "plain">;
    /** Cached default distro, resolved once from `wsl.exe -l -q`. */
    resolvedDistro: string;
    /** Cached distro-user home, the base for relative input when `cwd` is empty. */
    resolvedHome: string | undefined;
    /** Per-distro homes, so two concurrent distros cannot share one. */
    resolvedHomes: Map<string, string>;
    /** The deployment default mode — the capability fact the tool layer reads. */
    defaultMode: SandboxMode;
    /** The lazy default-distro substrate, kept for the legacy accessor and tests. */
    agentSubstrateInstance: AgentSubstrate | undefined;
    /** The per-distro agent-backed substrates. */
    agentSubstrates: Map<string, AgentSubstrate>;
    /** The distro-side bwrap usability probe, shared with the confined agents. */
    sandbox: InstanceType<typeof WslSandbox>;
    /** The resident agent serving publication for the default/pinned distro. */
    agentInstance: WslAgent | undefined;
    /** The per-distro publication agents. */
    agentInstances: Map<string, WslAgent>;
    /** The session-runtime registry; tests substitute it. */
    sessionRuntimes: SessionRuntimes;
    /** The runtimes this provider holds, by registry key. */
    sessionRuntimeEntries: Map<string, SessionRuntimeEntry>;
    /** Isolates calls that have no session identity. */
    sessionRuntimeOwner: string;
    /** The preflight's host runner; tests substitute it. */
    sessionScopeProbe: (argv: string[]) => Promise<string>;
    /** The one-time writable-root check's runner; tests substitute it. */
    writableRootsProbe: (argv: string[]) => Promise<string>;
    /** Distros whose session-runtime preflight has succeeded. */
    sessionRuntimePreflight: Set<string>;
    /** Per-distro `auto` verdicts, re-probed when they were negative and stale. */
    autoSessionScope: Map<string, {
        usable: boolean;
        checkedAt: number;
    }>;
    /**
     * @param ctx - the composition context.
     * @param config - the validated plugin config.
     */
    constructor(ctx: Context, config: WslFileSystemConfig);
    /**
     * The mode this backend fences mutations with, or `undefined` when the
     * operator turned the fence off. This is the capability fact `dsh-tool-fs`
     * reads to advertise the escalation fields honestly, so it must disappear
     * together with the enforcement — never claim a boundary that is not applied.
     *
     * @returns the deployment default mode, or `undefined` when unfenced.
     */
    get sandboxMode(): SandboxMode | undefined;
    /**
     * The resident agent serving the default/pinned distro's in-distro side
     * work, created on first use and kept for the provider's lifetime.
     *
     * @returns the agent for the default/pinned distro.
     */
    publicationAgent(): Promise<WslAgent>;
    /**
     * The resident agent for one distro. The default/pinned distro keeps the
     * legacy {@link publicationAgent} cache; every other distro gets its own
     * entry, because the shared agent is a per-distro process singleton.
     *
     * @param distro - the distro name.
     * @returns the agent for that distro.
     */
    publicationAgentFor(distro: string): Promise<WslAgent>;
    /**
     * The agent-backed substrate for the default/pinned distro, built on first
     * use over the shared resident agent.
     *
     * @returns the substrate.
     */
    agentSubstrate(): Promise<AgentSubstrate>;
    /**
     * The agent-backed substrate for one distro. The default/pinned distro keeps
     * the legacy {@link agentSubstrate} accessor (and its test override); every
     * other distro gets a substrate that mints its own UNC identities and
     * addresses its own resident.
     *
     * @param distro - the distro name.
     * @returns the substrate for that distro.
     */
    agentSubstrateFor(distro: string): Promise<AgentSubstrate>;
    /**
     * The substrate for one resolved target, following the target's UNC identity.
     *
     * @param target - the resolved target.
     * @returns the substrate for the target's distro.
     */
    substrateForTarget(target: FsTarget): Promise<AgentSubstrate>;
    /**
     * The effective extra writable roots for one mutation: the row's
     * `writableRoots` plus the shared policy's `additionalWritableRoots`,
     * resolved to Linux paths and checked once per process. Empty unless the
     * mutation is confined under `workspace-write`.
     *
     * @param distro - the distro the mutation belongs to.
     * @param policy - the per-call file-effect policy, when there is one.
     * @returns the roots every confinement site binds.
     * @throws {SandboxInvalidRootError} when an entry cannot be granted or checked.
     */
    writableRootsFor(distro: string, policy: {
        mode: string;
        workspaceRoot: string;
        additionalWritableRoots?: readonly string[];
    } | undefined, check?: boolean): Promise<string[]>;
    /**
     * The persistent session runtime for one confined mutation, when
     * `sessionSandbox` is on. The key is the shell executor's key for the same
     * session/policy, so the write and the commands share one agent, one mount
     * view and one scope; the provider holds a reference until the session ends.
     *
     * @param policy - the resolved confined policy.
     * @param distro - the resolved distro name.
     * @param writableRoots - the effective extra roots the runtime binds.
     * @returns the runtime entry, or undefined when the mode is off.
     */
    sessionRuntimeFor(policy: {
        mode: string;
        workspaceRoot: string;
        sessionId?: string;
    }, distro: string, writableRoots?: readonly string[]): SessionRuntimeEntry | undefined;
    /**
     * Run the session runtime's preflight once per provider. Only success is
     * cached, so following the remedy does not need an app restart.
     *
     * @param distro - the resolved distro name.
     * @returns resolved once the platform can host the runtime.
     * @throws {Error} with the remedy when it cannot.
     */
    ensureSessionRuntimeUsable(distro: string): Promise<void>;
    /**
     * Whether this provider should use the session runtime for one distro, with
     * the `auto` downgrade and its bounded re-probe. `true` keeps the refusing
     * behavior; `false` stays off.
     *
     * @param distro - the resolved distro.
     * @returns whether to acquire the per-session scope.
     */
    wantsSessionRuntime(distro: string): Promise<boolean>;
    /**
     * Release every runtime this provider holds. Called from the preset's
     * dispose effect; public so tests and shutdown paths can await it.
     *
     * @returns resolved once every reference is released.
     */
    disposeSessionRuntimes(): Promise<void>;
    /**
     * The agent a MUTATION runs on under this resolved policy — stage-two
     * routing. A confined policy addresses the confined resident whose bwrap
     * profile binds exactly what the mode grants, so the kernel enforces what
     * the check decided; an escalated write (`danger-full-access`) or a disabled
     * sandbox addresses the plain resident, which is what those mean. A distro
     * without a usable bwrap refuses confined mutations instead of downgrading
     * them — the same closed failure the command path has.
     *
     * @param policy - the resolved file-effect policy, or undefined when the
     *   caller pre-checked.
     * @param forDistro - the distro the mutation belongs to; derived from the
     *   policy when the caller does not know it.
     * @returns the agent to publish through.
     */
    mutationAgent(policy: {
        mode: string;
        workspaceRoot: string;
        sessionId?: string;
        additionalWritableRoots?: readonly string[];
    } | undefined, forDistro?: string): Promise<WslAgent>;
    /**
     * Map a substrate error onto the peer's `FsError`, so the tool layer reads
     * the same refusal dialect on both substrates. An agent that is out becomes
     * an I/O error naming the cause — the share backend's "distro is gone" case
     * is the same availability, but the message says which substrate failed.
     *
     * @param error - what the substrate raised.
     * @returns the error to surface.
     */
    peerError(error: unknown): FsError;
    /**
     * One resolved target's Linux path — the substrate's coordinate — falling
     * back to the display spelling when the identity is not a distro share path.
     *
     * @param target - the resolved target.
     * @returns the absolute Linux path.
     */
    linuxOf(target: FsTarget): string;
    /**
     * The distro used when no path supplies evidence: the pinned name, WSL's
     * default, or the default for the automatic modes.
     *
     * @returns the distro name.
     */
    distro(): Promise<string>;
    /**
     * The distro one path belongs to: an explicit pin wins; otherwise the path
     * itself, then the cwd or configured cwd, may name a distro; both absent
     * falls back to WSL's default.
     *
     * @param path - the caller path, in any coordinate system.
     * @param cwd - the caller's optional cwd override.
     * @returns the distro name.
     */
    distroForPath(path: string, cwd?: string): Promise<string>;
    /**
     * The distro a resolved target belongs to. A UNC identity names it outright;
     * a host-coordinate target falls back to the configured/default distro.
     *
     * @param target - the resolved target.
     * @returns the distro name.
     */
    distroForTarget(target: FsTarget): Promise<string>;
    /**
     * The distro a mutation's policy belongs to: the workspace root is the
     * strongest evidence, then the configured cwd, then the default.
     *
     * @param policy - the resolved policy, when the caller has one.
     * @returns the distro name.
     */
    distroForPolicy(policy: {
        mode: string;
        workspaceRoot: string;
    } | undefined): Promise<string>;
    /**
     * Translate one caller path into the world path, enforcing the distro fence.
     *
     * @param path - a Linux, UNC or Windows path.
     * @param cwd - the caller's override of the configured default workdir.
     * @returns the host path to operate on.
     */
    worldPath(path: string, cwd?: string): Promise<string>;
    /**
     * Resolve a path to a target whose `targetKey` is the UNC identity the host
     * I/O stack uses and whose `displayPath` is the Linux path the model sees.
     *
     * @param path - a Linux, UNC or Windows path.
     * @param opts - optional `cwd` override and `signal`.
     * @returns the resolved `FsTarget`.
     */
    resolve(path: string, opts?: {
        cwd?: string;
        signal?: AbortSignal;
    }): Promise<FsTarget>;
    /**
     * Enforce the per-call file-effect policy against one target and return the
     * EXACT target the mutation must use, so the checked identity is the mutated
     * one (no check-here-write-there window).
     *
     * `read-only` denies outright. `workspace-write` re-resolves the target NOW
     * (reflecting a symlink ancestor swapped since the tool resolved it), requires
     * containment under a writable root — the workspace plus the temp area of the
     * world the workspace lives in — and hands back that fresh target.
     * `danger-full-access` is the approved escalation and is not fenced. Refusal
     * is the structured `FS_SANDBOX_DENIED` the tool layer maps to its
     * model-facing `[sandbox: …]` marker and escalation hint.
     *
     * @param target - the resolved target to mutate.
     * @param sandboxPolicy - the per-call mode and workspace root; omit for the
     *   deployment policy.
     * @returns the target the mutation must use.
     * @throws {FsError} with `FS_SANDBOX_DENIED` when the policy refuses it.
     */
    checkedTarget(target: FsTarget, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsTarget>;
    /**
     * One target's metadata, answered from the distro.
     *
     * @param target - the resolved target.
     * @param signal - optional cancellation.
     * @returns the metadata, or undefined when absent.
     */
    stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>;
    /**
     * No-follow stat one path. The agent substrate answers from the distro,
     * where a symlink is a first-class entry.
     *
     * @param path - a Linux, UNC or Windows path.
     * @param opts - optional `cwd` override.
     * @param signal - optional cancellation.
     * @returns the path info, or undefined when absent.
     */
    lstat(path: string, opts?: {
        cwd?: string;
    }, signal?: AbortSignal): Promise<FsPathInfo | undefined>;
    /**
     * Read one whole regular UTF-8 file from the distro.
     *
     * @param target - the resolved target.
     * @param signal - optional cancellation.
     * @returns the file text.
     */
    readText(target: FsTarget, signal?: AbortSignal): Promise<string>;
    /**
     * Stream one whole regular UTF-8 file from the distro.
     *
     * @param target - the resolved target.
     * @param signal - optional cancellation.
     * @returns the text chunks.
     */
    streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>;
    /**
     * Read one whole regular file as raw bytes, bounded.
     *
     * @param target - the resolved target.
     * @param signal - optional cancellation.
     * @param maxBytes - inclusive byte cap on the content.
     * @returns the bytes.
     */
    readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>;
    /**
     * Read one byte window of a regular file.
     *
     * @param target - the resolved target.
     * @param range - the window.
     * @param signal - optional cancellation.
     * @returns the window's bytes.
     */
    readByteRange(target: FsTarget, range: {
        offset: number;
        length: number;
    }, signal?: AbortSignal): Promise<Uint8Array>;
    /**
     * List one directory level. The substrate's rows already carry Linux display
     * paths and canonical identities — nothing to rewrite.
     *
     * @param target - the resolved directory.
     * @param signal - optional cancellation.
     * @returns the directory rows.
     */
    listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>;
    /**
     * Map an absolute host path into this execution world, SYNCHRONOUSLY — the
     * upstream contract (`FileSystem.processPathFromHostPath`) and what its
     * consumers rely on: `packages/spill/spill-policy` passes this method as a
     * plain callback over image attachments, and `packages/api/session-controller`
     * plus the UI's open/reveal path compare the return value against `undefined`
     * without awaiting. The mapping is therefore built from facts that are already
     * known — a UNC host path names its own distro outright; a non-UNC path uses
     * the pinned/config default once `distro()` has resolved it, and the
     * configured `cwd`, or the resolved home for a relative path. A call that
     * would have to ask `wsl.exe` — a cold default distro with no UNC, or a
     * relative path before the home is known — answers `undefined`, which every
     * consumer reads as "no mapping", the same answer the ssh provider gives for
     * a path it cannot map.
     *
     * The VALUE is the world spelling the backend keys on (the UNC identity for a
     * distro path), so the consumers' round trip — map, `resolve`, `processPath`,
     * compare with the original host path — closes exactly as it does for the
     * host backend. Real operations are unaffected: they take the async
     * {@link WslFileSystem.worldPath} and its loud refusals.
     *
     * @param hostPath - an absolute host path (a relative one maps only when the
     *   configured `cwd` or a known home gives it a base).
     * @returns the world path for the same file, or undefined when it cannot be
     *   mapped with what is already known.
     */
    processPathFromHostPath(hostPath: string): string | undefined;
    /**
     * Watch from inside the distro, where the kernel can actually report change:
     * a long-lived `wsl.exe` poll loop (`lib/watcher.js`) fires the seam's
     * invalidation callback. The seam asks for coarse invalidation, not events,
     * so a poll is honest — and creations and deletions are both seen, because
     * they bump the parent directory's mtime. Replaces the previous flat
     * refusal (`FS_IO_ERROR`), which was the correct answer over 9p only.
     *
     * A target that disappears mid-watch ends the loop with a report through
     * `changed` — never the armed-but-never-fires silence a missing directory
     * would otherwise produce. The scan's depth is `watchMaxDepth`.
     *
     * @param target - the resolved file or directory to observe.
     * @param changed - the invalidation callback.
     * @param signal - cancels initialization; the caller closes an armed watcher.
     * @returns resolves once active, with the async close function.
     */
    watch(target: FsTarget, changed: (error?: Error) => void, signal: AbortSignal): Promise<() => Promise<void>>;
    /**
     * Fence the write by the per-call policy, then publish through the
     * substrate. The fence's fresh target is the one checked and written, so a
     * refusal costs no I/O and cannot be raced by a swapped symlink; the guard
     * rides the write op, where the agent re-verifies it before the rename;
     * the confined resident enforces the mount boundary in the kernel.
     *
     * @param target - the resolved target.
     * @param content - the full new file content.
     * @param expected - the write intent.
     * @param signal - optional cancellation.
     * @param sandboxPolicy - the per-call mode and workspace root; omit for the
     *   deployment policy.
     * @returns the write outcome.
     */
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsWriteOutcome>;
    /**
     * Fence the edit by the same policy, keeping the guard's observable
     * behaviour.
     *
     * @param target - the resolved target.
     * @param edit - the literal search/replace request.
     * @param expected - the version guard.
     * @param signal - optional cancellation.
     * @param sandboxPolicy - the per-call mode and workspace root; omit for the
     *   deployment policy.
     * @returns the edit outcome.
     */
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: FsVersion;
    }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsEditOutcome>;
    /**
     * Apply parsed hunks (protocol 7): hunk matching and application run
     * in-process through the peer's own `applyHunks` (the same dialect and
     * `FS_PATCH_MISMATCH` the peer emits), against the distro's bytes, then
     * publish through the same guarded atomic write an edit takes.
     *
     * @param target - the resolved regular file.
     * @param hunks - ordered hunks from the caller's patch parse.
     * @param expected - the version the patch was based on.
     * @param signal - cancels the patch.
     * @param sandboxPolicy - the per-call policy; omit for the deployment default.
     * @returns the pre/post text and the published version.
     */
    patchText(target: FsTarget, hunks: PatchHunks, expected?: {
        version: FsVersion;
    }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsEditOutcome>;
    /**
     * Remove one regular file (protocol 7) after fencing the target by the
     * per-call policy; the guarded removal re-verifies the expected version
     * distro-side.
     *
     * @param target - the resolved file.
     * @param expected - the version the removal was based on.
     * @param signal - cancels the removal.
     * @param sandboxPolicy - the per-call policy; omit for the deployment default.
     * @returns the bounded pre-removal text basis.
     */
    deleteFile(target: FsTarget, expected?: {
        version: FsVersion;
    }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsDeleteOutcome>;
    /**
     * Move one regular file (protocol 7) after fencing BOTH endpoints by the
     * per-call policy — the destination publishes and the source is removed, so
     * each must be writable under the same roots.
     *
     * @param source - the resolved source.
     * @param destination - the resolved destination.
     * @param options - the hunks and the source/destination guards.
     * @param signal - cancels before publication.
     * @param sandboxPolicy - the per-call policy; omit for the deployment default.
     * @returns the bounded source basis and the destination outcome.
     */
    moveFile(source: FsTarget, destination: FsTarget, options: MoveFileOptions, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsMoveOutcome>;
}
export {};
