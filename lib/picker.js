/**
 * WSL-aware directory picker: the `ctx.directoryPicker` backend that makes the
 * Web GUI's "Select Workspace Directory" dialog open inside a distro.
 *
 * ## Why this serves `kind: 'browse'` instead of declaring a `wsl` kind
 *
 * The seam's capability is a merge-extensible discriminated union, so adding a
 * `wsl` kind looks like the natural move. It does not work, and the reason is
 * worth stating plainly: the capability is **not** what crosses the wire.
 * `dsh-api-workspace-controller` exposes exactly three Remote verbs and pins
 * each to a literal kind —
 *
 *     pick(signal)             -> requireCapability('native', 'pick')
 *     list(path, signal)       -> requireCapability('browse', 'list')
 *     createDirectory(...)     -> requireCapability('browse', 'createDirectory')
 *
 * — and refuses anything else with `directory-picker/unavailable`. A backend
 * reporting `{ kind: 'wsl', ... }` would therefore break the very verbs it
 * needs, because `requireCapability('browse', ...)` would no longer match. The
 * wire vocabulary lives in a shipped, versioned package inside `app.asar`, so
 * adding a third kind means patching an asar package that the next app update
 * overwrites.
 *
 * Serving `browse` is not a workaround, it is the fit: `browse`'s primitives are
 * "list one absolute directory level" and "create one child directory", which is
 * exactly what browsing a distro needs. The only thing the shipped browse
 * backend lacks is *discoverability* of WSL — it opens at the Windows home
 * directory. This backend closes that gap:
 *
 *   - the root level lists the installed distros (`wsl.exe -l -q`), so WSL is
 *     the entry point rather than something you must know a UNC path for;
 *   - the breadcrumb "WSL" row jumps back to that distro list;
 *   - the dialog's Home affordance targets the preferred distro's Linux `$HOME`;
 *   - every other level inside a distro is listed BY THE DISTRO — the resident
 *     agent's `ls` when it is up, a one-shot `wsl.exe --exec ls` when it is
 *     out — because the host's own listing used to walk the 9p share in its
 *     slow direction, one metadata round trip per entry; a Windows path keeps
 *     the host's own walk, which is native there.
 *
 * Because the client surface is unchanged, this row composes with the **shipped**
 * `@deepseek-ai/dsh-client-ui-directory-picker-browse` dialog: no client code,
 * no wire change, no asar patch.
 *
 * @module dsh-plugin-wsl/picker
 */

import { mkdir, opendir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import z from "@deepseek-ai/schemastery";
import { DirectoryPicker, DirectoryPickerError } from "@deepseek-ai/dsh-host-directory-picker";
import { UNC_PROVIDER_ROOT, distroRoot, isProviderRoot, isWslUnc, uncToPosix } from "./paths.js";
import { breadcrumbs, boundedInsert, fullyQualified, lsListingArgv, parseLsListing } from "./listing.js";
import { listDistros, linuxHome, runCapture } from "./wsl.js";
import { sharedAgent } from "./agent-shared.js";
import { AgentUnavailableError } from "./agent-errors.js";

/** How long a resolved distro list stays fresh before it is queried again. */
const DEFAULT_DISTRO_CACHE_MS = 5_000;

/** One directory row, as the browse seam's client types define it. @typedef {import("@deepseek-ai/dsh-host-directory-picker").DirectoryEntry} DirectoryEntry */
/** One directory level plus its ancestry, as a browse backend reports it. @typedef {import("@deepseek-ai/dsh-host-directory-picker").DirectoryListing} DirectoryListing */
/** The browse interaction shape this backend reports through {@link WslDirectoryPicker#capability}. @typedef {import("@deepseek-ai/dsh-host-directory-picker").DirectoryPickerBrowseCapability} BrowseCapability */

/**
 * The resolved service configuration, as {@link WslDirectoryPicker.Config} yields.
 *
 * @typedef {object} PickerConfig
 * @property {string} wslPath - path to `wsl.exe`; overridable for a non-standard install.
 * @property {string} preferredDistro - distro listed first and used for the Home
 *   affordance; empty means WSL's own default distro.
 * @property {boolean} includeHostHome - whether the Windows home is also offered
 *   at the root level.
 * @property {number} maxEntries - bound on the directory rows one `list` call may
 *   return; the level is flagged truncated beyond it.
 * @property {number} distroCacheMs - how long a resolved distro list stays fresh.
 */

/**
 * Await `operation`, but reject with the signal's reason the moment it aborts.
 * Node's filesystem reads are not retractable, so the operation itself keeps
 * running against a handle the caller then closes; its late settlement is
 * swallowed so an abandoned read cannot surface as an unhandled rejection.
 *
 * @template T
 * @param {Promise<T>} operation - the in-flight filesystem step.
 * @param {AbortSignal} [signal] - caller lifetime; absent means plain awaiting.
 * @returns {Promise<T>} the operation's value.
 */
export function raceAbort(operation, signal) {
  if (signal === void 0) return operation;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      operation.catch(() => {});
      reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (reason) => {
        signal.removeEventListener("abort", onAbort);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
  });
}

