/**
 * REAL-composition boot test: the plugin's `fs` row booted through the cordis
 * Loader, exactly the way a profile composes it — a yml row, the Loader's
 * static import map, and a stub for the upstream `sandboxPolicy` service (an
 * external service, mocked per the testing policy). Asserts that the composed
 * `ctx.fs` is the plugin's substrate and that a real distro read works end to
 * end when `wsl.exe` is available (skipped elsewhere, like every probe that
 * needs the local Windows+WSL topology).
 *
 *   node test/fs.boot.test.mjs
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { it } from "node:test";
import { Context } from "@deepseek-ai/cordis";
import Include from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import { WslFileSystem } from "../lib/index.js";
import { listDistros } from "../lib/wsl.js";
import { sharedAgent } from "../lib/agent-shared.js";

const TEST_DISTRO = "ubuntu";

const ROW = "@deepseek-ai/dsh-plugin-wsl-env/fs";
const WORKSPACE = "\\\\wsl.localhost\\ubuntu\\home\\andy\\Projects\\dsh\\plugins\\dsh-plugin-wsl-env";

// The upstream `sandboxPolicy` service, reduced to what this composition
// consumes: the deployment default mode and a per-call resolver. Declared
// with `provide` — cordis refuses undeclared service writes.
const sandboxPolicyStub = {
  name: "sandbox-policy",
  inject: [],
  /** @param {Context} ctx - the plugin's context. */
  apply(ctx) {
    ctx.provide("sandboxPolicy", {
      defaultMode: "workspace-write",
      workspaceRoot: WORKSPACE,
      resolve: () => ({ mode: "workspace-write", workspaceRoot: WORKSPACE }),
    });
  },
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

/** @type {Context} */
let context;
async function boot() {
  const root = await mkdtemp(join(tmpdir(), "dsh-wsl-env-boot-"));
  const configPath = join(root, "cordis.yml");
  await writeFile(configPath, [`- name: '${ROW}'`, "  config:", "    sandbox: true", ""].join("\n"));
  context = new Context();
  context.baseUrl = pathToFileURL(root).href + "/";
  await context.plugin(sandboxPolicyStub);
  await context.plugin(Loader);
  context.loader.builtins.include = Include;
  stubLoaderInternal(context.loader, async (specifier) => {
    if (specifier === ROW) return WslFileSystem;
    if (specifier === "sandbox-policy") return sandboxPolicyStub;
    throw new Error(`unexpected Loader import: ${specifier}`);
  });
  await context.loader.create({ name: "cordis:include", config: { path: pathToFileURL(configPath).href } });
  await context.loader.await();
}

it("boots the plugin's fs row through the Loader into a real service", async () => {
  await boot();
  assert.ok(context.fs instanceof WslFileSystem, "ctx.fs is the plugin's composed filesystem");
  assert.equal(context.fs.sandboxMode, "workspace-write", "the stub policy's mode is reported honestly");
  assert.equal(typeof context.fs.watch, "function", "the seam surface is complete");
});

/** Whether the real-distro topology exists: Windows, wsl.exe, AND this
 * test's distro actually installed. The CI Windows runners ship wsl.exe
 * with no distro, and booting there must read as a skip, not a failure. */
async function distroInstalled() {
  if (process.platform !== "win32") return false; // wsl.exe lives on the Windows host
  try {
    return (await listDistros()).includes(TEST_DISTRO);
  } catch {
    return false;
  }
}

it("serves a real distro read end to end when wsl.exe is available", { timeout: 60_000 }, async (t) => {
  if (!await distroInstalled()) return;
  await boot();
  t.after(async () => {
    // The resident agent is a module-level shared instance; an explicit close
    // keeps the suite from leaking a wsl.exe session per worker.
    await sharedAgent(TEST_DISTRO).close();
  });
  const target = await context.fs.resolve("/etc/hostname");
  assert.match(target.displayPath, /^\/etc\/hostname$/u);
  const info = await context.fs.stat(target);
  assert.ok(info, "the distro hostname file is observed");
  assert.equal(info.type, "file");
  const text = await context.fs.readText(target);
  assert.ok(text.length > 0, "the distro hostname file is non-empty");
});

it("answers honestly when the workspace leaves the pinned distro", async () => {
  if (!await distroInstalled()) return;
  await boot();
  await assert.rejects(
    () => context.fs.resolve("\\\\wsl.localhost\\debian\\etc\\hostname"),
    (error) => /** @type {{code?: string}} */ (error).code === "FS_OUTSIDE_DISTRO",
  );
});
