#!/usr/bin/env node
/**
 * Native session-runtime probe (ADR 0002, A4).
 *
 * Unlike `scripts/native-wiring-check.mjs` (a quick EXEC/FS smoke test), this
 * checks the behaviours the native backend adds: the session scope, the
 * request/group KILL, the HELLO digest binding, and the scope teardown.
 *
 * The teardown leg is measured where it can fail: a background process is
 * left in the scope first (the way a session leaves a dev server behind), the
 * session ends through `releaseSession`, and the `.scope` unit is the one
 * read back. An empty scope dies with its agent with no help from the stop,
 * and a suffix-less unit name resolves to a `.service` that was never loaded —
 * either one makes a vacuous pass.
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
/** The pid of the background process left in the scope; empty until one is. */
let survivorPid = "";
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

  // A background process the way a session leaves a dev server behind: it
  // must outlive the request that started it, and only the scope's teardown
  // may reap it.
  const survivor = `/tmp/dsh-native-survivor-${process.pid}`;
  await agent.exec({ cwd: "/", argv: ["sh", "-c", `sleep 300 >/dev/null 2>&1 & printf '%s' $! > '${survivor}'`], timeoutMs: 5000 });
  survivorPid = (await agent.exec({ cwd: "/", argv: ["sh", "-c", `cat '${survivor}'; rm -f '${survivor}'`], timeoutMs: 5000 })).stdout.toString().trim();
  const surviving = await direct(["sh", "-c", `kill -0 ${survivorPid} 2>/dev/null; printf %s $?`]);
  assert.equal(surviving.out, "0", "the background process outlives its request");
  ok("a background process stays in the session scope", `pid ${survivorPid}`);
} catch (error) {
  bad("native session probe", error);
} finally {
  try {
    // The session's end, by the door the providers take.
    if (entry !== undefined) await registry.releaseSession(entry.sessionId);
  } catch (error) {
    bad("release", error);
  }
  setSessionNativeAgent(distro, "");
  if (entry !== undefined) {
    let state = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // The stop is not awaited by the release, and `wsl.exe` takes a moment.
      const shown = await direct(["systemctl", "--user", "show", `${entry.unit}.scope`, "-p", "ActiveState,LoadState"]);
      state = shown.out;
      if (!/ActiveState=active/u.test(state)) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (/ActiveState=active/u.test(state)) bad("the scope is stopped after the session ends", state);
    else ok("the scope is stopped after the session ends", state.trim().replaceAll("\n", " "));
  }
  if (survivorPid !== "") {
    const reaped = await direct(["sh", "-c", `kill -0 ${survivorPid} 2>/dev/null; printf %s $?`]);
    if (reaped.out === "1") ok("the scope's teardown reaped the background process", `pid ${survivorPid}`);
    else {
      bad("the scope's teardown reaped the background process", `pid ${survivorPid} is still running`);
      await direct(["kill", survivorPid]);
    }
  }
  const kept = await direct(["test", "-x", prepared.path]);
  if (kept.code === 0) ok("the cache binary is kept for reuse");
  else bad("the cache binary is kept for reuse", `test -x exited ${kept.code}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
