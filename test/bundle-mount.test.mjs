/**
 * The composed bundle actually mounts: every row this package inserts into
 * `cordis.patch.yml`, resolved by its real package subpath, applied on a real
 * cordis Context through the real Loader.
 *
 * `test/composition.test.mjs` proves the patch algebra and mounts one row; the
 * probe suite boots throwaway profiles on a real machine. Neither runs in CI,
 * and the rows between them — status, doctor command, open-in-app, shell-env,
 * auto-preset, preflight, cwd-prompt, update-check, subprocess, picker,
 * fs-routing, the client host — were never imported or activated by a test. A
 * renamed export, a config-schema change, or an apply that throws at mount
 * therefore reached users (or the manual probes) first.
 *
 * Host services are stubbed to the slices the rows read; rows that are not
 * this package's are listed by name and asserted, so a new insert fails this
 * test until its row is reviewed.
 *
 *   node test/bundle-mount.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Context, symbols } from "@deepseek-ai/cordis";
import Include, { entryListSchema } from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import yaml from "js-yaml";
import { autoPresetSeam } from "../lib/auto-preset-seam.js";
import { WslDirectoryPicker } from "../lib/picker.js";
import { WslRoutingFileSystem } from "../lib/fs-routing.js";
import { WslSubprocessRuntime } from "../lib/subprocess.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
/** @type {any[]} */
const PATCH = /** @type {any} */ (yaml.load(readFileSync(join(ROOT, "cordis.patch.yml"), "utf8"), { schema: entryListSchema }));

/** Every row this package inserts at the composition root. */
const EXPECTED_ROWS = [
  "dsh-plugin-wsl-env",
  "dsh-plugin-wsl-env/auto-preset",
  "dsh-plugin-wsl-env/cwd-prompt",
  "dsh-plugin-wsl-env/cwd-prompt-tool",
  "dsh-plugin-wsl-env/fs-routing",
  "dsh-plugin-wsl-env/open-in-app",
  "dsh-plugin-wsl-env/picker",
  "dsh-plugin-wsl-env/plugin-update",
  "dsh-plugin-wsl-env/preflight",
  "dsh-plugin-wsl-env/shell-env",
  "dsh-plugin-wsl-env/status",
  "dsh-plugin-wsl-env/subprocess",
  "dsh-plugin-wsl-env/update-check",
  "dsh-plugin-wsl-env/wsl-doctor-command",
];

/** Inserted rows that belong to the host, not this package. */
const HOST_ROWS = [
  "@deepseek-ai/dsh-client-ui-directory-picker-browse",
  "@deepseek-ai/dsh-agent-preset",
];

/** @type {Array<Record<string, any>>} */
const inserted = [];
for (const entry of PATCH) {
  if (!Array.isArray(/** @type {any} */ (entry).insert)) continue;
  inserted.push(.../** @type {any[]} */ (/** @type {any} */ (entry).insert));
}
const ourRows = inserted.filter((row) => row.name === "dsh-plugin-wsl-env" || String(row.name).startsWith("dsh-plugin-wsl-env/"));
const hostRows = inserted.filter((row) => !ourRows.includes(row) && typeof row.name === "string" && !row.name.startsWith("dsh-plugin-wsl-env"));

/**
 * Resolve one package specifier to the module the loader would import.
 * @param {string} name - the row name.
 * @returns {Promise<any>} the module namespace.
 */
async function moduleFor(name) {
  const subpath = name === PKG.name ? "." : `./${name.slice(PKG.name.length + 1)}`;
  const exported = PKG.exports[subpath];
  assert.ok(exported !== undefined, `package.json exports carry ${subpath}`);
  const file = typeof exported === "string" ? exported : exported.default;
  assert.equal(typeof file, "string", `${subpath} has a default target`);
  return import(pathToFileURL(join(ROOT, file)).href);
}

/**
 * Strip values the loader config cannot carry (parsed `!!js` expressions).
 * @param {unknown} value - a parsed config value.
 * @returns {boolean} whether the value is plain JSON data.
 */
function isPlain(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isPlain);
  if (typeof value === "object") return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isPlain);
  return false;
}

