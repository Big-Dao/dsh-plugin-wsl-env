/**
 * The per-distro resident agent shared by every provider in this process.
 *
 * Extracted from `lib/index.js` so modules the index does not import back
 * (`shell-env`, future consumers) can use the same peer without a cycle: the
 * shell executor's commands, the filesystem's in-distro side work and the
 * port snapshot all queue on ONE agent per distro, and the per-distro startup
 * cost is paid once per process.
 *
 * One instance per distro for the life of the process, and never a second:
 * every holder (the executor, the filesystem provider, the picker, the git
 * and search handles, the doctor) addresses the same object, so the state a
 * diagnosis reads is the state the file operations run on. The instance owns
 * its own recovery — one rebuild per death, then a bounded revival — and this
 * module does not second-guess it by swapping in a fresh one, which used to
 * reset that budget at the first death and, at the same time, retire the
 * native entry for good.
 *
 * The ENTRY is chosen per start, not per process: the native binary when the
 * backend allows it and it comes up, the shell script otherwise. The native
 * entry is demoted only on evidence that it is the one at fault — it failed
 * a start and the shell entry then started on the same distro — and only for
 * a while, after which it is tried again.
 *
 * This is a TypeScript source built to `lib/agent-shared.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/agent-shared
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toLinuxPath } from "./paths.js";
import { pinnedWindowsEnv, WslAgent, type WslAgentPrepared } from "./agent.js";
import { configuredAgentBackend, ensureNativeBackend } from "./native-agent.js";

const AGENT_SCRIPT_PATH = fileURLToPath(new URL("../agent/wsl-agent.sh", import.meta.url));
// The script the distro reads must be byte-identical to the copy this package
// shipped: the deployed layout reads it from the /mnt/c mirror, and the
// handshake digest is what catches a stale or half-synced runtime copy.
// Both resident factories (plain and confined) pin it.
const AGENT_SCRIPT_DIGEST = createHash("sha256").update(readFileSync(AGENT_SCRIPT_PATH)).digest("hex");
const sharedAgents = new Map<string, WslAgent>();
/** Each distro's verdict on its native entry, created on its first report. */
const nativeVerdicts = new Map<string, NativeVerdict>();

/**
 * How long the native entry stays demoted once it failed a start that the
 * shell entry then made on the same distro. A demotion is a verdict about
 * the moment, not the process — a reinstalled or resynced binary, or a cache
 * directory made executable, works without an app restart — so the entry is
 * tried again after this long; a still-broken one costs its next start one
 * failed round trip and is demoted again.
 */
export const NATIVE_DEMOTION_MS = 300_000;

/** What one distro's starts have said so far about its native entry. */
export interface NativeVerdict {
  /** The native entry failed its last start; the shell entry's next start decides. */
  suspect: boolean;
  /** When a demotion ends, epoch ms; 0 while the entry is not demoted. */
  demotedUntil: number;
}

/** @returns a verdict nothing has been said about yet. */
export function freshNativeVerdict(): NativeVerdict {
  return { suspect: false, demotedUntil: 0 };
}

/**
 * Whether a start may use the native entry. A suspicion says no: the next
 * start is the shell entry's, and its outcome is what turns the suspicion
 * into a verdict. A demotion says no until it ends.
 *
 * @param verdict - the distro's verdict.
 * @param now - the current time, epoch ms.
 * @returns true when the native entry may be tried.
 */
export function nativeEntryAllowed(verdict: NativeVerdict, now: number): boolean {
  if (verdict.suspect) return false;
  return verdict.demotedUntil <= now;
}

/**
 * Read one start's outcome into the verdict.
 *
 * A failed native start is a suspicion, not a verdict: a distro that is down
 * fails both entries alike, and must not retire a healthy binary. The shell
 * entry starting right after it is the evidence — same distro, one entry up
 * and one down — and that is what demotes the native entry. A native start
 * that succeeds clears both.
 *
 * @param verdict - the distro's verdict; updated in place.
 * @param outcome - how the start ended, and with which entry.
 * @param now - the current time, epoch ms.
 */
