#!/usr/bin/env node
/**
 * Native session-runtime probe (ADR 0002, A4).
 *
 * Unlike `scripts/native-wiring-check.mjs` (a quick EXEC/FS smoke test), this
 * checks the behaviours the native backend adds: the session scope, the
 * request/group KILL, the HELLO digest binding, and the scope teardown.
 *
 * Run from a terminal with WSL and the packaged binary available; the app may
 * be running (the probe creates its own scope). Env overrides:
 *   DSH_WSL_PROBE_WSL, DSH_WSL_PROBE_DISTRO, DSH_WSL_AGENT_NATIVE.
 *
 *   node test/probe/native-session.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { ensureNativeBackend, NATIVE_AGENT_ENV } from "../../lib/native-agent.js";
import { WslAgent, pinnedWindowsEnv } from "../../lib/agent.js";
import { SessionRuntimes, setSessionNativeAgent } from "../../lib/session-runtime.js";

const wslPath = process.env.DSH_WSL_PROBE_WSL ?? "wsl.exe";
const distro = process.env.DSH_WSL_PROBE_DISTRO ?? process.env.WSL_DISTRO_NAME ?? "ubuntu";
const source = process.env[NATIVE_AGENT_ENV] ?? "";

let passed = 0;
let failed = 0;
/**
 * Records a pass.
 * @param {string} name - the check.
 * @param {string} [detail] - optional evidence.
 */
const ok = (name, detail = "") => {
  passed += 1;
  console.log(`PASS  ${name}${detail.length > 0 ? ` (${detail})` : ""}`);
};
/**
 * Records a failure.
 * @param {string} name - the check.
 * @param {unknown} error - the failure.
 */
const bad = (name, error) => {
  failed += 1;
  console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
};

/**
 * Runs a one-shot dry command through wsl.exe (no session runtime).
 * @param {string[]} argv - the argv after `--exec`.
 * @returns {Promise<{ code: number, out: string }>} the exit code and stdout.
 */
const direct = (argv) => new Promise((resolve) => {
  const child = spawn(wslPath, ["-d", distro, "--exec", ...argv], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, env: pinnedWindowsEnv(process.env) });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk.toString(); });
  child.on("error", () => resolve({ code: -1, out: "" }));
  child.on("exit", (code) => resolve({ code: code ?? -1, out }));
});

