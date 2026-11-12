/**
 * Loader-level checks for the web client: the module's identity, the slots it
 * registers, the session-header "open in VS Code (WSL)" item, and the
 * new-workspace access prompt.
 *
 * The client is a browser bundle: it registers through
 * `window.__ModuleLoader__.load` and receives React through `require`. These
 * checks load it under stand-ins for both, so what is asserted is the wiring —
 * which slots it occupies, which route the menu item posts to, and when the
 * prompt opens. A component is called as a plain function with hooks stubbed:
 * the banner's post-effect state and layout stay out of scope, because that
 * needs a renderer this repository does not ship.
 *
 *   node --test test/client.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { OPEN_IN_APP_PATH } from "../lib/open-in-app.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WSL = "\\\\wsl.localhost\\Ubuntu\\home\\you\\proj";
const WINDOWS = "C:\\Users\\you\\proj";

/**
 * The hook runtime the component under test should use. The client captures
 * React's hook functions when its factory runs, so the indirection is set for
 * the duration of one render and cleared afterwards.
 * @type {any}
 */
let activeHooks = null;

/**
 * The module shape the web loader's factory returns.
 * @typedef {object} ClientModule
 * @property {string[]} inject
 * @property {(ctx: any) => void} apply
 */

/**
 * One loaded client plus the sandbox its browser globals live in.
 * @typedef {object} LoadedClient
 * @property {{ id: string, factory: (require: (name: string) => any) => ClientModule }} definition
 * @property {ClientModule} module
 * @property {any} sandbox
 */

/**
 * Load `client.js` under a stand-in loader and a stand-in React.
 * @returns {LoadedClient} the registered module and its sandbox.
 */
const loadClient = () => {
  const source = readFileSync(join(ROOT, "client.js"), "utf8");
  /** @type {LoadedClient["definition"] | undefined} */
  let definition;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        /** @param {LoadedClient["definition"]} next */
        load(next) { definition = next; },
      },
      sessionStorage: { getItem: () => null, setItem: () => {} },
    },
    document: { addEventListener() {}, removeEventListener() {} },
    console,
    setTimeout,
    clearTimeout,
    /** @type {(url: string, init?: any) => Promise<Response>} */
    fetch: async () => { throw new Error("no request expected"); },
    Response,
  };
  vm.runInNewContext(source, sandbox, { filename: "client.js" });
  if (definition === undefined) throw new Error("client.js did not register a module");
  /**
   * @param {any} type
   * @param {any} props
   * @param {any[]} children
   */
  const createElement = (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } });
  const React = {
    createElement,
    // The component captures these at factory time. Route them through the
    // currently mounted runtime when there is one; otherwise keep the inert
    // stub the wiring tests rely on.
    useState: (/** @type {any} */ value) => activeHooks === null
      ? [typeof value === "function" ? value() : value, () => {}]
      : activeHooks.useState(value),
    useEffect: (/** @type {() => any} */ run, /** @type {readonly any[]} */ deps) => {
      activeHooks?.useEffect(run, deps);
    },
  };
  const client = definition.factory((name) => {
    if (name === "react") return React;
    throw new Error(`unexpected require("${name}")`);
  });
  return { definition, module: client, sandbox };
};

/**
 * A stand-in client root context: it runs every slot registration and every
 * service injection the module performs.
 * @param {{ sessions?: Record<string, { cwd?: string }>, snapshot?: { phase: string, items: Array<{ workspaceId: string, path: string }> }, services?: Record<string, unknown>, sessionList?: unknown }} [options] - session summaries, the workspace catalog, extra services (`remote.settings`, `remote.agentPresets`), and the session-list snapshot the menu reads.
 * @returns {{ ctx: any, registrations: Array<{ spec: any, render: any }>, menus: any[], disposers: Array<() => void>, fireWorkspace: () => void }} the harness.
 */
