/**
 * Whether a newly created session should adopt the WSL preset.
 *
 * The rule is deliberately narrow, and it is the whole of "a session whose workspace
 * is inside a distro gets the distro environment automatically":
 *
 *   - the workspace must be a WSL UNC path, so a Windows folder keeps its own
 *     environment;
 *   - the session must not already carry an explicit choice. `undefined` counts as
 *     "no choice", because a caller that mounts nothing at all (the headless runner)
 *     is not asking for the host environment either; anything else must equal the
 *     registry's default id, which is what "the operator did not pick one" looks like
 *     after composition.
 *
 * Pure, so the decision is unit-testable without a boot — the frame timing that
 * applies it still needs the harness.
 *
 * This is a TypeScript source built to `lib/preset-choice.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 */

import { isWslUnc } from "./paths.js";

/** One directory that must keep the host environment, as a normalized UNC path. */
function normalizeWorkspace(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+$/, "");
  return trimmed.replace(/\//g, "\\").toLowerCase();
}

/**
 * Whether a workspace lies inside one of the directories the operator opened
 * for Windows access (9p) instead of the distro environment.
 *
 * The comparison is prefix-based on whole path segments: `\\wsl.localhost\ubuntu\a`
 * matches the directory itself and everything below it, but not `…\ab`. Paths
 * are Windows/UNC paths, hence case-insensitive.
 *
 * @param cwd - the session's workspace directory.
 * @param windowsAccess - directories opened in Windows access mode.
 * @returns true when this workspace opted out of the distro environment.
 */
export function isWindowsAccessWorkspace(cwd: string, windowsAccess: readonly string[]): boolean {
  const target = normalizeWorkspace(cwd);
  return windowsAccess.some((entry) => {
    // The list is settings-sourced. A malformed entry is ignored rather than
    // allowed to fail a session creation or an adoption decision.
    if (typeof entry !== "string" || entry.trim() === "") return false;
    const base = normalizeWorkspace(entry);
    return target === base || target.startsWith(`${base}\\`);
  });
}


/**
 * Whether a session-creation preset id leaves the environment to this plugin.
 *
 * An absent id means the caller mounted nothing (the headless runner); the
 * registry's default id means the caller passed the default explicitly, which
 * is not a pick of a different environment. A non-default id is an operator's
 * choice and must win.
 *
 * @param presetId - the preset id the session controller received.
 * @param fallback - the registry's default id, when it exposes one.
 * @returns true when the WSL preset may be selected for the session.
 */
export function isDefaultPresetChoice(presetId: string | undefined, fallback: string | undefined): boolean {
  return presetId === undefined || (fallback !== undefined && presetId === fallback);
}

/**
 * The adoption decision.
 *
 * `windowsAccess` lists directories the operator explicitly opened for Windows
 * access; a session inside one of them keeps the host preset, so the choice
 * survives every later session in that workspace rather than only the one the
 * operator answered the dialog for.
 *
 * @param input - the new session's workspace, the preset it currently has, the
 *   registry default, and the directories reserved for Windows access.
 * @returns true when the WSL preset should be selected for this session.
 */
export function shouldAdoptWslPreset({ cwd, current, fallback, windowsAccess }: {
  cwd?: string,
  current?: string,
  fallback?: string,
  windowsAccess?: readonly string[],
} = {}): boolean {
  if (cwd === undefined || !isWslUnc(cwd)) return false;
  if (windowsAccess !== undefined && isWindowsAccessWorkspace(cwd, windowsAccess)) return false;
  if (current === void 0) return true;
  return current === fallback;
}
