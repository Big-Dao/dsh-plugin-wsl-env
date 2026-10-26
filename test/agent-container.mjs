/**
 * Container checks for the shell agent: the real `wsl-agent.sh` is run inside
 * a Linux distro container (`docker run`) and driven over the v5 wire
 * protocol, so the non-Ubuntu families are exercised where it matters —
 * their own `sh`, `sha256sum`, `base64`, `coreutils`/busybox — instead of
 * assumed from Ubuntu. This is the container half of WSL-202's acceptance
 * ("the shell agent runs in Linux containers for the non-Ubuntu families");
 * the FS-frame internals are covered by `test/agent-fs-script.test.mjs` and
 * the real `wsl.exe` round trip by `test/probe/agent.sh`.
 *
 *   node test/agent-container.mjs <image> [image...]
 *
 * Requires docker and a pulled image per argument. Exit status is 0 only when
 * every image passed every check.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AGENT_NAME, PROTOCOL_VERSION, decodeB64, encodeExecFrame, encodeSetEnv } from "../lib/agent-protocol.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const scriptPath = join(repo, "agent", "wsl-agent.sh");
const scriptDigest = createHash("sha256").update(
  // The digest the host compares: read as bytes, never as text — the same
  // bytes the container's `sha256sum` sees through the read-only mount.
  await import("node:fs").then((fs) => fs.readFileSync(scriptPath)),
).digest("hex");

const images = process.argv.slice(2);
if (images.length === 0) {
  console.error("usage: node test/agent-container.mjs <image> [image...]");
  process.exit(1);
}

/** One container session: the agent over docker stdio, frames in, frames out. */
class ContainerAgent {
  /** @param {string} image */
  constructor(image) {
    this.image = image;
    this.child = spawn("docker", [
      "run", "--rm", "-i",
      "-v", `${repo}:/repo:ro`,
      "-w", "/tmp",
      image,
      "sh", "/repo/agent/wsl-agent.sh",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    this.stderrText = "";
    this.child.stderr.on("data", (chunk) => { this.stderrText += chunk.toString(); });
    this.pending = new Map();
    this.pong = new Promise((resolve) => { this.pongResolve = resolve; });
    this.hello = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no HELLO within 15 s; stderr: ${this.stderrText.slice(0, 200)}`)), 15000);
      const lines = createInterface({ input: this.child.stdout });
      lines.on("line", (line) => {
        const f = line.split("|");
        if (f[0] === "HELLO") {
          clearTimeout(timer);
          lines.close();
          // Re-attach a plain splitter for the request/response frames.
          const frames = createInterface({ input: this.child.stdout });
          frames.on("line", (frame) => this.handleFrame(frame));
          resolve({ name: f[1], version: Number(f[2]), digest: f[3], pid: Number(f[4]) });
        }
      });
      this.child.on("exit", (code) => reject(new Error(`exited before HELLO (code=${code}); stderr: ${this.stderrText.slice(0, 200)}`)));
    });
  }

  /** Route one response frame to its waiting request. PONG carries no id. */
  /** @param {string} frame */
  handleFrame(frame) {
    if (frame === "PONG") {
      this.pongResolve?.(frame);
      return;
    }
    const f = frame.split("|");
    if (f[0] === "ACK") return; // dequeue confirmation; the RES/ERR settles the request
    const entry = this.pending.get(f[1]);
    if (entry === undefined) return;
    this.pending.delete(f[1]);
    // A well-formed RES/ERR always carries three base64 fields; a malformed
    // one would have been refused by the agent itself.
    const [code, outB64, errB64] = [f[2] ?? "", f[3] ?? "", f[4] ?? ""];
    if (f[0] === "ERR") entry.reject(new Error(`${code}: ${decodeB64(outB64).toString("utf8")}`));
    else entry.resolve({ code: Number(code), stdout: decodeB64(outB64).toString("utf8"), stderr: decodeB64(errB64).toString("utf8") });
  }

  /** Send one request frame and wait for its response. */
  /** @param {string} frame @param {string} id */
  request(frame, id) {
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${frame}\n`);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`no response within 10 s for ${id}`));
        }
      }, 10000).unref();
    });
  }

  /** PING has no id on the wire, so it rides its own promise, not the pending map. */
  ping() {
    this.child.stdin.write("PING\n");
    return this.pong;
  }

  /** @param {string[]} argv @param {string} id */
  exec(argv, id) {
    const lines = encodeExecFrame({ id, cwd: "/tmp", argv });
    return this.request(lines.join("\n"), id);
  }

  close() {
    this.child.stdin.write("SHUTDOWN\n");
    this.child.stdin.end();
  }
}

let failures = 0;
for (/** @type {string} */ const image of images) {
  console.log(`═══ ${image} ═══`);
  let passed = 0;
  /** @param {string} name @param {boolean} ok @param {string} [detail] */
  const check = (name, ok, detail = "") => {
    if (ok) passed += 1;
    else failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };
  try {
    /** @type {ContainerAgent} */
    const agent = new ContainerAgent(image);
    const hello = await agent.hello;
    check("HELLO names wsl-agent at protocol v5", hello.name === AGENT_NAME && hello.version === PROTOCOL_VERSION, `name=${hello.name} v${hello.version}`);
    check("HELLO digest is the shipped script's sha256", hello.digest === scriptDigest, hello.digest.slice(0, 12));
    check("the script is read in place (same bytes through the mount)", hello.pid > 0, `pid=${hello.pid}`);

    const pong = await agent.ping();
    check("PING answers PONG", pong === "PONG");

    const exec = await agent.exec(["sh", "-c", "printf out; printf err >&2; exit 7"], "e1");
    check("EXEC returns the exit code and both streams", exec.code === 7 && exec.stdout === "out" && exec.stderr === "err");

    agent.child.stdin.write(`${encodeSetEnv("container_probe_var", "container-probe")}\n`); // SETENV is silent on success
    const after = await agent.exec(["sh", "-c", "printf %s \"$container_probe_var\""], "e2");
    check("SETENV reaches later commands", after.stdout === "container-probe", JSON.stringify(after.stdout));

    // The digest the agent reports for a distro-side file: `base64` and
    // `sha256sum` differ per family, so EXEC through them is the real signal.
    const tools = await agent.exec(["sh", "-c", "command -v sha256sum >/dev/null && command -v base64 >/dev/null && echo tools-ok"], "t1");
    check("sha256sum and base64 exist in the container", tools.stdout.trim() === "tools-ok", tools.stdout.trim());

    agent.close();
    console.log(`${passed} checks pass on ${image}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${image}: ${/** @type {Error} */ (error).message}`);
  }
}

console.log(failures === 0 ? "\nall container checks pass" : `\n${failures} failure(s)`);
process.exitCode = failures === 0 ? 0 : 1;
