/**
 * Assertion checks for the doctor skill installer.
 *
 * What matters: the skill lands in the harness's discovery path, the write is
 * idempotent (no churn on restart, a user edit survives until the shipped text
 * changes), and every failure is advisory — an unwritable home degrades to a
 * debug line and never fails the load.
 *
 *   node test/doctor-skill.test.mjs
 */
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, skillText, SKILL_DIR } from "../lib/doctor-skill.js";

const savedHome = process.env.DSH_HOME;
const dir = await mkdtemp(join(tmpdir(), "dsh-doctor-skill-"));
/**
 * A stand-in context whose logger records debug lines.
 * @returns {{ ctx: {logger: {debug: (m: string) => void}}, debugs: string[] }} the stand-in and its captured lines.
 */
const fakeCtx = () => {
  /** @type {string[]} */
  const debugs = [];
  return { ctx: { logger: { debug: (m) => debugs.push(m) } }, debugs };
};

let passed = 0;
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

try {
  await check("a fresh home installs the skill at skills/wsl-doctor/SKILL.md", async () => {
    const home = join(dir, "home-1");
    process.env.DSH_HOME = home;
    const f = fakeCtx();
    await apply(f.ctx);
    const file = join(home, "skills", SKILL_DIR, "SKILL.md");
    assert.equal(await readFile(file, "utf8"), skillText(), "the installed text is the shipped text");
    assert.equal(f.debugs.some((d) => d.includes("installed")), true, "the install is observable at debug level");
  });

  await check("the skill is user-only: disable-model-invocation is set", () => {
    assert.match(skillText(), /disable-model-invocation: true/, "the model cannot fire it on its own");
    assert.match(skillText(), /^name: wsl-doctor$/m, "the discovery name is wsl-doctor");
  });

  await check("a second mount does not rewrite an identical file", async () => {
    const home = join(dir, "home-2");
    process.env.DSH_HOME = home;
    const file = join(home, "skills", SKILL_DIR, "SKILL.md");
    const f1 = fakeCtx();
    await apply(f1.ctx);
    const { mtimeMs } = await import("node:fs/promises").then((fs) => fs.stat(file));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const f2 = fakeCtx();
    await apply(f2.ctx);
    const after = await import("node:fs/promises").then((fs) => fs.stat(file));
    assert.equal(after.mtimeMs, mtimeMs, "an identical shipped text never churns the file");
    assert.equal(f2.debugs.some((d) => d.includes("already installed")), true, "the skip is observable");
  });

  await check("a changed shipped text replaces a user-modified file", async () => {
    const home = join(dir, "home-3");
    process.env.DSH_HOME = home;
    const file = join(home, "skills", SKILL_DIR, "SKILL.md");
    const f1 = fakeCtx();
    await apply(f1.ctx);
    await writeFile(file, "stale");
    const f2 = fakeCtx();
    await apply(f2.ctx);
    assert.equal(await readFile(file, "utf8"), skillText(), "content-addressed: different shipped text wins");
    assert.equal(f2.debugs.some((d) => d.includes("installed")), true, "the replace is observable");
  });

  await check("DSH_HOME unset falls back to ~/.dsh", async () => {
    delete process.env.DSH_HOME;
    const home = join(dir, "fallback-home");
    const savedHomeDir = process.env.HOME ?? process.env.USERPROFILE;
    if (process.platform === "win32") process.env.USERPROFILE = home;else process.env.HOME = home;
    try {
      const f = fakeCtx();
      await apply(f.ctx);
      assert.equal(await readFile(join(home, ".dsh", "skills", SKILL_DIR, "SKILL.md"), "utf8"), skillText());
    } finally {
      if (process.platform === "win32") process.env.USERPROFILE = savedHomeDir;else process.env.HOME = savedHomeDir;
    }
  });

  await check("an unwritable home degrades to debug, never throws", async () => {
    const home = join(dir, "home-ro");
    await mkdir(home, { recursive: true });
    await chmod(home, 0o500);
    process.env.DSH_HOME = home;
    try {
      const f = fakeCtx();
      await apply(f.ctx);
      assert.equal(f.debugs.some((d) => d.includes("could not install")), true, "the failure is observable at debug level");
    } finally {
      await chmod(home, 0o700);
    }
  });
} finally {
  if (savedHome === undefined) delete process.env.DSH_HOME;else process.env.DSH_HOME = savedHome;
  await rm(dir, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed`);
