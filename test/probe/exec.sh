#!/usr/bin/env bash
# Run the agent-exec probe against a real distro: the shell execution handle
# over the live agent — completion, timeout, cwd failure, confinement argv.
#
# Like test/probe/agent.sh, this needs no harness boot.
#
#   test/probe/exec.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

if [ -d "$HOME/.local/share/fnm" ] && ! command -v node >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || { echo "exec probe: node not found (fnm env not loaded?)" >&2; exit 1; }

export DSH_WSL_ENV_EXEC_REPO="$REPO"

# A script FILE, not stdin (see test/probe/watch.sh for the reasoning).
mkdir -p "$REPO/test/probe/.scratch"
JS="$(mktemp "$REPO/test/probe/.scratch/exec-probe.XXXXXX.mjs")"
trap 'rm -f "$JS"' EXIT
cat >"$JS" <<'EOF'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const repo = process.env.DSH_WSL_ENV_EXEC_REPO;
const { WslAgent } = await import(`${repo}/lib/agent.js`);
const { agentExecutionHandle } = await import(`${repo}/lib/agent-exec.js`);
// The read-only profile comes from lib/bwrap.js itself — the builder the
// shipped confinement composes from. An inline copy here (as this probe once
// had) would mask a profile regression exactly the way lib/bwrap.js's module
// doc records; bwrap.js imports nothing, so the bare WSL-side checkout can
// import it.
const { bwrapArgvPrefix } = await import(`${repo}/lib/bwrap.js`);
const readOnlyWrap = (argv) => [...bwrapArgvPrefix({ mode: "read-only", workspaceRoot: "/" }), ...argv];

const distro = process.env.WSL_DISTRO_NAME || "ubuntu";
const agent = new WslAgent({ distro, scriptPath: `${repo}/agent/wsl-agent.sh`, idleMs: 0 });

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

await check("a confined command completes through the handle", async () => {
  const confined = readOnlyWrap(["echo", "confined"]);
  const proc = agentExecutionHandle({ agent, cwd: "/", argv: confined, timeoutMs: 15000 });
  const result = await proc.result();
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.text, "confined\n");
  assert.equal(result.timedOut, false);
});

await check("the login shell runs the command string verbatim", async () => {
  const shell = execFileSync("wsl.exe", ["-d", distro, "--exec", "sh", "-c", "echo $SHELL"]).toString().trim() || "/bin/sh";
  const proc = agentExecutionHandle({
    agent, cwd: "/", argv: [shell, "-c", "x=1; printf %s \"$x\""], timeoutMs: 15000,
  });
  const result = await proc.result();
  assert.equal(result.stdout.text, "1", "no double parse: the command string must reach the shell verbatim");
});

await check("the in-distro timeout kills and reports SIGTERM", async () => {
  const proc = agentExecutionHandle({ agent, cwd: "/", argv: ["sleep", "30"], timeoutMs: 1000 });
  const started = Date.now();
  const result = await proc.result();
  assert.ok(Date.now() - started < 10000);
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(proc.status, "killed");
});

await check("a missing workdir surfaces as the relay-shaped failure", async () => {
  const proc = agentExecutionHandle({ agent, cwd: "/definitely/not/here", argv: ["true"], timeoutMs: 15000 });
  const result = await proc.result();
  assert.match(result.stderr.text, /chdir\(\/definitely\/not\/here\) failed/);
});

await check("kill() stops a running command", async () => {
  const proc = agentExecutionHandle({ agent, cwd: "/", argv: ["sleep", "30"], timeoutMs: 0 });
  setTimeout(() => proc.kill(), 1000);
  const started = Date.now();
  await proc.done;
  assert.ok(Date.now() - started < 8000, `kill took ${Date.now() - started}ms`);
  assert.equal(proc.status, "killed");
});

await agent.close();
console.log(`\n${passed} exec probe checks pass`);
process.exit(process.exitCode ?? 0);
EOF
node "$JS"
