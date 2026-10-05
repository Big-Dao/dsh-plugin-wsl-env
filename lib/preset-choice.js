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
/**
 * The adoption decision.
 *
 * @param input - the new session's workspace, the preset it currently has, and
 *   the registry default.
 * @returns true when the WSL preset should be selected for this session.
 */
export function shouldAdoptWslPreset({ cwd, current, fallback } = {}) {
    if (cwd === undefined || !isWslUnc(cwd))
        return false;
    if (current === void 0)
        return true;
    return current === fallback;
}
