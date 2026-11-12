/**
 * Browser-side harness for the web client.
 *
 * `client.js` is loaded by the harness's web loader and receives React from
 * the host. This page supplies the same two things from a real browser
 * runtime: a `window.__ModuleLoader__` capture and a React module. It then
 * mounts the registered slot components into real DOM containers so the
 * Playwright suite can assert layout, visibility, and click behaviour.
 *
 * Built and injected by `test/browser/e2e.test.mjs`; never shipped.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import "../../client.js";

const WINDOWS_STATUS = {
  distros: [],
  cached: [],
  running: [],
};

/** The module definition `client.js` registered. */
const definition = /** @type {any} */ (window).__moduleDefinition;
if (definition === undefined || definition === null) {
  throw new Error("client.js did not register through window.__ModuleLoader__");
}

/** Calls made by the client, read by the Playwright assertions. */
const records = {
  selects: [],
  updates: [],
  fetches: [],
  menus: [],
};

/** Live React roots, unmounted before the next scenario. */
const roots = [];

/** The slot name for each scenario kind. */
const SLOTS = {
  banner: "conversation.input.dock",
  badge: "conversation.session.header.utilities",
  panel: "main",
};

/**
 * One JSON response.
 * @param {unknown} body - the payload.
 * @param {number} [status] - HTTP status.
 * @returns {Response} the response.
 */
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

/**
 * The settings service for one scenario.
 * @param {any} config - the scenario config.
 * @returns {any} the service, or undefined when it should be absent.
 */
const settingsService = (config) => {
  if (config.settings === "missing") return undefined;
  return {
    describe: async () => {
      if (config.settings === "throws") throw new Error("settings host unavailable");
      return {
        ok: true,
        value: {
          writable: true,
          namespaces: [{
            ns: "auto-preset",
            revision: 7,
            value: {
              windowsWorkspaces: config.paths ?? [],
              preset: config.target ?? "wsl",
            },
          }],
        },
      };
    },
    update: async (/** @type {string} */ ns, /** @type {Record<string, unknown>} */ patch, /** @type {unknown} */ revision) => {
      records.updates.push({ ns, patch, revision });
      return config.update === "refuse"
        ? { ok: false, error: { message: "配置只读" } }
        : { ok: true };
    },
  };
};

/**
 * Build the stand-in client root context for one scenario.
 * @param {any} config - the scenario config.
 * @returns {{ ctx: any, registrations: Array<{ spec: any, render: any }>, menus: any[] }} the context and what it captured.
 */
const createCtx = (config) => {
  /** @type {Array<{ spec: any, render: any }>} */
  const registrations = [];
  /** @type {any[]} */
  const menus = [];
  const settings = settingsService(config);
  const services = {
    workspaces: {
      list: {
        getSnapshot: () => config.workspaceSnapshot ?? { phase: "ready", items: [] },
        subscribe: () => () => {},
      },
    },
    "remote.agentPresets": {
      select: async (/** @type {string} */ sessionId, /** @type {string} */ preset) => {
        records.selects.push([sessionId, preset]);
        return config.select === "refuse"
          ? { ok: false, error: { message: "preset 已锁定" } }
          : { ok: true };
      },
    },
    ...(settings === undefined ? {} : { "remote.settings": settings }),
  };
  const ctx = {
    slots: {
      register: (/** @type {any} */ spec, /** @type {any} */ render) => {
        registrations.push({ spec, render });
        return { spec };
      },
      inject: (/** @type {string} */ _name, /** @type {() => Generator<any, void, unknown>} */ install) => {
        for (const entry of install()) void entry;
      },
    },
    get: (/** @type {string} */ name) => services[name],
    inject: (/** @type {string[]} */ names, /** @type {(scope: any) => void} */ install) => {
      const effect = (/** @type {() => unknown} */ callback) => callback();
      if (names.includes("contextMenus")) {
        install({
          contextMenus: {
            register: (/** @type {any} */ options) => {
              menus.push(options);
              return () => {};
            },
          },
          sessions: { list: { getSnapshot: () => ({ byId: config.sessions ?? {} }) } },
          effect,
        });
      }
      if (names.includes("workspaces")) {
        install({
          get: (/** @type {string} */ name) => (name === "workspaces" ? services.workspaces : undefined),
          effect,
        });
      }
    },
  };
  return { ctx, registrations, menus };
};

/** Unmount every root and clear the page before the next scenario. */
const clear = () => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = "";
  records.selects.length = 0;
  records.updates.length = 0;
  records.fetches.length = 0;
  records.menus.length = 0;
};

/**
 * Mount one scenario.
 * @param {any} [config] - summary/preset/paths/settings and the slots to mount.
 * @returns {{ slots: string[], menus: number }} what was mounted.
 */
const render = (config = {}) => {
  clear();
  const wanted = config.slots ?? ["banner"];
  const summary = config.summary ?? {};
  const projection = { value: config.preset ?? "standard" };
  const sessionId = config.sessionId ?? "s1";
  /** @type {any} */
  const props = {
    sessionId,
    useSessions: (/** @type {(state: any) => any} */ selector) => selector({ byId: { [sessionId]: summary } }),
    useProjection: () => projection.value,
  };
  /** @type {{ url: string, method: string, body: unknown }[]} */
  window.fetch = async (/** @type {any} */ input, /** @type {any} */ init = {}) => {
    const url = String(input);
    records.fetches.push({ url, method: init.method ?? "GET", body: init.body ?? null });
    if (url.startsWith("/api/wsl-env/status")) return json(config.status ?? WINDOWS_STATUS);
    if (url === "/api/wsl-env/open-in-app") return json(config.openInApp ?? { ok: true });
    return json({ error: `unexpected fetch ${url}` }, 500);
  };
  const client = definition.factory((/** @type {string} */ name) => {
    if (name === "react") return React;
    throw new Error(`unexpected require(${name})`);
  });
  const { ctx, registrations, menus } = createCtx(config);
  client.apply(ctx);
  records.menus.push(...menus);
  const mounted = [];
  for (const kind of wanted) {
    const name = /** @type {Record<string, string>} */ (SLOTS)[kind];
    const registration = registrations.find((entry) => entry.spec.name === name);
    if (registration === undefined) throw new Error(`no registration for ${name}`);
    const container = document.createElement("div");
    container.id = `slot-${kind}`;
    document.body.append(container);
    const root = createRoot(container);
    root.render(registration.render(kind === "panel" ? {} : props));
    roots.push(root);
    mounted.push(kind);
  }
  return { slots: mounted, menus: records.menus.length };
};

/** @type {any} */ (window).__E2E__ = { render, clear, records };
