import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CDN_BASE,
  exitCodeFor,
  formatResults,
  installerUrl,
  resolveInstaller,
  resolvePowerShell,
  run,
  tarballIdentity,
  validateEnv,
} from "../scripts/official-harness-smoke.mjs";
import { uncFor } from "./probe/official-smoke-probe.mjs";

/** @param {string} p */
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const goodEnv = {
  DSH_OFFICIAL_HARNESS_VERSION: "0.2.2",
  DSH_PLUGIN_PACKAGE_TARBALL: "x.tgz",
  DSH_WSL_ENV_DISTRO: "Ubuntu-24.04",
  DSH_WSL_ENV_PROFILE: "gate",
};

test("package script wires the smoke", () => {
  const pkg = JSON.parse(read("../package.json"));
  assert.equal(pkg.scripts["smoke:official-harness"], "node scripts/official-harness-smoke.mjs");
});

test("validateEnv requires every input and rejects unsafe names", () => {
  assert.deepEqual(validateEnv(goodEnv), []);
  for (const key of Object.keys(goodEnv)) {
    assert.equal(validateEnv({ ...goodEnv, [key]: "" }).length >= 1, true, key);
  }
  assert.ok(validateEnv({ ...goodEnv, DSH_WSL_ENV_DISTRO: "a;b" }).length > 0);
  assert.ok(validateEnv({ ...goodEnv, DSH_WSL_ENV_PROFILE: "../x" }).length > 0);
});

test("missing env and non-Windows are NOT RUN, never success", async () => {
  assert.equal(await run({}, "win32"), 1);
  assert.equal(await run(goodEnv, "linux"), 1);
});

test("installerUrl builds the exact CDN path and strips the v prefix", () => {
  const rc = installerUrl("0.2.2-rc.2");
  assert.equal(rc.name, "deepseek-harness-0.2.2-rc.2-win-x64.exe");
  assert.equal(rc.url, `${CDN_BASE}/deepseek-harness-0.2.2-rc.2-win-x64.exe`);
  const plain = installerUrl("v0.2.2");
  assert.equal(plain.name, "deepseek-harness-0.2.2-win-x64.exe");
  assert.equal(plain.url, `${CDN_BASE}/deepseek-harness-0.2.2-win-x64.exe`);
});

test("resolveInstaller resolves the versioned CDN object and fails when absent", async () => {
  const ok = await resolveInstaller("0.2.2-rc.2", async (/** @type {string} */ url, /** @type {object | undefined} */ init) => {
    assert.equal(url, `${CDN_BASE}/deepseek-harness-0.2.2-rc.2-win-x64.exe`);
    assert.equal(/** @type {{ method?: string }} */ (init).method, "HEAD");
    return { ok: true, status: 200 };
  });
  assert.equal(ok.name, "deepseek-harness-0.2.2-rc.2-win-x64.exe");
  assert.equal(ok.url, `${CDN_BASE}/deepseek-harness-0.2.2-rc.2-win-x64.exe`);
  // No official checksum is published on the CDN, so the smoke records the
  // downloaded file's own sha256 rather than verifying a published one.
  assert.equal(ok.sha256, "");
  assert.equal(ok.checksumUrl, "");
  await assert.rejects(resolveInstaller("9.9.9", async () => ({ ok: false, status: 404 })), /HTTP 404/);
});

test("uncFor spells distro paths the plugin's UNC parser accepts", () => {
  assert.equal(uncFor("Ubuntu-24.04", "/tmp/dsh-probe/probe-fs.txt"), "\\\\wsl.localhost\\Ubuntu-24.04\\tmp\\dsh-probe\\probe-fs.txt");
  assert.equal(uncFor("ubuntu", "/tmp/x"), "\\\\wsl.localhost\\ubuntu\\tmp\\x");
  // A forward slash right after the distro parses as part of the distro name
  // (`<distro>/tmp/...`), which misroutes the target to another distro and
  // turns the workspace root into `/` — the bug the helper exists to prevent.
  assert.equal(uncFor("Ubuntu-24.04", "/tmp").includes("/"), false);
});

test("tarballIdentity reads name, version and sha512 from the tarball", () => {  const dir = mkdtempSync(join(tmpdir(), "dsh-smoke-tar-"));
  try {
    const pack = (/** @type {{ name: string, version: string }} */ manifest) => {
      rmSync(join(dir, "package"), { recursive: true, force: true });
      mkdirSync(join(dir, "package"));
      writeFileSync(join(dir, "package", "package.json"), JSON.stringify(manifest));
      const tar = join(dir, "candidate.tgz");
      execFileSync("tar", ["-czf", tar, "-C", dir, "package"]);
      return tar;
    };
    const tar = pack({ name: "dsh-plugin-wsl-env", version: "1.2.3" });
    const id = tarballIdentity(tar);
    assert.equal(id.identity, "dsh-plugin-wsl-env@1.2.3");
    assert.match(id.integrity, /^sha512-[A-Za-z0-9+/=]+$/);
    assert.throws(() => tarballIdentity(pack({ name: "other-package", version: "1.2.3" })), /expected dsh-plugin-wsl-env/);
    assert.throws(() => tarballIdentity(pack({ name: "dsh-plugin-wsl-env", version: "" })), /no version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolvePowerShell prefers pwsh and falls back", () => {
  assert.equal(resolvePowerShell(() => true), "pwsh.exe");
  assert.equal(resolvePowerShell((e) => e === "powershell.exe"), "powershell.exe");
  assert.equal(resolvePowerShell(() => false), null);
});

test("result aggregation is fail-close", () => {
  assert.equal(exitCodeFor([]), 1);
  assert.equal(exitCodeFor([["PASS", "a", ""], ["SKIP", "b", ""]]), 1);
  assert.equal(exitCodeFor([["PASS", "a", ""]]), 0);
  assert.match(formatResults([["NOT RUN", "inputs", "x"]]), /^NOT RUN\tinputs\tx\n$/);
});

test("scripts keep the behavior contract", () => {
  const mjs = read("../scripts/official-harness-smoke.mjs");
  assert.match(mjs, /download\.deepseek\.com\/dsh-desk\/bin\/win-x64/);
  assert.doesNotMatch(mjs, /api\.github\.com/);
  assert.match(mjs, /\$\{PACKAGE_NAME\}@/);
  assert.doesNotMatch(mjs, /Program Files/);
  assert.doesNotMatch(mjs, /execSync/);
  // A fresh checkout has no .scratch/; the checks file must not depend on it.
  assert.match(mjs, /mkdirSync\(dirname\(checksFile\), \{ recursive: true \}\)/);
  const ps = read("../scripts/official-harness-smoke.ps1");
  for (const needle of [
    "Get-FileHash",
    "/S",
    "plugin",
    "--dump-config",
    "skipped",
    "--version",
    "--no-sandbox",
    "--disable-gpu",
    "--no-open",
    "--exec",
    "official-smoke-probe.mjs",
    "RESULT: all steps passed",
    ".scratch",
    "Stop-Process",
    "taskkill.exe",
    "WaitForExit",
    "DSH_WSL_ENV_DISTRO",
    "DSH_WSL_ENV_PROFILE",
  ]) {
    assert.ok(ps.includes(needle), needle);
  }
  assert.doesNotMatch(ps, /Smoke test passed/);
  const probe = read("../test/probe/official-smoke-probe.mjs");
  for (const needle of ["workspace-write", "denied", "RESULT: all steps passed", "wsl.localhost"]) {
    assert.ok(probe.includes(needle), needle);
  }
});