const prepared = await ensureNativeBackend({ wslPath, distro, source });
if (prepared === undefined) {
  console.error("native backend unavailable");
  process.exit(1);
}
setSessionNativeAgent(distro, prepared.path, prepared.digest);
const registry = new SessionRuntimes();
/** @type {import("../../lib/session-runtime.js").SessionRuntimeEntry | undefined} */
let entry;
try {
  // The shape/digest check reads through the agent, so it also works when the
  // probe runs on Windows and the cache path is a Linux path.
  entry = registry.acquire({ distro, wslPath, workspaceRoot: process.cwd(), mode: "workspace-write" });
  const agent = entry.agent;
  const magic = await agent.exec({ cwd: "/", argv: ["sh", "-c", `head -c 4 '${prepared.path}'`], timeoutMs: 5000 });
  assert.equal(magic.stdout.toString("latin1"), "\x7fELF");
  const cachedSha = await agent.exec({ cwd: "/", argv: ["sh", "-c", `sha256sum '${prepared.path}' | cut -d' ' -f1`], timeoutMs: 5000 });
  assert.equal(cachedSha.stdout.toString().trim(), prepared.digest, "the cache holds the prepared bytes");
  ok("the cached binary is an ELF with the prepared sha256", `${prepared.digest.slice(0, 12)}…`);

  const pid1 = await agent.exec({ cwd: "/", argv: ["sh", "-c", "ps -p 1 -o comm="], timeoutMs: 5000 });
  const cgroup = await agent.exec({ cwd: "/", argv: ["sh", "-c", "cat /proc/self/cgroup"], timeoutMs: 5000 });
  assert.equal(pid1.stdout.toString().trim(), "systemd");
  assert.ok(cgroup.stdout.toString().includes(entry.unit), "the command is in the scope cgroup");
  ok("the native agent runs in the session scope", entry.unit);

  const exec = await agent.exec({ cwd: "/", argv: ["sh", "-c", "printf native-exec; exit 3"], timeoutMs: 5000 });
  assert.equal(exec.exitCode, 3);
  assert.equal(exec.stdout.toString(), "native-exec");
  ok("EXEC returns the output and exit code");

  const target = `/tmp/dsh-native-probe-${process.pid}`;
  const content = Buffer.from("native-fs").toString("base64");
  const write = await agent.fs({ op: "write", args: [target, "644", "replace", "-", content] });
  assert.equal(write.exitCode, 0);
  const read = await agent.fs({ op: "read", args: [target, "0", "4096"] });
  // The raw FS frame carries the content base64; DistroFs decodes it for the
  // file tools, so the probe decodes the same way.
  const decoded = Buffer.from(read.stdout.toString().trim(), "base64").toString("utf8");
  assert.equal(decoded, "native-fs");
  await agent.exec({ cwd: "/", argv: ["sh", "-c", `rm -f '${target}'`], timeoutMs: 5000 });
  ok("FS write/read round-trips through the native agent");

  const marker = `/tmp/dsh-native-kill-${process.pid}`;
  const controller = new AbortController();
  const running = agent.exec({ cwd: "/", argv: ["sh", "-c", `echo $$ > '${marker}'; sleep 30`], timeoutMs: 60000, signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 500));
  controller.abort();
  /** @type {unknown} */
  let abortError;
  try {
    await running;
  } catch (error) {
    abortError = error;
  }
  assert.ok(abortError !== undefined, "the aborted request rejects");
  const killedPid = (await agent.exec({ cwd: "/", argv: ["sh", "-c", `cat '${marker}'`], timeoutMs: 5000 })).stdout.toString().trim();
  const gone = await agent.exec({ cwd: "/", argv: ["sh", "-c", `kill -0 ${killedPid} 2>/dev/null; printf %s $?`], timeoutMs: 5000 });
  assert.equal(gone.stdout.toString(), "1", "the KILL reaped the request's process group");
  const after = await agent.exec({ cwd: "/", argv: ["sh", "-c", "printf alive"], timeoutMs: 5000 });
  assert.equal(after.stdout.toString(), "alive", "the agent survives the KILL");
  ok("KILL reaps the request group and the agent survives", `pid ${killedPid}`);

  const tampered = new WslAgent({
    distro,
    wslPath,
    scriptPath: prepared.path,
    expectedDigest: "0".repeat(64),
    signalable: false,
    spawnTransport: ({ wslPath: w, distro: d, argvPrefix }) =>
      spawn(w, ["-d", d, "--exec", ...argvPrefix, prepared.path], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        env: pinnedWindowsEnv(process.env),
      }),
  });
  try {
    /** @type {unknown} */
    let digestError;
    try {
      await tampered.exec({ cwd: "/", argv: ["sh", "-c", "true"], timeoutMs: 5000 });
    } catch (error) {
      digestError = error;
    }
    assert.ok(digestError !== undefined, "the wrong digest is rejected");
    assert.match(tampered.lastError, /digest mismatch/u);
    ok("a wrong HELLO digest fails the handshake");
  } finally {
    await tampered.close();
  }
} catch (error) {
  bad("native session probe", error);
} finally {
  try {
    if (entry !== undefined) await registry.release(entry.key);
  } catch (error) {
    bad("release", error);
  }
  setSessionNativeAgent(distro, "");
  if (entry !== undefined) {
    let state = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const shown = await direct(["systemctl", "--user", "show", entry.unit, "-p", "ActiveState,LoadState"]);
      state = shown.out;
      if (!/ActiveState=active/u.test(state)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (/ActiveState=active/u.test(state)) bad("the scope is stopped after release", state);
    else ok("the scope is stopped after release", state.trim().replaceAll("\n", " "));
  }
  const kept = await direct(["test", "-x", prepared.path]);
  if (kept.code === 0) ok("the cache binary is kept for reuse");
  else bad("the cache binary is kept for reuse", `test -x exited ${kept.code}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
