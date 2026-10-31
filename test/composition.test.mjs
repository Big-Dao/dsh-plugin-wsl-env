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
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Context, symbols } from "@deepseek-ai/cordis";
import Include from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { WslRoutingFileSystem } from "../lib/fs-routing.js";
import { WslFileSystem } from "../lib/index.js";
import { FsTargetKey } from "@deepseek-ai/dsh-fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { applyEntryPatches, entryListSchema } from "@deepseek-ai/cordis-plugin-include";

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through `runCheck`.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

/**
 * Unwraps the traceable proxies cordis puts around service values, so identity
 * can be compared after a value crosses `ctx.<service>`.
 * @param {unknown} value - a value read through a context or service proxy.
 * @returns {unknown} the innermost value, no longer proxied.
 */
const rawService = (value) => {
  /** @type {unknown} */
  let current = value;
  for (;;) {
    const inner = /** @type {Record<PropertyKey, unknown> | undefined} */ (current)?.[symbols.original];
    if (inner === undefined || inner === current) return current;
    current = inner;
  }
};

/**
 * Views a scripted static import map as the loader's module-loader seam. The
 * loader only calls `import()` on this path; the real `ModuleLoader` carries
 * Node's internal cache and hook surface.
 * @param {Loader} loader - the mounted loader service.
 * @param {(specifier: string) => Promise<unknown>} importModule - the map.
 */
const stubLoaderInternal = (loader, importModule) => {
  loader.internal = /** @type {NonNullable<Loader["internal"]>} */ (/** @type {unknown} */ ({ version: "v2", import: importModule }));
};

const HERE = dirname(fileURLToPath(import.meta.url));
const PATCH = /** @type {NonNullable<Parameters<typeof applyEntryPatches>[1]>} */ (yaml.load(readFileSync(join(HERE, "..", "cordis.patch.yml"), "utf8"), { schema: entryListSchema }));

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

/** @type {string[]} */
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

check("upstream workspace-files stays enabled for its client file provider", () => {
  const row = byId.get("workspace-files");
  assert.equal(row?.name, "@deepseek-ai/dsh-api-workspace-files", "the shipped row keeps its identity");
  assert.equal(row?.disabled, undefined, "the shipped service and its browser file provider stay mounted");
});

check("upstream fs-sandbox is disabled by name, not shadowed", () => {
  const row = byId.get("fs-sandbox");
  assert.equal(row?.name, "@deepseek-ai/dsh-fs-sandbox", "the shipped row keeps its identity");
  assert.equal(row?.disabled, true, "the root 9p-backed filesystem is off");
});

check("fs-routing is mounted as a real top-level row", () => {
  const row = byId.get("fs-routing");
  assert.equal(row?.name, "dsh-plugin-wsl-env/fs-routing");
  assert.equal(row?.disabled, undefined);
  assert.ok(row?.config && typeof row?.config === "object", "the routed root fs carries its config");
});

check("wsl-preflight is mounted as a real top-level row", () => {
  const row = byId.get("wsl-preflight");
  assert.equal(row?.name, "dsh-plugin-wsl-env/preflight");
  assert.equal(row?.disabled, undefined);
});

check("the established host-side disables still land", () => {
  assert.equal(byId.get("subprocess")?.disabled, true);
  assert.equal(byId.get("directory-picker")?.disabled, true);
});

