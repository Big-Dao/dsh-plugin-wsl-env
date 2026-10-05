/**
 * In-distro file watching for `WslFileSystem.watch`.
 *
 * A 9p share gives Node no usable change notification — chokidar over
 * `\\wsl.localhost` is the unreliability that made this provider refuse to
 * watch at all. The seam's contract, however, asks for far less than events:
 * `watch(target, changed, signal)` wants ONE invalidation callback, invoked
 * whenever something under `target` may have changed. That is cheap to honor
 * from inside the distro, where the kernel does know.
 *
 * The watcher is a long-lived `wsl.exe` shell loop: periodically
 * `find <dir> -newer <stamp>` — the directory itself is in the scan, so
 * creations AND deletions (which bump the parent's mtime) are both seen — and
 * one `C` line per hit. No `inotifywait` dependency; the mtime walk is exact
 * for interactive-paced edits, which is the only pace a session watch serves.
 *
 * The loop speaks three one-letter lines, the watcher protocol:
 *
 *   - `R` — READY: the activation barrier; the host resolves the watch promise
 *     on it, never before.
 *   - `C` — CHANGED: something under the target may have changed.
 *   - `E` — ERROR: the watched directory no longer exists, and the loop has
 *     exited. Without it a vanished target would sit armed forever — `find`
 *     over a missing directory prints nothing, indistinguishable from "no
 *     changes" — so the loop says so and the host reports it.
 *
 * Known blind spot, accepted and documented: a file created with an mtime
 * older than the stamp (`cp -p`, `tar -x`) is not seen until something else
 * touches the tree.
 *
 * This is a TypeScript source built to `lib/watcher.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/watcher
 */
import type { ChildProcess } from "node:child_process";
/**
 * The shell loop the watcher runs, parameterised by argv so no path can break
 * quoting: `$1` is the Linux directory, `$2` the poll interval in seconds.
 * Pure text, so it is unit-testable.
 *
 * @param intervalSeconds - poll cadence; must be >= 1.
 * @param maxDepth - bound the scan's depth, 1 = the directory
 *   itself and its direct children; 0 (the default) scans the whole tree,
 *   which is the contract's semantics but a real cost over a tree with a
 *   `node_modules` in it.
 * @returns the `sh -c` script body.
 */
export declare function watchLoopScript(intervalSeconds?: number, maxDepth?: number): string;
/**
 * Arm one in-distro watcher over a Linux directory.
 *
 * @param options - the watch request.
 * @returns resolves once observation is active, with the async close function
 *   the seam's contract asks for.
 */
export declare function armDistroWatcher({ wslPath, distro, linuxPath, onChange, onError, signal, intervalSeconds, maxDepth, spawn: spawnProcess }: {
    /** The `wsl.exe` path. */
    wslPath: string;
    /** The distro to watch inside. */
    distro: string;
    /** The absolute Linux path to observe. */
    linuxPath: string;
    /** Watcher-level failures (an exited loop, a vanished target); the seam reports these through its own channel. */
    onError?: (error: Error) => void;
    /** The invalidation callback. */
    onChange: () => void;
    /** Cancels initialization; the CALLER invokes the returned close to stop an armed watcher. */
    signal: AbortSignal;
    /** Poll cadence, default 2. */
    intervalSeconds?: number;
    /** Scan depth bound, 0 = the whole tree. */
    maxDepth?: number;
    /** Injectable process factory for tests. */
    spawn?: (wslPath: string, args: string[]) => ChildProcess;
}): Promise<() => Promise<void>>;
