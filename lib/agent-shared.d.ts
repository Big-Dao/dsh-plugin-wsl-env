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
import { WslAgent } from "./agent.js";
/**
 * How long the native entry stays demoted once it failed a start that the
 * shell entry then made on the same distro. A demotion is a verdict about
 * the moment, not the process — a reinstalled or resynced binary, or a cache
 * directory made executable, works without an app restart — so the entry is
 * tried again after this long; a still-broken one costs its next start one
 * failed round trip and is demoted again.
 */
export declare const NATIVE_DEMOTION_MS = 300000;
/** What one distro's starts have said so far about its native entry. */
export interface NativeVerdict {
    /** The native entry failed its last start; the shell entry's next start decides. */
    suspect: boolean;
    /** When a demotion ends, epoch ms; 0 while the entry is not demoted. */
    demotedUntil: number;
}
/** @returns a verdict nothing has been said about yet. */
export declare function freshNativeVerdict(): NativeVerdict;
/**
 * Whether a start may use the native entry. A suspicion says no: the next
 * start is the shell entry's, and its outcome is what turns the suspicion
 * into a verdict. A demotion says no until it ends.
 *
 * @param verdict - the distro's verdict.
 * @param now - the current time, epoch ms.
 * @returns true when the native entry may be tried.
 */
export declare function nativeEntryAllowed(verdict: NativeVerdict, now: number): boolean;
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
export declare function recordStart(verdict: NativeVerdict, outcome: {
    ok: boolean;
    native: boolean;
}, now: number): void;
/** The agent script as a host-side path, for factories that need both spellings. */
export declare const agentScriptPath: string;
/** The sha256 of the shipped agent script; every resident verifies its HELLO against it. */
export declare const agentScriptDigest: string;
/**
 * The shared agent for one distro: created on first use, and the same
 * instance on every call after that — through deaths, revivals and a change
 * of entry. Its own lifecycle is the recovery; a caller that finds it
 * unavailable (`status().state === "dead"`) falls back for that call.
 *
 * @param distro - the distro name.
 * @returns the shared agent.
 */
export declare function sharedAgent(distro: string): WslAgent;
/**
 * Why the shared resident is not on the native entry though the backend asks
 * for it, for a diagnosis: the entry is demoted, or it just failed a start.
 * Undefined when neither is the case.
 *
 * @param distro - the distro name.
 * @returns the reason, or undefined.
 */
export declare function sharedAgentNativeNote(distro: string): string | undefined;
/**
 * Forget every shared agent and every native verdict; tests only.
 */
export declare function resetSharedAgents(): void;
