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
/** The values the config schema accepts, in display order. */
export const SOCKET_ISOLATION_VALUES = ["off", "session-bus", "strict"];
/** A configured isolation that could not be resolved; the provider turns this into a fail-closed sandbox refusal. */
export class SocketIsolationError extends Error {
    /** The configured stance. */
    mode;
    /**
     * @param mode - the configured stance.
     * @param message - the model-facing reason.
     */
    constructor(mode, message) {
        super(message);
        this.name = "SocketIsolationError";
        this.mode = mode;
    }
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
export function socketIsolationProbeScript() {
    return [
        'rt="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"',
        'printf \'R %s\\n\' "$rt"',
        'for p in "$rt/bus" "$rt/systemd/private"; do',
        '  [ -S "$p" ] && printf \'U %s\\n\' "$p"',
        "done",
        'for p in /run/dbus/system_bus_socket /run/docker.sock /var/run/docker.sock /run/podman/podman.sock /var/run/podman/podman.sock /run/containerd/containerd.sock /var/run/containerd/containerd.sock /run/crio/crio.sock /run/k3s/containerd/containerd.sock; do',
        '  [ -S "$p" ] || continue',
        '  [ -w "$p" ] || continue',
        '  t=$(readlink -f "$p" 2>/dev/null || true)',
        '  [ -n "$t" ] || t="$p"',
        '  printf \'S %s\\n\' "$t"',
        "done",
    ].join("\n");
}
/**
 * Parse the probe's lines into facts.
 *
 * @param text - the probe's stdout.
 * @returns the facts; empty lists when a section is absent.
 */
export function parseSocketIsolationFacts(text) {
    const facts = { runtimeDir: "", userSockets: [], strictSockets: [] };
    for (const raw of text.split(/\r?\n/u)) {
        const line = raw.trim();
        if (line.length === 0)
            continue;
        const space = line.indexOf(" ");
        if (space < 0)
            continue;
        const tag = line.slice(0, space);
        const value = line.slice(space + 1).trim();
        if (value.length === 0 || !value.startsWith("/"))
            continue;
        if (tag === "R")
            facts.runtimeDir = value;
        else if (tag === "U" && !facts.userSockets.includes(value))
            facts.userSockets.push(value);
        else if (tag === "S" && !facts.strictSockets.includes(value))
            facts.strictSockets.push(value);
    }
    return facts;
}
/**
 * The absolute paths a profile binds `/dev/null` over for one stance.
 *
 * @param mode - the configured stance.
 * @param facts - the distro's socket facts.
 * @returns the masks, deduplicated; empty for `off`.
 */
export function socketMaskPaths(mode, facts) {
    if (mode === "off")
        return [];
    const paths = [...facts.userSockets];
    if (mode === "strict")
        paths.push(...facts.strictSockets);
    return [...new Set(paths)];
}
/**
 * How long resolved facts stay fresh. A daemon started after the first
 * confined command (docker, podman, the user manager) adds a socket that a
 * process-lifetime cache would never mask; the TTL bounds that window while
 * still keeping a burst of commands to one probe.
 */
export const SOCKET_FACTS_TTL_MS = 60_000;
/** The successful facts, keyed by the exact transport + distro pair; a failure is not remembered. */
const factsCache = new Map();
/** Test hook: forget the remembered facts. */
export function resetSocketIsolationCache() {
    factsCache.clear();
}
/**
 * Resolve the socket masks for one distro and stance, running the in-distro
 * probe once per `(wslPath, distro)` and re-running it after
 * {@link SOCKET_FACTS_TTL_MS} so a socket that appears later is masked too.
 *
 * @param options - the stance, transport, distro and host runner.
 * @returns the masks; empty for `off`.
 * @throws {SocketIsolationError} when the stance is on and the probe cannot answer.
 */
export async function socketMasksFor(options) {
    if (options.mode === "off")
        return [];
    options.signal?.throwIfAborted();
    const key = `${options.wslPath}\u0000${options.distro}`;
    const now = Date.now();
    const cached = factsCache.get(key);
    let entry;
    if (cached === undefined || now - cached.at >= SOCKET_FACTS_TTL_MS) {
        const argv = [
            options.wslPath,
            ...(options.distro.length > 0 ? ["-d", options.distro] : []),
            "--exec",
            "sh",
            "-c",
            socketIsolationProbeScript(),
        ];
        const pending = options.run(argv).then(parseSocketIsolationFacts);
        entry = { at: now, pending };
        factsCache.set(key, entry);
        pending.catch(() => {
            if (factsCache.get(key) === entry)
                factsCache.delete(key);
        });
    }
    else {
        entry = cached;
    }
    let facts;
    try {
        facts = await entry.pending;
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new SocketIsolationError(options.mode, `socketIsolation: ${options.mode} could not read the distro's socket facts (${reason}); fix the distro access or set socketIsolation: off to accept the partial boundary`);
    }
    options.signal?.throwIfAborted();
    return socketMaskPaths(options.mode, facts);
}
