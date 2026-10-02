#!/usr/bin/env bash
# Run the watch probe against a real distro: arm the in-distro poll watcher on
# a fresh temp directory, touch/create/delete underneath it, and assert the
# invalidation callback fires; then close and assert it goes silent.
#
# Like test/probe/agent.sh, this needs no harness boot: the watcher is a plain
# Node host process plus the shell loop, and `wsl.exe` is reachable from inside
# the distro through interop.
#
#   test/probe/watch.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

if [ -d "$HOME/.local/share/fnm" ] && ! command -v node >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || { echo "watch probe: node not found (fnm env not loaded?)" >&2; exit 1; }

export DSH_WSL_ENV_WATCH_REPO="$REPO"
# A scratch dir inside the checkout: a confined shell cannot rely on /tmp.
mkdir -p "$REPO/test/probe/.scratch"
export DSH_WSL_ENV_WATCH_DIR="$(mktemp -d "$REPO/test/probe/.scratch/watch.XXXXXX")"

# A file, not stdin: a node stdin program keeps the pipe held and this
# probe's child `wsl.exe` sessions behave differently under that arrangement
# (the watcher never saw events). A plain script file sidesteps the question.
JS="$(mktemp "$REPO/test/probe/.scratch/watch-probe.XXXXXX.mjs")"
trap 'rm -f "$JS"' EXIT
cat >"$JS" <<'EOF'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { join } from "node:path";
const { armDistroWatcher } = await import(`${process.env.DSH_WSL_ENV_WATCH_REPO}/lib/watcher.js`);

const distro = process.env.WSL_DISTRO_NAME || "ubuntu";
const dir = process.env.DSH_WSL_ENV_WATCH_DIR;

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

// Stamp the tree fresh from the distro side so the baseline is unambiguous.
// Note every mutation below is ALSO performed from the distro side: this probe
// may run under a harness whose own file sandbox shadows host-side writes to
// the workspace, and a shadowed write is invisible to the kernel the watcher
// polls — a probe artifact, not a watcher property.
execFileSync("wsl.exe", ["-d", distro, "--exec", "find", dir, "-exec", "touch", "{}", "+"]);

// Each check gets its own fresh directory: an earlier watcher's close and the
// next arm on the SAME directory interact (the second loop's activation races
// the first session's teardown through wsl.exe), which showed up as missed
// deletions. Fresh dirs make every check independent, like real usage.
const freshDir = () => {
  const path = dir + ".c" + (freshDir.n = (freshDir.n ?? 0) + 1);
  execFileSync("wsl.exe", ["-d", distro, "--exec", "mkdir", "-p", path]);
  execFileSync("wsl.exe", ["-d", distro, "--exec", "find", path, "-exec", "touch", "{}", "+"]);
  return path;
};
const arm = (path) => {
  const changes = [];
  let notify = () => {};
  const armed = armDistroWatcher({
    wslPath: "wsl.exe",
    distro,
    linuxPath: path,
    onChange: () => { changes.push(1); notify(); },
    onError: (error) => console.log(`WATCHERR ${error.message}`),
    intervalSeconds: 1,
    signal: new AbortController().signal,
  });
  const close = async () => (await armed)();
  return { changes, armed, close, waitForChange: (timeoutMs = 8000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no change within ${timeoutMs}ms (changes so far: ${changes.length})`)), timeoutMs);
    notify = () => { clearTimeout(timer); notify = () => {}; resolve(); };
  }) };
};

await check("a created file fires the invalidation callback", async () => {
  const path = freshDir();
  const watch = arm(path);
  await watch.armed;
  // Create from the distro side, like the deletion below: the file the watcher
  // must see is one the distro's own kernel wrote.
  execFileSync("wsl.exe", ["-d", distro, "--exec", "sh", "-c", "printf hello > \"$1\"", "w", join(path, "new.txt")]);
  await watch.waitForChange();
  await watch.close();
});

await check("a deletion fires the invalidation callback (parent mtime)", async () => {
  const path = freshDir();
  execFileSync("wsl.exe", ["-d", distro, "--exec", "sh", "-c", "printf hello > \"$1\"", "w", join(path, "new.txt")]);
  const watch = arm(path);
  await watch.armed;
  // Delete from the distro side: the real consumers of this watcher are
  // in-distro processes and the provider's own in-distro operations, so the
  // deletion the probe simulates is an `rm` where the kernel sees it directly.
  execFileSync("wsl.exe", ["-d", distro, "--exec", "rm", join(path, "new.txt")]);
  await watch.waitForChange();
  await watch.close();
});

await check("an mtime-older-than-stamp creation is NOT seen (documented blind spot)", async () => {
  const path = freshDir();
  execFileSync("wsl.exe", ["-d", distro, "--exec", "sh", "-c",
    "printf stale > \"$1\" && touch -d \'1 year ago\' \"$1\"", "w", join(path, "old.txt")]);
  const watch = arm(path);
  await watch.armed;
  // waitForChange rejects on its own timeout when nothing fires.
  await assert.rejects(() => watch.waitForChange(2500), /no change within/);
  await watch.close();
});

await check("close stops the loop: no callbacks afterwards", async () => {
  const path = freshDir();
  const watch = arm(path);
  await watch.armed;
  await watch.close();
  execFileSync("wsl.exe", ["-d", distro, "--exec", "sh", "-c", "printf x > \"$1\"", "w", join(path, "after-close.txt")]);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert.equal(watch.changes.length, 0);
});

execFileSync("wsl.exe", ["-d", distro, "--exec", "rm", "-rf", dir]);
for (let i = 1; i <= 4; i++) execFileSync("wsl.exe", ["-d", distro, "--exec", "rm", "-rf", `${dir}.c${i}`]);
console.log(`\n${passed} watch probe checks pass`);
process.exit(process.exitCode ?? 0);
EOF
node "$JS"