const makeCtx = ({ sessions = {}, snapshot = { phase: "loading", items: [] }, services: extraServices = {}, sessionList } = {}) => {
  /** @type {Array<{ spec: any, render: any }>} */
  const registrations = [];
  /** @type {any[]} */
  const menus = [];
  /** @type {Array<() => void>} */
  const disposers = [];
  /** @type {null | (() => void)} */
  let listener = null;
  const services = {
    workspaces: {
      list: {
        getSnapshot: () => snapshot,
        /** @param {() => void} next */
        subscribe(next) {
          listener = next;
          return () => { listener = null; };
        },
      },
    },
    ...extraServices,
  };
  const ctx = {
    slots: {
      /**
       * @param {any} spec
       * @param {any} render
       */
      register(spec, render) {
        registrations.push({ spec, render });
        return { spec };
      },
      /**
       * @param {string} _name
       * @param {() => Generator<any, void, unknown>} install
       */
      inject(_name, install) {
        for (const entry of install()) void entry;
      },
    },
    /** @param {string} name */
    get(name) { return /** @type {any} */ (services)[name]; },
    /**
     * @param {string[]} names
     * @param {(scope: any) => void} install
     */
    inject(names, install) {
      if (names.includes("contextMenus")) {
        install({
          contextMenus: {
            /** @param {any} options */
            register(options) { menus.push(options); return () => {}; },
          },
          sessions: { list: { getSnapshot: () => (sessionList === undefined ? { byId: sessions } : sessionList) } },
          effect(/** @type {() => unknown} */ callback) {
            const dispose = callback();
            if (typeof dispose === "function") disposers.push(/** @type {() => void} */ (dispose));
            return dispose;
          },
        });
        return;
      }
      if (names.includes("workspaces")) {
        install({
          get: (/** @type {string} */ name) => (name === "workspaces" ? services.workspaces : undefined),
          effect(/** @type {() => unknown} */ callback) {
            const dispose = callback();
            if (typeof dispose === "function") disposers.push(/** @type {() => void} */ (dispose));
            return dispose;
          },
        });
      }
    },
  };
  return {
    ctx,
    registrations,
    menus,
    disposers,
    fireWorkspace: () => { listener?.(); },
  };
};

/**
 * The first element of a plain tree whose props satisfy a predicate.
 * @param {any} node - element, array of children, or nothing.
 * @param {(element: any) => boolean} predicate - the match.
 * @returns {any} the element, or undefined.
 */
const findElement = (node, predicate) => {
  if (node === null || node === undefined || typeof node === "string") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (predicate(node)) return node;
  return findElement(node.props?.children, predicate);
};

/**
 * All text nodes of a plain element tree.
 * @param {any} node - element, array of children, string, or nothing.
 * @returns {string[]} the strings, in tree order.
 */
const texts = (node) => {
  if (node === null || node === undefined) return [];
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts(node.props?.children);
};

/**
 * Compare a hook's dependency list the way React does.
 * @param {readonly any[] | undefined} previous - the previous list.
 * @param {readonly any[]} next - the current list.
 */
const sameDeps = (previous, next) => Array.isArray(previous) && previous.length === next.length
  && previous.every((value, index) => Object.is(value, next[index]));

/**
 * A minimal hooks runtime: state slots and passive effects, with a signal the
 * mount helper uses to rerender. Enough to drive the reminder's real state
 * machine without shipping a renderer.
 * @param {() => void} onChange - called when a state slot changes.
 */
const createHookRuntime = (onChange) => {
  /** @type {any[]} */
  const hooks = [];
  let cursor = 0;
  /** @type {Array<{ index: number, run: () => any, cleanup?: () => void }>} */
  let pending = [];
  /** @param {any} initial */
  const useState = (initial) => {
    const index = cursor;
    cursor += 1;
    if (hooks[index] === undefined) {
      hooks[index] = { value: typeof initial === "function" ? initial() : initial };
    }
    const slot = hooks[index];
    return [slot.value, (/** @type {any} */ next) => {
      const value = typeof next === "function" ? next(slot.value) : next;
      if (Object.is(value, slot.value)) return;
      slot.value = value;
      onChange();
    }];
  };
  /**
   * @param {() => any} run
   * @param {readonly any[]} [deps]
   */
  const useEffect = (run, deps) => {
    const index = cursor;
    cursor += 1;
    const previous = hooks[index];
    const changed = previous === undefined || deps === undefined || !sameDeps(previous.deps, deps);
    if (!changed) return;
    pending.push({
      index,
      run,
      ...(previous?.cleanup === undefined ? {} : { cleanup: previous.cleanup }),
    });
    hooks[index] = { deps };
  };
  return {
    useState,
    useEffect,
    begin() {
      cursor = 0;
      pending = [];
    },
    commit() {
      for (const effect of pending) {
        if (typeof effect.cleanup === "function") effect.cleanup();
        const cleanup = effect.run();
        hooks[effect.index].cleanup = typeof cleanup === "function" ? cleanup : undefined;
      }
    },
    unmount() {
      for (const slot of hooks) {
        if (typeof slot.cleanup === "function") slot.cleanup();
      }
    },
  };
};

