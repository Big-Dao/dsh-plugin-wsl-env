/**
 * The distro-routed `workspace-files` service: the GUI file tree and previews
 * for a `\\wsl.localhost\<distro>` workspace are served from inside the distro
 * through the resident agent, instead of Windows-side 9P walks.
 *
 * ## Route predicate
 *
 * Every override checks `scope.workspaceRoot` — a distro UNC routes
 * distro-side, a drive path calls `super` (host native, unchanged).
 * `changes` (the watch stream) always delegates to `super`: its feed rides
 * `ctx.fs.watch`, whose behaviour is today's on both workspace kinds.
 *
 * ## What the distro side reproduces
 *
 * The wire shapes of `dsh-api-workspace-files`: listings capped with a
 * `truncated` flag, stats of `{absolutePath, version, bytes?}`, line-paged
 * text with NUL and UTF-8 refusal and the byte-cap error, and byte windows
 * with EOF markers. Versions are synthesized from `stat` fields — opaque to
 * the client, which only compares them. `absolutePath` is synthesized in the
 * UNC form so the GUI's path display stays what it was on the host fs. Read
 * refuses a final-component symlink exactly like the upstream `locateFile`
 * lstat gate does; `list` follows one (matching its own symlink-through
 * rule).
 *
 * The distro operations are standalone functions over an injected runner, so
 * they are unit-testable with a fake agent; the class methods are thin
 * coordinate guards around them.
 *
 * @module dsh-plugin-wsl/workspace-files-wsl
 */

import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import { WorkspaceFiles } from "@deepseek-ai/dsh-api-workspace-files";
import { isDistroWorkspace, linuxJoin, listDistroArgv, parseDirListing, parseStatRecord, parseStatRecordFromStderr, pageArgv, statRecordArgv, bytesArgv } from "./workspace-files-route.js";
import { posixToUnc, uncToPosix } from "./paths.js";
import { sharedAgent } from "./agent-shared.js";

/**
 * This variant row's own validated config. The base class keeps `config`
 * private and its public seam exposes no configuration channel, while the
 * distro branch enforces the caps the row carries — so the read goes through
 * this one documented cast. The keys mirror this row's `config` in
 * `cordis.patch.yml`.
 *
 * @typedef {object} WorkspaceFilesWslConfig
 * @property {number} maxEntries - the directory listing's entry cap.
 * @property {number} maxLines - the text read's line cap.
 * @property {number} maxBytes - the text read's byte cap.
 * @property {number} maxFileBytes - the byte read's full-file cap.
 */

/**
 * @param {WorkspaceFiles} self
 * @returns {WorkspaceFilesWslConfig}
 */
function ownConfig(self) {
  return /** @type {WorkspaceFilesWslConfig} */ (/** @type {{config: unknown}} */ (/** @type {unknown} */ (self)).config);
}

/**
 * One parsed distro directory listing. The route parser's own inference
 * widens the entry kind to `string`; the relay only ever emits the two wire
 * tokens below, and this is what the cast at the parse boundary restores.
 *
 * @typedef {object} DistroListing
 * @property {{name: string, type: "file" | "directory", size?: number}[]} entries
 * @property {boolean} truncated
 */

/**
 * Throw the wire's not-found refusal.
 *
 * @param {string} path
 */
function notFound(path) {
  return new RemoteError("workspace-file/not-found", `no entry at "${path}"`, { path });
}

/**
 * Throw the wire's outside-workspace refusal.
 *
 * @param {string} path
 */
function outsideWorkspace(path) {
  return new RemoteError("workspace-file/outside-workspace", `"${path}" is outside the workspace`, { path });
}

/**
 * Throw the wire's not-directory refusal.
 *
 * @param {string} path
 * @param {"file" | "symlink" | "other"} kind
 */
function notDirectory(path, kind) {
  return new RemoteError("workspace-file/not-directory", `"${path}" is a ${kind}`, { path, kind });
}

/**
 * Throw the wire's not-regular-file refusal.
 *
 * @param {string} path
 * @param {"directory" | "symlink" | "other"} kind
 */
