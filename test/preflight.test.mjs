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
import { Context } from "@deepseek-ai/cordis";
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
  // The real context serves a service this row does not inject only through
  // `get`; a property read throws. The real-cordis check below pins that.
  /** @param {string} name - the service name. */
  get: (name) => name === "agents" ? f.agents : undefined,
  on: f.on,
});


/**
 * A fake `wsl.exe` whose session-runtime probe prints one verdict word while
 * every other probe (the bwrap usability one included) succeeds.
 * @param {string} name - the fake's file name under the scratch dir.
 * @param {string} word - the probe answer: `ok`, `no-systemd`, ...
 * @returns {Promise<string>} the fake's path.
 */
const scriptedWsl = async (name, word) => {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\ncase "$*" in\n  *loginctl*) printf '%s' "${word}" ;;\n  *) exit 0 ;;\nesac\n`, { mode: 0o755 });
  return path;
};

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
  assert.match(warning, /operator action: ask the user before running a remedy/, "the remedy is operator action, not the model's");
  assert.doesNotMatch(warning, /observed at session open|re-check with wsl_doctor/u, "the blocked message has no stale-observation tail");
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
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true, startup: false });
  await f.fire({ agent: { id: "a3", session: { header: { cwd: HOST_UNC } } } }, 250);
  assert.deepEqual(f.warns, [], "a host session never warns about a distro sandbox");
  assert.deepEqual(f.debugs, [], "and it is not even probed");
});

await check("the load pass warns before any session opens", async () => {
  const wslPath = await fakeWsl("wsl-preload.exe", join(dir, "absent-load"));
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(f.warns.length, 1, "the load pass logs the verdict at mount, session or not");
  assert.match(f.warns[0] ?? "", /scripts\/bootstrap\.sh ubuntu --install/, "the load pass carries the same remedy");
});

await check("a session on the load-checked distro repeats only the entry, not the log line", async () => {
  const wslPath = await scriptedWsl("wsl-preloaddup.exe", "no-linger");
  const f = fakeCtx();
  /** @type {Array<{name: string, order: number, text: () => string}>} */
  const contexts = [];
  /** @type {(names: string[], install: (scope: { systemPrompt: { context: (entry: { name: string, order: number, text: () => string }) => unknown } }) => void) => void} */
  const injectPrompt = (_names, install) => install({ systemPrompt: { context: (entry) => contexts.push(entry) } });
  const agent = {
    id: "a17",
    session: { header: { cwd: DISTRO_UNC } },
    ctx: { inject: injectPrompt },
  };
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(f.warns.length, 1, "the load pass warned once");
  await f.fire({ agent }, 250);
  assert.equal(f.warns.length, 1, "the session announcement skips the duplicate log line");
  assert.equal(contexts.length, 1, "but the runtime-context entry still lands");
  assert.match(contexts[0]?.text() ?? "", /loginctl enable-linger/);
});

await check("startup: false keeps the checks to session open", async () => {
  const wslPath = await fakeWsl("wsl-preloadoff.exe", join(dir, "absent-loadoff"));
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true, startup: false });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(f.warns, [], "an opted-out load pass stays silent at mount");
  await f.fire({ agent: { id: "a18", session: { header: { cwd: DISTRO_UNC } } } });
  assert.equal(f.warns.length, 1, "the session-open check still runs");
});

await check("a load pass without WSL degrades to debug", async () => {
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "default", wslPath: join(dir, "no-such-wsl-load.exe"), sandbox: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(f.warns, [], "a missing WSL install is not the load pass's warning to give");
  assert.equal(f.debugs.length > 0, true, "it stays observable at debug level");
});

await check("distro: default resolves the load pass's distro through wsl.exe -l -q", async () => {
  const path = join(dir, "wsl-preloaddefault.exe");
  // `-l -q` prints WSL's default distro; every probe (bwrap included) succeeds.
  await writeFile(path, "#!/bin/sh\ncase \"$*\" in\n  *-l*\" -q\"*|*\"-l -q\"*) printf 'wsl-fake-default\\n' ;;\n  *) exit 0 ;;\nesac\n", { mode: 0o755 });
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "default", wslPath: path, sandbox: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(f.debugs.length > 0, true, "the ready verdict is observable at debug level");
  assert.match(f.debugs[f.debugs.length - 1] ?? "", /inside "wsl-fake-default"/, "the verdict names the distro the list probe answered");
});

await check("a load pass and a session opening during it log exactly one line, either order", async () => {
  // A slow probe keeps the load pass in flight while the session fires, so both
  // continuations read the same single-flight verdict.
  const path = join(dir, "wsl-preslow.exe");
  await writeFile(path, "#!/bin/sh\nsleep 0.6\nexit 1\n", { mode: 0o755 });
  const f = fakeCtx();
  /** @type {Array<{name: string, order: number, text: () => string}>} */
  const contexts = [];
  /** @type {(names: string[], install: (scope: { systemPrompt: { context: (entry: { name: string, order: number, text: () => string }) => unknown } }) => void) => void} */
  const injectPrompt = (_names, install) => install({ systemPrompt: { context: (entry) => contexts.push(entry) } });
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath: path, sandbox: true });
  // Fired while the load pass's probes are still sleeping.
  f.handlers["agent/created"]?.({ agent: { id: "a19", session: { header: { cwd: DISTRO_UNC } }, ctx: { inject: injectPrompt } } });
  // The slow fake makes the composed failure several probes long (each sleeps),
  // so poll instead of a fixed sleep.
  for (let waited = 0; f.warns.length === 0 && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(f.warns.length, 1, "the shared flight collapses the two announcements to one log line");
  assert.equal(contexts.length, 1, "the session entry still lands");
  assert.match(contexts[0]?.text() ?? "", /scripts\/bootstrap\.sh ubuntu --install/);
});

await check("successive sessions after the load pass stay at one log line, each with an entry", async () => {
  const wslPath = await scriptedWsl("wsl-premultisession.exe", "no-linger");
  const f = fakeCtx();
  /** @type {Array<{name: string, order: number, text: () => string}>} */
  const contexts = [];
  /** @type {(names: string[], install: (scope: { systemPrompt: { context: (entry: { name: string, order: number, text: () => string }) => unknown } }) => void) => void} */
  const injectPrompt = (_names, install) => install({ systemPrompt: { context: (entry) => contexts.push(entry) } });
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await new Promise((resolve) => setTimeout(resolve, 150));
  const second = { id: "a20", session: { header: { cwd: DISTRO_UNC } }, ctx: { inject: injectPrompt } };
  const third = { id: "a21", session: { header: { cwd: DISTRO_UNC } }, ctx: { inject: injectPrompt } };
  await f.fire({ agent: second }, 250);
  assert.equal(f.warns.length, 1, "the second session adds no log line");
  await f.fire({ agent: third }, 250);
  assert.equal(f.warns.length, 1, "the third session adds no log line either");
  assert.equal(contexts.length, 2, "each session still gets its own runtime-context entry");
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
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "default", wslPath: join(dir, "no-such-wsl.exe"), sandbox: true });
  await f.fire({ agent: { id: "a5", session: { header: { cwd: DISTRO_UNC } } } }, 250);
  assert.deepEqual(f.warns, [], "a missing WSL install is not the preflight's warning to give");
  assert.equal(f.debugs.length > 0, true, "it stays observable at debug level");
});

await check("auto preflights the workspace's distro", async () => {
  const wslPath = await fakeWsl("wsl-preauto.exe", join(dir, "absent-auto"));
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "", wslPath, sandbox: true });
  await f.fire({ agent: { id: "a9", session: { header: { cwd: DISTRO_UNC } } } });
  assert.equal(f.warns.length, 1, "the unusable bwrap is reported");
  assert.match(f.warns[0] ?? "", /scripts\/bootstrap\.sh ubuntu --install/, "the workspace's distro, not WSL's default, is named");
});

await check("a context without logger or agents survives, and a payload without an agent is silent", async () => {
  const wslPath = await fakeWsl("wsl-prebare.exe", join(dir, "absent-5"));
  const f = fakeCtx();
  const ctx = { on: f.on }; // no logger and no agents: both optional-context arms run
  await apply(/** @type {never} */ (ctx), { distro: "ubuntu", wslPath, sandbox: true });
  f.handlers["agent/created"]?.({ agent: undefined }); // an agent-less payload: the cwd scope exits early
  await new Promise((resolve) => setTimeout(resolve, 150));
});

await check("an omitted sandbox key defaults on, and the default wslPath fails to a plain remedy", async () => {
  // No `sandbox` key: the `?? true` default runs the preflight. No `wslPath`:
  // the `?? "wsl.exe"` default spawns a program that must not resolve — PATH
  // is stripped for the duration, so the shape is the same on every machine
  // (a real interop install would make the probe SUCCEED here and warn never
  // fires, which is correct behaviour and an untestable one).
  const f = fakeCtx();
  const savedPath = process.env.PATH;
  process.env.PATH = "/nonexistent-wsl-path";
  try {
    await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", sandbox: true });
    await f.fire({ agent: { id: "a6", session: { header: { cwd: DISTRO_UNC } } } });
  } finally {
    process.env.PATH = savedPath;
  }
  assert.equal(f.warns.length, 1, "the default-on preflight still warns");
  assert.match(f.warns[0] ?? "", /"bubblewrap" package with the distro's package manager/, "no family means no fabricated direct command");
});

await check("a warn-only logger still warns; a debug-only logger still debugs", async () => {
  const failing = await fakeWsl("wsl-prewarnonly.exe", join(dir, "absent-6"));
  const warnOnly = fakeCtx();
  await apply(
    /** @type {never} */ ({ on: warnOnly.on, logger: { warn: warnOnly.logger.warn } }),
    { distro: "ubuntu", wslPath: failing, sandbox: true },
  );
  await warnOnly.fire({ agent: { id: "a7", session: { header: { cwd: DISTRO_UNC } } } });
  assert.equal(warnOnly.warns.length, 1, "warn lands without a debug method beside it");

  const marker = join(dir, "present-2");
  const healthy = await fakeWsl("wsl-predebugonly.exe", marker);
  await writeFile(marker, "");
  const debugOnly = fakeCtx();
  await apply(
    /** @type {never} */ ({ on: debugOnly.on, logger: { debug: debugOnly.logger.debug } }),
    { distro: "ubuntu", wslPath: healthy, sandbox: true },
  );
  await debugOnly.fire({ agent: { id: "a8", session: { header: { cwd: DISTRO_UNC } } } });
  assert.equal(debugOnly.debugs.length > 0, true, "debug lands without a warn method beside it");
});


await check("a usable bwrap but no Linger warns with the session remedy", async () => {
  const wslPath = await scriptedWsl("wsl-prelinger.exe", "no-linger");
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await f.fire({ agent: { id: "a10", session: { header: { cwd: DISTRO_UNC } } } });
  assert.equal(f.warns.length, 1, "exactly one advisory");
  assert.match(f.warns[0] ?? "", /wsl-preflight: /, "the warning names its source");
  assert.match(f.warns[0] ?? "", /loginctl enable-linger/, "the remedy is the session one");
});

await check("a non-systemd distro warns with the wsl.conf remedy", async () => {
  const wslPath = await scriptedWsl("wsl-presystemd.exe", "no-systemd");
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await f.fire({ agent: { id: "a11", session: { header: { cwd: DISTRO_UNC } } } });
  assert.equal(f.warns.length, 1);
  assert.match(f.warns[0] ?? "", /\[boot\] systemd=true/, "the remedy names the wsl.conf change");
});

await check("a usable session runtime stays quiet", async () => {
  const wslPath = await scriptedWsl("wsl-prehealthy.exe", "ok");
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await f.fire({ agent: { id: "a12", session: { header: { cwd: DISTRO_UNC } } } });
  assert.deepEqual(f.warns, [], "a usable environment must not warn");
  assert.equal(f.debugs.length > 0, true, "the verdict is still observable at debug level");
});

await check("sessionSandbox: false leaves the session prerequisites alone", async () => {
  const wslPath = await scriptedWsl("wsl-prenosession.exe", "no-linger");
  const f = fakeCtx();
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true, sessionSandbox: false });
  await f.fire({ agent: { id: "a13", session: { header: { cwd: DISTRO_UNC } } } });
  assert.deepEqual(f.warns, [], "an opted-out session runtime is not preflighted");
});

await check("a healthy session keeps the ready line in the log, not the transcript", async () => {
  const wslPath = await scriptedWsl("wsl-preready.exe", "ok");
  const f = fakeCtx();
  /** @type {Array<{name: string, order: number, text: () => string}>} */
  const contexts = [];
  /** @type {(names: string[], install: (scope: { systemPrompt: { context: (entry: { name: string, order: number, text: () => string }) => unknown } }) => void) => void} */
  const injectPrompt = (_names, install) => install({ systemPrompt: { context: (entry) => contexts.push(entry) } });
  const agent = {
    id: "a15",
    session: { header: { cwd: DISTRO_UNC } },
    ctx: { inject: injectPrompt },
  };
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await f.fire({ agent });
  assert.deepEqual(f.warns, [], "ready is confirmation, never a complaint");
  assert.equal(contexts.length, 0, "a ready verdict is not an action, so it is log-only");
  assert.equal(f.debugs.length > 0, true, "the ready verdict stays observable at debug level");
});

await check("sessionSandbox: false keeps the scoped ready line log-only", async () => {
  const wslPath = await fakeWsl("wsl-preready2.exe", join(dir, "present-ready2"));
  await writeFile(join(dir, "present-ready2"), "");
  const f = fakeCtx();
  /** @type {Array<{name: string, order: number, text: () => string}>} */
  const contexts = [];
  /** @type {(names: string[], install: (scope: { systemPrompt: { context: (entry: { name: string, order: number, text: () => string }) => unknown } }) => void) => void} */
  const injectPrompt2 = (_names, install) => install({ systemPrompt: { context: (entry) => contexts.push(entry) } });
  const agent = {
    id: "a16",
    session: { header: { cwd: DISTRO_UNC } },
    ctx: { inject: injectPrompt2 },
  };
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true, sessionSandbox: false });
  await f.fire({ agent });
  assert.deepEqual(f.warns, []);
  assert.equal(contexts.length, 0, "the scoped ready line does not enter model context either");
});

await check("the advisory also lands in the session runtime context", async () => {
  const wslPath = await scriptedWsl("wsl-precontext.exe", "no-linger");
  const f = fakeCtx();
  /** @type {Array<{name: string, order: number, text: () => string}>} */
  const contexts = [];
  /** @type {(names: string[], install: (scope: { systemPrompt: { context: (entry: { name: string, order: number, text: () => string }) => unknown } }) => void) => void} */
  const injectPrompt = (_names, install) => install({ systemPrompt: { context: (entry) => contexts.push(entry) } });
  const agent = {
    id: "a14",
    session: { header: { cwd: DISTRO_UNC } },
    ctx: { inject: injectPrompt },
  };
  await apply(/** @type {never} */ (wireCtx(f)), { distro: "ubuntu", wslPath, sandbox: true });
  await f.fire({ agent });
  assert.equal(f.warns.length, 1, "the log line still lands");
  assert.equal(contexts.length, 1, "one runtime-context entry");
  assert.equal(contexts[0]?.name, "wsl-preflight");
  assert.match(contexts[0]?.text() ?? "", /loginctl enable-linger/, "the entry carries the remedy");
  assert.match(contexts[0]?.text() ?? "", /operator action: ask the user before running a remedy/);
  assert.doesNotMatch(contexts[0]?.text() ?? "", /observed at session open|re-check with wsl_doctor/u);
});

await check("the mount sweep reads agents without an inject violation", async () => {
  // A real cordis context is the only place the guard exists: the fake used by
  // the checks above just answers the property. Read the service as a property
  // and cordis 4 throws "cannot get property \"agents\" without inject"; the
  // try/catch around the sweep would then hide it and never probe a session.
  let listed = 0;
  const host = {
    name: "preflight-host",
    /** @param {Context} ctx - the host plugin's context. */
    apply(ctx) {
      ctx.provide("agents", {
        /** @returns {never[]} an empty live-agent list, recording the sweep. */
        list() {
          listed += 1;
          return [];
        },
      });
    },
  };
  const ctx = new Context();
  await ctx.plugin(host);
  await ctx.plugin({
    name: "wsl-preflight",
    /** @param {Context} pluginCtx - the row's context. */
    apply(pluginCtx) {
      return apply(/** @type {never} */ (pluginCtx), { wslPath: "/bin/true" });
    },
  });
  assert.equal(listed, 1, "the mount sweep reached the live-agent list");
});

await rm(dir, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
