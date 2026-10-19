/**
 * Tests for `scripts/peer-canary.mjs`'s pure halves: which tag versions count
 * as a canary event, and how a manifest's pins are rewritten for the scratch
 * install. The registry query and scratch `pnpm test` are the workflow's job.
 *
 *   node test/peer-canary.test.mjs
 */
import assert from "node:assert/strict";
import { peerDelta, rewriteManifest } from "../scripts/peer-canary.mjs";

let passed = 0;
/**
 * Run one named check.
 * @param {string} name - the check name.
 * @param {() => void} fn - the assertions.
 */
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

check("a newer exact pin is a delta; an equal or older tag is not", () => {
  assert.deepEqual(peerDelta({ "a": "1.0.0" }, { a: "1.1.0" }), [{ name: "a", pinned: "1.0.0", latest: "1.1.0" }]);
  assert.deepEqual(peerDelta({ "a": "1.0.0" }, { a: "1.0.0" }), []);
  assert.deepEqual(peerDelta({ "a": "1.0.0" }, { a: "0.9.0" }), [], "a pin ahead of the tag is not an upgrade event");
});

check("a newer tilde patch or minor is a delta; equal is not", () => {
  assert.deepEqual(peerDelta({ "a": "~1.2.3" }, { a: "1.2.4" }), [{ name: "a", pinned: "~1.2.3", latest: "1.2.4" }]);
  assert.deepEqual(peerDelta({ "a": "~1.2.3" }, { a: "1.3.0" }), [{ name: "a", pinned: "~1.2.3", latest: "1.3.0" }]);
  assert.deepEqual(peerDelta({ "a": "~1.2.3" }, { a: "1.2.3" }), []);
});

check("a peer without the queried tag is skipped, not reported", () => {
  assert.deepEqual(peerDelta({ "a": "1.0.0", "b": "2.0.0" }, { a: "1.1.0" }), [{ name: "a", pinned: "1.0.0", latest: "1.1.0" }]);
});

check("rewriteManifest moves peer and dev pins and keeps tilde ranges", () => {
  const manifest = {
    name: "x",
    peerDependencies: { "a": "1.0.0", "b": "~2.0.0", "c": "3.0.0" },
    devDependencies: { "a": "1.0.0", "d": "4.0.0" },
  };
  const next = rewriteManifest(manifest, { a: "1.1.0", b: "2.0.1", d: "4.1.0" });
  assert.equal(next.peerDependencies?.a, "1.1.0", "exact peer moves exactly");
  assert.equal(next.peerDependencies?.b, "~2.0.1", "a tilde range stays a tilde range");
  assert.equal(next.peerDependencies?.c, "3.0.0", "an unqueried peer keeps its pin");
  assert.equal(next.devDependencies?.a, "1.1.0", "dev pins move with the peers");
  assert.equal(next.devDependencies?.d, "4.1.0");
  assert.equal(manifest.peerDependencies?.a, "1.0.0", "the input manifest is not mutated");
});

console.log(`${passed}/4 peer-canary checks pass`);
