/**
 * Tests for `scripts/preset-sync.mjs`: `preset-wsl` is the standard preset of
 * the line the dev pins name plus the changes the copy documents, and the
 * comparison sees every way a regenerated copy can drift.
 *
 * The first check is the gate (#82): the committed row against the committed
 * snapshot. The rest mutate a parsed copy, one drift at a time, so a comparison
 * that went blind would fail here rather than in a WSL session. The last one
 * mounts the bundled skill root's `!!js` expression through the real Loader:
 * that expression is upstream's and names `baseUrl`, so which base a row of
 * this bundle's gets is worth proving rather than assuming.
 *
 *   node test/preset-sync.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import Include from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { LINE_PEER, expectedSlots, parityDiffs, parsePatch, pinnedLine, presetOf, snapshotPath, valueDiffs } from "../scripts/preset-sync.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A parsed patch file. */
/** @typedef {ReturnType<typeof parsePatch>} Patch */

/** One plugin row as parsed data. */
/** @typedef {Record<string, unknown>} Row */

/**
 * Read one file of this package.
 * @param {string} file - the path under the package root.
 * @returns {string} its content.
 */
const read = (file) => readFileSync(join(ROOT, file), "utf8");

const line = pinnedLine(JSON.parse(read("package.json")));
const snapshot = snapshotPath(line);
const upstream = parsePatch(readFileSync(snapshot, "utf8"));
const shipped = presetOf(upstream, "preset-standard").plugins;

/**
 * One row inside a parsed file, by reference. `presetOf` hands back the rows
 * the patch algorithm composed, which are clones, so a case that mutates the
 * file reaches into the `insert` list that holds the row.
 * @param {Patch} patch - a parsed patch file.
 * @param {string} id - the row id.
 * @returns {Row} the row as the file holds it.
 */
const rowIn = (patch, id) => {
  for (const entry of patch) {
    for (const row of entry.insert ?? []) {
      if (row.id === id) return /** @type {Row} */ (/** @type {unknown} */ (row));
    }
  }
  return assert.fail(`no "- id: ${id}" row in the file`);
};

/**
 * The plugin rows a preset row holds, by reference.
 * @param {Patch} patch - a parsed patch file.
 * @param {string} id - the preset row's id.
 * @returns {Row[]} the preset's `config.plugins`.
 */
const pluginsIn = (patch, id) => /** @type {Row[]} */ (/** @type {Row} */ (rowIn(patch, id).config).plugins);

/**
 * A parsed copy of the committed `cordis.patch.yml`, free to mutate.
 * @returns {Patch} the parsed file.
 */
const freshCopy = () => parsePatch(read("cordis.patch.yml"));

/**
 * `preset-wsl`'s rows inside its `wsl-env` group, by reference.
 * @param {Patch} patch - a parsed `cordis.patch.yml`.
 * @returns {Row[]} the group's list.
 */
const realmRows = (patch) => {
  const realm = pluginsIn(patch, "preset-wsl")[0];
  assert.ok(realm !== undefined, "the preset mounts a realm group");
  assert.ok(Array.isArray(realm.config), "the realm group holds a list");
  return /** @type {Row[]} */ (/** @type {unknown[]} */ (realm.config));
};

/**
 * One row of a list, by id.
 * @param {Row[]} rows - the list.
 * @param {string} id - the row id.
 * @returns {Row} the row.
 */
const rowById = (rows, id) => {
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row !== undefined, `"${id}" is in the list`);
  return row;
};

/**
 * The rows a group row holds.
 * @param {Row} row - a group row.
 * @returns {Row[]} its list config.
 */
const groupRows = (row) => {
  assert.ok(Array.isArray(row.config), `"${String(row.id)}" is a group`);
  return /** @type {Row[]} */ (/** @type {unknown[]} */ (row.config));
};

/**
 * The rows of a group row of the copy's `wsl-env` list.
 * @param {Row[]} rows - the `wsl-env` list.
 * @param {string} id - the group row's id.
 * @returns {Row[]} the group's rows.
 */
const nestedOf = (rows, id) => groupRows(rowById(rows, id));

/**
 * Run the comparison on a mutated copy and return its differences.
 * @param {(patch: Patch) => void} mutate - the drift to apply.
 * @returns {string[]} what the comparison reports.
 */
const diffsOf = (mutate) => {
  const copy = freshCopy();
  mutate(copy);
  return parityDiffs({ upstream, actual: copy });
};

/**
 * Run the script in a child process.
 * @param {string[]} args - the arguments.
 * @returns {{ status: number | null, stdout: string, stderr: string }} the run.
 */
const script = (args) => spawnSync(process.execPath, ["scripts/preset-sync.mjs", ...args], { cwd: ROOT, encoding: "utf8" });

