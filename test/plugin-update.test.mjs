// plugin-update.test.mjs — the sidebar panel's version and upgrade route.
//
// The route answers the panel's version card (installed/running versions, the
// latest installable stable release, the check's cache state) and performs the
// one-click upgrade through the host's plugin-manager. These checks pin the
// wire shape, the cache/refresh policy, every non-answer, the update slot's
// concurrency guard, and the registration that makes the route reachable.

import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";

import {
  apply,
  createPluginUpdateHandler,
  DEFAULT_CACHE_MS,
  installedVersion,
  PLUGIN_UPDATE_PATH,
  runningVersion,
} from "../lib/plugin-update.js";
import { currentUpdateFact, setUpdateFact } from "../lib/update-check.js";

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

/** A listed answer with a newer stable release. */
/** @type {Extract<import("../lib/update-check.js").VersionList, { status: "listed" }>} */
const FRESH = {
  status: "listed",
  installed: "0.26.4",
  registry: "https://registry.npmjs.org",
  attempts: [],
  versions: [
    { version: "0.27.0", tags: ["latest"], prerelease: false, bundle: true, publishedAt: "2026-11-19T00:00:00.000Z" },
    { version: "0.27.0-rc.1", tags: ["next"], prerelease: true, bundle: true },
  ],
  omitted: 0,
};

/** A listed answer with nothing newer. */
/** @type {Extract<import("../lib/update-check.js").VersionList, { status: "listed" }>} */
const CURRENT = {
  status: "listed",
  installed: "0.26.4",
  registry: "https://registry.npmjs.org",
  attempts: [],
  versions: [],
  omitted: 0,
};

/** One successful application outcome. */
/** @type {import("../lib/plugin-update.js").UpdateBundleResult} */
const APPLIED = {
  from: "0.26.4",
  to: "0.27.0",
  step: "install",
  result: { changed: true, application: "applied", stage: "enable", target: "dsh-plugin-wsl-env" },
};

/**
 * A plugin-manager stand-in.
 * @param {import("../lib/update-check.js").VersionList | (() => import("../lib/update-check.js").VersionList)} answer - the version answer, or a provider read per call.
 * @param {import("../lib/plugin-update.js").UpdateBundleResult} [updateResult] - what `updateBundle` resolves with.
 * @returns {{ manager: import("../lib/plugin-update.js").UpdateManagerSlice, calls: string[], updates: Array<{ name: string, version: string, options: unknown }> }} the stand-in and its logs.
 */
const managerFor = (answer, updateResult = APPLIED) => {
  /** @type {string[]} */
  const calls = [];
  /** @type {Array<{ name: string, version: string, options: unknown }>} */
  const updates = [];
  const manager = {
    /** @param {string} name - the package asked for. */
    listVersions: async (name) => {
      calls.push(name);
      return typeof answer === "function" ? answer() : answer;
    },
    /**
     * @param {string} name - the package updated.
     * @param {string} version - the target version.
     * @param {unknown} options - the registry option.
     */
    updateBundle: async (name, version, options) => {
      updates.push({ name, version, options });
      return updateResult;
    },
  };
  return { manager, calls, updates };
};

/**
 * Build one handler with a fake clock and versions.
 * @param {import("../lib/plugin-update.js").UpdateManagerSlice | undefined} manager - the host service.
 * @param {Partial<import("../lib/plugin-update.js").PluginUpdateHandlerOptions>} [overrides] - handler option overrides.
 * @returns {{ handler: import("../lib/plugin-update.js").PluginUpdateHandler, advance: (ms: number) => void, setInstalled: (version: string) => void }} the handler and its seams.
 */
const handlerFor = (manager, overrides = {}) => {
  let clock = 1000;
  let installed = "0.26.4";
  const handler = createPluginUpdateHandler({
    manager: () => manager,
    cacheMs: 60_000,
    now: () => clock,
    installed: () => installed,
    running: "0.26.4",
    ...overrides,
  });
  return {
    handler,
    advance: (ms) => { clock += ms; },
    setInstalled: (version) => { installed = version; },
  };
};

/**
 * Send one request to the handler.
 * @param {import("../lib/plugin-update.js").PluginUpdateHandler} handler - the route handler.
 * @param {"GET" | "POST" | "PUT"} method - the request method.
 * @param {string} [query] - the query string, including `?`.
 * @returns {Promise<{ status: number, body: any }>} the status and decoded body.
 */
