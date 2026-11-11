/**
 * Assertion checks for the distro-native `working_directory` tool.
 *
 * What matters: the replacement registers the SAME tool name and parameters
 * (so the model's contract is unchanged), delegates every directory decision
 * to the harness's `workingDirectory` service (no new directory state here),
 * and rewrites ONLY the returned path — WSL UNC becomes the POSIX form the
 * distro shell resolves, every other path passes through byte for byte. The
 * agent guard and the render shape match the shipped tool.
 *
 * The checks run against `lib/cwd-prompt-tool.js` with stand-in services.
 *
 *   node test/cwd-prompt-tool.test.mjs
 */
import assert from "node:assert/strict";
import { apply, inject, rewriteUncPath } from "../lib/cwd-prompt-tool.js";

const UNC = "\\\\wsl.localhost\\ubuntu\\home\\you\\proj";
const POSIX = "/home/you/proj";

/**
 * A stand-in harness `workingDirectory` service.
 * @param {string} readValue - what ensure() answers.
 * @param {string} setValue - what set() answers.
 * @returns {{ get: () => string, ensure: (agent: unknown, signal?: unknown) => Promise<string>, set: (agent: unknown, path: string, signal?: unknown) => Promise<string>, calls: string[] }} the slice and its call log.
 */
const fakeService = (readValue = UNC, setValue = UNC) => {
  /** @type {string[]} */
  const calls = [];
  return {
    get: () => readValue,
    calls,
    ensure: async (agent, signal) => {
      assert.notEqual(agent, undefined, "ensure receives the agent");
      calls.push(`ensure:${signal === undefined ? "no-signal" : "signal"}`);
      return readValue;
    },
    set: async (agent, path) => {
      assert.notEqual(agent, undefined, "set receives the agent");
      calls.push(`set:${path}`);
      return setValue;
    },
  };
};

/**
 * Mount the service and capture the registered tool.
 * @param {ReturnType<typeof fakeService>} [service] - the service stub.
 * @returns {{ tool: Record<string, unknown>, service: ReturnType<typeof fakeService> }} the tool and service.
 */
const mounted = (service = fakeService()) => {
  /** @type {Record<string, unknown> | undefined} */
  let tool;
  apply({
    tools: { register: (registered) => { tool = /** @type {Record<string, unknown>} */ (registered); } },
    workingDirectory: service,
  });
  assert.ok(tool, "the service registered its tool");
  return { tool, service };
};

/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Register one labeled check.
 * @param {string} name - what the check asserts.
 * @param {() => void | Promise<void>} body - the assertions.
 */
const check = (name, body) => checks.push([name, body]);

check("it registers the shipped tool's name, contract, and render", async () => {
  const { tool } = mounted();
  assert.equal(tool.name, "working_directory", "same name, so the model's contract is unchanged");
  assert.match(/** @type {string} */ (tool.description), /change it with cd/);
  assert.doesNotMatch(/** @type {string} */ (tool.description), /sandbox boundary stays/, "the tool description stays the shipped contract");
  assert.deepEqual((/** @type {Record<string, any>} */ (tool.parameters)).properties?.cd?.type, "string", "defineTool normalizes the property map into an object schema");
  const render = /** @type {(args: unknown, value: {cwd: string}) => Array<{type: string, text: string}>} */ (/** @type {Record<string, unknown>} */ (tool.output).render);
  assert.deepEqual(render({}, { cwd: POSIX }), [{ type: "text", text: POSIX }]);
});

check("read returns the distro-native path and delegates to ensure", async () => {
  const { tool, service } = mounted(fakeService(UNC));
  const execute = /** @type {(args: Record<string, unknown>, exec: {agent: unknown, signal?: unknown}) => Promise<{cwd: string}>} */ (tool.execute);
  const out = await execute({}, { agent: { id: "a" }, signal: "sig" });
  assert.equal(out.cwd, POSIX);
  assert.deepEqual(service.calls, ["ensure:signal"], "read goes through ensure only");
});

