/**
 * Assertion checks for the picker's pure helpers and the UNC-root vocabulary.
 * Dependency-free, so this runs without the DSH peers the picker service needs:
 *
 *   node test/listing.test.mjs
 */
import assert from "node:assert/strict";
import { ancestryCrumbs, boundedInsert, breadcrumbs, dirListingArgv, fullyQualified, parseDirListing } from "../lib/listing.js";
import { UNC_PROVIDER_ROOT, distroRoot, isProviderRoot } from "../lib/paths.js";

let passed = 0;
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
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
  const head = crumbs[0];
  assert.ok(head !== undefined, "the chain has a head");
  assert.equal(isProviderRoot(head.path), false);
  assert.notEqual(head.path, DISTRO_ROOT);
});

check("breadcrumbs heads a distro chain with the WSL row", () => {
  const crumbs = breadcrumbs(HOME, UNC_PROVIDER_ROOT);
  assert.deepEqual(
    crumbs.map((c) => c.name),
    ["WSL", "ubuntu", "home", "andy"],
  );
  const [wslRow, distroRow] = crumbs;
  assert.ok(wslRow !== undefined && distroRow !== undefined, "the chain has the WSL and distro rows");
  assert.equal(wslRow.path, UNC_PROVIDER_ROOT);
  assert.equal(distroRow.path, DISTRO_ROOT);
});

check("breadcrumbs leaves an ordinary Windows chain alone", () => {
  const crumbs = breadcrumbs("C:\\Users\\andyz", UNC_PROVIDER_ROOT);
  assert.deepEqual(
    crumbs.map((c) => c.name),
    ["C:\\", "Users", "andyz"],
  );
  const head = crumbs[0];
  assert.ok(head !== undefined, "the chain has a head");
  assert.equal(head.path, "C:\\");
});

check("boundedInsert keeps the window name-sorted", () => {
  /** @type {Array<{name: string}>} */
  const window = [];
  for (const name of ["c", "a", "b"]) assert.equal(boundedInsert(window, { name }, 10), false);
  assert.deepEqual(
    window.map((entry) => entry.name),
    ["a", "b", "c"],
  );
});

check("boundedInsert refuses candidates past a full window", () => {
  /** @type {Array<{name: string}>} */
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

check("dirListingArgv lists one level with links resolved and NUL separation", () => {
  assert.deepEqual(dirListingArgv("/home/andy"), ["find", "-L", "/home/andy", "-maxdepth", "1", "-mindepth", "1", "-type", "d", "-print0"]);
});

check("parseDirListing keeps enterable rows, carries the UNC parent into paths, and sorts", () => {
  // `-L` folds the per-entry stat the host walk paid 9p round trips for:
  // a symlink to a directory arrives through `-type d`, a file never does,
  // and a broken link is not listed at all. `find` is unsorted; the parse
  // sorts host-side.
  // The fixture is exactly what `find -L -type d -print0` emits: files never
  // reach the parse — `-type d` filtered them in the distro.
  const { rows, truncated } = parseDirListing(
    "/home/andy/docs\0/home/andy/.proj\0/home/andy/Z\0",
    "/home/andy",
    "\\\\wsl.localhost\\ubuntu\\home\\andy",
    10,
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    [".proj", "Z", "docs"],
  );
  const [projRow, zRow, docsRow] = rows;
  assert.ok(docsRow !== undefined && projRow !== undefined && zRow !== undefined, "the parse kept the three rows");
  assert.equal(projRow.hidden, true);
  assert.equal(docsRow.hidden, false);
  assert.equal(docsRow.path, "\\\\wsl.localhost\\ubuntu\\home\\andy\\docs");
  assert.equal(truncated, false);
});

check("parseDirListing keeps a newline inside a name whole (WSL-306)", () => {
  const { rows } = parseDirListing(
    "/home/andy/a\nb\0/home/andy/after\0",
    "/home/andy",
    "\\\\wsl.localhost\\ubuntu\\home\\andy",
    10,
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ["a\nb", "after"],
    "the NUL boundary, not the newline, is what splits entries",
  );
  const first = rows[0];
  assert.ok(first !== undefined);
  assert.equal(first.path, "\\\\wsl.localhost\\ubuntu\\home\\andy\\a\nb");
});

check("parseDirListing caps rows at maxEntries and flags the remainder", () => {
  const { rows, truncated } = parseDirListing("/root/a\0/root/b\0/root/c\0", "/root", "\\\\wsl.localhost\\ubuntu\\root", 2);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["a", "b"],
  );
  assert.equal(truncated, true);
});

check("parseDirListing tolerates an empty listing and a trailing NUL", () => {
  assert.deepEqual(parseDirListing("", "/", "\\\\wsl.localhost\\ubuntu", 5).rows, []);
  assert.deepEqual(parseDirListing("\0", "/", "\\\\wsl.localhost\\ubuntu", 5).rows, []);
});

check("parseDirListing handles the root listing's single-slash prefix", () => {
  const { rows } = parseDirListing("/bin\0/etc\0", "/", "\\\\wsl.localhost\\ubuntu", 5);
  assert.deepEqual(
    rows.map((row) => row.name),
    ["bin", "etc"],
  );
});

console.log(`\n${passed} checks passed`);