check("the routing probe's overlay disables the profile's fs row and inserts the router", () => {
  const profile = /** @type {NonNullable<Parameters<typeof applyEntryPatches>[1]>} */ (yaml.load(readFileSync(join(HERE, "probe", "wslfs-profile.patch.yml"), "utf8"), { schema: entryListSchema }));
  const template = readFileSync(join(HERE, "probe", "fs-routing-probe.yml"), "utf8");
  const overlay = /** @type {NonNullable<Parameters<typeof applyEntryPatches>[1]>} */ (yaml.load(template
    .replaceAll("@DISTRO@", "ubuntu")
    .replaceAll("@DISTRO_PATH@", "\\\\wsl.localhost\\ubuntu\\home\\you\\.dsh-routing-probe.txt")
    .replaceAll("@DISTRO_LINUX@", "/home/you/.dsh-routing-probe.txt")
    .replaceAll("@DISTRO_TEXT@", "distro-plane-routing-probe")
    .replaceAll("@HOST_PATH@", "C:\\Users\\you\\.dsh-routing-probe.txt")
    .replaceAll("@HOST_TEXT@", "host-plane-routing-probe")
    .replaceAll("@PROBE_UNC@", "\\\\wsl.localhost\\ubuntu\\repo\\test\\probe\\fs-routing-probe.mjs")
    .replaceAll("@REPORT_UNC@", "\\\\wsl.localhost\\ubuntu\\repo\\test\\probe\\fs-routing-report.txt"), { schema: entryListSchema }));
  /** @type {string[]} */
  const localWarnings = [];
  /**
   * Collect the loader's patch warnings.
   * @param {string} message - the warning template.
   * @param {...unknown} args - the `%C` substitutions.
   */
  const warn = (message, ...args) => {
    localWarnings.push(message.replace(/%C/g, () => JSON.stringify(args.shift())));
  };
  const profiled = applyEntryPatches(structuredClone(UPSTREAM), structuredClone(profile), warn);
  const routed = applyEntryPatches(profiled, overlay, warn);
  const index = new Map(routed.filter((row) => typeof row.id === "string").map((row) => [row.id, row]));
  assert.deepEqual(localWarnings, [], "both layers target rows that exist when they apply");
  assert.equal(index.get("wsl-fs")?.disabled, true, "the profile's distro fs row is off for this probe");
  assert.equal(index.get("fs-routing")?.name, "dsh-plugin-wsl-env/fs-routing");
  assert.equal(index.get("fs-routing")?.config?.distro, "ubuntu", "the probe pins the router so the cross-distro fence is observable");
  assert.equal(index.get("fs-routing")?.config?.restrictToDistro, true);
  assert.equal(index.get("fs-routing-probe")?.name, "\\\\wsl.localhost\\ubuntu\\repo\\test\\probe\\fs-routing-probe.mjs", "the probe module itself is mounted");
});