check("cd delegates the requested path to set", async () => {
  const { tool, service } = mounted(fakeService(UNC, UNC));
  const execute = /** @type {(args: Record<string, unknown>, exec: {agent: unknown}) => Promise<{cwd: string}>} */ (tool.execute);
  const out = await execute({ cd: "/opt/other" }, { agent: { id: "a" } });
  assert.equal(out.cwd, POSIX);
  assert.deepEqual(service.calls, ["set:/opt/other"], "set receives the RAW requested path");
});

check("a non-WSL result passes through byte for byte", async () => {
  const drive = "C:\\Users\\you\\proj";
  const { tool } = mounted(fakeService(drive));
  const execute = /** @type {(args: Record<string, unknown>, exec: {agent: unknown}) => Promise<{cwd: string}>} */ (tool.execute);
  assert.equal((await execute({}, { agent: { id: "a" } })).cwd, drive);
});

check("the agent guard matches the shipped tool", async () => {
  const { tool } = mounted();
  const execute = /** @type {(args: Record<string, unknown>, exec: {agent: unknown}) => Promise<{cwd: string}>} */ (tool.execute);
  await assert.rejects(execute({}, /** @type {any} */ ({})), /requires an agent Session/);
});

check("the row declares its context reads as an inject", () => {
  assert.deepEqual(inject, ["tools", "workingDirectory"], "cordis 4 refuses an undeclared ctx property read");
});

check("rewriteUncPath covers UNC, share root, and pass-through", () => {
  assert.equal(rewriteUncPath(UNC), POSIX);
  assert.equal(rewriteUncPath("\\\\wsl$\\Debian-12\\var\\www"), "/var/www");
  assert.equal(rewriteUncPath("\\\\wsl.localhost\\ubuntu"), "/");
  assert.equal(rewriteUncPath(POSIX), POSIX);
  assert.equal(rewriteUncPath("C:\\Users\\you"), "C:\\Users\\you");
});

check("the patch layer disables the shipped row and mounts this one", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const yaml = await import("js-yaml");
  const { applyEntryPatches, entryListSchema } = await import("@deepseek-ai/cordis-plugin-include");
  const here = dirname(fileURLToPath(import.meta.url));
  const patch = /** @type {any} */ (yaml.load(readFileSync(join(here, "..", "cordis.patch.yml"), "utf8"), { schema: entryListSchema }));
  const upstream = [
    { id: "subprocess", name: "@deepseek-ai/dsh-subprocess-local", config: {} },
    { id: "terminal-controller", name: "@deepseek-ai/dsh-api-terminal-controller", config: {} },
    { id: "directory-picker", name: "@deepseek-ai/dsh-host-directory-picker-auto", config: {} },
    { id: "workspace-files", name: "@deepseek-ai/dsh-api-workspace-files", config: { maxEntries: 100 } },
    { id: "fs-sandbox", name: "@deepseek-ai/dsh-fs-sandbox", config: { cwd: "" } },
    { id: "working-directory", name: "@deepseek-ai/dsh-working-directory", config: {} },
    { id: "tool-working-directory", name: "@deepseek-ai/dsh-tool-working-directory", config: {} },
  ];
  /** @type {string[]} */
  const warnings = [];
  const composed = applyEntryPatches(structuredClone(upstream), structuredClone(patch), (message) => warnings.push(message));
  const index = new Map(composed.filter((/** @type {{id?: unknown}} */ row) => typeof row.id === "string").map((/** @type {any} */ row) => [row.id, row]));
  assert.equal(index.get("tool-working-directory")?.disabled, true, "the shipped tool row is off");
  assert.equal(index.get("wsl-cwd-prompt-tool")?.name, "dsh-plugin-wsl-env/cwd-prompt-tool", "the replacement row targets the service this package ships");
  assert.equal(index.get("wsl-cwd-prompt-tool")?.disabled, undefined);
  assert.deepEqual(warnings, [], "the layer applies without loader warnings");
});

let passed = 0;
for (const [name, body] of checks) {
  try {
    await body();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${checks.length} cwd-prompt-tool checks pass`);
