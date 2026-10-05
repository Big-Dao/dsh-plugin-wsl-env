/**
 * Which execution world a terminal launch belongs to.
 *
 * The terminal controller hands this provider the request's directory, and the
 * directory's coordinate system is the evidence of intent: a UNC path under a
 * distro's share names a WSL session outright, a POSIX absolute path is a
 * distro path by construction, and a Windows drive path is a session opened on
 * a Windows folder — which deserves a HOST shell, not the distro's shell
 * started at `/mnt/<drive>/…`. An empty directory carries no evidence either
 * way and defaults to the distro, which is what a profile pins.
 *
 * Pure by construction.
 *
 * This is a TypeScript source built to `lib/terminal-route.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/terminal-route
 */

import { isPosixAbsolute, uncToPosix, windowsToLinuxMount } from "./paths.js";

/**
 * The route decision for one terminal launch.
 *
 * @param cwd - the terminal request's working directory, any coordinate system.
 * @returns `"distro"` when the launch belongs inside the pinned distro,
 *   `"host"` when it belongs to a Windows-folder session.
 */
export function terminalRoute(cwd: string | undefined): "distro" | "host" {
  const text = String(cwd ?? "").trim();
  if (text.length === 0) return "distro";
  if (uncToPosix(text) !== undefined) return "distro";
  if (isPosixAbsolute(text)) return "distro";
  if (windowsToLinuxMount(text) !== undefined) return "host";
  return "distro";
}
