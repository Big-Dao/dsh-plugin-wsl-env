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
    /** The host path of the binary; empty disables the native backend. */
    source: string;
    /** Read the binary (tests substitute). */
    readSource?: (path: string) => Promise<Buffer>;
    /** Run a host command and return stdout (tests substitute). */
    run?: (argv: string[]) => Promise<string>;
    /** Copy the binary and return the Linux path (tests substitute). */
    copy?: (script: string, binary: Buffer) => Promise<string>;
}
/**
 * Copy the binary into the distro and verify it. The result is cached per
 * `(wslPath, distro, source)`; a failure is cached as `undefined` for this
 * process (the caller falls back to the shell agent).
 *
 * @param options - the transport, distro, source and injectables.
 * @returns the Linux binary path, or undefined when the backend cannot be used.
 */
export declare function ensureNativeBackend({ wslPath, distro, source, readSource, run, copy, }: NativeBackendOptions): Promise<string | undefined>;
/**
 * Forget the cache; tests only.
 */
export declare function clearNativeBackendCache(): void;
