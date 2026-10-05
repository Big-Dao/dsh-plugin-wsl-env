/**
 * Bash executor that runs every command inside a WSL distro.
 *
 * Extends the unconfined `LocalBashExecutor`, so command defaulting, deadline
 * handling, output caps, spill files and background-process management are the
 * shipped implementation's; this subclass replaces only the argv (prefix with
 * `wsl.exe`) and the process working directory (wsl.exe must be started from a
 * Windows directory, while the Linux directory rides on `--cd`).
 */
export class WslShellExecutor extends LocalBashExecutor {
    static Config: z<Schemastery.ObjectS<NoInfer<{
        /** Distro name; empty means WSL's own default distro. */
        distro: z<string, string, "defined">;
        /** Path to `wsl.exe`; overridable for a non-standard install. */
        wslPath: z<string, string, "defined">;
        /**
         * The shell commands run in. Empty means "resolve the login shell of the
         * distro's user" — hardcoding bash silently ignores a user whose passwd
         * entry points at zsh, fish, dash, or anything else, losing their PATH and
         * rc setup. Set an absolute path inside the distro to pin one.
         */
        shell: z<string, string, "defined">;
        /**
         * Login-shell semantics (`<shell> -lc`) source the profile scripts, which is
         * what makes an interactive WSL setup's PATH (nvm, cargo, pyenv) visible.
         * Set false for a fast, fully deterministic `<shell> -c`. Applies only to the
         * POSIX family — see `shellArgs` for why other shells get a bare `-c`.
         */
        loginShell: z<boolean, boolean, "defined">;
        /**
         * Confine every command inside the distro with `bwrap`, and report the
         * policy's mode through {@link sandboxMode}. Fails closed: a distro without
         * a usable `bwrap` produces `SANDBOX_UNAVAILABLE` rather than an unconfined
         * run. `false` restores the pre-sandbox behaviour exactly — commands run
         * unconfined and `sandboxMode` is `undefined`, so the model is told so.
         */
        sandbox: z<boolean, boolean, "defined">;
        /**
         * Shadow `/mnt` with an empty tmpfs in every confined profile, hiding the
         * Windows drive from confined commands: its files cannot be read or
         * exfiltrated and its executables cannot be launched through interop —
         * the hole that lets a "sandboxed" command reach your full Windows token.
         * A narrowing, not a closure (a command can still write an executable
         * into the workspace and run it — binfmt dispatches on content, not
         * location), so enforcement stays `partial` and the sandbox fact reports
         * `windowsDrive: "masked"`. Costs: confined commands cannot read or touch
         * anything under `/mnt`, and tools that probe the drive degrade. The
         * complete closure is distro-level: `[interop] enabled=false` in
         * `wsl.conf`.
         */
        maskWindowsDrive: z<boolean, boolean, "defined">;
        /**
         * Default workdir for a request that names none; accepts `/home/andy/proj`,
         * a UNC path, or `C:\...`. Empty — the default — means the distro user's
         * home, resolved inside the distro.
         */
        cwd: z<string, string, "volatile">;
        /** Windows directory the `wsl.exe` process itself starts in. */
        hostCwd: z<string, string, "volatile">;
        /** Extra env names to forward into the distro through WSLENV. */
        forwardEnv: z<string[], string[], "defined">;
        timeoutMs: z<number, number, "volatile-defined">;
        maxTimeoutMs: z<number, number, "volatile-defined">;
        maxOutputBytes: z<number, number, "volatile-defined">;
        maxSpillBytes: z<number, number, "volatile-defined">;
        graceMs: z<number, number, "volatile-defined">;
        /**
         * Run commands through the resident agent when it is up (one long-lived
         * in-distro process; in-distro timeout semantics), falling back to the
         * one-shot `wsl.exe` path whenever the agent is out. `false` never uses
         * the agent. The confinement, the output budgets' shapes and the result
         * decoration are identical on both paths.
         */
        agent: z<boolean, boolean, "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /** Distro name; empty means WSL's own default distro. */
        distro: z<string, string, "defined">;
        /** Path to `wsl.exe`; overridable for a non-standard install. */
        wslPath: z<string, string, "defined">;
        /**
         * The shell commands run in. Empty means "resolve the login shell of the
         * distro's user" — hardcoding bash silently ignores a user whose passwd
         * entry points at zsh, fish, dash, or anything else, losing their PATH and
         * rc setup. Set an absolute path inside the distro to pin one.
         */
        shell: z<string, string, "defined">;
        /**
         * Login-shell semantics (`<shell> -lc`) source the profile scripts, which is
         * what makes an interactive WSL setup's PATH (nvm, cargo, pyenv) visible.
         * Set false for a fast, fully deterministic `<shell> -c`. Applies only to the
         * POSIX family — see `shellArgs` for why other shells get a bare `-c`.
         */
        loginShell: z<boolean, boolean, "defined">;
        /**
         * Confine every command inside the distro with `bwrap`, and report the
         * policy's mode through {@link sandboxMode}. Fails closed: a distro without
         * a usable `bwrap` produces `SANDBOX_UNAVAILABLE` rather than an unconfined
         * run. `false` restores the pre-sandbox behaviour exactly — commands run
         * unconfined and `sandboxMode` is `undefined`, so the model is told so.
         */
        sandbox: z<boolean, boolean, "defined">;
        /**
         * Shadow `/mnt` with an empty tmpfs in every confined profile, hiding the
         * Windows drive from confined commands: its files cannot be read or
         * exfiltrated and its executables cannot be launched through interop —
         * the hole that lets a "sandboxed" command reach your full Windows token.
         * A narrowing, not a closure (a command can still write an executable
         * into the workspace and run it — binfmt dispatches on content, not
         * location), so enforcement stays `partial` and the sandbox fact reports
         * `windowsDrive: "masked"`. Costs: confined commands cannot read or touch
         * anything under `/mnt`, and tools that probe the drive degrade. The
         * complete closure is distro-level: `[interop] enabled=false` in
         * `wsl.conf`.
         */
        maskWindowsDrive: z<boolean, boolean, "defined">;
        /**
         * Default workdir for a request that names none; accepts `/home/andy/proj`,
         * a UNC path, or `C:\...`. Empty — the default — means the distro user's
         * home, resolved inside the distro.
         */
        cwd: z<string, string, "volatile">;
        /** Windows directory the `wsl.exe` process itself starts in. */
        hostCwd: z<string, string, "volatile">;
        /** Extra env names to forward into the distro through WSLENV. */
        forwardEnv: z<string[], string[], "defined">;
        timeoutMs: z<number, number, "volatile-defined">;
        maxTimeoutMs: z<number, number, "volatile-defined">;
        maxOutputBytes: z<number, number, "volatile-defined">;
        maxSpillBytes: z<number, number, "volatile-defined">;
        graceMs: z<number, number, "volatile-defined">;
        /**
         * Run commands through the resident agent when it is up (one long-lived
         * in-distro process; in-distro timeout semantics), falling back to the
         * one-shot `wsl.exe` path whenever the agent is out. `false` never uses
         * the agent. The confinement, the output budgets' shapes and the result
         * decoration are identical on both paths.
         */
        agent: z<boolean, boolean, "defined">;
    }>>, "plain">;
    /**
     * Decorate a handle's foreground projection in place, memoized once. The
     * handle keeps its identity — never wrapped in a second object — because the
     * per-process facts and `onProcessDone` key on the exact instance.
     *
     * @template R - the settled result row the handle's `result()` resolves with.
     * @template {{ result(): Promise<R> }} H - the concrete handle type, preserved
     *   so the decorated handle keeps its identity in the callers' types.
     * @param {H} ex - the execution handle to decorate.
     * @param {(result: R) => R} map - maps the settled result.
     * @param {(error: unknown) => R} mapError - maps a rejection, when the caller has one.
     * @returns {H} the same handle.
     */
    static decorateResult<R, H extends {
        result(): Promise<R>;
    }>(ex: H, map: (result: R) => R, mapError: (error: unknown) => R): H;
    /**
     * @param {Context} ctx - the composition context.
     * @param {WslShellExecutorConfig} config - the validated plugin config.
     */
    constructor(ctx: Context, config: WslShellExecutorConfig);
    /** Cached default distro, resolved once from `wsl.exe -l -q`. */
    resolvedDistro: string;
    /** Cached distro-user login shell, resolved once. */
    resolvedShell: string;
    /** @type {string | undefined} Cached distro-user home, the workdir when `cwd` is empty. */
    resolvedHome: string | undefined;
    /** The default mode — the capability fact the tool layer reads. */
    mode: SandboxMode | undefined;
    /** The distro-side confinement, or nothing when the operator opted out. */
    sandbox: import("./sandbox-core.js").WslSandboxCoreInstance | undefined;
    /**
     * Per-process confinement facts retained until settlement. Overlapping calls
     * can carry different policies, so a shared latest-wrap value would classify
     * a process against the wrong facts. Unconfined processes have no entry.
     */
    processFacts: Map<any, any>;
    /**
     * The distro every command runs in, resolving WSL's default on first use.
     * @returns {Promise<string>} the distro name.
     */
    distro(): Promise<string>;
    /**
     * The shell every command runs in: the configured one, else the login shell of
     * the distro user, resolved once and cached.
     * @returns an absolute path to the shell inside the distro.
     */
    shellName(): Promise<string>;
    shell(): Promise<string>;
    /**
     * Windows directory the `wsl.exe` process is started from.
     * @returns {string} the host directory to spawn in.
     */
    hostCwd(): string;
    /**
     * The shared resident agent serving this executor's distro.
     * @param {string} distro - the resolved distro name.
     * @returns {WslAgent} the shared agent.
     */
    executionAgent(distro: string): WslAgent;
    /**
     * The argv that runs INSIDE the distro for one spec: the resolved shell, its
     * login/command flags, and the command string. This is the argv a
     * distro-side sandbox wraps, which is why it is built separately from the
     * `wsl.exe` invocation around it.
     *
     * @param {ShellExecSpec} spec - the resolved spec from {@link LocalBashExecutor.resolve}.
     * @param {string} shell - the resolved distro shell.
     * @returns {string[]} the distro-side argv.
     */
    distroArgv(spec: ShellExecSpec, shell: string): string[];
    /**
     * Build the `wsl.exe` argv for one resolved spec. The command string is
     * passed as a single argv element to the resolved shell, so there is no
     * quoting layer of our own; Node's argv array reaches `wsl.exe` verbatim.
     *
     * `--exec` is load-bearing — see the comment inside.
     *
     * @param {ShellExecSpec} spec - the resolved spec from {@link LocalBashExecutor.resolve}.
     * @param {string} distro - the resolved distro name.
     * @param {string} shell - the resolved distro shell.
     * @param {string[]} [inner] - the already-confined distro argv, when confinement applies.
     * @returns {string[]} the argv to spawn.
     */
    argv(spec: ShellExecSpec, distro: string, shell: string, inner?: string[]): string[];
    /**
     * Override only the spawn's working directory and environment. `spec.workdir`
     * is a Linux path, which a Windows CreateProcess call cannot use as `cwd`.
     *
     * The inherited builder is private, so the call goes through the
     * {@link SpawnSeamExecutor} bridge (`inheritedSpawnSpec`) instead of `super`
     * — see docs/UPSTREAM-SPAWN-SEAM.md.
     *
     * @param {ShellExecSpec} spec - resolved execution settings.
     * @param {string[]} argv - the argv from {@link WslShellExecutor.argv}.
     * @param {number} stdoutMaxBytes - per-call stdout cap.
     * @param {AbortSignal} [signal] - the spawn cancellation signal.
     * @returns {SubprocessSpawnSpec} the subprocess spawn spec.
     */
    spawnSpec(spec: ShellExecSpec, argv: string[], stdoutMaxBytes: number, signal?: AbortSignal): SubprocessSpawnSpec;
    /**
     * The spec to execute, with the home marker resolved against the distro
     * user's home: `workdir: ""` becomes the home itself, and a relative tail
     * carried by {@link WslShellExecutor.resolve} is joined under it. That is one
     * `sh -c 'printf %s "$HOME"'` per provider instance, cached, and it happens
     * only for a request that defaulted — an absolute workdir never reaches here.
     *
     * @param {WslExecSpec} spec - the resolved spec.
     * @returns {Promise<WslExecSpec>} the spec to execute.
     */
    withDefaultWorkdir(spec: WslExecSpec): Promise<WslExecSpec>;
    /**
     * Stamp the per-process sandbox facts before `done` settles, so a background
     * process reports the same mode, denial and enforcement a foreground run
     * would. Signal deaths are not denials.
     *
     * @param {ShellExecution} proc - the settled process handle.
     * @param {string} stderr - the process's retained stderr tail used by subclasses for settlement classification.
     * @param {boolean} providerRejected - whether the subprocess promise rejected without a direct outcome.
     * @param {unknown} [providerError] - the provider rejection reason, which may itself be undefined.
     */
    onProcessDone(proc: ShellExecution, stderr: string, providerRejected: boolean, providerError?: unknown): void;
    /**
     * Reject a settled command that failed because the distro itself is missing,
     * stopped or unregistered.
     *
     * `wsl.exe` exits non-zero for that with an EMPTY stderr and its diagnostic on
     * stdout, so nothing else here can see it: the denial signatures read stderr, and
     * the result would otherwise reach the model as a bare non-zero code with no
     * cause. The message names the remedy and says plainly that a wider permission
     * cannot help — a sandbox flag does not create a distro.
     *
     * @param {{ exitCode?: number | null, stdout?: { text?: string }, stderr?: { text?: string }} | undefined} result - the settled shell result.
     * @param {string} distro - the distro the command asked for.
     * @throws {Error} carrying the `WSL_E_*` code and the remedy.
     */
    throwIfDistroUnavailable(result: {
        exitCode?: number | null;
        stdout?: {
            text?: string;
        };
        stderr?: {
            text?: string;
        };
    } | undefined, distro: string): void;
    /**
     * Reject a command that ran in the wrong directory.
     *
     * `wsl.exe --cd <path>` does not fail on a missing directory: it warns on stderr,
     * runs the command in `/`, and exits 0. Reporting that as success would let a write
     * or a build act on the wrong tree while every signal says it worked, so it becomes
     * an error naming the directory that could not be entered.
     *
     * @param {{ exitCode?: number | null, stdout?: { text?: string }, stderr?: { text?: string }} | undefined} result - the settled shell result.
     * @param {string} workdir - the Linux directory the request asked for.
     * @throws {Error} naming the directory and the fallback that happened.
     */
    throwIfWorkdirMissing(result: {
        exitCode?: number | null;
        stdout?: {
            text?: string;
        };
        stderr?: {
            text?: string;
        };
    } | undefined, workdir: string): void;
    /**
     * Refuse a workdir that names another WSL distro — the shell-side twin of
     * the filesystem's `FS_OUTSIDE_DISTRO` fence. Left unguarded, `toLinuxPath`
     * strips the UNC's distro name and the command runs inside THIS distro
     * against whatever tree happens to share the path, silently, while the fs
     * side refuses the same workspace outright. The wording mirrors the fs
     * refusal (minus `restrictToDistro`, which is an fs-only key).
     * @param {string} workdir - the resolved workdir (UNC, Linux path, or Windows path).
     * @param {string} distro - the pinned distro name.
     * @throws {Error} naming both distros and both ways out.
     */
    throwIfWorkdirInAnotherDistro(workdir: string, distro: string): void;
    /**
     * The agent-backed execution path: one long-lived in-distro process, the
     * confinement argv unchanged, the handle shape unchanged. Any
     * {@link AgentUnavailableError} propagates for the caller's fallback.
     * @param {WslExecSpec} resolved - the resolved spec from {@link WslShellExecutor.execute}.
     * @param {string} distro - the resolved distro name.
     * @param {string} shell - the resolved distro shell.
     * @returns {Promise<ShellExecution>} the decorated execution result.
     */
    executeViaAgent(resolved: WslExecSpec, distro: string, shell: string): Promise<ShellExecution>;
    /**
     * The pre-agent execution path, verbatim: one `wsl.exe` per command through
     * the inherited `executeArgv` machinery. Kept as the permanent fallback for
     * an out-of-service agent and as the `agent: false` behaviour.
     * @param {WslExecSpec} resolved - the resolved spec.
     * @param {string} distro - the resolved distro name.
     * @param {string} shell - the resolved distro shell.
     * @returns {Promise<ShellExecution>} the decorated execution result.
     */
    executeOneShot(resolved: WslExecSpec, distro: string, shell: string): Promise<ShellExecution>;
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
/**
 * The WSL filesystem provider's validated config — the keys of
 * {@link WslFileSystem.Config}, which the upstream `LocalFileSystem` config
 * type does not know. This provider has no volatile fields: every key is read
 * as its plain value.
 * @typedef {object} WslFileSystemConfig
 * @property {string} distro - the pinned distro; empty resolves WSL's default.
 * @property {string} cwd - the base directory for relative input.
 * @property {string} wslPath - the `wsl.exe` path, for default-distro resolution.
 * @property {number} [diffBasisMaxBytes] - the overwrite-diff byte bound per
 *   side; schema-defaulted when mounted through cordis, and defaulted again by
 *   the substrate when absent.
 * @property {boolean} sandbox - whether mutations are fenced by the policy.
 * @property {boolean} maskWindowsDrive - whether confined profiles mask `/mnt`.
 * @property {boolean} restrictToDistro - whether paths leaving the distro are refused.
 * @property {number} watchMaxDepth - the in-distro watch scan depth bound.
 * @property {string} [substrate] - which I/O substrate serves the file tools;
 *   schema-defaulted when mounted through cordis, absent on direct
 *   construction (the router), which the constructor's refusal treats as
 *   `"agent"`.
 */
export class WslFileSystem extends LocalFileSystem {
    static inject: string[];
    static Config: z<Schemastery.ObjectS<NoInfer<{
        /** Distro name; empty resolves WSL's default on first use. */
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
         * Shadow `/mnt` with an empty tmpfs in every confined profile, hiding the
         * Windows drive from confined commands — same meaning and same honest
         * limits as the `wsl-shell` key of the same name (its doc carries the
         * full story). Confined fs mutations publish through the masked resident;
         * reads and the share substrate are unaffected.
         */
        maskWindowsDrive: z<boolean, boolean, "defined">;
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
        /** Distro name; empty resolves WSL's default on first use. */
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
         * Shadow `/mnt` with an empty tmpfs in every confined profile, hiding the
         * Windows drive from confined commands — same meaning and same honest
         * limits as the `wsl-shell` key of the same name (its doc carries the
         * full story). Confined fs mutations publish through the masked resident;
         * reads and the share substrate are unaffected.
         */
        maskWindowsDrive: z<boolean, boolean, "defined">;
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
    /**
     * @param {Context} ctx - the composition context.
     * @param {WslFileSystemConfig} config - the validated plugin config.
     */
    constructor(ctx: Context, config: WslFileSystemConfig);
    resolvedDistro: string;
    /** @type {string | undefined} Cached distro-user home, the base for relative input when `cwd` is empty. */
    resolvedHome: string | undefined;
    /** The deployment default mode — the capability fact the tool layer reads. */
    defaultMode: SandboxMode;
    /** @type {AgentSubstrate | undefined} The lazy agent-backed substrate, built on first use (see `agentSubstrate`). */
    agentSubstrateInstance: AgentSubstrate | undefined;
    /** The distro-side bwrap usability probe, shared with the confined agents. */
    sandbox: import("./sandbox-core.js").WslSandboxCoreInstance;
    /** @type {WslAgent | undefined} The resident agent serving publication (see `publicationAgent`). */
    agentInstance: WslAgent | undefined;
    /**
     * The resident agent serving this filesystem's in-distro side work, created
     * on first use and kept for the provider's lifetime (its own idle timer
     * retires the process; a later call starts a fresh one).
     * @returns {Promise<WslAgent>} the agent for the pinned distro.
     */
    publicationAgent(): Promise<WslAgent>;
    /**
     * The agent-backed substrate, built on first use over the same resident
     * agent every other distro side work shares.
     * @returns {Promise<AgentSubstrate>} the substrate.
     */
    agentSubstrate(): Promise<AgentSubstrate>;
    /**
     * The agent a MUTATION runs on under this resolved policy — stage-two
     * routing. A confined policy addresses the confined resident whose bwrap
     * profile binds exactly what the mode grants, so the kernel enforces what
     * the check decided; an escalated write (`danger-full-access`) or a disabled
     * sandbox addresses the plain resident, which is what those mean. A distro
     * without a usable bwrap refuses confined mutations instead of downgrading
     * them — the same closed failure the command path has.
     * @param {{mode: string, workspaceRoot: string}|undefined} policy - the
     *   resolved file-effect policy, or undefined when the caller pre-checked.
     * @returns {Promise<WslAgent>} the agent to publish through.
     */
    mutationAgent(policy: {
        mode: string;
        workspaceRoot: string;
    } | undefined): Promise<WslAgent>;
    /**
     * Map a substrate error onto the peer's `FsError`, so the tool layer reads
     * the same refusal dialect on both substrates. An agent that is out becomes
     * an I/O error naming the cause — the share backend's "distro is gone" case
     * is the same availability, but the message says which substrate failed.
     * @param {unknown} error - what the substrate raised.
     * @returns {FsError} the error to surface.
     */
    peerError(error: unknown): FsError;
    /**
     * One resolved target's Linux path — the substrate's coordinate — falling
     * back to the display spelling when the identity is not a distro share path.
     * @param {FsTarget} target - the resolved target.
     * @returns {string} the absolute Linux path.
     */
    linuxOf(target: FsTarget): string;
    /**
     * The pinned distro, resolving WSL's default on first use.
     * @returns {Promise<string>} the distro name.
     */
    distro(): Promise<string>;
    /**
     * Translate one caller path into the world path, enforcing the distro fence.
     * @param {string} path - a Linux, UNC or Windows path.
     * @param {string} [cwd] - the caller's override of the configured default workdir.
     * @returns {Promise<string>} the host path to operate on.
     */
    worldPath(path: string, cwd?: string): Promise<string>;
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
     * @param {FsTarget} target - the resolved target to mutate.
     * @param {SandboxExecutionPolicy} [sandboxPolicy] - the per-call mode and workspace root; omit for the
     *   deployment policy.
     * @returns {Promise<FsTarget>} the target the mutation must use.
     * @throws {FsError} with `FS_SANDBOX_DENIED` when the policy refuses it.
     */
    checkedTarget(target: FsTarget, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsTarget>;
    /**
     * Map an absolute host path into this execution world. POSIX input is a Linux
     * path inside the distro; anything else keeps the host backend's behaviour.
     *
     * CONTRACT VIOLATION — read before consuming through the seam: the upstream
     * contract (`FileSystem.processPathFromHostPath`) is SYNCHRONOUS, and its
     * consumers call it without `await` (deepseek-harness `packages/spill/
     * spill-policy` passes it as a plain callback over image attachments;
     * `packages/api/session-controller` reads the return value and compares it
     * against `undefined`). This override is `async`, so a caller trusting the
     * upstream signature receives a PROMISE — always truthy, never `undefined` —
     * and maps nothing. Restoring the sync contract is a real behaviour change
     * (the distro resolution here can query `wsl.exe` when nothing is cached),
     * so it is the owner's design decision; until that lands this method must
     * not be consumed through the upstream sync contract.
     *
     * @param {string} hostPath - an absolute path.
     * @returns {Promise<string | undefined>} the process path for the same file, or undefined when unmappable.
     */
    processPathFromHostPath(hostPath: string): Promise<string | undefined>;
    /**
     * Fence the write by the per-call policy, then publish through the
     * substrate. The fence's fresh target is the one checked and written, so a
     * refusal costs no I/O and cannot be raced by a swapped symlink; the guard
     * rides the write op, where the agent re-verifies it one syscall before the
     * rename and the confined resident enforces it in the kernel.
     *
     * @param {FsTarget} target - the resolved target.
     * @param {string} content - the full new file content.
     * @param {FsWriteIntent} [expected] - the write intent.
     * @param {AbortSignal} [signal] - optional cancellation.
     * @param {SandboxExecutionPolicy} [sandboxPolicy] - the per-call mode and workspace root; omit for the
     *   deployment policy.
     * @returns {Promise<FsWriteOutcome>} the write outcome.
     */
    writeText(target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsWriteOutcome>;
    /**
     * Fence the edit by the same policy, keeping the guard's observable
     * behaviour.
     *
     * @param {FsTarget} target - the resolved target.
     * @param {FsEditRequest} edit - the literal search/replace request.
     * @param {{ version: FsVersion }} [expected] - the version guard.
     * @param {AbortSignal} [signal] - optional cancellation.
     * @param {SandboxExecutionPolicy} [sandboxPolicy] - the per-call mode and workspace root; omit for the
     *   deployment policy.
     * @returns {Promise<FsEditOutcome>} the edit outcome.
     */
    editText(target: FsTarget, edit: FsEditRequest, expected?: {
        version: FsVersion;
    }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy): Promise<FsEditOutcome>;
}
/**
 * Upstream shell vocabulary, derived through `@deepseek-ai/dsh-bash-local` —
 * this package does not depend on `@deepseek-ai/dsh-shell` directly, so the
 * execution types ride in through the executor's own signatures.
 */
export type ShellExecSpec = Parameters<LocalBashExecutor["execute"]>[0];
/**
 * Upstream shell vocabulary, derived through `@deepseek-ai/dsh-bash-local` —
 * this package does not depend on `@deepseek-ai/dsh-shell` directly, so the
 * execution types ride in through the executor's own signatures.
 */
export type ShellExecRequest = Parameters<LocalBashExecutor["resolve"]>[0];
/**
 * Upstream shell vocabulary, derived through `@deepseek-ai/dsh-bash-local` —
 * this package does not depend on `@deepseek-ai/dsh-shell` directly, so the
 * execution types ride in through the executor's own signatures.
 */
export type ShellExecution = Awaited<ReturnType<LocalBashExecutor["execute"]>>;
/**
 * One confined command's distro-side profile, as the confinement returns it:
 * the wrapped argv, the enforcement completeness, the denial dialect, the
 * runner-failure rules and the Windows-drive masking fact.
 */
export type ConfinedProfile = Awaited<ReturnType<InstanceType<new (config?: {
    wslPath?: string;
    maskWindowsDrive?: boolean;
} | undefined) => WslSandboxCoreInstance>["confine"]>>;
/**
 * The resolved spec this executor stamps with its home-marker fields: an empty
 * `workdir` plus the relative tail that {@link WslShellExecutor.withDefaultWorkdir}
 * joins against the distro home. The extra keys are this provider's own; the
 * seam's `ShellExecSpec` does not know them.
 */
export type WslExecSpec = ShellExecSpec & {
    relativeWorkdir?: string;
};
/**
 * The WSL shell executor's validated config — the keys of
 * {@link WslShellExecutor.Config}, which the upstream `LocalBashExecutor`
 * config type does not know. The seven volatile fields arrive as live
 * wrappers, so they are spelled as their `.get()` shape (the reading
 * {@link configuredCwd} and `hostCwd` perform).
 */
export type WslShellExecutorConfig = {
    /**
     * - the pinned distro; empty means WSL's default.
     */
    distro: string;
    /**
     * - the `wsl.exe` path.
     */
    wslPath: string;
    /**
     * - the distro shell; empty resolves the login shell.
     */
    shell: string;
    /**
     * - whether `<shell> -lc` semantics apply.
     */
    loginShell: boolean;
    /**
     * - whether commands confine inside the distro.
     */
    sandbox: boolean;
    /**
     * - whether confined profiles mask `/mnt`.
     */
    maskWindowsDrive: boolean;
    /**
     * - the volatile default workdir.
     */
    cwd: {
        get(): string | undefined;
    };
    /**
     * - the volatile Windows spawn directory.
     */
    hostCwd: {
        get(): string | undefined;
    };
    /**
     * - extra env names forwarded through WSLENV.
     */
    forwardEnv: string[];
    /**
     * - the volatile default timeout.
     */
    timeoutMs: {
        get(): number;
    };
    /**
     * - the volatile timeout cap.
     */
    maxTimeoutMs: {
        get(): number;
    };
    /**
     * - the volatile per-stream output cap.
     */
    maxOutputBytes: {
        get(): number;
    };
    /**
     * - the volatile spill-file cap.
     */
    maxSpillBytes: {
        get(): number;
    };
    /**
     * - the volatile kill-escalation grace.
     */
    graceMs: {
        get(): number;
    };
    /**
     * - whether execution prefers the resident agent.
     */
    agent: boolean;
};
/**
 * The upstream executor's spawn-spec builder, re-opened for this subclass —
 * see docs/UPSTREAM-SPAWN-SEAM.md. Type-level bridge only; the runtime class
 * is untouched.
 */
export type SpawnSeamExecutor = Omit<import("@deepseek-ai/dsh-bash-local").LocalBashExecutor, "spawnSpec"> & {
    spawnSpec: (spec: ShellExecSpec, argv: string[], stdoutMaxBytes: number, signal?: AbortSignal) => SubprocessSpawnSpec;
};
/**
 * The WSL filesystem provider's validated config — the keys of
 * {@link WslFileSystem.Config}, which the upstream `LocalFileSystem` config
 * type does not know. This provider has no volatile fields: every key is read
 * as its plain value.
 */
export type WslFileSystemConfig = {
    /**
     * - the pinned distro; empty resolves WSL's default.
     */
    distro: string;
    /**
     * - the base directory for relative input.
     */
    cwd: string;
    /**
     * - the `wsl.exe` path, for default-distro resolution.
     */
    wslPath: string;
    /**
     * - the overwrite-diff byte bound per
     * side; schema-defaulted when mounted through cordis, and defaulted again by
     * the substrate when absent.
     */
    diffBasisMaxBytes?: number | undefined;
    /**
     * - whether mutations are fenced by the policy.
     */
    sandbox: boolean;
    /**
     * - whether confined profiles mask `/mnt`.
     */
    maskWindowsDrive: boolean;
    /**
     * - whether paths leaving the distro are refused.
     */
    restrictToDistro: boolean;
    /**
     * - the in-distro watch scan depth bound.
     */
    watchMaxDepth: number;
    /**
     * - which I/O substrate serves the file tools;
     * schema-defaulted when mounted through cordis, absent on direct
     * construction (the router), which the constructor's refusal treats as
     * `"agent"`.
     */
    substrate?: string | undefined;
};
import { LocalBashExecutor } from "@deepseek-ai/dsh-bash-local";
import type { SandboxMode } from "@deepseek-ai/dsh-sandbox";
import { WslAgent } from "./agent.js";
import type { SubprocessSpawnSpec } from "@deepseek-ai/dsh-subprocess";
import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { AgentSubstrate } from "./fs-substrate.js";
import { FsError } from "@deepseek-ai/dsh-fs";
import type { FsTarget } from "@deepseek-ai/dsh-fs";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
import type { FsWriteIntent } from "@deepseek-ai/dsh-fs";
import type { FsWriteOutcome } from "@deepseek-ai/dsh-fs";
import type { FsEditRequest } from "@deepseek-ai/dsh-fs";
import type { FsVersion } from "@deepseek-ai/dsh-fs";
import type { FsEditOutcome } from "@deepseek-ai/dsh-fs";
