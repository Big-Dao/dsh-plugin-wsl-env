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
 * When `inotifywait` is installed and the target is an unbounded directory,
 * the watcher uses inotify: recursive kernel watches, one `C` per 0.5s of
 * events (a build's event storm is coalesced, the first event is immediate).
 * Otherwise it falls back to the long-lived polling loop: every cadence,
 * `find <dir> -newer <stamp>` — the directory itself is in the scan, so
 * creations AND deletions (which bump the parent's mtime) are both seen — and
 * one `C` line per hit. A FILE target uses the `mtime:size` fingerprint (so a
 * rename-over or an in-place write is seen), and a positive `maxDepth` keeps
 * the polling scan because inotify cannot bound its own walk.
 *
 * The loop speaks three one-letter lines, the watcher protocol:
 *
 *   - `R` — READY: the activation barrier; the host resolves the watch promise
 *     on it, never before.
 *   - `C` — CHANGED: the target may have changed.
 *   - `E` — ERROR: the watched path no longer exists, and the loop has
 *     exited. Without it a vanished target would sit armed forever — `find`
 *     over a missing directory prints nothing, indistinguishable from "no
 *     changes" — so the loop says so and the host reports it.
 *   - `P <pid>` — the loop shell's PID, sent before READY. The host uses it to
 *     stop the loop with a second `wsl.exe` on close: killing the transport
 *     alone does not reliably close the distro-side pipe.
 *   - `H` — HEARTBEAT: liveness only, ignored by the host. It exists so the
 *     loop notices a closed stdout pipe: the host's close kills `wsl.exe` but
 *     cannot signal the distro-side shell, and without a write that shell
 *     would sleep and poll forever. The `PIPE` trap turns that write's
 *     SIGPIPE into a clean exit through the stamp-removing EXIT trap.
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
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
/**
 * The shell loop the watcher runs, parameterised by argv so no path can break
 * quoting: `$1` is the Linux path (a directory or a file), `$2` the poll
 * interval in seconds. Pure text, so it is unit-testable.
 *
 * @param intervalSeconds - poll cadence; must be >= 1.
 * @param maxDepth - bound the scan's depth for a DIRECTORY target, 1 = the
 *   directory itself and its direct children; 0 (the default) scans the whole
 *   tree, which is the contract's semantics. Positive values select the
 *   polling scan (inotify is used only for the unbounded walk). A file target
 *   ignores it.
 * @returns the `sh -c` script body.
 */
export function watchLoopScript(intervalSeconds = 2, maxDepth = 0) {
    const seconds = Math.max(1, Math.floor(intervalSeconds));
    const depth = Number.isInteger(maxDepth) && maxDepth >= 1 ? maxDepth : 0;
    // A bounded walk puts `-maxdepth` directly after the path, where every find
    // that supports it (GNU, BusyBox, BSD) accepts it as a global option.
    const depthArgs = depth > 0 ? ` -maxdepth ${depth}` : "";
    // `find` lists the directory itself first: a child's creation or deletion
    // bumps the parent's mtime, so both edges are seen, not just modifications.
    // A FILE target has no tree to walk; its `mtime:size` fingerprint answers the
    // same one-way question ("may have changed") and covers a rename-over too,
    // since the path is re-stat'ed each tick.
    return [
        'D="$1"',
        'S="${TMPDIR:-/tmp}/wsl-watch.$$.stamp"',
        'FIFO="${TMPDIR:-/tmp}/wsl-watch.$$.fifo"',
        'IW=""',
        'touch "$S"',
        // The stamp/FIFO are the loop's private state, so every way out removes
        // them. The EXIT trap covers plain exits; a signal alone would end the
        // shell WITHOUT running it, so TERM/INT/HUP/PIPE are trapped to a plain
        // exit first. `pkill -P $$` also reaps inotifywait/sleep/find.
        "trap 'kill \"$IW\" 2>/dev/null; pkill -P $$ 2>/dev/null; exec 3>&- 2>/dev/null; rm -f \"$FIFO\" \"$S\" 2>/dev/null' EXIT",
        "trap 'exit 0' TERM INT HUP PIPE",
        'F=""',
        '[ -f "$D" ] && F=$(stat -c "%Y:%s" -- "$D" 2>/dev/null || :)',
        // Prefer inotify for an unbounded DIRECTORY watch: events are immediate and
        // the kernel does the walking. A file target uses the fingerprint loop
        // (it also reports a removal as E), and a bounded scan (maxDepth > 0)
        // keeps the polling loop, which honors the bound.
        `if [ -d "$D" ] && [ ${depth} -eq 0 ] && command -v inotifywait >/dev/null 2>&1; then`,
        '  if mkfifo "$FIFO" 2>/dev/null; then',
        '    exec 3<>"$FIFO"',
        '    inotifywait -m -q -r -e create,delete,modify,move,attrib --format "%e" "$D" >"$FIFO" 2>/dev/null &',
        '    IW=$!',
        '  fi',
        'fi',
        // The PID precedes READY so a close can stop the loop even if the pipe
        // stays open; killing wsl.exe alone does not close it reliably.
        "printf 'P %s\\n' \"$$\"",
        "printf 'R\\n'",
        // One C per half second: a build's event storm becomes a coarse
        // invalidation, while the first event is immediate. A quiet tree blocks
        // in read; the close stops the shell through the P line, not the pipe.
        'if [ -n "$IW" ]; then',
        '  while read -r _ <&3; do',
        "    printf 'C\\n'",
        '    sleep 0.5',
        '  done',
        '  exec 3>&-',
        'fi',
        // Polling fallback: no inotifywait, a bounded scan, or inotifywait exited
        // (a vanished target or an inotify limit). The stamp is the baseline.
        "while :; do",
        '  if [ -d "$D" ]; then',
        `    if [ -n "$(find "$D"${depthArgs} -newer "$S" -print -quit 2>/dev/null)" ]; then`,
        '      touch "$S"',
        "      printf 'C\\n'",
        '    fi',
        '  elif [ -f "$D" ]; then',
        '    cur=$(stat -c "%Y:%s" -- "$D" 2>/dev/null || :)',
        '    if [ -z "$cur" ]; then',
        // The file was removed (or became unreadable): the target is gone.
        "      printf 'E\\n'",
        '      exit 1',
        '    fi',
        '    if [ "$cur" != "$F" ]; then',
        '      F="$cur"',
        "      printf 'C\\n'",
        '    fi',
        '  else',
        // Neither a directory nor a file: say so and die, rather than spin.
        "    printf 'E\\n'",
        '    exit 1',
        '  fi',
        // Liveness: the host ignores H; the write dies with the pipe.
        "  printf 'H\\n'",
        `  sleep ${seconds}`,
        'done',
    ].join("\n");
}
/**
 * Arm one in-distro watcher over a Linux directory or file.
 *
 * @param options - the watch request.
 * @returns resolves once observation is active, with the async close function
 *   the seam's contract asks for.
 */
export function armDistroWatcher({ wslPath, distro, linuxPath, onChange, onError, signal, intervalSeconds = 2, maxDepth = 0, spawn: spawnProcess }) {
    const doSpawn = spawnProcess ?? ((path, args) => spawn(path, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }));
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
            return;
        }
        const child = doSpawn(wslPath, ["-d", distro, "--exec", "sh", "-c", watchLoopScript(intervalSeconds, maxDepth), "wsl-watch", linuxPath]);
        if (child.stdout === null || child.stderr === null)
            throw new Error("the watcher spawn did not provide piped stdio");
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
        let loopPid;
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
            if (line.startsWith("P ")) {
                const pid = Number.parseInt(line.slice(2), 10);
                if (Number.isInteger(pid) && pid > 0)
                    loopPid = pid;
                return;
            }
            if (line === "R") {
                if (!settled && !signal?.aborted) {
                    settled = true;
                    resolve(close);
                }
                return;
            }
            if (line === "E") {
                fail(new Error(describe(`the watched path "${linuxPath}" no longer exists inside "${distro}", so the watch has ended`)));
                return;
            }
            if (line === "C") {
                onChange();
            }
        });
        const close = async () => {
            if (closed)
                return;
            closed = true;
            const pid = loopPid;
            child.removeAllListeners("exit");
            lines.close();
            child.stdout?.destroy();
            child.kill();
            if (pid !== undefined) {
                // A second wsl.exe reaches the same distro namespace; the loop's TERM
                // trap exits through the EXIT cleanup, which removes the stamp.
                try {
                    const stopper = doSpawn(wslPath, ["-d", distro, "--exec", "sh", "-c", 'kill -TERM "$1" 2>/dev/null', "sh", String(pid)]);
                    stopper.stdout?.destroy();
                    stopper.stderr?.destroy();
                    stopper.on("error", () => { });
                    stopper.unref?.();
                }
                catch {
                    // Best effort: the transport kill already happened.
                }
            }
            await new Promise((resolveClose) => {
                if (child.exitCode !== null || child.signalCode !== null)
                    return resolveClose();
                child.once("exit", resolveClose);
            });
        };
        const fail = (error) => {
            // One report per watcher lifetime: the loop's E line is followed by its
            // own exit, and both must not reach the seam's error channel.
            if (reported || closed)
                return;
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
