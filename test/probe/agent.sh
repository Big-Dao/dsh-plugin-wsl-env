#!/usr/bin/env bash
# Run the resident-agent probe against a real distro.
#
# Unlike run.sh/terminal.sh this probe needs no harness boot: the agent pair is
# a plain Node host process plus the POSIX shell script, and `wsl.exe` is
# reachable from inside the distro through interop. Run it from a distro
# terminal with Node available (fnm):
#
#   test/probe/agent.sh
#
# Asserted here, against the real thing the unit tests fake:
#   1. handshake + ping
#   2. exec: stdout, exit code, argv with spaces and $-metacharacters intact
#   3. binary safety: NUL bytes and CRLF survive the base64 payloads
#   4. cwd: the command lands where the frame said
#   5. env: SETENV reaches the child
#   6. timeout: an in-distro SIGTERM arrives; the agent survives and serves again
#   7. throughput: 2 MB of output round-trips on one RES line

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

# fnm's shims are not on a non-interactive PATH; source the env the way the
# user's shell would.
if [ -d "$HOME/.local/share/fnm" ] && ! command -v node >/dev/null 2>&1; then
  # fnm's default alias holds the pinned toolchain; `fnm env` would want a
  # symlink under /run, which a confined shell cannot create.
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || { echo "agent probe: node not found (fnm env not loaded?)" >&2; exit 1; }

export DSH_WSL_ENV_AGENT_SCRIPT="$REPO/agent/wsl-agent.sh"
export DSH_WSL_ENV_AGENT_REPO="$REPO"

node --input-type=module - "$REPO" <<'EOF'
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const repo = process.env.DSH_WSL_ENV_AGENT_REPO;
const { WslAgent } = await import(`${repo}/lib/agent.js`);
const distro = process.env.WSL_DISTRO_NAME || "ubuntu";
const agent = new WslAgent({ distro, scriptPath: `${repo}/agent/wsl-agent.sh`, idleMs: 0 });

let passed = 0;
let skipped = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    if (error instanceof Skip) {
      skipped += 1;
      console.log(`SKIP  ${name}\n      ${error.message}`);
      return;
    }
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

await check("ping completes the handshake against a real distro", () => agent.ping());

await check("exec carries argv with spaces and $-metacharacters intact", async () => {
  const result = await agent.exec({ cwd: "/tmp", argv: ["printf", "%s", "a b $HOME `x`"], timeoutMs: 10000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString("utf8"), "a b $HOME `x`");
});

await check("binary payloads survive: NUL bytes and CRLF round-trip", async () => {
  const result = await agent.exec({ cwd: "/tmp", argv: ["printf", "a\\000b\\r\\nc"], timeoutMs: 10000 });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdout, Buffer.from([0x61, 0, 0x62, 13, 10, 0x63]));
});

await check("cwd lands the command where the frame said", async () => {
  const result = await agent.exec({ cwd: "/etc", argv: ["pwd"], timeoutMs: 10000 });
  assert.equal(result.stdout.toString("utf8").trim(), "/etc");
});

await check("a nonzero exit comes back as-is with stderr captured", async () => {
  const result = await agent.exec({ cwd: "/tmp", argv: ["sh", "-c", "echo oops >&2; exit 3"], timeoutMs: 10000 });
  assert.equal(result.exitCode, 3);
  assert.equal(result.stderr.toString("utf8"), "oops\n");
});

await check("SETENV reaches the child", async () => {
  const result = await agent.exec({ cwd: "/tmp", argv: ["sh", "-c", "printf %s \"$WSL_AGENT_PROBE\""], env: { WSL_AGENT_PROBE: "hello" }, timeoutMs: 10000 });
  assert.equal(result.stdout.toString("utf8"), "hello");
});

await check("the in-distro timeout SIGTERMs the child and the agent serves again", async () => {
  const started = Date.now();
  const result = await agent.exec({ cwd: "/tmp", argv: ["sleep", "30"], timeoutMs: 1000 });
  const elapsed = Date.now() - started;
  assert.ok(result.exitCode !== 0, "a SIGTERMed sleep must not exit 0");
  assert.ok(elapsed < 10000, `timeout took ${elapsed}ms; the in-distro kill did not fire`);
  const after = await agent.exec({ cwd: "/tmp", argv: ["echo", "alive"], timeoutMs: 10000 });
  assert.equal(after.stdout.toString("utf8").trim(), "alive");
});

