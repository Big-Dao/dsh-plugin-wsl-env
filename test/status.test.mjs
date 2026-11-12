// status.test.mjs — the sidebar panel's diagnostic route.
//
// The route is the panel's only Host data channel: a list answer, a
// per-distro quick-doctor answer, and the repair action (a full
// `--fix-owned` doctor run). These checks pin the wire shape the client
// consumes, the cache/refresh policy (a check boots a stopped distro, so it
// must run only when asked), the failure posture, and the registration that
// makes the route reachable at all.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";

import { apply, createStatusHandler, STATUS_PATH } from "../lib/status.js";

/** A scratch directory so no test touches the real status store. */
const scratch = mkdtempSync(join(tmpdir(), "dsh-status-"));
let storeCounter = 0;

let passed = 0;
/**
 * Run one named check.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the assertions.
 */
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.log(`not ok - ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

/** The installed distros the fake seam reports. */
const DISTROS = ["Ubuntu", "Debian"];

/** A ready report as the doctor CLI prints it, with one advisory warning. */
const READY = {
  verdict: "ready",
  scope: { sections: ["host", "session", "sandbox"], quick: true },
  checks: [
    { id: "host.wsl-version", status: "ok", detail: "2.6.1" },
    { id: "session.user-manager", status: "warn", detail: "unreachable", remedy: "log in once" },
  ],
  summary: { warn: 1, skipped: 0 },
};

/** A blocked report with one failing check and its remedy. */
const BLOCKED = {
  verdict: "blocked",
  blockers: ["sandbox.bwrap"],
  checks: [
    { id: "host.wsl-version", status: "ok" },
    { id: "sandbox.bwrap", status: "fail", detail: "bwrap missing", remedy: "sudo apt install bubblewrap" },
    { id: "session.ligner", status: "warn", detail: "unset" },
  ],
  summary: { warn: 2, skipped: 1 },
};

/** A repair report: the fix rows plus the re-verified checks. */
const REPAIRED = {
  verdict: "ready",
  blockers: [],
  checks: [
    { id: "host.wsl-version", status: "ok" },
    { id: "runtime.scopes", status: "ok", detail: "none (the fix above swept them)" },
    { id: "agent.cache", status: "ok", detail: "1 cached binary(ies)" },
    { id: "fix.scopes", status: "ok", title: "Swept stale scopes", detail: "1 stale before → 0 after" },
    { id: "fix.cache", status: "ok", title: "Purged the agent cache", detail: "1 cached, 1 invalid before → 0 cached, 0 invalid after" },
  ],
  summary: { warn: 0, skipped: 0 },
};

/** A quick report whose only finding is a stale session scope. */
const SCOPE_WARN = {
  verdict: "ready",
  checks: [
    { id: "host.wsl-version", status: "ok" },
    { id: "runtime.scopes", status: "warn", detail: "1 stale of 2", remedy: "--fix stops them" },
  ],
  summary: { warn: 1, skipped: 0 },
};

/** A full report whose failed handshake is explained by a broken cache. */
const CACHE_BROKEN = {
  verdict: "blocked",
  blockers: ["agent.handshake"],
  checks: [
    { id: "agent.cache", status: "warn", detail: "1 cached, 1 not executable", remedy: "rm -rf ~/.cache/dsh-wsl/agent" },
    { id: "agent.handshake", status: "fail", detail: "the resident exited before its HELLO", remedy: "restart the app" },
  ],
  summary: { warn: 1, fail: 1, skipped: 0 },
};

/**
 * Build one handler over a fresh fake clock and runner.
 * @param {Record<string, unknown>} [overrides] - handler options to override.
 * @returns {{handler: import("../lib/status.js").StatusHandler, calls: string[][], advance: (ms: number) => void}}
 */
const handlerFor = (overrides = {}) => {
  /** @type {string[][]} */
  const calls = [];
  let now = 1000;
  const handler = createStatusHandler({
    cacheMs: 15_000,
    timeoutMs: 60_000,
    distros: async () => DISTROS,
    runCli: async (argv) => {
      calls.push(argv);
      return JSON.stringify(READY);
    },
    now: () => now,
    statePath: join(scratch, `status-${storeCounter += 1}.json`),
    ...overrides,
  });
  return {
    handler,
    calls,
    advance: (ms) => { now += ms; },
  };
};

/**
 * Send one request and decode the JSON body.
 * @param {import("../lib/status.js").StatusHandler} handler - the route handler.
 * @param {string} [query] - the query string, including `?`.
 * @param {string} [method] - the HTTP method.
 * @returns {Promise<{status: number, body: any}>} the status and decoded body.
 */
const send = async (handler, query = "", method = "GET") => {
  const response = await handler(new Request(`http://host${STATUS_PATH}${query}`, { method }));
  return { status: response.status, body: await response.json() };
};

