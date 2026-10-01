/**
 * Which POSIX-mode facts survive the WSL UNC share, and where they can be set.
 *
 * Run with Windows Node:
 *   node mode-probe.mjs
 *
 * Answers three questions the filesystem backend's publication step depends on:
 *   1. does a host-side `stat` of a UNC path report the distro's POSIX mode?
 *   2. does a host-side `chmod` take effect?
 *   3. does an IN-DISTRO `chmod` of a staged temp file survive a host-side
 *      `rename` over the target?
 */

import { execFileSync } from "node:child_process";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UNC = "\\\\wsl.localhost\\ubuntu\\home\\andy\\.dsh-fsprobe\\mode";
const LINUX = "/home/andy/.dsh-fsprobe/mode";

const distro = (...argv) => execFileSync("wsl.exe", ["-d", "ubuntu", "--exec", ...argv], { encoding: "utf8", env: { ...process.env, WSL_UTF8: "1" } }).trim();

const hostMode = async (windowsPath) => {
  const info = await stat(windowsPath, { bigint: true });
  return (Number(info.mode & 0o777n)).toString(8).padStart(3, "0");
};

const lines = [];
const rec = (name, ok, detail = "") => lines.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);

await mkdir(UNC, { recursive: true });
const target = join(UNC, "plain.txt");
const linuxTarget = `${LINUX}/plain.txt`;
await rm(target, { force: true });

// 1. host stat of a fresh file, and after an in-distro chmod
await writeFile(target, "x\n");
rec("host stat of a new file", true, `host=${await hostMode(target)} distro=${distro("stat", "-c", "%a", linuxTarget)}`);
distro("chmod", "755", linuxTarget);
rec("in-distro chmod is visible to the host stat", true, `host=${await hostMode(target)} distro=${distro("stat", "-c", "%a", linuxTarget)}`);

// 2. host-side chmod
try {
  const { chmod } = await import("node:fs/promises");
  await chmod(target, 0o700);
  rec("host chmod", true, `host=${await hostMode(target)} distro=${distro("stat", "-c", "%a", linuxTarget)}`);
} catch (error) {
  rec("host chmod", false, `${error.code} ${error.message}`);
}

// 3. in-distro chmod of a temp file, then a host rename over the target
const temp = join(UNC, "staged.tmp");
const linuxTemp = `${LINUX}/staged.tmp`;
await rm(temp, { force: true });
const handle = await open(temp, "wx", 0o600);
await handle.writeFile("staged\n", "utf8");
await handle.sync();
// the publication hook's position: content written, handle still open
try {
  distro("chmod", "755", linuxTemp);
  rec("in-distro chmod of the staged temp (handle still open)", true, `distro=${distro("stat", "-c", "%a", linuxTemp)}`);
} catch (error) {
  rec("in-distro chmod of the staged temp (handle still open)", false, `${error.code} ${error.message}`);
}
await handle.close();
await rename(temp, target);
rec("in-distro mode survives the host rename", distro("stat", "-c", "%a", linuxTarget) === "755", `distro=${distro("stat", "-c", "%a", linuxTarget)} content=${distro("cat", linuxTarget).trim()}`);

await rm(join(UNC, "staged.tmp"), { force: true });
console.log(lines.join("\n"));
