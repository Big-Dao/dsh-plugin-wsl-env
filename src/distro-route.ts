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

/** Why a distro was selected, for diagnostics and for the docs. */
export type DistroSource = "pinned" | "workspace" | "default";

/** One distro selection. */
export interface DistroChoice {
  /** The distro name to use. */
  distro: string;
  /** Whether the name came from the config, the path, or WSL's default. */
  source: DistroSource;
}

/**
 * The distro a UNC path names.
 *
 * @param value - any path spelling.
 * @returns the distro name, or undefined for a non-WSL path.
 */
export function distroOfUnc(value: string | undefined): string | undefined {
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
export function pinnedDistro(configured: string | undefined): string | undefined {
  const text = String(configured ?? "").trim();
  if (text.length === 0) return undefined;
  const mode = text.toLowerCase();
  return mode === "auto" || mode === "default" ? undefined : text;
}

/**
 * Whether `distro: ""`/`"auto"` asks the workspace coordinate to decide.
 *
 * @param configured - the row's `distro` value.
 * @returns true for the automatic modes.
 */
export function isAutoDistro(configured: string | undefined): boolean {
  const text = String(configured ?? "").trim().toLowerCase();
  return text.length === 0 || text === "auto";
}

/**
 * Whether `distro: "default"` forces WSL's own default.
 *
 * @param configured - the row's `distro` value.
 * @returns true for the explicit default mode.
 */
export function isDefaultDistro(configured: string | undefined): boolean {
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
export function selectDistro({ configured, candidates, fallback }: {
  /** The row's `distro` value. */
  configured: string | undefined,
  /** Paths in any coordinate system, strongest evidence first. */
  candidates: ReadonlyArray<string | undefined>,
  /** WSL's default distro, already resolved by the caller. */
  fallback: string,
}): DistroChoice {
  const pinned = pinnedDistro(configured);
  if (pinned !== undefined) return { distro: pinned, source: "pinned" };
  if (isDefaultDistro(configured)) return { distro: fallback, source: "default" };
  for (const candidate of candidates) {
    const named = distroOfUnc(candidate);
    if (named !== undefined) return { distro: named, source: "workspace" };
  }
  return { distro: fallback, source: "default" };
}
