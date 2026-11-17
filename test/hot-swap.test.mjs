/**
 * The live same-name service swap the plugin's root-plane takeovers depend on.
 *
 * `cordis.patch.yml` disables the shipped `subprocess`/`fs`/`directoryPicker`
 * rows and inserts replacements. On a cold boot the shipped rows never start,
 * so the replacement registers freely. On a LIVE recomposition — a HMR plugin
 * enable/update, where the outgoing bundle layer re-activates the shipped rows
 * before the incoming layer disables them again — the shipped provision is
 * still registered while the replacement starts, and cordis rejects the
 * duplicate. That is exactly the failure users report as `service
 * "subprocess" has been registered at <LocalSubprocessRuntime>` (issue #39,
 * upstream deepseek-harness#12510).
 *
 * This file pins the host semantics the plugin's installed behaviour depends
 * on, using the REAL peer provider and the REAL plugin class:
 *
 *   1. busy: a holder (a live session's consumer) keeps the shipped provision
 *      registered while its fiber drains, and the replacement's registration
 *      is rejected — the known failure, documented rather than silent;
 *   2. recovery: once the provision is released, a replacement registers and
 *      later consumers bind to it;
 *   3. idle: with no holder the swap completes inside the same tick;
 *   4. deferred: the row the loader actually mounts (`lib/subprocess.js`'s
 *      default export) waits for the release and registers afterwards, so an
 *      install or update succeeds instead of failing and rolling back;
 *   5. the `fs` and `directoryPicker` rows defer through the same helper.
 *
 * If a future cordis/loader queues the registration instead of throwing, case
 * 1 fails and this file must be updated — that is the point: the plugin's
 * release gate follows the host's actual semantics, not a stale note.
 *
 * These checks mount services only; they never spawn `wsl.exe` and run on
 * every platform.
 *
 *   node test/hot-swap.test.mjs
 */
import assert from "node:assert/strict";
import { Context, Service } from "@deepseek-ai/cordis";
import { LocalSubprocessRuntime } from "@deepseek-ai/dsh-subprocess-local";
import fsRow, { WslRoutingFileSystem } from "../lib/fs-routing.js";
import pickerRow, { WslDirectoryPicker } from "../lib/picker.js";
import subprocessRow, { WslSubprocessRuntime } from "../lib/subprocess.js";

/** How long a simulated live consumer holds the provision while draining. */
const HOLD_MS = 300;
/** How long to wait before the replacement starts, well inside the hold. */
const PRE_MOUNT_MS = 30;

/**
 * @param {number} ms - the wait.
 * @returns a promise resolving after that wait.
 */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * A live consumer: `inject` makes its fiber a dependent of the provision, and
 * the slow disposer keeps that dependency registered while the provider
 * unloads — the state a session holding `ctx.subprocess` produces.
 */
class Holder {
  static inject = ["subprocess"];
  /** @param {Context} ctx - the context the consumer mounts in. */
  constructor(ctx) {
    ctx.effect(() => async () => { await sleep(HOLD_MS); });
  }
}

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
 * Mount the shipped provider and a live consumer that holds it.
 * @param {Context} ctx - the root the swap happens in.
 * @returns the mount fibers and the consumer.
 */
async function shippedWithHolder(ctx) {
  const shipped = ctx.plugin(LocalSubprocessRuntime);
  await shipped.await();
  const holder = ctx.plugin(Holder);
  await holder.await();
  assert.ok(ctx.get("subprocess") instanceof LocalSubprocessRuntime, "the harness starts on the shipped provider");
  return { shipped, holder };
}

check("the mounted rows register immediately when the name is free", async () => {
  const ctx = new Context();
  /** @param {Context} inner - the context the stub mounts in. */
  class SandboxPolicyStub extends Service {
    /** @param {Context} inner - the context the stub mounts in. */
    constructor(inner) { super(inner, "sandboxPolicy"); }
  }
  await ctx.plugin(SandboxPolicyStub).await();
  const subprocess = ctx.plugin(subprocessRow, {});
  const fs = ctx.plugin(fsRow, {});
  const picker = ctx.plugin(pickerRow, {});
  await subprocess.await();
  await fs.await();
  await picker.await();
  assert.ok(ctx.get("subprocess") instanceof WslSubprocessRuntime, "the cold path registers the subprocess provider");
  assert.ok(ctx.get("fs") instanceof WslRoutingFileSystem, "the cold path registers the fs provider");
  assert.ok(ctx.get("directoryPicker") instanceof WslDirectoryPicker, "the cold path registers the directoryPicker provider");
  await subprocess.dispose();
  await fs.dispose();
  await picker.dispose();
  assert.equal(ctx.get("subprocess"), undefined, "a disposed row releases its provision");
  assert.equal(ctx.get("fs"), undefined, "a disposed row releases its provision");
  assert.equal(ctx.get("directoryPicker"), undefined, "a disposed row releases its provision");
});

