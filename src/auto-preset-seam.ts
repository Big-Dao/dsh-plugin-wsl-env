/**
 * The live state of auto-preset's creation-time preset seam.
 *
 * The seam is host-process state: `auto-preset` wraps
 * `sessionController.agents.createSession(request)` so a distro workspace's
 * very first mount is the WSL preset. Whether that method exists is a property
 * of the running host, not of any file on disk — the standalone doctor CLI
 * cannot see it, exactly as it cannot see a live resident's `deaths` or
 * `lastError` (see doctor-live). The in-app doctor surfaces therefore read this
 * module singleton and merge the state into their reports.
 *
 * `unknown` means the row has not mounted in this process yet (or this is a
 * composition without it); `inactive` means the row mounted but the host's
 * controller exposed no `agents.createSession` — the case that must not stay
 * silent.
 *
 * @module dsh-plugin-wsl-env/auto-preset-seam
 */

/** Whether the creation-time seam is available in this process. */
export type AutoPresetSeamState = "active" | "inactive" | "unknown";

/** One publication of the seam state. */
export interface AutoPresetSeam {
  /** The seam's availability. */
  readonly state: AutoPresetSeamState;
  /** The wrapped method, when the seam is active. */
  readonly method?: string;
  /** Why the state is what it is, in one line. */
  readonly reason: string;
  /** When the state was published, in epoch milliseconds. */
  readonly at: number;
}

/** The state before the row mounts; a report that sees it says so instead of guessing. */
let seam: AutoPresetSeam = {
  state: "unknown",
  reason: "the auto-preset row has not mounted in this process",
  at: 0,
};

/**
 * Publish the seam state for the in-app doctor surfaces.
 *
 * @param state - the availability to record.
 * @param reason - one line explaining the state.
 * @param method - the wrapped method, when active.
 */
export function publishAutoPresetSeam(state: AutoPresetSeamState, reason: string, method?: string): void {
  seam = {
    state,
    reason,
    at: Date.now(),
    ...(method === undefined ? {} : { method }),
  };
}

/**
 * Read the current seam state.
 *
 * @returns the last published state.
 */
export function autoPresetSeam(): AutoPresetSeam {
  return seam;
}
