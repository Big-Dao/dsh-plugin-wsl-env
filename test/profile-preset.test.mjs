/**
 * Tests for `scripts/profile-preset.mjs` — the `preset-wsl` override helper.
 *
 *   node test/profile-preset.test.mjs
 *
 * The generated block is compared against the shipped row, and the CLI is
 * exercised as a subprocess so the write/refuse paths are covered too.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, nestedRowIds, presetBlock } from "../scripts/profile-preset.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(ROOT, "cordis.patch.yml"), "utf8");

/**
 * Run the helper in a child process.
 * @param {string[]} args - the arguments.
 * @returns {{ status: number | null, stdout: string, stderr: string }} the run.
 */
const helper = (args) => spawnSync(process.execPath, ["scripts/profile-preset.mjs", ...args], { cwd: ROOT, encoding: "utf8" });

/**
 * The section of a block between two nested row ids.
 * @param {string} block - the preset block.
 * @param {string} id - the row id.
 * @param {string} next - the next row id.
 * @returns {string} that slice.
 */
const section = (block, id, next) => {
  const text = block.slice(block.indexOf(`- id: ${id}`));
  return text.slice(0, text.indexOf(`- id: ${next}`));
};

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

const scratch = mkdtempSync(join(tmpdir(), "dsh-preset-"));
try {
  check("the printed block is the shipped row, dedented and complete", () => {
    const block = presetBlock(source);
    assert.ok(block.startsWith("- id: preset-wsl"));
    assert.equal(`${block}\n`, source.slice(source.indexOf("    - id: preset-wsl")).replace(/^ {4}/gm, ""));
    for (const id of ["wsl-env", "wsl-shell", "wsl-fs", "persona"]) assert.ok(block.includes(`- id: ${id}`), `missing ${id}`);
  });

  check("the edits land in both nested rows with the shipped indentation", () => {
    const block = applyEdits(presetBlock(source), { distro: "Debian", sessionSandbox: false, sandbox: false, maskWindowsDrive: true, agentBackend: "native" });
    const shell = section(block, "wsl-shell", "wsl-fs");
    const fs = section(block, "wsl-fs", "persona");
    assert.match(shell, /^ {14}distro: Debian$/m);
    assert.match(fs, /^ {14}distro: Debian$/m);
    assert.match(shell, /^ {14}sessionSandbox: false$/m);
    assert.match(fs, /^ {14}sessionSandbox: false$/m);
    assert.match(shell, /^ {14}sandbox: false$/m);
    assert.match(fs, /^ {14}sandbox: false$/m);
    assert.match(shell, /^ {14}maskWindowsDrive: true$/m);
    assert.match(fs, /^ {14}maskWindowsDrive: true$/m);
    assert.match(shell, /^ {14}agentBackend: native$/m);
    assert.doesNotMatch(fs, /agentBackend:/);
  });

  check("--session-sandbox auto writes the auto mode into both rows", () => {
  const block = applyEdits(presetBlock(source), { sessionSandbox: "auto" });
  const shell = section(block, "wsl-shell", "wsl-fs");
  const fs = section(block, "wsl-fs", "persona");
  assert.match(shell, /^ {14}sessionSandbox: auto$/m);
  assert.match(fs, /^ {14}sessionSandbox: auto$/m);
});

check("only the requested keys change", () => {
    const before = presetBlock(source);
    const after = applyEdits(before, { distro: "Debian" });
    const changed = before.split("\n").map((line, index) => [line, after.split("\n")[index]]).filter(([a, b]) => a !== b);
    assert.equal(changed.length, 2, "the two distro lines are the only difference");
    assert.ok(changed.every(([, b]) => b === "              distro: Debian"));
  });

  check("nestedRowIds catches a top-level id patch and ignores the full block", () => {
    assert.deepEqual(nestedRowIds("- id: wsl-shell\n  config:\n    distro: Ubuntu\n"), ["wsl-shell"]);
    assert.deepEqual(nestedRowIds("  - id: wsl-fs\n    config: {}\n"), ["wsl-fs"]);
    assert.deepEqual(nestedRowIds(presetBlock(source)), []);
  });

  check("--check fails on a nested patch and prints the block to paste", () => {
    const bad = join(scratch, "bad.yml");
    writeFileSync(bad, "- id: wsl-shell\n  config:\n    distro: Ubuntu\n");
    const run = helper(["--check", bad, "--distro", "Debian"]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /patches "wsl-shell" by id/);
    assert.match(run.stderr, /^ {2}config:$/m);
    assert.match(run.stderr, /distro: Debian/);
  });

  check("--out writes a patch that --check accepts", () => {
    const out = join(scratch, "profiles", "wsl", "cordis.patch.yml");
    const write = helper(["--out", out, "--distro", "Debian"]);
    assert.equal(write.status, 0, write.stderr);
    assert.match(readFileSync(out, "utf8"), /^- id: preset-wsl$/m);
    assert.equal(helper(["--check", out]).status, 0);
  });

  check("--out refuses to replace a patch with other overrides", () => {
    const other = join(scratch, "other.yml");
    writeFileSync(other, "- id: some-other-row\n  config: {}\n");
    const run = helper(["--out", other]);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /refusing to replace its other overrides/);
    assert.equal(readFileSync(other, "utf8"), "- id: some-other-row\n  config: {}\n");
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`${passed}/8 profile-preset checks pass`);