const call = async (handler, method, query = "") => {
  const response = await handler(new Request(`http://host${PLUGIN_UPDATE_PATH}${query}`, { method }));
  return { status: response.status, body: await response.json() };
};

await check("the manifest supplies the installed and running versions", () => {
  assert.match(installedVersion(), /^\d+\.\d+\.\d+/u, "installedVersion reads package.json");
  assert.equal(runningVersion(), installedVersion(), "a fresh process runs the installed version");
});

await check("GET without a plugin-manager still reports the installed version", async () => {
  const { handler } = handlerFor(undefined);
  const answer = await call(handler, "GET");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.installed, "0.26.4");
  assert.equal(answer.body.running, "0.26.4");
  assert.equal(answer.body.status, "unavailable");
  assert.equal(answer.body.problem, "no-manager");
  assert.equal(answer.body.updateSupported, false);
  assert.equal(answer.body.canUpdate, false);
  assert.match(answer.body.reason, /plugin-manager/u);
});

await check("an available release is published to the fact and cached", async () => {
  setUpdateFact(undefined);
  const { manager, calls } = managerFor(FRESH);
  const { handler, advance } = handlerFor(manager);
  const first = await call(handler, "GET");
  assert.equal(first.status, 200);
  assert.equal(first.body.status, "available");
  assert.equal(first.body.latest.version, "0.27.0");
  assert.equal(first.body.latest.publishedAt, "2026-11-19T00:00:00.000Z");
  assert.equal(first.body.updateSupported, true);
  assert.equal(first.body.canUpdate, true);
  assert.equal(first.body.cached, false);
  assert.equal(currentUpdateFact()?.latest, "0.27.0", "the panel's check feeds the shell-environment fact");
  assert.deepEqual(calls, ["dsh-plugin-wsl-env"]);

  const second = await call(handler, "GET");
  assert.equal(second.body.cached, true, "a fresh answer is served from the cache");
  assert.deepEqual(calls, ["dsh-plugin-wsl-env"], "no second registry round-trip inside the TTL");

  advance(60_001);
  const third = await call(handler, "GET");
  assert.equal(third.body.cached, false, "the TTL expires");
  assert.deepEqual(calls, ["dsh-plugin-wsl-env", "dsh-plugin-wsl-env"]);

  const forced = await call(handler, "GET", "?refresh=1");
  assert.equal(forced.body.cached, false, "refresh bypasses the cache");
  assert.deepEqual(calls, ["dsh-plugin-wsl-env", "dsh-plugin-wsl-env", "dsh-plugin-wsl-env"]);
  setUpdateFact(undefined);
});

await check("an up-to-date answer clears a stale fact", async () => {
  setUpdateFact({ installed: "0.26.0", latest: "0.26.1", incompatible: false, checkedAt: 1 });
  const { manager } = managerFor(CURRENT);
  const { handler } = handlerFor(manager);
  const answer = await call(handler, "GET");
  assert.equal(answer.body.status, "current");
  assert.equal(currentUpdateFact(), undefined, "the old reminder is gone");
});

await check("a refused or throwing check keeps the previous fact", async () => {
  const staged = { installed: "0.26.4", latest: "0.27.0", incompatible: false, checkedAt: 1 };
  setUpdateFact(staged);
  /** @type {import("../lib/update-check.js").VersionList} */
  const refused = { status: "refused", problem: "network", reason: "registry unreachable", attempts: [] };
  const { handler } = handlerFor(managerFor(refused).manager);
  const answer = await call(handler, "GET");
  assert.equal(answer.body.status, "unavailable");
  assert.equal(answer.body.problem, "network");
  assert.equal(currentUpdateFact(), staged, "a non-answer never clears a live reminder");

  const throwing = {
    listVersions: async () => { throw new Error("service is broken"); },
  };
  const broken = handlerFor(/** @type {any} */ (throwing));
  const failed = await call(broken.handler, "GET");
  assert.equal(failed.body.status, "unavailable");
  assert.equal(failed.body.problem, "unknown");
  assert.match(failed.body.reason, /service is broken/u);
  assert.equal(currentUpdateFact(), staged);
  setUpdateFact(undefined);
});