/**
 * Fetch one path and decode the JSON body.
 * @param {import("../lib/status.js").StatusHandler} handler - the route handler.
 * @param {string} [query] - the query string, including `?`.
 * @returns {Promise<{status: number, body: any}>} the status and decoded body.
 */
const get = (handler, query = "") => send(handler, query);

await check("a list request answers the installed distros without running anything", async () => {
  const { handler, calls } = handlerFor();
  const { status, body } = await get(handler);
  assert.equal(status, 200);
  assert.deepEqual(body, { distros: DISTROS, running: [], cached: [] });
  assert.equal(calls.length, 0);
});

await check("a quick check runs the scoped doctor and answers the digested verdict", async () => {
  const { handler, calls } = handlerFor();
  const { status, body } = await get(handler, "?distro=Ubuntu");
  assert.equal(status, 200);
  assert.equal(body.distro, "Ubuntu");
  assert.equal(body.verdict, "ready");
  assert.equal(body.cached, false);
  assert.equal(body.source, "user");
  assert.deepEqual(body.failures, []);
  assert.deepEqual(body.warnings, [
    { id: "session.user-manager", detail: "unreachable", remedy: "log in once" },
  ]);
  // The in-process `session.preset-seam` row is the extra `info` (unknown here).
  assert.deepEqual(body.counts, { ok: 1, warn: 1, fail: 0, info: 1, skipped: 0, unknown: 0 });
  assert.deepEqual(body.sections, [
    { section: "host", ok: 1, warn: 0, fail: 0, unknown: 0 },
    { section: "session", ok: 0, warn: 1, fail: 0, unknown: 0 },
  ]);
  const detail = /** @type {import("../lib/status.js").StatusCheck[]} */ (body.checks);
  assert.deepEqual(detail.map((entry) => [entry.id, entry.status, entry.section]), [
    ["host.wsl-version", "ok", "host"],
    ["session.user-manager", "warn", "session"],
    ["session.preset-seam", "info", "session"],
  ], "the expandable detail carries every executed check, not just the findings");
  assert.ok(body.notRun > 0, "the catalog rows this quick run never executed are counted, not listed as fake results");
  assert.deepEqual(calls[0], ["--json", "--quick", "--distro", "Ubuntu"]);
});

await check("the structure counts every status the run answered and skips the catalog rows", async () => {
  const { handler } = handlerFor({ runCli: async () => JSON.stringify(BLOCKED) });
  const { body } = await get(handler, "?distro=Debian");
  // The extra `info` row is the in-process `session.preset-seam` check: the
  // test process never mounts auto-preset, so the seam state is `unknown`.
  assert.deepEqual(body.counts, { ok: 1, warn: 1, fail: 1, info: 1, skipped: 0, unknown: 0 });
});

await check("a blocked report carries the failures and their remedies", async () => {
  const { handler } = handlerFor({ runCli: async () => JSON.stringify(BLOCKED) });
  const { body } = await get(handler, "?distro=Debian");
  assert.equal(body.verdict, "blocked");
  assert.deepEqual(body.blockers, ["sandbox.bwrap"]);
  assert.deepEqual(body.failures, [
    { id: "sandbox.bwrap", detail: "bwrap missing", remedy: "sudo apt install bubblewrap" },
  ]);
  assert.deepEqual(body.warnings, [{ id: "session.ligner", detail: "unset" }]);
});

