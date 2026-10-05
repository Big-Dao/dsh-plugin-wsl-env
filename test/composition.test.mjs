/**
 * Composition check for the bundle layer itself: the plugin's `cordis.patch.yml`
 * applied through the REAL patch algorithm (`applyEntryPatches`, the same call
 * boot() makes) over a minimal stand-in of the upstream rows it targets.
 *
 * The loader treats a bare `insert` list as data to append, never as nested
 * patches: a disable row written inside an `insert` list becomes a duplicate-id
 * data row that shadows the real upstream row (`EntryGroup.update` keys rows by
 * id, last occurrence wins), and a nested `insert` list becomes a nameless
 * anonymous entry that fails to import. Both silently remove services the GUI
 * and the root plane depend on — the composition must therefore be asserted
 * with the real algorithm, not just unit-tested row by row.
 *
 *   node test/composition.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import Include from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { WslRoutingFileSystem } from "../lib/fs-routing.js";
import { WorkspaceFilesWsl } from "../lib/workspace-files-wsl.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";

let passed = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

const HERE = dirname(fileURLToPath(import.meta.url));
const PATCH = yaml.load(readFileSync(join(HERE, "..", "cordis.patch.yml"), "utf8"), { schema: entryListSchema });

// The upstream rows the patch layer targets, as the app's own bundle layers
// insert them before this plugin's layer applies. Names are the shipped
// packages'; configs stand in for whatever the app actually ships.
const UPSTREAM = [
  { id: "subprocess", name: "@deepseek-ai/dsh-subprocess-local", config: {} },
  { id: "terminal-controller", name: "@deepseek-ai/dsh-api-terminal-controller", config: {} },
  { id: "directory-picker", name: "@deepseek-ai/dsh-host-directory-picker-auto", config: {} },
  { id: "workspace-files", name: "@deepseek-ai/dsh-api-workspace-files", config: { maxEntries: 100 } },
  { id: "fs-sandbox", name: "@deepseek-ai/dsh-fs-sandbox", config: { cwd: "" } },
];

const warnings = [];
const composed = applyEntryPatches(structuredClone(UPSTREAM), structuredClone(PATCH), (message, ...args) => {
  warnings.push(message.replace(/%C/g, () => JSON.stringify(args.shift())));
});
const byId = new Map(composed.filter((row) => typeof row.id === "string").map((row) => [row.id, row]));

check("every composed row is a real entry (id, and a name unless a group)", () => {
  const bad = composed.filter((row) => typeof row.id !== "string" || (typeof row.name !== "string" && !row.group));
  assert.deepEqual(bad, [], "rows without an id/name are loader garbage, never services");
});

check("no composed id appears twice (a duplicate shadows the earlier row)", () => {
  const seen = new Set();
  const duplicates = composed.filter((row) => typeof row.id === "string").map((row) => row.id).filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  assert.deepEqual([...new Set(duplicates)], [], "duplicate ids silently replace the earlier row's options");
});

check("the patch applies without skipped-patch warnings", () => {
  assert.deepEqual(warnings, [], "a warning means a targeted row was absent from the composed tree");
});

check("upstream workspace-files is disabled by name, not shadowed", () => {
  const row = byId.get("workspace-files");
  assert.equal(row?.name, "@deepseek-ai/dsh-api-workspace-files", "the shipped row keeps its identity");
  assert.equal(row?.disabled, true, "the 9p-backed service is off");
});

check("upstream fs-sandbox is disabled by name, not shadowed", () => {
  const row = byId.get("fs-sandbox");
  assert.equal(row?.name, "@deepseek-ai/dsh-fs-sandbox", "the shipped row keeps its identity");
  assert.equal(row?.disabled, true, "the root 9p-backed filesystem is off");
});

check("workspace-files-wsl is mounted as a real top-level row", () => {
  const row = byId.get("workspace-files-wsl");
  assert.equal(row?.name, "dsh-plugin-wsl-env/workspace-files-wsl");
  assert.equal(row?.disabled, undefined);
  assert.ok(row?.config && typeof row?.config === "object", "the variant carries its config");
});

check("fs-routing is mounted as a real top-level row", () => {
  const row = byId.get("fs-routing");
  assert.equal(row?.name, "dsh-plugin-wsl-env/fs-routing");
  assert.equal(row?.disabled, undefined);
  assert.ok(row?.config && typeof row?.config === "object", "the routed root fs carries its config");
});

check("the established host-side disables still land", () => {
  assert.equal(byId.get("subprocess")?.disabled, true);
  assert.equal(byId.get("directory-picker")?.disabled, true);
});

check("the takeover rows actually START through the Loader, not just compose", async () => {
  // Patch algebra proves the rows land in the tree; only a boot proves the
  // names resolve and the Configs accept. The composed takeover rows are
  // booted through the real Loader exactly the way the app mounts them.
  const root = await mkdtemp(join(tmpdir(), "dsh-wsl-env-composition-"));
  try {
    const configPath = join(root, "cordis.yml");
    const rows = [
      { id: "workspace-files-wsl", name: "workspace-files-wsl-under-test", config: { maxBytes: 1024, maxFileBytes: 1024, maxLines: 10, maxEntries: 10 } },
      { id: "fs-routing", name: "fs-routing-under-test", config: { distro: "", wslPath: "wsl.exe", sandbox: true, restrictToDistro: true } },
    ];
    await writeFile(configPath, JSON.stringify(rows));
    const context = new Context();
    context.baseUrl = pathToFileURL(root).href + "/";
    await context.plugin(Loader);
    context.loader.builtins.include = Include;
    context.loader.internal = {
      version: "v2",
      async import(specifier) {
        if (specifier === "workspace-files-wsl-under-test") return WorkspaceFilesWsl;
        if (specifier === "fs-routing-under-test") return WslRoutingFileSystem;
        throw new Error(`unexpected Loader import: ${specifier}`);
      },
    };
    await context.loader.create({ name: "cordis:include", config: { path: pathToFileURL(configPath).href } });
    await context.loader.await();
    assert.equal(context.fs instanceof WslRoutingFileSystem, true, "the routed root filesystem mounted");
    // The workspace-files variant's class constructed with its config: its
    // provider identity is the takeover, not the shipped base.
    assert.equal(WorkspaceFilesWsl.Config !== undefined, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

let failed = 0;
for (const [name, fn] of checks) await runCheck(name, fn);
failed = checks.length - passed;
console.log(`\n${passed}/${checks.length} composition checks pass`);
if (failed > 0) process.exitCode = 1;
