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
 * @module dsh-plugin-wsl/watcher
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

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
export function watchLoopScript(intervalSeconds = 2, maxDepth = 0) {
  const seconds = Math.max(1, Math.floor(intervalSeconds));
  const depth = Number.isInteger(maxDepth) && maxDepth >= 1 ? maxDepth : 0;
  // A bounded walk puts `-maxdepth` directly after the path, where every find
  // that supports it (GNU, BusyBox, BSD) accepts it as a global option.
  const depthArgs = depth > 0 ? ` -maxdepth ${depth}` : "";
  // `find` lists the directory itself first: a child's creation or deletion
  // bumps the parent's mtime, so both edges are seen, not just modifications.
  return [
    'D="$1"',
    'S="${TMPDIR:-/tmp}/wsl-watch.$$.stamp"',
    'touch "$S"',
    // The stamp is the loop's private state, so every way out removes it. The
    // EXIT trap covers plain exits; a signal alone would end the shell WITHOUT
    // running it, so TERM/INT/HUP are trapped to a plain exit first.
    "trap 'rm -f \"$S\"' EXIT",
    "trap 'exit 0' TERM INT HUP",
    // The READY line is the activation barrier: everything changed BEFORE it
    // predates the stamp, so the host must not resolve the watch promise until
    // it arrives — otherwise a write racing the first tick is invisible forever.
    "printf 'R\\n'",
    // Check first, sleep second: a change made right after activation is seen
    // on the first cadence, not one cadence later.
    "while :; do",
    '  if [ ! -d "$D" ]; then',
    // Say so and die: silence here is the armed-forever, fires-never trap.
    "    printf 'E\\n'",
    "    exit 1",
    "  fi",
    `  if [ -n "$(find "$D"${depthArgs} -newer "$S" -print -quit 2>/dev/null)" ]; then`,
    '    touch "$S"',
    "    printf 'C\\n'",
    "  fi",
    `  sleep ${seconds}`,
    "done",
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
export function armDistroWatcher({ wslPath, distro, linuxPath, onChange, onError, signal, intervalSeconds = 2, maxDepth = 0, spawn: spawnProcess }) {
  const doSpawn = spawnProcess ?? ((path, args) => spawn(path, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const child = doSpawn(wslPath, ["-d", distro, "--exec", "sh", "-c", watchLoopScript(intervalSeconds, maxDepth), "wsl-watch", linuxPath]);
    let settled = false;
    let closed = false;
    let reported = false;
    // The loop itself writes nothing to stderr, but `sh` can (a syntax slip in
    // a future edit) — and an undrained pipe stalls the child at the 64KB
    // buffer limit, which would look exactly like a silently-dead watch. So
    // the pipe is drained continuously and the tail kept for error context.
    let stderrTail = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4096);
    });
    const describe = (message) => {
      const detail = stderrTail.trim();
      return detail.length > 0 ? `${message}: ${detail}` : message;
    };
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (line === "R") {
        if (!settled && !signal?.aborted) {
          settled = true;
          resolve(close);
        }
        return;
      }
      if (line === "E") {
        fail(new Error(describe(`the watched directory "${linuxPath}" no longer exists inside "${distro}", so the watch has ended`)));
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
      // One report per watcher lifetime: the loop's E line is followed by its
      // own exit, and both must not reach the seam's error channel.
      if (reported || closed) return;
      reported = true;
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
      fail(new Error(`distro watcher exited unexpectedly (code=${code} signal=${signalName ?? "none"})`));
    });
  });
}
