/**
 * Probe: drive the WSL filesystem backend's mutation path end to end.
 *
 * The interesting surface is not reading — the UNC share is an ordinary
 * filesystem to Node — but *publication*: `dsh-fs-local` publishes a write by
 * staging a private temp file and renaming it over the target, and on Windows it
 * additionally copies the replaced file's DACL onto the temp first. The WSL
 * share has no Windows security descriptors, so that step is what this probe
 * pins down, together with the POSIX mode bits the share is known to drop.
 *
 * Runs inside a probe-only profile that binds `ctx.fs` to the distro:
 *
 *   dsh --profile wslfs --patch <this dir>/wslfs-probe.yml --no-open --port 0
 *
 * It writes its findings beside itself and exits the process.
 *
 * @module dsh-plugin-wsl/test/probe/fs-probe
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export const inject = ["fs"];

const HERE = "\\\\wsl.localhost\\ubuntu\\home\\andy\\Projects\\dsh\\plugins\\dsh-plugin-wsl-env\\test\\probe";
const OUT = `${HERE}\\fs-probe.txt`;

/** A scratch directory inside the distro that this probe owns. */
const DIR = "/home/andy/.dsh-fsprobe";
const FILE = `${DIR}/probe.txt`;

/**
 * A name that stays in the distro no matter what the default workdir is. The
 * probe resolves it RELATIVE, so the answer comes from the provider's default —
 * which the profile deliberately leaves empty.
 */
const RELATIVE = "dsh-wsl-probe-relative.txt";

/** Run one command in the distro and return its trimmed stdout. */
function inDistro(...argv) {
  return execFileSync("wsl.exe", ["-d", "ubuntu", "--exec", ...argv], {
    encoding: "utf8",
    env: { ...process.env, WSL_UTF8: "1" },
  }).trim();
}

/** The file's POSIX mode as the distro sees it, or a marker when unreadable. */
function modeOf(linuxPath) {
  try {
    return inDistro("stat", "-c", "%a", linuxPath);
  } catch (error) {
    return `unreadable (${error?.message ?? error})`;
  }
}

