/**
 * Spike test for the native agent prototype (ADR 0002, stage 2).
 *
 * It drives the Rust binary over the real v7 frames and compares the shape
 * with the shipped shell agent where it matters. Not part of the unit suite:
 * the binary is built on demand.
 *
 *   node agent/native/spike/test.mjs [path-to-binary]
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { decodeB64, encodeExecFrame, encodeFsbFrame, encodeFsFrame, encodeKill, encodeSetEnv } from "../../../lib/agent-protocol.js";
import { WslAgent } from "../../../lib/agent.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const binary = process.argv[2] ?? join(here, "target", "release", "dsh-wsl-agent-spike");
const shellAgent = join(repo, "agent", "wsl-agent.sh");
const nativeRunner = process.env.DSH_NATIVE_TEST_RUNNER;

function spawnAgent(command, args) {
  return command === binary && nativeRunner
    ? spawn(nativeRunner, [binary, ...args], { stdio: ["pipe", "pipe", "pipe"] })
    : spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
}

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
    this.child = spawnAgent(command, args);
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
        this.helloResolve({ name: f[1], version: Number(f[2]), digest: f[3], pid: Number(f[4]), caps: f[5] ?? "" });
        return;
      }
      if (f[0] === "PONG") {
        this.pongResolve?.();
        return;
      }
      if (f[0] === "ACK") return;
      if (f[0] === "FSERR") {
        const entry = this.pending.get(f[1]);
        if (entry === undefined) return;
        this.pending.delete(f[1]);
        entry.resolve({
          exitCode: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(`dsh-fs|${f[2]}|${f[3]}\n`),
          truncated: { stdout: false, stderr: false },
          reason: f[2],
        });
        return;
      }
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

  exec({ argv, cwd = repo, timeoutMs = 0, maxOutputBytes = 0, stdin }) {
    const id = `r${this.next += 1}`;
    this.send(encodeExecFrame({ id, cwd, argv, timeoutMs, maxOutputBytes, ...(stdin === undefined ? {} : { stdin }) }));
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

  fsb({ ops }) {
    const id = `r${this.next += 1}`;
    this.send(encodeFsbFrame({ id, ops }));
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

await check("HELLO digest is the running binary's sha256", async () => {
  const expected = createHash("sha256").update(readFileSync(binary)).digest("hex");
  const session = new Session(binary, []);
  const hello = await session.hello;
  assert.equal(hello.digest, expected, "the handshake binds the process to the copied binary");
  await session.close();
});

await check("HELLO names wsl-agent/v7 with the native capabilities", async () => {
  const session = new Session(binary, []);
  const hello = await session.hello;
  assert.equal(hello.name, "wsl-agent");
  assert.equal(hello.version, 7);
  assert.match(hello.caps, /(^|,)batch(,|$)/, "the native agent advertises the batch frame");
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

await check("the EXEC timeout is seconds, not milliseconds", async () => {
  const session = new Session(binary, []);
  await session.hello;
  const result = await session.exec({ argv: ["sh", "-c", "sleep 0.3; printf ok"], timeoutMs: 2000 });
  assert.equal(result.exitCode, 0, `a 2 s budget must not kill a 300 ms command (exit ${result.exitCode})`);
  assert.equal(result.stdout.toString(), "ok");
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

/**
 * Fail a request that does not settle in time. The deadlock the stdin checks
 * guard against held its request until the host's watchdog killed the
 * transport eighteen seconds in; nothing correct needs that long.
 * @template T
 * @param {Promise<T>} promise - the request.
 * @param {number} ms - the bound.
 * @param {string} what - the failure to report.
 * @returns {Promise<T>} the request's own result.
 */
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => {
  const timer = setTimeout(() => reject(new Error(what)), ms);
  timer.unref?.();
})]);

await check("a stdin payload past the pipe buffers feeds an echoing child", async () => {
  const session = new Session(binary, []);
  await session.hello;
  // 2 MiB holding every byte value, so the feed is proved binary-safe as well
  // as large: fed from the request thread before the output readers started,
  // 1.25 MiB deadlocked `cat` — it filled its stdout pipe and stopped reading.
  const payload = Buffer.alloc(2 * 1024 * 1024);
  for (let index = 0; index < payload.length; index += 1) payload[index] = index & 0xff;
  try {
    const result = await within(session.exec({ argv: ["cat"], stdin: payload }), 15_000, "the feed deadlocked: the request never settled");
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.equals(payload), "the child read the payload whole and echoed it whole");
    assert.equal(result.truncated.stdout, false);
  } finally {
    // A wedged agent is shut down too, so a failure here cannot hang the run.
    await session.close();
  }
});

