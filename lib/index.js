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
import { LocalBashExecutor, ENV_OVERRIDES } from "@deepseek-ai/dsh-bash-local";
import { LocalFileSystem } from "@deepseek-ai/dsh-fs-local";
import { FsError } from "@deepseek-ai/dsh-fs";
import { isWslUnc, isUnderDistro, posixToUnc, toDisplayPath, toLinuxPath, toWorldPath, uncToPosix } from "./paths.js";
// `runCapture` and distro discovery live in ./wsl.js so the directory picker
// can use them without pulling this file's executor and filesystem peers in.
import { canonicalLinuxPath, copyModeInDistro, defaultDistro, defaultShell, shellArgs } from "./wsl.js";

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
 * Bash executor that runs every command inside a WSL distro.
 *
 * Extends the unconfined `LocalBashExecutor`, so command defaulting, deadline
 * handling, output caps, spill files and background-process management are the
 * shipped implementation's; this subclass replaces only the argv (prefix with
 * `wsl.exe`) and the process working directory (wsl.exe must be started from a
 * Windows directory, while the Linux directory rides on `--cd`).
 */
export class WslShellExecutor extends LocalBashExecutor {
  static inject = ["subprocess"];

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
    /** Default workdir; accepts `/home/andy/proj`, a UNC path, or `C:\...`. */
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
   * Build the `wsl.exe` argv for one resolved spec. The command string is
   * passed as a single argv element to the resolved shell, so there is no
   * quoting layer of our own; Node's argv array reaches `wsl.exe` verbatim.
   *
   * `--exec` is load-bearing — see the comment inside.
   *
   * @param spec - the resolved spec from {@link LocalBashExecutor.resolve}.
   * @param distro - the resolved distro name.
   * @returns the argv to spawn.
   */
  argv(spec, distro, shell) {
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
      shell,
      ...shellArgs(shell, this.config.loginShell),
      spec.command,
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
   * Execute one resolved spec inside the distro.
   * @param spec - resolved execution settings.
   * @returns the live shell process handle.
   */
  async execute(spec) {
    const distro = await this.distro();
    const shell = await this.shell();
    // Preparation is async, so it runs under executeArgv's deadline and
    // cancellation handling rather than before them.
    return this.executeArgv(spec, () => this.argv(spec, distro, shell));
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
  static Config = z.object({
    /** Distro name; empty resolves WSL's default on first use. */
    distro: z.string().default(""),
    /** Default workdir; accepts a Linux path, a UNC path, or `C:\...`. */
    cwd: z.string().default(process.cwd()),
    /** Path to `wsl.exe`, used only to resolve the default distro. */
    wslPath: z.string().default("wsl.exe"),
    /** UTF-8 byte limit per overwrite-diff side, mirroring the host backend. */
    diffBasisMaxBytes: z.number().default(10 * 1024 * 1024),
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
    const world = toWorldPath(path, { distro, cwd: cwd ?? this.config.cwd });
    if (this.config.restrictToDistro && isWslUnc(world) && !isUnderDistro(world, distro)) {
      throw new FsError(`"${path}" is outside distro "${distro}"`, "FS_SANDBOX_DENIED");
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
   * Write through the rename-based publication the share supports, keeping the
   * guard's observable behaviour.
   * @param target - the resolved target.
   * @param content - the full new file content.
   * @param expected - the write intent.
   * @param signal - optional cancellation.
   * @returns the write outcome.
   */
  async writeText(target, content, expected, signal) {
    await this.assertGuard(target, expected, signal);
    // The guard is deliberately not forwarded: the host backend would publish a
    // guarded creation with a hard link, which this filesystem rejects. Once
    // past the guard, publication is the overridden `publish` (see the
    // constructor), not the inherited Windows one.
    return super.writeText(target, content, undefined, signal);
  }

  /**
   * Edit through the same publication, keeping the guard's observable behaviour.
   * @param target - the resolved target.
   * @param edit - the literal search/replace request.
   * @param expected - the version guard.
   * @param signal - optional cancellation.
   * @returns the edit outcome.
   */
  async editText(target, edit, expected, signal) {
    await this.assertGuard(target, expected, signal);
    return super.editText(target, edit, undefined, signal);
  }
}

export { isWslUnc, toDisplayPath, toLinuxPath, toWorldPath };
export { defaultDistro, linuxHome, listDistros, runInDistro } from "./wsl.js";