/**
 * Message text of an unknown thrown value.
 * @param {unknown} error - the thrown value.
 * @returns {string} its message text.
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One listing row for a dirent, following symlinks to directories; null for
 * non-directories and broken or cyclic links, which cannot be entered.
 *
 * @param {string} parent - the directory being listed.
 * @param {string} name - the dirent's base name.
 * @param {boolean} isDirectory - whether the dirent reports a directory.
 * @param {boolean} isSymbolicLink - whether the dirent is a symlink.
 * @param {AbortSignal} [signal] - caller lifetime.
 * @returns {Promise<DirectoryEntry | null>} the row, or null when unenterable.
 */
async function directoryRow(parent, name, isDirectory, isSymbolicLink, signal) {
  const path = join(parent, name);
  let enterable = isDirectory;
  if (!enterable && isSymbolicLink) {
    try {
      enterable = (await raceAbort(stat(path), signal)).isDirectory();
    } catch {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));
      return null;
    }
  }
  if (!enterable) return null;
  return { name, path, hidden: name.startsWith(".") };
}

/**
 * The `ctx.directoryPicker` WSL implementation.
 *
 * The capability object is built once per service lifetime because consumers may
 * capture it across calls.
 */
export class WslDirectoryPicker extends DirectoryPicker {
  static Config = z.object({
    /** Path to `wsl.exe`; overridable for a non-standard install. */
    wslPath: z.string().default("wsl.exe"),
    /**
     * Distro listed first and used for the Home affordance. Empty means WSL's
     * own default distro.
     */
    preferredDistro: z.string().default(""),
    /**
     * Also offer the Windows home directory at the root level, so a normal
     * host folder stays reachable without typing a path. The dialog's editable
     * path zone accepts any Windows path either way.
     */
    includeHostHome: z.boolean().default(true),
    /** Bound on the directory rows one `list` call may return; the level is flagged truncated. */
    maxEntries: z.natural().min(1).default(1_000),
    /** How long a resolved distro list stays fresh. */
    distroCacheMs: z.natural().default(DEFAULT_DISTRO_CACHE_MS),
  });

  /**
   * @param {import("@deepseek-ai/cordis").Context} ctx - the owning context.
   * @param {PickerConfig} config - the resolved {@link WslDirectoryPicker.Config}.
   */
  constructor(ctx, config) {
    super(ctx);
    this.config = config;
    /** Last distro listing, so navigating to the root does not spawn `wsl.exe` every time. */
    this.distroCache = undefined;
    /** Per-distro Linux home, resolved once (a distro's default user does not change under a running session). */
    this.homeCache = new Map();
  }

