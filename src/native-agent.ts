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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedWindowsEnv } from "./agent.js";
import { runCapture } from "./wsl.js";

/** The host environment variable naming the native binary to opt in. */
export const NATIVE_AGENT_ENV = "DSH_WSL_AGENT_NATIVE";

/** Distro `uname -m` values mapped to the packaged directory names. */
const ARCHS = new Map<string, string>([
  ["x86_64", "x86_64"],
  ["amd64", "x86_64"],
  ["aarch64", "aarch64"],
  ["arm64", "aarch64"],
]);

/** The plugin package root: `lib/native-agent.js` -> `<root>`. */
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * The in-distro copy/verify script. The digest is embedded so `sh` needs no
 * second argument and the cache path is derived from the content; stdout is
 * the final Linux path the session runtime should execute.
 *
 * @param digest - lowercase hex sha256 of the binary.
 * @returns the `sh -c` body (binary on stdin).
 */
export function nativeCacheScript(digest: string): string {
  return [
    "set -e",
    "umask 077",
    `dir="$HOME/.cache/dsh-wsl/agent/${digest}"`,
    'target="$dir/dsh-wsl-agent"',
    // A live session already runs this exact binary; rewriting it would fail
    // with ETXTBSY. A valid cache is the same verified artifact, so reuse it.
    `if [ -x "$target" ] && [ "$(sha256sum "$target" | cut -d' ' -f1)" = "${digest}" ]; then printf '%s' "$target"; exit 0; fi`,
    'mkdir -p "$dir"',
    'cat > "$target"',
    'chmod 0755 "$target"',
    "got=$(sha256sum \"$target\" | cut -d' ' -f1)",
    `[ "$got" = "${digest}" ] || { echo digest-mismatch >&2; exit 1; }`,
    '"$target" </dev/null >/dev/null 2>&1 || { echo cannot-execute >&2; exit 1; }',
    'printf "%s" "$target"',
  ].join("\n");
}

/** The injectable edges. */
export interface NativeBackendOptions {
  /** The `wsl.exe` path. */
  wslPath: string;
  /** The distro. */
  distro: string;
  /**
   * The host path override (the development variable); empty resolves the
   * packaged binary for the distro's architecture.
   */
  source: string;
  /** The plugin package root; tests and non-standard layouts substitute it. */
  packageRoot?: string;
  /** Read the binary (tests substitute). */
  readSource?: (path: string) => Promise<Buffer>;
  /** Run a host command and return stdout (tests substitute). */
  run?: (argv: string[]) => Promise<string>;
  /** Copy the binary and return the Linux path (tests substitute). */
  copy?: (script: string, binary: Buffer) => Promise<string>;
}

/** A prepared native binary: its in-distro path and the sha256 of its bytes. */
export interface NativeBackendResult {
  /** The Linux path the session runtime spawns. */
  path: string;
  /** Lowercase hex sha256; the agent's HELLO digest must match it. */
  digest: string;
}

/**
 * Copy the binary into the distro and verify it. The result is cached per
 * `(wslPath, distro, source)`; a failure is cached as `undefined` for this
 * process (the caller falls back to the shell agent).
 *
 * @param options - the transport, distro, source and injectables.
 * @returns the Linux binary path and digest, or undefined when unusable.
 */
export async function ensureNativeBackend({
  wslPath,
  distro,
  source,
  packageRoot = PACKAGE_ROOT,
  readSource = readFile,
  run = (argv) => runCapture(argv),
  copy,
}: NativeBackendOptions): Promise<NativeBackendResult | undefined> {
  const key = `${wslPath}\u0000${distro}\u0000${source}\u0000${packageRoot}`;
  const cached = NATIVE_CACHE.get(key);
  if (cached !== undefined) return cached;
  const pending = (async () => {
    const arch = (await run([wslPath, "-d", distro, "--exec", "uname", "-m"])).trim();
    const normalized = ARCHS.get(arch);
    if (normalized === undefined) return undefined;
    const hostPath = source.length > 0 ? source : join(packageRoot, "agent", "native", `linux-${normalized}`, "dsh-wsl-agent");
    const binary = await readSource(hostPath);
    const digest = createHash("sha256").update(binary).digest("hex");
    const install = copy ?? ((script, bytes) => copyBinary(wslPath, distro, script, bytes));
    const path = await install(nativeCacheScript(digest), binary);
    return path.length > 0 ? { path, digest } : undefined;
  })().catch(() => undefined);
  NATIVE_CACHE.set(key, pending);
  return pending;
}

