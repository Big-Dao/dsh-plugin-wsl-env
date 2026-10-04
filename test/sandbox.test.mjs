/**
 * Assertion checks for the sandbox provider's probe and its caching policy.
 *
 * The behaviour that matters here is a recovery path: a failed probe must not be
 * remembered, or installing `bubblewrap` while the app runs changes nothing until
 * the next restart — while the error tells the user to install it.
 *
 * The checks run against the peer-free core (`lib/sandbox-core.js`) with a
 * stand-in for the peer's `SandboxUnavailableError` whose contract is the one
 * consumers match — `code: "SANDBOX_UNAVAILABLE"` — so what CI exercises here
 * is the code that ships, not a copy of it. The shipped binding to the peer's
 * own class is one line in `lib/sandbox.js`, left to `npm run probe:sandbox`
 * against a real distro. The Windows legs skip: the fake `wsl.exe` is a POSIX
 * shell script, and Windows cannot execute one.
 *
 *   node test/sandbox.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxCore } from "../lib/sandbox-core.js";

if (process.platform === "win32") {
  console.log("SKIP  sandbox checks: the fake wsl.exe is a POSIX script");
  process.exit(0);
}

/** Mirrors the peer error's documented contract; see the core module's doc. */
class SandboxUnavailableError extends Error {
  constructor(mode, detail) {
    super(`sandbox mode "${mode}" is unavailable: ${detail}`);
    this.name = "SandboxUnavailableError";
    this.code = "SANDBOX_UNAVAILABLE";
  }
}

const WslSandbox = createSandboxCore({ SandboxUnavailableError });

const dir = await mkdtemp(join(tmpdir(), "dsh-wsl-sandbox-"));
const marker = join(dir, "usable");
/** A fake `wsl.exe` that reports a working `bwrap` only once the marker exists. */
const fakeWsl = async (name) => {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n[ -f "${marker}" ] && exit 0 || exit 1\n`, { mode: 0o755 });
  return path;
};
const policy = { mode: "workspace-write", workspaceRoot: "/tmp" };

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

const flipping = new WslSandbox({ wslPath: await fakeWsl("wsl-flipping.exe") });

await check("a failed probe fails closed", async () => {
  assert.equal(await flipping.usable("ubuntu"), false);
  await assert.rejects(
    () => flipping.confine(["sh", "-c", "true"], policy, { distro: "ubuntu" }),
    (error) => error?.code === "SANDBOX_UNAVAILABLE",
    "an unusable backend must refuse to run unconfined",
  );
});

await check("a failure is not cached: the remedy works without a restart", async () => {
  await writeFile(marker, "");
  assert.equal(await flipping.usable("ubuntu"), true, "installing bubblewrap must be believed");
});

await check("a success is cached for the process lifetime", async () => {
  await rm(marker, { force: true });
  assert.equal(await flipping.usable("ubuntu"), true, "a positive verdict is stable");
});

await check("a usable backend wraps the distro argv", async () => {
  const confined = await flipping.confine(["sh", "-c", "true"], policy, { distro: "ubuntu" });
  assert.equal(confined.argv[0], "bwrap");
  assert.ok(confined.argv.includes("--ro-bind"), "reads the whole distro read-only");
  assert.ok(confined.argv.includes("--bind"), "grants the workspace under workspace-write");
  assert.equal(confined.enforcement, "partial");
  assert.deepEqual(confined.denialSignatures, ["read-only file system"]);
});

await check("read-only mode grants no workspace bind", async () => {
  const confined = await flipping.confine(["sh", "-c", "true"], { ...policy, mode: "read-only" }, { distro: "ubuntu" });
  assert.ok(!confined.argv.includes("--bind"), "read-only must not bind a writable root");
  assert.ok(!confined.argv.includes("--tmpfs"), "read-only must not mount a writable /tmp");
});

await rm(dir, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
