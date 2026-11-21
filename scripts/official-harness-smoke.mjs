/**
 * Official Harness Desktop package smoke (fail-close orchestrator).
 *
 * Consumes DSH_OFFICIAL_HARNESS_VERSION, DSH_PLUGIN_PACKAGE_TARBALL,
 * DSH_WSL_ENV_DISTRO and DSH_WSL_ENV_PROFILE (all required). Resolves the official
 * installer from the official CDN (download.deepseek.com; the upstream GitHub
 * releases publish no installers), records package identity and integrity,
 * runs scripts/official-harness-smoke.ps1 and writes
 * test/probe/.scratch/official-harness-smoke.results. Exit 0 only when every check PASSed;
 * a missing input, non-Windows host or any failure is FAIL / NOT RUN with a nonzero exit.
 *
 * @module dsh-plugin-wsl/scripts/official-harness-smoke
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RESULTS_FILE = join(ROOT, "test", "probe", ".scratch", "official-harness-smoke.results");
export const CDN_BASE = "https://download.deepseek.com/dsh-desk/bin/win-x64";
export const PACKAGE_NAME = "dsh-plugin-wsl-env";
const REQUIRED_ENV = [
  "DSH_OFFICIAL_HARNESS_VERSION",
  "DSH_PLUGIN_PACKAGE_TARBALL",
  "DSH_WSL_ENV_DISTRO",
  "DSH_WSL_ENV_PROFILE",
];
/** @typedef {[string, string, string]} Row */
/** @typedef {{ name: string, url: string, sha256: string, checksumUrl: string }} Installer */
/** @typedef {(url: string, init?: object) => Promise<{ ok: boolean, status: number }>} Fetch */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validate the required inputs; returns the list of problems (empty when valid).
 * @param {Record<string, string | undefined>} env
 */
export function validateEnv(env) {
  const problems = [];
  for (const key of REQUIRED_ENV) {
    if (!env[key] || env[key].trim() === "") problems.push(`${key} is not set`);
  }
  if (env.DSH_WSL_ENV_DISTRO && !SAFE_NAME.test(env.DSH_WSL_ENV_DISTRO)) {
    problems.push("DSH_WSL_ENV_DISTRO is not a valid distro name");
  }
  if (env.DSH_WSL_ENV_PROFILE && !SAFE_NAME.test(env.DSH_WSL_ENV_PROFILE)) {
    problems.push("DSH_WSL_ENV_PROFILE is not a valid profile name");
  }
  if (env.DSH_OFFICIAL_HARNESS_VERSION && !/^v?\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(env.DSH_OFFICIAL_HARNESS_VERSION)) {
    problems.push("DSH_OFFICIAL_HARNESS_VERSION is not an exact version");
  }
  return problems;
}

/**
 * The PowerShell executable to use: pwsh, else Windows PowerShell.
 * @param {(exe: string) => boolean} [probe]
 */
export function resolvePowerShell(probe = defaultProbe) {
  for (const exe of ["pwsh.exe", "powershell.exe"]) {
    if (probe(exe)) return exe;
  }
  return null;
}