function notRegularFile(path, kind) {
  return new RemoteError("workspace-file/not-regular-file", `"${path}" is a ${kind}`, { path, kind });
}

/**
 * Throw the wire's too-large refusal.
 *
 * @param {string} path
 * @param {number} limit
 */
function tooLarge(path, limit) {
  return new RemoteError("workspace-file/too-large", `"${path}" exceeds the ${limit} byte full-file cap`, { path, limit });
}

/**
 * Throw the wire's not-text refusal.
 *
 * @param {string} path
 */
function notText(path) {
  return new RemoteError("workspace-file/not-text", `"${path}" is not UTF-8 text`, { path });
}

/**
 * List one distro directory through the runner.
 *
 * The agent argv confines the directory under the workspace root, refuses
 * non-directories, and emits one line per child — a trailing `/` marks a
 * directory (symlinks resolve through, broken links drop out, matching the
 * upstream child semantics).
 *
 * @param {object} object - the listing's inputs.
 * @param {import("./agent.js").WslAgent} object.runner - the agent-like runner (`exec`).
 * @param {string} object.distro - the distro name.
 * @param {string} object.linuxRoot - the workspace root in Linux form.
 * @param {string} object.path - the requested directory, any coordinate system.
 * @param {number} object.maxEntries - the entry cap.
 * @param {AbortSignal} [object.signal] - caller cancellation.
 * @returns {Promise<{path: string, entries: {name: string, type: "file" | "directory", size?: number}[], truncated: boolean}>}
 *   the listing, with `path` relative to the workspace root (empty for it).
 */
export async function distroList({ runner, distro, linuxRoot, path, maxEntries, signal }) {
  const linuxDir = linuxJoin(linuxRoot, path);
  const result = await runner.exec({
    cwd: "/",
    argv: listDistroArgv(linuxRoot, linuxDir, maxEntries),
    maxOutputBytes: 4_000_000,
    timeoutMs: 30_000,
    signal,
  });
  if (result.exitCode === 3) throw outsideWorkspace(path);
  // The exit-4 relay carries no kind, and the refusal's message reads back
  // `"x" is a directory` inside a not-directory refusal — the passed kind is
  // wrong. Fixing it honestly needs the relay to report what the entry IS; a
  // protocol decision, deliberately left visible.
  // @ts-expect-error — the wire's kind is unknown on exit 4; see above.
  if (result.exitCode === 4) throw notDirectory(path, "directory");
  if (result.exitCode === 2) throw notFound(path);
  if (result.exitCode !== 0) throw new Error(`listing "${linuxDir}" failed: ${String(result.stderr).trim() || `exit ${result.exitCode}`}`);
  const { entries, truncated } = /** @type {DistroListing} */ (parseDirListing(result.stdout, maxEntries));
  const relative = linuxDir === linuxRoot ? "" : linuxDir.slice(linuxRoot.length + 1);
  return { path: relative, entries, truncated };
}

/**
 * Stat one distro path through the runner.
 *
 * @param {object} object - the stat's inputs.
 * @param {import("./agent.js").WslAgent} object.runner - the agent-like runner (`exec`).
 * @param {string} object.distro - the distro name.
 * @param {string} object.linuxRoot - the workspace root in Linux form.
 * @param {string} object.path - the requested path, any coordinate system.
 * @param {string} object.distroWorkspaceRoot - the UNC workspace root, for the
 *   absolutePath display form.
 * @param {AbortSignal} [object.signal] - caller cancellation.
 * @returns {Promise<{absolutePath: string, version: string, bytes?: number}>}
 */
export async function distroStat({ runner, distro, linuxRoot, path, distroWorkspaceRoot, signal }) {
  const linuxFile = linuxJoin(linuxRoot, path);
  const result = await runner.exec({
    cwd: "/",
    argv: statRecordArgv(linuxFile),
    maxOutputBytes: 4096,
    timeoutMs: 30_000,
    signal,
  });
  if (result.exitCode !== 0) throw notFound(path);
  const record = parseStatRecord(result.stdout);
  const stat = { absolutePath: posixToUnc(distro, linuxFile), version: record.version };
  return record.size === undefined || Number.isNaN(record.size) ? stat : { ...stat, bytes: record.size };
}