let passed = 0;
/**
 * Run one named check.
 * @param {string} name - the check name.
 * @param {() => void | Promise<void>} fn - the assertions.
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

await check("preset-wsl is the pinned line's standard preset plus the documented changes", () => {
  assert.deepEqual(parityDiffs({ upstream, actual: freshCopy() }), []);
});

await check("one snapshot exists, named after the line the dev pins name", () => {
  assert.equal(existsSync(snapshot), true, `${snapshot} exists`);
  const snapshots = readdirSync(dirname(snapshot)).filter((file) => /^standard\.patch\.dsh-.*\.yml$/u.test(file));
  assert.deepEqual(snapshots, [snapshot.slice(dirname(snapshot).length + 1)], "a snapshot of a superseded line must not linger");
  assert.throws(() => pinnedLine({ devDependencies: { [LINE_PEER]: "^0.2.2" } }), /must be an exact version/u);
  assert.throws(() => pinnedLine({ devDependencies: {} }), /must be an exact version/u);
});

await check("the row's own comment names the pinned line and the check", () => {
  const text = read("cordis.patch.yml");
  assert.ok(text.includes(`\`dsh-v${line}\``), "the comment says which source tree the copy was generated from");
  assert.ok(text.includes("scripts/preset-sync.mjs"), "the comment names the parity check");
});

await check("the plugin's own rows sit where the copy says", () => {
  const rows = realmRows(freshCopy());
  const ids = rows.map((row) => String(row.id));
  const wanted = expectedSlots(shipped, true).map((slot) => slot.id);
  assert.deepEqual(ids, wanted, "the copy's row order is the shipped order with the own rows in place");
  const own = ["wsl-shell", "wsl-fs", "wsl-doctor-tool"];
  assert.deepEqual(ids.filter((id) => own.includes(id)), own);
  assert.equal(ids.indexOf("wsl-doctor-tool"), ids.indexOf("tool-jobs") + 1, "the doctor tool follows the jobs tool");
  for (const id of own) assert.match(String(rowById(rows, id).name), /^dsh-plugin-wsl-env\//u);
});

await check("the shell-tool choice is the copy's, not the platform expression", () => {
  const rows = realmRows(freshCopy());
  assert.equal(typeof rowById(shipped, "tool-bash").disabled, "object", "the shipped copy derives the choice from an expression");
  assert.equal(rowById(rows, "tool-bash").disabled, false);
  assert.equal(rowById(rows, "tool-pwsh").disabled, true);
  const diffs = diffsOf((copy) => {
    rowById(realmRows(copy), "tool-bash").disabled = true;
  });
  assert.deepEqual(diffs, ["wsl-env.tool-bash.disabled: upstream has false, preset-wsl has true"]);
});

await check("a missing upstream row is reported by id and neighbour", () => {
  const diffs = diffsOf((copy) => {
    const rows = realmRows(copy);
    rows.splice(rows.findIndex((row) => row.id === "tool-office"), 1);
  });
  assert.deepEqual(diffs, ["wsl-env: \"tool-office\" is missing (an upstream row, after \"present\")"]);
});

await check("a row upstream adds is demanded wherever it lands", () => {
  // The shape of the rc.2 change: a new row in the middle of the list.
  const moved = parsePatch(readFileSync(snapshot, "utf8"));
  const plugins = pluginsIn(moved, "preset-standard");
  plugins.splice(plugins.findIndex((row) => row.id === "present"), 0, { id: "tool-newcomer", name: "@deepseek-ai/dsh-tool-newcomer" });
  const diffs = parityDiffs({ upstream: moved, actual: freshCopy() });
  assert.deepEqual(diffs, ["wsl-env: \"tool-newcomer\" is missing (an upstream row, after \"tool-web\")"]);
});

await check("a changed config is reported under its path", () => {
  const diffs = diffsOf((copy) => {
    /** @type {Row} */ (rowById(nestedOf(realmRows(copy), "delegation"), "tool-subagent-control").config).interrupt = true;
  });
  assert.deepEqual(diffs, ["wsl-env.delegation.config.tool-subagent-control.config.interrupt: upstream has false, preset-wsl has true"]);
});

await check("a config upstream drops is reported too", () => {
  const diffs = diffsOf((copy) => {
    delete rowById(nestedOf(realmRows(copy), "delegation"), "tool-subagent-control").config;
  });
  assert.deepEqual(diffs, ["wsl-env.delegation.config.tool-subagent-control.config: upstream has {\"interrupt\":false}, preset-wsl has (absent)"]);
});