/** The per-process cache; a failure is remembered as undefined. */
const NATIVE_CACHE = new Map<string, Promise<NativeBackendResult | undefined>>();

/**
 * Forget the cache; tests only.
 */
export function clearNativeBackendCache(): void {
  NATIVE_CACHE.clear();
}

/**
 * Stream the binary to the distro on stdin, run the copy/verify script and
 * return its stdout (the cache path).
 *
 * Exported for its regression check; the copy path is injectable in
 * {@link ensureNativeBackend}.
 *
 * @param wslPath - the `wsl.exe` path.
 * @param distro - the distro.
 * @param script - the copy/verify script.
 * @param binary - the binary bytes.
 * @returns the Linux path printed by the script.
 */
export function copyBinary(wslPath: string, distro: string, script: string, binary: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(wslPath, ["-d", distro, "--exec", "sh", "-c", script, "sh"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: pinnedWindowsEnv(process.env),
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `native agent copy exited with ${code}`));
    });
    // The script prints the cached path and exits WITHOUT reading stdin when
    // the in-distro digest already matches. On Windows, finishing the binary
    // write against that closed pipe surfaces as `write EOF` on stdin, and an
    // unhandled stream error would take down the host process. The exit code
    // and stdout above already decide the result, so absorb the write error.
    child.stdin?.on("error", () => {});
    try {
      child.stdin?.end(binary);
    } catch {
      // A pipe that is already gone is the same warm-cache case.
    }
  });
}

/** The session runtime's agent backend, from `wsl-shell.agentBackend`. */
export type AgentBackend = "auto" | "native" | "shell";

/** The process-wide mode; the shell executor's constructor owns it. */
let backend: AgentBackend = "auto";

/**
 * Record the selected backend. The session runtime is shared by the shell and
 * filesystem providers, so this one process-wide value is what both read when
 * they prepare their runtime; it is set from the `wsl-shell` config.
 *
 * @param mode - the selected backend.
 */
export function configureAgentBackend(mode: AgentBackend): void {
  backend = mode;
}

/** @returns the configured backend (for diagnostics and tests). */
export function configuredAgentBackend(): AgentBackend {
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
export async function ensureNativeSessionAgent({
  wslPath,
  distro,
  setNative,
  ensure = ensureNativeBackend,
}: {
  /** The `wsl.exe` path. */
  wslPath: string;
  /** The resolved distro. */
  distro: string;
  /** Store (or clear, with an empty path) the distro's native entrypoint. */
  setNative: (distro: string, path: string, digest: string) => void;
  /** Prepare the binary; tests substitute. */
  ensure?: (options: NativeBackendOptions) => Promise<NativeBackendResult | undefined>;
}): Promise<void> {
  if (backend === "shell") {
    setNative(distro, "", "");
    return;
  }
  const result = await ensure({ wslPath, distro, source: process.env[NATIVE_AGENT_ENV] ?? "" });
  if (result === undefined) {
    if (backend === "native") {
      throw new Error(`agentBackend: "native" could not prepare a native binary: the packaged binary for this architecture is missing or failed the copy/digest/execute check, and ${NATIVE_AGENT_ENV} is unset or unusable; set a valid ${NATIVE_AGENT_ENV}, or use "auto"/"shell".`);
    }
    return;
  }
  setNative(distro, result.path, result.digest);
}
