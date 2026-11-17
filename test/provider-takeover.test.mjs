/**
 * The two root-plane providers whose behaviour the unit suite never mounted:
 * `WslSubprocessRuntime` (terminal routing and the search/git rewrites) and
 * `WslDirectoryPicker` (its virtual levels and distro-side operations).
 *
 * `test/coverage-allowlist.json` names both as probe-only. This file closes
 * the CI gap where the platform allows it:
 *
 * - subprocess: the real class on a real cordis context, with the shipped
 *   spawn seam replaced by an instance-level stub, so argv/cwd/env and the
 *   refusal branches are asserted without starting a terminal;
 * - picker: the real class against a fake `wsl.exe` (a Node script) for the
 *   category/distro levels and the distro-side mkdir; real host-directory
 *   checks run on Windows only, where those paths are meaningful.
 *
 *   node test/provider-takeover.test.mjs
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { LocalSubprocessRuntime } from "@deepseek-ai/dsh-subprocess-local";
import { DirectoryPickerError } from "@deepseek-ai/dsh-host-directory-picker";
import { WslAgent } from "../lib/agent.js";
import { AgentUnavailableError } from "../lib/agent-errors.js";
import { WslDirectoryPicker } from "../lib/picker.js";
import { DISTRO_GIT_SENTINEL } from "../lib/git-route.js";
import { WslSubprocessRuntime } from "../lib/subprocess.js";

const scratch = mkdtempSync(join(tmpdir(), "dsh-takeover-"));
const hostCwd = join(scratch, "host");
mkdirSync(hostCwd);
/** The fake wsl.exe: a Node script, so the same fixture works wherever tests run. */
const fakeWsl = join(scratch, "wsl.exe");
writeFileSync(fakeWsl, `#!/usr/bin/env node
const args = process.argv.slice(2);
const write = (text) => process.stdout.write(text);
if (process.env.FAKE_WSL_LOG !== undefined) require("node:fs").appendFileSync(process.env.FAKE_WSL_LOG, args.join(" ") + "\\n");
if (args.includes("-l") && args.includes("-q")) { write(process.env.FAKE_DISTROS ?? "ubuntu\\n"); process.exit(0); }
if (args.includes("--exec") && args.includes("sh")) { write(process.env.FAKE_HOME ?? "/home/andy"); process.exit(0); }
if (args.includes("--exec") && args.includes("find")) { write(require("node:fs").readFileSync(process.env.FAKE_LISTING_FILE, "utf8")); process.exit(0); }
if (args.includes("--exec") && args.includes("mkdir")) {
  const target = args[args.length - 1];
  if (process.env.FAKE_MKDIR === "exists") { process.stderr.write("mkdir: cannot create directory '" + target + "': File exists\\n"); process.exit(1); }
  if (process.env.FAKE_MKDIR === "denied") { process.stderr.write("mkdir: cannot create directory '" + target + "': Permission denied\\n"); process.exit(1); }
  process.exit(0);
}
process.stderr.write("fake wsl.exe: unsupported " + args.join(" ") + "\\n");
process.exit(1);
`);
chmodSync(fakeWsl, 0o755);

