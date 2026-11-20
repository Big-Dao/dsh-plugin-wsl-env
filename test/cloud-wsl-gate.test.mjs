/**
 * Static contract checks for the hosted Windows + WSL gate.
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
assert.match(workflow, /wsl\.exe --install -d Debian/);
assert.match(workflow, /fnm.*install 24\.9\.0/);
assert.match(workflow, /run-all-when-closed\.sh --include-fs/);
assert.match(workflow, /test\/probe\/\.scratch\/full-probe\.\*\.log/);
assert.match(workflow, /test\/probe\/\.scratch\/full-probe\.\*\.results/);