export async function apply(ctx) {
  const lines = [];
  const say = (line) => lines.push(line);
  const record = (name, ok, detail = "") => say(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : `  — ${detail}`}`);

  /** Run one probe step, recording a thrown error instead of aborting the run. */
  const step = async (name, body) => {
    try {
      const detail = await body();
      record(name, true, detail ?? "");
      return true;
    } catch (error) {
      record(name, false, `${error?.code ?? error?.name ?? "Error"}: ${error?.message ?? String(error)}`);
      return false;
    }
  };

  say("== WslFileSystem mutation probe ==");
  say(`scratch: ${DIR}`);
  say(`mode before the run: ${modeOf(FILE)}`);
  say("");

  let target;
  if (!(await step("resolve an absent path", async () => {
    target = await ctx.fs.resolve(FILE);
    return `displayPath=${target.displayPath}`;
  }))) {
    finish(lines);
    return;
  }

  // The default workdir: the profile configures no `cwd`, so a relative path has
  // to resolve against the distro user's home. The expected value is asked of
  // the distro directly rather than read back from the plugin, so this is a
  // cross-check of the fallback and not a restatement of it. The old default
  // (`process.cwd()`) would have produced `/mnt/c/...` here instead.
  await step("a relative path resolves against the distro's home", async () => {
    const home = inDistro("sh", "-c", 'printf %s "$HOME"');
    if (!home.startsWith("/")) throw new Error(`the distro reported no home (got ${JSON.stringify(home)})`);
    const relative = await ctx.fs.resolve(RELATIVE);
    const expected = `${home}/${RELATIVE}`;
    if (relative.displayPath !== expected) {
      throw new Error(`displayPath=${relative.displayPath}, expected ${expected}`);
    }
    return relative.displayPath;
  });

  await step("writeText createIfAbsent (new file)", async () => {
    const outcome = await ctx.fs.writeText(target, "alpha\n", { kind: "createIfAbsent" });
    return `operation=${outcome.operation} version=${outcome.version}`;
  });
  say(`mode after create: ${modeOf(FILE)}`);

  let version;
  await step("stat exposes a version", async () => {
    const info = await ctx.fs.stat(target);
    version = info?.version;
    return `type=${info?.type} size=${info?.size} version=${version}`;
  });

  await step("readText returns the created content", async () => {
    const text = await ctx.fs.readText(target);
    if (text !== "alpha\n") throw new Error(`unexpected content ${JSON.stringify(text)}`);
    return JSON.stringify(text);
  });

  // Make the file executable the way a user would, then check every later
  // mutation still leaves it executable. This is the assertion the share's
  // ignored host-side `chmod` used to break silently.
  await step("chmod 755 inside the distro", async () => {
    inDistro("chmod", "755", FILE);
    const mode = modeOf(FILE);
    if (mode !== "755") throw new Error(`mode is ${mode}, expected 755`);
    return mode;
  });

  // `chmod` moves ctime, and the version is dev:ino:size:mtime:ctime, so the
  // guard has to be refreshed from the state the mutation actually sees — which
  // is exactly what a model does by re-reading before an edit.
  await step("re-stat after the chmod", async () => {
    const info = await ctx.fs.stat(target);
    version = info?.version;
    return `version=${version}`;
  });

  await step("editText with the version guard (replaceIfVersion)", async () => {
    const outcome = await ctx.fs.editText(target, { oldString: "alpha", newString: "beta" }, { kind: "replaceIfVersion", version });
    version = outcome.version;
    return `version=${version}`;
  });
  await step("content after edit is the edited text", async () => {
    const text = await ctx.fs.readText(target);
    if (text !== "beta\n") throw new Error(`unexpected content ${JSON.stringify(text)}`);
    return JSON.stringify(text);
  });
  await step("edit preserved the executable bit", async () => {
    const mode = modeOf(FILE);
    if (mode !== "755") throw new Error(`mode is ${mode}, expected 755`);
    return mode;
  });

  await step("writeText with the version guard (replaceIfVersion)", async () => {
    const outcome = await ctx.fs.writeText(target, "gamma\n", { kind: "replaceIfVersion", version });
    version = outcome.version;
    return `operation=${outcome.operation} version=${version}`;
  });
  await step("content after overwrite is the new text", async () => {
    const text = await ctx.fs.readText(target);
    if (text !== "gamma\n") throw new Error(`unexpected content ${JSON.stringify(text)}`);
    return JSON.stringify(text);
  });
  await step("overwrite preserved the executable bit", async () => {
    const mode = modeOf(FILE);
    if (mode !== "755") throw new Error(`mode is ${mode}, expected 755`);
    return mode;
  });

  await step("createIfAbsent on an existing file is still refused", async () => {
    try {
      await ctx.fs.writeText(target, "delta\n", { kind: "createIfAbsent" });
    } catch (error) {
      if (error?.code !== "FS_NOT_OBSERVED") throw new Error(`wrong code ${error?.code}: ${error?.message}`);
      return error.code;
    }
    throw new Error("the guarded create was accepted");
  });

  await step("a stale version is still refused", async () => {
    try {
      await ctx.fs.editText(target, { oldString: "gamma", newString: "delta" }, { kind: "replaceIfVersion", version: "stale" });
    } catch (error) {
      if (error?.code !== "FS_STALE_VERSION") throw new Error(`wrong code ${error?.code}: ${error?.message}`);
      return error.code;
    }
    throw new Error("the stale edit was accepted");
  });

  finish(lines);
}

/** Write the report and end the run; absence of the file is the failure signal. */
function finish(lines) {
  const failed = lines.filter((line) => line.startsWith("FAIL")).length;
  lines.push("", failed === 0 ? "RESULT: all steps passed" : `RESULT: ${failed} step(s) failed`);
  try {
    writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
  } catch {
    /* the missing report is itself the signal */
  }
  process.exit(0);
}
