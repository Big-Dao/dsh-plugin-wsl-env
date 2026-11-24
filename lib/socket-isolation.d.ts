/**
 * The socket surfaces a confined COMMAND must not reach, and the bwrap masks
 * that close them.
 *
 * The sandbox's mount profile confines file effects; it does not confine
 * process authority. A confined command can still talk to the user's systemd
 * manager (`$XDG_RUNTIME_DIR/bus`, `$XDG_RUNTIME_DIR/systemd/private`) and ask
 * it to start a unit outside the mount namespace, or connect to a container
 * daemon's socket and start a container outside it. Both are documented
 * escapes from the write fence ([SECURITY.md](../SECURITY.md)); `session-bus`
 * masks the user manager, `strict` adds the system bus and the container
 * sockets that exist and are writable for the distro user.
 *
 * The module is peer-free and splits into three pure pieces plus one probe:
 *
 *   1. {@link socketIsolationProbeScript} runs inside the distro and reports
 *      the runtime directory, the user-manager sockets, and the strict
 *      sockets that exist and the user can use.
 *   2. {@link parseSocketIsolationFacts} turns that output into facts.
 *   3. {@link socketMaskPaths} maps a mode plus facts to the absolute paths
 *      bwrap binds `/dev/null` over.
 *   4. {@link socketMasksFor} runs the probe once per `(wslPath, distro)` and
 *      keeps the facts for a short TTL; a probe failure is thrown, never read
 *      as "nothing to mask" — a configured isolation that silently disappears
 *      is worse than no isolation.
 *
 * The masks are a narrowing, not a closure. The distro user's other IPC
 * (`/proc`, a same-user process's sockets, the interop transport) remains;
 * `sandbox` enforcement stays `partial`, and [SECURITY.md](../SECURITY.md) says
 * so.
 *
 * This is a TypeScript source built to `lib/socket-isolation.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/socket-isolation
 */
/** The three socket-isolation stances a confined command profile can take. */
export type SocketIsolation = "off" | "session-bus" | "strict";
/** The values the config schema accepts, in display order. */
export declare const SOCKET_ISOLATION_VALUES: readonly SocketIsolation[];
/** What one in-distro probe learned about the socket surfaces. */
export interface SocketIsolationFacts {
    /** The distro user's runtime directory (`$XDG_RUNTIME_DIR` or `/run/user/<uid>`). */
    runtimeDir: string;
    /** The user systemd manager's sockets that exist (`bus`, `systemd/private`). */
    userSockets: string[];
    /** The strict-mode sockets that exist and the distro user can connect to. */
    strictSockets: string[];
}
/** A configured isolation that could not be resolved; the provider turns this into a fail-closed sandbox refusal. */
export declare class SocketIsolationError extends Error {
    /** The configured stance. */
    readonly mode: SocketIsolation;
    /**
     * @param mode - the configured stance.
     * @param message - the model-facing reason.
     */
    constructor(mode: SocketIsolation, message: string);
}
/**
 * The shell script the probe runs inside the distro. It prints one fact per
 * line: `R <runtimeDir>`, `U <user-manager socket>`, `S <strict socket>`.
 * A strict socket is emitted only when it exists and the user can use it;
 * a symlinked container socket is emitted as its resolved target, because
 * binding `/dev/null` over a symlink path fails and the target is the socket
 * a client actually reaches.
 *
 * @returns the `sh -c` body.
 */
export declare function socketIsolationProbeScript(): string;
/**
 * Parse the probe's lines into facts.
 *
 * @param text - the probe's stdout.
 * @returns the facts; empty lists when a section is absent.
 */
export declare function parseSocketIsolationFacts(text: string): SocketIsolationFacts;
/**
 * The absolute paths a profile binds `/dev/null` over for one stance.
 *
 * @param mode - the configured stance.
 * @param facts - the distro's socket facts.
 * @returns the masks, deduplicated; empty for `off`.
 */
export declare function socketMaskPaths(mode: SocketIsolation, facts: SocketIsolationFacts): string[];
/**
 * How long resolved facts stay fresh. A daemon started after the first
 * confined command (docker, podman, the user manager) adds a socket that a
 * process-lifetime cache would never mask; the TTL bounds that window while
 * still keeping a burst of commands to one probe.
 */
export declare const SOCKET_FACTS_TTL_MS = 60000;
/** Test hook: forget the remembered facts. */
export declare function resetSocketIsolationCache(): void;
/**
 * Resolve the socket masks for one distro and stance, running the in-distro
 * probe once per `(wslPath, distro)` and re-running it after
 * {@link SOCKET_FACTS_TTL_MS} so a socket that appears later is masked too.
 *
 * @param options - the stance, transport, distro and host runner.
 * @returns the masks; empty for `off`.
 * @throws {SocketIsolationError} when the stance is on and the probe cannot answer.
 */
export declare function socketMasksFor(options: {
    mode: SocketIsolation;
    wslPath: string;
    distro: string;
    run: (argv: string[]) => Promise<string>;
    signal?: AbortSignal | undefined;
}): Promise<string[]>;