check("a replacement is rejected while the shipped provider drains", async () => {
  const ctx = new Context();
  const { shipped, holder } = await shippedWithHolder(ctx);
  const disposing = shipped.dispose();
  await sleep(PRE_MOUNT_MS);
  assert.ok(
    ctx.reflect.get("subprocess", false) !== undefined,
    "the shipped provision is still registered during the drain (the premise of the swap race)",
  );
  const challenger = ctx.plugin(WslSubprocessRuntime, {});
  await assert.rejects(
    () => challenger.await(),
    /service "subprocess" has been registered at <LocalSubprocessRuntime>/,
    "the failed swap is the reported production error; update this expectation if the host queues it instead",
  );
  await disposing;
  assert.equal(ctx.get("subprocess"), undefined, "neither provider survives the failed swap");
  await holder.dispose();
});

check("a replacement registers once the provision is released", async () => {
  const ctx = new Context();
  const { shipped, holder } = await shippedWithHolder(ctx);
  await shipped.dispose();
  const replacement = ctx.plugin(WslSubprocessRuntime, {});
  await replacement.await();
  assert.ok(ctx.get("subprocess") instanceof WslSubprocessRuntime, "the plugin's provider serves the name after the drain");
  const later = ctx.plugin(Holder);
  await later.await();
  assert.ok(ctx.get("subprocess") instanceof WslSubprocessRuntime, "a later consumer binds to the replacement");
  await later.dispose();
  await replacement.dispose();
  await holder.dispose();
});

check("an idle profile swaps without a drain", async () => {
  const ctx = new Context();
  const shipped = ctx.plugin(LocalSubprocessRuntime);
  await shipped.await();
  await shipped.dispose();
  const replacement = ctx.plugin(WslSubprocessRuntime, {});
  await replacement.await();
  assert.ok(ctx.get("subprocess") instanceof WslSubprocessRuntime, "no consumer, no drain: the swap lands immediately");
  await replacement.dispose();
});

check("the mounted row defers across the drain instead of failing", async () => {
  const ctx = new Context();
  const { shipped, holder } = await shippedWithHolder(ctx);
  const row = ctx.plugin(subprocessRow, {});
  await row.await();
  assert.ok(ctx.get("subprocess") instanceof LocalSubprocessRuntime, "before the drain the shipped provider keeps serving");
  await shipped.dispose();
  await sleep(PRE_MOUNT_MS);
  assert.ok(ctx.get("subprocess") instanceof WslSubprocessRuntime, "the row registered when the provision was released");
  await row.dispose();
  assert.equal(ctx.get("subprocess"), undefined, "disposing the row releases the takeover provision");
  await holder.dispose();
});

check("the fs and directoryPicker rows defer the same way", async () => {
  const ctx = new Context();
  /** @param {Context} inner - the context the stub mounts in. */
  class SandboxPolicyStub extends Service {
    /** @param {Context} inner - the context the stub mounts in. */
    constructor(inner) { super(inner, "sandboxPolicy"); }
  }
  await ctx.plugin(SandboxPolicyStub).await();
  /** @param {Context} inner - the context the occupier mounts in. */
  class FsOccupier extends Service {
    /** @param {Context} inner - the context the occupier mounts in. */
    constructor(inner) { super(inner, "fs"); }
  }
  const fsOccupier = ctx.plugin(FsOccupier);
  await fsOccupier.await();
  /** @param {Context} inner - the context the occupier mounts in. */
  class PickerOccupier extends Service {
    /** @param {Context} inner - the context the occupier mounts in. */
    constructor(inner) { super(inner, "directoryPicker"); }
  }
  const pickerOccupier = ctx.plugin(PickerOccupier);
  await pickerOccupier.await();
  const fsTakeover = ctx.plugin(fsRow, {});
  const pickerTakeover = ctx.plugin(pickerRow, {});
  await fsTakeover.await();
  await pickerTakeover.await();
  assert.ok(ctx.get("fs") instanceof Service && !(ctx.get("fs") instanceof WslRoutingFileSystem), "fs is still the outgoing provider");
  assert.ok(
    ctx.get("directoryPicker") instanceof Service && !(ctx.get("directoryPicker") instanceof WslDirectoryPicker),
    "directoryPicker is still the outgoing provider",
  );
  await fsOccupier.dispose();
  await pickerOccupier.dispose();
  await sleep(PRE_MOUNT_MS);
  assert.ok(ctx.get("fs") instanceof WslRoutingFileSystem, "the fs row took over after the release");
  assert.ok(ctx.get("directoryPicker") instanceof WslDirectoryPicker, "the directoryPicker row took over after the release");
  await fsTakeover.dispose();
  await pickerTakeover.dispose();
});

let failed = 0;
for (const [name, fn] of checks) await runCheck(name, fn);
failed = checks.length - passed;
console.log(`\n${passed}/${checks.length} hot-swap checks pass`);
if (failed > 0) process.exitCode = 1;
