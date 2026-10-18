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
import type { AgentExecRunner } from "./agent-exec.js";
/**
 * Parse one `/proc/net/tcp{,6}` body into listening ports.
 *
 * @param text - the file's content.
 * @returns deduplicated listening ports, ascending.
 */
export declare function parseListeningPorts(text: string): number[];
/**
 * The shell script that prints both proc files' contents.
 *
 * @returns the `sh -c` body.
 */
export declare function procNetScript(): string;
/**
 * Snapshot the distro's listening ports through the agent.
 *
 * @param runner - the {@link WslAgent}-like runner.
 * @param timeoutMs - the exec budget.
 * @returns listening ports, ascending; undefined when the scan could not
 *   answer (agent out, non-zero exit), so a caller can keep the last snapshot.
 */
export declare function scanListeningPorts(runner: AgentExecRunner, timeoutMs?: number): Promise<number[] | undefined>;
/**
 * Snapshot the distro's listening ports, collapsing a failed scan to an empty
 * list. New callers that must distinguish "none listening" from "the scan
 * failed" should use {@linkcode scanListeningPorts}; this wrapper exists for
 * the probe/test shape that only needs the list.
 *
 * @param runner - the agent-like runner.
 * @param timeoutMs - the exec budget.
 * @returns listening ports, ascending; [] on a failed scan.
 */
export declare function listeningPorts(runner: AgentExecRunner, timeoutMs?: number): Promise<number[]>;