await check("a latest release without a bundle is named, not shown as current", async () => {
  setUpdateFact({ installed: "0.26.4", latest: "0.27.0", incompatible: false, checkedAt: 1 });
  const { manager } = managerFor({
    status: "listed",
    installed: "0.26.4",
    registry: "https://registry.npmjs.org",
    attempts: [],
    versions: [{ version: "0.27.0", tags: ["latest"], prerelease: false, bundle: false }],
    omitted: 0,
  });
  const { handler } = handlerFor(manager);
  const answer = await call(handler, "GET");
  assert.equal(answer.body.status, "unavailable");
  assert.match(answer.body.reason, /0\.27\.0 declares no dsh\.bundle/u);
  assert.equal(currentUpdateFact(), undefined);
});

await check("POST refuses without a manager or without updateBundle", async () => {
  const absent = await call(handlerFor(undefined).handler, "POST");
  assert.equal(absent.status, 503);
  assert.match(absent.body.error, /Plugins page/u);

  const versionOnly = {
    listVersions: async () => FRESH,
  };
  const noUpdater = await call(handlerFor(/** @type {any} */ (versionOnly)).handler, "POST");
  assert.equal(noUpdater.status, 501);
  assert.match(noUpdater.body.error, /Plugins page/u);
});

await check("POST installs the checked stable release and reports the versions", async () => {
  setUpdateFact({ installed: "0.26.4", latest: "0.27.0", incompatible: false, checkedAt: 1 });
  let installed = "0.26.4";
  /** @type {import("../lib/update-check.js").VersionList} */
  let listed = FRESH;
  /** @type {string[]} */
  const calls = [];
  /** @type {Array<{ name: string, version: string, options: unknown }>} */
  const updates = [];
  const manager = {
    listVersions: async (/** @type {string} */ name) => {
      calls.push(name);
      return listed;
    },
    /**
     * @param {string} name - the package updated.
     * @param {string} version - the target version.
     * @param {unknown} options - the registry option.
     */
    updateBundle: async (name, version, options) => {
      updates.push({ name, version, options });
      installed = "0.27.0";
      listed = { ...CURRENT, installed: "0.27.0" };
      return APPLIED;
    },
  };
  const seam = handlerFor(manager, { installed: () => installed });
  const first = await call(seam.handler, "GET");
  assert.equal(first.body.canUpdate, true);
  const answer = await call(seam.handler, "POST");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.updated, true);
  assert.equal(answer.body.application, "applied");
  assert.equal(answer.body.from, "0.26.4");
  assert.equal(answer.body.to, "0.27.0");
  assert.equal(answer.body.installed, "0.27.0");
  assert.equal(answer.body.running, "0.26.4");
  assert.deepEqual(updates, [{
    name: "dsh-plugin-wsl-env",
    version: "0.27.0",
    options: { registry: "https://registry.npmjs.org" },
  }]);
  assert.equal(currentUpdateFact(), undefined, "a successful update clears the reminder");
  assert.equal(calls.length, 1, "POST reuses the panel's recent check");

  const after = await call(seam.handler, "GET");
  assert.equal(after.body.status, "current", "the next read sees the installed version");
  assert.equal(calls.length, 2, "the update invalidation forced a fresh check");
});

await check("POST refuses an incompatible latest release before calling the host", async () => {
  const incompatible = {
    ...FRESH,
    versions: [{
      version: "0.27.0",
      tags: ["latest"],
      prerelease: false,
      bundle: true,
      incompatible: { reason: "requires a newer dsh" },
    }],
  };
  const { manager, updates } = managerFor(incompatible);
  const { handler } = handlerFor(manager);
  const answer = await call(handler, "POST");
  assert.equal(answer.status, 409);
  assert.match(answer.body.error, /newer DSH/u);
  assert.equal(updates.length, 0, "nothing is removed or installed");
});

await check("an overridden selection still counts as an installed target", async () => {
  /** @type {import("../lib/plugin-update.js").UpdateBundleResult} */
  const overridden = {
    ...APPLIED,
    result: { ...APPLIED.result, application: "overridden" },
  };
  const { manager } = managerFor(FRESH, overridden);
  const { handler } = handlerFor(manager);
  const answer = await call(handler, "POST");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.updated, true, "the target package is installed");
  assert.equal(answer.body.application, "overridden", "the higher-priority override is reported, not hidden");
});