/**
 * Read one line-paged UTF-8 window through the runner, mirroring the
 * upstream `cutPage` semantics: a NUL byte marks the page binary, a page
 * above the byte cap is refused (never shortened), and `eof` is false exactly
 * when a character exists past the page.
 *
 * @param {object} object - the read's inputs.
 * @param {import("./agent.js").WslAgent} object.runner - the agent-like runner (`exec`).
 * @param {string} object.distro - the distro name.
 * @param {string} object.linuxRoot - the workspace root in Linux form.
 * @param {string} object.path - the requested path, any coordinate system.
 * @param {number} object.offset - first line to return (1-based).
 * @param {number} object.limit - maximum lines to return.
 * @param {number} object.maxBytes - the page's byte cap.
 * @param {string} object.distroWorkspaceRoot - the UNC workspace root, for the
 *   absolutePath display form.
 * @param {AbortSignal} [object.signal] - caller cancellation.
 * @returns {Promise<{absolutePath: string, version: string, bytes?: number, offset: number, text: string, lines: number, eof: boolean}>}
 */
export async function distroRead({ runner, distro, linuxRoot, path, offset, limit, maxBytes, distroWorkspaceRoot, signal }) {
  const linuxFile = linuxJoin(linuxRoot, path);
  const result = await runner.exec({
    cwd: "/",
    argv: pageArgv(linuxFile, offset, limit),
    maxOutputBytes: (maxBytes + 1) * 4,
    timeoutMs: 60_000,
    signal,
  });
  if (result.exitCode === 2) throw notFound(path);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`reading "${linuxFile}" failed: ${String(result.stderr).trim() || `exit ${result.exitCode}`}`);
  }
  const record = parseStatRecordFromStderr(result.stderr);
  if (record === undefined) throw notFound(path);
  // The stat record's kind is whatever the distro named — a socket or a fifo
  // reaches this line too — and the refusal embeds it verbatim; the narrowed
  // parameter is the upstream wire's three-kind vocabulary.
  if (record.type !== "file") throw notRegularFile(path, /** @type {"directory" | "symlink" | "other"} */ (record.type));
  const raw = Buffer.from(result.stdout);
  const strict = new TextDecoder("utf-8", { fatal: true });
  let text;
  try {
    text = strict.decode(raw);
  } catch {
    throw notText(path);
  }
  const lines = text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const bytes = Buffer.byteLength(text, "utf8") + lines;
  if (bytes > maxBytes) {
    throw new RemoteError(
      "workspace-file/too-large",
      `lines ${offset}-${offset + limit - 1} of "${path}" exceed the ${maxBytes} byte cap`,
      { path, limit: maxBytes },
    );
  }
  if (text.includes(String.fromCharCode(0))) throw notText(path);
  const eof = lines < limit;
  const stat = { absolutePath: posixToUnc(distro, linuxFile), version: record.version };
  return { ...stat, offset, text, lines, eof };
}

/**
 * Read one byte window (or the capped whole file) through the runner.
 *
 * @param {object} object - the read's inputs.
 * @param {import("./agent.js").WslAgent} object.runner - the agent-like runner (`exec`).
 * @param {string} object.distro - the distro name.
 * @param {string} object.linuxRoot - the workspace root in Linux form.
 * @param {string} object.path - the requested path, any coordinate system.
 * @param {number|undefined} object.offset - byte offset (0-based).
 * @param {number|undefined} object.length - byte count.
 * @param {number | undefined} object.maxBytes - the window cap.
 * @param {number} object.maxFileBytes - the complete-file cap.
 * @param {string} object.distroWorkspaceRoot - the UNC workspace root, for the
 *   absolutePath display form.
 * @param {AbortSignal} [object.signal] - caller cancellation.
 * @returns {Promise<{absolutePath: string, version: string, bytes?: number, offset: number, data: Uint8Array, eof: boolean}>}
 */