/** The shipped spawn seam, replaced with a recorder for every check. */
const shipped = LocalSubprocessRuntime.prototype;
const original = {
  spawnTerminal: shipped.spawnTerminal,
  spawn: shipped.spawn,
  resolveExecutable: shipped.resolveExecutable,
};
const agentExec = WslAgent.prototype.exec;
/** @type {any} */
let captured;
// The override calls `super.spawn*`, so the shipped prototype is the seam.
// Not needed for terminal-only checks; every spawn falls through to here.
/** @type {any} */ (shipped).spawnTerminal = async (/** @type {any} */ spec) => {
  captured = spec;
  return /** @type {any} */ (fakeHandle());
};
/** @type {any} */ (shipped).spawn = (/** @type {any} */ spec) => {
  captured = spec;
  return /** @type {any} */ (fakeHandle());
};
// The resident is out for the whole file: the picker's one-shot fallback and
// the search/git fallbacks are what these checks exercise. Never start a real
// agent from a test.
WslAgent.prototype.exec = async () => { throw new AgentUnavailableError("agent out for tests"); };
const fakeHandle = () => ({
  id: "fake-terminal",
  done: Promise.resolve({ exitCode: 0, signal: null }),
  collected: {},
  kill: () => true,
  write: () => true,
});

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through runCheck.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/** POSIX-only: the fake wsl.exe is an executable Node script. */
/**
 * POSIX-only check; the fake wsl.exe is an executable Node script.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const checkPosix = (name, fn) => {
  if (process.platform === "win32") {
    console.log(`SKIP  ${name} (the fake wsl.exe is a POSIX executable)`);
    return;
  }
  check(name, fn);
};
/** Windows-only: the picker's host paths and UNC resolution are Windows semantics. */
/**
 * Windows-only check; the picker's host paths are Windows semantics.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const checkWindows = (name, fn) => {
  if (process.platform !== "win32") {
    console.log(`SKIP  ${name} (Windows path semantics)`);
    return;
  }
  check(name, fn);
};
/** @type {Context[]} */
const mounted = [];
/**
 * Runs one check now, disposing the contexts it mounted.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  } finally {
    while (mounted.length > 0) await /** @type {Context} */ (mounted.pop()).fiber.dispose();
  }
};

/**
 * Mount the subprocess provider on a fresh context.
 * @param {Record<string, unknown>} [config] - row config overrides.
 * @returns {Promise<{ctx: Context, row: WslSubprocessRuntime}>} the mount.
 */
async function mountSubprocess(config = {}) {
  const ctx = new Context();
  const fiber = ctx.plugin(WslSubprocessRuntime, {
    wslPath: fakeWsl,
    hostCwd,
    ...config,
  });
  await fiber.await();
  mounted.push(ctx);
  return { ctx, row: /** @type {WslSubprocessRuntime} */ (ctx.get("subprocess")) };
}

/**
 * Mount the directory picker on a fresh context.
 * @param {Record<string, unknown>} [config] - row config overrides.
 * @returns {Promise<{ctx: Context, row: WslDirectoryPicker}>} the mount.
 */
async function mountPicker(config = {}) {
  const ctx = new Context();
  const fiber = ctx.plugin(WslDirectoryPicker, {
    wslPath: fakeWsl,
    includeHostHome: true,
    maxEntries: 2,
    ...config,
  });
  await fiber.await();
  mounted.push(ctx);
  return { ctx, row: /** @type {WslDirectoryPicker} */ (ctx.get("directoryPicker")) };
}

// ── subprocess: terminal routing ─────────────────────────────────────────────

check("a UNC workspace terminal launches in its distro at the Linux directory", async () => {
  const { ctx, row } = await mountSubprocess();
  captured = undefined;
  const handle = await row.spawnTerminal(/** @type {any} */ ({
    argv: ["wsl.exe", "-l"],
    cwd: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    env: { TERM: "xterm", PATH: "C:\\Windows", DSH_WSL_X: "1", OTHER: "n" },
  }));
  assert.ok(captured, "the shipped terminal seam was reached");
  assert.deepEqual(captured.argv, [fakeWsl, "-d", "ubuntu", "--cd", "/home/andy/proj"]);
  assert.equal(captured.cwd, hostCwd, "the host process starts in a Windows directory");
  assert.equal(captured.env.TERM, "xterm");
  assert.match(String(captured.env.WSLENV), /TERM/);
  assert.match(String(captured.env.WSLENV), /DSH_WSL_X/);
  assert.doesNotMatch(String(captured.env.WSLENV), /PATH/);
  assert.doesNotMatch(String(captured.env.WSLENV), /OTHER/);
  assert.equal(/** @type {any} */ (handle).id, "fake-terminal");
  await ctx.fiber.dispose();
});

