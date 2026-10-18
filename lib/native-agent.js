/**
 * Host-side plumbing for the optional native in-distro agent (ADR 0002).
 *
 * The shell agent is the shipped peer. This module is the opt-in path that
 * lets the host run the spike/native binary instead, for the session runtime
 * only:
 *
 *   1. read the binary from a host path (`DSH_WSL_AGENT_NATIVE`);
 *   2. sha256 it and refuse an architecture the binary was not built for;
 *   3. stream it into `~/.cache/dsh-wsl/agent/<sha>/dsh-wsl-agent` inside the
 *      distro, chmod 0755, and verify the distro-side digest;
 *   4. hand the resulting Linux path to the session-runtime factory.
 *
 * The binary is never executed from `/mnt/c` (DrvFs is often `noexec`), and a
 * failed copy falls back to the shell agent — this module never throws to the
 * command path.
 *
 * This is a TypeScript source built to `lib/native-agent.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/native-agent
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pinnedWindowsEnv } from "./agent.js";
import { runCapture } from "./wsl.js";
/** The host environment variable naming the native binary to opt in. */
export const NATIVE_AGENT_ENV = "DSH_WSL_AGENT_NATIVE";
/** Architectures this host can install; the spike ships x86_64 only. */
const SUPPORTED_ARCH = /^(x86_64|amd64)$/u;
/**
 * The in-distro copy/verify script. The digest is embedded so `sh` needs no
 * second argument and the cache path is derived from the content; stdout is
 * the final Linux path the session runtime should execute.
 *
 * @param digest - lowercase hex sha256 of the binary.
 * @returns the `sh -c` body (binary on stdin).
 */
export function nativeCacheScript(digest) {
    return [
        "set -e",
        "umask 077",
        `dir="$HOME/.cache/dsh-wsl/agent/${digest}"`,
        'mkdir -p "$dir"',
        'cat > "$dir/dsh-wsl-agent"',
        'chmod 0755 "$dir/dsh-wsl-agent"',
        "got=$(sha256sum \"$dir/dsh-wsl-agent\" | cut -d' ' -f1)",
        `[ "$got" = "${digest}" ] || { echo digest-mismatch >&2; exit 1; }`,
        'printf "%s" "$dir/dsh-wsl-agent"',
    ].join("\n");
}
/**
 * Copy the binary into the distro and verify it. The result is cached per
 * `(wslPath, distro, source)`; a failure is cached as `undefined` for this
 * process (the caller falls back to the shell agent).
 *
 * @param options - the transport, distro, source and injectables.
 * @returns the Linux binary path, or undefined when the backend cannot be used.
 */
export async function ensureNativeBackend({ wslPath, distro, source, readSource = readFile, run = (argv) => runCapture(argv), copy, }) {
    if (source.length === 0)
        return undefined;
    const key = `${wslPath}\u0000${distro}\u0000${source}`;
    const cached = NATIVE_CACHE.get(key);
    if (cached !== undefined)
        return cached;
    const pending = (async () => {
        const binary = await readSource(source);
        const digest = createHash("sha256").update(binary).digest("hex");
        const arch = (await run([wslPath, "-d", distro, "--exec", "uname", "-m"])).trim();
        if (!SUPPORTED_ARCH.test(arch))
            return undefined;
        const install = copy ?? ((script, bytes) => copyBinary(wslPath, distro, script, bytes));
        const path = await install(nativeCacheScript(digest), binary);
        return path.length > 0 ? path : undefined;
    })().catch(() => undefined);
    NATIVE_CACHE.set(key, pending);
    return pending;
}
/** The per-process cache; a failure is remembered as undefined. */
const NATIVE_CACHE = new Map();
/**
 * Forget the cache; tests only.
 */
export function clearNativeBackendCache() {
    NATIVE_CACHE.clear();
}
/**
 * Stream the binary to the distro on stdin, run the copy/verify script and
 * return its stdout (the cache path).
 *
 * @param wslPath - the `wsl.exe` path.
 * @param distro - the distro.
 * @param script - the copy/verify script.
 * @param binary - the binary bytes.
 * @returns the Linux path printed by the script.
 */
function copyBinary(wslPath, distro, script, binary) {
    return new Promise((resolve, reject) => {
        const child = spawn(wslPath, ["-d", distro, "--exec", "sh", "-c", script, "sh"], {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: pinnedWindowsEnv(process.env),
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0)
                resolve(stdout.trim());
            else
                reject(new Error(stderr.trim() || `native agent copy exited with ${code}`));
        });
        child.stdin?.end(binary);
    });
}