  /**
   * The browse interaction capability.
   *
   * Deliberately `browse` and not a `wsl` kind: see the module comment. The
   * distro listing is exposed as {@link WslDirectoryPicker.distros} for
   * programmatic callers instead of through the capability union, because a
   * capability kind the wire controller does not recognise would disable the
   * verbs above rather than add a new one.
   *
   * @returns {BrowseCapability} the stable `browse` capability object.
   */
  capability() {
    return this.browseCapability;
  }

  /** @type {BrowseCapability} */
  browseCapability = {
    kind: "browse",
    list: (path, signal) => this.list(path, signal),
    createDirectory: (path, name) => this.createDirectory(path, name),
  };

  /**
   * Installed distros, cached briefly.
   * @param {AbortSignal} [signal] - optional cancellation.
   * @returns {Promise<string[]>} distro names, default distro first.
   */
  async distros(signal) {
    const ttl = this.config.distroCacheMs;
    const now = Date.now();
    if (this.distroCache !== undefined && now - this.distroCache.at < ttl) return this.distroCache.value;
    const value = await listDistros({ wslPath: this.config.wslPath, signal });
    this.distroCache = { at: now, value };
    return value;
  }

  /**
   * The distro this picker leads with: the configured one when installed, else
   * WSL's default, else the first installed.
   * @param {AbortSignal} [signal] - optional cancellation.
   * @returns {Promise<string>} a distro name, or empty when none is installed.
   */
  async preferredDistro(signal) {
    const distros = await this.distros(signal);
    const configured = this.config.preferredDistro;
    if (configured.length > 0 && distros.includes(configured)) return configured;
    return distros[0] ?? "";
  }

  /**
   * A distro's Linux home directory as a UNC path, best effort: a distro that
   * cannot be queried (stopped, and unable to start) falls back to its root so
   * the dialog still opens somewhere real.
   *
   * @param {string} distro - distro name.
   * @param {AbortSignal} [signal] - optional cancellation.
   * @returns {Promise<string>} the UNC home path.
   */
  async homeOf(distro, signal) {
    const cached = this.homeCache.get(distro);
    if (cached !== undefined) return cached;
    let home;
    try {
      home = await linuxHome(distro, { wslPath: this.config.wslPath, signal });
    } catch {
      home = distroRoot(distro);
    }
    this.homeCache.set(distro, home);
    return home;
  }

  /**
   * The root level: one row per installed distro, plus the Windows home when
   * configured. `path` is the preferred distro's root rather than the share
   * root, so adopting the level with nothing selected still yields a real
   * directory; the breadcrumb's "WSL" row carries the share root and returns
   * here.
   *
   * @param {AbortSignal} [signal] - optional cancellation.
   * @returns {Promise<DirectoryListing>} the root listing.
   */
  async rootLevel(signal) {
    const distros = await this.distros(signal);
    const preferred = await this.preferredDistro(signal);
    const entries = [];
    if (this.config.includeHostHome) {
      const hostHome = homedir();
      entries.push({ name: hostHome, path: hostHome, hidden: false });
    }
    for (const distro of distros) entries.push({ name: distro, path: distroRoot(distro), hidden: false });
    const home = preferred.length > 0 ? await this.homeOf(preferred, signal) : homedir();
    return {
      path: preferred.length > 0 ? distroRoot(preferred) : homedir(),
      home,
      crumbs: [{ name: "WSL", path: UNC_PROVIDER_ROOT, hidden: false }],
      entries,
      truncated: false,
    };
  }

  /**
   * Breadcrumb rows for a level, headed by the WSL row.
   * @param {string} target - the directory being listed.
   * @returns {DirectoryEntry[]} breadcrumb rows.
   */
  crumbsFor(target) {
    return breadcrumbs(target, UNC_PROVIDER_ROOT);
  }

