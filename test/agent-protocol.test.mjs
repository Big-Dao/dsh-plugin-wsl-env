/**
 * Assertion checks for the agent wire protocol codecs. Pure module, no peers,
 * so this runs everywhere including CI.
 *
 * Not covered here: the agent script's own behaviour — that is what
 * `test/probe/agent.sh` executes against a real distro.
 *
 *   node test/agent-protocol.test.mjs
 */
import assert from "node:assert/strict";
import {
  AGENT_NAME,
  FS_READ_CHUNK_BYTES,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  decodeB64,
  encodeB64,
  encodeExecFrame,
  encodeFsFrame,
  encodeKill,
  encodeSetEnv,
  parseAgentLine,
} from "../lib/agent-protocol.js";
import { relabelFrame } from "../lib/agent.js";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

check("base64 round-trips binary payloads, including NUL and newlines", () => {
  const payload = Buffer.from([0, 1, 10, 13, 255, 32]);
  assert.deepEqual(decodeB64(encodeB64(payload)), payload);
});

check("a malformed base64 field decodes to empty instead of throwing", () => {
  assert.deepEqual(decodeB64("not*valid"), Buffer.alloc(0));
  assert.deepEqual(decodeB64(""), Buffer.alloc(0));
});

check("the EXEC frame is a header line followed by one base64 line per argv word", () => {
  const lines = encodeExecFrame({ id: "r7", cwd: "/home/you", argv: ["bwrap", "--ro-bind", "/", "/"], timeoutMs: 2500 });
  assert.equal(lines[0], `EXEC|r7|${encodeB64("/home/you")}|3|4|0`);
  assert.deepEqual(lines.slice(1), [encodeB64("bwrap"), encodeB64("--ro-bind"), encodeB64("/"), encodeB64("/")]);
});

check("the EXEC frame carries the per-stream capture budget the agent enforces", () => {
  const capped = encodeExecFrame({ id: "r1", cwd: "/", argv: ["x"], timeoutMs: 0, maxOutputBytes: 64000 });
  assert.equal(capped[0], `EXEC|r1|${encodeB64("/")}|0|1|64000`);
  const fractional = encodeExecFrame({ id: "r2", cwd: "/", argv: ["x"], maxOutputBytes: 1024.9 });
  assert.equal(fractional[0].split("|")[5], "1024", "a fractional cap floors to whole bytes");
  const negative = encodeExecFrame({ id: "r3", cwd: "/", argv: ["x"], maxOutputBytes: -5 });
  assert.equal(negative[0].split("|")[5], "0", "a nonsense cap is the unlimited 0");
});

check("a sub-second timeout rounds up; zero and negative disable it", () => {
  const one = encodeExecFrame({ id: "a", cwd: "/", argv: ["x"], timeoutMs: 1 });
  const zero = encodeExecFrame({ id: "a", cwd: "/", argv: ["x"], timeoutMs: 0 });
  const negative = encodeExecFrame({ id: "a", cwd: "/", argv: ["x"], timeoutMs: -5 });
  assert.equal(one[0].split("|")[3], "1");
  assert.equal(zero[0].split("|")[3], "0");
  assert.equal(negative[0].split("|")[3], "0");
});

check("SETENV and KILL frames carry their payloads base64-encoded where binary is possible", () => {
  assert.equal(encodeSetEnv("PATH", "/usr/bin"), `SETENV|PATH|${encodeB64("/usr/bin")}`);
  assert.equal(encodeKill("r2"), "KILL|r2");
});

check("the HELLO handshake parses to name, version, and the script digest", () => {
  assert.deepEqual(parseAgentLine(`HELLO|${AGENT_NAME}|${PROTOCOL_VERSION}`), { type: "hello", name: AGENT_NAME, version: PROTOCOL_VERSION, digest: "" });
  const digest = "ab".repeat(32);
  assert.deepEqual(parseAgentLine(`HELLO|${AGENT_NAME}|${PROTOCOL_VERSION}|${digest}`), { type: "hello", name: AGENT_NAME, version: PROTOCOL_VERSION, digest });
});