/**
 * Render one function component and drive its effects until the tree is
 * stable. The component runs for real; only React's plumbing is substituted.
 * @param {(props: any) => any} Component - the component to mount.
 * @param {any} props - its props.
 */
const mountComponent = (Component, props) => {
  let dirty = false;
  /** @type {any} */
  let element;
  const runtime = createHookRuntime(() => { dirty = true; });
  const render = () => {
    const previous = activeHooks;
    activeHooks = runtime;
    try {
      runtime.begin();
      element = Component(props);
      runtime.commit();
    } finally {
      activeHooks = previous;
    }
  };
  render();
  return {
    current: () => element,
    /** @param {number} [rounds] - the maximum number of flush rounds. */
    async settle(rounds = 20) {
      for (let index = 0; index < rounds; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!dirty) return;
        dirty = false;
        render();
      }
      throw new Error("the component did not settle");
    },
    unmount: () => runtime.unmount(),
  };
};

/**
 * The first element with this button label.
 * @param {any} tree - the rendered tree.
 * @param {string} label - the label to find.
 * @returns {any} the Btn element, or undefined.
 */
const buttonOf = (tree, label) => findElement(tree, (element) => element.props?.label === label);

/**
 * Click the button with this label.
 * @param {any} tree - the rendered tree.
 * @param {string} label - the label to click.
 */
const click = (tree, label) => {
  const button = buttonOf(tree, label);
  assert.ok(button !== undefined, `the tree offers "${label}"`);
  button.props.onClick();
};

/**
 * A stand-in `window.sessionStorage` that keeps writes.
 * @param {any} sandbox - the loaded client's sandbox.
 * @returns {Map<string, string>} the backing store.
 */