  /**
   * List one directory level.
   * @param {string} [path] - absolute directory; absent or the share root lists the distros.
   * @param {AbortSignal} [signal] - caller lifetime.
   * @returns {Promise<DirectoryListing>} the level's listing with its ancestry.
   * @throws DirectoryPickerError with code `directory-unreadable`.
   */
  async list(path, signal) {
    if (path === void 0 || isProviderRoot(path)) return this.rootLevel(signal);
    if (!fullyQualified(path)) {
      throw new DirectoryPickerError("directory-unreadable", path, `cannot list "${path}": not a fully qualified path`);
    }
    const target = resolve(path);
    const preferred = await this.preferredDistro(signal);
    const level = isWslUnc(target) ? await this.listDistroLevel(target, signal) : await this.listHostLevel(target, signal);
    return {
      path: target,
      home: preferred.length > 0 ? await this.homeOf(preferred, signal) : homedir(),
      crumbs: this.crumbsFor(target),
      entries: level.rows,
      truncated: level.truncated,
    };
  }

  /**
   * List one level inside the distro, where the files live.
   *
   * The resident agent answers in one round trip; when it is out — distro
   * stopped, or the resident's rebuild budget spent — the same `ls` runs
   * through a one-shot `wsl.exe`. Neither path touches the 9p share, which is
   * what the host walk it replaces used: one metadata round trip per entry,
   * in the share's slow direction, plus one more per symlink.
   *
   * @param {string} target - the absolute UNC directory to list.
   * @param {AbortSignal} [signal] - caller lifetime.
   * @returns {Promise<{rows: DirectoryEntry[], truncated: boolean}>} the level's
   *   rows and truncation flag.
   * @throws DirectoryPickerError with code `directory-unreadable`.
   */
  async listDistroLevel(target, signal) {
    // The only caller gates on `isWslUnc`, so the parse cannot miss.
    const parsed = /** @type {import("./paths.js").DistroPath} */ (uncToPosix(target));
    const linuxDir = parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
    let stdout;
    try {
      const result = await sharedAgent(parsed.distro).exec({
        cwd: linuxDir,
        argv: lsListingArgv(linuxDir),
        timeoutMs: 15_000,
        signal,
      });
      if (result.exitCode !== 0) {
        const detail = result.stderr.toString("utf8").trim();
        throw new DirectoryPickerError(
          "directory-unreadable",
          target,
          `cannot list ${target}: ${detail.length > 0 ? detail : `ls exited ${result.exitCode}`}`,
        );
      }
      stdout = result.stdout;
    } catch (error) {
      if (!(error instanceof AgentUnavailableError)) throw error;
      try {
        stdout = await runCapture(
          [this.config.wslPath, "-d", parsed.distro, "--cd", linuxDir, "--exec", ...lsListingArgv(linuxDir)],
          signal,
        );
      } catch (fallbackError) {
        throw new DirectoryPickerError("directory-unreadable", target, `cannot list ${target}: ${messageOf(fallbackError)}`);
      }
    }
    return parseLsListing(stdout, target, this.config.maxEntries);
  }

