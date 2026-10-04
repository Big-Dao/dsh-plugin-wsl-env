/**
 * dsh-plugin-wsl — run a DeepSeek Harness session against a WSL distro.
 *
 * DeepSeek Harness is a Cordis application whose capabilities are exposed as
 * service seams: `ctx.fs` (filesystem), `ctx.shell` (command execution),
 * `ctx.sandbox` (confinement), `ctx.directoryPicker`, `ctx.workspaceRegistry`.
 * The model-facing tools (`dsh-tool-fs`, `dsh-tool-fs-search`, `dsh-tool-bash`)
 * consume those seams and never talk to a filesystem or a shell directly. A WSL
 * integration is therefore a seam provider, not a new tool.
 *
 * This package provides two of them:
 *
 *   - {@link WslShellExecutor} registers `ctx.shell` and runs every command
 *     inside the distro as `wsl.exe -d <distro> --cd <linux dir> --exec <shell> -lc <cmd>`,
 *     where `<shell>` is the distro user's login shell (not a hardcoded bash).
 *   - {@link WslFileSystem} registers `ctx.fs` and maps Linux paths onto the
 *     distro's UNC share so the host's own fs stack (including the packaged
 *     ripgrep used by `dsh-tool-fs-search`) reads and writes real distro files.
 *
 * ## The one constraint that shapes everything
 *
 * On Windows, DSH confines commands with `dsh-sandbox-windows-acl`: a
 * restricted, low-integrity token plus a capability-SID write allowlist. That
 * token cannot reach WSL at all — `wsl.exe` fails with `Wsl/E_ACCESSDENIED` and
 * the UNC share `\\wsl.localhost\<distro>` reports access denied. Both work
 * normally outside the sandbox.
 *
 * The confinement is applied by the *sandboxing* executor (`pwsh-sandbox`),
 * which wraps the argv through `ctx.sandbox.confine`. This plugin therefore
 * subclasses the NON-sandboxing `LocalBashExecutor`, and inherits
 * `sandboxMode === undefined` from the seam — which is the honest capability
 * fact: the tool layer reads it and advertises that these commands are not
 * confined. WSL access is inherently outside the harness's file sandbox; do not
 * paper over that by reporting a mode this provider does not enforce.
 *
 * @module dsh-plugin-wsl
 */

import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { LocalBashExecutor } from "@deepseek-ai/dsh-bash-local";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { FsError } from "@deepseek-ai/dsh-fs";
import { canonicalPath, classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature, SandboxUnavailableError, writableRoots } from "@deepseek-ai/dsh-sandbox";
import { isAnotherDistrosUnc, isRelativeWorldPath, isWorldPathUnder, isWslUnc, isUnderDistro, posixToUnc, toLinuxPath, toWorldPath, uncToPosix, windowsToLinuxMount } from "./paths.js";
import { isConfinedMutation, mutationModeRefusal, outsideDistroRefusal, shareSubstrateRefusal, substrateFailure, workspaceWriteDenial } from "./fs-decisions.js";
import { WslSandbox } from "./sandbox.js";
import { armDistroWatcher } from "./watcher.js";
import { WslAgent } from "./agent.js";
import { AgentUnavailableError } from "./agent-errors.js";
import { agentExecutionHandle } from "./agent-exec.js";
import { sharedAgent } from "./agent-shared.js";
import { AgentSubstrate } from "./fs-substrate.js";
import { FsCodedError } from "./fsio-text.js";
import { confinedAgent } from "./agent-confined.js";
// `runCapture` and distro discovery live in ./wsl.js so the directory picker
// can use them without pulling this file's executor and filesystem peers in.
import { defaultDistro, defaultShell, linuxHomePath, shellArgs, workdirFailure, wslErrorCode } from "./wsl.js";

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

/**
 * The configured default workdir, or an empty string when the operator left it
 * unset. `cwd` is a volatile field on both providers, so it is read through
 * `.get()`, and it may be absent entirely.
 *
 * @param config - a provider's config.
 * @returns the configured directory, trimmed, or `""`.
 */
function configuredCwd(config) {
  return String(config.cwd?.get?.() ?? "").trim();
}

