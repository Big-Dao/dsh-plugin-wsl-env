/**
 * Assertion checks for the update-check service.
 *
 * The row's registry work belongs to the host's plugin-manager, so every check
 * here feeds it a stand-in: the pure pieces (`clampInterval`, `firstDelayMs`,
 * `updateTarget`, `updateFactMessage`) are tested directly, the check's
 * non-answer posture through mock `listVersions` shapes, and the mount
 * against real cordis with and without a plugin-manager to prove the missing
 * service degrades quietly instead of failing the component.
 *
 *   node test/update-check.test.mjs
 */
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import * as rowModule from "../lib/update-check.js";
import {
  MIN_INTERVAL_MS,
  DEFAULT_INTERVAL_MS,
  checkForUpdate,
  clampInterval,
  currentUpdateFact,
  firstDelayMs,
  setUpdateFact,
  updateFactMessage,
  updateTarget,
} from "../lib/update-check.js";

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through `runCheck`.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
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
  }
};

/**
 * A `listVersions` stand-in from one answer shape.
 * @param {import("../lib/update-check.js").VersionList | Error} answer - what the stand-in resolves with, or rejects with.
 * @returns {{ calls: string[], manager: import("../lib/update-check.js").PluginManagerSlice }} the stand-in and its call log.
 */
