import z from "@deepseek-ai/schemastery";
import { LocalBashExecutor } from "@deepseek-ai/dsh-bash-local";
import { WslSandbox } from "./sandbox.js";
import type { WslAgent } from "./agent.js";
import { SessionRuntimes } from "./session-runtime.js";
import type { AgentBackend } from "./native-agent.js";
import type { SessionRuntimeEntry } from "./session-runtime.js";
import type { Context } from "@deepseek-ai/cordis";
import type { SandboxExecutionPolicy, SandboxMode } from "@deepseek-ai/dsh-sandbox";
import type { SubprocessSpawnSpec } from "@deepseek-ai/dsh-subprocess";
/**
 * Upstream shell vocabulary, derived through `@deepseek-ai/dsh-bash-local` —
 * this package does not depend on `@deepseek-ai/dsh-shell` directly, so the
 * execution types ride in through the executor's own signatures.
 */
export type ShellExecSpec = Parameters<LocalBashExecutor["execute"]>[0];
type ShellExecRequest = Parameters<LocalBashExecutor["resolve"]>[0];
export type ShellExecution = Awaited<ReturnType<LocalBashExecutor["execute"]>>;
/**
 * The resolved spec this executor stamps with its home-marker fields: an empty
 * `workdir` plus the relative tail that {@link WslShellExecutor.withDefaultWorkdir}
 * joins against the distro home. The extra keys are this provider's own; the
 * seam's `ShellExecSpec` does not know them.
 */
type WslExecSpec = ShellExecSpec & {
    relativeWorkdir?: string;
};
interface WslShellExecutorConfig {
    /** The pinned distro; empty means WSL's default. */
    distro: string;
    /** The `wsl.exe` path. */
    wslPath: string;
    /** The distro shell; empty resolves the login shell. */
    shell: string;
    /** Whether `<shell> -lc` semantics apply. */
    loginShell: boolean;
    /** Whether commands confine inside the distro. */
    sandbox: boolean;
    /** Whether confined profiles mask `/mnt`. */
    maskWindowsDrive: boolean;
    /** Extra distro directories granted read-write under `workspace-write`. */
    writableRoots: string[];
    /** The interop stance; set at all, it takes precedence over `maskWindowsDrive`. */
    interopVisibility?: "visible" | "masked" | "disabled";
    /** The volatile default workdir. */
    cwd: {
        get(): string | undefined;
    };
    /** The volatile Windows spawn directory. */
    hostCwd: {
        get(): string | undefined;
    };
    /** Extra env names forwarded through WSLENV. */
    forwardEnv: string[];
    /** The volatile default timeout. */
    timeoutMs: {
        get(): number;
    };
    /** The volatile timeout cap. */
    maxTimeoutMs: {
        get(): number;
    };
    /** The volatile per-stream output cap. */
    maxOutputBytes: {
        get(): number;
    };
    /** The volatile spill-file cap. */
    maxSpillBytes: {
        get(): number;
    };
    /** The volatile kill-escalation grace. */
    graceMs: {
        get(): number;
    };
    /** Whether execution prefers the resident agent. */
    agent: boolean;
    /** Session runtime: `true` requires it, `false` disables it, `"auto"` uses it when usable. */
    sessionSandbox: boolean | "auto";
    /** The session runtime's agent backend; `auto` when omitted. */
    agentBackend?: AgentBackend;
}
/**
 * The upstream executor's spawn-spec builder, re-opened for this subclass —
 * see docs/UPSTREAM-SPAWN-SEAM.md. Type-level bridge only; the runtime class
 * is untouched.
 */
