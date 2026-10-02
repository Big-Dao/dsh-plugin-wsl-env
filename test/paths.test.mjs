/**
 * Assertion checks for the pure path-translation layer. No test framework and
 * no DSH imports, so this runs anywhere Node runs:
 *
 *   node test/paths.test.mjs
 */
import assert from "node:assert/strict";
import { isRelativeWorldPath, isUnderDistro, isWorldPathUnder, isWslUnc, toDisplayPath, toLinuxPath, toWorldPath, uncToPosix, windowsToLinuxMount } from "../lib/paths.js";

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

check("isRelativeWorldPath isolates the only input that needs a base", () => {
  // A provider resolves its default workdir only when the answer can matter;
  // every absolute form must short-circuit before an in-distro query.
  assert.equal(isRelativeWorldPath("src/a.ts"), true);
  assert.equal(isRelativeWorldPath("./src"), true);
  assert.equal(isRelativeWorldPath("/home/andy"), false);
  assert.equal(isRelativeWorldPath(UNC), false);
  assert.equal(isRelativeWorldPath("C:\\Users\\andyz"), false);
  assert.equal(isRelativeWorldPath(""), false);
  // A UNC share outside WSL is absolute in its own right: treating it as
  // relative would spend a `wsl.exe` home query on input that never needs one.
  assert.equal(isRelativeWorldPath("\\\\server\\\\share\\\\dir"), false);
});

check("toWorldPath passes a foreign UNC share through verbatim", () => {
  // Joining it onto the default workdir would name a file that exists nowhere.
  // The `//server/share` spelling is deliberately not covered: it is ambiguous
  // with a POSIX path, and the model-facing input convention here is Linux
  // paths plus Windows spellings.
  assert.equal(toWorldPath("\\\\server\\\\share\\\\dir", { distro: "ubuntu", cwd: "/home/andy" }), "\\\\server\\\\share\\\\dir");
});

check("a distro home is a usable base in both directions", () => {
  const home = "/home/andy";
  const world = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\a.ts";
  assert.equal(toWorldPath("proj/a.ts", { distro: "ubuntu", cwd: home }), world);
  assert.equal(toLinuxPath("proj/a.ts", { distro: "ubuntu", cwd: home }), "/home/andy/proj/a.ts");
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

check("isWorldPathUnder compares UNC targets case-insensitively", () => {
  const root = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj";
  assert.equal(isWorldPathUnder(`${root}\\src\\a.ts`, root), true);
  assert.equal(isWorldPathUnder(root, root), true);
  assert.equal(isWorldPathUnder(root.toUpperCase(), root), true);
  assert.equal(isWorldPathUnder("\\\\wsl.localhost\\ubuntu\\home\\andy\\proj2\\a.ts", root), false);
  assert.equal(isWorldPathUnder("\\\\wsl.localhost\\ubuntu\\home\\andy", root), false);
  assert.equal(isWorldPathUnder("C:\\Users\\andyz\\x", root), false);
});

check("isWorldPathUnder maps a Linux grant onto the target's share", () => {
  // A distro-side grant ("/tmp") and a target reached through the share are the
  // same place; without the distro, no containment is claimed.
  assert.equal(isWorldPathUnder("\\\\wsl.localhost\\ubuntu\\tmp\\x", "/tmp", { distro: "ubuntu" }), true);
  assert.equal(isWorldPathUnder("\\\\wsl.localhost\\ubuntu\\tmp\\x", "/tmp"), false);
  assert.equal(isWorldPathUnder("\\\\wsl.localhost\\ubuntu\\tmp\\x", "/tmp", { distro: "debian" }), false);
});

check("isWorldPathUnder keeps POSIX semantics for POSIX pairs", () => {
  assert.equal(isWorldPathUnder("/home/andy/proj/a.ts", "/home/andy/proj"), true);
  assert.equal(isWorldPathUnder("/home/andy/proj", "/home/andy"), true);
  assert.equal(isWorldPathUnder("/home/andyson/a.ts", "/home/andy"), false);
  assert.equal(isWorldPathUnder("/home/andy/a.ts", "/"), true);
  assert.equal(isWorldPathUnder("/home/andy", "/Home"), false);
});

check("isWorldPathUnder treats a drive root as a root, not a prefix", () => {
  assert.equal(isWorldPathUnder("C:\\Users\\andyz\\x", "C:\\"), true);
  assert.equal(isWorldPathUnder("C:\\ish", "C:\\"), true); // a genuine child of the drive root
  assert.equal(isWorldPathUnder("D:\\x", "C:\\"), false);
  // The sibling trap a bare-prefix comparison would fall for.
  assert.equal(isWorldPathUnder("C:\\Users\\andyson\\x", "C:\\Users\\andy"), false);
  assert.equal(isWorldPathUnder("C:\\Users\\andy", "C:\\Users\\andy"), true);
});

check("isWorldPathUnder refuses to guess across vocabularies", () => {
  assert.equal(isWorldPathUnder("/home/andy", "C:\\"), false);
  assert.equal(isWorldPathUnder("relative/x", "/home/andy"), false);
  assert.equal(isWorldPathUnder("", "/home/andy"), false);
});

console.log(`\n${passed} checks passed`);
