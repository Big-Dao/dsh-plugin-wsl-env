import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { LocalBashExecutor } from "@deepseek-ai/dsh-bash-local";
import { classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature, SandboxUnavailableError } from "@deepseek-ai/dsh-sandbox";
import { isAnotherDistrosUnc, isRelativeWorldPath, toLinuxPath } from "./paths.js";
import { pinnedDistro } from "./distro-route.js";
import { WslSandbox } from "./sandbox.js";
import { withBwrapHint } from "./sandbox-core.js";
import type { WslAgent } from "./agent.js";
import { AgentUnavailableError, SpawnError } from "./agent-errors.js";
import { agentExecutionHandle, type AgentExecutionHandle } from "./agent-exec.js";
import { sharedAgent } from "./agent-shared.js";
import { SessionRuntimes, probeSessionRuntime, sessionRuntimes, setSessionNativeAgent } from "./session-runtime.js";
import { configureAgentBackend, ensureNativeSessionAgent } from "./native-agent.js";
import { installMessagesLocale, t } from "./messages.js";
import type { AgentBackend } from "./native-agent.js";
import type { SessionRuntimeEntry } from "./session-runtime.js";
import { defaultDistro, defaultShell, runCapture, shellArgs, workdirFailure, wslErrorCode } from "./wsl.js";
import { validateWritableRootsConfig } from "./writable-roots.js";
import { configuredCwd, distroHome, effectiveMaskWindowsDrive, effectiveWritableRoots, resolveOperationDistro, sessionRuntimeWanted } from "./provider-common.js";
import type { Context } from "@deepseek-ai/cordis";
import type { ConfinedSandboxMode, SandboxExecutionPolicy, SandboxMode } from "@deepseek-ai/dsh-sandbox";
import type { SubprocessSpawnSpec } from "@deepseek-ai/dsh-subprocess";

/** The settled shape the agent handle's `result()` resolves with. */
type AgentSettledResult = Awaited<ReturnType<AgentExecutionHandle["result"]>>;

/**
 * Upstream shell vocabulary, derived through `@deepseek-ai/dsh-bash-local` —
 * this package does not depend on `@deepseek-ai/dsh-shell` directly, so the
 * execution types ride in through the executor's own signatures.
 */
export type ShellExecSpec = Parameters<LocalBashExecutor["execute"]>[0];
type ShellExecRequest = Parameters<LocalBashExecutor["resolve"]>[0];
export type ShellExecution = Awaited<ReturnType<LocalBashExecutor["execute"]>>;

/**
 * One confined command's distro-side profile, as the confinement returns it:
 * the wrapped argv, the enforcement completeness, the denial dialect, the
 * runner-failure rules and the Windows-drive masking fact.
 */
type ConfinedProfile = Awaited<ReturnType<InstanceType<typeof WslSandbox>["confine"]>>;

/**
 * The resolved spec this executor stamps with its home-marker fields: an empty
 * `workdir` plus the relative tail that {@link WslShellExecutor.withDefaultWorkdir}
 * joins against the distro home. The extra keys are this provider's own; the
 * seam's `ShellExecSpec` does not know them.
 */
type WslExecSpec = ShellExecSpec & { relativeWorkdir?: string };

/**
 * Every model shell call gets a rebuilt managed `DSH_*` namespace (see
 * `dsh-shell-env` / `ctx.shellEnv`). Those names exist only in the Windows-side
 * process, so unless they are listed in WSLENV they never reach the distro and
 * the model sees none of its environment facts.
 */
/**
 * Of the managed facts, these two carry Windows paths. WSL's `WSLENV` `/p` flag
 * translates them on the way in, so a command inside the distro gets a usable
 * `/mnt/c/...` path instead of `C:\...`. `DSH_WSL_HOME` is deliberately absent:
 * it is already a POSIX path, and translating it would corrupt it.
 */
const DSH_ENV_PREFIX = "DSH_";
const PATH_TRANSLATED = new Set([`${DSH_ENV_PREFIX}HOME`, `${DSH_ENV_PREFIX}PROFILE_DIR`]);

/** Env names that are meaningful on the Linux side and safe to forward. */
const SAFE_FORWARD = ["NO_COLOR", "TERM", "PAGER", "GIT_PAGER", "LANG", "LC_ALL"];

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
  cwd: { get(): string | undefined };
  /** The volatile Windows spawn directory. */
  hostCwd: { get(): string | undefined };
  /** Extra env names forwarded through WSLENV. */
  forwardEnv: string[];
  /** The volatile default timeout. */
  timeoutMs: { get(): number };
  /** The volatile timeout cap. */
  maxTimeoutMs: { get(): number };
  /** The volatile per-stream output cap. */
  maxOutputBytes: { get(): number };
  /** The volatile spill-file cap. */
  maxSpillBytes: { get(): number };
  /** The volatile kill-escalation grace. */
  graceMs: { get(): number };
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
  spawnSpec: (
    spec: ShellExecSpec,
    argv: string[],
    stdoutMaxBytes: number,
    signal?: AbortSignal,
  ) => SubprocessSpawnSpec;
};

