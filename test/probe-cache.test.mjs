/**
 * Assertion checks for the probe cache policy. Pure module, no peers, so this runs
 * everywhere — including CI, which installs nothing.
 *
 *   node test/probe-cache.test.mjs
 */
import assert from "node:assert/strict";
import { createProbeCache } from "../lib/probe-cache.js";

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

await check("a failure is not remembered, so the fix is believed next time", async () => {
  const cache = createProbeCache();
  let usable = false;
  assert.equal(await cache.run("k", () => usable), false);
  assert.equal(cache.size, 0, "a failed probe must leave no entry");
  usable = true;
  assert.equal(await cache.run("k", () => usable), true);
});

await check("a success is remembered for the process lifetime", async () => {
  const cache = createProbeCache();
  let calls = 0;
  const probe = () => {
    calls += 1;
    return true;
  };
  assert.equal(await cache.run("k", probe), true);
  assert.equal(await cache.run("k", probe), true);
  assert.equal(calls, 1, "the second call must not probe again");
  assert.equal(cache.size, 1);
});

await check("a throwing probe is a failed probe, not a propagated error", async () => {
  const cache = createProbeCache();
  await assert.doesNotReject(() => cache.run("k", () => {
    throw new Error("spawn failed");
  }));
  assert.equal(await cache.run("k", () => true), true);
});

await check("concurrent misses share one probe", async () => {
  const cache = createProbeCache();
  let calls = 0;
  const probe = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return true;
  };
  const [a, b, c] = await Promise.all([cache.run("k", probe), cache.run("k", probe), cache.run("k", probe)]);
  assert.deepEqual([a, b, c], [true, true, true]);
  assert.equal(calls, 1, "three concurrent callers must spawn one probe");
});

await check("keys do not share verdicts", async () => {
  const cache = createProbeCache();
  assert.equal(await cache.run("a", () => true), true);
  assert.equal(await cache.run("b", () => false), false);
  assert.equal(cache.size, 1, "only the successful key stays");
});

console.log(`\n${passed} checks passed`);
