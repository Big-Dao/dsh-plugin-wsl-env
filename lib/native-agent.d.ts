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
/** The host environment variable naming the native binary to opt in. */
export declare const NATIVE_AGENT_ENV = "DSH_WSL_AGENT_NATIVE";
/**
 * The in-distro copy/verify script. The digest is embedded so `sh` needs no
 * second argument and the cache path is derived from the content; stdout is
 * the final Linux path the session runtime should execute.
 *
 * @param digest - lowercase hex sha256 of the binary.
 * @returns the `sh -c` body (binary on stdin).
 */
export declare function nativeCacheScript(digest: string): string;
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
export declare function ensureNativeBackend({ wslPath, distro, source, packageRoot, readSource, run, copy, }: NativeBackendOptions): Promise<NativeBackendResult | undefined>;
/**
 * Forget the cache; tests only.
 */
export declare function clearNativeBackendCache(): void;
/** The session runtime's agent backend, from `wsl-shell.agentBackend`. */
export type AgentBackend = "auto" | "native" | "shell";
/**
 * Record the selected backend. The session runtime is shared by the shell and
 * filesystem providers, so this one process-wide value is what both read when
 * they prepare their runtime; it is set from the `wsl-shell` config.
 *
 * @param mode - the selected backend.
 */
export declare function configureAgentBackend(mode: AgentBackend): void;
/** @returns the configured backend (for diagnostics and tests). */
export declare function configuredAgentBackend(): AgentBackend;
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
export declare function ensureNativeSessionAgent({ wslPath, distro, setNative, ensure, }: {
    /** The `wsl.exe` path. */
    wslPath: string;
    /** The resolved distro. */
    distro: string;
    /** Store (or clear, with an empty path) the distro's native entrypoint. */
    setNative: (distro: string, path: string, digest: string) => void;
    /** Prepare the binary; tests substitute. */
    ensure?: (options: NativeBackendOptions) => Promise<NativeBackendResult | undefined>;
}): Promise<void>;
