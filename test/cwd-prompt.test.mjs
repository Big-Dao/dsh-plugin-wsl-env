/**
 * Assertion checks for the runtime-context working-directory rewrite.
 *
 * What matters: BOTH renderings the model sees are covered — the system prompt
 * (assemble waterfall) and the per-turn runtime-context snapshot
 * (`refreshContext`, which re-resolves the registry providers directly) — via
 * a session-scoped entry under the SAME name (`ScopedLayers.merge` gives the
 * nearest scope the name). The provider re-reads the harness's
 * `workingDirectory` service so a mid-session `cd` still shows; a WSL UNC
 * spelling becomes the POSIX path the session's own commands use; Windows
 * drive paths, other contexts, and already-POSIX text pass through untouched;
 * host workspaces and agents without a context install nothing; a disabled
 * service registers nothing; and an unexpected shape can never fail the
 * waterfall.
 *
 * The checks run against `lib/cwd-prompt.js` with stand-in cordis contexts.
 *
 *   node test/cwd-prompt.test.mjs
 */
import assert from "node:assert/strict";
import { apply, entryText, rewriteQuotedUnc } from "../lib/cwd-prompt.js";

const UNC = "\\\\wsl.localhost\\ubuntu\\home\\you\\proj";
const POSIX = "/home/you/proj";
// The harness writes the cwd through JSON.stringify, so the rendered text
// carries ESCAPED backslashes inside the quotes.
const renderedCwdLine = (/** @type {string} */ path) => `Current working directory: ${JSON.stringify(path)}.`;

/**
 * A stand-in cordis context: captures both listeners `apply` registers and
 * answers the live-agent sweep.
 * @param {Array<unknown>} events - captured [event, listener] pairs.
 * @param {{ list: () => unknown[] }} [agents] - the sweep's answer.
 * @returns {Record<string, unknown>} the context.
 */
const fakeCtx = (events, agents) => ({
  on: (/** @type {string} */ event, /** @type {unknown} */ listener) => {
    events.push([event, listener]);
    return () => true;
  },
  agents,
  get: (/** @type {string} */ name) => {
    if (name === "agents") return agents;
    throw new Error(`undeclared service: ${name}`);
  },
  logger: { debug: () => {} },
});

/**
 * A stand-in agent whose context records the injected context entry.
 * @param {string} [cwd] - the session header's cwd.
 * @param {unknown} [workingDirectory] - what ctx.get("workingDirectory") answers.
 * @returns {{ agent: Record<string, unknown>, entry: () => Record<string, unknown> | undefined }} the agent and accessors.
 */
const fakeAgent = (cwd = UNC, workingDirectory = { get: () => UNC }) => {
  /** @type {Record<string, unknown> | undefined} */
  let entry;
  const agent = {
    session: { header: { cwd } },
    ctx: {
      inject: (/** @type {string[]} */ names, /** @type {(scope: unknown) => void} */ install) => {
        assert.deepEqual(names, ["systemPrompt"]);
        install({
          systemPrompt: {
            context: (/** @type {Record<string, unknown>} */ registered) => {
              entry = registered;
            },
            getContextOrder: () => 42,
          },
        });
      },
      get: (/** @type {string} */ name) => {
        if (name === "workingDirectory") return workingDirectory;
        throw new Error(`undeclared service: ${name}`);
      },
    },
  };
  return { agent, entry: () => entry };
};

/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Register one labeled check.
 * @param {string} name - what the check asserts.
 * @param {() => void | Promise<void>} body - the assertions.
 */
const check = (name, body) => checks.push([name, body]);

check("apply registers the created hook and one waterfall listener", () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  assert.deepEqual(events.map(([event]) => event), ["agent/created", "system-prompt/assemble"]);
  assert.equal(events.filter(([event]) => event === "system-prompt/assemble").length, 1);
});

check("a distro agent installs a same-name scoped entry", () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  const hook = /** @type {(payload: unknown) => void} */ (events[0]?.[1]);
  const { agent, entry } = fakeAgent();
  hook({ agent });
  const registered = entry();
  assert.equal(registered?.name, "working-directory:current");
  assert.equal(registered?.required, true, "the shadow entry must survive runtime-context suppression");
  assert.equal(registered?.order, 42, "the order follows the harness's WORKING_DIRECTORY constant");
});

check("the provider reads the live service and rewrites", () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  const hook = /** @type {(payload: unknown) => void} */ (events[0]?.[1]);
  const { agent, entry } = fakeAgent(UNC, {
    get: (/** @type {unknown} */ session) => {
      assert.equal(/** @type {{header?: {cwd?: string}}} */ (session)?.header?.cwd, UNC, "the provider passes the agent's session");
      return UNC;
    },
  });
  hook({ agent });
  const text = /** @type {(context: unknown) => string} */ (entry()?.text);
  assert.equal(text({ agent }), renderedCwdLine(POSIX));
});

check("a mid-session cd is honored (service value wins over header)", () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  const hook = /** @type {(payload: unknown) => void} */ (events[0]?.[1]);
  let current = "\\\\wsl.localhost\\ubuntu\\opt\\moved";
  const { agent, entry } = fakeAgent(UNC, { get: () => current });
  hook({ agent });
  const text = /** @type {(context: unknown) => string} */ (entry()?.text);
  assert.equal(text({ agent }), renderedCwdLine("/opt/moved"));
  current = "\\\\wsl.localhost\\ubuntu\\srv\\data";
  assert.equal(text({ agent }), renderedCwdLine("/srv/data"));
});

