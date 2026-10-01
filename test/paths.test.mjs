/**
 * Assertion checks for the pure path-translation layer. No test framework and
 * no DSH imports, so this runs anywhere Node runs:
 *
 *   node test/paths.test.mjs
 */
import assert from "node:assert/strict";
import { isUnderDistro, isWslUnc, toDisplayPath, toLinuxPath, toWorldPath, uncToPosix, windowsToLinuxMount } from "../lib/paths.js";

const UNC = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj";
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

check("isWslUnc accepts both share spellings", () => {
  assert.equal(isWslUnc(UNC), true);
  assert.equal(isWslUnc("\\\\wsl$\\ubuntu\\home"), true);
  assert.equal(isWslUnc("C:\\Users"), false);
  assert.equal(isWslUnc("/home/andy"), false);
});

check("uncToPosix extracts distro and Linux path", () => {
  assert.deepEqual(uncToPosix(UNC), { distro: "ubuntu", linuxPath: "/home/andy/proj" });
  assert.deepEqual(uncToPosix("\\\\wsl.localhost\\ubuntu"), { distro: "ubuntu", linuxPath: "/" });
  assert.equal(uncToPosix("C:\\Users"), undefined);
});

check("isUnderDistro is case-insensitive and scoped", () => {
  assert.equal(isUnderDistro(UNC, "ubuntu"), true);
  assert.equal(isUnderDistro(UNC, "Ubuntu"), true);
  assert.equal(isUnderDistro(UNC, "debian"), false);
});

check("windowsToLinuxMount maps drive paths", () => {
  assert.equal(windowsToLinuxMount("C:\\Users\\andyz\\Documents"), "/mnt/c/Users/andyz/Documents");
  assert.equal(windowsToLinuxMount("/home/andy"), undefined);
});

check("toLinuxPath handles every coordinate system", () => {
  assert.equal(toLinuxPath(UNC, { distro: "ubuntu" }), "/home/andy/proj");
  assert.equal(toLinuxPath("/home/andy/proj", { distro: "ubuntu" }), "/home/andy/proj");
  assert.equal(toLinuxPath("C:\\Users\\andyz\\x", { distro: "ubuntu" }), "/mnt/c/Users/andyz/x");
  assert.equal(toLinuxPath("src/a.ts", { distro: "ubuntu", cwd: "/home/andy/proj" }), "/home/andy/proj/src/a.ts");
});

check("toLinuxPath resolves a relative path against a UNC cwd", () => {
  assert.equal(toLinuxPath("src/a.ts", { distro: "ubuntu", cwd: UNC }), "/home/andy/proj/src/a.ts");
});

check("toWorldPath maps Linux paths onto the UNC share", () => {
  assert.equal(toWorldPath("/home/andy/proj", { distro: "ubuntu" }), UNC);
  assert.equal(toWorldPath(UNC, { distro: "ubuntu" }), UNC);
  assert.equal(toWorldPath("C:\\Users\\andyz\\x", { distro: "ubuntu" }), "C:\\Users\\andyz\\x");
});

check("toWorldPath resolves a relative path against a Linux cwd", () => {
  assert.equal(toWorldPath("src/a.ts", { distro: "ubuntu", cwd: "/home/andy/proj" }), `${UNC}\\src\\a.ts`);
});

check("toDisplayPath shows Linux paths inside the distro only", () => {
  assert.equal(toDisplayPath(UNC, "ubuntu"), "/home/andy/proj");
  assert.equal(toDisplayPath(UNC, "debian"), UNC);
  assert.equal(toDisplayPath("C:\\Users\\andyz", "ubuntu"), "C:\\Users\\andyz");
});

check("round-trip Linux -> world -> display is stable", () => {
  const linux = "/home/andy/proj/src/a.ts";
  const world = toWorldPath(linux, { distro: "ubuntu" });
  assert.equal(toDisplayPath(world, "ubuntu"), linux);
});

check("uncToPosix round-trips paths a shell would otherwise split", () => {
  // `WslFileSystem.publish` hands these paths back to the distro as separate
  // argv elements, so a space, a quote or a `$` has to survive untouched.
  const tricky = "\\\\wsl.localhost\\ubuntu\\home\\andy\\my project\\a'b\"c$d\\src";
  assert.deepEqual(uncToPosix(tricky), { distro: "ubuntu", linuxPath: "/home/andy/my project/a'b\"c$d/src" });
  assert.equal(toWorldPath("/home/andy/my project/a'b\"c$d/src", { distro: "ubuntu" }), tricky);
});

check("uncToPosix keeps a distro name that is not a bare word", () => {
  assert.deepEqual(uncToPosix("\\\\wsl.localhost\\Ubuntu-24.04\\home"), { distro: "Ubuntu-24.04", linuxPath: "/home" });
});

console.log(`\n${passed} checks passed`);
