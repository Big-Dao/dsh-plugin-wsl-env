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

await check("the publication script copies the mode and renames atomically", async () => {
  const { publicationArgv } = await import(`${repo}/lib/fs-publish.js`);
  const base = `/tmp/wsl-agent-pub.${process.pid}-${Date.now()}`;
  const setup = await agent.exec({ cwd: "/", argv: ["sh", "-c",
    `mkdir -p "${base}" && printf old > "${base}/target" && chmod 755 "${base}/target" && printf new > "${base}/staged"`, "w"], timeoutMs: 10000 });
  assert.equal(setup.exitCode, 0);
  const result = await agent.exec({ cwd: "/", argv: publicationArgv(`${base}/target`, `${base}/staged`), timeoutMs: 10000 });
  assert.equal(result.exitCode, 0, `publication failed: ${result.stderr.toString("utf8")}`);
  const content = await agent.exec({ cwd: "/", argv: ["cat", `${base}/target`], timeoutMs: 10000 });
  const mode = await agent.exec({ cwd: "/", argv: ["stat", "-c", "%a", `${base}/target`], timeoutMs: 10000 });
  assert.equal(content.stdout.toString("utf8"), "new");
  assert.equal(mode.stdout.toString("utf8").trim(), "755", "the replaced file's mode must survive publication");
  await agent.exec({ cwd: "/", argv: ["rm", "-rf", base], timeoutMs: 10000 });
});

await check("the publication script treats a creation as a plain rename", async () => {
  const { publicationArgv } = await import(`${repo}/lib/fs-publish.js`);
  const base = `/tmp/wsl-agent-new.${process.pid}-${Date.now()}`;
  await agent.exec({ cwd: "/", argv: ["sh", "-c", `mkdir -p "${base}" && printf new > "${base}/staged"`, "w"], timeoutMs: 10000 });
  const result = await agent.exec({ cwd: "/", argv: publicationArgv(`${base}/target`, `${base}/staged`), timeoutMs: 10000 });
  assert.equal(result.exitCode, 0, `creation failed: ${result.stderr.toString("utf8")}`);
  const verify = await agent.exec({ cwd: "/", argv: ["cat", `${base}/target`], timeoutMs: 10000 });
  assert.equal(verify.stdout.toString("utf8"), "new");
  await agent.exec({ cwd: "/", argv: ["rm", "-rf", base], timeoutMs: 10000 });
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

await check("fallback parity: exit code and stdout match the one-shot path", async () => {
  const script = "printf '%s' 'a b $HOME x'; exit 3";
  const on = await agent.exec({ cwd: "/tmp", argv: ["sh", "-c", script], timeoutMs: 15000 });
  const off = await oneShot("/tmp", script);
  assert.equal(on.exitCode, off.exitCode, "same exit code");
  assert.deepEqual(on.stdout, off.stdout, "same stdout bytes");
});

await check("fallback parity: stderr and working directory match the one-shot path", async () => {
  const script = "cd /etc && pwd && echo oops >&2";
  const on = await agent.exec({ cwd: "/etc", argv: ["sh", "-c", script], timeoutMs: 15000 });
  const off = await oneShot("/etc", script);
  assert.equal(on.exitCode, off.exitCode);
  assert.equal(on.stdout.toString("utf8"), off.stdout.toString("utf8"), "same working directory");
  assert.equal(on.stderr.toString("utf8"), off.stderr.toString("utf8"), "same stderr bytes");
});

await check("fallback parity: NUL and CRLF round-trip on both paths", async () => {
  const on = await agent.exec({ cwd: "/tmp", argv: ["printf", "a\\000b\\r\\nc"], timeoutMs: 15000 });
  const off = await oneShot("/tmp", "printf 'a\\000b\\r\\nc'");
  assert.deepEqual(on.stdout, off.stdout, "binary safety holds on both paths");
});

await agent.close();
console.log(`\n${passed} agent probe checks pass`);
process.exit(process.exitCode ?? 0);
EOF