await check("a payload the child never reads does not hold the request", async () => {
  const session = new Session(binary, []);
  await session.hello;
  try {
    const result = await within(
      session.exec({ argv: ["sh", "-c", "printf done"], stdin: Buffer.alloc(2 * 1024 * 1024, 0x61) }),
      15_000,
      "the unfinished feed held the request",
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.toString(), "done");
    // The agent is still itself afterwards: the feed that was cut short by the
    // child's exit did not take the loop down with it.
    const next = await within(session.exec({ argv: ["sh", "-c", "printf next"] }), 15_000, "the agent stopped answering");
    assert.equal(next.stdout.toString(), "next");
  } finally {
    await session.close();
  }
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

await check("an immediately cancelled EXEC does not start after KILL", async () => {
  const session = new Session(binary, []);
  try {
    await session.hello;
    const pending = [];
    for (let index = 1; index <= 24; index += 1) {
      pending.push(session.exec({ argv: ["sh", "-c", "sleep 0.1; printf survived"] }));
      session.kill(`r${index}`);
    }
    const results = await Promise.all(pending);
    assert.ok(results.every((result) => result.exitCode !== 0 && result.stdout.length === 0));
  } finally {
    await session.close();
  }
});

await check("a cancelled queued FS write never publishes", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-cancel-"));
  const fifo = join(root, "fifo");
  const target = join(root, "target");
  assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
  const session = new Session(binary, []);
  try {
    await session.hello;
    // A batch that holds a mutation keeps fs_lock while its first op waits
    // on the FIFO, so the plain write below queues on the lock behind it. (A
    // read alone no longer holds the lock: reads wait for nothing.)
    const blocked = session.fsb({
      ops: [
        { op: "read", args: [fifo, "0", "10"] },
        { op: "write", args: [join(root, "batch-target"), "-", "no-replace", "-", "content"] },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(existsSync(join(root, "batch-target")), false, "precondition: the batch has not reached its write");
    const write = session.fs({ op: "write", args: [target, "-", "no-replace", "-", "content"] });
    session.kill("r2");
    const writer = spawn("sh", ["-c", "printf x > \"$1\"", "sh", fifo]);
    const writerDone = new Promise((resolve) => writer.once("exit", resolve));
    await blocked;
    const result = await write;
    await writerDone;
    assert.notEqual(result.exitCode, 0);
    assert.equal(existsSync(target), false);
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
});

await check("native writes preserve an existing staging-like directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-stage-"));
  const session = new Session(binary, []);
  try {
    const { pid } = await session.hello;
    const existing = join(root, `.target.${pid}.tmpdir`);
    mkdirSync(existing);
    writeFileSync(join(existing, "keep"), "existing");
    const result = await session.fs({ op: "write", args: [join(root, "target"), "-", "no-replace", "-", "content"] });
    assert.equal(result.exitCode, 0);
    assert.equal(readFileSync(join(existing, "keep"), "utf8"), "existing");
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
});

await check("native writes support maximum-length file names", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-long-name-"));
  const session = new Session(binary, []);
  try {
    await session.hello;
    const target = join(root, "x".repeat(255));
    const result = await session.fs({ op: "write", args: [target, "-", "no-replace", "-", "content"] });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(readFileSync(target, "utf8"), "content");
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
});

await check("a background child holding output does not delay EXEC", async () => {
  const session = new Session(binary, []);
  try {
    await session.hello;
    const started = Date.now();
    const result = await session.exec({ argv: ["sh", "-c", "sleep 2 & printf done"] });
    assert.equal(result.stdout.toString(), "done");
    assert.ok(Date.now() - started < 1500);
  } finally {
    await session.close();
  }
});

await check("continuous background output does not hold a completed EXEC", async () => {
  const session = new Session(binary, []);
  try {
    await session.hello;
    const result = await Promise.race([
      session.exec({ argv: ["sh", "-c", "yes & yes & yes & printf done"], maxOutputBytes: 1024 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("background output held the request")), 3000)),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.length <= 1024);
  } finally {
    await session.close();
  }
});

await check("request environments stay isolated for both agents", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-env-"));
  const equalsCommand = join(root, "command=name");
  writeFileSync(equalsCommand, "#!/bin/sh\nprintf %s \"$DSH_ENV_TEST\"\n", { mode: 0o700 });
  try {
    for (const [command, args] of [[binary, []], ["sh", [shellAgent]]]) {
      const agent = new WslAgent({
        distro: "test",
        scriptPath: shellAgent,
        idleMs: 0,
        signalable: false,
        serialRequests: command !== binary,
        spawnTransport: () => spawnAgent(command, args),
      });
      try {
        const request = (env) => agent.exec({ cwd: repo, argv: ["sh", "-c", "printf %s \"${DSH_ENV_TEST-unset}\""], env });
        const first = await request({ DSH_ENV_TEST: "first" });
        const absent = await request({});
        const concurrent = await Promise.all([request({ DSH_ENV_TEST: "left" }), request({ DSH_ENV_TEST: "right" })]);
        assert.equal(first.stdout.toString(), "first");
        assert.equal(absent.stdout.toString(), "unset");
        assert.deepEqual(concurrent.map((result) => result.stdout.toString()), ["left", "right"]);
        const equalsResult = await agent.exec({ cwd: root, argv: [equalsCommand], env: { DSH_ENV_TEST: "equals" } });
        assert.equal(equalsResult.stdout.toString(), "equals");
      } finally {
        await agent.close();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("FSB answers a batch of ops in one round trip (both agents)", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-fsb-"));
  try {
    const file = join(root, "a.txt");
    writeFileSync(file, "batch-body");
    for (const [name, command, args] of [["native", binary, []], ["shell", "sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const missing = join(root, "missing.txt");
      const result = await session.fsb({
        ops: [
          { op: "stat", args: [file] },
          { op: "read", args: [file, "0", "100"] },
          { op: "stat", args: [missing] },
        ],
      });
      assert.equal(result.exitCode, 0, `${name}: ${result.stderr}`);
      const records = result.stdout.toString().trim().split("\n");
      assert.equal(records.length, 3, `${name}: one record per op`);
      assert.match(records[0], /^OK 1\|/, `${name}: stat succeeded`);
      assert.match(records[1], /^OK 2\|/, `${name}: read succeeded`);
      assert.equal(Buffer.from(records[1].slice("OK 2|".length), "base64").toString(), "batch-body");
      assert.match(records[2], /^BAD 3\|notfound\|/, `${name}: a failed member keeps the batch going`);
      await session.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("FS delete guards its version and removes the file", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-del-"));
  try {
    for (const [name, command, args] of [["native", binary, []], ["shell", "sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const file = join(root, `${name}-del.txt`);
      writeFileSync(file, "gone-soon");
      const stat = parseStat((await session.fs({ op: "stat", args: [file] })).stdout);
      const stale = await session.fs({ op: "delete", args: [file, "0:0:0:0:0"] });
      assert.equal(stale.reason, "stale", `${name}: a wrong version is stale`);
      assert.equal(readFileSync(file, "utf8"), "gone-soon", `${name}: the file survived the refusal`);
      const removed = await session.fs({ op: "delete", args: [file, versionOf(stat)] });
      assert.equal(removed.exitCode, 0, `${name}: delete with the observed version succeeds`);
      assert.equal(existsSync(file), false, `${name}: the file is gone`);
      await session.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("FS move publishes the destination, guards the source and removes it", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-mv-"));
  try {
    for (const [name, command, args] of [["native", binary, []], ["shell", "sh", [shellAgent]]]) {
      const session = new Session(command, args);
      await session.hello;
      const source = join(root, `${name}-src.txt`);
      const destination = join(root, `${name}-dst.txt`);
      writeFileSync(source, "moved-body");
      const stat = parseStat((await session.fs({ op: "stat", args: [source] })).stdout);
      const stale = await session.fs({ op: "move", args: [source, destination, "600", "replace", "0:0:0:0:0", "-"] });
      assert.equal(stale.reason, "stale", `${name}: a wrong source version is stale`);
      assert.equal(existsSync(source), true, `${name}: the source survived the refusal`);
      const moved = await session.fs({ op: "move", args: [source, destination, "600", "replace", versionOf(stat), "-"] });
      assert.equal(moved.exitCode, 0, `${name}: ${moved.stderr}`);
      assert.equal(readFileSync(destination, "utf8"), "moved-body");
      assert.equal(existsSync(source), false, `${name}: the source is removed after publication`);
      await session.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A scratch directory on another filesystem than the tmpdir, or null where
 * this machine has none to offer.
 * @returns {string | null} the directory, or null.
 */
const secondFilesystem = () => {
  const here = statSync(tmpdir()).dev;
  for (const base of ["/dev/shm", repo, process.env.HOME]) {
    if (base === undefined) continue;
    try {
      if (statSync(base).dev === here) continue;
      return mkdtempSync(join(base, ".dsh-spike-cross-"));
    } catch {
      // Not a usable filesystem here; the next candidate may be.
    }
  }
  return null;
};

await check("a read-only op does not wait behind a blocked mutation", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-lock-"));
  const fifo = join(root, "fifo");
  const batchTarget = join(root, "batch-target");
  const probed = join(root, "probed");
  assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
  writeFileSync(probed, "x");
  const session = new Session(binary, []);
  try {
    await session.hello;
    // One batch, holding a mutation, stuck in its own first op: opening a
    // FIFO for reading waits for a writer.
    const blocked = session.fsb({
      ops: [
        { op: "read", args: [fifo, "0", "10"] },
        { op: "write", args: [batchTarget, "-", "no-replace", "-", "content"] },
      ],
    });
    // A failed check closes the session with the batch still pending; its
    // rejection then must not take the whole run down as unhandled.
    blocked.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(existsSync(batchTarget), false, "precondition: the batch has not reached its write");
    // Behind one lock this stat queued after the batch and answered only once
    // the FIFO opened.
    const stat = await within(session.fs({ op: "stat", args: [probed] }), 2000, "the read waited behind the blocked mutation");
    assert.equal(stat.exitCode, 0, stat.stderr);
    assert.equal(existsSync(batchTarget), false, "the mutation is still blocked: the read answered while it waited");
    const writer = spawn("sh", ["-c", "printf x > \"$1\"", "sh", fifo]);
    await new Promise((resolve) => writer.once("exit", resolve));
    await blocked;
    assert.equal(readFileSync(batchTarget, "utf8"), "content", "the batch finished once the FIFO opened");
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
});

await check("a listing of a directory under churn keeps answering", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-list-"));
  const dir = join(root, "dir");
  mkdirSync(dir);
  for (let index = 0; index < 200; index += 1) writeFileSync(join(dir, `base-${index}`), "x");
  const session = new Session(binary, []);
  let changes = 0;
  let stop = false;
  // Entries appear and vanish the way a build output directory's do.
  const churn = (async () => {
    let count = 0;
    while (!stop) {
      const path = join(dir, `churn-${count += 1}`);
      writeFileSync(path, "x");
      rmSync(path);
      changes += 1;
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
  try {
    await session.hello;
    /** @type {string[]} */
    const failures = [];
    let listings = 0;
    for (let round = 0; round < 40; round += 1) {
      const results = await Promise.all(Array.from({ length: 8 }, () => session.fs({ op: "list", args: [dir] })));
      for (const result of results) {
        listings += 1;
        if (result.exitCode !== 0) failures.push(result.stderr.toString().trim());
      }
    }
    stop = true;
    await churn;
    assert.ok(changes > 50, `precondition: the directory changed while it was listed (${changes} changes)`);
    assert.deepEqual(failures.slice(0, 3), [], `${failures.length} of ${listings} listings failed while the directory existed`);
  } finally {
    stop = true;
    await churn;
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
});

await check("a timed-out command gets the TERM grace to clean up", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-timeout-"));
  const marker = join(root, "cleaned");
  const session = new Session(binary, []);
  try {
    await session.hello;
    // The handler needs half a second — past the 100 ms the timeout used to
    // allow before KILL, well inside the cancel path's three.
    const result = await within(
      session.exec({
        argv: ["sh", "-c", `trap 'sleep 0.5; printf done > "${marker}"; exit 0' TERM; sleep 30`],
        timeoutMs: 1000,
      }),
      8000,
      "the timed-out command never settled",
    );
    assert.equal(result.exitCode, 0, `the cleanup ran and the command left with its own status (exit ${result.exitCode})`);
    assert.equal(readFileSync(marker, "utf8"), "done");
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
});

await check("a move on one filesystem is a rename: the same inode, nothing copied", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-rename-"));
  /** @type {string | null} */
  let other = null;
  const session = new Session(binary, []);
  try {
    await session.hello;
    const source = join(root, "src.bin");
    const destination = join(root, "dst.bin");
    writeFileSync(source, Buffer.alloc(4 * 1024 * 1024, 1));
    const before = statSync(source);
    const moved = await session.fs({
      op: "move",
      args: [source, destination, "640", "replace", versionOf(parseStat((await session.fs({ op: "stat", args: [source] })).stdout)), "-"],
    });
    assert.equal(moved.exitCode, 0, moved.stderr);
    assert.equal(existsSync(source), false, "the source is gone: it was moved, not copied");
    const after = statSync(destination);
    assert.deepEqual({ dev: after.dev, ino: after.ino }, { dev: before.dev, ino: before.ino }, "the destination is the source's own inode under its new name");
    assert.equal(after.mode & 0o777, 0o640, "the requested mode is applied to the moved file");
    assert.equal(after.size, 4 * 1024 * 1024);
    assert.deepEqual(readdirSync(root).filter((name) => name.includes(".tmpdir")), [], "a rename stages nothing");

    // The no-replace guard is the kernel's: a destination that is already
    // there fails instead of being replaced.
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    const fresh = join(root, "fresh.txt");
    writeFileSync(first, "one");
    writeFileSync(second, "two");
    const refused = await session.fs({ op: "move", args: [first, second, "-", "no-replace", "-", "-"] });
    assert.equal(refused.reason, "exists", `${refused.exitCode}: ${refused.stderr}`);
    assert.equal(readFileSync(first, "utf8"), "one", "the source survives the refusal");
    assert.equal(readFileSync(second, "utf8"), "two", "and the destination was not replaced");
    const created = await session.fs({ op: "move", args: [first, fresh, "-", "no-replace", "-", "-"] });
    assert.equal(created.exitCode, 0, created.stderr);
    assert.equal(existsSync(first), false);
    assert.equal(readFileSync(fresh, "utf8"), "one");

    // Across filesystems a rename is refused and the copy is the move.
    other = secondFilesystem();
    if (other === null) {
      console.log("INFO  no second filesystem here: the cross-filesystem move (the copy path) was not exercised");
    } else {
      const big = join(root, "cross.bin");
      const far = join(other, "cross-dst.bin");
      writeFileSync(big, Buffer.alloc(2 * 1024 * 1024, 7));
      const bigStat = statSync(big);
      const copied = await session.fs({
        op: "move",
        args: [big, far, "-", "replace", versionOf(parseStat((await session.fs({ op: "stat", args: [big] })).stdout)), "-"],
      });
      assert.equal(copied.exitCode, 0, copied.stderr);
      assert.equal(existsSync(big), false, "the source is removed after the copy");
      const farStat = statSync(far);
      assert.equal(farStat.size, 2 * 1024 * 1024);
      assert.notDeepEqual({ dev: farStat.dev, ino: farStat.ino }, { dev: bigStat.dev, ino: bigStat.ino }, "a new inode on the other filesystem: the file was copied");
    }
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
    if (other !== null) rmSync(other, { recursive: true, force: true });
  }
});

await check("a write sweeps the staging directories of dead creators only (both agents)", async () => {
  const root = mkdtempSync(join(tmpdir(), "spike-sweep-"));
  try {
    for (const [name, command, args] of [["native", binary, []], ["shell", "sh", [shellAgent]]]) {
      // The name is the same on both agents — `.<base>.<pid>.<token>.tmpdir`
      // — so either sweep recognises the other's leftovers.
      const orphan = join(root, `.${name}-target.99999999.deadbeef.tmpdir`);
      const live = join(root, `.${name}-target.${process.pid}.feedface.tmpdir`);
      const foreign = join(root, `.${name}-other.99999999.deadbeef.tmpdir`);
      const lookalike = join(root, `.${name}-target.99999999.tmpdir`);
      for (const directory of [orphan, live, foreign, lookalike]) {
        mkdirSync(directory);
        writeFileSync(join(directory, "keep"), "x");
      }
      const session = new Session(command, args);
      try {
        await session.hello;
        const result = await session.fs({ op: "write", args: [join(root, `${name}-target`), "-", "no-replace", "-", "content"] });
        assert.equal(result.exitCode, 0, `${name}: ${result.stderr}`);
      } finally {
        await session.close();
      }
      assert.equal(existsSync(orphan), false, `${name}: the staging directory of a process that is gone is swept`);
      assert.equal(existsSync(live), true, `${name}: a live creator keeps its directory`);
      assert.equal(existsSync(foreign), true, `${name}: another target's staging is not this write's to sweep`);
      assert.equal(existsSync(lookalike), true, `${name}: a directory that merely looks like staging is kept`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await check("the shell agent answers the same EXEC shape (differential)", async () => {
  const session = new Session("sh", [shellAgent]);
  const hello = await session.hello;
  assert.equal(hello.name, "wsl-agent");
  assert.equal(hello.version, 7);
  assert.match(hello.caps, /(^|,)batch(,|$)/, "the shell agent advertises the batch frame");
  assert.doesNotMatch(hello.caps, /(^|,)conc(,|$)/, "the shell agent's serial loop does not advertise concurrency");
  const result = await session.exec({ argv: ["sh", "-c", "printf out; printf err >&2; exit 7"] });
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.toString(), "out");
  assert.equal(result.stderr.toString(), "err");
  await session.close();
});

console.log(`\n${passed} native spike checks pass`);