  /**
   * List one Windows level with the host's own walk — native I/O on a native
   * filesystem, unchanged from the shipped browse behaviour.
   * @param {string} target - the absolute Windows directory to list.
   * @param {AbortSignal} [signal] - caller lifetime.
   * @returns {Promise<{rows: DirectoryEntry[], truncated: boolean}>} the level's
   *   rows and truncation flag.
   * @throws DirectoryPickerError with code `directory-unreadable`.
   */
  async listHostLevel(target, signal) {
    const maxEntries = this.config.maxEntries;
    const keep = maxEntries + 1;
    /** @type {{name: string, isDirectory: boolean, isSymbolicLink: boolean}[]} */
    const window = [];
    let evicted = false;
    let level;
    try {
      const opening = opendir(target);
      level = await raceAbort(opening, signal).catch((error) => {
        opening.then((dir) => dir.close().catch(() => {}), () => {});
        throw error;
      });
      for (;;) {
        const dirent = await raceAbort(level.read(), signal);
        if (dirent === null) break;
        if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
        if (boundedInsert(window, { name: dirent.name, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() }, keep)) {
          evicted = true;
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      throw new DirectoryPickerError("directory-unreadable", target, `cannot list ${target}: ${messageOf(error)}`);
    } finally {
      if (level !== undefined) await level.close().catch(() => {});
    }

    const rows = [];
    let truncated = evicted;
    for (const candidate of window) {
      signal?.throwIfAborted();
      const row = await directoryRow(target, candidate.name, candidate.isDirectory, candidate.isSymbolicLink, signal);
      if (row === null) continue;
      if (rows.length === maxEntries) {
        truncated = true;
        break;
      }
      rows.push(row);
    }
    return { rows, truncated };
  }

  /**
   * Create one child directory inside the listed level.
   * @param {string} path - absolute existing parent directory.
   * @param {string} name - single non-blank path segment.
   * @returns {Promise<string>} the created directory's absolute path.
   * @throws DirectoryPickerError with code `directory-exists` or `directory-create-failed`.
   */
  async createDirectory(path, name) {
    if (!fullyQualified(path)) {
      throw new DirectoryPickerError("directory-create-failed", path, `cannot create under "${path}": not a fully qualified parent path`);
    }
    const parent = resolve(path);
    if (name.trim() === "" || name === "." || name === ".." || /[/\\]/.test(name)) {
      throw new DirectoryPickerError("directory-create-failed", join(parent, name), `"${name}" is not a single path segment`);
    }
    const target = join(parent, name);
    if (isWslUnc(parent)) return this.createDistroDirectory(parent, name, target);
    try {
      await mkdir(target);
      return target;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
        throw new DirectoryPickerError("directory-exists", target, `${target} already exists`);
      }
      throw new DirectoryPickerError("directory-create-failed", target, `cannot create ${target}: ${messageOf(error)}`);
    }
  }

  /**
   * Create one child directory inside the distro — the resident agent's
   * `mkdir` when it is up, a one-shot `wsl.exe --exec mkdir` when it is out;
   * the host's `mkdir` over the 9p share is what this replaces.
   *
   * @param {string} parent - the absolute UNC parent directory.
   * @param {string} name - the validated single path segment to create.
   * @param {string} target - the UNC path the caller receives on success.
   * @returns {Promise<string>} the created directory's absolute path.
   * @throws DirectoryPickerError with code `directory-exists` or `directory-create-failed`.
   */
  async createDistroDirectory(parent, name, target) {
    // The only caller gates on `isWslUnc`, so the parse cannot miss.
    const parsed = /** @type {import("./paths.js").DistroPath} */ (uncToPosix(parent));
    const linuxParent = parsed.linuxPath.length > 0 ? parsed.linuxPath : "/";
    try {
      const result = await sharedAgent(parsed.distro).exec({ cwd: linuxParent, argv: ["mkdir", "--", name], timeoutMs: 10_000 });
      if (result.exitCode === 0) return target;
      const detail = result.stderr.toString("utf8");
      if (/File exists/i.test(detail)) throw new DirectoryPickerError("directory-exists", target, `${target} already exists`);
      throw new DirectoryPickerError(
        "directory-create-failed",
        target,
        `cannot create ${target}: ${detail.trim().length > 0 ? detail.trim() : `mkdir exited ${result.exitCode}`}`,
      );
    } catch (error) {
      if (error instanceof DirectoryPickerError) throw error;
      if (!(error instanceof AgentUnavailableError)) throw error;
      try {
        await runCapture([this.config.wslPath, "-d", parsed.distro, "--cd", linuxParent, "--exec", "mkdir", "--", name]);
        return target;
      } catch (fallbackError) {
        const message = messageOf(fallbackError);
        if (/File exists/i.test(message)) throw new DirectoryPickerError("directory-exists", target, `${target} already exists`);
        throw new DirectoryPickerError("directory-create-failed", target, `cannot create ${target}: ${message}`);
      }
    }
  }
}

export default WslDirectoryPicker;
export { ancestryCrumbs, boundedInsert, breadcrumbs, fullyQualified } from "./listing.js";