/**
 * The distro user's home as a Linux path, cached on the provider instance whose
 * `distro`/`wslPath` config it belongs to.
 *
 * An empty `cwd` cannot mean the shipped default (`process.cwd()`, a Windows
 * directory no `wsl.exe --cd` accepts) and it must not mean a hardcoded author
 * path either, so both providers agree on this instead: the distro's own home,
 * asked of the distro once per instance.
 *
 * @param owner - a WslShellExecutor or WslFileSystem.
 * @returns an absolute Linux path.
 */
async function distroHome(owner) {
  if (owner.resolvedHome === undefined) {
    const distro = await owner.distro();
    owner.resolvedHome = await linuxHomePath(distro, { wslPath: owner.config.wslPath });
  }
  return owner.resolvedHome;
}

/**
 * The roots a `workspace-write` policy may write under, in the vocabulary this
 * backend's targets are spelled in.
 *
 * Upstream's {@link writableRoots} grants the workspace plus the platform temp
 * areas (`/tmp`, `os.tmpdir()`). A session whose workspace lives inside a
 * distro speaks UNC, where neither host spelling matches anything, and the temp
 * area that world actually exposes is the distro's own `/tmp` — so that is what
 * is granted instead, and the Windows temp dir deliberately is NOT: it lies
 * outside the execution world the policy describes. A session whose workspace
 * is a Windows folder keeps upstream's grant verbatim.
 *
 * @param policy - the per-call file-effect policy.
 * @param distro - the distro a UNC workspace belongs to.
 * @returns canonical writable roots; empty exactly under `read-only`.
 */