const memoryStorage = (sandbox) => {
  /** @type {Map<string, string>} */
  const store = new Map();
  sandbox.window.sessionStorage = {
    /** @param {string} key */
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    /** @param {string} key @param {string} value */
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  return store;
};

/**
 * Load the client and expose the reminder slots with their real props.
 * @param {{ summary?: Record<string, unknown>, preset?: string | null, target?: string, paths?: string[], settings?: boolean | "throws", presets?: boolean }} [options] - session summary, projected preset, configured target, recorded paths, how the settings service behaves, and whether the preset service exists.
 */
const accessHarness = ({ summary = {}, preset = "standard", target = "wsl", paths = [], settings = true, presets = true } = {}) => {
  /** @type {Array<{ ns: string, patch: Record<string, unknown>, revision: unknown }>} */
  const updates = [];
  /** @type {Array<[string, string]>} */
  const selects = [];
  /** @type {{ ok: boolean, error?: { message: string } }} */
  let selectAnswer = { ok: true };
  /** @type {{ ok: boolean, error?: { message: string } }} */
  let updateAnswer = { ok: true };
  const { module: client, sandbox } = loadClient();
  /** @type {{ value: string | null }} */
  const projection = { value: preset };
  /** @type {Record<string, unknown>} */
  const settingsService = settings === "throws"
    ? { describe: async () => { throw new Error("settings host unavailable"); } }
    : settings
      ? {
        describe: async () => ({
          ok: true,
          value: {
            writable: true,
            namespaces: [{
              ns: "auto-preset",
              revision: 7,
              value: { windowsWorkspaces: paths, preset: target },
            }],
          },
        }),
        /**
         * @param {string} ns
         * @param {Record<string, unknown>} patch
         * @param {unknown} revision
         */
        update: async (ns, patch, revision) => {
          updates.push({ ns, patch, revision });
          return updateAnswer;
        },
      }
      : {};
  const services = {
    ...(settings === true || settings === "throws" ? { "remote.settings": settingsService } : {}),
    ...(presets
      ? {
        "remote.agentPresets": {
          /**
           * @param {string} sessionId
           * @param {string} next
           */
          select: async (sessionId, next) => {
            selects.push([sessionId, next]);
            return selectAnswer;
          },
        },
      }
      : {}),
  };
  const harness = makeCtx({ services });
  client.apply(harness.ctx);
  /** @param {string} name */
  const slotOf = (name) => {
    const entry = harness.registrations.find((candidate) => candidate.spec.name === name);
    assert.ok(entry !== undefined, `the module registers ${name}`);
    return entry;
  };
  /**
   * @param {string} name - the slot to render.
   * @param {string} [sessionId] - the active session.
   */
  const mount = (name, sessionId = "s1") => {
    const element = slotOf(name).render({
      sessionId,
      useSessions: (/** @type {(state: any) => any} */ selector) => selector({ byId: { [sessionId]: summary } }),
      useProjection: () => projection.value,
    });
    assert.equal(typeof element?.type, "function", `${name} renders a component`);
    return { element, ...mountComponent(element.type, element.props) };
  };
  return {
    updates,
    selects,
    projection,
    sandbox,
    slotOf,
    /** @param {string} message - the refusal the next switch returns. */
    failSwitch(message) { selectAnswer = { ok: false, error: { message } }; },
    /** @param {string} message - the refusal the next settings write returns. */
    failWrite(message) { updateAnswer = { ok: false, error: { message } }; },
    /** @param {string} [sessionId] */
    banner: (sessionId) => mount("conversation.input.dock", sessionId),
    /** @param {string} [sessionId] */
    badge: (sessionId) => mount("conversation.session.header.utilities", sessionId),
  };
};

test("the client module registers under the plugin id and injects the slots service", () => {
  const { definition, module: client } = loadClient();
  assert.equal(definition.id, "dsh-plugin-wsl-env");
  assert.deepEqual([...client.inject], ["slots"]);
});

test("apply occupies the panel, the dock warning, the header badge, and the overlay", () => {
  const { module: client } = loadClient();
  const harness = makeCtx();
  client.apply(harness.ctx);
  const specs = harness.registrations.map((entry) => entry.spec);
  assert.deepEqual(specs.map((spec) => spec.name), [
    "sidebar.panellist",
    "main",
    "conversation.input.dock",
    "conversation.session.header.utilities",
    "shell.overlay",
  ]);
  /** @param {string} name */
  const byName = (name) => specs.find((spec) => spec.name === name);
  assert.equal(byName("sidebar.panellist")?.id, "wsl-env");
  assert.equal(byName("sidebar.panellist")?.order, 25);
  assert.equal(byName("main")?.key, "wsl-env");
  assert.equal(byName("conversation.input.dock")?.id, "wsl-env.access-mode");
  assert.equal(byName("conversation.input.dock")?.order, 90);
  assert.equal(byName("conversation.session.header.utilities")?.id, "wsl-env.access-mode-badge");
  assert.equal(byName("conversation.session.header.utilities")?.order, 90);
  assert.equal(byName("shell.overlay")?.id, "wsl-access-choice");
  assert.equal(byName("shell.overlay")?.order, 100);
});

test("the session-header menu posts a WSL workspace to the route the host registers", async () => {
  const { module: client, sandbox } = loadClient();
  /** @type {Array<{ url: string, init: any }>} */
  const requests = [];
  sandbox.fetch = async (/** @type {string} */ url, /** @type {any} */ init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const harness = makeCtx({ sessions: { s1: { cwd: WSL } } });
  client.apply(harness.ctx);
  const menu = harness.menus[0];
  assert.ok(menu !== undefined, "the row registers one menu item");
  assert.equal(menu.id, "wsl-env.openInVSCode");
  assert.equal(menu.target, "sessionHeader");
  assert.equal(menu.order, 505);
  const items = menu.resolve({ sessionId: "s1" });
  assert.equal(items.length, 1, "a WSL workspace offers the item");
  const item = items[0];
  assert.ok(item !== undefined);
  assert.match(item.label, /VS Code/);
  await item.run();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, OPEN_IN_APP_PATH, "the client posts to the path the host row registers");
  assert.equal(requests[0]?.init.method, "POST");
  assert.equal(requests[0]?.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0]?.init.body), { path: WSL });
});

