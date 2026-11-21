/**
 * Static contract checks for the hosted Windows + WSL gate.
 *
 * These checks validate workflow/file drift only; they do not prove that a
 * hosted runner executed the suite. The executed suite remains the runtime
 * evidence, and this file is intentionally not a substitute for it.
 *
 * The gate builds an unpacked Electron app and invokes the bundled CLI through
 * the app.asar virtual path. A filesystem existence check against that virtual
 * path is invalid, while an app.asar packaging check remains meaningful.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  resolve(ROOT, ".github/workflows/cloud-wsl-gate.yml"),
  "utf8",
);

assert.match(workflow, /runs-on:\s*windows-latest/);
assert.match(workflow, /wsl\.exe --install -d Ubuntu-24\.04/);
assert.match(workflow, /resources\\app\.asar/);
assert.match(workflow, /resources\\runtime\\cli\\bin\\dsh\.cmd/);
assert.match(workflow, /Test-Path \$dshCommand/);
assert.doesNotMatch(workflow, /--expose-internals \$env:DESKTOP_CLI/);
assert.match(workflow, /\$dshHome = Join-Path/);
assert.doesNotMatch(workflow, /\$home = Join-Path/);
assert.match(workflow, /dsh-plugin-wsl-env/);
assert.match(workflow, /\$webUrl/);
assert.match(workflow, /bwrap --ro-bind \/ \/ --dev \/dev --proc \/proc/);
assert.match(workflow, /"--host", "127\.0\.0\.1"/);
assert.match(workflow, /cloud-desktop\.stdout\.log/);
assert.match(workflow, /cloud-desktop\.stderr\.log/);
assert.match(workflow, /dsh web:/);
assert.match(workflow, /Invoke-WebRequest -Uri \$webUrl/);
assert.match(workflow, /wslfs-profile\.patch\.yml/);
assert.match(workflow, /wsl\.exe --export Ubuntu-24\.04/);
assert.match(workflow, /wsl\.exe --import \$secondDistro/);
assert.match(workflow, /fnm.*install 24\.9\.0/);
assert.match(workflow, /run-all-when-closed\.sh --include-fs/);
assert.match(workflow, /plugin\/test\/probe\/\.scratch\/full-probe\.\*\.log/);
assert.match(workflow, /plugin\/test\/probe\/\.scratch\/full-probe\.\*\.results/);
assert.match(workflow, /include-hidden-files:\s*true/);
assert.match(workflow, /pnpm install --frozen-lockfile/);
assert.match(workflow, /loginctl enable-linger root/);
assert.match(workflow, /Join-Path \$env:USERPROFILE "\.dsh"/);
assert.match(workflow, /dsh-hosted-plugin/);
assert.match(workflow, /distro: 'Ubuntu-24\.04'/);
assert.match(workflow, /cloud-probe-full\.log/);
assert.match(workflow, /cloud-probe-results\.txt/);
assert.match(workflow, /push:\s*\n\s+branches:\s*\[main\]/);
assert.doesNotMatch(workflow, /echo '\$encoded' \| base64 -d \| bash/);
assert.match(workflow, /HOSTED-PROBE-STAGING-OK/);
assert.match(workflow, /FENCE-OK/);
assert.match(workflow, /FULL PASS/);
assert.match(workflow, /NOT RUN/);
assert.match(workflow, /if-no-files-found:\s*error/);
