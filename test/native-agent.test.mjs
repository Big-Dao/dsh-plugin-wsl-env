/**
 * Checks for the native agent's host-side copy/verify plumbing (ADR 0002).
 */
import assert from "node:assert/strict";
import { ensureNativeBackend, nativeCacheScript, clearNativeBackendCache } from "../lib/native-agent.js";

let passed = 0;
/**
 * Runs one check now.
 * @param {string} name - the check name.
 * @param {() => void | Promise<void>} fn - the check body.
 */
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

check("the cache script derives the path from the digest and verifies it", () => {
  const digest = "a".repeat(64);
  const script = nativeCacheScript(digest);
  assert.match(script, new RegExp(`\\$HOME/\\.cache/dsh-wsl/agent/${digest}`));
  assert.match(script, /chmod 0755/);
  assert.match(script, /sha256sum/);
  assert.match(script, new RegExp(`\\[ "\\$got" = "${digest}" \\]`));
});

await check("the backend reads, hashes, checks the arch and copies once", async () => {
  clearNativeBackendCache();
  const binary = Buffer.from("native-binary");
  /** @type {Array<{ argv?: string[], script?: string, bytes?: Buffer }>} */
  const calls = [];
  const read = async () => binary;
  /** @param {string[]} argv - the host argv. */
  const run = async (argv) => {
    calls.push({ argv });
    return "x86_64\n";
  };
  /**
   * @param {string} script - the copy script.
   * @param {Buffer} bytes - the binary.
   */
  const copy = async (script, bytes) => {
    calls.push({ script, bytes });
    return "/home/u/.cache/dsh-wsl/agent/x/dsh-wsl-agent";
  };
  const path = await ensureNativeBackend({ wslPath: "wsl.exe", distro: "ubuntu", source: "C:\\native", readSource: read, run, copy });
  assert.equal(path, "/home/u/.cache/dsh-wsl/agent/x/dsh-wsl-agent");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.argv, ["wsl.exe", "-d", "ubuntu", "--exec", "uname", "-m"]);
  assert.equal(calls[1]?.bytes, binary);
  assert.match(calls[1]?.script ?? "", /sha256sum/);
  // A second call is served from the process cache: the fakes must not run.
  const again = await ensureNativeBackend({ wslPath: "wsl.exe", distro: "ubuntu", source: "C:\\native", readSource: read, run: () => { throw new Error("should not run"); }, copy: () => { throw new Error("should not copy"); } });
  assert.equal(again, path);
});

await check("an unsupported architecture is refused", async () => {
  clearNativeBackendCache();
  const path = await ensureNativeBackend({
    wslPath: "wsl.exe",
    distro: "debian",
    source: "C:\\native",
    readSource: async () => Buffer.from("x"),
    run: async () => "aarch64\n",
    copy: async () => { throw new Error("must not copy"); },
  });
  assert.equal(path, undefined);
});

await check("a failed copy falls back to undefined", async () => {
  clearNativeBackendCache();
  const path = await ensureNativeBackend({
    wslPath: "wsl.exe",
    distro: "alpine",
    source: "C:\\native",
    readSource: async () => Buffer.from("x"),
    run: async () => "x86_64\n",
    copy: async () => { throw new Error("copy failed"); },
  });
  assert.equal(path, undefined);
});

await check("an empty source disables the backend without any I/O", async () => {
  clearNativeBackendCache();
  assert.equal(await ensureNativeBackend({ wslPath: "wsl.exe", distro: "ubuntu", source: "" }), undefined);
});

console.log(`\n${passed} native-agent checks pass`);
