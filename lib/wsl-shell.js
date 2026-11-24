import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { LocalBashExecutor } from "@deepseek-ai/dsh-bash-local";
import { classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature, SandboxUnavailableError } from "@deepseek-ai/dsh-sandbox";
import { isAnotherDistrosUnc, isRelativeWorldPath, toLinuxPath } from "./paths.js";
import { pinnedDistro } from "./distro-route.js";
import { WslSandbox } from "./sandbox.js";
import { withBwrapHint } from "./sandbox-core.js";
import { AgentRequestStateUnknownError, AgentUnavailableError, SpawnError } from "./agent-errors.js";
import { agentExecutionHandle } from "./agent-exec.js";
import { sharedAgent } from "./agent-shared.js";
import { SessionRuntimes, probeSessionRuntime, sessionRuntimes, setSessionNativeAgent } from "./session-runtime.js";
import { configureAgentBackend, ensureNativeSessionAgent } from "./native-agent.js";
import { installMessagesLocale, t } from "./messages.js";
import { defaultDistro, defaultShell, runCapture, shellArgs, workdirFailure, wslErrorCode } from "./wsl.js";
import { validateWritableRootsConfig } from "./writable-roots.js";
import { SocketIsolationError, socketMasksFor as resolveSocketMasks } from "./socket-isolation.js";
import { ProviderRuntimeBook, SessionEndWatch, configuredCwd, distroHome, effectiveMaskWindowsDrive, effectiveWritableRoots, resolveOperationDistro, sessionRuntimeWanted } from "./provider-common.js";
/**
 * Whether one rejection is the executor's cue to run the command again on the
 * one-shot `wsl.exe` path: the resident is out AND the command provably never
 * reached a distro process through it. A request that was with the resident
 * when it was lost may have run — {@link AgentRequestStateUnknownError} — and
 * re-running it there would run non-idempotent work twice, or report a create
 * that succeeded as a refusal, so it is not a cue.
 *
 * @param error - the rejection the agent path settled with.
 * @returns true when the command may be retried one-shot.
 */
function isFallbackCue(error) {
    return error instanceof AgentUnavailableError && !(error instanceof AgentRequestStateUnknownError);
}
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
const inheritedSpawnSpec = LocalBashExecutor.prototype.spawnSpec;
/**
 * The refusal both shell resolvers share: the probes named no shell, and the
 * command must not quietly run under some other interpreter. The wording is
 * the one `runInDistro` already throws with.
 *
 * @param distro - the distro whose shell could not be resolved.
 */