export function recordStart(verdict: NativeVerdict, outcome: { ok: boolean, native: boolean }, now: number): void {
  if (outcome.ok) {
    if (!outcome.native && verdict.suspect) verdict.demotedUntil = now + NATIVE_DEMOTION_MS;
    if (outcome.native || verdict.suspect) verdict.suspect = false;
    return;
  }
  if (outcome.native) verdict.suspect = true;
}

/** The agent script as a host-side path, for factories that need both spellings. */
export const agentScriptPath = AGENT_SCRIPT_PATH;

/** The sha256 of the shipped agent script; every resident verifies its HELLO against it. */
export const agentScriptDigest = AGENT_SCRIPT_DIGEST;

/**
 * The distro's verdict.
 *
 * @param distro - the distro the resident serves.
 * @returns the verdict, created on first use.
 */
function verdictOf(distro: string): NativeVerdict {
  let verdict = nativeVerdicts.get(distro);
  if (verdict === undefined) nativeVerdicts.set(distro, (verdict = freshNativeVerdict()));
  return verdict;
}

/**
 * The entry one start of the shared resident uses: the native binary when the
 * backend allows it, the verdict permits it and its preparation succeeds;
 * nothing (the instance's own shell entry) otherwise.
 *
 * @param distro - the distro the resident serves.
 * @returns the native entry, or undefined for the shell entry.
 */
async function prepareSharedEntry(distro: string): Promise<WslAgentPrepared | undefined> {
  if (configuredAgentBackend() === "shell") return undefined;
  // Not allowed means one of two things: the native entry just failed — this
  // start finds out whether the distro is the problem or the binary is, by
  // running the shell entry instead — or it is demoted.
  if (!nativeEntryAllowed(verdictOf(distro), Date.now())) return undefined;
  const prepared = await ensureNativeBackend({ wslPath: "wsl.exe", distro, source: process.env.DSH_WSL_AGENT_NATIVE ?? "" });
  if (prepared === undefined) return undefined;
  return {
    scriptPath: prepared.path,
    expectedDigest: prepared.digest,
    signalable: false,
    serialRequests: false,
    spawnTransport: ({ wslPath, distro: target, argvPrefix }) =>
      spawn(wslPath, ["-d", target, "--exec", ...argvPrefix, prepared.path], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: pinnedWindowsEnv(process.env),
      }),
  };
}

/**
 * The shared agent for one distro: created on first use, and the same
 * instance on every call after that — through deaths, revivals and a change
 * of entry. Its own lifecycle is the recovery; a caller that finds it
 * unavailable (`status().state === "dead"`) falls back for that call.
 *
 * @param distro - the distro name.
 * @returns the shared agent.
 */
export function sharedAgent(distro: string): WslAgent {
  let agent = sharedAgents.get(distro);
  if (agent === undefined) {
    agent = new WslAgent({
      distro,
      scriptPath: toLinuxPath(AGENT_SCRIPT_PATH),
      expectedDigest: AGENT_SCRIPT_DIGEST,
      prepare: () => prepareSharedEntry(distro),
      onStart: (outcome) => recordStart(verdictOf(distro), outcome, Date.now()),
    });
    sharedAgents.set(distro, agent);
  }
  return agent;
}

/**
 * Why the shared resident is not on the native entry though the backend asks
 * for it, for a diagnosis: the entry is demoted, or it just failed a start.
 * Undefined when neither is the case.
 *
 * @param distro - the distro name.
 * @returns the reason, or undefined.
 */
export function sharedAgentNativeNote(distro: string): string | undefined {
  const verdict = nativeVerdicts.get(distro);
  if (verdict === undefined) return undefined;
  if (verdict.demotedUntil > Date.now()) {
    return `the native agent failed to start on this distro while the shell agent started, so reads run on the shell agent; it is tried again in ${Math.ceil((verdict.demotedUntil - Date.now()) / 1000)}s`;
  }
  if (verdict.suspect) return "the native agent failed its last start on this distro; the shell agent is tried next";
  return undefined;
}

/**
 * Forget every shared agent and every native verdict; tests only.
 */
export function resetSharedAgents(): void {
  sharedAgents.clear();
  nativeVerdicts.clear();
}
