/**
 * Real-machine probe for the `writableRoots` grants under `workspace-write`.
 *
 * The bwrap profile itself is measured by `test/probe/sandbox.sh` §3b; this
 * probe measures the plugin's *wiring*: the resolver expands and filters the
 * configured roots, the physical check accepts them, the per-command profile
 * binds them, and the session runtime's systemd scope carries the same roots
 * into the long-lived agent. A root that is granted must be writable; a
 * sibling that is not granted must stay EROFS. Both confinement shapes are
 * covered because they build the mount prefix in different places.
 *
 *   node test/probe/cache-write-probe.mjs
 *
 * The probe creates a temporary workspace and cache under `$HOME`, so it must
 * run from an unconfined shell; the detached suite runner is that shell. It
 * needs `bubblewrap`; the session leg additionally needs `wsl.exe` interop and
 * the systemd user manager, and reports `INFO` when either is unavailable.
 *
 * The output is one `PASS`/`FAIL`/`INFO` line per expectation and a summary;
 * the exit status is 1 when any `FAIL` was recorded.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { bwrapArgvPrefix } from "../../lib/bwrap.js";
import { probeSessionRuntime, SessionRuntimes } from "../../lib/session-runtime.js";
import { ensureWritableRoots, resolveWritableRoots } from "../../lib/writable-roots.js";

/** The plugin's default transport, as the runtime and the physical check use it. */
const WSL = "wsl.exe";

/** @typedef {{ status: number | null, stdout: string | null, stderr: string | null, error?: Error }} SpawnCapture */

