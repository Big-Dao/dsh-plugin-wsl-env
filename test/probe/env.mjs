/**
 * Machine facts the Node-side probes share.
 *
 * The probe scripts derive these from the machine (`test/probe/env.sh`) and export
 * them, so a probe can ask for what it needs instead of carrying a Windows user name
 * or a hard-coded distro. When a value is missing, the probe derives it from its own
 * location, which is already the right shape: this file is loaded from the UNC share
 * of the distro that hosts the checkout.
 *
 * @module dsh-plugin-wsl/test/probe/env
 */
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** This directory, in the spelling the hosting process uses. */
export const PROBE_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The distro: the exported name, else the UNC share of this checkout
 * (`\\wsl.localhost\ubuntu\...` — the share component is the distro).
 */
export const DISTRO = process.env.DSH_WSL_ENV_DISTRO ?? (PROBE_DIR.match(/^\\\\[^\\]+\\([^\\]+)\\/)?.[1] ?? "");

/** The `wsl.exe` arguments that address DISTRO, or none when it is unknown. */
const distroArgs = DISTRO === "" ? [] : ["-d", DISTRO];

/** Run one command in the distro and return its trimmed stdout. */
export function inDistro(...argv) {
  return execFileSync("wsl.exe", [...distroArgs, "--exec", ...argv], {
    encoding: "utf8",
    env: { ...process.env, WSL_UTF8: "1" },
  }).trim();
}

/** The distro user's home, asked of the distro rather than assumed. */
export function distroHome() {
  return inDistro("sh", "-c", 'printf %s "$HOME"');
}

/** The UNC spelling of an absolute POSIX path inside the distro. */
export function windowsPath(linuxPath) {
  return `\\\\wsl.localhost\\${DISTRO}${linuxPath.replace(/\//g, "\\")}`;
}
