/**
 * The in-app doctor's effective-provider check: which class serves
 * `subprocess`/`fs`/`directoryPicker` in this host process.
 *
 * The check exists because a failed takeover is invisible in the standalone
 * doctor (a separate process cannot read live services) and quiet in the UI —
 * a HMR upgrade that rolls back, or a config that leaves a shipped provider in
 * place, otherwise looks like a healthy install. These checks pin the snapshot
 * classification and the row the merge appends, without mounting a context.
 *
 *   node test/takeover-report.test.mjs
 */
import assert from "node:assert/strict";
import { WslRoutingFileSystem } from "../lib/fs-routing.js";
import { WslDirectoryPicker } from "../lib/picker.js";
import { WslSubprocessRuntime } from "../lib/subprocess.js";
import { TAKEOVER_SERVICES, mergeTakeoverReport, takeoverSnapshot } from "../lib/takeover-report.js";

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

check("the snapshot names this plugin's providers", () => {
  const ctx = {
    get: (/** @type {string} */ name) => /** @type {Record<string, unknown>} */ ({
      subprocess: Object.create(WslSubprocessRuntime.prototype),
      fs: Object.create(WslRoutingFileSystem.prototype),
      directoryPicker: Object.create(WslDirectoryPicker.prototype),
    })[name],
  };
  const snapshot = takeoverSnapshot(ctx);
  assert.deepEqual(snapshot.map((entry) => entry.service), [...TAKEOVER_SERVICES], "one entry per takeover name, in order");
  assert.deepEqual(snapshot.map((entry) => entry.state), ["plugin", "plugin", "plugin"]);
});

check("another provider is named, and an absent one is missing", () => {
  const snapshot = takeoverSnapshot({
    get: (/** @type {string} */ name) => name === "subprocess" ? {} : undefined,
  });
  assert.deepEqual(snapshot.map((entry) => entry.state), ["other", "missing", "missing"]);
  assert.equal(snapshot[0]?.provider, "Object", "the other provider's class name is reported");
  assert.equal(snapshot[1]?.provider, undefined, "a missing service carries no provider");
});

check("a context without a lookup, or one that refuses it, contributes nothing", () => {
  assert.deepEqual(takeoverSnapshot({}), [], "the CLI/test seam has no evidence");
  assert.deepEqual(
    takeoverSnapshot({ get: () => { throw new Error("not in this realm"); } }).map((entry) => entry.state),
    ["missing", "missing", "missing"],
    "a refused read is an absent provider, not a crash",
  );
});

check("no evidence adds no row, so every foreign context keeps its report", () => {
  /** @type {import("../lib/takeover-report.js").TakeoverMergeReport} */
  const report = { checks: [{ id: "host.platform", status: "ok" }], summary: { ok: 1 } };
  assert.equal(mergeTakeoverReport(report, []), report, "an empty snapshot returns the report verbatim");
  assert.equal(
    mergeTakeoverReport(report, takeoverSnapshot({})),
    report,
    "an all-missing snapshot is a context that cannot see the root and is left alone",
  );
});

check("a complete takeover appends one ok row", () => {
  /** @type {import("../lib/takeover-report.js").TakeoverMergeReport} */
  const report = { checks: [{ id: "host.platform", status: "ok" }], summary: { ok: 1 } };
  const merged = mergeTakeoverReport(report, takeoverSnapshot({
    get: (/** @type {string} */ name) => /** @type {Record<string, unknown>} */ ({
      subprocess: Object.create(WslSubprocessRuntime.prototype),
      fs: Object.create(WslRoutingFileSystem.prototype),
      directoryPicker: Object.create(WslDirectoryPicker.prototype),
    })[name],
  }));
  const row = merged.checks?.find((entry) => entry.id === "providers.takeover");
  assert.ok(row, "the takeover row is appended");
  assert.equal(row.status, "ok");
  assert.equal(row.title, "WSL service takeovers");
  assert.match(String(row.detail), /subprocess=plugin, fs=plugin, directoryPicker=plugin/);
  assert.equal(row.remedy, undefined, "an ok row carries no remedy");
  assert.equal(merged.summary?.ok, 2, "the summary counts the new row");
  assert.notEqual(merged, report, "the input report is not mutated");
});

check("a shipped provider still serving a name warns with the remedy", () => {
  /** @type {import("../lib/takeover-report.js").TakeoverSnapshot[]} */
  const snapshot = [
    { service: "subprocess", state: "other", provider: "LocalSubprocessRuntime" },
    { service: "fs", state: "plugin" },
    { service: "directoryPicker", state: "missing" },
  ];
  /** @type {import("../lib/takeover-report.js").TakeoverMergeReport} */
  const report = { checks: [], summary: {} };
  const merged = mergeTakeoverReport(report, snapshot);
  const row = merged.checks?.find((entry) => entry.id === "providers.takeover");
  assert.equal(row?.status, "warn");
  assert.match(String(row?.detail), /subprocess=LocalSubprocessRuntime, fs=plugin, directoryPicker=missing/);
  assert.match(String(row?.remedy), /restart DSH/);
  assert.match(String(row?.remedy), /docs\/LIMITATIONS\.md/);
  assert.equal(merged.summary?.warn, 1);
});

let failed = 0;
for (const [name, fn] of checks) await runCheck(name, fn);
failed = checks.length - passed;
console.log(`\n${passed}/${checks.length} takeover-report checks pass`);
if (failed > 0) process.exitCode = 1;