function wslWritableRoots(policy, distro) {
  if (policy.mode !== "workspace-write") return [];
  const roots = new Set([canonicalPath(policy.workspaceRoot)]);
  if (isWslUnc(policy.workspaceRoot)) {
    roots.add(canonicalPath(posixToUnc(distro, "/tmp")));
  } else {
    for (const root of writableRoots(policy)) roots.add(root);
  }
  return [...roots];
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
export class WslShellExecutor extends LocalBashExecutor {
  static inject = ["subprocess", "sandboxPolicy"];

  static Config = z.object({
    /** Distro name; empty means WSL's own default distro. */
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
    maskWindowsDrive: z.boolean().default(false),
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
  });

  constructor(ctx, config) {
    super(ctx, config);
    /** Cached default distro, resolved once from `wsl.exe -l -q`. */
    this.resolvedDistro = config.distro;
    /** Cached distro-user login shell, resolved once. */
    this.resolvedShell = config.shell;
    /** Cached distro-user home, the workdir when `cwd` is empty. */
    this.resolvedHome = undefined;
    /** The default mode — the capability fact the tool layer reads. */
    this.mode = config.sandbox ? ctx.sandboxPolicy.defaultMode : undefined;
    /** The distro-side confinement, or nothing when the operator opted out. */
    this.sandbox = config.sandbox ? new WslSandbox({ wslPath: config.wslPath }) : undefined;
    /**
     * Per-process confinement facts retained until settlement. Overlapping calls
     * can carry different policies, so a shared latest-wrap value would classify
     * a process against the wrong facts. Unconfined processes have no entry.
     */
    this.processFacts = new Map();
  }

  /**
   * The mode this executor confines with, or `undefined` when it does not
   * confine at all. `dsh-tool-bash` reads exactly this to decide whether to
   * advertise the escalation field, so it must disappear together with the
   * enforcement — never claim a boundary that is not applied.
   * @returns the deployment default mode, or `undefined` when unconfined.
   */
  get sandboxMode() {
    return this.mode;
  }

  /**
   * The distro every command runs in, resolving WSL's default on first use.
   * @returns the distro name.
   */
  async distro() {
    if (this.resolvedDistro.length === 0) this.resolvedDistro = await defaultDistro({ wslPath: this.config.wslPath });
    return this.resolvedDistro;
  }

  /**
   * The shell every command runs in: the configured one, else the login shell of
   * the distro user, resolved once and cached.
   * @returns an absolute path to the shell inside the distro.
   */
  async shellName() {
    // Consumed by the shell tool after upstream change A: it names and describes
    // itself from the executor, so a zsh distro is never presented as bash.
    const shell = await this.shell();
    const base = String(shell ?? "").split("/").pop() ?? "";
    const name = base.replace(/\.exe$/i, "").replace(/^[-.]+/, "");
    return /^[a-z0-9_+-]+$/i.test(name) ? name : "bash";
  }

  async shell() {
    if (this.resolvedShell.length === 0) {
      const distro = await this.distro();
      this.resolvedShell = await defaultShell(distro, { wslPath: this.config.wslPath });
    }
    return this.resolvedShell;
  }

  /** Windows directory the `wsl.exe` process is started from. */
  hostCwd() {
    return this.config.hostCwd.get() ?? process.env.SystemRoot ?? process.cwd();
  }

  /**
   * The shared resident agent serving this executor's distro.
   * @param distro - the resolved distro name.
   * @returns {WslAgent} the shared agent.
   */
  executionAgent(distro) {
    return sharedAgent(distro);
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
    return [shell, ...shellArgs(shell, this.config.loginShell), spec.command];
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
    const distroArgs = distro.length > 0 ? ["-d", distro] : [];
    return [
      this.config.wslPath,
      ...distroArgs,
      "--cd",
      toLinuxPath(spec.workdir, { distro }),
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
   * @param spec - resolved execution settings.
   * @param argv - the argv from {@link WslShellExecutor.argv}.
   * @param stdoutMaxBytes - per-call stdout cap.
   * @param signal - the spawn cancellation signal.
   * @returns the subprocess spawn spec.
   */
  spawnSpec(spec, argv, stdoutMaxBytes, signal) {
    const base = super.spawnSpec(spec, argv, stdoutMaxBytes, signal);
    const forward = new Set([...SAFE_FORWARD, ...this.config.forwardEnv]);
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
  resolve(request) {
    const spec = super.resolve(request);
    const sandboxPolicy = this.sandbox === undefined ? undefined : (request?.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve());
    const workdir = typeof request?.workdir === "string" ? request.workdir : undefined;
    const needsHome =
      configuredCwd(this.config).length === 0 && (workdir === undefined || isRelativeWorldPath(workdir));
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
  async withDefaultWorkdir(spec) {
    const tail = typeof spec?.relativeWorkdir === "string" ? spec.relativeWorkdir : undefined;
    if (String(spec?.workdir ?? "").trim().length > 0 && tail === undefined) return spec;
    const home = await distroHome(this);
    if (tail === undefined || tail.length === 0) return { ...spec, workdir: home };
    return { ...spec, workdir: toLinuxPath(tail, { distro: await this.distro(), cwd: home }) };
  }

  /**
   * Decorate a handle's foreground projection in place, memoized once. The
   * handle keeps its identity — never wrapped in a second object — because the
   * per-process facts and `onProcessDone` key on the exact instance.
   *
   * @param ex - the execution handle to decorate.
   * @param map - maps the settled result.
   * @param mapError - maps a rejection, when the caller has one.
   * @returns the same handle.
   */
  static decorateResult(ex, map, mapError) {
    const base = ex.result.bind(ex);
    let decorated;
    ex.result = () => {
      decorated ??= base().then(map, mapError);
      return decorated;
    };
    return ex;
  }

  /**
   * Stamp the per-process sandbox facts before `done` settles, so a background
   * process reports the same mode, denial and enforcement a foreground run
   * would. Signal deaths are not denials.
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
        ...(runnerFailed ? { runnerFailed } : {}),
      };
    }
    super.onProcessDone(proc, stderr, providerRejected, providerError);
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
   * @throws Error carrying the `WSL_E_*` code and the remedy.
   */
  throwIfDistroUnavailable(result, distro) {
    if (result?.exitCode === 0) return;
    const code = wslErrorCode(result?.stdout?.text, result?.stderr?.text);
    if (code === undefined) return;
    throw new Error(
      `wsl.exe reported ${code} for distro "${distro}": it is not installed, or not running. ` +
        `Start it with \`wsl.exe -d ${distro}\`, check \`wsl.exe -l -v\`, or point \`distro\` at another one. ` +
        `This is not a sandbox denial, so running with wider permissions will not help.`,
    );
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
   * @throws Error naming the directory and the fallback that happened.
   */
  throwIfWorkdirMissing(result, workdir) {
    const missing = workdirFailure(result?.stdout?.text, result?.stderr?.text);
    if (missing === undefined) return;
    throw new Error(
      `wsl.exe could not enter the working directory "${missing}" inside the distro, so the command ran from "/" instead. ` +
        `Create it, or point \`cwd\` (or the request's \`workdir\`) at a directory that exists.`,
    );
  }

  async execute(spec) {
    const distro = await this.distro();
    const shell = await this.shell();
    const resolved = await this.withDefaultWorkdir(spec);
    this.throwIfWorkdirInAnotherDistro(resolved.workdir, distro);
    if (this.config.agent) {
      try {
        return await this.executeViaAgent(resolved, distro, shell);
      } catch (error) {
        // Only an out-of-service agent falls back; anything else (a cwd
        // refusal, a sandbox refusal) is the command's own verdict.
        if (!(error instanceof AgentUnavailableError)) throw error;
      }
    }
    return this.executeOneShot(resolved, distro, shell);
  }

  /**
   * Refuse a workdir that names another WSL distro — the shell-side twin of
   * the filesystem's `FS_OUTSIDE_DISTRO` fence. Left unguarded, `toLinuxPath`
   * strips the UNC's distro name and the command runs inside THIS distro
   * against whatever tree happens to share the path, silently, while the fs
   * side refuses the same workspace outright. The wording mirrors the fs
   * refusal (minus `restrictToDistro`, which is an fs-only key).
   * @param workdir - the resolved workdir (UNC, Linux path, or Windows path).
   * @param distro - the pinned distro name.
   * @throws Error naming both distros and both ways out.
   */
  throwIfWorkdirInAnotherDistro(workdir, distro) {
    if (!isAnotherDistrosUnc(workdir, distro)) return;
    throw new Error(
      `"${workdir}" names a workspace in another WSL distro, and this profile pins its commands to "${distro}" — ` +
        `running them here would act on a different machine's tree. Open a session in that distro, ` +
        `or point cwd/workdir at this distro.`,
    );
  }

  /**
   * The agent-backed execution path: one long-lived in-distro process, the
   * confinement argv unchanged, the handle shape unchanged. Any
   * {@link AgentUnavailableError} propagates for the caller's fallback.
   * @param resolved - the resolved spec from {@link WslShellExecutor.execute}.
   * @param distro - the resolved distro name.
   * @param shell - the resolved distro shell.
   * @returns the decorated execution result.
   */
  async executeViaAgent(resolved, distro, shell) {
    const policy = resolved.sandboxPolicy;
    const confined = this.sandbox !== undefined && policy !== undefined && policy.mode !== "danger-full-access"
      ? await this.sandbox.confine(this.distroArgv(resolved, shell), { ...policy, mode: policy.mode }, { distro, signal: resolved.signal })
      : undefined;
    const mode = policy?.mode;
    const execution = agentExecutionHandle({
      agent: await this.executionAgent(distro),
      // The one-shot path converts the spec's workdir into the distro's
      // coordinate system inside argv(); the agent carries the cwd as a frame
      // field, so the SAME conversion happens here — a raw UNC must never
      // reach `chdir` (that is the bug this line fixes).
      cwd: toLinuxPath(resolved.workdir, { distro }),
      argv: confined !== undefined ? confined.argv : this.distroArgv(resolved, shell),
      timeoutMs: resolved.timeoutMs,
      // The agent enforces the collect budget distro-side (the EXEC frame
      // carries it); `maxSpillBytes` stays one-shot-only — the agent path has
      // no spill files by design, its capture is bounded instead.
      maxOutputBytes: this.config.maxOutputBytes,
      signal: resolved.signal,
      onStarted: confined !== undefined
        ? (proc) => {
            this.processFacts.set(proc, {
              mode,
              enforcement: confined.enforcement,
              denialSignatures: confined.denialSignatures,
              runnerFailureRules: confined.runnerFailureRules,
              runnerProgram: confined.argv[0],
              workdir: resolved.workdir,
              windowsDrive: confined.windowsDrive,
            });
          }
        : undefined,
    });
    return WslShellExecutor.decorateResult(execution, (result) => {
      this.throwIfDistroUnavailable(result, distro);
      this.throwIfWorkdirMissing(result, resolved.workdir);
      if (this.sandbox === undefined) return result;
      if (confined === undefined) return { ...result, sandbox: { mode, denied: false } };
      const { enforcement, denialSignatures, runnerFailureRules, windowsDrive } = confined;
      const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, runnerFailureRules);
      if (runnerFailure !== undefined) throw new SandboxUnavailableError(mode, runnerFailure.detail);
      return {
        ...result,
        sandbox: {
          mode,
          denied: matchesSignature(result.exitCode, result.stderr.text, denialSignatures),
          enforcement,
          windowsDrive,
        },
      };
    }, (error) => {
      if (resolved.signal?.aborted === true) resolved.signal.throwIfAborted();
      throw error;
    });
  }

  /**
   * The pre-agent execution path, verbatim: one `wsl.exe` per command through
   * the inherited `executeArgv` machinery. Kept as the permanent fallback for
   * an out-of-service agent and as the `agent: false` behaviour.
   * @param resolved - the resolved spec.
   * @param distro - the resolved distro name.
   * @param shell - the resolved distro shell.
   * @returns the decorated execution result.
   */
  async executeOneShot(resolved, distro, shell) {
    const policy = resolved.sandboxPolicy;
    if (this.sandbox === undefined || policy === undefined || policy.mode === "danger-full-access") {
      // `executeArgv` resolves to the execution handle, so it has to be awaited
      // before it can be decorated — the confined branch below does the same.
      const execution = await this.executeArgv(resolved, () => this.argv(resolved, distro, shell));
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
    const mode = policy.mode;
    let confined;
    const execution = await this.executeArgv(
      resolved,
      async (signal) => {
        // Preparation is async, so it runs under executeArgv's deadline and
        // cancellation handling rather than before them. A distro without a
        // usable runner throws here, before anything is spawned.
        confined = await this.sandbox.confine(this.distroArgv(resolved, shell), { ...policy, mode }, { distro, signal });
        signal.throwIfAborted();
        return this.argv(resolved, distro, shell, confined.argv);
      },
      (process) => {
        this.processFacts.set(process, {
          mode,
          enforcement: confined.enforcement,
          denialSignatures: confined.denialSignatures,
          runnerFailureRules: confined.runnerFailureRules,
          runnerProgram: confined.argv[0],
          workdir: resolved.workdir,
          windowsDrive: confined.windowsDrive,
        });
      },
    );
    return WslShellExecutor.decorateResult(execution, (result) => {
      this.throwIfDistroUnavailable(result, distro);
      this.throwIfWorkdirMissing(result, resolved.workdir);
      if (confined === undefined) return { ...result, sandbox: { mode, denied: false } };
      const { enforcement, denialSignatures, runnerFailureRules, windowsDrive } = confined;
      // Runner failure outranks denial because the command did not run at all.
      const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, runnerFailureRules);
      if (runnerFailure !== undefined) throw new SandboxUnavailableError(mode, runnerFailure.detail);
      return {
        ...result,
        sandbox: {
          mode,
          denied: matchesSignature(result.exitCode, result.stderr.text, denialSignatures),
          enforcement,
          windowsDrive,
        },
      };
    }, (error) => {
      // An upstream abort remains cancellation even when it prevents spawn.
      if (resolved.signal?.aborted === true) resolved.signal.throwIfAborted();
      if (confined !== undefined && isRunnerSpawnFailure(error, confined.argv[0], resolved.workdir)) {
        throw new SandboxUnavailableError(mode, String(error));
      }
      throw error;
    });
  }
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
export class WslFileSystem extends LocalFileSystem {
  static inject = ["sandboxPolicy"];

  static Config = z.object({
    /** Distro name; empty resolves WSL's default on first use. */
    distro: z.string().default(""),
    /**
     * Default workdir for relative input; accepts a Linux path, a UNC path, or
     * `C:\...`. Empty — the default — means the distro user's home, resolved
     * inside the distro.
     */
    cwd: z.string().default(""),
    /** Path to `wsl.exe`, used only to resolve the default distro. */
    wslPath: z.string().default("wsl.exe"),
    /** UTF-8 byte limit per overwrite-diff side, mirroring the host backend. */
    diffBasisMaxBytes: z.number().default(10 * 1024 * 1024),
    /**
     * Fence mutations by `ctx.sandboxPolicy`, and report the mode through
     * {@link sandboxMode}. `false` restores the pre-sandbox behaviour exactly —
     * an unfenced backend that reports `undefined` — for an operator who wants
     * the old posture and accepts what it means: the model is told these
     * operations are unconfined.
     */
    sandbox: z.boolean().default(true),
    /**
     * Shadow `/mnt` with an empty tmpfs in every confined profile, hiding the
     * Windows drive from confined commands — same meaning and same honest
     * limits as the `wsl-shell` key of the same name (its doc carries the
     * full story). Confined fs mutations publish through the masked resident;
     * reads and the share substrate are unaffected.
     */
    maskWindowsDrive: z.boolean().default(false),
    /**
     * Refuse any path that leaves the pinned distro. A WSL filesystem is a
     * whole-Linux view whose `/mnt/c` also reaches the Windows disk, so without
     * this the backend would silently widen the session far beyond the
     * workspace the operator selected.
     */
    restrictToDistro: z.boolean().default(true),
    /**
     * How deep the in-distro watch scan walks, `1` = the watched directory and
     * its direct children. `0` — the default — walks the whole tree, which is
     * what the invalidation contract asks for but a real cost every poll over
     * a tree containing a `node_modules`; a bound trades that cost for a
     * documented blind spot: a change below the bound is not seen until
     * another change above it fires the same callback.
     */
    watchMaxDepth: z.natural().default(0),
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
    substrate: z.union(["share", "agent"]).default("agent"),
  });

  constructor(ctx, config) {
    // The share substrate is refused before any peer work: a profile still
    // carrying the retired value must fail loudly, with the migration, not
    // silently serve the one I/O path this provider exists to close.
    const refusal = shareSubstrateRefusal(config.substrate);
    if (refusal !== null) throw new Error(refusal.message);
    super(ctx, config);
    this.resolvedDistro = config.distro;
    /** Cached distro-user home, the base for relative input when `cwd` is empty. */
    this.resolvedHome = undefined;
    /** The deployment default mode — the capability fact the tool layer reads. */
    this.defaultMode = ctx.sandboxPolicy.defaultMode;
    /** The lazy agent-backed substrate, built on first use (see `agentSubstrate`). */
    this.agentSubstrateInstance = undefined;
    /** The distro-side bwrap usability probe, shared with the confined agents. */
    this.sandbox = new WslSandbox({ wslPath: config.wslPath, maskWindowsDrive: config.maskWindowsDrive });
  }

  /**
   * The mode this backend fences mutations with, or `undefined` when the
   * operator turned the fence off. This is the capability fact `dsh-tool-fs`
   * reads to advertise the escalation fields honestly, so it must disappear
   * together with the enforcement — never claim a boundary that is not applied.
   * @returns the deployment default mode, or `undefined` when unfenced.
   */
  get sandboxMode() {
    return this.config.sandbox ? this.defaultMode : undefined;
  }

  /**
   * The resident agent serving this filesystem's in-distro side work, created
   * on first use and kept for the provider's lifetime (its own idle timer
   * retires the process; a later call starts a fresh one).
   * @returns {Promise<WslAgent>} the agent for the pinned distro.
   */
  async publicationAgent() {
    if (this.agentInstance === undefined) {
      this.agentInstance = sharedAgent(await this.distro());
    }
    return this.agentInstance;
  }

  /**
   * The agent-backed substrate, built on first use over the same resident
   * agent every other distro side work shares.
   * @returns {Promise<AgentSubstrate>} the substrate.
   */
  async agentSubstrate() {
    if (this.agentSubstrateInstance === undefined) {
      this.agentSubstrateInstance = new AgentSubstrate({
        agent: await this.publicationAgent(),
        distro: await this.distro(),
        diffBasisMaxBytes: this.config.diffBasisMaxBytes,
        agentFor: (policy) => this.mutationAgent(policy),
      });
    }
    return this.agentSubstrateInstance;
  }

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
  async mutationAgent(policy) {
    if (!isConfinedMutation({ policy, sandboxEnabled: this.config.sandbox })) {
      return this.publicationAgent();
    }
    const distro = await this.distro();
    if (!(await this.sandbox.usable(distro))) {
      throw new SandboxUnavailableError(
        policy.mode,
        `bwrap is not usable inside distro "${distro}". Install it with ` +
          `"scripts/bootstrap.sh ${distro} --install" (from the package), or directly: ` +
          `wsl.exe -d ${distro} -u root -- apt-get install -y bubblewrap`,
      );
    }
    return confinedAgent({ distro, wslPath: this.config.wslPath, policy, maskWindowsDrive: this.config.maskWindowsDrive });
  }

  /**
   * Map a substrate error onto the peer's `FsError`, so the tool layer reads
   * the same refusal dialect on both substrates. An agent that is out becomes
   * an I/O error naming the cause — the share backend's "distro is gone" case
   * is the same availability, but the message says which substrate failed.
   * @param error - what the substrate raised.
   * @returns {FsError} the error to surface.
   */
  peerError(error) {
    if (error instanceof FsCodedError) return new FsError(error.message, error.code, { cause: error });
    if (error instanceof SandboxUnavailableError) return new FsError(error.message, "FS_IO_ERROR", { cause: error });
    const { message, code, cause } = substrateFailure(error);
    return new FsError(message, code, cause === undefined ? {} : { cause });
  }

  /**
   * One resolved target's Linux path — the substrate's coordinate — falling
   * back to the display spelling when the identity is not a distro share path.
   * @param target - the resolved target.
   * @returns the absolute Linux path.
   */
  linuxOf(target) {
    return uncToPosix(target.targetKey)?.linuxPath ?? target.displayPath;
  }

  /**
   * The pinned distro, resolving WSL's default on first use.
   * @returns the distro name.
   */
  async distro() {
    if (this.resolvedDistro.length === 0) this.resolvedDistro = await defaultDistro({ wslPath: this.config.wslPath });
    return this.resolvedDistro;
  }

  /**
   * Translate one caller path into the world path, enforcing the distro fence.
   * @param path - a Linux, UNC or Windows path.
   * @param cwd - the caller's override of the configured default workdir.
   * @returns the host path to operate on.
   */
  async worldPath(path, cwd) {
    const distro = await this.distro();
    let base = cwd ?? this.config.cwd;
    if (String(base ?? "").trim().length === 0 && isRelativeWorldPath(path)) {
      // An empty `cwd` means the distro user's home. Only relative input
      // consults the base at all, which is also the only case that has to pay
      // for the `wsl.exe` query — an absolute path never does.
      base = await distroHome(this);
    }
    const world = toWorldPath(path, { distro, cwd: base });
    const refusal = outsideDistroRefusal({ path, world, distro, restrictToDistro: this.config.restrictToDistro });
    if (refusal !== null) {
      // Deliberately NOT `FS_SANDBOX_DENIED`. The file-tool layer turns that code
      // into a denial marker plus an escalation offer, and no wider permission can
      // lift this fence: it is a configuration choice, not a sandbox decision.
      throw new FsError(refusal.message, refusal.code);
    }
    return world;
  }

  /**
   * Resolve a path to a target whose `targetKey` is the UNC identity the host
   * I/O stack uses and whose `displayPath` is the Linux path the model sees.
   * @param path - a Linux, UNC or Windows path.
   * @param opts - optional `cwd` override and `signal`.
   * @returns the resolved `FsTarget`.
   */
  async resolve(path, opts) {
    const world = await this.worldPath(path, opts?.cwd);
    const linux = uncToPosix(world)?.linuxPath ?? windowsToLinuxMount(world);
    if (linux === undefined) throw new FsError(`cannot serve "${path}" from inside the distro`, "FS_IO_ERROR");
    try {
      return await (await this.agentSubstrate()).resolve(linux, opts?.signal);
    } catch (error) {
      throw this.peerError(error);
    }
  }

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
   * @throws FsError with `FS_SANDBOX_DENIED` when the policy refuses it.
   */
  async checkedTarget(target, sandboxPolicy) {
    if (!this.config.sandbox) return target;
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
    const modeRefusal = mutationModeRefusal(policy.mode, target.displayPath);
    if (modeRefusal !== null) throw new FsError(modeRefusal.message, modeRefusal.code);
    if (policy.mode !== "workspace-write") return target;
    const fresh = await this.resolve(target.displayPath);
    const distro = await this.distro();
    for (const root of wslWritableRoots(policy, distro)) {
      if (isWorldPathUnder(fresh.targetKey, root, { distro })) return fresh;
    }
    const denial = workspaceWriteDenial(target.displayPath);
    throw new FsError(denial.message, denial.code);
  }

  async stat(target, signal) {
    try {
      return await (await this.agentSubstrate()).stat(target, signal);
    } catch (error) {
      throw this.peerError(error);
    }
  }

  /**
   * No-follow stat one path. The agent substrate answers from the distro,
   * where a symlink is a first-class entry.
   * @param path - a Linux, UNC or Windows path.
   * @param opts - optional `cwd` override.
   * @param signal - optional cancellation.
   * @returns the path info, or undefined when absent.
   */
  async lstat(path, opts, signal) {
    const world = await this.worldPath(path, opts?.cwd);
    const linux = uncToPosix(world)?.linuxPath ?? windowsToLinuxMount(world);
    if (linux === undefined) throw new FsError(`cannot inspect "${path}" from inside the distro`, "FS_IO_ERROR");
    try {
      return await (await this.agentSubstrate()).lstat(linux, signal);
    } catch (error) {
      throw this.peerError(error);
    }
  }

  async readText(target, signal) {
    try {
      return await (await this.agentSubstrate()).readText(target, signal);
    } catch (error) {
      throw this.peerError(error);
    }
  }

  async streamText(target, signal) {
    try {
      return await (await this.agentSubstrate()).streamText(target, signal);
    } catch (error) {
      throw this.peerError(error);
    }
  }

  async readBytes(target, signal, maxBytes) {
    try {
      return await (await this.agentSubstrate()).readBytes(target, signal, maxBytes);
    } catch (error) {
      throw this.peerError(error);
    }
  }

  async readByteRange(target, range, signal) {
    try {
      return await (await this.agentSubstrate()).readByteRange(target, range, signal);
    } catch (error) {
      throw this.peerError(error);
    }
  }

  /**
   * List one directory level. The substrate's rows already carry Linux display
   * paths and canonical identities — nothing to rewrite.
   * @param target - the resolved directory.
   * @param signal - optional cancellation.
   * @returns the directory rows.
   */
  async listDir(target, signal) {
    try {
      return await (await this.agentSubstrate()).listDir(target, signal);
    } catch (error) {
      throw this.peerError(error);
    }
  }

  /**
   * Map an absolute host path into this execution world. POSIX input is a Linux
   * path inside the distro; anything else keeps the host backend's behaviour.
   * @param hostPath - an absolute path.
   * @returns the process path for the same file, or undefined when unmappable.
   */
  async processPathFromHostPath(hostPath) {
    return this.worldPath(hostPath);
  }

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
  async watch(target, changed, signal) {
    signal.throwIfAborted();
    const parsed = uncToPosix(target.targetKey);
    if (parsed === undefined) {
      throw new FsError(`cannot watch "${target.displayPath}": not a path inside the distro`, "FS_IO_ERROR");
    }
    const distro = await this.distro();
    return armDistroWatcher({
      wslPath: this.config.wslPath,
      distro,
      linuxPath: parsed.linuxPath,
      onChange: changed,
      onError: (error) => changed(error),
      signal,
      maxDepth: this.config.watchMaxDepth,
    });
  }

  /**
   * Fence the write by the per-call policy, then publish through the
   * substrate. The fence's fresh target is the one checked and written, so a
   * refusal costs no I/O and cannot be raced by a swapped symlink; the guard
   * rides the write op, where the agent re-verifies it one syscall before the
   * rename and the confined resident enforces it in the kernel.
   *
   * @param target - the resolved target.
   * @param content - the full new file content.
   * @param expected - the write intent.
   * @param signal - optional cancellation.
   * @param sandboxPolicy - the per-call mode and workspace root; omit for the
   *   deployment policy.
   * @returns the write outcome.
   */
  async writeText(target, content, expected, signal, sandboxPolicy) {
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
    const fenced = await this.checkedTarget(target, policy);
    try {
      return await (await this.agentSubstrate()).writeText(fenced, content, expected, signal, policy);
    } catch (error) {
      throw this.peerError(error);
    }
  }

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
  async editText(target, edit, expected, signal, sandboxPolicy) {
    const policy = sandboxPolicy ?? this.ctx.sandboxPolicy.resolve();
    const fenced = await this.checkedTarget(target, policy);
    try {
      return await (await this.agentSubstrate()).editText(fenced, edit, expected, signal, policy);
    } catch (error) {
      throw this.peerError(error);
    }
  }
}