check("a pinned distro refuses a workspace in another distro", async () => {
  const { row } = await mountSubprocess({ distro: "debian" });
  await assert.rejects(
    () => row.spawnTerminal(/** @type {any} */ ({ argv: ["wsl.exe"], cwd: "\\\\wsl.localhost\\ubuntu\\home\\andy", env: {} })),
    /names a workspace in another WSL distro/,
  );
});

checkPosix("a forced default distro accepts its own workspace and refuses another", async () => {
  const { row } = await mountSubprocess({ distro: "default" });
  process.env.FAKE_DISTROS = "ubuntu\n";
  const target = await row.terminalTarget("\\\\wsl.localhost\\ubuntu\\home\\andy");
  assert.deepEqual(target, { distro: "ubuntu", linuxCwd: "/home/andy" });
  await assert.rejects(
    () => row.terminalTarget("\\\\wsl.localhost\\debian\\home\\andy"),
    /forces WSL's default \("ubuntu"\)/,
  );
});

check("a Windows-folder session gets the host shell when hostSessions is on", async () => {
  const { row } = await mountSubprocess({ hostSessions: true });
  captured = undefined;
  await row.spawnTerminal(/** @type {any} */ ({ argv: ["wsl.exe"], cwd: "C:\\Users\\andy\\proj", env: { TERM: "xterm" } }));
  assert.deepEqual(captured.argv, ["powershell.exe", "-NoLogo"]);
  assert.equal(captured.cwd, "C:\\Users\\andy\\proj");
});

checkPosix("the same request maps to /mnt when hostSessions is off", async () => {
  const { row } = await mountSubprocess({ hostSessions: false, distro: "" });
  captured = undefined;
  await row.spawnTerminal(/** @type {any} */ ({ argv: ["wsl.exe"], cwd: "C:\\Users\\andy\\proj", env: {} }));
  assert.ok(captured.argv.includes("--cd"));
  const index = captured.argv.indexOf("--cd");
  assert.equal(captured.argv[index + 1], "/mnt/c/Users/andy/proj");
});

check("a non-wsl program reaches the shipped terminal seam untouched", async () => {
  const { row } = await mountSubprocess();
  captured = undefined;
  const spec = { argv: ["cmd.exe", "/c", "dir"], cwd: "/tmp", env: { OTHER: "n" } };
  await row.spawnTerminal(/** @type {any} */ (spec));
  assert.equal(captured, spec, "the request is passed through by reference");
});

check("idle reclaim marks the terminal and replaces its activity probe", async () => {
  const { row } = await mountSubprocess({ terminalIdleReclaim: true });
  captured = undefined;
  const handle = /** @type {any} */ (await row.spawnTerminal(/** @type {any} */ ({ argv: ["wsl.exe"], cwd: "\\\\wsl.localhost\\ubuntu\\home\\andy", env: {} })));
  assert.ok(captured.env.DSH_TERMINAL_ID, "the launch carries the marker");
  assert.equal(typeof handle.inspectActivity, "function", "the wrapped handle exposes the distro probe");
  assert.notEqual(handle.inspectActivity, /** @type {any} */ (fakeHandle()).inspectActivity);
});

// ── subprocess: spawn routing and executable fallback ────────────────────────

check("a non-routed spawn passes through to the shipped implementation", async () => {
  const { row } = await mountSubprocess();
  captured = undefined;
  const spec = { argv: ["node", "-v"], cwd: "/tmp", env: {}, stdio: { stdout: { maxBytes: 10 }, stderr: { maxBytes: 10 } } };
  row.spawn(/** @type {any} */ (spec));
  assert.equal(captured, spec, "no rewrite, no copy");
});

