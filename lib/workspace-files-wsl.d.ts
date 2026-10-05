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
export function distroList({ runner, distro, linuxRoot, path, maxEntries, signal }: {
    runner: import("./agent.js").WslAgent;
    distro: string;
    linuxRoot: string;
    path: string;
    maxEntries: number;
    signal?: AbortSignal | undefined;
}): Promise<{
    path: string;
    entries: {
        name: string;
        type: "file" | "directory";
        size?: number;
    }[];
    truncated: boolean;
}>;
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
export function distroStat({ runner, distro, linuxRoot, path, distroWorkspaceRoot, signal }: {
    runner: import("./agent.js").WslAgent;
    distro: string;
    linuxRoot: string;
    path: string;
    distroWorkspaceRoot: string;
    signal?: AbortSignal | undefined;
}): Promise<{
    absolutePath: string;
    version: string;
    bytes?: number;
}>;
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
export function distroRead({ runner, distro, linuxRoot, path, offset, limit, maxBytes, distroWorkspaceRoot, signal }: {
    runner: import("./agent.js").WslAgent;
    distro: string;
    linuxRoot: string;
    path: string;
    offset: number;
    limit: number;
    maxBytes: number;
    distroWorkspaceRoot: string;
    signal?: AbortSignal | undefined;
}): Promise<{
    absolutePath: string;
    version: string;
    bytes?: number;
    offset: number;
    text: string;
    lines: number;
    eof: boolean;
}>;
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
 * @param {number | undefined} [object.maxBytes] - the window's inclusive byte cap; undefined leaves the window uncapped.
 * @param {number} object.maxFileBytes - the complete-file cap.
 * @param {string} object.distroWorkspaceRoot - the UNC workspace root, for the
 *   absolutePath display form.
 * @param {AbortSignal} [object.signal] - caller cancellation.
 * @returns {Promise<{absolutePath: string, version: string, bytes?: number, offset: number, data: Uint8Array, eof: boolean}>}
 */
export function distroReadBytes({ runner, distro, linuxRoot, path, offset, length, maxBytes, maxFileBytes, distroWorkspaceRoot, signal }: {
    runner: import("./agent.js").WslAgent;
    distro: string;
    linuxRoot: string;
    path: string;
    offset: number | undefined;
    length: number | undefined;
    maxBytes?: number | undefined;
    maxFileBytes: number;
    distroWorkspaceRoot: string;
    signal?: AbortSignal | undefined;
}): Promise<{
    absolutePath: string;
    version: string;
    bytes?: number;
    offset: number;
    data: Uint8Array;
    eof: boolean;
}>;
/**
 * The distro-routed `workspace-files` service.
 */
export class WorkspaceFilesWsl extends WorkspaceFiles {
    /**
     * The agent runner for one distro; a hook tests substitute.
     *
     * @param {string} distro - the distro name.
     * @returns {import("./agent.js").WslAgent} the agent runner.
     */
    runnerFor(distro: string): import("./agent.js").WslAgent;
    /**
     * The distro coordinates of one workspace scope.
     *
     * @param {string} workspaceRoot - the scope's workspace root.
     * @returns {{distro: string, linuxRoot: string}} the distro and its workspace root in Linux form.
     */
    coords(workspaceRoot: string): {
        distro: string;
        linuxRoot: string;
    };
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
    readByteRange(workspaceFileScope: import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileScope, path: string, offset: number | undefined, length: number | undefined, signal: AbortSignal): Promise<import("@deepseek-ai/dsh-api-workspace-files").WorkspaceFileBytes>;
}
export default WorkspaceFilesWsl;
/**
 * This variant row's own validated config. The base class keeps `config`
 * private and its public seam exposes no configuration channel, while the
 * distro branch enforces the caps the row carries — so the read goes through
 * this one documented cast. The keys mirror this row's `config` in
 * `cordis.patch.yml`.
 */
export type WorkspaceFilesWslConfig = {
    /**
     * - the directory listing's entry cap.
     */
    maxEntries: number;
    /**
     * - the text read's line cap.
     */
    maxLines: number;
    /**
     * - the text read's byte cap.
     */
    maxBytes: number;
    /**
     * - the byte read's full-file cap.
     */
    maxFileBytes: number;
};
/**
 * One parsed distro directory listing. The route parser's own inference
 * widens the entry kind to `string`; the relay only ever emits the two wire
 * tokens below, and this is what the cast at the parse boundary restores.
 */
export type DistroListing = {
    entries: {
        name: string;
        type: "file" | "directory";
        size?: number;
    }[];
    truncated: boolean;
};
import { WorkspaceFiles } from "@deepseek-ai/dsh-api-workspace-files";
