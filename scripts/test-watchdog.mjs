#!/usr/bin/env node
/**
 * Run a test command under a wall-clock watchdog.
 *
 * `node --test` has no per-file deadline. A test file that leaves a handle
 * alive while a top-level await never settles — the shape every script-style
 * suite in this package has — keeps its child process running forever, and
 * `--test-timeout` does not bound it: that flag only times tests a file has
 * registered, and the hang happens before registration. The runner's own
 * message for it is the late, terminal `Promise resolution is still pending but
 * the event loop has already resolved`, which never arrives because the loop
 * never resolves.
 *
 * Without a guard one wedged file burns the caller's whole command budget (600
 * s in the harness, unbounded in a terminal). This wrapper adds the missing
 * bound: the command runs untouched, and when it outlives the deadline the
 * wrapper interrupts it — SIGINT on POSIX, which makes `node --test` print its
 * "Interrupted while running" list naming the file that never finished, and
 * `taskkill /T /F` on Windows — then exits 124.
 *
 *   node scripts/test-watchdog.mjs [--timeout <ms>] -- <command> [args...]
 *
 * The default deadline is 180 s; `DSH_TEST_WATCHDOG_MS` overrides it. The
 * wrapper passes the command's own exit status through when it finishes first.
 */
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 180_000;
/** How long an interrupted POSIX run gets to report before it is killed. */
const KILL_GRACE_MS = 3_000;

/**
 * Split the wrapper's arguments into a deadline and the command to run.
 *
 * @param {string[]} argv - the arguments after the script path.
 * @returns {{ timeoutMs: number, command: string[] }} the parsed deadline and command.
 */
function parse(argv) {
  let timeoutMs = Number(process.env.DSH_TEST_WATCHDOG_MS ?? DEFAULT_TIMEOUT_MS);
  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === "--") {
      index += 1;
      break;
    }
    if (arg === "--timeout") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--timeout needs a value");
      timeoutMs = Number(value);
      index += 2;
      continue;
    }
    if (arg.startsWith("--timeout=")) {
      timeoutMs = Number(arg.slice("--timeout=".length));
      index += 1;
      continue;
    }
    break;
  }
  const command = argv.slice(index);
  if (command.length === 0) {
    throw new Error("no command given; usage: test-watchdog.mjs [--timeout <ms>] -- <command> [args...]");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`test-watchdog: invalid timeout: ${String(timeoutMs)}`);
  }
  return { timeoutMs, command };
}

let parsed;
try {
  parsed = parse(process.argv.slice(2));
} catch (error) {
  console.error(`test-watchdog: ${/** @type {Error} */ (error).message}`);
  process.exit(2);
}
const { timeoutMs, command } = parsed;
const [file, ...args] = command;
const isWindows = process.platform === "win32";
const child = spawn(file, args, { stdio: "inherit", detached: !isWindows, env: process.env });
let expired = false;

/**
 * Signal the command's whole process group, falling back to the child alone
 * when the group is already gone or was never created.
 *
 * @param {NodeJS.Signals} signal - the signal to deliver.
 */
function signalTree(signal) {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The command already exited between the deadline check and this signal.
    }
  }
}

const timer = setTimeout(() => {
  expired = true;
  console.error(
    `test-watchdog: no completion within ${timeoutMs} ms; interrupting the command` +
      (isWindows ? "" : " (the still-running file is named in node's interrupted report below)"),
  );
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  signalTree("SIGINT");
  setTimeout(() => signalTree("SIGKILL"), KILL_GRACE_MS).unref();
}, timeoutMs);

child.on("error", (error) => {
  clearTimeout(timer);
  console.error(`test-watchdog: cannot start ${file}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code) => {
  clearTimeout(timer);
  process.exit(expired ? 124 : code ?? 1);
});

for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.on(signal, () => signalTree(signal));
}