test("the item is absent outside a WSL workspace and surfaces the route's error", async () => {
  const { module: client, sandbox } = loadClient();
  const harness = makeCtx({ sessions: { win: { cwd: WINDOWS }, bare: {} } });
  client.apply(harness.ctx);
  const menu = harness.menus[0];
  assert.ok(menu !== undefined);
  assert.equal(menu.resolve({ sessionId: "win" }).length, 0, "a Windows folder keeps the shipped menu");
  assert.equal(menu.resolve({ sessionId: "bare" }).length, 0, "a session without a workspace offers nothing");
  assert.equal(menu.resolve({ sessionId: "absent" }).length, 0);

  const wslHarness = makeCtx({ sessions: { s1: { cwd: WSL } } });
  client.apply(wslHarness.ctx);
  const wslMenu = wslHarness.menus[0];
  assert.ok(wslMenu !== undefined);
  const [item] = wslMenu.resolve({ sessionId: "s1" });
  assert.ok(item !== undefined);

  sandbox.fetch = async () => new Response(JSON.stringify({ error: "找不到 VS Code；可在 wsl-open-in-app 行配置 executable" }), { status: 502 });
  await assert.rejects(item.run(), /executable/, "the route's own message reaches the operator");

  sandbox.fetch = async () => new Response("not json", { status: 500 });
  await assert.rejects(item.run(), /HTTP 500/, "a body that is not JSON still names the status");
});

test("a newly added distro workspace raises the access prompt, an existing one does not", () => {
  const { module: client } = loadClient();
  const snapshot = { phase: "ready", items: [{ workspaceId: "w1", path: WINDOWS }] };
  const harness = makeCtx({ snapshot });
  client.apply(harness.ctx);
  const overlay = harness.registrations.find((entry) => entry.spec.name === "shell.overlay");
  assert.ok(overlay !== undefined);
  const render = overlay.render;
  assert.equal(typeof render, "function");
  /** @returns {any} the prompt element, or null when nothing is pending. */
  const renderPrompt = () => {
    const element = render({});
    return element.type(element.props);
  };
  assert.equal(renderPrompt(), null, "the startup catalog is the baseline");

  snapshot.items.push({ workspaceId: "w2", path: WSL });
  harness.fireWorkspace();
  const dialog = renderPrompt();
  assert.ok(dialog !== null && dialog !== undefined, "a new distro workspace is asked about");
  const panel = findElement(dialog, (element) => element.props?.role === "dialog");
  assert.ok(panel !== undefined, "the prompt is an accessible dialog");
  assert.ok(texts(dialog).some((text) => text === WSL), "the prompt names the workspace");
});

test("a newly added Windows workspace never raises the prompt", () => {
  const { module: client } = loadClient();
  const snapshot = { phase: "ready", items: [{ workspaceId: "w1", path: WINDOWS }] };
  const harness = makeCtx({ snapshot });
  client.apply(harness.ctx);
  const overlay = harness.registrations.find((entry) => entry.spec.name === "shell.overlay");
  assert.ok(overlay !== undefined);
  const render = overlay.render;
  snapshot.items.push({ workspaceId: "w3", path: "C:\\Users\\you\\other" });
  harness.fireWorkspace();
  const element = render({});
  assert.equal(element.type(element.props), null, "a Windows folder keeps its own environment");
});