/** The stubs the rows read. */
/** @type {string[]} */
const registeredRoutes = [];
/** @type {unknown[]} */
const registeredCommands = [];
/** @type {unknown[]} */
const registeredTools = [];
/** @type {unknown[]} */
const registeredShellEnv = [];

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/**
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

check("the patch inserts exactly the rows this test mounts", () => {
  assert.deepEqual(
    ourRows.map((row) => row.name).sort(),
    [...EXPECTED_ROWS].sort(),
    "a new/renamed insert must be added here (and to the mounted set) before it ships",
  );
  assert.deepEqual(
    hostRows.map((row) => row.name).sort(),
    [...HOST_ROWS].sort(),
    "the only non-plugin inserts are the two host rows reviewed with the bundle",
  );
  assert.equal(ourRows.length + hostRows.length, inserted.length, "every insert is accounted for");
});

check("every inserted row imports, applies and stays active", async () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-wsl-env-mount-"));
  /** @type {Context | undefined} */
  let context;
  try {
    const rows = ourRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      ...(typeof row.config === "object" && row.config !== null && isPlain(row.config) ? { config: row.config } : {}),
    }));
    const configPath = join(root, "cordis.yml");
    writeFileSync(configPath, JSON.stringify(rows));
    /** @type {Map<string, any>} */
    const modules = new Map();
    for (const row of ourRows) modules.set(String(row.name), await moduleFor(String(row.name)));

    context = new Context();
    context.baseUrl = pathToFileURL(root).href + "/";
    // The host slices the rows read at mount. Sibling fibers provide them, the
    // same way the real composition's services are provided.
    await context.plugin({
      name: "host-stubs",
      apply(/** @type {Context} */ pluginCtx) {
        /** @param {string} name @param {unknown} value */
        const provide = (name, value) => pluginCtx.provide(name, value);
        provide("sandboxPolicy", { defaultMode: "workspace-write", resolve: () => ({ mode: "workspace-write", workspaceRoot: "/" }) });
        provide("agents", { list: () => [] });
        provide("agentPresets", { defaultId: "standard", get: () => undefined });
        provide("sessionController", { agents: { createSession: async () => ({}) } });
        provide("tools", { register: (/** @type {unknown} */ tool) => { registeredTools.push(tool); return { dispose() {} }; } });
        provide("workingDirectory", { get: () => null, ensure: async () => "/" });
        provide("shellEnv", { register: (/** @type {unknown} */ entry) => { registeredShellEnv.push(entry); return () => {}; } });
        provide("commands", { register: (/** @type {unknown} */ command) => { registeredCommands.push(command); return { dispose() {} }; } });
        provide("connection", {
          fetch: {
            /** @param {{ path: string }} route */
            register: (route) => { registeredRoutes.push(route.path); return () => {}; },
          },
        });
      },
    });
    await context.plugin(Loader);
    context.loader.builtins.include = Include;
    // The loader imports each row by name; the map is the package's real
    // subpaths resolved above, so a missing default export fails here.
    context.loader.internal = /** @type {any} */ ({
      version: "v2",
      import: async (/** @type {string} */ specifier) => {
        const module = modules.get(specifier);
        if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`);
        return module;
      },
    });
    await context.loader.create({ name: "cordis:include", config: { path: pathToFileURL(configPath).href } });
    await context.loader.await();

    const entries = [...context.loader.entries()].filter((entry) => String(entry.options?.name ?? "").startsWith("dsh-plugin-wsl-env"));
    assert.equal(entries.length, ourRows.length, "every composed row is an entry");
    const inactive = entries.filter((entry) => entry.fiber?.state !== 2);
    assert.deepEqual(
      inactive.map((entry) => `${String(entry.options?.name)}: state ${entry.fiber?.state}`),
      [],
      "every row's fiber is ACTIVE (state 2 in cordis 4.1.0)",
    );
    // Raw-service identity through cordis's traceable proxies.
    const raw = (/** @type {unknown} */ value) => {
      let current = value;
      for (;;) {
        const inner = /** @type {any} */ (current)?.[symbols.original];
        if (inner === undefined || inner === current) return current;
        current = inner;
      }
    };
    assert.equal(raw(context.get("subprocess")) instanceof WslSubprocessRuntime, true, "the subprocess takeover registered");
    assert.equal(raw(context.get("fs")) instanceof WslRoutingFileSystem, true, "the root filesystem takeover registered");
    assert.equal(raw(context.get("directoryPicker")) instanceof WslDirectoryPicker, true, "the picker takeover registered");
    assert.equal(registeredRoutes.includes("/api/wsl-env/status"), true, "the status row registered its route");
    assert.equal(registeredRoutes.includes("/api/wsl-env/plugin-update"), true, "the plugin-update row registered its route");
    assert.equal(registeredRoutes.length >= 2, true, "the open-in-app row registered its route too");
    assert.equal(registeredCommands.length, 1, "the /wsl-doctor command registered");
    assert.equal(registeredTools.length >= 1, true, "the cwd-prompt tool row registered its tool");
    assert.equal(registeredShellEnv.length, 1, "the shell-env row contributed its facts");
    assert.equal(autoPresetSeam().state, "active", "the auto-preset creation seam wrapped the host's createSession");
  } finally {
    await context?.fiber.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, fn] of checks) await runCheck(name, fn);
console.log(`\n${passed}/${checks.length} bundle-mount checks pass`);
if (passed < checks.length) process.exitCode = 1;