export type SpawnSeamExecutor = Omit<LocalBashExecutor, "spawnSpec"> & {
    spawnSpec: (spec: ShellExecSpec, argv: string[], stdoutMaxBytes: number, signal?: AbortSignal) => SubprocessSpawnSpec;
};
/** The per-process confinement facts retained until settlement. */
interface ProcessFacts {
    /** The mode the process ran under. */
    mode: SandboxMode | undefined;
    /** The seam's enforcement completeness. */
    enforcement: "full" | "partial";
    /** The case-insensitive stderr substrings a denial produces. */
    denialSignatures: string[];
    /** Structured runner-failure evidence rules. */
    runnerFailureRules: Array<{
        fatalSignatures: string[];
        allowedExitCodes?: number[];
        informationalLines?: string[];
    }>;
    /** The confinement runner program (`argv[0]`), for spawn-failure attribution. */
    runnerProgram: string;
    /** The Linux workdir the process was given. */
    workdir: string;
    /** Whether the profile masks the Windows drive. */
    windowsDrive: "masked" | "visible";
    /** Which runtime the process used: the session scope or a per-command profile. */
    sessionScope: "session" | "per-command";
}
/**
 * Bash executor that runs every command inside a WSL distro.
 *
 * Extends the unconfined `LocalBashExecutor`, so command defaulting, deadline
 * handling, output caps, spill files and background-process management are the
 * shipped implementation's; this subclass replaces only the argv (prefix with
 * `wsl.exe`) and the process working directory (wsl.exe must be started from a
 * Windows directory, while the Linux directory rides on `--cd`).
 */