test("the host-mode reminder stays hidden when the environment is right or unknown", async () => {
  for (const scenario of [
    { name: "the WSL preset", summary: { cwd: WSL }, preset: "wsl" },
    { name: "a Windows workspace", summary: { cwd: WINDOWS }, preset: "standard" },
    { name: "an empty projection", summary: { cwd: WSL }, preset: "" },
    { name: "an absent projection", summary: { cwd: WSL }, preset: null },
    { name: "a subagent", summary: { cwd: WSL, origin: "subagent" }, preset: "standard" },
    { name: "a configured custom target", summary: { cwd: WSL }, preset: "linux", target: "linux" },
  ]) {
    const harness = accessHarness(scenario);
    const banner = harness.banner();
    await banner.settle();
    assert.equal(banner.current(), null, `${scenario.name} must not warn`);
    banner.unmount();
  }
});

test("the reminder names the host environment and offers the fix that applies", async () => {
  const blank = accessHarness({ summary: { cwd: WSL, blank: true } });
  const banner = blank.banner();
  await banner.settle();
  const tree = banner.current();
  const shown = texts(tree).join("\n");
  assert.match(shown, /Windows 宿主模式/);
  assert.match(shown, /PowerShell/, "the command surface is named");
  assert.match(shown, /9p/, "the file share is named");
  assert.match(shown, /Ubuntu/, "the distro is named");
  assert.ok(buttonOf(tree, "切换为 WSL 模式") !== undefined, "a blank session can be switched in place");
  assert.ok(buttonOf(tree, "收起") !== undefined);
  banner.unmount();

  const started = accessHarness({ summary: { cwd: WSL, blank: false }, paths: [WSL] });
  const startedBanner = started.banner();
  await startedBanner.settle();
  const startedTree = startedBanner.current();
  assert.match(texts(startedTree).join("\n"), /该目录记录为“Windows 访问”/, "the record is named");
  assert.equal(buttonOf(startedTree, "切换为 WSL 模式"), undefined, "a session with history cannot switch");
  assert.ok(buttonOf(startedTree, "以后用 WSL 打开") !== undefined, "but the record can be corrected");
  startedBanner.unmount();

  const fixed = accessHarness({ summary: { cwd: WSL, blank: false }, paths: [] });
  const fixedBanner = fixed.banner();
  await fixedBanner.settle();
  assert.match(texts(fixedBanner.current()).join("\n"), /本会话已固定为宿主模式/, "the durable fix is named");
  fixedBanner.unmount();

  const sibling = accessHarness({ summary: { cwd: WSL, blank: false }, paths: [`${WSL}-other`] });
  const siblingBanner = sibling.banner();
  await siblingBanner.settle();
  const siblingTree = siblingBanner.current();
  assert.doesNotMatch(texts(siblingTree).join("\n"), /该目录记录为/, "a sibling directory is not this workspace");
  assert.equal(buttonOf(siblingTree, "以后用 WSL 打开"), undefined);
  siblingBanner.unmount();
});

test("a blank session switches to the configured preset and unrecords the directory", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: true }, paths: [WSL] });
  const banner = harness.banner();
  await banner.settle();
  click(banner.current(), "切换为 WSL 模式");
  harness.projection.value = "wsl";
  await banner.settle();
  assert.deepEqual(harness.selects, [["s1", "wsl"]], "the switch targets the configured preset");
  assert.equal(harness.updates.length, 1, "exactly one settings write");
  assert.equal(harness.updates[0]?.ns, "auto-preset");
  assert.deepEqual(
    [...(/** @type {string[]} */ (harness.updates[0]?.patch.windowsWorkspaces ?? []))],
    [],
    "the Windows-access record no longer names the workspace",
  );
  assert.equal(harness.updates[0]?.revision, 7, "the write carries the revision it read");
  assert.equal(banner.current(), null, "the projection flip unmounts the reminder");
  banner.unmount();
});

test("a custom target preset is the one offered and written", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: true }, target: "linux" });
  const banner = harness.banner();
  await banner.settle();
  assert.notEqual(banner.current(), null, "a non-WSL target still warns");
  click(banner.current(), "切换为 WSL 模式");
  await banner.settle();
  assert.deepEqual(harness.selects, [["s1", "linux"]], "the settings row's preset is the target");
  banner.unmount();
});

