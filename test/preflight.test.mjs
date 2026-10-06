/**
 * Assertion checks for the session-start sandbox preflight service.
 *
 * What matters: the warning carries the SAME composed remedy the refusals do
 * (the shared probe cache is where both read it), host workspaces stay silent,
 * a disabled service registers nothing, and a failing probe never fails the
 * session — advisory by construction.
 *
 * The checks run against `lib/preflight.js` with a fake `wsl.exe` (a POSIX
 * script, so the Windows legs skip) and a stand-in cordis context.
 *
 *   node test/preflight.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/preflight.js";
import { bwrapFailure } from "../lib/sandbox-core.js";

if (process.platform === "win32") {
  console.log("SKIP  preflight checks: the fake wsl.exe is a POSIX script");
  process.exit(0);
}

const dir = await mkdtemp(join(tmpdir(), "dsh-wsl-preflight-"));
const DISTRO_UNC = "\\\\wsl.localhost\\ubuntu\\home\\you\\proj";
const HOST_UNC = "C:\\Users\\you\\proj";

/**
 * A fake `wsl.exe`: the bwrap probe succeeds only once the named marker file
 * exists. The package-family probe is never scripted — a healthy or missing
 * verdict needs no family.
 * @param {string} name - the fake's file name under the scratch dir.
 * @param {string} marker - the marker file whose existence means "bwrap works".
 * @returns {Promise<string>} the fake's path.
 */
const fakeWsl = async (name, marker) => {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\n[ -f "${marker}" ] && exit 0 || exit 1\n`, { mode: 0o755 });
  return path;
};

/**
 * A stand-in cordis context: records logs, captures the agent/created listener,
 * answers the live-agent sweep.
 * @param {Array<{id: string, session?: {header?: {cwd?: string | undefined}}}>} live - the sweep's agents.
 * @returns {{ logger: { debug: (m: string) => void, warn: (m: string) => void }, agents: { list: () => unknown[] }, on: (event: string, listener: (payload: unknown) => void) => () => boolean, warns: string[], debugs: string[], handlers: Record<string, (payload: unknown) => void>, fire: (payload: unknown, settleMs?: number) => Promise<void>, ctx: Record<string, unknown> }}
 */
const fakeCtx = (live = []) => {
  /** @type {string[]} */
  const warns = [];
  /** @type {string[]} */
  const debugs = [];
  /** @type {Record<string, (payload: unknown) => void>} */
  const handlers = {};
  return {
    logger: {
      debug: (m) => debugs.push(m),
      warn: (m) => warns.push(m),
    },
    agents: { list: () => live },
    on: (event, listener) => {
      handlers[event] = listener;
      return () => true;
    },
    warns,
    debugs,
    handlers,
    /**
     * Fire one agent/created and wait for the advisory async check to settle:
     * polls until a log line lands, or a caller-named bound for the cases
     * whose right answer is silence.
     * @param {unknown} payload - the event payload.
     * @param {number} [settleMs] - wait at least this long when nothing logs.
     */
    async fire(payload, settleMs = 0) {
      handlers["agent/created"]?.(payload);
      for (let waited = 0; warns.length === 0 && debugs.length === 0 && waited < 2000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
    },
    ctx: /** @type {Record<string, unknown>} */ ({}),
  };
};

// The stand-in carries the real handlers/logger/agents by closure; the object
// handed to apply() is wired to them through the same property references.
/**
 * Wire one stand-in into the shape `apply` consumes.
 * @param {ReturnType<typeof fakeCtx>} f - the stand-in.
 * @returns {Record<string, unknown>} the apply-ready context.
 */
const wireCtx = (f) => ({
  logger: f.logger,
  agents: f.agents,
  on: f.on,
});

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

await check("a distro session with unusable bwrap warns with the shared remedy", async () => {
  const wslPath = await fakeWsl("wsl-prefail.exe", join(dir, "absent-1"));
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await f.fire({ agent: { id: "a1", session: { header: { cwd: DISTRO_UNC } } } });
  assert.equal(f.warns.length, 1, "exactly one advisory warning");
  const warning = f.warns[0] ?? "";
  assert.match(warning, /wsl-preflight: /, "the warning names its source");
  assert.match(warning, /scripts\/bootstrap\.sh ubuntu --install/, "the warning carries the remedy");
  assert.equal(bwrapFailure(wslPath, "ubuntu") !== undefined, true, "the shared cache holds the same failure");
});

await check("a healthy distro session logs quiet debug, never warn", async () => {
  const marker = join(dir, "present-1");
  const wslPath = await fakeWsl("wsl-preok.exe", marker);
  await writeFile(marker, "");
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await f.fire({ agent: { id: "a2", session: { header: { cwd: DISTRO_UNC } } } });
  assert.deepEqual(f.warns, [], "a healthy distro must not warn");
  assert.equal(f.debugs.length > 0, true, "the verdict is still observable at debug level");
});

await check("a host workspace is silent", async () => {
  const wslPath = await fakeWsl("wsl-prehost.exe", join(dir, "absent-2"));
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await f.fire({ agent: { id: "a3", session: { header: { cwd: HOST_UNC } } } }, 250);
  assert.deepEqual(f.warns, [], "a host session never warns about a distro sandbox");
  assert.deepEqual(f.debugs, [], "and it is not even probed");
});

await check("sandbox: false registers nothing at all", async () => {
  const wslPath = await fakeWsl("wsl-preoff.exe", join(dir, "absent-3"));
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: false });
  await f.fire({ agent: { id: "a4", session: { header: { cwd: DISTRO_UNC } } } }, 250);
  assert.deepEqual(f.warns, [], "an opted-out service must not warn");
  assert.equal("agent/created" in f.handlers, false, "the listener is never registered");
});

await check("an already-live agent is swept on mount", async () => {
  const wslPath = await fakeWsl("wsl-presweep.exe", join(dir, "absent-4"));
  const f = fakeCtx([{ id: "early", session: { header: { cwd: DISTRO_UNC } } }]);
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(f.warns.length, 1, "the sweep reaches sessions created before the mount");
});

await check("no default distro stays quiet at warn level", async () => {
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "", wslPath: join(dir, "no-such-wsl.exe"), sandbox: true });
  await f.fire({ agent: { id: "a5", session: { header: { cwd: DISTRO_UNC } } } }, 250);
  assert.deepEqual(f.warns, [], "a missing WSL install is not the preflight's warning to give");
  assert.equal(f.debugs.length > 0, true, "it stays observable at debug level");
});

await rm(dir, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