await check("a stale scope is advertised as repairable", async () => {
  const { handler } = handlerFor({ runCli: async () => JSON.stringify(SCOPE_WARN) });
  const { body } = await get(handler, "?distro=Ubuntu");
  assert.deepEqual(body.repairable, ["runtime.scopes"]);
});

await check("a handshake failure explained by a broken cache is repairable with it", async () => {
  const { handler } = handlerFor({ runCli: async () => JSON.stringify(CACHE_BROKEN) });
  const { body } = await get(handler, "?distro=Ubuntu");
  assert.deepEqual(body.repairable, ["agent.cache", "agent.handshake"]);
});

await check("a native-pinned cache failure is repairable too", async () => {
  const broken = {
    verdict: "blocked",
    blockers: ["agent.cache"],
    checks: [
      { id: "agent.cache", status: "fail", detail: "1 cached, 1 not executable", remedy: "rm -rf ~/.cache/dsh-wsl/agent" },
    ],
    summary: { fail: 1, skipped: 0 },
  };
  const { handler } = handlerFor({ runCli: async () => JSON.stringify(broken) });
  const { body } = await get(handler, "?distro=Ubuntu");
  assert.deepEqual(body.repairable, ["agent.cache"], "agentBackend: native makes the cache a blocker, and the purge still applies");
});

await check("manual warnings advertise no repair", async () => {
  const { handler } = handlerFor();
  const { body } = await get(handler, "?distro=Ubuntu");
  assert.deepEqual(body.repairable, [], "a Linger warning has no plugin-owned repair");
});

await check("a blocked bwrap finding advertises no repair", async () => {
  const { handler } = handlerFor({ runCli: async () => JSON.stringify(BLOCKED) });
  const { body } = await get(handler, "?distro=Debian");
  assert.deepEqual(body.repairable, [], "installing a package is not the panel's repair");
});

await check("a repair POST runs the full doctor with --fix-owned and answers its fix rows", async () => {
  /** @type {string[][]} */
  const calls = [];
  const { handler } = handlerFor({ runCli: async (/** @type {string[]} */ argv) => { calls.push(argv); return JSON.stringify(REPAIRED); } });
  const { status, body } = await send(handler, "?distro=Ubuntu", "POST");
  assert.equal(status, 200);
  assert.equal(body.repaired, true);
  assert.equal(body.verdict, "ready");
  assert.deepEqual(body.repairs, [
    { id: "fix.scopes", title: "Swept stale scopes", status: "ok", detail: "1 stale before → 0 after" },
    { id: "fix.cache", title: "Purged the agent cache", status: "ok", detail: "1 cached, 1 invalid before → 0 cached, 0 invalid after" },
  ]);
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.repairable, [], "nothing is left to repair after the fix");
  assert.deepEqual(calls[0], ["--json", "--fix", "--fix-owned", "--distro", "Ubuntu"]);
});

await check("a repair never lists its own fix rows as findings", async () => {
  const report = {
    ...REPAIRED,
    checks: [
      ...REPAIRED.checks,
      { id: "fix.scopes", status: "warn", title: "Swept stale scopes", detail: "1 stale before → 1 after", remedy: "stop it by hand" },
    ],
  };
  const { handler } = handlerFor({ runCli: async () => JSON.stringify(report) });
  const { body } = await send(handler, "?distro=Ubuntu", "POST");
  assert.equal(body.repairs.length, 3);
  assert.deepEqual(body.warnings, []);
  assert.deepEqual(body.failures, []);
});

await check("a repair POST without a distro is refused before anything runs", async () => {
  const { handler, calls } = handlerFor();
  const { status, body } = await send(handler, "", "POST");
  assert.equal(status, 400);
  assert.match(body.error, /修复需要指定发行版/);
  assert.equal(calls.length, 0);
});