await check("a rewritten !!js expression is a difference, by its text", () => {
  const diffs = diffsOf((copy) => {
    const config = /** @type {Row} */ (rowById(realmRows(copy), "skill-filesystem").config);
    /** @type {Row[]} */ (config.customSkillDirs).splice(0, 1, { __jsExpr: "'/elsewhere/skills'" });
  });
  assert.equal(diffs.length, 1, "only the expression differs");
  assert.match(diffs[0] ?? "", /^wsl-env\.skill-filesystem\.config\.customSkillDirs\[0\]: upstream has "!!js process\.getBuiltinModule/u);
  assert.match(diffs[0] ?? "", /preset-wsl has "!!js '\/elsewhere\/skills'"$/u);
});

await check("a moved row is an order difference", () => {
  const diffs = diffsOf((copy) => {
    const rows = realmRows(copy);
    const [office] = rows.splice(rows.findIndex((row) => row.id === "tool-office"), 1);
    rows.splice(rows.findIndex((row) => row.id === "present"), 0, /** @type {Row} */ (office));
  });
  assert.deepEqual(diffs, ["wsl-env: row order differs at \"tool-office\": upstream has \"present\" there"]);
});

await check("a row the copy does not document is reported", () => {
  const diffs = diffsOf((copy) => {
    realmRows(copy).push({ id: "mystery", name: "@deepseek-ai/dsh-tool-mystery" });
  });
  assert.deepEqual(diffs, ["wsl-env: \"mystery\" is neither an upstream row nor one of the plugin's own"]);
});

await check("nested groups are compared row by row", () => {
  const diffs = diffsOf((copy) => {
    const nested = nestedOf(realmRows(copy), "delegation");
    nested.splice(nested.findIndex((row) => row.id === "tool-subagent-fork"), 1);
  });
  assert.deepEqual(diffs, ["wsl-env.delegation.config: \"tool-subagent-fork\" is missing (an upstream row, after \"tool-subagent\")"]);
});

await check("the plan-mode section text is upstream's, byte for byte", () => {
  const diffs = diffsOf((copy) => {
    /** @type {Row} */ (rowById(nestedOf(realmRows(copy), "planning"), "plan-mode").config).section = "You are in plan mode. (edited)";
  });
  assert.equal(diffs.length, 1);
  assert.match(diffs[0] ?? "", /^wsl-env\.planning\.config\.plan-mode\.config\.section: upstream has "You are in plan mode\. Stay/u);
});

await check("a missing or renamed own row is reported", () => {
  const missing = diffsOf((copy) => {
    const rows = realmRows(copy);
    rows.splice(rows.findIndex((row) => row.id === "wsl-doctor-tool"), 1);
  });
  assert.deepEqual(missing, ["wsl-env: \"wsl-doctor-tool\" is missing (the plugin's own row, after \"tool-jobs\")"]);
  const renamed = diffsOf((copy) => {
    rowById(realmRows(copy), "wsl-fs").name = "@deepseek-ai/dsh-fs-local";
  });
  assert.deepEqual(renamed, ["wsl-env.wsl-fs.name: the plugin's own row is \"dsh-plugin-wsl-env/fs\", not \"@deepseek-ai/dsh-fs-local\""]);
});

await check("the identity and the realm are checked, not compared", () => {
  const identity = diffsOf((copy) => {
    /** @type {Row} */ (rowIn(copy, "preset-wsl").config).id = "standard";
  });
  assert.deepEqual(identity, ["preset-wsl.config.id: must be \"wsl\", not \"standard\""]);
  const blank = diffsOf((copy) => {
    /** @type {Row} */ (rowIn(copy, "preset-wsl").config).description = "  ";
  });
  assert.deepEqual(blank, ["preset-wsl.config.description: the mode selector needs a non-empty string"]);
  const realm = diffsOf((copy) => {
    /** @type {Row} */ (pluginsIn(copy, "preset-wsl")[0]?.isolate).fs = false;
  });
  assert.deepEqual(realm, ["preset-wsl.config.plugins.wsl-env.isolate: must isolate shell and fs, not {\"shell\":true,\"fs\":false}"]);
  const ungrouped = diffsOf((copy) => {
    pluginsIn(copy, "preset-wsl").push({ id: "stray", name: "@deepseek-ai/dsh-tool-stray" });
  });
  assert.deepEqual(ungrouped, ["preset-wsl.config.plugins: must hold exactly one row, the \"wsl-env\" group every row mounts inside"]);
});

await check("valueDiffs reports an extra key and a shorter list under their paths", () => {
  assert.deepEqual(valueDiffs("a", { x: 1, list: [1, 2] }, { x: 1, list: [1, 2], y: 3 }), ["a.y: not upstream's (preset-wsl has 3)"]);
  assert.deepEqual(valueDiffs("a", { x: 1, list: [1, 2] }, { x: 1, list: [1] }), ["a.list: upstream has [1,2], preset-wsl has [1]"]);
  assert.deepEqual(valueDiffs("a", { x: 1, list: [1, 2] }, { x: 1, list: [1, 3] }), ["a.list[1]: upstream has 2, preset-wsl has 3"]);
  assert.deepEqual(valueDiffs("a", { x: { __jsExpr: "1" } }, { x: { __jsExpr: "2" } }), ["a.x: upstream has \"!!js 1\", preset-wsl has \"!!js 2\""]);
  assert.deepEqual(valueDiffs("a", { x: 1 }, { x: { __jsExpr: "1" } }), ["a.x: upstream has 1, preset-wsl has \"!!js 1\""]);
  assert.deepEqual(valueDiffs("a", { x: 1 }, { x: 1, y: { z: 2 } }), ["a.y: not upstream's (preset-wsl has {\"z\":2})"]);
});

await check("the script passes the committed files and reports a drifted upstream file", () => {
  const ok = script([]);
  assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
  assert.ok(ok.stdout.startsWith(`ok: preset-wsl is the standard preset of dsh-${line} plus the documented changes`), ok.stdout);

  const scratch = mkdtempSync(join(tmpdir(), "dsh-preset-sync-"));
  try {
    const drifted = join(scratch, "standard.patch.yml");
    // The rc.1 preset: one office tool short of what the copy holds.
    writeFileSync(drifted, readFileSync(snapshot, "utf8").replace(/ {10}- id: tool-office\n {12}name: '@deepseek-ai\/dsh-tool-office'\n/u, ""));
    const failed = script(["--upstream", drifted]);
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /preset-wsl differs from the standard preset of standard\.patch\.yml \(1\):/u);
    assert.match(failed.stdout, /"tool-office" is neither an upstream row nor one of the plugin's own/u);

    const json = script(["--upstream", drifted, "--json"]);
    assert.equal(json.status, 1);
    const report = /** @type {{ upstream: string, differences: string[] }} */ (JSON.parse(json.stdout));
    assert.equal(report.upstream, "standard.patch.yml");
    assert.equal(report.differences.length, 1);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  assert.equal(script(["--nope"]).status, 2, "a usage error is not a parity failure");
  assert.equal(script(["--upstream"]).status, 2);
  assert.equal(script(["--upstream", join(ROOT, "no-such-preset.yml")]).status, 1, "an unreadable file fails the run");
});

await check("the bundled skill root resolves from the root Include's base, wherever the bundle lives", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "dsh-preset-sync-base-"));
  /** @type {unknown[]} */
  const seen = [];
  const context = new Context();
  try {
    // An installation beside its root config, and the bundle in a sibling
    // tree with no `node_modules` of its own: a `baseUrl` inside the bundle
    // could not reach the installation from there.
    const app = join(scratch, "app");
    const skills = join(app, "node_modules", "@deepseek-ai", "dsh-agent-preset");
    mkdirSync(join(skills, "skills"), { recursive: true });
    writeFileSync(join(skills, "package.json"), `${JSON.stringify({ name: "@deepseek-ai/dsh-agent-preset" })}\n`);
    const configPath = join(app, "cordis.yml");
    writeFileSync(configPath, "[]\n");
    const bundle = join(scratch, "home", "profiles", "p", "node_modules", "dsh-plugin-wsl-env");
    mkdirSync(bundle, { recursive: true });
    const patch = read("cordis.patch.yml");
    writeFileSync(join(bundle, "cordis.patch.yml"), patch);

    // The shipped row verbatim, under a name the Loader resolves to a probe.
    const row = rowById(realmRows(parsePatch(patch)), "skill-filesystem");
    context.baseUrl = pathToFileURL(bundle).href + "/";
    await context.plugin(Loader);
    context.loader.builtins.include = Include;
    // The loader's own module seam, reduced to the one name this check mounts.
    context.loader.internal = /** @type {NonNullable<Loader["internal"]>} */ (/** @type {unknown} */ ({
      version: "v2",
      import: async (/** @type {string} */ specifier) => {
        if (specifier === "skill-probe") return { name: "skill-probe", apply: (/** @type {unknown} */ _ctx, /** @type {unknown} */ config) => { seen.push(config); } };
        throw new Error(`unexpected Loader import: ${specifier}`);
      },
    }));
    await context.loader.create({ name: "cordis:include", config: { path: pathToFileURL(configPath).href, patches: [{ insert: [{ ...structuredClone(row), name: "skill-probe" }] }] } });
    await context.loader.await();
    assert.deepEqual(seen, [{ customSkillDirs: [join(skills, "skills")] }]);
  } finally {
    await context.fiber.dispose?.();
    rmSync(scratch, { recursive: true, force: true });
  }
});

console.log(`\n${passed}/19 preset-sync checks pass`);
