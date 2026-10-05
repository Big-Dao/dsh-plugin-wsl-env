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
 * This is a TypeScript source built to `lib/workspace-files-wsl.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/workspace-files-wsl
 */
import { WorkspaceFiles } from "@deepseek-ai/dsh-api-workspace-files";
import type { WorkspaceByteReadOptions, WorkspaceDirectoryListing, WorkspaceFileBytes, WorkspaceFileRange, WorkspaceFileScope, WorkspaceFileStat, WorkspaceFileText } from "@deepseek-ai/dsh-api-workspace-files";
import type { WslAgent } from "./agent.js";
/**
 * This variant row's own validated config. The base class keeps `config`
 * private and its public seam exposes no configuration channel, while the
 * distro branch enforces the caps the row carries — so the read goes through
 * this one documented cast. The keys mirror this row's `config` in
 * `cordis.patch.yml`.
 */
export interface WorkspaceFilesWslConfig {
    /** The directory listing's entry cap. */
    maxEntries: number;
    /** The text read's line cap. */
    maxLines: number;
    /** The text read's byte cap. */
    maxBytes: number;
    /** The byte read's full-file cap. */
    maxFileBytes: number;
}
/**
 * One parsed distro directory listing. The route parser's own inference
 * widens the entry kind to `string`; the relay only ever emits the two wire
 * tokens below, and this is what the cast at the parse boundary restores.
 */
export interface DistroListing {
    /** The level's child entries. */
    entries: Array<{
        name: string;
        type: "file" | "directory";
        size?: number;
    }>;
    /** Whether the level had more entries than the cap. */
    truncated: boolean;
}
/**
 * List one distro directory through the runner.
 *
 * The agent argv confines the directory under the workspace root, refuses
 * non-directories, and emits one line per child — a trailing `/` marks a
 * directory (symlinks resolve through, broken links drop out, matching the
 * upstream child semantics).
 *
 * @param object - the listing's inputs.
 * @returns the listing, with `path` relative to the workspace root (empty for it).
 */
export declare function distroList({ runner, distro, linuxRoot, path, maxEntries, signal }: {
    /** The agent-like runner (`exec`). */
    runner: WslAgent;
    /** The distro name. */
    distro: string;
    /** The workspace root in Linux form. */
    linuxRoot: string;
    /** The requested directory, any coordinate system. */
    path: string;
    /** The entry cap. */
    maxEntries: number;
    /** Caller cancellation. */
    signal?: AbortSignal;
}): Promise<{
    path: string;
    entries: Array<{
        name: string;
        type: "file" | "directory";
        size?: number;
    }>;
    truncated: boolean;
}>;
/**
 * Stat one distro path through the runner.
 *
 * @param object - the stat's inputs.
 * @returns the wire stat row.
 */
export declare function distroStat({ runner, distro, linuxRoot, path, distroWorkspaceRoot, signal }: {
    /** The agent-like runner (`exec`). */
    runner: WslAgent;
    /** The distro name. */
    distro: string;
    /** The workspace root in Linux form. */
    linuxRoot: string;
    /** The requested path, any coordinate system. */
    path: string;
    /** The UNC workspace root, for the absolutePath display form. */
    distroWorkspaceRoot: string;
    /** Caller cancellation. */
    signal?: AbortSignal;
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
 * @param object - the read's inputs.
 * @returns the wire text page.
 */
export declare function distroRead({ runner, distro, linuxRoot, path, offset, limit, maxBytes, distroWorkspaceRoot, signal }: {
    /** The agent-like runner (`exec`). */
    runner: WslAgent;
    /** The distro name. */
    distro: string;
    /** The workspace root in Linux form. */
    linuxRoot: string;
    /** The requested path, any coordinate system. */
    path: string;
    /** First line to return (1-based). */
    offset: number;
    /** Maximum lines to return. */
    limit: number;
    /** The page's byte cap. */
    maxBytes: number;
    /** The UNC workspace root, for the absolutePath display form. */
    distroWorkspaceRoot: string;
    /** Caller cancellation. */
    signal?: AbortSignal;
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
 * @param object - the read's inputs.
 * @returns the wire byte read.
 */
export declare function distroReadBytes({ runner, distro, linuxRoot, path, offset, length, maxBytes, maxFileBytes, distroWorkspaceRoot, signal }: {
    /** The agent-like runner (`exec`). */
    runner: WslAgent;
    /** The distro name. */
    distro: string;
    /** The workspace root in Linux form. */
    linuxRoot: string;
    /** The requested path, any coordinate system. */
    path: string;
    /** Byte offset (0-based). */
    offset: number | undefined;
    /** Byte count. */
    length: number | undefined;
    /** The window's inclusive byte cap; undefined leaves the window uncapped. */
    maxBytes?: number | undefined;
    /** The complete-file cap. */
    maxFileBytes: number;
    /** The UNC workspace root, for the absolutePath display form. */
    distroWorkspaceRoot: string;
    /** Caller cancellation. */
    signal?: AbortSignal;
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
export declare class WorkspaceFilesWsl extends WorkspaceFiles {
    static Config: import("@deepseek-ai/schemastery").default<import("@deepseek-ai/dsh-api-workspace-files").Config>;
    /**
     * The agent runner for one distro; a hook tests substitute.
     *
     * @param distro - the distro name.
     * @returns the agent runner.
     */
    runnerFor(distro: string): WslAgent;
    /**
     * The distro coordinates of one workspace scope.
     *
     * @param workspaceRoot - the scope's workspace root.
     * @returns the distro and its workspace root in Linux form.
     */
    coords(workspaceRoot: string): {
        distro: string;
        linuxRoot: string;
    };
    /**
     * List one workspace directory; distro UNC roots list inside the distro.
     *
     * @param workspaceFileScope - the Session's file scope.
     * @param path - the directory to list.
     * @param signal - caller cancellation.
     */
    list(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceDirectoryListing>;
    /**
     * Stat one workspace file; distro UNC roots stat inside the distro.
     *
     * @param workspaceFileScope - the Session's file scope.
     * @param path - the file to stat.
     * @param signal - caller cancellation.
     */
    stat(workspaceFileScope: WorkspaceFileScope, path: string, signal: AbortSignal): Promise<WorkspaceFileStat>;
    /**
     * Read one line page; distro UNC roots read inside the distro.
     *
     * @param workspaceFileScope - the Session's file scope.
     * @param path - the file to read.
     * @param range - the line window.
     * @param signal - caller cancellation.
     */
    read(workspaceFileScope: WorkspaceFileScope, path: string, range: WorkspaceFileRange, signal: AbortSignal): Promise<WorkspaceFileText>;
    /**
     * Read one byte window or the complete file; distro UNC roots read inside
     * the distro.
     *
     * @param workspaceFileScope - the Session's file scope.
     * @param path - the file to read.
     * @param options - the byte window.
     * @param signal - caller cancellation.
     */
    readBytes(workspaceFileScope: WorkspaceFileScope, path: string, options: WorkspaceByteReadOptions, signal: AbortSignal): Promise<WorkspaceFileBytes>;
    /**
     * Read one byte range by offset and length; distro UNC roots read inside
     * the distro.
     *
     * @param workspaceFileScope - the Session's file scope.
     * @param path - the file to read.
     * @param offset - byte offset (0-based).
     * @param length - byte count.
     * @param signal - caller cancellation.
     */
    readByteRange(workspaceFileScope: WorkspaceFileScope, path: string, offset: number | undefined, length: number | undefined, signal: AbortSignal): Promise<WorkspaceFileBytes>;
}
export default WorkspaceFilesWsl;