const unusableShell = (distro) => new Error(`dsh-plugin-wsl: distro "${distro}" named no usable shell (passwd probe and $SHELL both failed). ` +
    `Check the user's login shell in /etc/passwd (\`getent passwd "$(id -u)"\` inside the distro), ` +
    `or point this row's \`shell\` at an existing absolute path.`);
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
export class WslShellExecutor extends LocalBashExecutor {
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
         * `wsl.conf`. The mask covers the COMMAND path only; the file tools'
         * read side still reaches `/mnt` through the shared read agent.
         */
        maskWindowsDrive: z.boolean().default(false),
        /**
         * The socket surfaces a confined COMMAND cannot reach. The sandbox's mount
         * profile confines file effects, not process authority: a command can
         * otherwise ask the user's systemd manager to start a unit outside the
         * fence, or connect to a container daemon and start work outside it.
         *
         * - `off` (default) — nothing masked; the boundary is the documented
         *   `enforcement: partial`.
         * - `session-bus` — masks `$XDG_RUNTIME_DIR/bus` and
         *   `$XDG_RUNTIME_DIR/systemd/private`, so `systemd-run --user` and
         *   `systemctl --user` fail inside the command.
         * - `strict` — adds `/run/dbus/system_bus_socket` and the container
         *   sockets (`docker`, `podman`, `containerd`, `crio`) that exist and are
         *   reachable by the distro user; D-Bus and container clients inside the
         *   command fail.
         *
         * The masks are a narrowing, not a closure: same-user `/proc`, the
         * interop transport and other IPC remain, and `enforcement` stays
         * `partial`. The key applies to the command plane (`wsl-shell`); the
         * filesystem rows' confined agent runs only this plugin's fs protocol,
         * never model-authored commands. Verified by `pnpm run probe:sandbox`.
         */
        socketIsolation: z.union(["off", "session-bus", "strict"]).default("off"),
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
         * one-shot `wsl.exe` path whenever the agent is out and the command had
         * not reached it. A command that was in flight when the resident died is
         * not run again — its state is unknown — and fails saying so. `false`
         * never uses the agent. The confinement, the output budgets' shapes and
         * the result decoration are identical on both paths.
         */
        agent: z.boolean().default(true),
        agentBackend: z.union(["auto", "native", "shell"]).default("auto"),
        /**
         * Run this session's commands in one persistent systemd user scope (ADR
         * 0001): background processes survive the command that started them, `/tmp`
         * is the distro's real `/tmp` under workspace-write, and `ps` sees the
         * session. The executor holds the runtime until the session's agent is
         * disposed, then stops it. Requires systemd, a reachable user manager and
         * `Linger`; the preflight refuses with the remedy when one is missing, and
         * only a success is cached. Off by default; requires `agent: true`.
         */
        sessionSandbox: z.union([z.boolean(), z.const("auto")]).default(false),
    });
    /**
     * Per-distro homes, delegated to the shared runtime book: `provider-common`'s
     * `distroHome` reads this view, and tests pin the cache through it.
     */
    get resolvedHomes() {
        return this.runtimeBook.homes;
    }
    /**
     * The row's config without the peer's volatile wrapper. The schema validates
     * the plain shape; the wrapper only widens the type, so one accessor states
     * the cast instead of every method repeating it.
     */
    get wslConfig() {
        return this.config;
    }
    /**
     * @param ctx - the composition context.
     * @param config - the validated plugin config.
     */
    constructor(ctx, config) {
        super(ctx, config);
        validateWritableRootsConfig(config.writableRoots);
        configureAgentBackend(config.agentBackend ?? "auto");
        installMessagesLocale(ctx);
        this.resolvedDistro = pinnedDistro(config.distro) ?? "";
        this.resolvedShell = config.shell;
        this.resolvedShells = new Map();
        this.resolvedHome = undefined;
        this.runtimeBook = new ProviderRuntimeBook();
        this.mode = config.sandbox ? ctx.sandboxPolicy.defaultMode : undefined;
        this.sandbox = config.sandbox
            ? new WslSandbox({ wslPath: config.wslPath, maskWindowsDrive: effectiveMaskWindowsDrive(config) })
            : undefined;
        this.processFacts = new Map();
        this.sessionRuntimes = sessionRuntimes;
        this.sessionRuntimeOwner = randomUUID();
        this.sessionScopeProbe = (argv) => runCapture(argv);
        this.writableRootsProbe = (argv) => runCapture(argv);
        this.socketIsolationProbe = (argv) => runCapture(argv);
        // The preset realm this row lives in is the PROCESS's, not the session's:
        // upstream disposes it only when the preset definition is unregistered, so
        // this disposer is the process-level backstop. The session's end is the
        // harness's own `agent/disposed`, which the watch wires to a release.
        this.sessionEndWatch = new SessionEndWatch(this, ctx);
        ctx.effect(() => () => this.disposeSessionRuntimes().catch(() => { }), "wsl session runtimes");
    }
    /**
     * The mode this executor confines with, or `undefined` when it does not
     * confine at all. `dsh-tool-bash` reads exactly this to decide whether to
     * advertise the escalation field, so it must disappear together with the
     * enforcement — never claim a boundary that is not applied.
     *
     * @returns the deployment default mode, or `undefined` when unconfined.
     */
    get sandboxMode() {
        return this.mode;
    }
    /**
     * The distro used when no path supplies evidence: the pinned name, WSL's
     * default, or the default for the automatic modes.
     *
     * @returns the distro name.
     */
    async distro() {
        const config = this.wslConfig;
        if (this.resolvedDistro.length === 0)
            this.resolvedDistro = await defaultDistro({ wslPath: config.wslPath });
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
    async distroFor(workdir, cwd) {
        const config = this.wslConfig;
        return resolveOperationDistro(config.distro, [workdir, cwd ?? configuredCwd(this.config)], () => this.distro());
    }
    /**
     * The shell name for the default/pinned distro, as the shell tool presents
     * it.
     *
     * @returns the basename of the shell; `shell` while the probe fails, and
     *   `bash` for an implausible basename.
     */
    async shellName() {
        // Consumed by the shell tool after upstream change A: it names and describes
        // itself from the executor, so a zsh distro is never presented as bash. The
        // naming path must not crash on a failed probe — "shell" is the honest
        // neutral — while an implausible basename keeps the bash fallback below.
        const shell = await this.shell().catch(() => undefined);
        if (shell === undefined)
            return "shell";
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
    async shellFor(distro) {
        const config = this.wslConfig;
        if (config.shell.length > 0)
            return config.shell;
        if (this.resolvedDistro.length > 0 && distro === this.resolvedDistro)
            return this.shell();
        const cached = this.resolvedShells.get(distro);
        if (cached !== undefined)
            return cached;
        const resolved = await defaultShell(distro, { wslPath: config.wslPath });
        if (resolved !== undefined)
            this.resolvedShells.set(distro, resolved);
        if (resolved === undefined)
            throw unusableShell(distro);
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
    async shell() {
        const config = this.wslConfig;
        if (this.resolvedShell.length === 0) {
            const distro = await this.distro();
            // An unresolvable shell fails the command loudly: the probes both came
            // back empty (a cold distro, a flaky first wsl.exe call, a musl distro
            // without getent), and running the command under some other interpreter
            // would hide that from the caller. The failure is not cached — a later
            // call re-probes and resolves the real shell once the distro is warm.
            const resolved = await defaultShell(distro, { wslPath: config.wslPath });
            if (resolved)
                this.resolvedShell = resolved;
            else
                throw unusableShell(distro);
        }
        return this.resolvedShell;
    }
    /**
     * Windows directory the `wsl.exe` process is started from.
     *
     * @returns the host directory to spawn in.
     */
    hostCwd() {
        const config = this.wslConfig;
        return config.hostCwd.get() ?? process.env.SystemRoot ?? process.cwd();
    }
    /**
     * The shared resident agent serving this executor's distro.
     *
     * @param distro - the resolved distro name.
     * @returns the shared agent.
     */
    executionAgent(distro) {
        return sharedAgent(distro);
    }
    /**
     * The persistent session runtime for one policy, when `sessionSandbox` is
     * on. The executor holds one reference per `(session, distro, workspace, policy)`;
     * the session's end (`agent/disposed`, through {@link sessionEndWatch})
     * releases them.
     *
     * @param policy - the resolved file-effect policy, when the executor has one.
     * @param resolved - the resolved spec, for the fallback workspace.
     * @param distro - the resolved distro name.
     * @returns the runtime entry, or undefined when the mode is off.
     */
    sessionRuntimeFor(policy, resolved, distro, writableRoots = [], socketMasks = [], maskInterop = false) {
        const config = this.wslConfig;
        if (!config.sessionSandbox)
            return undefined;
        const mode = policy?.mode ?? "danger-full-access";
        const workspaceRoot = policy?.workspaceRoot ?? (configuredCwd(this.config) || resolved.workdir);
        const sessionId = policy?.sessionId || resolved.dshEnv?.DSH_SESSION_ID || this.sessionRuntimeOwner;
        const key = SessionRuntimes.key({ sessionId, distro, workspaceRoot, mode, maskWindowsDrive: effectiveMaskWindowsDrive(config), writableRoots, socketMasks, maskInterop });
        const held = this.runtimeBook.sessionRuntimeEntries.get(key);
        if (held !== undefined) {
            // A session end tears its runtimes down through every holder. One that
            // reached this runtime without this executor must not leave it handing
            // out a closed agent: the stale reference goes, and a resumed session
            // gets a fresh runtime below.
            if (this.sessionRuntimes.holds(held))
                return held;
            this.runtimeBook.sessionRuntimeEntries.delete(key);
        }
        const entry = this.sessionRuntimes.acquire({
            sessionId,
            distro,
            wslPath: config.wslPath,
            workspaceRoot,
            mode,
            maskWindowsDrive: effectiveMaskWindowsDrive(config),
            writableRoots,
            socketMasks,
            maskInterop,
        });
        this.runtimeBook.sessionRuntimeEntries.set(key, entry);
        this.sessionEndWatch.ensureSweep();
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
    async ensureSessionRuntimeUsable(distro) {
        if (this.runtimeBook.sessionRuntimePreflight.has(distro))
            return;
        const config = this.wslConfig;
        const problem = await probeSessionRuntime({ wslPath: config.wslPath, distro, run: this.sessionScopeProbe });
        if (problem !== null)
            throw new Error(problem);
        await ensureNativeSessionAgent({ wslPath: config.wslPath, distro, setNative: setSessionNativeAgent });
        this.runtimeBook.sessionRuntimePreflight.add(distro);
    }
    /**
     * Whether this executor should use the session runtime for one distro, with
     * the `auto` downgrade and its bounded re-probe. `true` keeps the refusing
     * behavior; `false` stays off.
     *
     * @param distro - the resolved distro.
     * @returns whether to acquire the per-session scope.
     */
    async wantsSessionRuntime(distro) {
        const config = this.wslConfig;
        return sessionRuntimeWanted(config.sessionSandbox, distro, () => this.ensureSessionRuntimeUsable(distro), this.runtimeBook.autoSessionScope);
    }
    /**
     * Release every runtime this executor holds, stopping each scope. Called
     * when the row goes away (the preset is unregistered, the app shuts down) —
     * the sessions ended long before, each through {@link sessionEndWatch};
     * public so tests and shutdown paths can await it.
     *
     * @returns resolved once every runtime is torn down.
     */
    async disposeSessionRuntimes() {
        this.sessionEndWatch.dispose();
        const entries = [...this.runtimeBook.sessionRuntimeEntries.values()];
        this.runtimeBook.sessionRuntimeEntries.clear();
        for (const entry of entries)
            await this.sessionRuntimes.release(entry.key);
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
    distroArgv(spec, shell) {
        const config = this.wslConfig;
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
    argv(spec, distro, shell, inner) {
        const config = this.wslConfig;
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
    spawnSpec(spec, argv, stdoutMaxBytes, signal) {
        const config = this.wslConfig;
        const base = inheritedSpawnSpec.call(this, spec, argv, stdoutMaxBytes, signal);
        const forward = new Set([...SAFE_FORWARD, ...config.forwardEnv]);
        const forwarded = Object.keys(base.env ?? {}).filter((name) => forward.has(name) || name.startsWith(DSH_ENV_PREFIX));
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
    resolve(request) {
        const config = this.wslConfig;
        const spec = super.resolve(request);
        const sandboxPolicy = this.sandbox === undefined ? undefined : (request?.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve());
        const workdir = typeof request?.workdir === "string" ? request.workdir : undefined;
        const needsHome = configuredCwd(config).length === 0 && (workdir === undefined || isRelativeWorldPath(workdir));
        if (!needsHome && sandboxPolicy === undefined)
            return spec;
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
    async withDefaultWorkdir(spec) {
        const tail = typeof spec?.relativeWorkdir === "string" ? spec.relativeWorkdir : undefined;
        if (String(spec?.workdir ?? "").trim().length > 0 && tail === undefined)
            return spec;
        const distro = await this.distroFor(spec.workdir, configuredCwd(this.config));
        const home = await distroHome(this, distro);
        if (tail === undefined || tail.length === 0)
            return { ...spec, workdir: home };
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
    static decorateResult(ex, map, mapError) {
        const handle = ex;
        const base = handle.result.bind(handle);
        let decorated;
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
    onProcessDone(proc, stderr, providerRejected, providerError) {
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
            };
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
    throwIfDistroUnavailable(result, distro) {
        if (result?.exitCode === 0)
            return;
        const code = wslErrorCode(result?.stdout?.text, result?.stderr?.text);
        if (code === undefined)
            return;
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
    throwIfWorkdirMissing(result, workdir) {
        const missing = workdirFailure(result?.stdout?.text, result?.stderr?.text);
        if (missing === undefined)
            return;
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
    async writableRootsFor(distro, policy, signal) {
        const config = this.wslConfig;
        if (!config.sandbox || policy === undefined || policy.mode !== "workspace-write")
            return [];
        if ((config.writableRoots?.length ?? 0) === 0 && (policy.additionalWritableRoots?.length ?? 0) === 0)
            return [];
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
     * The socket masks one confined command's profile binds, resolved once per
     * distro from the row's `socketIsolation` stance. Empty when the sandbox is
     * off, the command is unconfined, or the stance is `off`. A probe failure is
     * a sandbox refusal, never an unmasked run.
     *
     * @param distro - the distro the command runs in.
     * @param mode - the per-call file-effect mode.
     * @param signal - optional cancellation for the one-time probe.
     * @returns the existing socket paths to mask.
     * @throws {SandboxUnavailableError} when a configured isolation cannot be resolved.
     */
    async socketMasksFor(distro, mode, signal) {
        const config = this.wslConfig;
        if (!config.sandbox || mode === undefined || mode === "danger-full-access" || config.socketIsolation === "off")
            return [];
        try {
            return await resolveSocketMasks({
                mode: config.socketIsolation,
                wslPath: config.wslPath,
                distro,
                run: this.socketIsolationProbe,
                ...(signal === undefined ? {} : { signal }),
            });
        }
        catch (error) {
            if (error instanceof SocketIsolationError)
                throw new SandboxUnavailableError(mode, error.message);
            throw error;
        }
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
    async execute(spec) {
        const config = this.wslConfig;
        const resolved = await this.withDefaultWorkdir(spec);
        const distro = await this.distroFor(resolved.workdir, configuredCwd(config));
        const shell = await this.shellFor(distro);
        this.throwIfWorkdirInAnotherDistro(resolved.workdir, distro);
        const writableRoots = await this.writableRootsFor(distro, resolved.sandboxPolicy, resolved.signal);
        const socketMasks = await this.socketMasksFor(distro, resolved.sandboxPolicy?.mode, resolved.signal);
        const maskInterop = config.sandbox
            && config.socketIsolation === "strict"
            && resolved.sandboxPolicy !== undefined
            && resolved.sandboxPolicy.mode !== "danger-full-access";
        if (config.agent) {
            try {
                return await this.executeViaAgent(resolved, distro, shell, writableRoots, socketMasks, maskInterop);
            }
            catch (error) {
                // Only an out-of-service agent that never took the command falls
                // back; anything else (a cwd refusal, a sandbox refusal, a command
                // whose state is unknown) is the command's own verdict.
                if (!isFallbackCue(error))
                    throw error;
            }
        }
        return this.executeOneShot(resolved, distro, shell, writableRoots, socketMasks, maskInterop);
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
    throwIfWorkdirInAnotherDistro(workdir, distro) {
        if (!isAnotherDistrosUnc(workdir, distro))
            return;
        throw new Error(t("workdirAnotherDistro", { workdir, distro }));
    }
    /**
     * The agent-backed execution path: one long-lived in-distro process, the
     * confinement argv unchanged, the handle shape unchanged. An
     * {@link AgentUnavailableError} for a command the resident never took
     * settles the handle with the one-shot retry instead; one for a command
     * that was in flight when the resident was lost propagates.
     *
     * @param resolved - the resolved spec from {@link WslShellExecutor.execute}.
     * @param distro - the resolved distro name.
     * @param shell - the resolved distro shell.
     * @returns the decorated execution result.
     */
    async executeViaAgent(resolved, distro, shell, writableRoots = [], socketMasks = [], maskInterop = false) {
        const config = this.wslConfig;
        const policy = resolved.sandboxPolicy;
        const confined = this.sandbox !== undefined && policy !== undefined && policy.mode !== "danger-full-access"
            ? await this.sandbox.confine(this.distroArgv(resolved, shell), { ...policy, mode: policy.mode }, { distro, signal: resolved.signal, writableRoots, socketMasks, maskInterop })
            : undefined;
        const mode = policy?.mode;
        const useScope = await this.wantsSessionRuntime(distro);
        const runtime = useScope ? this.sessionRuntimeFor(policy, resolved, distro, writableRoots, socketMasks, maskInterop) : undefined;
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
        const env = { ...resolved.env, ...resolved.dshEnv };
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
                    const profile = confined;
                    this.processFacts.set(proc, {
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
            // Upstream's own handle calls `onProcessDone` as it settles; without
            // this the stamp `onStarted` left would never be applied to the handle
            // (a background process would report no sandbox facts) and never be
            // released — every confined command through the resident would keep its
            // handle, output buffers included, in `processFacts` for good.
            onSettled: (proc, error) => {
                this.onProcessDone(proc, proc.observed.stderr.readFrom(0).text, error !== undefined, error);
            },
        });
        const decorated = WslShellExecutor.decorateResult(execution, (result) => {
            this.throwIfDistroUnavailable(result, distro);
            this.throwIfWorkdirMissing(result, resolved.workdir);
            if (this.sandbox === undefined)
                return result;
            if (confined === undefined) {
                return ({ ...result, sandbox: { mode, denied: false, sessionScope: useScope ? "session" : "per-command" } });
            }
            const { enforcement, denialSignatures, runnerFailureRules, windowsDrive } = confined;
            const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, runnerFailureRules);
            if (runnerFailure !== undefined) {
                // This path computes `mode` as `policy?.mode`, which the seam spells as
                // the wider union: a runner failure is only ever thrown under a
                // confinement, and there the mode is one of the two confined ones.
                throw new SandboxUnavailableError(mode, withBwrapHint(runnerFailure.detail, distro));
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
            });
        }, (error) => {
            if (resolved.signal?.aborted === true)
                resolved.signal.throwIfAborted();
            /**
             * Run the command again on the one-shot path and settle with that
             * handle's result. The agent handle stamped confinement facts for a run
             * that never happened through it, so the stamp goes before the retry;
             * the one-shot handle stamps and settles its own.
             *
             * @returns the one-shot result.
             */
            const retryOneShot = () => {
                this.processFacts.delete(execution);
                return this.executeOneShot(resolved, distro, shell, writableRoots, socketMasks, maskInterop).then((fallback) => fallback.result());
            };
            // The native agent reports a missing workdir as a spawn failure without
            // naming it. Retry that command on the one-shot path, whose `--cd`
            // warning names the directory — the failure path pays the extra spawn,
            // the hot path does not.
            if (error instanceof SpawnError)
                return retryOneShot();
            // The resident refused the command before running it — dead, backing off
            // after a death, or its handshake failed. `WslAgent.exec` is async, so
            // that refusal always arrives here, through `result()`, never as the
            // synchronous throw `execute` catches. A command that WAS with the
            // resident when it was lost is not a cue: see `isFallbackCue`.
            if (isFallbackCue(error))
                return retryOneShot();
            throw error;
        });
        // The agent handle IS the upstream execution shape at runtime; its typedef
        // spells `signal` as `string` and the captured streams without `spillPath`,
        // so the upstream-facing return rides one type-level cast.
        return decorated;
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
    async executeOneShot(resolved, distro, shell, writableRoots = [], socketMasks = [], maskInterop = false) {
        const policy = resolved.sandboxPolicy;
        if (this.sandbox === undefined || policy === undefined || policy.mode === "danger-full-access") {
            // `executeArgv` resolves to the execution handle, so it has to be awaited
            // before it can be decorated — the confined branch below does the same.
            // The sync thunk is the prepare form at runtime (`executeArgv` awaits any
            // function it is given); the type spells it as the async prepare it is
            // used as, which is why the thunk rides a type-level cast.
            const execution = await this.executeArgv(resolved, (() => this.argv(resolved, distro, shell)));
            return WslShellExecutor.decorateResult(execution, (result) => {
                this.throwIfDistroUnavailable(result, distro);
                this.throwIfWorkdirMissing(result, resolved.workdir);
                return result;
            }, (error) => {
                throw error;
            });
        }
        // The confined prepare closes over this slot: the argv builder assigns it,
        // the fact-stamper and the settlement mapping read it. `executeArgv` runs
        // the builder before either callback can fire, so the reads always see the
        // assigned profile (or the run never happened). The mode is captured once
        // here: the guard above narrowed it, and property narrowings do not reach
        // closures.
        const mode = policy.mode;
        const confinement = { profile: undefined };
        const execution = await this.executeArgv(resolved, (signal) => this.prepareConfinedArgv(resolved, distro, shell, policy, mode, confinement, writableRoots, socketMasks, maskInterop, signal), (process) => this.stampConfinedFacts(resolved, mode, confinement, process));
        return WslShellExecutor.decorateResult(execution, (result) => {
            return this.settleConfinedOneShot(result, distro, resolved, mode, confinement.profile);
        }, (error) => {
            // An upstream abort remains cancellation even when it prevents spawn.
            if (resolved.signal?.aborted === true)
                resolved.signal.throwIfAborted();
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
    async prepareConfinedArgv(resolved, distro, shell, policy, mode, slot, writableRoots, socketMasks, maskInterop, signal) {
        // Preparation is async, so it runs under executeArgv's deadline and
        // cancellation handling rather than before them. A distro without a
        // usable runner throws here, before anything is spawned. The outer
        // guard narrowed the sandbox in, but narrowings do not reach closures —
        // so the confined sandbox is asserted here, type-level only.
        const profile = await this.sandbox.confine(this.distroArgv(resolved, shell), { ...policy, mode }, { distro, signal, writableRoots, socketMasks, maskInterop });
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
    stampConfinedFacts(resolved, mode, slot, process) {
        // The builder has run before any process callback can fire; the confined
        // shape is asserted once here, type-level only.
        const profile = slot.profile;
        this.processFacts.set(process, {
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
    settleConfinedOneShot(result, distro, resolved, mode, confined) {
        this.throwIfDistroUnavailable(result, distro);
        this.throwIfWorkdirMissing(result, resolved.workdir);
        if (confined === undefined) {
            return ({ ...result, sandbox: { mode, denied: false, sessionScope: "per-command" } });
        }
        const { enforcement, denialSignatures, runnerFailureRules, windowsDrive } = confined;
        // Runner failure outranks denial because the command did not run at all.
        const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, runnerFailureRules);
        if (runnerFailure !== undefined)
            throw new SandboxUnavailableError(mode, withBwrapHint(runnerFailure.detail, distro));
        return ({
            ...result,
            sandbox: {
                mode,
                denied: matchesSignature(result.exitCode, result.stderr.text, denialSignatures),
                enforcement,
                windowsDrive,
                sessionScope: "per-command",
            },
        });
    }
}
