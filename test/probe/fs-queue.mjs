#!/usr/bin/env node
/**
 * FS queue/latency measurement (A6).
 *
 * Measures the two FS agents a session actually uses:
 *   - the shared shell read agent (`sharedAgent`, unconfined reads);
 *   - the session runtime's native agent (confined writes + EXECs).
 *
 * The scenarios are sequential vs concurrent `stat`/`read`/`list`/`write` and
 * EXEC calls — a synthetic proxy for the GUI file tree, the model's file tools
 * and parallel subagents. Each scenario reports wall time, per-op latency, the
 * queue wait (sent -> ACK) and the in-flight peak from `WslAgent.metrics()`.
 *
 *   node test/probe/fs-queue.mjs
 *
 * Requires WSL + systemd (the session runtime) and the packaged native binary;
 * env overrides: DSH_WSL_PROBE_DISTRO, DSH_WSL_AGENT_NATIVE, DSH_FS_QUEUE_N.
 */
import { sharedAgent } from "../../lib/agent-shared.js";
import { ensureNativeBackend, NATIVE_AGENT_ENV } from "../../lib/native-agent.js";
import { SessionRuntimes, setSessionNativeAgent } from "../../lib/session-runtime.js";

const distro = process.env.DSH_WSL_PROBE_DISTRO ?? process.env.WSL_DISTRO_NAME ?? "ubuntu";
const source = process.env[NATIVE_AGENT_ENV] ?? "";
const N = Number(process.env.DSH_FS_QUEUE_N ?? "16");
/**
 * Rounds a millisecond value to one decimal.
 * @param {number} value - the value.
 * @returns {number} the rounded value.
 */
const round = (value) => Math.round(value * 10) / 10;

/**
 * Runs one scenario against one agent and records its metrics.
 * @param {string} label - scenario label.
 * @param {import("../../lib/agent.js").WslAgent} agent - the agent under test.
 * @param {number} count - request count.
 * @param {(index: number) => Promise<unknown>} action - one request.
 * @param {boolean} concurrent - parallel or sequential.
 * @returns {Promise<Record<string, unknown>>} the row.
 */
const scenario = async (label, agent, count, action, concurrent) => {
  agent.resetMetrics();
  const started = performance.now();
  let ok = 0;
  let failed = 0;
  /** @param {number} index - the request index. */
  const run = async (index) => {
    try {
      await action(index);
      ok += 1;
    } catch {
      failed += 1;
    }
  };
  if (concurrent) await Promise.all(Array.from({ length: count }, (_, index) => run(index)));
  else for (let index = 0; index < count; index += 1) await run(index);
  const wall = performance.now() - started;
  const m = agent.metrics();
  const fs = m.fs;
  const exec = m.exec;
  const requests = fs.requests + exec.requests;
  return {
    label,
    count,
    ok,
    failed,
    wall: round(wall),
    perOp: round(wall / Math.max(1, count)),
    fsQueueAvg: round(fs.queueMs / Math.max(1, fs.requests)),
    fsQueueMax: round(fs.queueMaxMs),
    fsExecAvg: round(fs.execMs / Math.max(1, fs.requests)),
    execQueueMax: round(exec.queueMaxMs),
    inFlightMax: m.inFlightMax,
    rejected: fs.rejected + exec.rejected,
    requests,
  };
};

const rows = [];
const shared = sharedAgent(distro);
/** @param {number} index - the request index. */
const statAction = (index) => shared.fs({ op: "stat", args: [index % 2 === 0 ? "/" : "/tmp"] });
/** @param {number} index - the request index. */
const readAction = (index) => shared.fs({ op: "read", args: [index % 2 === 0 ? "/etc/hostname" : "/etc/os-release", "0", "4096"] });
/** @param {number} index - the request index. */
const listAction = (index) => shared.fs({ op: "list", args: [index % 2 === 0 ? "/tmp" : "/etc"] });

rows.push(await scenario(`shared stat sequential (${N})`, shared, N, statAction, false));
rows.push(await scenario(`shared stat concurrent (${N})`, shared, N, statAction, true));
rows.push(await scenario(`shared read concurrent (${N})`, shared, N, readAction, true));
rows.push(await scenario(`shared list concurrent (${N})`, shared, N, listAction, true));

const prepared = await ensureNativeBackend({ wslPath: "wsl.exe", distro, source });
if (prepared === undefined) {
  console.log(rows);
  console.log("native backend unavailable; only the shared read rows were measured");
  process.exit(1);
}
setSessionNativeAgent(distro, prepared.path, prepared.digest);
const registry = new SessionRuntimes();
/** @type {import("../../lib/session-runtime.js").SessionRuntimeEntry | undefined} */
let entry;
try {
  entry = registry.acquire({ distro, wslPath: "wsl.exe", workspaceRoot: process.cwd(), mode: "workspace-write" });
  const agent = entry.agent;
  const marker = `/tmp/dsh-fs-queue-${process.pid}`;
  /** @param {number} index - the request index. */
  const writeAction = (index) => agent.fs({ op: "write", args: [`${marker}-${index}`, "644", "replace", "-", Buffer.from(`payload-${index}`).toString("base64")] });
  const execAction = () => agent.exec({ cwd: "/", argv: ["sh", "-c", "sleep 0.05; printf ok"], timeoutMs: 5000 });
  const readBack = () => agent.fs({ op: "read", args: [`${marker}-0`, "0", "4096"] });
  rows.push(await scenario(`native write sequential (${N})`, agent, N, writeAction, false));
  rows.push(await scenario(`native write concurrent (${N})`, agent, N, writeAction, true));
  rows.push(await scenario(`native read concurrent (${N})`, agent, N, readBack, true));
  rows.push(await scenario(`native exec concurrent (${N})`, agent, N, execAction, true));
  // Mixed: shared reads and native writes at the same time (two agents).
  agent.resetMetrics();
  shared.resetMetrics();
  const mixedStart = performance.now();
  await Promise.all([
    ...Array.from({ length: N }, (_, index) => statAction(index)),
    ...Array.from({ length: N }, (_, index) => writeAction(index)),
  ]);
  const mixedWall = performance.now() - mixedStart;
  const mixedAgent = agent.metrics();
  rows.push({
    label: `mixed ${N} shared stat + ${N} native write`,
    count: N * 2,
    ok: N * 2,
    failed: 0,
    wall: round(mixedWall),
    perOp: round(mixedWall / (N * 2)),
    fsQueueAvg: round(mixedAgent.fs.queueMs / Math.max(1, mixedAgent.fs.requests)),
    fsQueueMax: round(mixedAgent.fs.queueMaxMs),
    fsExecAvg: round(mixedAgent.fs.execMs / Math.max(1, mixedAgent.fs.requests)),
    execQueueMax: 0,
    inFlightMax: mixedAgent.inFlightMax,
    rejected: 0,
    requests: N * 2,
  });
} finally {
  if (entry !== undefined) await registry.release(entry.key);
  setSessionNativeAgent(distro, "");
  await shared.close();
}
console.log(JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} scenarios; shared read rows show the shell's serial queue; native rows show the FS mutex and the concurrent EXEC.`);