check("a distro search spawn falls back to the one-shot wsl relay with rg's argv", async () => {
  const { row } = await mountSubprocess();
  captured = undefined;
  const handle = row.spawn(/** @type {any} */ ({
    argv: ["C:\\tools\\rg.exe", "--regexp=needle"],
    cwd: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    env: {},
    stdio: { stdout: { maxBytes: 1024 }, stderr: { maxBytes: 512 } },
  }));
  await handle.done;
  assert.ok(captured, "the fallback one-shot was built");
  assert.deepEqual(captured.argv, [fakeWsl, "-d", "ubuntu", "--cd", "/home/andy/proj", "--exec", "rg", "--regexp=needle", "--", "."]);
  assert.equal(captured.cwd, hostCwd);
  assert.equal(captured.env.WSL_UTF8, "1");
});

check("a distro git spawn falls back to the one-shot relay with WSL_UTF8 and GIT_* forwarded", async () => {
  const { row } = await mountSubprocess();
  captured = undefined;
  const handle = row.spawn(/** @type {any} */ ({
    argv: ["git", "cat-file", "--batch"],
    cwd: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    env: { GIT_DIR: "C:\\scratch\\gitdir" },
    stdio: { stdin: { data: "abc" }, stdout: { maxBytes: 10 }, stderr: { maxBytes: 10 } },
  }));
  await handle.done;
  assert.ok(captured, "the git fallback was built");
  assert.equal(captured.argv[0], fakeWsl);
  assert.ok(captured.argv.includes("git"), "the relay runs git");
  assert.ok(captured.argv.includes("cat-file"));
  assert.equal(captured.env.WSL_UTF8, "1");
  assert.match(String(captured.env.WSLENV), /GIT_DIR/);
});

check("a missing host git resolves to the distro sentinel; every other name rethrows", async () => {
  const { row } = await mountSubprocess();
  shipped.resolveExecutable = async (/** @type {string} */ command) => {
    throw Object.assign(new Error(`spawn ${command} ENOENT`), { code: "ENOENT" });
  };
  assert.equal(await row.resolveExecutable("git", {}, undefined), DISTRO_GIT_SENTINEL);
  assert.equal(await row.resolveExecutable("C:\\Program Files\\Git\\cmd\\git.exe", {}, undefined), DISTRO_GIT_SENTINEL);
  await assert.rejects(() => row.resolveExecutable("pwsh.exe", {}, undefined), /spawn pwsh\.exe ENOENT/);
});

// ── picker: virtual levels and distro-side operations ────────────────────────

checkPosix("the category level offers the host and WSL branches and the preferred home", async () => {
  process.env.FAKE_DISTROS = "ubuntu\ndebian\n";
  const { row } = await mountPicker({ preferredDistro: "debian" });
  const listing = await row.list();
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["Windows paths", "WSL distros"]);
  assert.equal(listing.home, "\\\\wsl.localhost\\debian\\home\\andy");
  assert.deepEqual(listing.crumbs.map((crumb) => crumb.name), ["Workspace"]);
});

checkPosix("the WSL branch lists each distro and leads with the preferred one", async () => {
  process.env.FAKE_DISTROS = "ubuntu\ndebian\n";
  const { row } = await mountPicker({ preferredDistro: "debian" });
  const listing = await row.list("\\\\wsl.localhost");
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["ubuntu", "debian"]);
  assert.equal(listing.entries[1]?.path, "\\\\wsl.localhost\\debian");
  assert.equal(listing.path, "\\\\wsl.localhost\\debian");
  assert.deepEqual(listing.crumbs.map((crumb) => crumb.name), ["Workspace", "WSL distros"]);
});

checkPosix("a distro level is listed through the one-shot find and capped", async () => {
  process.env.FAKE_DISTROS = "ubuntu\n";
  const listingFile = join(scratch, "find.out");
writeFileSync(listingFile, "/home/andy/proj/a\0/home/andy/proj/b\0/home/andy/proj/c\0");
process.env.FAKE_LISTING_FILE = listingFile;
  const { row } = await mountPicker({ preferredDistro: "ubuntu" });
  const listing = await row.listDistroLevel("\\\\wsl.localhost\\ubuntu\\home\\andy\\proj");
  assert.deepEqual(listing.rows.map((entry) => entry.name), ["a", "b"]);
  assert.equal(listing.truncated, true);
  assert.equal(listing.rows[0]?.path, "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\a");
});