/** @param {string} exe */
function defaultProbe(exe) {
  const r = spawnSync(exe, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
  return r.status === 0;
}

/**
 * The official CDN's versioned installer path for a Windows x64 build. The
 * fixed `latest` alias resolves to a different version over time, so only this
 * exact-version path is usable as release evidence.
 * @param {string} version - exact version, with or without a leading `v`.
 * @returns {{ name: string, url: string }} the installer file name and its URL.
 */
export function installerUrl(version) {
  const bare = version.replace(/^v/, "");
  const name = `deepseek-harness-${bare}-win-x64.exe`;
  return { name, url: `${CDN_BASE}/${name}` };
}

/**
 * Resolve the official installer at an exact version. No official checksum is
 * published alongside the CDN object, so the smoke records the downloaded
 * file's own sha256 instead of verifying a published one (the design requires
 * verification only where an official checksum exists).
 * @param {string} version
 * @param {Fetch} [fetchImpl]
 */
export async function resolveInstaller(version, fetchImpl = /** @type {Fetch} */ (fetch)) {
  const { name, url } = installerUrl(version);
  const res = await fetchImpl(url, {
    method: "HEAD",
    headers: { "User-Agent": "dsh-plugin-wsl-env-smoke" },
  });
  if (!res.ok) throw new Error(`official installer for ${version} not resolvable at ${url} (HTTP ${res.status})`);
  return /** @type {Installer} */ ({ name, url, sha256: "", checksumUrl: "" });
}

/**
 * Candidate tarball identity: `dsh-plugin-wsl-env@<version>` plus sha512 integrity.
 * @param {string} tarball
 * @param {(tarball: string) => string} [readManifest]
 */
export function tarballIdentity(tarball, readManifest = defaultReadManifest) {
  const manifest = JSON.parse(readManifest(tarball));
  if (manifest.name !== PACKAGE_NAME) throw new Error(`tarball package is ${manifest.name}, expected ${PACKAGE_NAME}`);
  if (typeof manifest.version !== "string" || manifest.version === "") throw new Error("tarball has no version");
  const integrity = `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`;
  return { identity: `${PACKAGE_NAME}@${manifest.version}`, integrity };
}

/** @param {string} tarball */
function defaultReadManifest(tarball) {
  return execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" });
}

/**
 * Render result rows; a row is `[status, name, detail]`.
 * @param {Row[]} rows
 */
export function formatResults(rows) {
  return rows.map(([s, n, d]) => `${s}\t${n}${d ? `\t${d}` : ""}`).join("\n") + "\n";
}

/**
 * The overall exit code: 0 only when there are rows and every row is PASS.
 * @param {Row[]} rows
 */
export function exitCodeFor(rows) {
  return rows.length > 0 && rows.every(([s]) => s === "PASS") ? 0 : 1;
}

/** @param {Row[]} rows */
function write(rows) {
  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  writeFileSync(RESULTS_FILE, formatResults(rows), "utf8");
  process.stdout.write(formatResults(rows));
}

/** @param {unknown} err */
function errMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Run the smoke; returns the process exit code.
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [platform]
 */
export async function run(env = process.env, platform = process.platform) {
  /** @type {Row[]} */
  const rows = [];
  const fail = (/** @type {string} */ name, /** @type {string} */ detail, status = "FAIL") => {
    rows.push([status, name, detail]);
    write(rows);
    return 1;
  };
  const problems = validateEnv(env);
  if (problems.length > 0) return fail("inputs", problems.join("; "), "NOT RUN");
  if (platform !== "win32") return fail("platform", "official Desktop smoke requires Windows", "NOT RUN");
  rows.push(["PASS", "inputs", `harness ${env.DSH_OFFICIAL_HARNESS_VERSION}, distro ${env.DSH_WSL_ENV_DISTRO}, profile ${env.DSH_WSL_ENV_PROFILE}`]);
  // Runner and workflow identity so the results file is attributable when read
  // back from an artifact (the evidence contract in the probe gate design).
  rows.push([
    "PASS",
    "context",
    `workflow ${env.GITHUB_WORKFLOW ?? "local"}, run ${env.GITHUB_RUN_ID ?? "local"}, runner ${env.RUNNER_OS ?? process.platform}, job ${env.GITHUB_JOB ?? "local"}`,
  ]);

  const tarball = resolve(String(env.DSH_PLUGIN_PACKAGE_TARBALL));
  let pkg;
  try {
    if (!existsSync(tarball)) throw new Error(`tarball not found: ${tarball}`);
    pkg = tarballIdentity(tarball);
  } catch (err) {
    return fail("package-identity", errMessage(err));
  }
  rows.push(["PASS", "package-identity", `${pkg.identity} ${pkg.integrity}`]);

  let installer;
  try {
    installer = await resolveInstaller(String(env.DSH_OFFICIAL_HARNESS_VERSION));
  } catch (err) {
    return fail("installer-resolution", errMessage(err));
  }
  rows.push(["PASS", "installer-resolution", `official CDN ${installer.url}`]);

  const ps = resolvePowerShell();
  if (!ps) return fail("powershell", "neither pwsh.exe nor powershell.exe is available");

  const checksFile = join(dirname(RESULTS_FILE), "official-harness-smoke.checks");
  // A fresh checkout has no .scratch/ (it is gitignored); only the results
  // write below creates it, and that runs after this file must exist.
  mkdirSync(dirname(checksFile), { recursive: true });
  writeFileSync(checksFile, "", "utf8");
  const child = spawnSync(
    ps,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "official-harness-smoke.ps1")],
    {
      stdio: "inherit",
      env: {
        ...env,
        DSH_SMOKE_INSTALLER_URL: installer.url,
        DSH_SMOKE_INSTALLER_NAME: installer.name,
        DSH_SMOKE_INSTALLER_SHA256: installer.sha256,
        DSH_SMOKE_CHECKSUM_URL: installer.checksumUrl,
        DSH_SMOKE_PACKAGE_IDENTITY: pkg.identity,
        DSH_SMOKE_CHECKS_FILE: checksFile,
      },
    },
  );
  const checks = readFileSync(checksFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("\t"));
  rows.push(...checks.map(([s, n, d]) => /** @type {Row} */ ([s ?? "", n ?? "", d ?? ""])));
  if (child.status !== 0) rows.push(["FAIL", "smoke", `powershell exited ${child.status ?? child.signal}`]);
  else if (checks.length === 0) rows.push(["FAIL", "smoke", "powershell reported no checks"]);
  write(rows);
  return exitCodeFor(rows);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then((code) => process.exit(code), (/** @type {unknown} */ err) => {
    console.error(err);
    process.exit(1);
  });
}