check("the routed root filesystem actually starts through the Loader, not just composes", async () => {
  // Patch algebra proves the row lands in the tree; only a boot proves the
  // name resolves and the Config accepts. The composed row is booted through
  // the real Loader exactly the way the app mounts it.
  const root = await mkdtemp(join(tmpdir(), "dsh-wsl-env-composition-"));
  try {
    const configPath = join(root, "cordis.yml");
    const rows = [
      { id: "fs-routing", name: "fs-routing-under-test", config: { distro: "", wslPath: "wsl.exe", sandbox: true, restrictToDistro: true } },
    ];
    await writeFile(configPath, JSON.stringify(rows));
    const context = new Context();
    context.baseUrl = pathToFileURL(root).href + "/";
    // The routed backend is a real WslFileSystem: its constructor reads the
    // deployment default mode from `sandboxPolicy`. In the app that service is
    // provided by a SIBLING row, not an ancestor, so the router must declare
    // the dependency; providing it from a plugin fiber here keeps that real
    // (a root-level `provide` would resolve even without `inject`).
    await context.plugin({
      name: "sandbox-policy-stub",
      apply(/** @type {Context} */ pluginCtx) {
        pluginCtx.provide("sandboxPolicy", { defaultMode: "workspace-write", resolve: () => ({ mode: "workspace-write", workspaceRoot: "/" }) });
      },
    });
    await context.plugin(Loader);
    context.loader.builtins.include = Include;
    stubLoaderInternal(context.loader, async (specifier) => {
      if (specifier === "fs-routing-under-test") return WslRoutingFileSystem;
      throw new Error(`unexpected Loader import: ${specifier}`);
    });
    await context.loader.create({ name: "cordis:include", config: { path: pathToFileURL(configPath).href } });
    await context.loader.await();
    assert.equal(context.fs instanceof WslRoutingFileSystem, true, "the routed root filesystem mounted");
    // The root-plane consumer path: cordis hands `ctx.fs` callers a traceable
    // proxy and invokes methods with a shadow receiver. Private (`#`) state and
    // a backend that re-registers `fs` in this router's own scope fail on
    // exactly that path, while direct-instance calls pass.
    const router = /** @type {WslRoutingFileSystem} */ (/** @type {unknown} */ (context.fs));
    const backend = rawService(router.distro());
    assert.equal(backend instanceof WslFileSystem, true, "the distro backend is a WslFileSystem");
    assert.equal(rawService(router.distro()), backend, "the backend is built once and cached");
    assert.equal(context.fs instanceof WslRoutingFileSystem, true, "the backend's registration did not replace the router");
    // The routing table, both sides. The distro side is stubbed at the backend
    // surface (this suite owns no distro); the host side runs the real
    // LocalFileSystem over the temp workspace this check already owns.
    const distroTarget = (/** @type {string} */ linuxPath) => ({
      targetKey: FsTargetKey(`\\\\wsl.localhost\\Ubuntu${linuxPath.replaceAll("/", "\\")}`),
      displayPath: linuxPath,
    });
    const target = distroTarget("/home/andy/sample.txt");
    const directory = distroTarget("/home/andy");
    /** @type {Record<string, unknown>} */
    const surface = /** @type {Record<string, unknown>} */ (backend);
    surface.resolve = async (/** @type {string} */ path) => ({ targetKey: FsTargetKey(path), displayPath: path });
    surface.lstat = async (/** @type {string} */ path) => ({ type: "file", displayPath: path });
    surface.stat = async () => ({ type: "file", version: "v", size: 5 });
    surface.readText = async () => "agent text";
    surface.streamText = async function* () { yield "agent "; yield "stream"; };
    surface.readBytes = async () => new Uint8Array([1, 2]);
    surface.readByteRange = async () => new Uint8Array([1]);
    surface.listDir = async () => [];
    surface.writeText = async () => ({ operation: "update" });
    surface.editText = async () => ({ version: "v", before: "", after: "" });
    surface.watch = async () => async () => {};

    const routed = await router.resolve("\\\\wsl.localhost\\Ubuntu\\home\\andy\\sample.txt");
    assert.equal(routed.targetKey, "\\\\wsl.localhost\\Ubuntu\\home\\andy\\sample.txt", "resolve routes a UNC coordinate to the backend");
    assert.equal((await router.lstat("\\\\wsl.localhost\\Ubuntu\\home\\andy\\sample.txt"))?.type, "file");
    assert.equal((await router.stat(target))?.type, "file");
    assert.equal(await router.readText(target), "agent text");
    let streamed = "";
    for await (const chunk of await router.streamText(target)) streamed += chunk;
    assert.equal(streamed, "agent stream");
    assert.deepEqual(Array.from(await router.readBytes(target, undefined, 8)), [1, 2]);
    assert.deepEqual(Array.from(await router.readByteRange(target, { offset: 0, length: 1 })), [1]);
    assert.deepEqual(await router.listDir(directory), []);
    assert.equal((await router.writeText(target, "x"))?.operation, "update");
    assert.equal((await router.editText(target, { oldString: "a", newString: "b", replaceAll: false }))?.version, "v");
    const closeDistro = await router.watch(target, () => {}, new AbortController().signal);
    assert.equal(typeof closeDistro, "function");
    await closeDistro();

    // The coordinate helpers on the same routed path are pure and need no
    // distro: the distro branch of each must not fall through to the host.
    assert.equal(router.processPath(directory), "/home/andy", "a distro target maps to its Linux path");
    assert.equal(router.contains(directory, target), true, "distro containment uses POSIX semantics");
    assert.equal(router.contains(directory, distroTarget("/etc/hosts")), false);

    // Host side: an absolute drive/POSIX coordinate takes `super`, the real
    // local backend, over the same temp workspace.
    await writeFile(join(root, "sample.txt"), "hello\n");
    await mkdir(join(root, "host-dir"));
    await writeFile(join(root, "host-dir", "child.txt"), "child");
    const hostFile = await router.resolve(join(root, "sample.txt"));
    const hostDir = await router.resolve(join(root, "host-dir"));
    assert.equal(hostFile.displayPath, join(root, "sample.txt"));
    assert.equal((await router.lstat(join(root, "sample.txt")))?.type, "file");
    assert.equal((await router.stat(hostFile))?.type, "file");
    assert.equal(await router.readText(hostFile), "hello\n");
    let hostStreamed = "";
    for await (const chunk of await router.streamText(hostFile)) hostStreamed += chunk;
    assert.equal(hostStreamed, "hello\n");
    assert.equal(Buffer.from(await router.readBytes(hostFile, undefined, 64)).toString("utf8"), "hello\n");
    assert.equal(Buffer.from(await router.readByteRange(hostFile, { offset: 0, length: 5 })).toString("utf8"), "hello");
    assert.deepEqual((await router.listDir(hostDir)).map((entry) => entry.name), ["child.txt"]);
    assert.equal((await router.writeText(hostFile, "reset\n"))?.operation, "update");
    assert.equal((await router.editText(hostFile, { oldString: "reset", newString: "edited", replaceAll: false }))?.after, "edited\n");
    assert.equal(router.processPath(hostFile), String(hostFile.targetKey));
    assert.equal(router.contains(hostDir, hostFile), false);
    assert.equal(router.contains(hostDir, await router.resolve(join(root, "host-dir", "child.txt"))), true);
    const closeHost = await router.watch(hostDir, () => {}, AbortSignal.timeout(5000));
    await closeHost();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Mount one routing row through the real Loader and inspect its context.
 * @param {Record<string, unknown>} config - the raw row config.
 * @param {(context: Context) => void | Promise<void>} inspect - the assertion callback.
 * @returns {Promise<void>} when the inspection and cleanup finish.
 */
async function inspectRoutingConfig(config, inspect) {
  const root = await mkdtemp(join(tmpdir(), "dsh-wsl-routing-config-"));
  try {
    const configPath = join(root, "cordis.yml");
    await writeFile(configPath, JSON.stringify([{ id: "fs-routing", name: "fs-routing-under-test", config }]));
    const context = new Context();
    context.baseUrl = pathToFileURL(root).href + "/";
    await context.plugin({
      name: "sandbox-policy-stub",
      apply(/** @type {Context} */ pluginCtx) {
        pluginCtx.provide("sandboxPolicy", { defaultMode: "workspace-write", resolve: () => ({ mode: "workspace-write", workspaceRoot: "/" }) });
      },
    });
    await context.plugin(Loader);
    context.loader.builtins.include = Include;
    stubLoaderInternal(context.loader, async (specifier) => {
      if (specifier === "fs-routing-under-test") return WslRoutingFileSystem;
      throw new Error(`unexpected Loader import: ${specifier}`);
    });
    await context.loader.create({ name: "cordis:include", config: { path: pathToFileURL(configPath).href } });
    await context.loader.await();
    await inspect(context);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

check("the routing Loader preserves defaults and accepts explicit settings", async () => {
  /** @type {Array<[Record<string, unknown>, Record<string, unknown>]>} */
  const cases = [
    [{}, { distro: "", wslPath: "wsl.exe", cwd: "", sandbox: true, maskWindowsDrive: false, restrictToDistro: true, watchMaxDepth: 0 }],
    [{ sandbox: null, restrictToDistro: null }, { sandbox: true, restrictToDistro: true }],
    [{ cwd: "host-dir", diffBasisMaxBytes: 512, distro: "ubuntu", wslPath: "custom-wsl", distroCwd: "/work", sandbox: false, maskWindowsDrive: true, restrictToDistro: false, watchMaxDepth: 2 },
      { distro: "ubuntu", wslPath: "custom-wsl", cwd: "/work", diffBasisMaxBytes: 512, sandbox: false, maskWindowsDrive: true, restrictToDistro: false, watchMaxDepth: 2 }],
  ];
  for (const [config, expected] of cases) {
    await inspectRoutingConfig(config, (context) => {
      const router = context.get("fs");
      assert.ok(router instanceof WslRoutingFileSystem);
      const backend = rawService(router.distro());
      assert.ok(backend instanceof WslFileSystem);
      const backendConfig = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (backend.config));
      for (const [key, value] of Object.entries(expected)) assert.equal(backendConfig[key], value, key);
      if ("cwd" in config) assert.equal(router.config.cwd, config.cwd);
      if ("diffBasisMaxBytes" in config) assert.equal(router.config.diffBasisMaxBytes, config.diffBasisMaxBytes);
    });
  }
});

check("the routing Loader rejects invalid host and distro settings", async () => {
  /** @type {Array<[string, unknown]>} */
  const cases = [
    ["cwd", []],
    ["diffBasisMaxBytes", "512"],
    ["sandbox", 0],
    ["distro", 42],
    ["wslPath", false],
    ["distroCwd", []],
    ["maskWindowsDrive", "false"],
    ["restrictToDistro", 0],
    ["watchMaxDepth", -1],
    ["watchMaxDepth", 1.5],
  ];
  for (const [key, value] of cases) {
    await inspectRoutingConfig({ [key]: value }, (context) => {
      assert.equal(context.get("fs") === undefined, true, `${key}=${JSON.stringify(value)} must fail to mount`);
    });
  }
});

let failed = 0;
for (const [name, fn] of checks) await runCheck(name, fn);
failed = checks.length - passed;
console.log(`\n${passed}/${checks.length} composition checks pass`);
if (failed > 0) process.exitCode = 1;