const inheritedSpawnSpec = (LocalBashExecutor.prototype as unknown as SpawnSeamExecutor).spawnSpec;

/** The per-process confinement facts retained until settlement. */
interface ProcessFacts {
  /** The mode the process ran under. */
  mode: SandboxMode | undefined;
  /** The seam's enforcement completeness. */
  enforcement: "full" | "partial";
  /** The case-insensitive stderr substrings a denial produces. */
  denialSignatures: string[];
  /** Structured runner-failure evidence rules. */
  runnerFailureRules: Array<{ fatalSignatures: string[], allowedExitCodes?: number[], informationalLines?: string[] }>;
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
 * The refusal both shell resolvers share: the probes named no shell, and the
 * command must not quietly run under some other interpreter.
 * the probes named no shell, and the
 * command must not quietly run under some other interpreter. The wording is
 * the one `runInDistro` already throws with.
 *
 * @param distro - the distro whose shell could not be resolved.
 */
const unusableShell = (distro: string): Error =>
  new Error(
    `dsh-plugin-wsl: distro "${distro}" named no usable shell (passwd probe and $SHELL both failed). ` +
      `Check the user's login shell in /etc/passwd (\`getent passwd "$(id -u)"\` inside the distro), ` +
      `or point this row's \`shell\` at an existing absolute path.`,
  );

/**
 * Bash executor that runs every command inside a WSL distro.
 *
 * Extends the unconfined `LocalBashExecutor`, so command defaulting, deadline
 * handling, output caps, spill files and background-process management are the
 * shipped implementation's; this subclass replaces only the argv (prefix with
 * `wsl.exe`) and the process working directory (wsl.exe must be started from a
 * Windows directory, while the Linux directory rides on `--cd`).
 */
// @ts-expect-error — LocalBashExecutor.spawnSpec is private upstream; a wsl.exe spawn must start from a Windows directory (docs/UPSTREAM-SPAWN-SEAM.md)
export class WslShellExecutor
  extends LocalBashExecutor {
  static inject = ["subprocess", "sandboxPolicy"];

  static Config = z.object({
    /**
     * Distro mode: empty/`"auto"` follows the request workdir, `"default"`
     * forces WSL's default, and an explicit name pins every command.
     */
    distro: z.string().default(""),
    /** Path to `wsl.exe`; overridable for a non-standard install. */
    wslPath: z.string().default("wsl.exe"),
    /**
     * The shell commands run in. Empty means "resolve the login shell of the
     * distro's user" — hardcoding bash silently ignores a user whose passwd
     * entry points at zsh, fish, dash, or anything else, losing their PATH and
     * rc setup. Set an absolute path inside the distro to pin one.
     */
    shell: z.string().default(""),
    /**
     * Login-shell semantics (`<shell> -lc`) source the profile scripts, which is
     * what makes an interactive WSL setup's PATH (nvm, cargo, pyenv) visible.
     * Set false for a fast, fully deterministic `<shell> -c`. Applies only to the
     * POSIX family — see `shellArgs` for why other shells get a bare `-c`.
     */
    loginShell: z.boolean().default(true),
    /**
     * Confine every command inside the distro with `bwrap`, and report the
     * policy's mode through {@link sandboxMode}. Fails closed: a distro without
     * a usable `bwrap` produces `SANDBOX_UNAVAILABLE` rather than an unconfined
     * run. `false` restores the pre-sandbox behaviour exactly — commands run
     * unconfined and `sandboxMode` is `undefined`, so the model is told so.
     */
    sandbox: z.boolean().default(true),
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
    interopVisibility: z.union(["visible", "masked", "disabled"]),
    maskWindowsDrive: z.boolean().default(false),
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
    writableRoots: z.array(z.string()).default([]),
    /**
     * Default workdir for a request that names none; accepts `/home/andy/proj`,
     * a UNC path, or `C:\...`. Empty — the default — means the distro user's
     * home, resolved inside the distro.
     */
    cwd: z.string().volatile(),
    /** Windows directory the `wsl.exe` process itself starts in. */
    hostCwd: z.string().volatile(),
    /** Extra env names to forward into the distro through WSLENV. */
    forwardEnv: z.array(z.string()).default([]),
    timeoutMs: z.number().default(12e4).volatile(),
    maxTimeoutMs: z.number().default(6e5).volatile(),
    maxOutputBytes: z.number().default(64e3).volatile(),
    maxSpillBytes: z.number().default(64 * 1024 * 1024).volatile(),
    graceMs: z.number().default(3e3).volatile(),
    /**
     * Run commands through the resident agent when it is up (one long-lived
     * in-distro process; in-distro timeout semantics), falling back to the
     * one-shot `wsl.exe` path whenever the agent is out. `false` never uses
     * the agent. The confinement, the output budgets' shapes and the result
     * decoration are identical on both paths.
     */
    agent: z.boolean().default(true),
    agentBackend: z.union(["auto", "native", "shell"]).default("auto"),
    /**
     * Run this session's commands in one persistent systemd user scope (ADR
     * 0001): background processes survive the command that started them, `/tmp`
     * is the distro's real `/tmp` under workspace-write, and `ps` sees the
     * session. The executor holds the runtime until the session's scope
     * disposes, then stops it. Requires systemd, a reachable user manager and
     * `Linger`; the preflight refuses with the remedy when one is missing, and
     * only a success is cached. Off by default; requires `agent: true`.
     */
    sessionSandbox: z.union([z.boolean(), z.const("auto")]).default(false),
  });

  /** Cached default distro, resolved once from `wsl.exe -l -q`. */
  declare resolvedDistro: string;
  /** Cached distro-user login shell, resolved once. */
  declare resolvedShell: string;
  /** Per-distro login shells, for a workspace that is not the default distro. */
  declare resolvedShells: Map<string, string>;
  /** Cached distro-user home, the workdir when `cwd` is empty. */
  declare resolvedHome: string | undefined;
  /** Per-distro homes, so two concurrent distros cannot share one. */
  declare resolvedHomes: Map<string, string>;
  /** The default mode — the capability fact the tool layer reads. */
  declare mode: SandboxMode | undefined;
  /** The distro-side confinement, or nothing when the operator opted out. */
  declare sandbox: InstanceType<typeof WslSandbox> | undefined;
  /** The session-runtime registry; tests substitute it. */
  declare sessionRuntimes: SessionRuntimes;
  /** The runtimes this executor holds, by registry key. */
  declare sessionRuntimeEntries: Map<string, SessionRuntimeEntry>;
  /** Isolates calls that have no session identity. */
  declare sessionRuntimeOwner: string;
  /** The preflight's host runner; tests substitute it. */
  declare sessionScopeProbe: (argv: string[]) => Promise<string>;
  /** The one-time writable-root check's runner; tests substitute it. */
  declare writableRootsProbe: (argv: string[]) => Promise<string>;
  /** Distros whose session-runtime preflight has succeeded. */
  declare sessionRuntimePreflight: Set<string>;
  /** Per-distro `auto` verdicts, re-probed when they were negative and stale. */
  declare autoSessionScope: Map<string, { usable: boolean, checkedAt: number }>;
  /**
   * Per-process confinement facts retained until settlement. Overlapping calls
   * can carry different policies, so a shared latest-wrap value would classify
   * a process against the wrong facts. Unconfined processes have no entry.
   */
  declare processFacts: Map<ShellExecution, ProcessFacts>;

  /**
   * @param ctx - the composition context.
   * @param config - the validated plugin config.
   */
  constructor(ctx: Context, config: WslShellExecutorConfig) {
    super(ctx, config);
    validateWritableRootsConfig(config.writableRoots);
    configureAgentBackend(config.agentBackend ?? "auto");
    installMessagesLocale(ctx);
    this.resolvedDistro = pinnedDistro(config.distro) ?? "";
    this.resolvedShell = config.shell;
    this.resolvedShells = new Map();
    this.resolvedHome = undefined;
    this.resolvedHomes = new Map();
    this.mode = config.sandbox ? ctx.sandboxPolicy.defaultMode : undefined;
    this.sandbox = config.sandbox
      ? new WslSandbox({ wslPath: config.wslPath, maskWindowsDrive: effectiveMaskWindowsDrive(config) })
      : undefined;
    this.processFacts = new Map();
    this.sessionRuntimes = sessionRuntimes;
    this.sessionRuntimeEntries = new Map();
    this.sessionRuntimeOwner = randomUUID();
    this.sessionScopeProbe = (argv) => runCapture(argv);
    this.writableRootsProbe = (argv) => runCapture(argv);
    this.sessionRuntimePreflight = new Set();
    this.autoSessionScope = new Map();
    // The preset realm disposes when the session ends; the scope must go with
    // it, or a dev server outlives the session that started it.
    ctx.effect(() => () => this.disposeSessionRuntimes().catch(() => {}), "wsl session runtimes");
  }

  /**
   * The mode this executor confines with, or `undefined` when it does not
   * confine at all. `dsh-tool-bash` reads exactly this to decide whether to
   * advertise the escalation field, so it must disappear together with the
   * enforcement — never claim a boundary that is not applied.
   *
   * @returns the deployment default mode, or `undefined` when unconfined.
   */
  get sandboxMode(): SandboxMode | undefined {
    return this.mode;
  }

  /**
   * The distro used when no path supplies evidence: the pinned name, WSL's
   * default, or the default for the automatic modes.
   *
   * @returns the distro name.
   */
  async distro(): Promise<string> {
    const config = this.config as unknown as WslShellExecutorConfig;
    if (this.resolvedDistro.length === 0) this.resolvedDistro = await defaultDistro({ wslPath: config.wslPath });
    return this.resolvedDistro;
  }

  /**
   * The distro one command belongs to: an explicit pin wins; otherwise the
   * request workdir, then the configured `cwd`, may name a distro; both
   * absent falls back to WSL's default.
   *
   * @param workdir - the request's workdir, in any coordinate system.
   * @param cwd - the configured default workdir, when the caller has it.
   * @returns the distro name.
   */
  async distroFor(workdir?: string, cwd?: string): Promise<string> {
    const config = this.config as unknown as WslShellExecutorConfig;
    return resolveOperationDistro(config.distro, [workdir, cwd ?? configuredCwd(this.config)], () => this.distro());
  }

  /**
   * The shell name for the default/pinned distro, as the shell tool presents
   * it.
   *
   * @returns the basename of the shell; `shell` while the probe fails, and
   *   `bash` for an implausible basename.
   */
  async shellName(): Promise<string> {
    // Consumed by the shell tool after upstream change A: it names and describes
    // itself from the executor, so a zsh distro is never presented as bash. The
    // naming path must not crash on a failed probe — "shell" is the honest
    // neutral — while an implausible basename keeps the bash fallback below.
    const shell = await this.shell().catch(() => undefined);
    if (shell === undefined) return "shell";
    const base = String(shell ?? "").split("/").pop() ?? "";
    const name = base.replace(/\.exe$/i, "").replace(/^[-.]+/, "");
    return /^[a-z0-9_+-]+$/i.test(name) ? name : "bash";
  }

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
  async shellFor(distro: string): Promise<string> {
    const config = this.config as unknown as WslShellExecutorConfig;
    if (config.shell.length > 0) return config.shell;
    if (this.resolvedDistro.length > 0 && distro === this.resolvedDistro) return this.shell();
    const cached = this.resolvedShells.get(distro);
    if (cached !== undefined) return cached;
    const resolved = await defaultShell(distro, { wslPath: config.wslPath });
    if (resolved !== undefined) this.resolvedShells.set(distro, resolved);
    if (resolved === undefined) throw unusableShell(distro);
    return resolved;
  }

  /**
   * The shell for the default/pinned distro: the configured one, else the
   * login shell, resolved once and cached.
   *
   * @returns an absolute path to the shell inside the distro.
   * @throws {Error} when neither the config nor the distro names a usable
   *   shell — the failure is not cached, so the next call re-probes.
   */
  async shell(): Promise<string> {
    const config = this.config as unknown as WslShellExecutorConfig;
    if (this.resolvedShell.length === 0) {
      const distro = await this.distro();
      // An unresolvable shell fails the command loudly: the probes both came
      // back empty (a cold distro, a flaky first wsl.exe call, a musl distro
      // without getent), and running the command under some other interpreter
      // would hide that from the caller. The failure is not cached — a later
      // call re-probes and resolves the real shell once the distro is warm.
      const resolved = await defaultShell(distro, { wslPath: config.wslPath });
      if (resolved) this.resolvedShell = resolved;
      else throw unusableShell(distro);
    }
    return this.resolvedShell;
  }

  /**
   * Windows directory the `wsl.exe` process is started from.
   *
   * @returns the host directory to spawn in.
   */
  hostCwd(): string {
    const config = this.config as unknown as WslShellExecutorConfig;
    return config.hostCwd.get() ?? process.env.SystemRoot ?? process.cwd();
  }

  /**
   * The shared resident agent serving this executor's distro.
   *
   * @param distro - the resolved distro name.
   * @returns the shared agent.
   */
  executionAgent(distro: string): WslAgent {
    return sharedAgent(distro);
  }

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
  sessionRuntimeFor(
    policy: { mode: string, workspaceRoot: string, sessionId?: string } | undefined,
    resolved: WslExecSpec,
    distro: string,
    writableRoots: readonly string[] = [],
  ): SessionRuntimeEntry | undefined {
    const config = this.config as unknown as WslShellExecutorConfig;
    if (!config.sessionSandbox) return undefined;
    const mode = policy?.mode ?? "danger-full-access";
    const workspaceRoot = policy?.workspaceRoot ?? (configuredCwd(this.config) || resolved.workdir);
    const sessionId = policy?.sessionId || resolved.dshEnv?.DSH_SESSION_ID || this.sessionRuntimeOwner;
    const key = SessionRuntimes.key({ sessionId, distro, workspaceRoot, mode, maskWindowsDrive: effectiveMaskWindowsDrive(config), writableRoots });
    const held = this.sessionRuntimeEntries.get(key);
    if (held !== undefined) return held;
    const entry = this.sessionRuntimes.acquire({
      sessionId,
      distro,
      wslPath: config.wslPath,
      workspaceRoot,
      mode,
      maskWindowsDrive: effectiveMaskWindowsDrive(config),
      writableRoots,
    });
    this.sessionRuntimeEntries.set(key, entry);
    return entry;
  }

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
  async ensureSessionRuntimeUsable(distro: string): Promise<void> {
    if (this.sessionRuntimePreflight.has(distro)) return;
    const config = this.config as unknown as WslShellExecutorConfig;
    const problem = await probeSessionRuntime({ wslPath: config.wslPath, distro, run: this.sessionScopeProbe });
    if (problem !== null) throw new Error(problem);
    await ensureNativeSessionAgent({ wslPath: config.wslPath, distro, setNative: setSessionNativeAgent });
    this.sessionRuntimePreflight.add(distro);
  }

  /**
   * Whether this executor should use the session runtime for one distro, with
   * the `auto` downgrade and its bounded re-probe. `true` keeps the refusing
   * behavior; `false` stays off.
   *
   * @param distro - the resolved distro.
   * @returns whether to acquire the per-session scope.
   */
  async wantsSessionRuntime(distro: string): Promise<boolean> {
    const config = this.config as unknown as WslShellExecutorConfig;
    return sessionRuntimeWanted(config.sessionSandbox, distro, () => this.ensureSessionRuntimeUsable(distro), this.autoSessionScope);
  }

  /**
   * Release every runtime this executor holds, stopping each scope. Called
   * from the session's dispose hook; public so tests and shutdown paths can
   * await it.
   *
   * @returns resolved once every runtime is torn down.
   */
  async disposeSessionRuntimes(): Promise<void> {
    const entries = [...this.sessionRuntimeEntries.values()];
    this.sessionRuntimeEntries.clear();
    for (const entry of entries) await this.sessionRuntimes.release(entry.key);
  }

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
  distroArgv(spec: ShellExecSpec, shell: string): string[] {
    const config = this.config as unknown as WslShellExecutorConfig;
    return [shell, ...shellArgs(shell, config.loginShell), spec.command];
  }

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
  argv(spec: ShellExecSpec, distro: string, shell: string, inner?: string[]): string[] {
    const config = this.config as unknown as WslShellExecutorConfig;
    const distroArgs = distro.length > 0 ? ["-d", distro] : [];
    return [
      config.wslPath,
      ...distroArgs,
      "--cd",
      toLinuxPath(spec.workdir),
      // `--exec` is essential, not decoration. Without it wsl.exe hands the
      // command line to the distro's DEFAULT SHELL, which expands it once before
      // our own shell ever sees it: `x=1; echo "$x"` arrives as `x=1; echo ""`,
      // `$?` becomes the outer shell's status, and `$(...)`, `${...}`, `$1` and
      // backticks are eaten the same way. With `--exec` the argv is passed
      // straight through, so the command string reaches the shell verbatim.
      //
      // Note the shell is named explicitly here even though `--exec` plus the
      // distro's default shell would look equivalent: without `--exec` we get the
      // double parse above, so the shell has to be resolved by us instead.
      "--exec",
      ...(inner ?? this.distroArgv(spec, shell)),
    ];
  }

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
  spawnSpec(spec: ShellExecSpec, argv: string[], stdoutMaxBytes: number, signal?: AbortSignal): SubprocessSpawnSpec {
    const config = this.config as unknown as WslShellExecutorConfig;
    const base = inheritedSpawnSpec.call(this, spec, argv, stdoutMaxBytes, signal);
    const forward = new Set([...SAFE_FORWARD, ...config.forwardEnv]);
    const forwarded = Object.keys(base.env ?? {}).filter(
        (name) => forward.has(name) || name.startsWith(DSH_ENV_PREFIX),
      );
    return {
      ...base,
      cwd: this.hostCwd(),
      env: {
        ...base.env,
        // wsl.exe writes its own diagnostics as UTF-16LE unless this is set, and a
        // UTF-16 message read as UTF-8 is mojibake — including the `WSL_E_*` codes
        // that say why a command could not start. The distro-missing check below
        // reads those codes, so the encoding has to be pinned here.
        WSL_UTF8: "1",
        // WSL imports only the names listed in WSLENV. The managed DSH_* facts are
        // included by prefix so every contributed variable rides along. PATH is deliberately
        // never listed: putting it here would replace the distro's PATH with
        // the Windows one instead of appending the interop entries WSL adds
        // on its own.
        ...(forwarded.length > 0 ? { WSLENV: forwarded.map((name) => (PATH_TRANSLATED.has(name) ? `${name}/p` : name)).join(":") } : {}),
      },
    };
  }

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
  resolve(request: ShellExecRequest): WslExecSpec {
    const config = this.config as unknown as WslShellExecutorConfig;
    const spec = super.resolve(request);
    const sandboxPolicy = this.sandbox === undefined ? undefined : (request?.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve());
    const workdir = typeof request?.workdir === "string" ? request.workdir : undefined;
    const needsHome =
      configuredCwd(config).length === 0 && (workdir === undefined || isRelativeWorldPath(workdir));
    if (!needsHome && sandboxPolicy === undefined) return spec;
    return {
      ...spec,
      ...(needsHome ? { workdir: "", relativeWorkdir: workdir } : {}),
      ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    };
  }

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
  async withDefaultWorkdir(spec: WslExecSpec): Promise<WslExecSpec> {
    const tail = typeof spec?.relativeWorkdir === "string" ? spec.relativeWorkdir : undefined;
    if (String(spec?.workdir ?? "").trim().length > 0 && tail === undefined) return spec;
    const distro = await this.distroFor(spec.workdir, configuredCwd(this.config));
    const home = await distroHome(this, distro);
    if (tail === undefined || tail.length === 0) return { ...spec, workdir: home };
    return { ...spec, workdir: toLinuxPath(tail, { cwd: home }) };
  }

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
  static decorateResult<H extends { result(): Promise<unknown> }>(ex: H, map: (result: Awaited<ReturnType<H["result"]>>) => Awaited<ReturnType<H["result"]>>, mapError: (error: unknown) => Awaited<ReturnType<H["result"]>> | Promise<Awaited<ReturnType<H["result"]>>>): H {
    type R = Awaited<ReturnType<H["result"]>>;
    const handle = ex as { result: () => Promise<R> };
    const base = handle.result.bind(handle);
    let decorated: Promise<R> | undefined;
    handle.result = () => {
      decorated ??= base().then(map, mapError);
      return decorated;
    };
    return ex;
  }

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
  onProcessDone(proc: ShellExecution, stderr: string, providerRejected: boolean, providerError?: unknown): void {
    const facts = this.processFacts.get(proc);
    if (facts !== undefined) {
      this.processFacts.delete(proc);
      // A provider rejection exposes no public failure stage; attribute it to
      // the confinement runner only when the error independently names argv[0].
      const runnerFailed = providerRejected
        ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir)
        : classifyRunnerFailure(proc.exitCode, stderr, facts.runnerFailureRules) !== undefined;
      proc.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && matchesSignature(proc.exitCode, stderr, facts.denialSignatures),
        enforcement: facts.enforcement,
        ...(facts.windowsDrive ? { windowsDrive: facts.windowsDrive } : {}),
        sessionScope: facts.sessionScope,
        ...(runnerFailed ? { runnerFailed } : {}),
      } as typeof proc.sandbox;
    }
    super.onProcessDone(proc, stderr, providerRejected, providerError);
  }

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
  throwIfDistroUnavailable(result: { exitCode?: number | null, stdout?: { text?: string }, stderr?: { text?: string } } | undefined, distro: string): void {
    if (result?.exitCode === 0) return;
    const code = wslErrorCode(result?.stdout?.text, result?.stderr?.text);
    if (code === undefined) return;
    throw new Error(t("distroUnavailable", { code, distro }));
  }

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
  throwIfWorkdirMissing(result: { exitCode?: number | null, stdout?: { text?: string }, stderr?: { text?: string } } | undefined, workdir: string): void {
    const missing = workdirFailure(result?.stdout?.text, result?.stderr?.text);
    if (missing === undefined) return;
    throw new Error(t("workdirMissing", { missing }));
  }

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
  async writableRootsFor(distro: string, policy: SandboxExecutionPolicy | undefined, signal?: AbortSignal): Promise<string[]> {
    const config = this.config as unknown as WslShellExecutorConfig;
    if (!config.sandbox || policy === undefined || policy.mode !== "workspace-write") return [];
    if ((config.writableRoots?.length ?? 0) === 0 && (policy.additionalWritableRoots?.length ?? 0) === 0) return [];
    // Only a `~` entry needs the distro home. Policy entries are absolute
    // execution-world paths, and absolute row entries need no probe — which
    // keeps a policy-only grant (the composition tests' case) from spawning
    // `wsl.exe` on a machine that has none.
    const needsHome = (config.writableRoots ?? []).some((root) => root === "~" || root.startsWith("~/"));
    const home = needsHome ? await distroHome(this, distro) : "";
    return effectiveWritableRoots({
      configured: config.writableRoots,
      policy,
      distro,
      home,
      wslPath: config.wslPath,
      signal,
      run: this.writableRootsProbe,
    });
  }

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
  async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    const config = this.config as unknown as WslShellExecutorConfig;
    const resolved = await this.withDefaultWorkdir(spec);
    const distro = await this.distroFor(resolved.workdir, configuredCwd(config));
    const shell = await this.shellFor(distro);
    this.throwIfWorkdirInAnotherDistro(resolved.workdir, distro);
    const writableRoots = await this.writableRootsFor(distro, resolved.sandboxPolicy, resolved.signal);
    if (config.agent) {
      try {
        return await this.executeViaAgent(resolved, distro, shell, writableRoots);
      } catch (error) {
        // Only an out-of-service agent falls back; anything else (a cwd
        // refusal, a sandbox refusal) is the command's own verdict.
        if (!(error instanceof AgentUnavailableError)) throw error;
      }
    }
    return this.executeOneShot(resolved, distro, shell, writableRoots);
  }

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
  throwIfWorkdirInAnotherDistro(workdir: string, distro: string): void {
    if (!isAnotherDistrosUnc(workdir, distro)) return;
    throw new Error(t("workdirAnotherDistro", { workdir, distro }));
  }

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
  async executeViaAgent(resolved: WslExecSpec, distro: string, shell: string, writableRoots: readonly string[] = []): Promise<ShellExecution> {
    const config = this.config as unknown as WslShellExecutorConfig;
    const policy = resolved.sandboxPolicy;
    const confined = this.sandbox !== undefined && policy !== undefined && policy.mode !== "danger-full-access"
      ? await this.sandbox.confine(this.distroArgv(resolved, shell), { ...policy, mode: policy.mode }, { distro, signal: resolved.signal, writableRoots })
      : undefined;
    const mode = policy?.mode;
    const useScope = await this.wantsSessionRuntime(distro);
    const runtime = useScope ? this.sessionRuntimeFor(policy, resolved, distro, writableRoots) : undefined;
    const agent = runtime !== undefined ? runtime.agent : await this.executionAgent(distro);
    // A session runtime's own bwrap profile applies the mounts, so the
    // command must NOT be wrapped a second time: the per-command probe still
    // runs (it is the bwrap availability check and the denial facts), but its
    // argv is discarded.
    const argv = runtime !== undefined
      ? this.distroArgv(resolved, shell)
      : confined !== undefined ? confined.argv : this.distroArgv(resolved, shell);
    // The managed `DSH_*` snapshot merges last, exactly as the one-shot path's
    // spawn env does (`ShellExecSpec`: `dshEnv` wins over `env`). The agent
    // applies these to the individual command, so
    // the resident path now carries `DSH_HOME`, `DSH_SESSION_ID` and the
    // `DSH_WSL_*` facts too — without this the whole registry was invisible on
    // the default path while the one-shot fallback forwarded it.
    const env: Record<string, string> = { ...resolved.env, ...resolved.dshEnv };
    const execution = agentExecutionHandle({
      agent,
      // The one-shot path converts the spec's workdir into the distro's
      // coordinate system inside argv(); the agent carries the cwd as a frame
      // field, so the SAME conversion happens here — a raw UNC must never
      // reach `chdir` (that is the bug this line fixes).
      cwd: toLinuxPath(resolved.workdir),
      argv,
      env: Object.keys(env).length > 0 ? env : undefined,
      timeoutMs: resolved.timeoutMs,
      // The agent enforces the collect budget distro-side (the EXEC frame
      // carries it); `maxSpillBytes` stays one-shot-only — the agent path has
      // no spill files by design, its capture is bounded instead. The budget
      // is the executor's own per-stream cap, read through the volatile
      // wrapper like every other volatile field: handing the wrapper over raw
      // made `encodeExecFrame`'s `> 0` test false, so the frame carried 0 —
      // which the agent reads as "uncapped", and the documented cut never ran.
      maxOutputBytes: config.maxOutputBytes.get(),
      signal: resolved.signal,
      onStarted: confined !== undefined
        ? (proc) => {
            // The untyped guard cannot narrow the captured profile inside the
            // callback, so the confined shape is asserted once here.
            const profile = confined as ConfinedProfile;
            this.processFacts.set(proc as ShellExecution, {
              mode,
              enforcement: profile.enforcement,
              denialSignatures: profile.denialSignatures,
              runnerFailureRules: profile.runnerFailureRules,
              runnerProgram: profile.argv[0] ?? "",
              workdir: resolved.workdir,
              windowsDrive: profile.windowsDrive,
              sessionScope: useScope ? "session" : "per-command",
            });
          }
        : undefined,
    });
    const decorated = WslShellExecutor.decorateResult(execution, (result) => {
      this.throwIfDistroUnavailable(result, distro);
      this.throwIfWorkdirMissing(result, resolved.workdir);
      if (this.sandbox === undefined) return result;
      if (confined === undefined) {
        return ({ ...result, sandbox: { mode, denied: false, sessionScope: useScope ? "session" : "per-command" } }) as typeof result;
      }
      const { enforcement, denialSignatures, runnerFailureRules, windowsDrive } = confined;
      const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, runnerFailureRules);
      if (runnerFailure !== undefined) {
        // This path computes `mode` as `policy?.mode`, which the seam spells as
        // the wider union: a runner failure is only ever thrown under a
        // confinement, and there the mode is one of the two confined ones.
        throw new SandboxUnavailableError(mode as ConfinedSandboxMode, withBwrapHint(runnerFailure.detail, distro));
      }
      return ({
        ...result,
        sandbox: {
          mode,
          denied: matchesSignature(result.exitCode, result.stderr.text, denialSignatures),
          enforcement,
          windowsDrive,
          sessionScope: useScope ? "session" : "per-command",
        },
      }) as typeof result;
    }, (error) => {
      if (resolved.signal?.aborted === true) resolved.signal.throwIfAborted();
      // The native agent reports a missing workdir as a spawn failure without
      // naming it. Retry that command on the one-shot path, whose `--cd`
      // warning names the directory — the failure path pays the extra spawn,
      // the hot path does not.
      if (error instanceof SpawnError) {
        return this.executeOneShot(resolved, distro, shell, writableRoots).then((fallback) => fallback.result() as unknown as AgentSettledResult);
      }
      throw error;
    });
    // The agent handle IS the upstream execution shape at runtime; its typedef
    // spells `signal` as `string` and the captured streams without `spillPath`,
    // so the upstream-facing return rides one type-level cast.
    return decorated as unknown as ShellExecution;
  }

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
  async executeOneShot(resolved: WslExecSpec, distro: string, shell: string, writableRoots: readonly string[] = []): Promise<ShellExecution> {
    const policy = resolved.sandboxPolicy;
    if (this.sandbox === undefined || policy === undefined || policy.mode === "danger-full-access") {
      // `executeArgv` resolves to the execution handle, so it has to be awaited
      // before it can be decorated — the confined branch below does the same.
      // The sync thunk is the prepare form at runtime (`executeArgv` awaits any
      // function it is given); the type spells it as the async prepare it is
      // used as, which is why the thunk rides a type-level cast.
      const execution = await this.executeArgv(
        resolved,
        (() => this.argv(resolved, distro, shell)) as unknown as (signal: AbortSignal) => Promise<readonly string[]>,
      );
      return WslShellExecutor.decorateResult(
        execution,
        (result) => {
          this.throwIfDistroUnavailable(result, distro);
          this.throwIfWorkdirMissing(result, resolved.workdir);
          return result;
        },
        (error) => {
          throw error;
        },
      );
    }
    // The confined prepare closes over this slot: the argv builder assigns it,
    // the fact-stamper and the settlement mapping read it. `executeArgv` runs
    // the builder before either callback can fire, so the reads always see the
    // assigned profile (or the run never happened). The mode is captured once
    // here: the guard above narrowed it, and property narrowings do not reach
    // closures.
    const mode: ConfinedSandboxMode = policy.mode;
    const confinement: { profile: ConfinedProfile | undefined } = { profile: undefined };
    const execution = await this.executeArgv(
      resolved,
      (signal) => this.prepareConfinedArgv(resolved, distro, shell, policy, mode, confinement, writableRoots, signal),
      (process) => this.stampConfinedFacts(resolved, mode, confinement, process),
    );
    return WslShellExecutor.decorateResult(execution, (result) => {
      return this.settleConfinedOneShot(result, distro, resolved, mode, confinement.profile);
    }, (error) => {
      // An upstream abort remains cancellation even when it prevents spawn.
      if (resolved.signal?.aborted === true) resolved.signal.throwIfAborted();
      if (confinement.profile !== undefined && isRunnerSpawnFailure(error, confinement.profile.argv[0], resolved.workdir)) {
        throw new SandboxUnavailableError(mode, withBwrapHint(String(error), distro));
      }
      throw error;
    });
  }

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
  private async prepareConfinedArgv(resolved: WslExecSpec, distro: string, shell: string, policy: SandboxExecutionPolicy, mode: ConfinedSandboxMode, slot: { profile: ConfinedProfile | undefined }, writableRoots: readonly string[], signal: AbortSignal): Promise<readonly string[]> {
    // Preparation is async, so it runs under executeArgv's deadline and
    // cancellation handling rather than before them. A distro without a
    // usable runner throws here, before anything is spawned. The outer
    // guard narrowed the sandbox in, but narrowings do not reach closures —
    // so the confined sandbox is asserted here, type-level only.
    const profile = await (this.sandbox as InstanceType<typeof WslSandbox>).confine(this.distroArgv(resolved, shell), { ...policy, mode }, { distro, signal, writableRoots });
    slot.profile = profile;
    signal.throwIfAborted();
    return this.argv(resolved, distro, shell, profile.argv);
  }

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
  private stampConfinedFacts(resolved: WslExecSpec, mode: ConfinedSandboxMode, slot: { profile: ConfinedProfile | undefined }, process: ShellExecution | unknown): void {
    // The builder has run before any process callback can fire; the confined
    // shape is asserted once here, type-level only.
    const profile = slot.profile as ConfinedProfile;
    this.processFacts.set(process as ShellExecution, {
      mode,
      enforcement: profile.enforcement,
      denialSignatures: profile.denialSignatures,
      runnerFailureRules: profile.runnerFailureRules,
      runnerProgram: profile.argv[0] ?? "",
      workdir: resolved.workdir,
      windowsDrive: profile.windowsDrive,
      sessionScope: "per-command",
    });
  }

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
  private settleConfinedOneShot(result: Awaited<ReturnType<ShellExecution["result"]>>, distro: string, resolved: WslExecSpec, mode: ConfinedSandboxMode, confined: ConfinedProfile | undefined): Awaited<ReturnType<ShellExecution["result"]>> {
    this.throwIfDistroUnavailable(result, distro);
    this.throwIfWorkdirMissing(result, resolved.workdir);
    if (confined === undefined) {
      return ({ ...result, sandbox: { mode, denied: false, sessionScope: "per-command" } }) as typeof result;
    }
    const { enforcement, denialSignatures, runnerFailureRules, windowsDrive } = confined;
    // Runner failure outranks denial because the command did not run at all.
    const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, runnerFailureRules);
    if (runnerFailure !== undefined) throw new SandboxUnavailableError(mode, withBwrapHint(runnerFailure.detail, distro));
    return ({
      ...result,
      sandbox: {
        mode,
        denied: matchesSignature(result.exitCode, result.stderr.text, denialSignatures),
        enforcement,
        windowsDrive,
        sessionScope: "per-command",
      },
    }) as typeof result;
  }
}