/** Report one expectation. @param {string} name - the check's name. @param {boolean} ok - the verdict. @param {string} [detail] - the evidence. */
const report = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail.length === 0 ? "" : `  — ${detail}`}`);
};

/** Report a leg that could not run on this machine, without failing it. @param {string} name - the leg's name. @param {string} reason - why it was skipped. */
const info = (name, reason) => {
  console.log(`INFO  ${name}  — ${reason}`);
};

/**
 * Run one bwrap profile and its command.
 * @param {string[]} prefix - the argv from {@link bwrapArgvPrefix}.
 * @param {string[]} argv - the command to run inside the profile.
 * @returns {SpawnCapture} the capture.
 */
const runBwrap = (prefix, argv) => {
  const result = spawnSync(/** @type {string} */ (prefix[0]), [...prefix.slice(1), ...argv], { encoding: "utf8", timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, ...(result.error === undefined ? {} : { error: result.error }) };
};

/**
 * Whether the capture is the kernel's read-only denial rather than an unrelated failure.
 * @param {SpawnCapture} capture - the command's capture.
 * @returns {boolean} true when bwrap refused the write with EROFS.
 */
const isReadOnly = (capture) => `${capture.stderr ?? ""}\n${capture.stdout ?? ""}`.includes("Read-only file system");

/** @returns {Promise<void>} */
async function main() {
  const distro = process.env.DSH_WSL_ENV_DISTRO ?? process.env.WSL_DISTRO_NAME ?? "";
  const home = process.env.DSH_WSL_ENV_HOME ?? process.env.HOME ?? homedir();
  if (distro.length === 0) {
    console.error("cache-write: not inside WSL (set DSH_WSL_ENV_DISTRO or WSL_DISTRO_NAME)");
    process.exitCode = 1;
    return;
  }
  if (home.length === 0 || !home.startsWith("/")) {
    console.error("cache-write: the distro home is unusable");
    process.exitCode = 1;
    return;
  }

  const base = join(home, `.dsh-cache-write-probe-${process.pid}`);
  const workspace = join(base, "workspace");
  const cache = join(base, "cache");
  const denied = join(base, "denied");
  let failed = 0;
  /** @type {SessionRuntimes | undefined} */
  let runtimes;

  /**
   * @param {string} name - the check's name.
   * @param {boolean} ok - the verdict.
   * @param {string} [detail] - the evidence.
   */
  const check = (name, ok, detail = "") => {
    report(name, ok, detail);
    if (!ok) failed += 1;
  };

  try {
    mkdirSync(workspace, { recursive: true });
    mkdirSync(cache, { recursive: true });
    mkdirSync(denied, { recursive: true });
  } catch (error) {
    console.error(`cache-write: cannot create the probe directory under ${home}: ${error instanceof Error ? error.message : String(error)}`);
    console.error("cache-write: run this from an unconfined shell (the detached suite runner is one)");
    process.exitCode = 1;
    return;
  }

  try {
    // The resolver expands the configured entry and filters roots that are
    // already writable. The grant is a sibling of the workspace, so it is a
    // real extra root, not one the workspace bind already covers.
    const roots = resolveWritableRoots({ configured: [cache], home, distro, workspaceRoot: workspace });
    check("resolveWritableRoots keeps the cache as an extra root", roots.length === 1 && roots[0] === cache, roots.join(", "));

    // The one-time physical check the providers run before binding. It rides
    // wsl.exe, so it is also an interop probe; skips cleanly without interop.
    const wsl = spawnSync(WSL, ["--version"], { encoding: "utf8", timeout: 10_000 });
    const interop = wsl.error === undefined;
    if (interop) {
      try {
        await ensureWritableRoots({ wslPath: WSL, distro, roots });
        check("ensureWritableRoots accepts the physical cache directory", true);
      } catch (error) {
        check("ensureWritableRoots accepts the physical cache directory", false, error instanceof Error ? error.message : String(error));
      }
    } else {
      info("physical writable-root check", "wsl.exe is unavailable from this shell (no interop)");
    }

    // ---- per-command path: the profile WslSandbox.confine() builds ----------
    const writeCommand = ["sh", "-c", 'printf probe > "$1"', "sh"];
    const perCommand = bwrapArgvPrefix({ mode: "workspace-write", workspaceRoot: workspace }, { writableRoots: roots });
    const granted = runBwrap(perCommand, [...writeCommand, join(cache, "granted.txt")]);
    check("per-command profile writes the granted root", granted.status === 0 && existsSync(join(cache, "granted.txt")), granted.status === 0 ? "" : (granted.stderr ?? "").trim().split(/\r?\n/u)[0]);
    check("the granted write reached the real filesystem", existsSync(join(cache, "granted.txt")) && readFileSync(join(cache, "granted.txt"), "utf8") === "probe");

    const refused = runBwrap(perCommand, [...writeCommand, join(denied, "denied.txt")]);
    check("an ungranted sibling stays EROFS", refused.status !== 0 && isReadOnly(refused), refused.status === 0 ? "the write was ALLOWED" : (refused.stderr ?? "").trim().split(/\r?\n/u)[0]);
    check("the denied sibling left no file", !existsSync(join(denied, "denied.txt")));

    const readOnly = bwrapArgvPrefix({ mode: "read-only", workspaceRoot: "/" }, { writableRoots: roots });
    const ignored = runBwrap(readOnly, [...writeCommand, join(cache, "read-only.txt")]);
    check("read-only ignores the configured grant", ignored.status !== 0 && isReadOnly(ignored), ignored.status === 0 ? "the write was ALLOWED" : (ignored.stderr ?? "").trim().split(/\r?\n/u)[0]);

    // ---- session runtime path: the long-lived scope + agent -----------------
    if (!interop) {
      info("session-runtime leg", "wsl.exe is unavailable from this shell (no interop)");
      return;
    }
    const refusal = await probeSessionRuntime({
      wslPath: WSL,
      distro,
      run: async (argv) => {
        const result = spawnSync(/** @type {string} */ (argv[0]), argv.slice(1), { encoding: "utf8", timeout: 30_000 });
        if (result.error !== undefined) throw result.error;
        if (result.status !== 0) throw new Error((result.stderr ?? result.stdout ?? "").trim() || `exit ${result.status}`);
        return result.stdout ?? "";
      },
    });
    if (refusal !== null) {
      info("session-runtime leg", `skipped: ${refusal}`);
      return;
    }
    runtimes = new SessionRuntimes();
    const entry = runtimes.acquire({
      sessionId: `cache-write-probe-${process.pid}`,
      distro,
      wslPath: WSL,
      workspaceRoot: workspace,
      mode: "workspace-write",
      writableRoots: roots,
      maskWindowsDrive: false,
      leaseMs: 0,
    });
    const sessionGranted = await entry.agent.exec({ cwd: workspace, argv: [...writeCommand, join(cache, "session-granted.txt")], timeoutMs: 60_000 });
    check("session runtime writes the granted root", sessionGranted.exitCode === 0 && existsSync(join(cache, "session-granted.txt")), sessionGranted.exitCode === 0 ? "" : sessionGranted.stderr.toString("utf8").trim().split(/\r?\n/u)[0]);
    check("the session granted write reached the real filesystem", existsSync(join(cache, "session-granted.txt")) && readFileSync(join(cache, "session-granted.txt"), "utf8") === "probe");

    const sessionRefused = await entry.agent.exec({ cwd: workspace, argv: [...writeCommand, join(denied, "session-denied.txt")], timeoutMs: 60_000 });
    check("the session runtime keeps an ungranted sibling EROFS", sessionRefused.exitCode !== 0 && `${sessionRefused.stderr.toString("utf8")}\n${sessionRefused.stdout.toString("utf8")}`.includes("Read-only file system"), sessionRefused.exitCode === 0 ? "the write was ALLOWED" : sessionRefused.stderr.toString("utf8").trim().split(/\r?\n/u)[0]);
    check("the session denied sibling left no file", !existsSync(join(denied, "session-denied.txt")));
  } finally {
    if (runtimes !== undefined) {
      try {
        await runtimes.disposeAll();
      } catch {
        // The probe's own cleanup must not mask its verdict.
      }
    }
    rmSync(base, { recursive: true, force: true });
  }

  console.log("");
  console.log(failed === 0 ? "cache-write: all expectations held" : `cache-write: ${failed} expectation(s) failed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