test("a refused switch keeps the reminder visible and says why", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: true } });
  harness.failSwitch("preset 已锁定");
  const banner = harness.banner();
  await banner.settle();
  click(banner.current(), "切换为 WSL 模式");
  await banner.settle();
  const shown = texts(banner.current()).join("\n");
  assert.match(shown, /切换失败/);
  assert.match(shown, /preset 已锁定/, "the host's reason reaches the operator");
  assert.ok(buttonOf(banner.current(), "切换为 WSL 模式") !== undefined, "the action stays available");
  banner.unmount();
});

test("collapsing the reminder leaves the header badge, and a new session asks again", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: false }, paths: [WSL] });
  const store = memoryStorage(harness.sandbox);
  const banner = harness.banner();
  await banner.settle();
  assert.notEqual(banner.current(), null);
  click(banner.current(), "收起");
  await banner.settle();
  assert.equal(store.get("wsl-env.access-mode.dismissed:s1"), "1");
  assert.equal(banner.current(), null, "the dock warning is collapsed");
  banner.unmount();

  const badge = harness.badge();
  await badge.settle();
  assert.equal(texts(badge.current()).join(""), "WSL工作区正以Windows模式打开", "the fact survives collapsing");
  assert.match(String(badge.current()?.props?.title ?? ""), /9p/);
  assert.match(String(badge.current()?.props?.title ?? ""), /Ubuntu/);
  badge.unmount();

  const otherBadge = harness.badge("s2");
  await otherBadge.settle();
  assert.equal(otherBadge.current(), null, "another session was not collapsed");
  otherBadge.unmount();

  const fresh = harness.banner("s2");
  await fresh.settle();
  assert.notEqual(fresh.current(), null, "a new session asks again");
  fresh.unmount();
});

test("collapsing the reminder reveals the header badge without a remount", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: false }, paths: [WSL] });
  memoryStorage(harness.sandbox);
  const banner = harness.banner();
  const badge = harness.badge();
  await banner.settle();
  await badge.settle();
  assert.equal(badge.current(), null, "the badge stays quiet while the banner shows");
  click(banner.current(), "收起");
  await banner.settle();
  await badge.settle();
  assert.equal(banner.current(), null, "the banner is collapsed");
  const badgeTree = badge.current();
  assert.ok(badgeTree !== null && badgeTree !== undefined, "the already-mounted badge appears");
  assert.equal(texts(badgeTree).join(""), "WSL工作区正以Windows模式打开", "the badge updates in place");
  banner.unmount();
  badge.unmount();
});

test("a started session can drop the recorded Windows-access directory", async () => {
  const legacy = "\\\\wsl.localhost\\Ubuntu\\home\\you\\legacy";
  const harness = accessHarness({ summary: { cwd: WSL, blank: false }, paths: [legacy, WSL] });
  const banner = harness.banner();
  await banner.settle();
  click(banner.current(), "以后用 WSL 打开");
  await banner.settle();
  assert.equal(harness.updates.length, 1, "exactly one settings write");
  assert.equal(harness.updates[0]?.ns, "auto-preset");
  assert.deepEqual(
    [...(/** @type {string[]} */ (harness.updates[0]?.patch.windowsWorkspaces ?? []))],
    [legacy],
    "only this workspace leaves the record",
  );
  assert.equal(harness.updates[0]?.revision, 7);
  assert.match(texts(banner.current()).join("\n"), /已记录/);
  assert.equal(buttonOf(banner.current(), "以后用 WSL 打开"), undefined, "the action is spent");
  banner.unmount();
});

test("the reminder fails visible when the settings record is unavailable", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: true }, settings: false });
  const banner = harness.banner();
  await banner.settle();
  assert.notEqual(banner.current(), null, "a missing record warns instead of guessing");
  assert.ok(buttonOf(banner.current(), "切换为 WSL 模式") !== undefined);
  banner.unmount();
});

