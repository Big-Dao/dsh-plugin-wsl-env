/**
 * Assertion checks for the listening-port snapshot parser. Pure module, so
 * this runs everywhere including CI.
 *
 *   node test/ports.test.mjs
 */
import assert from "node:assert/strict";
import { listeningPorts, parseListeningPorts, procNetScript } from "../lib/ports.js";

let passed = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

const SAMPLE = [
  "  sl  local_address                        rem_address              st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
  "   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1",
  "   1: 0100007F:0035 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 23456 1",
  "   2: 00000000:1F90 00000000:0000 01 00000000:00000000 00:00000000 00000000  1000        0 34567 1",
  "   3: 00000000:0000 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 45678 1",
].join("\n");

check("state 0A (LISTEN) is the only state collected", () => {
  assert.deepEqual(parseListeningPorts(SAMPLE), [53, 8080]);
});

check("ports come back ascending and deduplicated", () => {
  const text = [
    "  sl  local_address rem_address st",
    "   0: 00000000:0050 00000000:0000 0A 0",
    "   1: 00000000:0016 00000000:0000 0A 0",
    "   2: 00000000:0050 00000000:0000 0A 0",
  ].join("\n");
  assert.deepEqual(parseListeningPorts(text), [22, 80]);
});

check("a missing file's empty body parses to no ports", () => {
  assert.deepEqual(parseListeningPorts(""), []);
});

check("the script reads both tcp and tcp6, tolerating absence", () => {
  assert.equal(procNetScript(), "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null");
});

check("a failing runner yields an empty snapshot, never a throw", async () => {
  const ports = await listeningPorts({ exec: () => Promise.reject(new Error("agent down")) });
  assert.deepEqual(ports, []);
});

for (const [name, fn] of checks) await runCheck(name, fn);
console.log(`\n${passed} ports checks pass`);
