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
// The primary distro is provisioned through the shared composite action (the
// hosted-runner watchdog lives there); the workflow must not inline a second
// copy of that sequence (#88).
assert.match(workflow, /uses:\s*\.\/\.github\/actions\/provision-wsl/);
assert.match(workflow, /distro:\s*Ubuntu-24\.04/);
assert.match(workflow, /extra-packages:\s*unzip/);
const provision = readFileSync(resolve(ROOT, ".github/actions/provision-wsl/action.yml"), "utf8");
assert.match(provision, /--install", "-d", \$distro/);
assert.match(provision, /"bubblewrap", "dbus", "git", "ca-certificates", "curl", "build-essential"/);
assert.match(provision, /"enable-linger", "root"/);
assert.match(provision, /Wait-Job \$job -Timeout \$timeoutSec/);
// A docs-only change cannot move the gate's inputs; the Desktop build is
// cached on the pinned upstream ref plus this workflow's recipe (#88).
assert.match(workflow, /paths:\s*&gate-paths/);
assert.match(workflow, /actions\/cache@[0-9a-f]{40}/);
assert.match(workflow, /key:\s*dsh-desktop-win-x64-\$\{\{ runner\.os \}\}-\$\{\{ env\.HARNESS_REF \}\}/);
assert.match(workflow, /if:\s*steps\.desktop-cache\.outputs\.cache-hit != 'true'/);
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
assert.match(workflow, /fnm.*install \$\{\{ env\.NODE_VERSION \}\}/);
assert.match(workflow, /run-all-when-closed\.sh --include-fs/);
assert.match(workflow, /run-all-when-closed\.sh --include-fs --wait-only/);
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
assert.match(provision, /"bubblewrap", "dbus"/);
assert.match(workflow, /\$fenceOutput\s*=/);
assert.match(workflow, /\$hostedRepoLinux\s*=\s*"\/root\/dsh-hosted-plugin"/);
assert.match(workflow, /SUITE_COUNT/);
assert.doesNotMatch(workflow, /passCount\s+-ne\s+19|expected\s+19/);

const ci = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
const contributing = readFileSync(
  resolve(ROOT, "CONTRIBUTING.zh.md"),
  "utf8",
);
assert.match(ci, /probes:/);
assert.match(contributing, /ci\.yml.*probes|`probes`.*任务/s);
assert.match(workflow, /DSH_WSL_ENV_PROBE_SETTLE_MS/);
assert.match(workflow, /DSH_WSL_ENV_PROBE_READ_MS/);
assert.match(workflow, /HOSTED-TERMINAL-PREWARM-OK/);
assert.match(
  readFileSync(resolve(ROOT, "test/probe/terminal-probe.yml"), "utf8"),
  /shell:\s*'\/bin\/bash'/,
);
