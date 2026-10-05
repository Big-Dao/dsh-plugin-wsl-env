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
 * @module dsh-plugin-wsl/ports
 */
/**
 * Parse one `/proc/net/tcp{,6}` body into listening ports.
 * @param {string} text - the file's content.
 * @returns {number[]} deduplicated listening ports, ascending.
 */
export function parseListeningPorts(text: string): number[];
/**
 * The shell script that prints both proc files' contents.
 * @returns {string} the `sh -c` body.
 */
export function procNetScript(): string;
/**
 * Snapshot the distro's listening ports through the agent.
 * @param {import("./agent-exec.js").AgentExecRunner} runner - the {@link WslAgent}-like runner.
 * @param {number} [timeoutMs] - the exec budget.
 * @returns {Promise<number[]>} listening ports, ascending; [] on any failure —
 *   a snapshot is a convenience, never an error the session should see.
 */
export function listeningPorts(runner: import("./agent-exec.js").AgentExecRunner, timeoutMs?: number): Promise<number[]>;
