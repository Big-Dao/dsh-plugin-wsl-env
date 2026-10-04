/**
 * Assertion checks for the distro-routed `workspace-files` takeover: the pure
 * builders/parsers and the distro operations over a fake agent runner. Every
 * wire shape and refusal the GUI can observe is asserted here, without a
 * distro.
 *
 *   node test/workspace-files-wsl.test.mjs
 */
import assert from "node:assert/strict";
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol";
import {
  distroList,
  distroRead,
  distroReadBytes,
  distroStat,
} from "../lib/workspace-files-wsl.js";
import {
  isDistroWorkspace,
  linuxJoin,
  listDistroArgv,
  parseDirListing,
  parseStatRecord,
  parseStatRecordFromStderr,
  pageArgv,
  statRecordArgv,
  bytesArgv,
  distroPath,
} from "../lib/workspace-files-route.js";

let passed = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.stack?.split('\n').slice(0, 3).join(' | ') ?? error}`);
    process.exitCode = 1;
  }
};

const ROOT = "/home/andy/proj";

function fakeAgent(script) {
  const calls = [];
  return {
    calls,
    exec(options) {
      calls.push(options);
      const [outcome] = script.splice(0, 1);
      if (outcome instanceof Function) return outcome(options);
      if (outcome instanceof Error) return Promise.reject(outcome);
      return Promise.resolve(outcome);
    },
  };
}

check("route predicate and path helpers", () => {
  assert.equal(isDistroWorkspace("\\\\wsl.localhost\\ubuntu\\home\\x"), true);
  assert.equal(isDistroWorkspace("C:\\proj"), false);
  assert.equal(linuxJoin("/home/andy/proj", "src/a.ts"), "/home/andy/proj/src/a.ts");
  assert.equal(linuxJoin("/home/andy/proj", "\\\\wsl.localhost\\ubuntu\\etc\\hosts"), "/etc/hosts");
  assert.equal(linuxJoin("/home/andy/proj", ""), "/home/andy/proj");
  assert.equal(distroPath("C:\\Users\\x\\Temp"), "/mnt/c/Users/x/Temp");
  assert.equal(distroPath("42"), "42", "non-path values ride verbatim");
});

check("builders produce the argv shape the agent protocol carries", () => {
  assert.deepEqual(listDistroArgv("/root", "/root/src", 500), [
    "sh", "-c",
    'root=$1 dir=$2 max=$3\nreal=$(realpath -L -- "$dir") || exit 2\ncase "$real" in "$root") ;; "$root"/*) ;; *) echo "OUTSIDE:$real" >&2; exit 3;; esac\n[ -d "$real" ] || { echo "NOTDIR:$real" >&2; exit 4; }\nls -1ALp -- "$real" | head -n "$max"',
    "sh", "/root", "/root/src", 501,
  ]);
  assert.deepEqual(statRecordArgv("/root/a.txt").slice(0, 2), ["sh", "-c"]);
  assert.deepEqual(pageArgv("/root/a.txt", 3, 100).slice(3), ["sh", "/root/a.txt", "3", "100"]);
  assert.deepEqual(bytesArgv("/root/a.txt", 0, 2048).slice(3), ["sh", "/root/a.txt", "0", "2048"]);
});

check("parseDirListing caps entries and distinguishes directories from files", () => {
  const { entries, truncated } = parseDirListing("src/\nREADME.md\nnotes/\n", 2);
  assert.deepEqual(entries, [
    { name: "src", type: "directory" },
    { name: "README.md", type: "file" },
  ]);
  assert.equal(truncated, true, "the level had more than the cap");
  const whole = parseDirListing("a/\n", 5);
  assert.equal(whole.truncated, false);
});

check("parseStatRecord synthesizes the opaque version and maps the kind", () => {
  const record = parseStatRecord("regular file\t4096\tfc03\t917517\t1760000000\t1759000000");
  assert.equal(record.type, "file");
  assert.equal(record.size, 4096);
  assert.equal(record.version, "fc03:917517:4096:1760000000:1759000000");
  assert.equal(parseStatRecord("symbolic link\t10\tx\ty\tz\tw").type, "symlink");
});

check("distroList routes through the runner and maps refusals", async () => {
  const runner = fakeAgent([
    { exitCode: 0, stdout: "src/\nREADME.md\n", stderr: "" },
    { exitCode: 3, stdout: "", stderr: "OUTSIDE:/etc" },
    { exitCode: 4, stdout: "", stderr: "NOTDIR:/home/andy/proj/a.txt" },
    { exitCode: 2, stdout: "", stderr: "realpath: No such file" },
  ]);
  const listing = await distroList({ runner, distro: "ubuntu", linuxRoot: ROOT, path: ".", maxEntries: 100 });
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["src", "README.md"]);
  assert.equal(listing.path, "", "the workspace root lists as an empty relative path");
  assert.equal(runner.calls[0].cwd, "/");
  await assert.rejects(
    () => distroList({ runner, distro: "ubuntu", linuxRoot: ROOT, path: "..", maxEntries: 100 }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/outside-workspace",
  );
  await assert.rejects(
    () => distroList({ runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt", maxEntries: 100 }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/not-directory",
  );
  await assert.rejects(
    () => distroList({ runner, distro: "ubuntu", linuxRoot: ROOT, path: "gone", maxEntries: 100 }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/not-found",
  );
});

check("distroStat returns the UNC display path with the synthesized version", async () => {
  const runner = fakeAgent([
    { exitCode: 0, stdout: "regular file\t512\tfc03\t917517\t1760000000\t1759000000\n", stderr: "" },
  ]);
  const stat = await distroStat({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(stat.absolutePath, "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\a.txt", "the display path keeps today's UNC form");
  assert.equal(stat.version, "fc03:917517:512:1760000000:1759000000");
  assert.equal(stat.bytes, 512);
  const missing = fakeAgent([{ exitCode: 1, stdout: "", stderr: "" }]);
  await assert.rejects(
    () => distroStat({ runner: missing, distro: "ubuntu", linuxRoot: ROOT, path: "gone", distroWorkspaceRoot: "" }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/not-found",
  );
});

check("distroRead mirrors the upstream page semantics", async () => {
  const record = "regular file\t24\tfc03\t1\t1760000000\t1759000000";
  const runner = fakeAgent([
    { exitCode: 0, stdout: Buffer.from("alpha\nbeta\ngamma\n"), stderr: `${record}\n` },
    { exitCode: 0, stdout: Buffer.from("alpha\nbeta\n"), stderr: `${record}\n` },
    { exitCode: 0, stdout: Buffer.from("a\x00b\n"), stderr: `${record}\n` },
    { exitCode: 0, stdout: Buffer.from([0xff, 0xfe]), stderr: `${record}\n` },
  ]);
  const full = await distroRead({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    offset: 1, limit: 100, maxBytes: 65536,
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(full.text, "alpha\nbeta\ngamma\n");
  assert.equal(full.eof, true, "the yield stayed within the limit");
  assert.equal(full.lines, 3);
  assert.equal(full.absolutePath, "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\a.txt");

  const partial = await distroRead({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    offset: 1, limit: 2, maxBytes: 65536,
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(partial.text, "alpha\nbeta\n");
  assert.equal(partial.eof, false, "a third line exists past the page");

  await assert.rejects(
    () => distroRead({
      runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
      offset: 1, limit: 100, maxBytes: 65536,
      distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/not-text",
    "a NUL byte marks the page binary",
  );
});

check("distroRead enforces the page byte cap with the upstream message", async () => {
  const record = "regular file\t99999\tfc03\t1\t1760000000\t1759000000";
  const runner = fakeAgent([{ exitCode: 0, stdout: Buffer.from("x".repeat(200) + "\n"), stderr: `${record}\n` }]);
  await assert.rejects(
    () => distroRead({
      runner, distro: "ubuntu", linuxRoot: ROOT, path: "big.txt",
      offset: 1, limit: 10, maxBytes: 100,
      distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/too-large" && /exceed the 100 byte cap/.test(error.message),
  );
});

check("distroReadBytes caps whole-file reads and reports EOF", async () => {
  const data = Buffer.from("hello world");
  const runner = fakeAgent([
    { exitCode: 0, stdout: data, stderr: `regular file\t${data.length}\tfc03\t1\t1760000000\t1759000000\n` },
    { exitCode: 0, stdout: data, stderr: `regular file\t99999\tfc03\t1\t1760000000\t1759000000\n` },
    { exitCode: 0, stdout: Buffer.from("ld"), stderr: "regular file\t11\tfc03\t1\t1760000000\t1759000000\n" },
  ]);
  const whole = await distroReadBytes({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    offset: undefined, length: undefined, maxFileBytes: 65536,
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(whole.data.length, data.length);
  assert.equal(whole.eof, true);
  assert.equal(whole.offset, 0);
  await assert.rejects(
    () => distroReadBytes({
      runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
      offset: undefined, length: undefined, maxFileBytes: 65536,
      distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
    }),
    (error) => error instanceof RemoteError && error.code === "workspace-file/too-large",
    "a file above the complete-file cap is refused, never truncated",
  );
  const window = await distroReadBytes({
    runner, distro: "ubuntu", linuxRoot: ROOT, path: "a.txt",
    offset: data.length - 2, length: 64, maxFileBytes: 65536,
    distroWorkspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj",
  });
  assert.equal(window.eof, true, "a short window at the end of the file reports EOF");
  assert.equal(Buffer.from(window.data).toString(), "ld");
});

check("parseStatRecordFromStderr picks the tab-separated record line", () => {
  const record = parseStatRecordFromStderr("noise\nregular file\t24\tfc03\t1\t1760000000\t1759000000\n");
  assert.equal(record.type, "file");
  assert.equal(parseStatRecordFromStderr("no record here"), undefined);
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} workspace-files-wsl checks pass`);
