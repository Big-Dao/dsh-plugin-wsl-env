#!/usr/bin/env bash
# Run the agent-exec probe against a real distro: the shell execution handle
# over the live agent — completion, timeout, cwd failure, confinement argv.
#
# Like test/probe/agent.sh, this needs no harness boot.
#
#   test/probe/exec.sh

set -euo pipefail

# Shared preamble: PROBE_DIR/REPO_DIR, the distro (refused loudly when no host
# names one), and the fnm PATH fallback.
# shellcheck source=probe-env.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/probe-env.sh"
command -v node >/dev/null 2>&1 || { echo "exec probe: node not found (fnm env not loaded?)" >&2; exit 1; }

export DSH_WSL_ENV_EXEC_REPO="$REPO_DIR"

# A script FILE, not stdin (see test/probe/watch.sh for the reasoning).
mkdir -p "$REPO_DIR/test/probe/.scratch"
JS="$(mktemp "$REPO_DIR/test/probe/.scratch/exec-probe.XXXXXX.mjs")"
trap 'rm -f "$JS"' EXIT
cat >"$JS" <<'EOF'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const repo = process.env.DSH_WSL_ENV_EXEC_REPO;
const { WslAgent } = await import(`${repo}/lib/agent.js`);
const { agentExecutionHandle } = await import(`${repo}/lib/agent-exec.js`);
const { makeCheck } = await import(`${process.env.DSH_WSL_ENV_PROBE_DIR}/check.mjs`);
const { check, summary } = makeCheck();
// The read-only profile comes from lib/bwrap.js itself — the builder the
// shipped confinement composes from. An inline copy here (as this probe once
// had) would mask a profile regression exactly the way lib/bwrap.js's module
// doc records; bwrap.js imports nothing, so the bare WSL-side checkout can
// import it.
const { bwrapArgvPrefix } = await import(`${repo}/lib/bwrap.js`);
const readOnlyWrap = (argv) => [...bwrapArgvPrefix({ mode: "read-only", workspaceRoot: "/" }), ...argv];

const distro = process.env.DSH_WSL_ENV_DISTRO; // probe-env.sh resolved it or refused
const agent = new WslAgent({ distro, scriptPath: `${repo}/agent/wsl-agent.sh`, idleMs: 0 });



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
summary("exec probe");
process.exit(process.exitCode ?? 0);
EOF
node "$JS"
