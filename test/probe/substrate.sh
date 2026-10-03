#!/usr/bin/env bash
# Run the filesystem-substrate probe against a real distro: the full agent
# substrate stack — `WslAgent` over a real `wsl.exe` transport, `AgentSubstrate`
# on top — driving resolve, stat, reads, the write/edit orchestration with its
# guards, and the distro-native behaviours the unit suites can only fake or run
# under the local shell: reading through `/etc/os-release`'s symlink, a new
# file's 0600 publication mode, and mode preservation on overwrite.
#
# Like test/probe/watch.sh, this needs no harness boot: the substrate is a
# plain Node host process plus the resident agent, and `wsl.exe` is reachable
# from inside the distro through interop. Run it from inside the distro:
#
#   test/probe/substrate.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

if [ -d "$HOME/.local/share/fnm" ] && ! command -v node >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || { echo "substrate probe: node not found (fnm env not loaded?)" >&2; exit 1; }
command -v wsl.exe >/dev/null 2>&1 || { echo "substrate probe: wsl.exe not found (interop off?)" >&2; exit 1; }

export DSH_WSL_ENV_SUBSTRATE_REPO="$REPO"
# A scratch dir inside the checkout: the probe creates real files there.
mkdir -p "$REPO/test/probe/.scratch"
export DSH_WSL_ENV_SUBSTRATE_DIR="$(mktemp -d "$REPO/test/probe/.scratch/substrate.XXXXXX")"

JS="$(mktemp "$REPO/test/probe/.scratch/substrate-probe.XXXXXX.mjs")"
trap 'rm -f "$JS"' EXIT
cat >"$JS" <<'EOF'
import assert from "node:assert/strict";
import { chmodSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const REPO = process.env.DSH_WSL_ENV_SUBSTRATE_REPO;
const { sharedAgent } = await import(`${REPO}/lib/agent-shared.js`);
const { AgentSubstrate } = await import(`${REPO}/lib/fs-substrate.js`);

const distro = process.env.WSL_DISTRO_NAME || "ubuntu";
const root = process.env.DSH_WSL_ENV_SUBSTRATE_DIR;

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

const codeOf = (error) => (error && typeof error === "object" ? error.code : undefined);
const agent = sharedAgent(distro);
const sub = new AgentSubstrate({ agent, distro });

await check("the real wsl.exe transport answers the agent handshake", async () => {
  // Every later call rides this; a failure here is the transport's, and the
  // message names it.
  await agent.ping();
});

await check("resolve keeps the UNC identity and reads through /etc/os-release's symlink", async () => {
  const target = await sub.resolve("/etc/os-release");
  assert.ok(target.targetKey.startsWith("\\\\wsl.localhost\\"), `UNC identity: ${target.targetKey}`);
  // Both substrates derive the display from the canonical identity, so the
  // model sees the symlink's target (/usr/lib/os-release), as on the share.
  assert.ok(target.displayPath.endsWith("os-release"), `Linux display: ${target.displayPath}`);
  const text = await sub.readText(target);
  assert.match(text, /^(ID|NAME|PRETTY_NAME)=/m, "the distro's own file, read through its symlink");
});

await check("writeText publishes a new file at 0600 and preserves the mode on overwrite", async () => {
  const fresh = join(root, "fresh.txt");
  const created = await sub.writeText(await sub.resolve(fresh), "created\n", undefined);
  assert.equal(created.operation, "create");
  assert.equal(statSync(fresh).mode & 0o777, 0o600, "the peer's POSIX publication mode, on a real distro");
  chmodSync(fresh, 0o604);
  const updated = await sub.writeText(await sub.resolve(fresh), "updated\n", undefined);
  assert.equal(updated.operation, "update");
  assert.equal(updated.before, "created\n");
  assert.equal(statSync(fresh).mode & 0o777, 0o604, "overwrite keeps the original bits");
});

await check("editText round-trips CRLF on ext4 and refuses a stale version", async () => {
  const path = join(root, "crlf.txt");
  const target = await sub.resolve(path);
  await sub.writeText(target, "alpha\r\nbeta\r\n", undefined);
  const outcome = await sub.editText(target, { oldString: "beta", newString: "gamma" }, undefined);
  assert.equal(outcome.after, "alpha\ngamma\n");
  assert.equal(readFileSync(path, "utf8"), "alpha\r\ngamma\r\n");
  await assert.rejects(
    sub.editText(target, { oldString: "gamma", newString: "delta" }, { version: "bogus" }),
    (error) => codeOf(error) === "FS_STALE_VERSION",
  );
});

await check("a guarded create refuses an existing file without touching it", async () => {
  const path = join(root, "observed.txt");
  const target = await sub.resolve(path);
  await sub.writeText(target, "keep\n", undefined);
  await assert.rejects(
    sub.writeText(target, "nope\n", { kind: "createIfAbsent" }),
    (error) => codeOf(error) === "FS_NOT_OBSERVED",
  );
  assert.equal(readFileSync(path, "utf8"), "keep\n");
});

await check("listDir walks a real tree with native symlink identities", async () => {
  const rows = await sub.listDir(await sub.resolve(root));
  const names = rows.map((row) => row.name);
  assert.ok(names.includes("fresh.txt") && names.includes("crlf.txt") && names.includes("observed.txt"), JSON.stringify(names));
  assert.ok(rows.every((row) => row.target.targetKey.startsWith("\\\\wsl.localhost\\")));
});

// Stage two: the confined resident. The profile is the command path's read-only
// base plus the workspace bind — what a `workspace-write` policy grants. The argv
// comes from the production builder (`lib/bwrap.js`), which imports nothing, so
// this probe asserts the very command the provider hands its resident instead of
// a second copy of it that can drift.
const { bwrapArgvPrefix } = await import(`${REPO}/lib/bwrap.js`);
const { WslAgent } = await import(`${REPO}/lib/agent.js`);
const { DistroFs } = await import(`${REPO}/lib/fsio-agent.js`);
const confined = new WslAgent({
  distro,
  scriptPath: `${REPO}/agent/wsl-agent.sh`,
  argvPrefix: bwrapArgvPrefix({ mode: "workspace-write", workspaceRoot: root }),
});
const confinedFs = new DistroFs({ agent: confined, distro });

await check("a confined resident starts inside the bwrap profile", async () => {
  await confined.ping();
});

await check("kernel enforcement: a confined write inside the workspace lands, outside it is refused by the kernel", async () => {
  await confinedFs.writeFileAtomic(join(root, "confined.txt"), "inside\n", {});
  assert.equal(readFileSync(join(root, "confined.txt"), "utf8"), "inside\n");
  const outsidePath = "/usr/local/share/wsl-env-probe-must-not-exist.txt";
  await assert.rejects(
    confinedFs.writeFileAtomic(outsidePath, "nope\n", {}),
    (error) => codeOf(error) === "FS_SANDBOX_DENIED" && /[Rr]ead-only file system/.test(error.message),
    "the kernel's read-only mount refused what no host check had to catch",
  );
  assert.equal(statSync(outsidePath, { throwIfNoEntry: false }), undefined, "nothing was created");
});

await confined.close();

await agent.close();
console.log(`\n${passed} substrate probe checks pass`);
EOF

node "$JS"