export async function distroReadBytes({ runner, distro, linuxRoot, path, offset, length, maxFileBytes, distroWorkspaceRoot, signal }) {
  const linuxFile = linuxJoin(linuxRoot, path);
  // One exec carries both halves: the stat record on stderr (for the version,
  // the size, and the whole-file refusal), the window on stdout.
  const window = offset === undefined && length === undefined
    ? { offset: 0, length: maxFileBytes }
    : { offset: offset ?? 0, length: length ?? maxFileBytes };
  const result = await runner.exec({
    cwd: "/",
    argv: bytesArgv(linuxFile, window.offset, window.length),
    maxOutputBytes: window.length + 1024,
    timeoutMs: 60_000,
    signal,
  });
  const record = parseStatRecordFromStderr(result.stderr);
  if (record === undefined) throw notFound(path);
  // Same wire reality as the text read above: the kind is the distro's own
  // naming, embedded verbatim.
  if (record.type !== "file") throw notRegularFile(path, /** @type {"directory" | "symlink" | "other"} */ (record.type));
  const data = new Uint8Array(Buffer.from(result.stdout).subarray(0, window.length));
  // The whole-file form mirrors the upstream refusal: a file bigger than the
  // cap is refused, never silently truncated (the stderr record names the
  // real size even though head capped the stdout).
  if (offset === undefined && length === undefined && record.size > maxFileBytes) {
    throw tooLarge(path, maxFileBytes);
  }
  return {
    absolutePath: posixToUnc(distro, linuxFile),
    version: record.version,
    offset: window.offset,
    data,
    eof: window.offset + data.length >= record.size,
  };
}

/**
 * The distro-routed `workspace-files` service.
 */
export class WorkspaceFilesWsl extends WorkspaceFiles {
  static Config = WorkspaceFiles.Config;

  /**
   * The agent runner for one distro; a hook tests substitute.
   *
   * @param {string} distro - the distro name.
   * @returns {import("./agent.js").WslAgent} the agent runner.
   */
  runnerFor(distro) {
    return sharedAgent(distro);
  }

  /**
   * The distro coordinates of one workspace scope.
   *
   * @param {string} workspaceRoot - the scope's workspace root.
   * @returns {{distro: string, linuxRoot: string}} the distro and its workspace root in Linux form.
   */
  coords(workspaceRoot) {
    const parsed = uncToPosix(workspaceRoot);
    if (parsed === undefined) throw new Error(`"${workspaceRoot}" is not a distro workspace root`);
    return { distro: parsed.distro, linuxRoot: parsed.linuxPath.length > 0 ? parsed.linuxPath : "/" };
  }

  /**
   * List one workspace directory; distro UNC roots list inside the distro.
   *
   * @param {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileScope} workspaceFileScope - the Session's file scope.
   * @param {string} path - the directory to list.
   * @param {AbortSignal} signal - caller cancellation.
   * @returns {Promise<import("@deepseek-ai/dsh-api-workspace-files").WorkspaceDirectoryListing>}
   */
  async list(workspaceFileScope, path, signal) {
    if (!isDistroWorkspace(workspaceFileScope.workspaceRoot)) return super.list(workspaceFileScope, path, signal);
    const { distro, linuxRoot } = this.coords(workspaceFileScope.workspaceRoot);
    const { path: relative, entries, truncated } = await distroList({
      runner: this.runnerFor(distro),
      distro,
      linuxRoot,
      path,
      maxEntries: ownConfig(this).maxEntries,
      signal,
    });
    return {
      path: relative,
      entries: entries.map((entry) => entry.size === undefined ? entry : { ...entry, size: entry.size }),
      truncated,
    };
  }

  /**
   * Stat one workspace file; distro UNC roots stat inside the distro.
   *
   * @param {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileScope} workspaceFileScope - the Session's file scope.
   * @param {string} path - the file to stat.
   * @param {AbortSignal} signal - caller cancellation.
   * @returns {Promise<import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileStat>}
   */
  async stat(workspaceFileScope, path, signal) {
    if (!isDistroWorkspace(workspaceFileScope.workspaceRoot)) return super.stat(workspaceFileScope, path, signal);
    const { distro, linuxRoot } = this.coords(workspaceFileScope.workspaceRoot);
    return distroStat({ runner: this.runnerFor(distro), distro, linuxRoot, path, distroWorkspaceRoot: workspaceFileScope.workspaceRoot, signal });
  }

