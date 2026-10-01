/**
 * Assertion checks for the picker's pure helpers and the UNC-root vocabulary.
 * Dependency-free, so this runs without the DSH peers the picker service needs:
 *
 *   node test/listing.test.mjs
 */
import assert from "node:assert/strict";
import { ancestryCrumbs, boundedInsert, breadcrumbs, fullyQualified } from "../lib/listing.js";
import { UNC_PROVIDER_ROOT, distroRoot, isProviderRoot } from "../lib/paths.js";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

const DISTRO_ROOT = "\\\\wsl.localhost\\ubuntu";
const HOME = "\\\\wsl.localhost\\ubuntu\\home\\andy";

check("distroRoot builds a complete UNC path", () => {
  assert.equal(distroRoot("ubuntu"), DISTRO_ROOT);
});

check("isProviderRoot recognises the share root in both spellings", () => {
  assert.equal(isProviderRoot(UNC_PROVIDER_ROOT), true);
  assert.equal(isProviderRoot("\\\\wsl.localhost\\"), true);
  assert.equal(isProviderRoot("\\\\wsl$"), true);
  assert.equal(isProviderRoot("\\\\wsl$\\"), true);
  assert.equal(isProviderRoot(DISTRO_ROOT), false);
  assert.equal(isProviderRoot("/home/andy"), false);
});

check("fullyQualified accepts distro roots but not the bare share root", () => {
  // This is exactly why the root level's `path` is a distro root: the bare
  // share root would be rejected before a listing is ever requested.
  assert.equal(fullyQualified(DISTRO_ROOT), true);
  assert.equal(fullyQualified(HOME), true);
  assert.equal(fullyQualified("C:\\Users\\andyz"), true);
  assert.equal(fullyQualified(UNC_PROVIDER_ROOT), false);
  assert.equal(fullyQualified("\\\\wsl.localhost"), false);
  assert.equal(fullyQualified("\\foo"), false);
  assert.equal(fullyQualified("/home/andy"), false);
  assert.equal(fullyQualified("relative\\path"), false);
});

check("ancestryCrumbs names every ancestor without blanks", () => {
  const crumbs = ancestryCrumbs(HOME);
  assert.deepEqual(
    crumbs.map((c) => c.name).slice(-3),
    ["ubuntu", "home", "andy"],
  );
  // Regression guard: win32.basename of a share root is '' in some spellings,
  // which used to render a blank breadcrumb row.
  assert.ok(
    crumbs.every((crumb) => crumb.name.length > 0),
    `a crumb rendered blank: ${JSON.stringify(crumbs.map((c) => c.name))}`,
  );
  // win32.dirname stops at the share root, and reports it with a trailing
  // separator, so the raw chain never yields the canonical distro root.
  assert.equal(isProviderRoot(crumbs[0].path), false);
  assert.notEqual(crumbs[0].path, DISTRO_ROOT);
});

check("breadcrumbs heads a distro chain with the WSL row", () => {
  const crumbs = breadcrumbs(HOME, UNC_PROVIDER_ROOT);
  assert.deepEqual(
    crumbs.map((c) => c.name),
    ["WSL", "ubuntu", "home", "andy"],
  );
  assert.equal(crumbs[0].path, UNC_PROVIDER_ROOT);
  assert.equal(crumbs[1].path, DISTRO_ROOT);
});

check("breadcrumbs leaves an ordinary Windows chain alone", () => {
  const crumbs = breadcrumbs("C:\\Users\\andyz", UNC_PROVIDER_ROOT);
  assert.deepEqual(
    crumbs.map((c) => c.name),
    ["C:\\", "Users", "andyz"],
  );
  assert.equal(crumbs[0].path, "C:\\");
});

check("boundedInsert keeps the window name-sorted", () => {
  const window = [];
  for (const name of ["c", "a", "b"]) assert.equal(boundedInsert(window, { name }, 10), false);
  assert.deepEqual(
    window.map((entry) => entry.name),
    ["a", "b", "c"],
  );
});

check("boundedInsert refuses candidates past a full window", () => {
  const window = [];
  assert.equal(boundedInsert(window, { name: "a" }, 2), false);
  assert.equal(boundedInsert(window, { name: "b" }, 2), false);
  // 'c' sorts after the window's largest, so it is dropped without being placed.
  assert.equal(boundedInsert(window, { name: "c" }, 2), true);
  assert.deepEqual(
    window.map((entry) => entry.name),
    ["a", "b"],
  );
});

check("boundedInsert displaces the largest when a smaller candidate arrives", () => {
  const window = [{ name: "a" }, { name: "b" }];
  assert.equal(boundedInsert(window, { name: "aa" }, 2), true);
  assert.deepEqual(
    window.map((entry) => entry.name),
    ["a", "aa"],
  );
});

console.log(`\n${passed} checks passed`);
