/**
 * Packaging check for the published tarball: `npm pack --dry-run --json` lists
 * exactly what the registry would receive, so this catches a `files` entry that
 * silently stopped matching (a renamed doc, a missing native binary) and
 * development files leaking into the package.
 *
 *   node test/packaging.test.mjs
 *
 * No network: a local dry run uses the npm cache directory under the OS temp
 * dir. The npm script runs with `--ignore-scripts` so a lifecycle hook cannot
 * change the file list under test.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Windows resolves `npm` to npm.cmd, which execFile cannot spawn without a shell.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const cache = mkdtempSync(join(tmpdir(), "dsh-pack-cache-"));

let passed = 0;
/**
 * Run one named check.
 * @param {string} name - the check name.
 * @param {() => void} fn - the assertions.
 */
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

/** @type {{ files: Array<{ path: string }> } | undefined} */
let manifest;
try {
  const raw = execFileSync(NPM, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache, npm_config_logs_dir: join(cache, "logs") },
    // `.cmd` shims cannot be spawned directly on Windows; the shell resolves it.
    shell: process.platform === "win32",
  });
  const parsed = /** @type {Array<{ files: Array<{ path: string }> }>} */ (JSON.parse(raw));
  manifest = parsed[0];
} finally {
  rmSync(cache, { recursive: true, force: true });
}

assert.ok(manifest !== undefined, "npm pack printed a manifest");
const files = manifest.files.map((entry) => entry.path);
/** @param {string} path - the tarball-relative path. @returns {boolean} whether it is packaged. */
const has = (path) => files.includes(path);

try {
  check("the tarball carries the runtime entrypoints and the CLI scripts", () => {
    for (const path of [
      "lib/index.js",
      "lib/index.d.ts",
      "lib/fs-routing.js",
      "lib/preflight.js",
      "lib/agent.js",
      "lib/agent-protocol.js",
      "cordis.patch.yml",
      "scripts/bootstrap.sh",
      "scripts/diagnose.sh",
      "scripts/doctor.mjs",
      "scripts/profile-preset.mjs",
    ]) {
      assert.ok(has(path), `${path} is in the tarball`);
    }
  });

  check("both native agent binaries and the shell agent ship", () => {
    assert.ok(has("agent/wsl-agent.sh"), "the shell agent is the fallback");
    assert.ok(has("agent/native/linux-x86_64/dsh-wsl-agent"), "x86_64 binary");
    assert.ok(has("agent/native/linux-aarch64/dsh-wsl-agent"), "aarch64 binary");
  });

  check("the docs the runtime points at ship", () => {
    for (const path of [
      "docs/CONFIGURATION.md",
      "docs/QUICKSTART.md",
      "docs/PERFORMANCE.md",
      "docs/LIMITATIONS.md",
      "docs/PEER-PARITY.md",
      "docs/UPSTREAM-SESSION-NOTICE.md",
      "docs/UPSTREAM-LSP-SEAM.md",
      "README.md",
      "CHANGELOG.md",
      "SECURITY.md",
      "SUPPORT.md",
    ]) {
      assert.ok(has(path), `${path} is in the tarball`);
    }
  });

  check("locale catalogs ship", () => {
    assert.ok(files.some((path) => path.startsWith("locale/") && path.endsWith(".json")), "at least one locale JSON is packaged");
  });

  check("development trees never leak into the tarball", () => {
    const leaked = files.filter((path) => path.startsWith("src/") || path.startsWith("test/") || path.startsWith("node_modules/") || path.includes(".scratch"));
    assert.deepEqual(leaked, [], "src/, test/, node_modules/ and scratch files stay out");
  });

  check("the package is not suspiciously empty or huge", () => {
    assert.ok(files.length > 100, `expected >100 files, got ${files.length}`);
    assert.ok(files.length < 400, `expected <400 files, got ${files.length}`);
  });
} finally {
  rmSync(cache, { recursive: true, force: true });
}

console.log(`${passed}/6 packaging checks pass`);
