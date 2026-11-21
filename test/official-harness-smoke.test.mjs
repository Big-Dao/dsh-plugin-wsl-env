import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  exitCodeFor,
  formatResults,
  pickInstaller,
  resolveInstaller,
  resolvePowerShell,
  run,
  validateEnv,
} from "../scripts/official-harness-smoke.mjs";

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

test("pickInstaller selects the Windows exe and requires a checksum source", () => {
  const picked = pickInstaller([
    { name: "Harness-Setup-win-x64.exe", browser_download_url: "u", digest: `sha256:${"a".repeat(64)}` },
    { name: "Harness-mac.dmg", browser_download_url: "m" },
  ]);
  assert.equal(picked.url, "u");
  assert.equal(picked.sha256, "a".repeat(64));
  assert.throws(() => pickInstaller([{ name: "Harness-win.exe", browser_download_url: "u" }]), /checksum/);
  assert.throws(() => pickInstaller([]), /installer/);
});

test("resolveInstaller fails when the release is absent", async () => {
  await assert.rejects(resolveInstaller("9.9.9", async () => ({ ok: false, status: 404, json: async () => ({}) })), /not found/);
  const ok = await resolveInstaller("0.2.2", async (/** @type {string} */ url) => ({
    ok: url.endsWith("/v0.2.2"),
    status: 404,
    json: async () => ({ assets: [{ name: "a-win.exe", browser_download_url: "u", digest: `sha256:${"b".repeat(64)}` }] }),
  }));
  assert.equal(ok.tag, "v0.2.2");
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
  assert.match(mjs, /deepseek-ai\/deepseek-harness/);
  assert.match(mjs, /\$\{PACKAGE_NAME\}@/);
  assert.doesNotMatch(mjs, /Program Files/);
  assert.doesNotMatch(mjs, /execSync/);
  const ps = read("../scripts/official-harness-smoke.ps1");
  for (const needle of ["Get-FileHash", "/S", "plugin", "--dump-config", "--no-sandbox", "--disable-gpu", "--no-open", "--exec", "Stop-Process", "DSH_WSL_ENV_DISTRO", "DSH_WSL_ENV_PROFILE"]) {
    assert.ok(ps.includes(needle), needle);
  }
  assert.doesNotMatch(ps, /Smoke test passed/);
});
