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

import { rename } from "node:fs/promises";
import z from "@deepseek-ai/schemastery";
import { LocalBashExecutor } from "@deepseek-ai/dsh-bash-local";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { FsError } from "@deepseek-ai/dsh-fs";
import { canonicalPath, classifyRunnerFailure, isRunnerSpawnFailure, matchesSignature, SandboxUnavailableError, writableRoots } from "@deepseek-ai/dsh-sandbox";
import { isRelativeWorldPath, isWorldPathUnder, isWslUnc, isUnderDistro, posixToUnc, toDisplayPath, toLinuxPath, toWorldPath, uncToPosix } from "./paths.js";
import { WslSandbox } from "./sandbox.js";
// `runCapture` and distro discovery live in ./wsl.js so the directory picker
// can use them without pulling this file's executor and filesystem peers in.
import { canonicalLinuxPath, copyModeInDistro, defaultDistro, defaultShell, linuxHomePath, shellArgs, workdirFailure, wslErrorCode } from "./wsl.js";

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
        });
      },
    );
    return WslShellExecutor.decorateResult(execution, (result) => {
      this.throwIfDistroUnavailable(result, distro);
      this.throwIfWorkdirMissing(result, resolved.workdir);
      if (confined === undefined) return { ...result, sandbox: { mode, denied: false } };
      const { enforcement, denialSignatures, runnerFailureRules } = confined;
      // Runner failure outranks denial because the command did not run at all.
      const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, runnerFailureRules);
      if (runnerFailure !== undefined) throw new SandboxUnavailableError(mode, runnerFailure.detail);
      return {
        ...result,
        sandbox: {
          mode,
          denied: matchesSignature(result.exitCode, result.stderr.text, denialSignatures),
          enforcement,
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
     * Refuse any path that leaves the pinned distro. A WSL filesystem is a
     * whole-Linux view whose `/mnt/c` also reaches the Windows disk, so without
     * this the backend would silently widen the session far beyond the
     * workspace the operator selected.
     */
    restrictToDistro: z.boolean().default(true),
    /**
     * When a read-side operation reports `FS_NOT_FOUND` on a Linux path, ask the
     * distro for that path's canonical form and retry once. This is what makes
     * symlinked paths usable at all: the UNC share cannot traverse Linux
     * symlinks, so `/etc/os-release`, `/bin` and `/lib` would otherwise be
     * unreachable from the model's read tools. Costs one `wsl.exe` call per
     * distinct failing path, cached.
     */
    resolveSymlinks: z.boolean().default(true),
  });

  constructor(ctx, config) {
    super(ctx, config);
    this.resolvedDistro = config.distro;
    /** Cached distro-user home, the base for relative input when `cwd` is empty. */
    this.resolvedHome = undefined;
    /** The deployment default mode — the capability fact the tool layer reads. */
    this.defaultMode = ctx.sandboxPolicy.defaultMode;
    /** targetKey -> canonical replacement target, for symlinked paths. */
    this.canonicalTargets = new Map();
    // `dsh-fs-local` takes a Windows branch whenever the destination already
    // exists — which is how it knows to preserve the replaced file's security
    // descriptor, and what makes every write to an existing file fail here:
    //
    //   * it reads that descriptor with `GetFileSecurityW` and applies it to the
    //     staged temp. A 9p share carries no Windows security descriptor, so the
    //     call fails with `EIO (Win32 1)` and takes the whole write with it —
    //     `edit` and every overwrite, not just an exotic path.
    //   * it publishes with `ReplaceFileW`, which is not a 9p primitive.
    //
    // Both are replaced with their POSIX equivalents: the staged temp gets the
    // target's real mode from inside the distro (see `copyModeInDistro` — the
    // share ignores a host-side chmod), and publication is the plain atomic
    // rename the share does support.
    //
    // Trade-off worth knowing: those two hooks are the only DACL handling in the
    // inherited backend, so a *Windows* path served by this provider loses its
    // descriptor preservation. This provider exists to serve distro paths, where
    // no DACL can exist in the first place.
    this.internals = {
      ...this.internals,
      copyFileDacl: async () => {},
      replaceFile: (replaced, replacement) => this.publish(replaced, replacement),
    };
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
   * Publish a staged temp file over its target the way a 9p share supports:
   * give the temp the target's POSIX mode inside the distro, then rename it into
   * place.
   *
   * The mode is applied before the rename on purpose. The share drops a mode set
   * from the Windows side, but a rename preserves the inode's mode — so setting
   * it on the staged temp is what makes the published file keep the bits it had,
   * without a second in-distro call after publication and without the version
   * the write returns going stale behind a late `chmod`.
   *
   * @param replaced - the existing file being replaced (a UNC path).
   * @param replacement - the staged temp file holding the new content.
   */
  async publish(replaced, replacement) {
    const source = uncToPosix(replaced);
    const staged = uncToPosix(replacement);
    if (source !== undefined && staged !== undefined) {
      await copyModeInDistro(source.distro, source.linuxPath, staged.linuxPath, { wslPath: this.config.wslPath });
    }
    await rename(replacement, replaced);
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
    if (this.config.restrictToDistro && isWslUnc(world) && !isUnderDistro(world, distro)) {
      // Deliberately NOT `FS_SANDBOX_DENIED`. The file-tool layer turns that code
      // into a denial marker plus an escalation offer, and no wider permission can
      // lift this fence: it is a configuration choice, not a sandbox decision.
      throw new FsError(
        `"${path}" names a path in another WSL distro, and this profile pins its filesystem to "${distro}" ` +
          `(restrictToDistro: true). Open a session in that distro, or set restrictToDistro: false.`,
        "FS_OUTSIDE_DISTRO",
      );
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
    const distro = await this.distro();
    const target = await super.resolve(await this.worldPath(path, opts?.cwd), opts);
    return { targetKey: target.targetKey, displayPath: toDisplayPath(target.targetKey, distro) };
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
    const { mode } = policy;
    if (mode === "danger-full-access") return target;
    if (mode === "read-only") {
      throw new FsError(`cannot write "${target.displayPath}": file access denied under read-only mode`, "FS_SANDBOX_DENIED");
    }
    const fresh = await this.resolve(target.displayPath);
    const distro = await this.distro();
    for (const root of wslWritableRoots(policy, distro)) {
      if (isWorldPathUnder(fresh.targetKey, root, { distro })) return fresh;
    }
    throw new FsError(`cannot write "${target.displayPath}": file access denied under workspace-write mode`, "FS_SANDBOX_DENIED");
  }

  /**
   * The canonical replacement target for a Linux symlink this share cannot
   * traverse, or undefined when the path is not one.
   * @param target - the resolved target that failed a read-side operation.
   * @param signal - optional cancellation.
   * @returns the replacement target, or undefined.
   */
  async canonicalTarget(target, signal) {
    if (!this.config.resolveSymlinks) return undefined;
    const cached = this.canonicalTargets.get(target.targetKey);
    if (cached !== undefined) return cached;
    const parsed = uncToPosix(target.targetKey);
    if (parsed === undefined) return undefined;
    const canonical = await canonicalLinuxPath(parsed.distro, parsed.linuxPath, { wslPath: this.config.wslPath, signal });
    if (canonical === undefined || canonical === parsed.linuxPath) return undefined;
    const replacement = { targetKey: posixToUnc(parsed.distro, canonical), displayPath: target.displayPath };
    this.canonicalTargets.set(target.targetKey, replacement);
    return replacement;
  }

  /**
   * Run one read-side operation, retrying once through the distro's canonical
   * path when the share cannot follow a symlink. `displayPath` is preserved, so
   * the model still sees the path it asked for while `targetKey` names the file
   * the host can actually open.
   *
   * @param target - the resolved target.
   * @param signal - optional cancellation.
   * @param operation - the inherited operation to attempt.
   * @returns the operation's result.
   */
  async withCanonicalRetry(target, signal, operation) {
    let value;
    try {
      value = await operation(target);
    } catch (error) {
      if (!(error instanceof FsError) || error.code !== "FS_NOT_FOUND") throw error;
      const canonical = await this.canonicalTarget(target, signal);
      if (canonical === undefined) throw error;
      return operation(canonical);
    }
    // `stat` reports an absent file by RETURNING undefined rather than throwing,
    // and an untraversable symlink takes exactly that path over this share. The
    // model-facing read tool branches on precisely that undefined — it resolves,
    // stats, and renders "not found" itself — so retrying only the throw is not
    // enough: the silent miss has to be retried here too.
    if (value === undefined) {
      const canonical = await this.canonicalTarget(target, signal);
      if (canonical !== undefined) return operation(canonical);
    }
    return value;
  }

  async stat(target, signal) {
    return this.withCanonicalRetry(target, signal, (t) => super.stat(t, signal));
  }

  async readText(target, signal) {
    return this.withCanonicalRetry(target, signal, (t) => super.readText(t, signal));
  }

  async streamText(target, signal) {
    return this.withCanonicalRetry(target, signal, (t) => super.streamText(t, signal));
  }

  async readBytes(target, signal, maxBytes) {
    return this.withCanonicalRetry(target, signal, (t) => super.readBytes(t, signal, maxBytes));
  }

  async readByteRange(target, range, signal) {
    return this.withCanonicalRetry(target, signal, (t) => super.readByteRange(t, range, signal));
  }

  /**
   * List one level, rewriting each child's display path into the distro's
   * coordinate system — the host backend reports children with UNC display paths,
   * which would leak `\\wsl.localhost\...` into model-facing output.
   *
   * @param target - the resolved directory.
   * @param signal - optional cancellation.
   * @returns the directory rows.
   */
  async listDir(target, signal) {
    const entries = await this.withCanonicalRetry(target, signal, (t) => super.listDir(t, signal));
    const distro = await this.distro();
    return entries.map((entry) => ({
      ...entry,
      target: { targetKey: entry.target.targetKey, displayPath: toDisplayPath(entry.target.targetKey, distro) },
    }));
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
   * Watching a 9p share is neither reliable nor cheap, so this provider refuses
   * rather than arming a watcher that may never fire — the seam's documented
   * failure mode for a provider that cannot watch.
   * @returns a rejection carrying `FS_IO_ERROR`.
   */
  watch() {
    return Promise.reject(new FsError("Filesystem watching is not supported over the WSL UNC share.", "FS_IO_ERROR"));
  }

  /**
   * Check the caller's mutation guard immediately before publication.
   * @param target - the resolved target.
   * @param expected - the write intent, or undefined for an unconditional write.
   * @param signal - optional cancellation.
   * @throws FsError with the same codes the host backend raises.
   */
  async assertGuard(target, expected, signal) {
    if (expected === undefined) return;
    const existing = await this.stat(target, signal);
    if (expected.kind === "replaceIfVersion") {
      if (existing === undefined) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, "FS_STALE_VERSION");
      if (existing.version !== expected.version) throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
      return;
    }
    if (expected.kind === "createIfAbsent" && existing !== undefined) {
      throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
    }
  }

  /**
   * Fence the write by the per-call policy, then keep the guard's observable
   * behaviour.
   * @param target - the resolved target.
   * @param content - the full new file content.
   * @param expected - the write intent.
   * @param signal - optional cancellation.
   * @param sandboxPolicy - the per-call mode and workspace root; omit for the
   *   deployment policy.
   * @returns the write outcome.
   */
  async writeText(target, content, expected, signal, sandboxPolicy) {
    // The fence runs first and its fresh target is the one checked and written,
    // so a refusal costs no I/O and cannot be raced by a swapped symlink.
    const fenced = await this.checkedTarget(target, sandboxPolicy);
    await this.assertGuard(fenced, expected, signal);
    // The guard is deliberately not forwarded: the host backend would publish a
    // guarded creation with a hard link, which this filesystem rejects. Once
    // past the guard, publication is the overridden `publish` (see the
    // constructor), not the inherited Windows one.
    return super.writeText(fenced, content, undefined, signal);
  }

  /**
   * Fence the edit by the same policy, keeping the guard's observable behaviour.
   * @param target - the resolved target.
   * @param edit - the literal search/replace request.
   * @param expected - the version guard.
   * @param signal - optional cancellation.
   * @param sandboxPolicy - the per-call mode and workspace root; omit for the
   *   deployment policy.
   * @returns the edit outcome.
   */
  async editText(target, edit, expected, signal, sandboxPolicy) {
    const fenced = await this.checkedTarget(target, sandboxPolicy);
    await this.assertGuard(fenced, expected, signal);
    return super.editText(fenced, edit, undefined, signal);
  }
}
