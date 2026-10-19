/**
 * Assertion checks for the pure distro-selection helper.
 *
 *   node test/distro-route.test.mjs
 */
import assert from "node:assert/strict";
import { distroOfUnc, isAutoDistro, isDefaultDistro, pinnedDistro, selectDistro } from "../lib/distro-route.js";

let passed = 0;
/** @type {Array<[string, () => void]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through `runCheck`.
 * @param {string} name - the check's name.
 * @param {() => void} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void} fn - the check's assertions.
 */
const runCheck = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

const UBUNTU = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj";
const DEBIAN = "\\\\wsl.localhost\\Debian\\home\\andy\\proj";

check("distroOfUnc reads a distro from either share spelling", () => {
  assert.equal(distroOfUnc(UBUNTU), "ubuntu");
  assert.equal(distroOfUnc("\\\\wsl$\\Debian\\srv"), "Debian");
  assert.equal(distroOfUnc("C:\\proj\\a.ts"), undefined);
  assert.equal(distroOfUnc("/home/andy"), undefined);
  assert.equal(distroOfUnc(undefined), undefined);
});

check("pinnedDistro distinguishes a name from the modes", () => {
  assert.equal(pinnedDistro("Ubuntu"), "Ubuntu");
  assert.equal(pinnedDistro(""), undefined);
  assert.equal(pinnedDistro("auto"), undefined);
  assert.equal(pinnedDistro("AUTO"), undefined);
  assert.equal(pinnedDistro("default"), undefined);
});

check("auto modes are empty and auto, case-insensitively", () => {
  assert.equal(isAutoDistro(""), true);
  assert.equal(isAutoDistro("auto"), true);
  assert.equal(isAutoDistro("AUTO"), true);
  assert.equal(isAutoDistro("default"), false);
  assert.equal(isAutoDistro("Ubuntu"), false);
});

check("default mode is explicit, case-insensitively", () => {
  assert.equal(isDefaultDistro("default"), true);
  assert.equal(isDefaultDistro("DEFAULT"), true);
  assert.equal(isDefaultDistro(""), false);
  assert.equal(isDefaultDistro("auto"), false);
});

check("an explicit distro wins over the workspace", () => {
  assert.deepEqual(
    selectDistro({ configured: "Ubuntu", candidates: [DEBIAN], fallback: "Ubuntu" }),
    { distro: "Ubuntu", source: "pinned" },
  );
});

check("auto follows the strongest workspace coordinate", () => {
  assert.deepEqual(
    selectDistro({ configured: "", candidates: [DEBIAN, UBUNTU], fallback: "Ubuntu" }),
    { distro: "Debian", source: "workspace" },
  );
  assert.deepEqual(
    selectDistro({ configured: "auto", candidates: [undefined, UBUNTU], fallback: "Ubuntu" }),
    { distro: "ubuntu", source: "workspace" },
  );
});

check("auto falls back when no candidate names a distro", () => {
  assert.deepEqual(
    selectDistro({ configured: "", candidates: ["/home/andy", "C:\\proj", undefined], fallback: "Ubuntu" }),
    { distro: "Ubuntu", source: "default" },
  );
});

check("default forces the fallback even when a workspace names another distro", () => {
  assert.deepEqual(
    selectDistro({ configured: "default", candidates: [DEBIAN], fallback: "Ubuntu" }),
    { distro: "Ubuntu", source: "default" },
  );
});

check("a relative candidate does not steal the choice", () => {
  assert.deepEqual(
    selectDistro({ configured: "auto", candidates: ["proj", DEBIAN], fallback: "Ubuntu" }),
    { distro: "Debian", source: "workspace" },
  );
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} distro-route checks pass`);
