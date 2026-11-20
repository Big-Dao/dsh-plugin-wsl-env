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
assert.match(workflow, /@deepseek-ai\\dsh-desktop-host\\lib\\cli\.js/);
assert.match(workflow, /Test-Path \$appAsar/);
assert.doesNotMatch(workflow, /Test-Path \$cli/);
assert.match(workflow, /\$dshHome = Join-Path/);
assert.doesNotMatch(workflow, /\$home = Join-Path/);
assert.match(workflow, /dsh-plugin-wsl-env/);
assert.match(workflow, /http:\/\/127\.0\.0\.1:3080\//);
assert.match(workflow, /bwrap --ro-bind \/ \/ --dev \/dev --proc \/proc/);
