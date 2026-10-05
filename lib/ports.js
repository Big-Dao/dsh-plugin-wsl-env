/**
 * Listening-port visibility for the distro, the Remote-WSL port-forwarding
 * parity row's DSH-side half.
 *
 * There is no DSH channel that streams live facts to the model; the sanctioned
 * one is the managed `DSH_*` namespace (`ctx.shellEnv`), whose `resolve` is
 * SYNCHRONOUS. So the snapshot is refreshed on a timer and served stale-but-
 * recent: `DSH_WSL_PORTS` names the ports with a listener inside the distro,
 * at most `refreshMs` old. A dev server the model starts shows up on the next
 * refresh, which is the granularity that matters at conversational pace.
 *
 * The scan reads `/proc/net/tcp` and `/proc/net/tcp6` directly — no `ss`, no
 * `netstat`, nothing to install — and keeps sockets in state `0A` (LISTEN).
 * Pure parser, unit-testable without a distro.
 *
 * This is a TypeScript source built to `lib/ports.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/ports
 */
/**
 * Parse one `/proc/net/tcp{,6}` body into listening ports.
 *
 * @param text - the file's content.
 * @returns deduplicated listening ports, ascending.
 */
export function parseListeningPorts(text) {
    const ports = new Set();
    for (const line of text.split("\n").slice(1)) {
        const columns = line.trim().split(/\s+/);
        // sl, local_address, rem_address, st, ... — st 0A is LISTEN.
        const localAddress = columns[1];
        if (columns.length < 4 || localAddress === undefined || columns[3] !== "0A")
            continue;
        const portHex = localAddress.split(":")[1];
        if (portHex === undefined)
            continue;
        const port = Number.parseInt(portHex, 16);
        if (Number.isFinite(port) && port > 0)
            ports.add(port);
    }
    return [...ports].sort((a, b) => a - b);
}
/**
 * The shell script that prints both proc files' contents.
 *
 * @returns the `sh -c` body.
 */
export function procNetScript() {
    return "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null";
}
/**
 * Snapshot the distro's listening ports through the agent.
 *
 * @param runner - the {@link WslAgent}-like runner.
 * @param timeoutMs - the exec budget.
 * @returns listening ports, ascending; [] on any failure — a snapshot is a
 *   convenience, never an error the session should see.
 */
export async function listeningPorts(runner, timeoutMs = 10000) {
    try {
        const result = await runner.exec({ cwd: "/", argv: ["sh", "-c", procNetScript(), "ports"], timeoutMs });
        if (result.exitCode !== 0)
            return [];
        return parseListeningPorts(result.stdout.toString("utf8"));
    }
    catch {
        return [];
    }
}
