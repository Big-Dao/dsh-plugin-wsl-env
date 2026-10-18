/**
 * Spike test for the native agent prototype (ADR 0002, stage 2).
 *
 * It drives the Rust binary over the real v5 frames and compares the shape
 * with the shipped shell agent where it matters. Not part of the unit suite:
 * the binary is built on demand.
 *
 *   node agent/native/spike/test.mjs [path-to-binary]
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { decodeB64, encodeExecFrame, encodeFsFrame, encodeKill, encodeSetEnv } from "../../../lib/agent-protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const binary = process.argv[2] ?? join(here, "target", "release", "dsh-wsl-agent-spike");
const shellAgent = join(repo, "agent", "wsl-agent.sh");

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

class Session {
  constructor(command, args) {
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.stderrText = "";
    this.child.stderr.on("data", (chunk) => { this.stderrText += chunk.toString(); });
    this.next = 0;
    this.pong = new Promise((resolve) => {
      this.pongResolve = resolve;
    });
    this.pending = new Map();
    this.hello = new Promise((resolve, reject) => {
      this.helloResolve = resolve;
      this.helloReject = reject;
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      const f = line.split("|");
      if (f[0] === "HELLO") {
        this.helloResolve({ name: f[1], version: Number(f[2]) });
        return;
      }
      if (f[0] === "PONG") {
        this.pongResolve?.();
        return;
      }
      if (f[0] === "ACK") return;
      if (f[0] === "RES" || f[0] === "ERR") {
        const entry = this.pending.get(f[1]);
        if (entry === undefined) return;
        this.pending.delete(f[1]);
        if (f[0] === "ERR") {
          entry.reject(new Error(`${f[2]}: ${decodeB64(f[3]).toString("utf8")}`));
          return;
        }
        entry.resolve({
          exitCode: Number(f[2]),
          stdout: decodeB64(f[3]),
          stderr: decodeB64(f[4]),
          truncated: { stdout: f[5] === "1", stderr: f[6] === "1" },
        });
      }
    });
    this.child.on("error", (error) => this.helloReject(error));
    this.child.on("exit", (code) => {
      for (const entry of this.pending.values()) entry.reject(new Error(`agent exited (${code})`));
      this.pending.clear();
    });
  }

  send(lines) {
    this.child.stdin.write(`${lines.join("\n")}\n`);
  }

  exec({ argv, cwd = repo, timeoutMs = 0, maxOutputBytes = 0 }) {
    const id = `r${this.next += 1}`;
    this.send(encodeExecFrame({ id, cwd, argv, timeoutMs, maxOutputBytes }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  setEnv(key, value) {
    this.send([encodeSetEnv(key, value)]);
  }

  fs({ op, args }) {
    const id = `r${this.next += 1}`;
    this.send(encodeFsFrame({ id, op, args }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  kill(id) {
    this.send([encodeKill(id)]);
  }

  async close() {
    this.send(["SHUTDOWN"]);
    await new Promise((resolve) => this.child.once("exit", resolve));
    this.lines.close();
  }
}

await check("HELLO names wsl-agent/v5", async () => {
  const session = new Session(binary, []);
  const hello = await session.hello;
  assert.equal(hello.name, "wsl-agent");
  assert.equal(hello.version, 5);
  await session.close();
});

await check("PING answers PONG", async () => {
  const session = new Session(binary, []);
  await session.hello;
  session.send(["PING"]);
  await session.pong;
  await session.close();
});

await check("EXEC returns the exit code and both streams", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const result = await session.exec({ argv: ["sh", "-c", "printf out; printf err >&2; exit 7"] });
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.toString(), "out");
  assert.equal(result.stderr.toString(), "err");
  await session.close();
});

await check("SETENV reaches later commands, not earlier ones", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const before = await session.exec({ argv: ["sh", "-c", "printf %s \"${SPIKE_VAR:-unset}\""] });
  assert.equal(before.stdout.toString(), "unset");
  session.setEnv("SPIKE_VAR", "hello world");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = await session.exec({ argv: ["sh", "-c", "printf %s \"$SPIKE_VAR\""] });
  assert.equal(after.stdout.toString(), "hello world");
  await session.close();
});

await check("two EXECs run concurrently; the short one settles first", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const order = [];
  const slow = session.exec({ argv: ["sh", "-c", "sleep 1; printf slow"] }).then((result) => {
    order.push("slow");
    return result;
  });
  const fast = session.exec({ argv: ["sh", "-c", "printf fast"] }).then((result) => {
    order.push("fast");
    return result;
  });
  const [slowResult, fastResult] = await Promise.all([slow, fast]);
  assert.equal(fastResult.stdout.toString(), "fast");
  assert.equal(slowResult.stdout.toString(), "slow");
  assert.deepEqual(order, ["fast", "slow"], "the shell agent is serial; the spike is not");
  await session.close();
});

await check("KILL stops a running request without the second wsl.exe", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const started = Date.now();
  const pending = session.exec({ argv: ["sh", "-c", "sleep 10"] });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const id = [...session.pending.keys()].at(-1);
  assert.ok(id !== undefined);
  session.kill(id);
  const result = await pending;
  assert.ok(result.exitCode !== 0, `killed request exit ${result.exitCode}`);
  assert.ok(Date.now() - started < 5000, "KILL did not wait for the full command");
  await session.close();
});

await check("the in-distro timeout kills the process group", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const started = Date.now();
  const result = await session.exec({ argv: ["sh", "-c", "sleep 5"], timeoutMs: 200 });
  assert.ok(result.exitCode !== 0, `timed-out request exit ${result.exitCode}`);
  assert.ok(Date.now() - started < 3000, "timeout did not fire promptly");
  await session.close();
});

await check("the output cap cuts and still drains the pipe", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const result = await session.exec({ argv: ["sh", "-c", "head -c 100000 /dev/zero"], maxOutputBytes: 1024 });
  assert.equal(result.stdout.length, 1024);
  assert.equal(result.truncated.stdout, true);
  await session.close();
});


const parseStat = (buffer) => {
  const fields = buffer.toString().split("\t");
  return {
    type: fields[0],
    mode: fields[1],
    size: Number(fields[2]),
    dev: fields[3],
    ino: fields[4],
    mtime: fields[5],
    ctime: fields[6],
  };
};

const parseList = (buffer) =>
  buffer
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const fields = record.split("\t");
      return {
        type: fields[0],
        size: Number(fields[1]),
        dev: fields[2],
        ino: fields[3],
        mtime: ns(fields[4]),
        ctime: ns(fields[5]),
        path: fields[6],
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

const ns = (time) => {
  const [seconds, fraction = ""] = String(time).split(".");
  return `${seconds}.${(fraction + "000000000").slice(0, 9)}`;
};

await check("FS stat/lstat/read match the shell agent", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-fs-"));
  try {
    const file = join(root, "a.txt");
    const link = join(root, "link");
    writeFileSync(file, "hello");
    symlinkSync(file, link);
    const results = {};
    for (const [name, command, args] of [["native", binary, []], ["shell", "sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const fileStat = parseStat((await session.fs({ op: "stat", args: [file] })).stdout);
      const linkStat = parseStat((await session.fs({ op: "lstat", args: [link] })).stdout);
      const read = await session.fs({ op: "read", args: [file, "1", "3"] });
      results[name] = {
        file: { ...fileStat, mtime: ns(fileStat.mtime), ctime: ns(fileStat.ctime) },
        link: { ...linkStat, mtime: ns(linkStat.mtime), ctime: ns(linkStat.ctime) },
        read: read.stdout.toString(),
      };
      await session.close();
    }
    assert.equal(results.native.file.type, "f");
    assert.equal(results.native.file.mode, results.shell.file.mode);
    assert.equal(results.native.file.size, 5);
    assert.equal(results.native.file.dev, results.shell.file.dev);
    assert.equal(results.native.file.ino, results.shell.file.ino);
    assert.equal(results.native.file.mtime, results.shell.file.mtime);
    assert.equal(results.native.file.ctime, results.shell.file.ctime);
    assert.equal(results.native.link.type, "l");
    assert.equal(results.native.link.mode, results.shell.link.mode);
    assert.equal(results.native.link.size, results.shell.link.size);
    assert.equal(results.native.read, "ell");
    assert.equal(results.shell.read, "ell");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("FS write (no-replace) publishes and refuses a second create", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-fs-w-"));
  try {
    for (const [name, command, args] of [["native", binary, []], ["shell", "sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const target = join(root, `${name}.txt`);
      const created = await session.fs({ op: "write", args: [target, "644", "no-replace", "-", "written"] });
      assert.equal(created.exitCode, 0, `${name}: ${created.stderr}`);
      assert.equal(readFileSync(target, "utf8"), "written");
      const stat = parseStat((await session.fs({ op: "stat", args: [target] })).stdout);
      assert.equal(stat.mode, "644");
      const again = await session.fs({ op: "write", args: [target, "644", "no-replace", "-", "again"] });
      assert.equal(again.exitCode, 1);
      assert.match(again.stderr.toString(), /^dsh-fs\|exists\|/m);
      assert.equal(readFileSync(target, "utf8"), "written");
      await session.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("FS stat of a missing path reports dsh-fs|notfound", async () => {
  for (const [command, args] of [[binary, []], ["sh", [shellAgent]]]) {
    const session = new Session(command, args);
    await session.hello;
    const result = await session.fs({ op: "stat", args: [join(tmpdir(), "spike-missing-does-not-exist")] });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr.toString(), /^dsh-fs\|notfound\|/m);
    await session.close();
  }
});


await check("FS list and realpath match the shell agent", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-fs-l-"));
  try {
    const file = join(root, "a.txt");
    const sub = join(root, "sub");
    const link = join(root, "link");
    writeFileSync(file, "hello");
    mkdirSync(sub);
    symlinkSync(file, link);
    const results = {};
    for (const [name, command, args] of [["native", binary, []], ["shell", "sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const list = parseList((await session.fs({ op: "list", args: [root] })).stdout);
      const realFile = (await session.fs({ op: "realpath", args: [file] })).stdout.toString();
      const realLink = (await session.fs({ op: "realpath", args: [link] })).stdout.toString();
      const realDir = (await session.fs({ op: "realpath", args: [sub] })).stdout.toString();
      const missingTarget = join(root, "missing", "child");
      const missing = (await session.fs({ op: "realpath", args: [missingTarget] })).stdout.toString();
      results[name] = { list, realFile, realLink, realDir, missing };
      await session.close();
    }
    assert.deepEqual(results.native.list, results.shell.list, "list records match");
    assert.equal(results.native.realFile, results.shell.realFile);
    assert.equal(results.native.realLink, results.shell.realLink);
    assert.equal(results.native.realDir, results.shell.realDir);
    assert.equal(results.native.missing, results.shell.missing);
    assert.equal(results.native.realLink, results.native.realFile);
    assert.ok(results.native.missing.endsWith("/missing/child"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("FS realpath refuses a missing suffix containing ..", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-fs-r-"));
  try {
    const target = `${root}/missing/../x`;
    for (const [command, args] of [[binary, []], ["sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const result = await session.fs({ op: "realpath", args: [target] });
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr.toString(), /^dsh-fs\|notfound\|/m);
      await session.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


const nsNoDot = (time) => {
  const [seconds, fraction = ""] = String(time).split(".");
  return `${seconds}${(fraction + "000000000").slice(0, 9)}`;
};
const versionOf = (stat) => `${stat.dev}:${stat.ino}:${stat.size}:${nsNoDot(stat.mtime)}:${nsNoDot(stat.ctime)}`;

await check("FS replace re-checks the expected version and reports stale", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-fs-v-"));
  try {
    for (const [name, command, args] of [["native", binary, []], ["shell", "sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const file = join(root, `${name}-v.txt`);
      const created = await session.fs({ op: "write", args: [file, "644", "no-replace", "-", "one"] });
      assert.equal(created.exitCode, 0, `${name}: ${created.stderr}`);
      const stat = parseStat((await session.fs({ op: "stat", args: [file] })).stdout);
      const version = versionOf(stat);
      const replaced = await session.fs({ op: "write", args: [file, "644", "replace", version, "two"] });
      assert.equal(replaced.exitCode, 0, `${name} replace: ${replaced.stderr}`);
      assert.equal(readFileSync(file, "utf8"), "two");
      writeFileSync(file, "externally");
      const stale = await session.fs({ op: "write", args: [file, "644", "replace", version, "three"] });
      assert.equal(stale.exitCode, 1);
      assert.match(stale.stderr.toString(), /^dsh-fs\|stale\|/m);
      assert.equal(readFileSync(file, "utf8"), "externally");
      await session.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("FS write publishes a setuid mode and stat reports it", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-fs-m-"));
  try {
    for (const [command, args] of [[binary, []], ["sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const file = join(root, `mode-${Math.random().toString(16).slice(2)}.txt`);
      const created = await session.fs({ op: "write", args: [file, "4755", "no-replace", "-", "mode"] });
      assert.equal(created.exitCode, 0, created.stderr);
      const stat = parseStat((await session.fs({ op: "stat", args: [file] })).stdout);
      assert.equal(stat.mode, "4755");
      await session.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("the shell agent answers the same EXEC shape (differential)", async () => {
  const session = new Session("sh", [shellAgent]);
  const hello = await session.hello;
  assert.equal(hello.name, "wsl-agent");
  assert.equal(hello.version, 5);
  const result = await session.exec({ argv: ["sh", "-c", "printf out; printf err >&2; exit 7"] });
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.toString(), "out");
  assert.equal(result.stderr.toString(), "err");
  await session.close();
});

console.log(`\n${passed} native spike checks pass`);