const managerFrom = (answer) => {
  /** @type {string[]} */
  const calls = [];
  const manager = {
    /** @param {string} name - the package asked for. */
    listVersions: async (name) => {
      calls.push(name);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { calls, manager };
};

/** A `listed` answer with the stable channel moved and a healthy target. */
/** @type {Extract<import("../lib/update-check.js").VersionList, { status: "listed" }>} */
const LISTED_FRESH = {
  status: "listed",
  installed: "0.19.0",
  registry: "https://registry.npmjs.org",
  attempts: [],
  versions: [
    { version: "0.20.0", tags: ["latest"], prerelease: false, bundle: true, publishedAt: "2026-11-01T00:00:00.000Z" },
    { version: "0.20.0-rc.1", tags: ["next"], prerelease: true, bundle: true },
  ],
  omitted: 0,
};

check("clampInterval floors a tight loop and passes sane values", () => {
  assert.equal(clampInterval(undefined), DEFAULT_INTERVAL_MS, "an absent interval is the default");
  assert.equal(clampInterval(0), MIN_INTERVAL_MS, "zero is floored, not a spin loop");
  assert.equal(clampInterval(500), MIN_INTERVAL_MS, "sub-minute intervals are floored");
  assert.equal(clampInterval(7 * 60 * 1000), 7 * 60 * 1000, "a sane value passes through");
});

check("firstDelayMs stays inside the 2-10 minute window", () => {
  assert.equal(firstDelayMs(() => 0), 120_000, "the window's floor");
  assert.equal(firstDelayMs(() => 0.999_999), 599_999.52, "the window's ceiling (jittered, not inclusive)");
  assert.ok(firstDelayMs() >= 120_000 && firstDelayMs() <= 600_000, "the real randomness lands inside the window");
});

check("updateTarget picks the newest latest-tagged bundle version", () => {
  const target = updateTarget(LISTED_FRESH);
  assert.equal(target?.version, "0.20.0", "the stable channel's release, not the rc on next");
});

check("updateTarget skips targets the update could not install", () => {
  /** @type {Extract<import("../lib/update-check.js").VersionList, { status: "listed" }>} */
  const noBundle = {
    status: "listed",
    installed: "0.19.0",
    registry: "https://registry.npmjs.org",
    attempts: [],
    versions: [{ version: "0.20.0", tags: ["latest"], prerelease: false, bundle: false }],
    omitted: 0,
  };
  assert.equal(updateTarget(noBundle), undefined, "a version without the bundle manifest is not an installable update");
  /** @type {Extract<import("../lib/update-check.js").VersionList, { status: "listed" }>} */
  const rcOnly = {
    status: "listed",
    installed: "0.19.0",
    registry: "https://registry.npmjs.org",
    attempts: [],
    versions: [{ version: "0.20.0-rc.1", tags: ["next"], prerelease: true, bundle: true }],
    omitted: 0,
  };
  assert.equal(updateTarget(rcOnly), undefined, "a prerelease on next is not news to a stable install");
  /** @type {Extract<import("../lib/update-check.js").VersionList, { status: "listed" }>} */
  const empty = { status: "listed", installed: "0.19.0", registry: "https://registry.npmjs.org", attempts: [], versions: [], omitted: 0 };
  assert.equal(updateTarget(empty), undefined, "an up-to-date list names no target");
});

check("a healthy newer release publishes the fact", async () => {
  setUpdateFact(undefined);
  const { calls, manager } = managerFrom(LISTED_FRESH);
  const fact = await checkForUpdate(manager);
  assert.deepEqual(calls, ["dsh-plugin-wsl-env"], "the stand-in is asked about this package by name");
  assert.equal(fact?.installed, "0.19.0");
  assert.equal(fact?.latest, "0.20.0");
  assert.equal(fact?.incompatible, false, "an unmarked version is compatible");
  assert.equal(fact?.deprecated, undefined, "an unmarked version is not deprecated");
  assert.equal(fact?.publishedAt, "2026-11-01T00:00:00.000Z");
  assert.equal(currentUpdateFact()?.latest, "0.20.0", "the fact is published for shellEnv's synchronous read");
  setUpdateFact(undefined);
});

check("an incompatible or deprecated latest still publishes, with its marks", async () => {
  setUpdateFact(undefined);
  const { manager } = managerFrom({
    status: "listed",
    installed: "0.19.0",
    registry: "https://registry.npmjs.org",
    attempts: [],
    versions: [{ version: "0.20.0", tags: ["latest"], prerelease: false, bundle: true, deprecated: "known regression", incompatible: { reason: "peer @deepseek-ai/dsh-fs moved" } }],
    omitted: 0,
  });
  const fact = await checkForUpdate(manager);
  assert.equal(fact?.incompatible, true, "the DSH rejection is carried, not swallowed");
  assert.equal(fact?.deprecated, "known regression");
  setUpdateFact(undefined);
});

check("every non-answer is quiet and leaves the store untouched", async () => {
  const staged = { installed: "0.19.0", latest: "0.20.0", incompatible: false, checkedAt: 1 };
  setUpdateFact(staged);
  assert.equal(await checkForUpdate(undefined), undefined, "no host plugin-manager, no check");
  assert.equal(currentUpdateFact(), staged, "the previous fact stands");
  for (const problem of /** @type {const} */ (["not-updatable", "network", "not-found", "unknown"])) {
    const { manager } = managerFrom({ status: "refused", problem, reason: "because", attempts: [] });
    assert.equal(await checkForUpdate(manager), undefined, `a ${problem} refusal publishes nothing`);
  }
  assert.equal(currentUpdateFact(), staged, "refusals never clear the previous fact");
  const { manager: throwing } = managerFrom(new Error("service broken"));
  assert.equal(await checkForUpdate(throwing), undefined, "a throwing service publishes nothing");
  assert.equal(currentUpdateFact(), staged, "even a throw keeps the previous fact");
  setUpdateFact(undefined);
});

check("an up-to-date registry clears a stale fact", async () => {
  setUpdateFact({ installed: "0.18.0", latest: "0.19.0", incompatible: false, checkedAt: 1 });
  const { manager } = managerFrom({ status: "listed", installed: "0.19.0", registry: "https://registry.npmjs.org", attempts: [], versions: [], omitted: 0 });
  assert.equal(await checkForUpdate(manager), undefined, "nothing new to say");
  assert.equal(currentUpdateFact(), undefined, "the stale fact is gone, not replayed forever");
});

check("the message is empty, plain, or marked", () => {
  assert.equal(updateFactMessage(undefined), "", "no fact, no message");
  assert.equal(
    updateFactMessage({ installed: "0.19.0", latest: "0.20.0", incompatible: false, checkedAt: 0 }),
    "0.20.0 available (installed 0.19.0)",
    "the plain wording both surfaces share",
  );
  assert.equal(
    updateFactMessage({ installed: "0.19.0", latest: "0.20.0", incompatible: true, deprecated: "known regression", checkedAt: 0 }),
    "0.20.0 available (installed 0.19.0) — requires a newer DSH first; deprecated: known regression",
    "the marks arrive in one line, remedy included",
  );
});

check("the mount survives a host without a plugin-manager", async () => {
  const ctx = new Context();
  const fiber = await ctx.plugin(rowModule, { enabled: true });
  // No crash, no component failure: the missing service is a debug line and
  // the first timer sits 2-10 minutes out, unref'd. Dispose immediately so no
  // timer outlives the check.
  const disposable = /** @type {{ dispose?: () => Promise<void> } | undefined} */ (fiber);
  await disposable?.dispose?.();
  assert.equal(currentUpdateFact(), undefined, "a degraded mount publishes no fact");
});

check("the mount wires a provided plugin-manager through the real cordis", async () => {
  setUpdateFact(undefined);
  /** @type {string[]} */
  const asked = [];
  const host = {
    name: "update-check-host",
    /** @param {Context} ctx - the host context. */
    apply(ctx) {
      ctx.provide("pluginManager", {
        /** @param {string} name - the package asked for. */
        listVersions: async (name) => {
          asked.push(name);
          return LISTED_FRESH;
        },
      });
    },
  };
  const ctx = new Context();
  await ctx.plugin(host);
  // The row's first check waits 2-10 minutes by design; the wiring check only
  // proves the service resolves and the row mounts, then stops the timers.
  await ctx.plugin(rowModule, { enabled: true });
  assert.deepEqual(asked, [], "no check before the jittered delay");
  const fiber = /** @type {{ dispose?: () => Promise<void> } | undefined} */ (await ctx.plugin(rowModule, { enabled: false }));
  await fiber?.dispose?.();
  setUpdateFact(undefined);
});

check("enabled: false mounts nothing at all", async () => {
  setUpdateFact(undefined);
  const ctx = new Context();
  const fiber = await ctx.plugin(rowModule, { enabled: false });
  const disposable = /** @type {{ dispose?: () => Promise<void> } | undefined} */ (fiber);
  await disposable?.dispose?.();
  assert.equal(currentUpdateFact(), undefined, "a disabled row publishes no fact");
});

for (const [name, fn] of checks) await runCheck(name, fn);
console.log(`\n${passed} update-check checks pass`);