checkPosix("the resident agent's answer is used when it is up", async () => {
  process.env.FAKE_DISTROS = "ubuntu\n";
  const { row } = await mountPicker({ preferredDistro: "ubuntu" });
  const up = WslAgent.prototype.exec;
  WslAgent.prototype.exec = async () => ({ exitCode: 0, stdout: Buffer.from("/home/andy/proj/x\0/home/andy/proj/y\0"), stderr: Buffer.alloc(0), truncated: { stdout: false, stderr: false } });
  try {
    const listing = await row.listDistroLevel("\\\\wsl.localhost\\ubuntu\\home\\andy\\proj");
    assert.deepEqual(listing.rows.map((entry) => entry.name), ["x", "y"]);
  } finally {
    WslAgent.prototype.exec = up;
  }

  WslAgent.prototype.exec = async () => ({ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("ls: cannot open directory"), truncated: { stdout: false, stderr: false } });
  try {
    await assert.rejects(
      () => row.listDistroLevel("\\\\wsl.localhost\\ubuntu\\home\\andy\\proj"),
      (error) => error instanceof DirectoryPickerError && error.code === "directory-unreadable" && /ls: cannot open directory/.test(error.message),
    );
  } finally {
    WslAgent.prototype.exec = up;
  }
});

checkPosix("creating a directory through an up agent and its mkdir refusals", async () => {
  process.env.FAKE_DISTROS = "ubuntu\n";
  const { row } = await mountPicker({ preferredDistro: "ubuntu" });
  const up = WslAgent.prototype.exec;
  WslAgent.prototype.exec = async () => ({ exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), truncated: { stdout: false, stderr: false } });
  try {
    assert.equal(
      await row.createDistroDirectory("\\\\wsl.localhost\\ubuntu\\home\\andy", "new", "\\\\wsl.localhost\\ubuntu\\home\\andy\\new"),
      "\\\\wsl.localhost\\ubuntu\\home\\andy\\new",
    );
  } finally {
    WslAgent.prototype.exec = up;
  }

  WslAgent.prototype.exec = async () => ({ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("mkdir: cannot create: File exists"), truncated: { stdout: false, stderr: false } });
  try {
    await assert.rejects(
      () => row.createDistroDirectory("\\\\wsl.localhost\\ubuntu\\home\\andy", "new", "\\\\wsl.localhost\\ubuntu\\home\\andy\\new"),
      (error) => error instanceof DirectoryPickerError && error.code === "directory-exists",
    );
  } finally {
    WslAgent.prototype.exec = up;
  }
});

checkPosix("creating a directory in the distro goes through the one-shot mkdir", async () => {
  process.env.FAKE_DISTROS = "ubuntu\n";
  delete process.env.FAKE_MKDIR;
  const { row } = await mountPicker({ preferredDistro: "ubuntu" });
  const created = await row.createDistroDirectory("\\\\wsl.localhost\\ubuntu\\home\\andy", "new", "\\\\wsl.localhost\\ubuntu\\home\\andy\\new");
  assert.equal(created, "\\\\wsl.localhost\\ubuntu\\home\\andy\\new");

  process.env.FAKE_MKDIR = "exists";
  await assert.rejects(
    () => row.createDistroDirectory("\\\\wsl.localhost\\ubuntu\\home\\andy", "new", "\\\\wsl.localhost\\ubuntu\\home\\andy\\new"),
    (error) => error instanceof DirectoryPickerError && error.code === "directory-exists",
  );
  process.env.FAKE_MKDIR = "denied";
  await assert.rejects(
    () => row.createDistroDirectory("\\\\wsl.localhost\\ubuntu\\home\\andy", "new", "\\\\wsl.localhost\\ubuntu\\home\\andy\\new"),
    (error) => error instanceof DirectoryPickerError && error.code === "directory-create-failed",
  );
});