  /**
   * Read one line page; distro UNC roots read inside the distro.
   *
   * @param {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileScope} workspaceFileScope - the Session's file scope.
   * @param {string} path - the file to read.
   * @param {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileRange} range - the line window.
   * @param {AbortSignal} signal - caller cancellation.
   * @returns {Promise<import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileText>}
   */
  async read(workspaceFileScope, path, range, signal) {
    if (!isDistroWorkspace(workspaceFileScope.workspaceRoot)) return super.read(workspaceFileScope, path, range, signal);
    const { distro, linuxRoot } = this.coords(workspaceFileScope.workspaceRoot);
    const offset = range.offset === undefined ? 1 : range.offset;
    const limit = range.limit === undefined ? ownConfig(this).maxLines : range.limit;
    if (!Number.isSafeInteger(offset) || offset < 1) {
      throw new RemoteError("gateway/bad-request", "offset must be a safe integer of at least 1", {});
    }
    if (limit > ownConfig(this).maxLines) {
      throw new RemoteError("gateway/bad-request", `limit must be at most ${ownConfig(this).maxLines}`, {});
    }
    return distroRead({
      runner: this.runnerFor(distro),
      distro,
      linuxRoot,
      path,
      offset,
      limit,
      maxBytes: ownConfig(this).maxBytes,
      distroWorkspaceRoot: workspaceFileScope.workspaceRoot,
      signal,
    });
  }

  /**
   * Read one byte window or the complete file; distro UNC roots read inside
   * the distro.
   *
   * @param {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileScope} workspaceFileScope - the Session's file scope.
   * @param {string} path - the file to read.
   * @param {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceByteReadOptions} options - the byte window.
   * @param {AbortSignal} signal - caller cancellation.
   * @returns {Promise<import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileBytes>}
   */
  async readBytes(workspaceFileScope, path, options, signal) {
    if (!isDistroWorkspace(workspaceFileScope.workspaceRoot)) return super.readBytes(workspaceFileScope, path, options, signal);
    const { distro, linuxRoot } = this.coords(workspaceFileScope.workspaceRoot);
    return distroReadBytes({
      runner: this.runnerFor(distro),
      distro,
      linuxRoot,
      path,
      offset: options.range?.offset,
      length: options.range?.length,
      maxBytes: ownConfig(this).maxBytes,
      maxFileBytes: ownConfig(this).maxFileBytes,
      distroWorkspaceRoot: workspaceFileScope.workspaceRoot,
      signal,
    });
  }

  /**
   * Read one byte range by offset and length; distro UNC roots read inside
   * the distro.
   *
   * @param {import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileScope} workspaceFileScope - the Session's file scope.
   * @param {string} path - the file to read.
   * @param {number | undefined} offset - byte offset (0-based).
   * @param {number | undefined} length - byte count.
   * @param {AbortSignal} signal - caller cancellation.
   * @returns {Promise<import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileBytes>}
   */
  async readByteRange(workspaceFileScope, path, offset, length, signal) {
    // The base class has no readByteRange at all — this variant adds the byte
    // window — so the Windows-root fallback has nothing to fall back TO and
    // would TypeError if a host session ever reached it. Whether to implement
    // the host path or refuse it is an open design decision, left visible.
    // @ts-expect-error — no such base method; see above.
    if (!isDistroWorkspace(workspaceFileScope.workspaceRoot)) return super.readByteRange(workspaceFileScope, path, offset, length, signal);
    const { distro, linuxRoot } = this.coords(workspaceFileScope.workspaceRoot);
    return distroReadBytes({
      runner: this.runnerFor(distro),
      distro,
      linuxRoot,
      path,
      offset,
      length,
      maxBytes: length,
      maxFileBytes: Number.MAX_SAFE_INTEGER,
      distroWorkspaceRoot: workspaceFileScope.workspaceRoot,
      signal,
    });
  }
}

export default WorkspaceFilesWsl;
