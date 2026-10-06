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
import { bwrapFailure, bwrapUsable, createSandboxCore } from "../lib/sandbox-core.js";

if (process.platform === "win32") {
  console.log("SKIP  sandbox checks: the fake wsl.exe is a POSIX script");
  process.exit(0);
}

/** Mirrors the peer error's documented contract; see the core module's doc. */
class SandboxUnavailableError extends Error {
  /**
   * @param {string} mode - the mode that is unavailable.
   * @param {string} [detail] - the operator-facing reason.
   */
  constructor(mode, detail) {
    super(`sandbox mode "${mode}" is unavailable: ${detail}`);
    this.name = "SandboxUnavailableError";
    this.code = "SANDBOX_UNAVAILABLE";
  }
}

const WslSandbox = createSandboxCore({ SandboxUnavailableError });

const dir = await mkdtemp(join(tmpdir(), "dsh-wsl-sandbox-"));
const marker = join(dir, "usable");
/**
 * A fake `wsl.exe` that reports a working `bwrap` only once the marker exists.
 * @param {string} name - the fake's file name under the scratch dir.
 * @returns {Promise<string>} the fake's path.
 */
const fakeWsl = async (name) => {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n[ -f "${marker}" ] && exit 0 || exit 1\n`, { mode: 0o755 });
  return path;
};
/** @type {{mode: "workspace-write", workspaceRoot: string}} */
const policy = { mode: "workspace-write", workspaceRoot: "/tmp" };

let passed = 0;
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
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

const flipping = new WslSandbox({ wslPath: await fakeWsl("wsl-flipping.exe") });

await check("a failed probe fails closed", async () => {
  assert.equal(await flipping.usable("ubuntu"), false);
  await assert.rejects(
    () => flipping.confine(["sh", "-c", "true"], policy, { distro: "ubuntu" }),
    (error) => /** @type {{code?: string}} */ (error).code === "SANDBOX_UNAVAILABLE",
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

/**
 * A fake `wsl.exe` whose answers depend on what it was asked: the bwrap probe
 * gets a scripted failure, the package-family probe gets a scripted manager.
 * Mirrors the two calls `composeBwrapFailure` makes on a failed probe.
 * @param {string} name - the fake's file name under the scratch dir.
 * @param {string} probeOutput - what the bwrap probe prints before exiting 1.
 * @param {string} familyManager - the package manager the family probe reports, empty for none.
 * @returns {Promise<string>} the fake's path.
 */
const shapedFake = async (name, probeOutput, familyManager) => {
  const path = join(dir, name);
  await writeFile(
    path,
    `#!/bin/sh\ncase "$*" in\n  *command*) [ -n "${familyManager}" ] && echo "/usr/bin/${familyManager}"; exit 0 ;;\n  *) echo '${probeOutput}'; exit 1 ;;\nesac\n`,
    { mode: 0o755 },
  );
  return path;
};

await check("a missing bwrap names the detected family's install command", async () => {
  const wslPath = await shapedFake(
    "wsl-missing-dnf.exe",
    "wsl.exe failed: <3>WSL (1) ERROR: CreateProcessCommon: execv bwrap failed: No such file or directory",
    "dnf",
  );
  assert.equal(await bwrapUsable({ wslPath, distro: "fedora" }), false);
  const remedy = bwrapFailure(wslPath, "fedora") ?? "";
  assert.match(remedy, /scripts\/bootstrap\.sh fedora --install/, "the bootstrap path stays the first-choice remedy");
  assert.match(remedy, /dnf install -y bubblewrap/, "the direct command follows the distro's family");
  assert.doesNotMatch(remedy, /apt-get/, "an apt line on a dnf distro is the bug this fixes");
});

await check("an apt distro keeps the historical direct command byte-for-byte", async () => {
  const wslPath = await shapedFake(
    "wsl-missing-apt.exe",
    "wsl.exe failed: <3>WSL (1) ERROR: CreateProcessCommon: execv bwrap failed: No such file or directory",
    "apt-get",
  );
  await bwrapUsable({ wslPath, distro: "ubuntu" });
  assert.match(
    bwrapFailure(wslPath, "ubuntu") ?? "",
    /wsl\.exe -d ubuntu -u root -- apt-get install -y bubblewrap$/,
    "the apt remedy is unchanged",
  );
});

await check("a present-but-broken bwrap is not told to reinstall", async () => {
  const wslPath = await shapedFake("wsl-broken.exe", "wsl.exe failed: bwrap: setting up uid map: Operation not permitted", "");
  assert.equal(await bwrapUsable({ wslPath, distro: "arch" }), false);
  const remedy = bwrapFailure(wslPath, "arch") ?? "";
  assert.match(remedy, /bwrap is installed inside distro "arch" but failed the usability probe/, "the broken cause is named");
  assert.match(remedy, /Operation not permitted/, "the probe's own output is quoted");
  assert.match(remedy, /reinstalling will not help/, "the misleading remedy is explicitly retired");
  assert.doesNotMatch(remedy, /bootstrap\.sh/, "an install command for a present binary is wrong");
});

await check("an unclassified failure quotes the output beside the install remedy", async () => {
  const wslPath = await shapedFake("wsl-silent.exe", "", "");
  assert.equal(await bwrapUsable({ wslPath, distro: "suse" }), false);
  const remedy = bwrapFailure(wslPath, "suse") ?? "";
  assert.match(remedy, /scripts\/bootstrap\.sh suse --install/, "unclassified falls back to the install remedy");
  assert.match(remedy, /"bubblewrap" package with the distro's package manager/, "no family means no fabricated direct command");
});

await check("the other package families get their own direct commands", async () => {
  const pacmanWsl = await shapedFake("wsl-missing-pacman.exe", "wsl.exe failed: execv bwrap failed: No such file or directory", "pacman");
  await bwrapUsable({ wslPath: pacmanWsl, distro: "arch" });
  assert.match(bwrapFailure(pacmanWsl, "arch") ?? "", /pacman -S --noconfirm bubblewrap/, "pacman's spelling");
  const zypperWsl = await shapedFake("wsl-missing-zypper.exe", "wsl.exe failed: execv bwrap failed: No such file or directory", "zypper");
  await bwrapUsable({ wslPath: zypperWsl, distro: "sles" });
  assert.match(bwrapFailure(zypperWsl, "sles") ?? "", /zypper --non-interactive install bubblewrap/, "zypper's spelling");
});

await check("a remembered failure clears on the key's next success", async () => {
  const wslPath = await shapedFake("wsl-clearing.exe", "wsl.exe failed: execv bwrap failed: No such file or directory", "apt-get");
  const distro = "clears";
  assert.equal(await bwrapUsable({ wslPath, distro }), false);
  assert.notEqual(bwrapFailure(wslPath, distro), undefined, "the failure is readable right after the failed probe");
  const marker2 = join(dir, "clears-ok");
  await writeFile(join(dir, "wsl-clearing.exe"), `#!/bin/sh\n[ -f "${marker2}" ] && exit 0 || exit 1\n`, { mode: 0o755 });
  await writeFile(marker2, "");
  assert.equal(await bwrapUsable({ wslPath, distro }), true, "the fix is believed without a restart");
  assert.equal(bwrapFailure(wslPath, distro), undefined, "a stale remedy must not outlive its failure");
});

await rm(dir, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
