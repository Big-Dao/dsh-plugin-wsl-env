/**
 * The shell loop the watcher runs, parameterised by argv so no path can break
 * quoting: `$1` is the Linux directory, `$2` the poll interval in seconds.
 * Pure text, so it is unit-testable.
 * @param {number} [intervalSeconds] - poll cadence; must be >= 1.
 * @param {number} [maxDepth] - bound the scan's depth, 1 = the directory
 *   itself and its direct children; 0 (the default) scans the whole tree,
 *   which is the contract's semantics but a real cost over a tree with a
 *   `node_modules` in it.
 * @returns {string} the `sh -c` script body.
 */
export function watchLoopScript(intervalSeconds?: number, maxDepth?: number): string;
/**
 * Arm one in-distro watcher over a Linux directory.
 *
 * @param {object} options - the watch request.
 * @param {string} options.wslPath - the `wsl.exe` path.
 * @param {string} options.distro - the distro to watch inside.
 * @param {string} options.linuxPath - the absolute Linux path to observe.
 * @param {(error: Error) => void} [options.onError] - watcher-level failures
 *   (an exited loop, a vanished target); the seam reports these through its
 *   own channel.
 * @param {() => void} options.onChange - the invalidation callback.
 * @param {AbortSignal} options.signal - cancels initialization; the CALLER
 *   invokes the returned close to stop an armed watcher.
 * @param {number} [options.intervalSeconds] - poll cadence, default 2.
 * @param {number} [options.maxDepth] - scan depth bound, 0 = the whole tree.
 * @param {(wslPath: string, args: string[]) => import("node:child_process").ChildProcess} [options.spawn]
 *   injectable process factory for tests.
 * @returns {Promise<() => Promise<void>>} resolves once observation is active,
 *   with the async close function the seam's contract asks for.
 */
export function armDistroWatcher({ wslPath, distro, linuxPath, onChange, onError, signal, intervalSeconds, maxDepth, spawn: spawnProcess }: {
    wslPath: string;
    distro: string;
    linuxPath: string;
    onError?: ((error: Error) => void) | undefined;
    onChange: () => void;
    signal: AbortSignal;
    intervalSeconds?: number | undefined;
    maxDepth?: number | undefined;
    spawn?: ((wslPath: string, args: string[]) => import("node:child_process").ChildProcess) | undefined;
}): Promise<() => Promise<void>>;