await check("a repair POST naming an unknown distro is refused before anything runs", async () => {
  const { handler, calls } = handlerFor();
  const { status } = await send(handler, "?distro=Arch", "POST");
  assert.equal(status, 400);
  assert.equal(calls.length, 0);
});

await check("an unsupported method is refused", async () => {
  const { handler, calls } = handlerFor();
  const { status } = await send(handler, "", "DELETE");
  assert.equal(status, 405);
  assert.equal(calls.length, 0);
});

await check("an unknown distro is refused before anything runs", async () => {
  const { handler, calls } = handlerFor();
  const { status, body } = await get(handler, "?distro=Arch");
  assert.equal(status, 400);
  assert.match(body.error, /未知发行版/);
  assert.equal(calls.length, 0);
});

await check("a fresh verdict is served from the cache; refresh re-runs it", async () => {
  const { handler, calls } = handlerFor();
  await get(handler, "?distro=Ubuntu");
  const second = await get(handler, "?distro=Ubuntu");
  assert.equal(calls.length, 1);
  assert.equal(second.body.cached, true);
  const refreshed = await get(handler, "?distro=Ubuntu&refresh=1");
  assert.equal(calls.length, 2);
  assert.equal(refreshed.body.cached, false);
});

await check("a stale verdict is replaced after the cache window", async () => {
  const { handler, calls, advance } = handlerFor();
  await get(handler, "?distro=Ubuntu");
  advance(20_000);
  await get(handler, "?distro=Ubuntu");
  assert.equal(calls.length, 2);
});

await check("the last successful result survives a handler reload (page refresh)", async () => {
  const statePath = join(scratch, "persist-reload.json");
  const first = handlerFor({ statePath });
  const before = await get(first.handler, "?distro=Ubuntu");
  assert.equal(before.body.verdict, "ready");
  const second = handlerFor({ statePath });
  const after = await get(second.handler);
  assert.equal(after.body.cached.length, 1);
  assert.equal(after.body.cached[0].distro, "Ubuntu");
  assert.equal(after.body.cached[0].checkedAt, before.body.checkedAt);
  assert.equal(after.body.cached[0].cached, true);
  assert.equal(after.body.cached[0].source, "user");
  assert.equal(second.calls.length, 0, "restoring the store runs no doctor");
  const stored = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.distros.Ubuntu.verdict, "ready");
});

await check("a background run is labeled with its source", async () => {
  const { handler, calls } = handlerFor({ running: async () => ["Ubuntu"] });
  const { body } = await get(handler, "?distro=Ubuntu&refresh=1&background=1");
  assert.equal(body.source, "background");
  assert.equal(body.checkedAt, 1000);
  assert.deepEqual(calls[0], ["--json", "--quick", "--distro", "Ubuntu"]);
});

await check("the list names the running distros the panel may refresh", async () => {
  const { handler } = handlerFor({ running: async () => ["Ubuntu", "Arch"] });
  const { body } = await get(handler);
  assert.deepEqual(body.running, ["Ubuntu"], "installed only");
});

await check("a failed background run overwrites the stored result truthfully", async () => {
  const statePath = join(scratch, "persist-background-failure.json");
  let mode = "ok";
  const { handler } = handlerFor({
    statePath,
    running: async () => ["Ubuntu"],
    runCli: async () => {
      if (mode === "fail") throw new Error("doctor 挂起");
      return JSON.stringify(READY);
    },
  });
  await get(handler, "?distro=Ubuntu&refresh=1");
  mode = "fail";
  const failed = await get(handler, "?distro=Ubuntu&refresh=1&background=1");
  assert.equal(failed.body.verdict, "error");
  assert.equal(failed.body.source, "background");
  const list = await get(handler);
  assert.equal(list.body.cached.length, 1);
  assert.equal(list.body.cached[0].verdict, "error", "the failure replaced the last success");
  assert.equal(list.body.cached[0].error, "doctor 挂起");
  assert.equal(list.body.cached[0].source, "background");
  const reloaded = handlerFor({ statePath });
  const afterReload = await get(reloaded.handler);
  assert.equal(afterReload.body.cached[0].verdict, "error", "the failure is what the reload shows");
  assert.equal(afterReload.body.cached[0].source, "background");
});

