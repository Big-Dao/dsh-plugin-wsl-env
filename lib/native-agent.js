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
/** The process-wide mode; the shell executor's constructor owns it. */
let backend = "auto";
/**
 * Record the selected backend. The session runtime is shared by the shell and
 * filesystem providers, so this one process-wide value is what both read when
 * they prepare their runtime; it is set from the `wsl-shell` config.
 *
 * @param mode - the selected backend.
 */
export function configureAgentBackend(mode) {
    backend = mode;
}
/** @returns the configured backend (for diagnostics and tests). */
export function configuredAgentBackend() {
    return backend;
}
/**
 * Select the native binary for a distro when the backend allows it.
 *
 * - `shell`: clear any native entry and use the shipped shell agent.
 * - `auto`: use the native binary when a source exists and copy/verify
 *   succeeds; otherwise stay on the shell agent.
 * - `native`: same preparation, but a missing source or a failed preparation
 *   throws a remedy instead of silently falling back.
 *
 * The source is the development override `DSH_WSL_AGENT_NATIVE`; the packaged
 * per-arch binary will be added by the packaging task and preferred over it.
 *
 * @param options - the transport, distro, setter and injectable prepare step.
 */
export async function ensureNativeSessionAgent({ wslPath, distro, setNative, ensure = ensureNativeBackend, }) {
    if (backend === "shell") {
        setNative(distro, "");
        return;
    }
    const source = nativeAgentSource();
    if (source.length === 0) {
        if (backend === "native") {
            throw new Error(`agentBackend: "native" is set, but no native binary is available: set ${NATIVE_AGENT_ENV} to a host path (or use "auto"/"shell").`);
        }
        return;
    }
    const path = await ensure({ wslPath, distro, source });
    if (path === undefined) {
        if (backend === "native") {
            throw new Error(`agentBackend: "native" could not prepare the native agent from "${source}" (architecture, copy or digest check failed); check ${NATIVE_AGENT_ENV}, or use "auto"/"shell".`);
        }
        return;
    }
    setNative(distro, path);
}
/**
 * The host binary source. The development override comes first; the packaged
 * per-arch binaries are the next stage, so this stays env-only for now.
 *
 * @returns the host path, or an empty string when no source is configured.
 */
function nativeAgentSource() {
    return process.env[NATIVE_AGENT_ENV] ?? "";
}
