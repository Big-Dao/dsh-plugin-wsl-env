/**
 * The same-name takeover seam: a WSL provider mounts at once when the service
 * store is empty, and otherwise waits for the outgoing provision's release —
 * exactly once. A fake context drives the internal/service events directly.
 *
 *   node test/service-takeover.test.mjs
 */
import assert from "node:assert/strict";
import { mountTakeover } from "../lib/service-takeover.js";

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

/**
 * A context whose service store holds one name until released.
 * @param {boolean} occupied - whether the store starts occupied.
 * @returns {{ ctx: import("@deepseek-ai/cordis").Context, release: () => void, listenerCount: () => number }}
 *   the fake context, its release trigger, and the live listener count.
 */
const makeCtx = (occupied) => {
  /** @type {Array<(name: string, value: unknown) => void>} */
  const listeners = [];
  let held = occupied ? {} : undefined;
  const ctx = /** @type {import("@deepseek-ai/cordis").Context} */ (/** @type {*} */ ({
    reflect: { get: () => held },
    fiber: { state: 2 /* FiberState.ACTIVE, a const enum the build inlines */ },
    logger: { warn: () => {}, debug: () => {} },
    on: (/** @type {string} */ _event, /** @type {(name: string, value: unknown) => void} */ fn) => {
      listeners.push(fn);
      return () => {
        const at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
  }));
  return {
    ctx,
    release: () => {
      held = undefined;
      for (const fn of [...listeners]) fn("svc", undefined);
    },
    listenerCount: () => listeners.length,
  };
};

await check("an empty store mounts immediately and registers no listener", () => {
  const { ctx, listenerCount } = makeCtx(false);
  let mounted = 0;
  mountTakeover(ctx, "svc", () => { mounted += 1; });
  assert.equal(mounted, 1);
  assert.equal(listenerCount(), 0);
});

await check("a release mounts the takeover exactly once and detaches the listener", () => {
  const { ctx, release, listenerCount } = makeCtx(true);
  let mounted = 0;
  mountTakeover(ctx, "svc", () => { mounted += 1; });
  assert.equal(mounted, 0, "an occupied store defers the mount");
  release();
  assert.equal(mounted, 1);
  assert.equal(listenerCount(), 0, "the release listener must not outlive the takeover");
  release();
  assert.equal(mounted, 1, "a later same-name release cannot mount a second provider");
});

console.log(`\n${passed} service-takeover checks pass`);