export declare class WslShellExecutor extends LocalBashExecutor {
    static inject: string[];
    static Config: z<Schemastery.ObjectS<NoInfer<{
        /**
         * Distro mode: empty/`"auto"` follows the request workdir, `"default"`
         * forces WSL's default, and an explicit name pins every command.
         */
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
        /**
         * The interop stance in one key (WSL-314), expanding to the per-key
         * values the measured matrix documents:
         *
         * - `visible` (default) — nothing masked; a confined command can read
         *   `/mnt` and launch Windows executables through interop, which escapes
         *   the Linux sandbox entirely.
         * - `masked` — `maskWindowsDrive: true`: `/mnt` is shadowed with an empty
         *   tmpfs; the drive's files and executables are unreachable (binfmt can
         *   still run a workspace-written .exe, so enforcement stays `partial`).
         * - `disabled` — `masked`, plus the distro-level closure: `[interop]
         *   enabled=false` in `/etc/wsl.conf` + `wsl --shutdown`, which the
         *   doctor's remedy prints as copy-paste (a config key does not write
         *   distro config; enforcement is the kernel's, not the schema's).
         *
         * When set at all it takes precedence over the legacy
         * `maskWindowsDrive` boolean below (unset — the default — lets that
         * boolean answer); the boolean remains for existing profiles.
         */
        interopVisibility: z<"masked" | "visible" | "disabled", "masked" | "visible" | "disabled", "plain">;
        maskWindowsDrive: z<boolean, boolean, "defined">;
        /**
         * Extra directories under `workspace-write`, in distro spelling. The
         * plugin grants them together with the workspace, so toolchain caches
         * (`~/.npm`, pnpm's store, `~/.cargo/registry`) and a linked worktree's
         * shared Git directory work without escalating the whole command to
         * `danger-full-access`. `~` and `~/...` expand against the distro user's
         * home; every entry must be an existing physical directory. Entries
         * already writable (inside the workspace, `/tmp`, `/dev/shm`) and entries
         * nested inside another grant are ignored. The same list belongs on
         * `wsl-fs` so writes and commands see the same mount table. Default empty:
         * the mode still grants only the workspace and the temp areas.
         */
        writableRoots: z<string[], string[], "defined">;
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
        agentBackend: z<"auto" | "native" | "shell", "auto" | "native" | "shell", "defined">;
        /**
         * Run this session's commands in one persistent systemd user scope (ADR
         * 0001): background processes survive the command that started them, `/tmp`
         * is the distro's real `/tmp` under workspace-write, and `ps` sees the
         * session. The executor holds the runtime until the session's scope
         * disposes, then stops it. Requires systemd, a reachable user manager and
         * `Linger`; the preflight refuses with the remedy when one is missing, and
         * only a success is cached. Off by default; requires `agent: true`.
         */
        sessionSandbox: z<boolean | "auto", boolean | "auto", "defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        /**
         * Distro mode: empty/`"auto"` follows the request workdir, `"default"`
         * forces WSL's default, and an explicit name pins every command.
         */
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
        /**
         * The interop stance in one key (WSL-314), expanding to the per-key
         * values the measured matrix documents:
         *
         * - `visible` (default) — nothing masked; a confined command can read
         *   `/mnt` and launch Windows executables through interop, which escapes
         *   the Linux sandbox entirely.
         * - `masked` — `maskWindowsDrive: true`: `/mnt` is shadowed with an empty
         *   tmpfs; the drive's files and executables are unreachable (binfmt can
         *   still run a workspace-written .exe, so enforcement stays `partial`).
         * - `disabled` — `masked`, plus the distro-level closure: `[interop]
         *   enabled=false` in `/etc/wsl.conf` + `wsl --shutdown`, which the
         *   doctor's remedy prints as copy-paste (a config key does not write
         *   distro config; enforcement is the kernel's, not the schema's).
         *
         * When set at all it takes precedence over the legacy
         * `maskWindowsDrive` boolean below (unset — the default — lets that
         * boolean answer); the boolean remains for existing profiles.
         */
        interopVisibility: z<"masked" | "visible" | "disabled", "masked" | "visible" | "disabled", "plain">;
        maskWindowsDrive: z<boolean, boolean, "defined">;
        /**
         * Extra directories under `workspace-write`, in distro spelling. The
         * plugin grants them together with the workspace, so toolchain caches
         * (`~/.npm`, pnpm's store, `~/.cargo/registry`) and a linked worktree's
         * shared Git directory work without escalating the whole command to
         * `danger-full-access`. `~` and `~/...` expand against the distro user's
         * home; every entry must be an existing physical directory. Entries
         * already writable (inside the workspace, `/tmp`, `/dev/shm`) and entries
         * nested inside another grant are ignored. The same list belongs on
         * `wsl-fs` so writes and commands see the same mount table. Default empty:
         * the mode still grants only the workspace and the temp areas.
         */
        writableRoots: z<string[], string[], "defined">;
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
        agentBackend: z<"auto" | "native" | "shell", "auto" | "native" | "shell", "defined">;
        /**
         * Run this session's commands in one persistent systemd user scope (ADR
         * 0001): background processes survive the command that started them, `/tmp`
         * is the distro's real `/tmp` under workspace-write, and `ps` sees the
         * session. The executor holds the runtime until the session's scope
         * disposes, then stops it. Requires systemd, a reachable user manager and
         * `Linger`; the preflight refuses with the remedy when one is missing, and
         * only a success is cached. Off by default; requires `agent: true`.
         */
        sessionSandbox: z<boolean | "auto", boolean | "auto", "defined">;
    }>>, "plain">;
    /** Cached default distro, resolved once from `wsl.exe -l -q`. */
    resolvedDistro: string;
    /** Cached distro-user login shell, resolved once. */
    resolvedShell: string;
    /** Per-distro login shells, for a workspace that is not the default distro. */
    resolvedShells: Map<string, string>;
    /** Cached distro-user home, the workdir when `cwd` is empty. */
    resolvedHome: string | undefined;
    /** Per-distro homes, so two concurrent distros cannot share one. */
    resolvedHomes: Map<string, string>;
    /** The default mode — the capability fact the tool layer reads. */
    mode: SandboxMode | undefined;
    /** The distro-side confinement, or nothing when the operator opted out. */
    sandbox: InstanceType<typeof WslSandbox> | undefined;
    /** The session-runtime registry; tests substitute it. */
    sessionRuntimes: SessionRuntimes;
    /** The runtimes this executor holds, by registry key. */
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
     * Per-process confinement facts retained until settlement. Overlapping calls
     * can carry different policies, so a shared latest-wrap value would classify
     * a process against the wrong facts. Unconfined processes have no entry.
     */
    processFacts: Map<ShellExecution, ProcessFacts>;
    /**
     * @param ctx - the composition context.
     * @param config - the validated plugin config.
     */
    constructor(ctx: Context, config: WslShellExecutorConfig);
    /**
     * The mode this executor confines with, or `undefined` when it does not
     * confine at all. `dsh-tool-bash` reads exactly this to decide whether to
     * advertise the escalation field, so it must disappear together with the
     * enforcement — never claim a boundary that is not applied.
     *
     * @returns the deployment default mode, or `undefined` when unconfined.
     */
    get sandboxMode(): SandboxMode | undefined;
    /**
     * The distro used when no path supplies evidence: the pinned name, WSL's
     * default, or the default for the automatic modes.
     *
     * @returns the distro name.
     */
    distro(): Promise<string>;
    /**
     * The distro one command belongs to: an explicit pin wins; otherwise the
     * request workdir, then the configured `cwd`, may name a distro; both
     * absent falls back to WSL's default.
     *
     * @param workdir - the request's workdir, in any coordinate system.
     * @param cwd - the configured default workdir, when the caller has it.
     * @returns the distro name.
     */
    distroFor(workdir?: string, cwd?: string): Promise<string>;
    /**
     * The shell name for the default/pinned distro, as the shell tool presents
     * it.
     *
     * @returns the basename of the shell; `shell` while the probe fails, and
     *   `bash` for an implausible basename.
     */
    shellName(): Promise<string>;
    /**
     * The shell for one distro: the configured shell, else that distro's login
     * shell. The default/pinned distro keeps the legacy {@link resolvedShell}
     * cache; every other distro gets an entry in {@link resolvedShells}.
     *
     * @param distro - the distro name.
     * @returns an absolute path to the shell inside the distro.
     * @throws {Error} when neither the config nor the distro names a usable
     *   shell — the failure is not cached, so the next call re-probes.
     */
    shellFor(distro: string): Promise<string>;
    /**
     * The shell for the default/pinned distro: the configured one, else the
     * login shell, resolved once and cached.
     *
     * @returns an absolute path to the shell inside the distro.
     * @throws {Error} when neither the config nor the distro names a usable
     *   shell — the failure is not cached, so the next call re-probes.
     */
    shell(): Promise<string>;
    /**
     * Windows directory the `wsl.exe` process is started from.
     *
     * @returns the host directory to spawn in.
     */
    hostCwd(): string;
    /**
     * The shared resident agent serving this executor's distro.
     *
     * @param distro - the resolved distro name.
     * @returns the shared agent.
     */
    executionAgent(distro: string): WslAgent;
    /**
     * The persistent session runtime for one policy, when `sessionSandbox` is
     * on. The executor holds one reference per `(session, distro, workspace, policy)` and
     * releases them when the session's scope disposes.
     *
     * @param policy - the resolved file-effect policy, when the executor has one.
     * @param resolved - the resolved spec, for the fallback workspace.
     * @param distro - the resolved distro name.
     * @returns the runtime entry, or undefined when the mode is off.
     */
    sessionRuntimeFor(policy: {
        mode: string;
        workspaceRoot: string;
        sessionId?: string;
    } | undefined, resolved: WslExecSpec, distro: string, writableRoots?: readonly string[]): SessionRuntimeEntry | undefined;
    /**
     * Run the session runtime's preflight once per executor. A failure is a
     * configuration verdict, not an agent outage: it is raised as an Error with
     * the remedy, so the command fails closed instead of falling back to the
     * per-command sandbox. Only success is cached, so a user who follows the
     * remedy (`loginctl enable-linger`, `[boot] systemd=true`) does not need to
     * restart the app.
     *
     * @param distro - the resolved distro name.
     * @returns resolved once the platform can host a session runtime.
     * @throws {Error} with the remedy when it cannot.
     */
    ensureSessionRuntimeUsable(distro: string): Promise<void>;
    /**
     * Whether this executor should use the session runtime for one distro, with
     * the `auto` downgrade and its bounded re-probe. `true` keeps the refusing
     * behavior; `false` stays off.
     *
     * @param distro - the resolved distro.
     * @returns whether to acquire the per-session scope.
     */
    wantsSessionRuntime(distro: string): Promise<boolean>;
    /**
     * Release every runtime this executor holds, stopping each scope. Called
     * from the session's dispose hook; public so tests and shutdown paths can
     * await it.
     *
     * @returns resolved once every runtime is torn down.
     */
    disposeSessionRuntimes(): Promise<void>;
    /**
     * The argv that runs INSIDE the distro for one spec: the resolved shell, its
     * login/command flags, and the command string. This is the argv a
     * distro-side sandbox wraps, which is why it is built separately from the
     * `wsl.exe` invocation around it.
     *
     * @param spec - the resolved spec from {@link LocalBashExecutor.resolve}.
     * @param shell - the resolved distro shell.
     * @returns the distro-side argv.
     */
    distroArgv(spec: ShellExecSpec, shell: string): string[];
    /**
     * Build the `wsl.exe` argv for one resolved spec. The command string is
     * passed as a single argv element to the resolved shell, so there is no
     * quoting layer of our own; Node's argv array reaches `wsl.exe` verbatim.
     *
     * `--exec` is load-bearing — see the comment inside.
     *
     * @param spec - the resolved spec from {@link LocalBashExecutor.resolve}.
     * @param distro - the resolved distro name.
     * @param shell - the resolved distro shell.
     * @param inner - the already-confined distro argv, when confinement applies.
     * @returns the argv to spawn.
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
     * @param spec - resolved execution settings.
     * @param argv - the argv from {@link WslShellExecutor.argv}.
     * @param stdoutMaxBytes - per-call stdout cap.
     * @param signal - the spawn cancellation signal.
     * @returns the subprocess spawn spec.
     */
    spawnSpec(spec: ShellExecSpec, argv: string[], stdoutMaxBytes: number, signal?: AbortSignal): SubprocessSpawnSpec;
    /**
     * Resolve a request into a spec, replacing the parent's `process.cwd()`
     * fallback with this provider's distro-home marker and stamping the per-call
     * sandbox policy.
     *
     * The seam requires this step to be synchronous — the tool layer calls
     * `ctx.shell.execute(ctx.shell.resolve(…))` with no `await` between them — so
     * neither the home nor a confinement decision can be made here. Two request
     * shapes default to the home when no `cwd` is configured: one that names no
     * `workdir` at all, and one that names it only RELATIVELY — the parent
     * resolves the first against `process.cwd()` (a Windows directory) and has
     * nothing of its own to join the second onto. Both are stamped as the empty
     * marker, with a relative tail carried verbatim in `relativeWorkdir`;
     * {@link withDefaultWorkdir} resolves the pair against the home. The policy
     * travels on the spec to {@link execute}, which awaits the wrap.
     *
     * @param request - the caller's request.
     * @returns the fully-resolved spec.
     */
    resolve(request: ShellExecRequest): WslExecSpec;
    /**
     * The spec to execute, with the home marker resolved against the distro
     * user's home: `workdir: ""` becomes the home itself, and a relative tail
     * carried by {@link WslShellExecutor.resolve} is joined under it. That is one
     * `sh -c 'printf %s "$HOME"'` per provider instance, cached, and it happens
     * only for a request that defaulted — an absolute workdir never reaches here.
     *
     * @param spec - the resolved spec.
     * @returns the spec to execute.
     */
    withDefaultWorkdir(spec: WslExecSpec): Promise<WslExecSpec>;
    /**
     * Decorate a handle's foreground projection in place, memoized once. The
     * handle keeps its identity — never wrapped in a second object — because the
     * per-process facts and `onProcessDone` key on the exact instance.
     *
     * @template H - the concrete handle type, preserved so the decorated handle
     *   keeps its identity in the callers' types; the settled result row the maps
     *   are spelled in is derived from its `result()`.
     * @param ex - the execution handle to decorate.
     * @param map - maps the settled result.
     * @param mapError - maps a rejection, when the caller has one.
     * @returns the same handle.
     */
    static decorateResult<H extends {
        result(): Promise<unknown>;
    }>(ex: H, map: (result: Awaited<ReturnType<H["result"]>>) => Awaited<ReturnType<H["result"]>>, mapError: (error: unknown) => Awaited<ReturnType<H["result"]>> | Promise<Awaited<ReturnType<H["result"]>>>): H;
    /**
     * Stamp the per-process sandbox facts before `done` settles, so a background
     * process reports the same mode, denial and enforcement a foreground run
     * would. Signal deaths are not denials.
     *
     * @param proc - the settled process handle.
     * @param stderr - the process's retained stderr tail used by subclasses for settlement classification.
     * @param providerRejected - whether the subprocess promise rejected without a direct outcome.
     * @param providerError - the provider rejection reason, which may itself be undefined.
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
     * @param result - the settled shell result.
     * @param distro - the distro the command asked for.
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
     * @param result - the settled shell result.
     * @param workdir - the Linux directory the request asked for.
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
     * The effective extra writable roots for one command: the row's
     * `writableRoots` plus the shared policy's `additionalWritableRoots`,
     * resolved to Linux paths and checked once per process. Empty unless the
     * command is confined under `workspace-write`.
     *
     * @param distro - the distro the command runs in.
     * @param policy - the per-call file-effect policy, when there is one.
     * @param signal - optional cancellation for the one-time check.
     * @returns the roots every confinement site binds.
     * @throws {SandboxInvalidRootError} when an entry cannot be granted or checked.
     */
    writableRootsFor(distro: string, policy: SandboxExecutionPolicy | undefined, signal?: AbortSignal): Promise<string[]>;
    /**
     * Execute one resolved spec inside the distro, confined by the per-call policy
     * when there is one.
     *
     * Confinement wraps the DISTRO-side argv (`<shell> -lc <command>`) in `bwrap`
     * and hands the result to `wsl.exe --exec`, so the sandbox is built inside the
     * distro while the process that spawns it stays the ordinary Windows one. The
     * `danger-full-access` escalation — and an operator's `sandbox: false` — skip
     * the wrap entirely and run the command as before.
     *
     * @param spec - resolved execution settings.
     * @returns the live shell process handle.
     */
    execute(spec: ShellExecSpec): Promise<ShellExecution>;
    /**
     * Refuse a workdir that names another WSL distro — the shell-side twin of
     * the filesystem's `FS_OUTSIDE_DISTRO` fence. Left unguarded, `toLinuxPath`
     * strips the UNC's distro name and the command runs inside THIS distro
     * against whatever tree happens to share the path, silently, while the fs
     * side refuses the same workspace outright. The wording mirrors the fs
     * refusal (minus `restrictToDistro`, which is an fs-only key).
     *
     * @param workdir - the resolved workdir (UNC, Linux path, or Windows path).
     * @param distro - the pinned distro name.
     * @throws {Error} naming both distros and both ways out.
     */
    throwIfWorkdirInAnotherDistro(workdir: string, distro: string): void;
    /**
     * The agent-backed execution path: one long-lived in-distro process, the
     * confinement argv unchanged, the handle shape unchanged. Any
     * {@link AgentUnavailableError} propagates for the caller's fallback.
     *
     * @param resolved - the resolved spec from {@link WslShellExecutor.execute}.
     * @param distro - the resolved distro name.
     * @param shell - the resolved distro shell.
     * @returns the decorated execution result.
     */
    executeViaAgent(resolved: WslExecSpec, distro: string, shell: string, writableRoots?: readonly string[]): Promise<ShellExecution>;
    /**
     * The pre-agent execution path, verbatim: one `wsl.exe` per command through
     * the inherited `executeArgv` machinery. Kept as the permanent fallback for
     * an out-of-service agent and as the `agent: false` behaviour.
     *
     * @param resolved - the resolved spec.
     * @param distro - the resolved distro name.
     * @param shell - the resolved distro shell.
     * @returns the decorated execution result.
     */
    executeOneShot(resolved: WslExecSpec, distro: string, shell: string, writableRoots?: readonly string[]): Promise<ShellExecution>;
    /**
     * The confined one-shot's argv prepare: confine the distro argv under the
     * policy, keep the resulting profile for the fact-stamper and the settlement
     * mapping, and hand back the wrapped host argv.
     *
     * @param resolved - the resolved spec.
     * @param distro - the resolved distro name.
     * @param shell - the resolved distro shell.
     * @param policy - the confined policy (narrowed in by `executeOneShot`).
     * @param slot - the closure the builder assigns the profile into.
     * @param writableRoots - the effective extra roots the profile binds.
     * @param signal - the caller's cancellation.
     */
    private prepareConfinedArgv;
    /**
     * Stamp the per-process sandbox facts before `done` settles, so a background
     * process reports the same mode, denial and enforcement a foreground run
     * would.
     *
     * @param resolved - the resolved spec.
     * @param mode - the confined policy's mode.
     * @param slot - the closure holding the assigned profile.
     * @param process - the spawned handle.
     */
    private stampConfinedFacts;
    /**
     * Settle one confined one-shot result: the distro and workdir verdicts, the
     * never-armed honesty stamp, the runner-failure throw, and the denial facts.
     *
     * @param result - the settled process result.
     * @param distro - the resolved distro name.
     * @param resolved - the resolved spec.
     * @param mode - the confined policy's mode.
     * @param confined - the profile the argv prepare armed, when it ran.
     */
    private settleConfinedOneShot;
}
export {};