test("the panel lists the recorded Windows-access directories", async () => {
  const legacy = "\\\\wsl.localhost\\Ubuntu\\home\\you\\legacy";
  const harness = accessHarness({ paths: [WSL, legacy] });
  harness.sandbox.fetch = async () => new Response(JSON.stringify({
    distros: [],
    cached: [],
    running: [],
  }), { status: 200, headers: { "content-type": "application/json" } });
  const main = harness.slotOf("main");
  const element = main.render({});
  assert.equal(typeof element?.type, "function", "the main slot renders the panel");
  const panel = mountComponent(element.type, element.props);
  await panel.settle(40);
  const tree = panel.current();
  assert.ok(
    findElement(tree, (entry) => entry.props?.title === "Windows 访问工作区") !== undefined,
    "the audit card is present",
  );
  const shown = texts(tree).join("\n");
  assert.ok(shown.includes(WSL), "the recorded workspace is listed");
  assert.ok(shown.includes(legacy), "every recorded directory is listed");
  panel.unmount();
});

test("the reminder fails visible when the settings read throws", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: true }, settings: "throws" });
  const banner = harness.banner();
  await banner.settle();
  assert.notEqual(banner.current(), null, "a throwing settings read warns instead of disappearing");
  assert.ok(buttonOf(banner.current(), "切换为 WSL 模式") !== undefined, "the fallback target is actionable");
  banner.unmount();
});

test("a switch that cannot record the fix keeps the warning and says what failed", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: true }, paths: [WSL] });
  harness.failWrite("配置只读");
  const banner = harness.banner();
  await banner.settle();
  click(banner.current(), "切换为 WSL 模式");
  await banner.settle();
  assert.deepEqual(harness.selects, [["s1", "wsl"]], "the switch itself still ran");
  assert.equal(harness.updates.length, 1, "the record write was attempted");
  const shown = texts(banner.current()).join("\n");
  assert.match(shown, /已切换，但写入访问方式失败/);
  assert.match(shown, /配置只读/, "the settings failure is named");
  banner.unmount();
});

test("a switch without the preset service reports the unavailable session service", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: true }, presets: false });
  const banner = harness.banner();
  await banner.settle();
  click(banner.current(), "切换为 WSL 模式");
  await banner.settle();
  const shown = texts(banner.current()).join("\n");
  assert.match(shown, /切换失败/);
  assert.match(shown, /会话服务不可用/);
  assert.equal(harness.updates.length, 0);
  banner.unmount();
});

test("a failed record correction leaves the action available and names the failure", async () => {
  const harness = accessHarness({ summary: { cwd: WSL, blank: false }, paths: [WSL] });
  harness.failWrite("写入被拒绝");
  const banner = harness.banner();
  await banner.settle();
  click(banner.current(), "以后用 WSL 打开");
  await banner.settle();
  const shown = texts(banner.current()).join("\n");
  assert.match(shown, /写入失败/);
  assert.match(shown, /写入被拒绝/);
  assert.ok(buttonOf(banner.current(), "以后用 WSL 打开") !== undefined, "the operator can retry");
  banner.unmount();
});

test("the recorded-directory comparison is case-insensitive and ignores a trailing separator", async () => {
  const harness = accessHarness({
    summary: { cwd: "\\\\WSL.LOCALHOST\\UBUNTU\\home\\you\\proj", blank: false },
    paths: ["\\\\wsl.localhost\\ubuntu\\home\\you\\proj\\"],
  });
  const banner = harness.banner();
  await banner.settle();
  assert.match(
    texts(banner.current()).join("\n"),
    /该目录记录为“Windows 访问”/,
    "UNC comparison matches the server's case-insensitive rule",
  );
  banner.unmount();
});

test("the menu item tolerates a session snapshot that is not ready", () => {
  for (const sessionList of [null, {}, { byId: undefined }]) {
    const { module: client } = loadClient();
    const harness = makeCtx({ sessionList });
    client.apply(harness.ctx);
    const menu = harness.menus[0];
    assert.ok(menu !== undefined);
    assert.equal(menu.resolve({ sessionId: "s1" }).length, 0, "a missing snapshot offers nothing");
  }
});