await check("a corrupt store is ignored instead of failing the panel", async () => {
  const statePath = join(scratch, "persist-corrupt.json");
  writeFileSync(statePath, "{not json");
  const { handler, calls } = handlerFor({ statePath });
  const { status, body } = await get(handler);
  assert.equal(status, 200);
  assert.deepEqual(body.cached, []);
  assert.equal(calls.length, 0);
});

await check("a failed run answers verdict error and is not cached", async () => {
  let attempts = 0;
  const { handler } = handlerFor({
    runCli: async () => {
      attempts += 1;
      throw new Error("doctor CLI 未能给出报告");
    },
  });
  const first = await get(handler, "?distro=Ubuntu");
  assert.equal(first.body.verdict, "error");
  assert.match(first.body.error, /未能给出报告/);
  const second = await get(handler, "?distro=Ubuntu");
  assert.equal(second.body.verdict, "error");
  assert.equal(attempts, 2);
});

await check("a distro-list failure is a 502 with the reason", async () => {
  const { handler } = handlerFor({ distros: async () => { throw new Error("wsl.exe missing"); } });
  const { status, body } = await get(handler);
  assert.equal(status, 502);
  assert.match(body.error, /无法读取发行版清单/);
});

await check("apply registers one authenticated exact route on the connection", async () => {
  /** @type {Array<{path: string, methods: readonly string[], requestBody: string, fetch: (request: Request) => Promise<Response>}>} */
  const routes = [];
  /** @type {string[]} */
  const disposers = [];
  const ctx = {
    /**
     * @param {readonly string[]} deps - the injected service names.
     * @param {(scope: any) => void} callback - the activation callback.
     */
    inject(deps, callback) {
      assert.deepEqual(deps, ["connection"]);
      callback({
        connection: {
          fetch: {
            /** @param {{path: string, methods: readonly string[], requestBody: string, fetch: (request: Request) => Promise<Response>}} route */
            register(route) {
              routes.push(route);
              return () => { disposers.push("route"); };
            },
          },
        },
        /**
         * @param {() => () => void} fn - the effect factory.
         * @returns {() => void} its disposer.
         */
        effect(fn) {
          const dispose = fn();
          assert.equal(typeof dispose, "function");
          return dispose;
        },
      });
    },
  };
  apply(ctx, { cacheMs: 15_000, timeoutMs: 60_000, wslPath: "wsl.exe" });
  assert.equal(routes.length, 1);
  const route = routes[0];
  assert.ok(route);
  assert.equal(route.path, STATUS_PATH);
  assert.deepEqual(route.methods, ["GET", "POST"]);
  assert.equal(route.requestBody, "buffered");
  assert.equal(typeof route.fetch, "function");
});

await check("apply registers through a real cordis context", async () => {
  // Regression: reading an undeclared property off a cordis Context throws
  // ("cannot get property ... without inject"), which swallowed the callback
  // before it could register. The route must appear against a real Context and
  // a sibling-provided service, not only against a plain fake.
  /** @type {string[]} */
  const paths = [];
  const root = new Context();
  root.plugin({
    name: "fake-connection",
    /** @param {any} ctx - the provider fiber's context. */
    apply(ctx) {
      ctx.provide("connection", {
        fetch: {
          /** @param {{path: string}} route - the registered route. */
          register(route) {
            paths.push(route.path);
            return async () => {};
          },
        },
      });
    },
  });
  root.plugin({ name: "wsl-status", /** @param {any} ctx - the row's context. */ apply: (ctx) => apply(ctx, {}) });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(paths, [STATUS_PATH]);
});

await check("apply is inert without a cordis inject", () => {
  apply({}, {});
});