await check("2 MB of output round-trips on one RES line", async () => {
  const result = await agent.exec({ cwd: "/tmp", argv: ["head", "-c", "2097152", "/dev/zero"], timeoutMs: 30000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 2097152);
});

// The fallback invariant (PARITY.md), exercised for real: `agent: false` runs
// the ONE-SHOT `wsl.exe` path, and its outcomes must match the resident's
// outcome-for-outcome. The comparison is at the outcome level — exit code,
// stdout bytes, stderr bytes, working directory — never internals.
const { spawn } = await import("node:child_process");
const oneShot = (cdDir, script) => new Promise((resolve, reject) => {
  const child = spawn("wsl.exe", ["-d", distro, "--cd", cdDir, "--exec", "sh", "-c", script]);
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("error", reject);
  child.on("exit", (code) => resolve({ exitCode: code, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
});

// Each one-shot leg is a NESTED wsl.exe — it runs here, inside the distro, and
// reaches back to the WSL service. That hop is the one dependency this probe
// does not control: WSL 3.0.x intermittently kills it with
// `Wsl/Service/WSAETIMEDOUT` (exit 255, the service-connection timeout whose
// sibling signature is `UtilAcceptVsock ... accept4 failed 110`). An
// environment failure that prevents the comparison from happening is not a
// parity violation — it SKIPs with the evidence, loudly. A comparison that
// actually ran and disagreed still fails.
class Skip extends Error {}

/** Whether an outcome is wsl.exe failing to reach its own service. */
const wslServiceTimeout = (outcome) =>
  outcome.exitCode !== 0 &&
  /WSAETIMEDOUT|UtilAcceptVsock|WSL_E_/.test(
    (outcome.stdout.toString("utf8") + outcome.stderr.toString("utf8")).replace(/\0/g, ""),
  );

/** Abandon one check as an environment failure, with the evidence attached. */
const skipEnv = (outcome) => {
  throw new Skip(
    `nested wsl.exe failed to reach the WSL service (WSAETIMEDOUT-class) — the comparison never ran, so this is the environment, not parity. ` +
      `one-shot exit=${outcome.exitCode} output: ${JSON.stringify((outcome.stdout.toString("utf8") + outcome.stderr.toString("utf8")).replace(/\0/g, "").trim().slice(0, 200))}`,
  );
};

await check("fallback parity: exit code and stdout match the one-shot path", async () => {
  const script = "printf '%s' 'a b $HOME x'; exit 3";
  const on = await agent.exec({ cwd: "/tmp", argv: ["sh", "-c", script], timeoutMs: 15000 });
  const off = await oneShot("/tmp", script);
  if (wslServiceTimeout(off)) skipEnv(off);
  // A mismatch here is a wsl.exe-level failure more often than a path-semantics
  // one (255 is wsl.exe's own code); show what it said, or the leg is a dead end.
  const context = off.stderr.length > 0 ? ` one-shot stderr: ${JSON.stringify(off.stderr.toString("utf8").slice(0, 400))}` : ` one-shot stdout: ${JSON.stringify(off.stdout.toString("utf8").slice(0, 200))}`;
  assert.equal(on.exitCode, off.exitCode, "same exit code —" + context);
  assert.deepEqual(on.stdout, off.stdout, "same stdout bytes");
});

await check("fallback parity: stderr and working directory match the one-shot path", async () => {
  const script = "cd /etc && pwd && echo oops >&2";
  const on = await agent.exec({ cwd: "/etc", argv: ["sh", "-c", script], timeoutMs: 15000 });
  const off = await oneShot("/etc", script);
  if (wslServiceTimeout(off)) skipEnv(off);
  assert.equal(on.exitCode, off.exitCode);
  assert.equal(on.stdout.toString("utf8"), off.stdout.toString("utf8"), "same working directory");
  assert.equal(on.stderr.toString("utf8"), off.stderr.toString("utf8"), "same stderr bytes");
});

await check("fallback parity: NUL and CRLF round-trip on both paths", async () => {
  const on = await agent.exec({ cwd: "/tmp", argv: ["printf", "a\\000b\\r\\nc"], timeoutMs: 15000 });
  const off = await oneShot("/tmp", "printf 'a\\000b\\r\\nc'");
  if (wslServiceTimeout(off)) skipEnv(off);
  assert.deepEqual(on.stdout, off.stdout, "binary safety holds on both paths");
});

await agent.close();
console.log(`\n${passed} agent probe checks pass${skipped > 0 ? `, ${skipped} skipped (nested wsl.exe could not reach the WSL service)` : ""}`);
process.exit(process.exitCode ?? 0);
EOF