check("a broken service degrades to the session header cwd", () => {
  const agent = { session: { header: { cwd: UNC } } };
  assert.equal(
    entryText(agent, { get: () => {
      throw new Error("wedged");
    } }),
    renderedCwdLine(POSIX),
  );
  assert.equal(entryText(agent, undefined), renderedCwdLine(POSIX));
});

check("a host workspace installs nothing", () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  const hook = /** @type {(payload: unknown) => void} */ (events[0]?.[1]);
  const { agent, entry } = fakeAgent("C:\\Users\\you\\proj");
  hook({ agent });
  assert.equal(entry(), undefined, "no shadow entry for a drive-path workspace");
});

check("an agent without a context installs nothing", () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  const hook = /** @type {(payload: unknown) => void} */ (events[0]?.[1]);
  hook({ agent: { session: { header: { cwd: UNC } } } });
  hook(undefined);
  hook({});
});

check("the sweep installs into already-live agents", () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  const { agent, entry } = fakeAgent();
  apply(/** @type {any} */ (fakeCtx(events, { list: () => [agent] })));
  assert.ok(entry(), "the sweep installed the shadow entry");
});

check("the waterfall listener rewrites the assembled entry", async () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  const listener = /** @type {(assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>} */ (events.find((/** @type {unknown[]} */ pair) => pair[0] === "system-prompt/assemble")?.[1]);
  const entry = { name: "working-directory:current", text: renderedCwdLine(UNC), interpolate: false };
  const out = await listener({ contexts: [entry] }, {}, async () => /** @type {any} */ ({ contexts: [entry] }));
  assert.equal(entry.text, renderedCwdLine(POSIX));
  assert.deepEqual(/** @type {{contexts: unknown[]}} */ (out).contexts, [entry], "the rewrite is in place, not a copy");
});

check("the waterfall listener passes host paths and other contexts through", async () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  const listener = /** @type {(assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>} */ (events.find((/** @type {unknown[]} */ pair) => pair[0] === "system-prompt/assemble")?.[1]);
  const drive = { name: "working-directory:current", text: renderedCwdLine("C:\\Users\\you\\proj") };
  const other = { name: "wsl-preflight", text: `preflight: "${UNC}" is confined` };
  await listener({ contexts: [drive, other] }, {}, async () => /** @type {any} */ ({}));
  assert.equal(drive.text, renderedCwdLine("C:\\Users\\you\\proj"));
  assert.equal(other.text, `preflight: "${UNC}" is confined`);
});

check("the waterfall listener survives hostile shapes", async () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)));
  const listener = /** @type {(assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>} */ (events.find(([event]) => event === "system-prompt/assemble")?.[1]);
  assert.deepEqual(await listener(undefined, {}, async () => undefined), undefined);
  assert.deepEqual(await listener({}, {}, async () => /** @type {any} */ ({})), {});
  const hostile = /** @type {any} */ ({ contexts: [undefined, null, { name: "working-directory:current" }] });
  assert.deepEqual(await listener(hostile, {}, async () => /** @type {any} */ (hostile)).then((a) => /** @type {{contexts: unknown[]}} */ (a).contexts.length), 3);
});

check("rewriteQuotedUnc covers the escaped rendering, legacy spelling, share root, and idempotence", () => {
  assert.equal(rewriteQuotedUnc(renderedCwdLine(UNC)), renderedCwdLine(POSIX));
  assert.equal(rewriteQuotedUnc(JSON.stringify("\\\\wsl$\\Debian-12\\var\\www")), '"/var/www"');
  assert.equal(rewriteQuotedUnc(JSON.stringify("\\\\wsl.localhost\\ubuntu")), '"/"');
  assert.equal(rewriteQuotedUnc(`"${POSIX}"`), `"${POSIX}"`);
  assert.equal(rewriteQuotedUnc(`"C:\\\\Users\\\\you"`), '"C:\\\\Users\\\\you"');
  // The REAL rendering: JSON.stringify escapes every backslash, and the
  // rewrite must still see the share.
  assert.equal(rewriteQuotedUnc(JSON.stringify(UNC)), JSON.stringify(POSIX));
  // A body whose escapes do not parse fails closed to the original text.
  assert.equal(rewriteQuotedUnc('"\\uZZZZ"'), '"\\uZZZZ"');
});

check("disabled registers nothing", () => {
  /** @type {Array<[string, unknown]>} */
  const events = [];
  apply(/** @type {any} */ (fakeCtx(events)), { enabled: false });
  assert.deepEqual(events, []);
});

check("the patch layer mounts the row", async () => {
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
    { id: "tool-working-directory", name: "@deepseek-ai/dsh-tool-working-directory", config: {} },
  ];
  /** @type {string[]} */
  const warnings = [];
  const composed = applyEntryPatches(structuredClone(upstream), structuredClone(patch), (message) => warnings.push(message));
  const row = composed.find((entry) => entry?.id === "wsl-cwd-prompt");
  assert.equal(row?.name, "dsh-plugin-wsl-env/cwd-prompt", "the row targets the service this package ships");
  assert.equal(row?.disabled, undefined, "the row is mounted, not disabled");
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
console.log(`\n${passed}/${checks.length} cwd-prompt checks pass`);
