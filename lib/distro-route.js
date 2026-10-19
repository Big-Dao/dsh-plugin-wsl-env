/**
 * Which distro an operation belongs to.
 *
 * The pinned name has three spellings: an explicit distro wins, `"default"`
 * forces WSL's own default, and the empty string or `"auto"` follows the
 * workspace coordinate when the caller has one. The workspace coordinate is a
 * `\\wsl.localhost\<distro>\...` path; a Linux, drive-letter or relative path
 * carries no distro evidence and falls back to WSL's default.
 *
 * Pure by construction: the caller resolves the default distro once and the
 * selection stays unit-testable without `wsl.exe`.
 *
 * This is a TypeScript source built to `lib/distro-route.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/distro-route
 */
import { uncToPosix } from "./paths.js";
/**
 * The distro a UNC path names.
 *
 * @param value - any path spelling.
 * @returns the distro name, or undefined for a non-WSL path.
 */
export function distroOfUnc(value) {
    const text = String(value ?? "").trim();
    return text.length === 0 ? undefined : uncToPosix(text)?.distro;
}
/**
 * The explicit `distro` config value, or undefined for `""`, `"auto"` and
 * `"default"`.
 *
 * @param configured - the row's `distro` value.
 * @returns the pinned distro, or undefined when the value is a mode.
 */
export function pinnedDistro(configured) {
    const text = String(configured ?? "").trim();
    if (text.length === 0)
        return undefined;
    const mode = text.toLowerCase();
    return mode === "auto" || mode === "default" ? undefined : text;
}
/**
 * Whether `distro: ""`/`"auto"` asks the workspace coordinate to decide.
 *
 * @param configured - the row's `distro` value.
 * @returns true for the automatic modes.
 */
export function isAutoDistro(configured) {
    const text = String(configured ?? "").trim().toLowerCase();
    return text.length === 0 || text === "auto";
}
/**
 * Whether `distro: "default"` forces WSL's own default.
 *
 * @param configured - the row's `distro` value.
 * @returns true for the explicit default mode.
 */
export function isDefaultDistro(configured) {
    return String(configured ?? "").trim().toLowerCase() === "default";
}
/**
 * Select the distro for one operation.
 *
 * Order: an explicit distro wins; `"default"` takes the fallback; otherwise the
 * first candidate that names a UNC distro wins, and the fallback closes the
 * list. The candidate order matters — a request's workdir is stronger evidence
 * than the configured default cwd.
 *
 * @param input - the configured value, the path candidates, and WSL's default.
 * @returns the distro and why it was chosen.
 */
export function selectDistro({ configured, candidates, fallback }) {
    const pinned = pinnedDistro(configured);
    if (pinned !== undefined)
        return { distro: pinned, source: "pinned" };
    if (isDefaultDistro(configured))
        return { distro: fallback, source: "default" };
    for (const candidate of candidates) {
        const named = distroOfUnc(candidate);
        if (named !== undefined)
            return { distro: named, source: "workspace" };
    }
    return { distro: fallback, source: "default" };
}