check("a broken wsl.exe does not stop a host listing", async () => {
  // The preferred distro is only the dialog's Home affordance. A machine whose
  // WSL cannot answer must still browse Windows directories; the failure the
  // caller sees is the host walk's, not a spawn error from the distro lookup.
  const { row } = await mountPicker({ wslPath: "/nonexistent/wsl.exe" });
  await assert.rejects(
    () => row.list("C:\\no-such-host-dir\\missing"),
    (error) => error instanceof DirectoryPickerError
      && error.code === "directory-unreadable"
      && !/wsl\.exe.*(failed|ENOENT)/i.test(error.message),
  );
});

check("an unqualified path is refused with the picker's own code", async () => {
  const { row } = await mountPicker();
  await assert.rejects(
    () => row.list("relative/place"),
    (error) => error instanceof DirectoryPickerError && error.code === "directory-unreadable",
  );
  await assert.rejects(
    () => row.createDirectory("/tmp/whatever", "x"),
    (error) => error instanceof DirectoryPickerError && error.code === "directory-create-failed",
  );
});

checkPosix("the distro list is cached until its TTL expires", async () => {
  const log = join(scratch, "wsl.log");
  writeFileSync(log, "");
  process.env.FAKE_DISTROS = "ubuntu\n";
  process.env.FAKE_WSL_LOG = log;
  const { row } = await mountPicker({ distroCacheMs: 60_000 });
  await row.distros();
  await row.distros();
  assert.equal(readFileSync(log, "utf8").trim().split("\n").filter((line) => line === "-l -q").length, 1, "the second read is served from the cache");

  const fresh = await mountPicker({ distroCacheMs: 1 });
  writeFileSync(log, "");
  await fresh.row.distros();
  await new Promise((resolvePromise) => { setTimeout(resolvePromise, 5); });
  await fresh.row.distros();
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2, "a tiny TTL refreshes");
});

// ── picker: host filesystem (Windows semantics) ─────────────────────────────

checkWindows("a host directory lists directories, hidden rows and symlinked dirs, capped", async () => {
  const { row } = await mountPicker({ maxEntries: 2 });
  mkdirSync(join(scratch, "levels", "one"), { recursive: true });
  mkdirSync(join(scratch, "levels", "two"));
  mkdirSync(join(scratch, "levels", "three"));
  mkdirSync(join(scratch, "levels", ".hidden"));
  writeFileSync(join(scratch, "levels", "file.txt"), "x");
  const listing = await row.list(join(scratch, "levels"));
  assert.equal(listing.entries.every((entry) => entry.name !== "file.txt"), true, "files are not directory rows");
  assert.equal(listing.entries.length, 2);
  assert.equal(listing.truncated, true);
  assert.equal(listing.entries.some((entry) => entry.name === ".hidden" && entry.hidden), true, "hidden directories are offered");
});

checkWindows("creating a host directory maps EEXIST and validates the segment", async () => {
  const { row } = await mountPicker();
  const parent = join(scratch, "host-create");
  mkdirSync(parent, { recursive: true });
  const created = await row.createDirectory(parent, "child");
  assert.equal(created, join(parent, "child"));
  await assert.rejects(
    () => row.createDirectory(parent, "child"),
    (error) => error instanceof DirectoryPickerError && error.code === "directory-exists",
  );
  await assert.rejects(
    () => row.createDirectory(parent, "a/b"),
    (error) => error instanceof DirectoryPickerError && error.code === "directory-create-failed",
  );
});

// ── run ──────────────────────────────────────────────────────────────────────

try {
  for (const [name, fn] of checks) await runCheck(name, fn);
} finally {
  shipped.spawnTerminal = original.spawnTerminal;
  shipped.spawn = original.spawn;
  shipped.resolveExecutable = original.resolveExecutable;
  WslAgent.prototype.exec = agentExec;
  rmSync(scratch, { recursive: true, force: true });
}
const failed = checks.length - passed;
console.log(`\n${passed}/${checks.length} provider-takeover checks pass`);
if (failed > 0) process.exitCode = 1;