check("a RES line yields the exit code and decoded output buffers", () => {
  const stdout = Buffer.from([0, 9, 104, 105]);
  const stderr = Buffer.from("boom\n");
  const message = parseAgentLine(`RES|r1|0|${encodeB64(stdout)}|${encodeB64(stderr)}`);
  assert.equal(message.type, "result");
  assert.equal(message.id, "r1");
  assert.equal(message.exitCode, 0);
  assert.deepEqual(message.stdout, stdout);
  assert.deepEqual(message.stderr, stderr);
});

check("a RES line's capture-cap flags say which streams were cut", () => {
  const cut = parseAgentLine(`RES|r1|0|${encodeB64(Buffer.alloc(0))}|${encodeB64(Buffer.alloc(0))}|1|0`);
  assert.deepEqual(cut.truncated, { stdout: true, stderr: false });
  const whole = parseAgentLine(`RES|r1|0|${encodeB64(Buffer.alloc(0))}|${encodeB64(Buffer.alloc(0))}|0|0`);
  assert.deepEqual(whole.truncated, { stdout: false, stderr: false });
});

check("an ERR line yields its reason and decoded message", () => {
  const message = parseAgentLine(`ERR|r3|cwd|${encodeB64("/gone")}`);
  assert.equal(message.type, "agentError");
  assert.equal(message.id, "r3");
  assert.equal(message.reason, "cwd");
  assert.equal(message.message, "/gone");
});

check("PONG and unrecognized lines parse without throwing", () => {
  assert.deepEqual(parseAgentLine("PONG"), { type: "pong" });
  assert.deepEqual(parseAgentLine("total garbage"), { type: "unknown", line: "total garbage" });
});

check("an ACK line parses to the dequeue signal with its request id", () => {
  assert.deepEqual(parseAgentLine("ACK|r4"), { type: "ack", id: "r4" });
});

check("the FS frame mirrors EXEC's shape: header, then one base64 line per argument", () => {
  const lines = encodeFsFrame({ id: "r8", op: "write", args: ["/tmp/f.txt", "644", "replace", "aGk="], timeoutMs: 2500 });
  assert.equal(lines[0], `FS|r8|write|3|4`);
  assert.deepEqual(lines.slice(1), [encodeB64("/tmp/f.txt"), encodeB64("644"), encodeB64("replace"), encodeB64("aGk=")]);
  assert.equal(encodeFsFrame({ id: "r9", op: "stat", args: ["/x"] })[0], `FS|r9|stat|0|1`);
});

check("the FS read chunk keeps one frame's payload modest", () => {
  assert.ok(FS_READ_CHUNK_BYTES >= 64 * 1024, "chunk must not be tiny");
  assert.ok(FS_READ_CHUNK_BYTES <= MAX_FRAME_BYTES, "chunk must ride one frame");
});

check("relabelFrame rewrites EXEC and KILL ids and leaves SETENV alone", () => {
  const frame = [encodeSetEnv("A", "1"), ...encodeExecFrame({ id: "r1", cwd: "/", argv: ["x"], timeoutMs: 0 })];
  const relabelled = relabelFrame(frame, "r9");
  assert.equal(relabelled[0], frame[0]);
  assert.equal(relabelled[1].split("|")[1], "r9");
  assert.deepEqual(relabelled.slice(2), frame.slice(2));
  assert.equal(relabelFrame(["KILL|r1"], "r9")[0], "KILL|r9");
  assert.deepEqual(relabelFrame(["PONG"], "r9"), ["PONG"]);
});

check("relabelFrame rewrites FS ids so a rebuild-relayed fs request does not collide", () => {
  const frame = encodeFsFrame({ id: "r1", op: "read", args: ["/tmp/f", "0", "1024"] });
  const relabelled = relabelFrame(frame, "r7");
  assert.equal(relabelled[0], `FS|r7|read|0|3`);
  assert.deepEqual(relabelled.slice(1), frame.slice(1));
});

console.log(`\n${passed} protocol checks pass`);