await check("POST reports a failed target and a successful rollback", async () => {
  /** @type {import("../lib/plugin-update.js").UpdateBundleResult} */
  const failed = {
    from: "0.26.4",
    to: "0.27.0",
    step: "install",
    result: {
      changed: false,
      application: "failed",
      stage: "install",
      target: "dsh-plugin-wsl-env",
      error: { code: "operation-error", diagnostic: "pnpm exited with 1" },
      pendingBuilds: ["esbuild"],
    },
    restore: { changed: true, application: "applied", stage: "install", target: "dsh-plugin-wsl-env@0.26.4" },
  };
  const { manager } = managerFor(FRESH, failed);
  const { handler } = handlerFor(manager);
  const answer = await call(handler, "POST");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.updated, false);
  assert.equal(answer.body.application, "failed");
  assert.equal(answer.body.error.code, "operation-error");
  assert.equal(answer.body.error.diagnostic, "pnpm exited with 1");
  assert.equal(answer.body.restored, true, "the old version came back");
  assert.deepEqual(answer.body.pendingBuilds, ["esbuild"]);
});

await check("POST admits only one update at a time", async () => {
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((resolve) => { release = /** @type {() => void} */ (resolve); });
  /** @type {() => void} */
  let started = () => {};
  const entered = new Promise((resolve) => { started = /** @type {() => void} */ (resolve); });
  const manager = {
    listVersions: async () => FRESH,
    updateBundle: async () => {
      started();
      await gate;
      return APPLIED;
    },
  };
  const { handler } = handlerFor(manager);
  const first = call(handler, "POST");
  await entered;
  const second = await call(handler, "POST");
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already running/u);
  release();
  const done = await first;
  assert.equal(done.body.updated, true);
});

await check("the lock is held across the version check: a second click inside it starts nothing", async () => {
  // A cold or stale cache makes the check a registry round trip of seconds.
  // The lock used to be taken only after it, so two clicks in that window
  // each ran their own removal and install.
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((resolve) => { release = /** @type {() => void} */ (resolve); });
  /** @type {() => void} */
  let started = () => {};
  const entered = new Promise((resolve) => { started = /** @type {() => void} */ (resolve); });
  let updates = 0;
  const manager = {
    /** @returns {Promise<typeof FRESH>} the listing, once the gate opens. */
    listVersions: async () => {
      started();
      await gate;
      return FRESH;
    },
    updateBundle: async () => {
      updates += 1;
      return APPLIED;
    },
  };
  const { handler } = handlerFor(manager);
  const first = call(handler, "POST");
  await entered;
  const second = await call(handler, "POST");
  assert.equal(second.status, 409, "the second click finds the update already running");
  assert.match(second.body.error, /already running/u);
  release();
  const done = await first;
  assert.equal(done.body.updated, true);
  assert.equal(updates, 1, "one removal and install, not two");
});

await check("methods other than GET and POST are refused", async () => {
  const { handler } = handlerFor(undefined);
  const answer = await call(handler, "PUT");
  assert.equal(answer.status, 405);
  assert.match(answer.body.error, /GET and POST/u);
});

await check("the default cache is ten minutes", () => {
  assert.equal(DEFAULT_CACHE_MS, 600_000);
});

await check("apply registers the route through a real cordis context", async () => {
  /** @type {Array<{ path: string, fetch: (request: Request) => Promise<Response> }>} */
  const routes = [];
  const root = new Context();
  root.plugin({
    name: "fake-connection",
    /** @param {any} ctx - the provider fiber's context. */
    apply(ctx) {
      ctx.provide("pluginManager", managerFor(FRESH).manager);
      ctx.provide("connection", {
        fetch: {
          /** @param {{ path: string, fetch: (request: Request) => Promise<Response> }} route - the registered route. */
          register(route) {
            routes.push(route);
            return async () => {};
          },
        },
      });
    },
  });
  root.plugin({ name: "wsl-plugin-update", /** @param {any} ctx - the row's context. */ apply: (ctx) => apply(ctx, {}) });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(routes.length, 1);
  assert.equal(routes[0]?.path, PLUGIN_UPDATE_PATH);
  const answer = await routes[0]?.fetch(new Request(`http://host${PLUGIN_UPDATE_PATH}`));
  const body = /** @type {any} */ (await answer?.json());
  assert.equal(body.status, "available");
  assert.equal(body.latest.version, "0.27.0");
});

await check("apply is inert without a cordis inject", () => {
  apply({}, {});
});

console.log(`\n${passed} plugin-update checks pass`);
