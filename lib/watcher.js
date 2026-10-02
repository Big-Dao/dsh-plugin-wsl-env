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
 * Known blind spot, accepted and documented: a file created with an mtime
 * older than the stamp (`cp -p`, `tar -x`) is not seen until something else
 * touches the tree.
 *
 * @module dsh-plugin-wsl/watcher
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * The shell loop the watcher runs, parameterised by argv so no path can break
 * quoting: `$1` is the Linux directory, `$2` the poll interval in seconds.
 * Pure text, so it is unit-testable.
 * @param {number} [intervalSeconds] - poll cadence; must be >= 1.
 * @returns {string} the `sh -c` script body.
 */
export function watchLoopScript(intervalSeconds = 2) {
  const seconds = Math.max(1, Math.floor(intervalSeconds));
  // `find` lists the directory itself first: a child's creation or deletion
  // bumps the parent's mtime, so both edges are seen, not just modifications.
  return [
    'D="$1"',
    'S="${TMPDIR:-/tmp}/wsl-watch.$$.stamp"',
    'touch "$S"',
    // The READY line is the activation barrier: everything changed BEFORE it
    // predates the stamp, so the host must not resolve the watch promise until
    // it arrives — otherwise a write racing the first tick is invisible forever.
    'printf \'R\\n\'',
    // Check first, sleep second: a change made right after activation is seen
    // on the first cadence, not one cadence later.
    'while :; do',
    '  if [ -n "$(find "$D" -newer "$S" -print -quit 2>/dev/null)" ]; then',
    '    touch "$S"',
    '    printf \'C\\n\'',
    '  fi',
    `  sleep ${seconds}`,
    'done',
  ].join("\n");
}

/**
 * Arm one in-distro watcher over a Linux directory.
 *
 * @param {object} options - the watch request.
 * @param {string} options.wslPath - the `wsl.exe` path.
 * @param {string} options.distro - the distro to watch inside.
 * @param {string} options.linuxPath - the absolute Linux path to observe.
 * @param {(error: Error) => void} [options.onError] - watcher-level failures
 *   (an exited loop); the seam reports these through its own channel.
 * @param {() => void} options.onChange - the invalidation callback.
 * @param {AbortSignal} options.signal - cancels initialization; the CALLER
 *   invokes the returned close to stop an armed watcher.
 * @param {number} [options.intervalSeconds] - poll cadence, default 2.
 * @param {(wslPath: string, args: string[]) => import("node:child_process").ChildProcess} [options.spawn]
 *   injectable process factory for tests.
 * @returns {Promise<() => Promise<void>>} resolves once observation is active,
 *   with the async close function the seam's contract asks for.
 */
export function armDistroWatcher({ wslPath, distro, linuxPath, onChange, onError, signal, intervalSeconds = 2, spawn: spawnProcess }) {
  const doSpawn = spawnProcess ?? ((path, args) => spawn(path, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const child = doSpawn(wslPath, ["-d", distro, "--exec", "sh", "-c", watchLoopScript(intervalSeconds), "wsl-watch", linuxPath]);
    let settled = false;
    let closed = false;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (line === "R") {
        if (!settled && !signal?.aborted) {
          settled = true;
          resolve(close);
        }
        return;
      }
      if (line === "C") {
        onChange();
      }
    });
    const close = async () => {
      if (closed) return;
      closed = true;
      child.removeAllListeners("exit");
      lines.close();
      child.stdout.destroy();
      child.kill();
      await new Promise((resolveClose) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolveClose();
        child.once("exit", resolveClose);
      });
    };
    const fail = (error) => {
      if (settled) {
        onError?.(error);
        return;
      }
      settled = true;
      void close();
      reject(error);
    };
    signal?.addEventListener("abort", () => fail(signal.reason instanceof Error ? signal.reason : new Error("aborted")), { once: true });
    child.on("error", fail);
    child.on("exit", (code, signalName) => {
      if (!closed) fail(new Error(`distro watcher exited unexpectedly (code=${code} signal=${signalName ?? "none"})`));
    });

  });
}
