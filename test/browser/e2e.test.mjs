/**
 * Browser-level end-to-end checks for the web client.
 *
 * These run the real `client.js` bundle in headless Chromium with real React
 * (the same hook API the Desktop host supplies), mount the plugin's slot
 * components into a real DOM, and drive them with real pointer input. The
 * Node suite (`test/client.test.mjs`) owns the loader wiring and the
 * state-machine branches; this suite owns what only a browser can show:
 * actual layout, visibility, focusable buttons, and effect timing across two
 * mounted components.
 *
 * The harness does not boot the Desktop app; it isolates the plugin's web
 * bundle from the host so a failure names the plugin, not the shell. The
 * Desktop integration remains the real-machine probe's job.
 *
 *   pnpm exec playwright install chromium   # once
 *   pnpm run test:browser
 *
 * @module test/browser/e2e
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const WSL = "\\\\wsl.localhost\\Ubuntu\\home\\you\\proj";
const LEGACY = "\\\\wsl.localhost\\Ubuntu\\home\\you\\legacy";
const BADGE = "WSL工作区正以Windows模式打开";

const built = await build({
  entryPoints: [join(HERE, "harness.js")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
});
const bundle = built.outputFiles?.[0]?.text;
assert.ok(typeof bundle === "string" && bundle.length > 0, "esbuild produced the harness bundle");

/** @type {import("playwright").Browser | undefined} */
let browser;
/** @type {import("node:http").Server | undefined} */
let server;
let origin = "";

before(async () => {
  server = createServer((request, response) => {
    if (request.url === "/bundle.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(bundle);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><body style="margin:0;background:#1f1f1f;color:#e6e6e6;font-family:sans-serif"></body></html>
<script>
  window.__moduleDefinition = null;
  window.__ModuleLoader__ = { load(definition) { window.__moduleDefinition = definition; } };
</script>
<script src="/bundle.js"></script>`);
  });
  await new Promise((resolve) => { server?.listen(0, "127.0.0.1", () => resolve(undefined)); });
  const address = server?.address();
  assert.ok(address !== null && typeof address === "object", "the harness server got a port");
  origin = `http://127.0.0.1:${address.port}`;
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      `headless Chromium is unavailable: ${/** @type {Error} */ (error).message}\n` +
      "install it once with: pnpm exec playwright install chromium",
    );
  }
});

after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

/**
 * A fresh page with the client loaded and the E2E bridge available.
 * @param {number} [width] - the viewport width, for layout checks.
 * @returns {Promise<import("playwright").Page>} the page.
 */
const open = async (width = 1000) => {
  assert.ok(browser !== undefined, "the browser is running");
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__E2E__));
  return page;
};

/**
 * Render one scenario in the page.
 * @param {import("playwright").Page} page - the page.
 * @param {Record<string, unknown>} config - the scenario.
 * @returns {Promise<{ slots: string[], menus: number }>} what was mounted.
 */
const render = async (page, config) => page.evaluate((/** @type {any} */ next) => (
  /** @type {any} */ (globalThis).__E2E__.render(next)
), config);

/**
 * Read the client's recorded calls.
 * @param {import("playwright").Page} page - the page.
 * @returns {Promise<{ selects: unknown[], updates: any[], fetches: any[] }>} the records.
 */
const calls = async (page) => page.evaluate(() => {
  const e2e = /** @type {any} */ (globalThis).__E2E__;
  return {
    selects: e2e.records.selects,
    updates: e2e.records.updates,
    fetches: e2e.records.fetches,
  };
});

/**
 * The computed display and radius of one element.
 * @param {import("playwright").Locator} locator - the element.
 * @returns {Promise<{ display: string, borderRadius: string }>} the computed style.
 */
const boxStyle = async (locator) => locator.evaluate((element) => {
  const style = /** @type {any} */ (globalThis).getComputedStyle(element);
  return { display: style.display, borderRadius: style.borderRadius };
});

test("the browser renders the host-mode warning with the shipped layout", async () => {
  const page = await open();
  try {
    await render(page, {
      slots: ["banner"],
      summary: { cwd: WSL, blank: true },
      preset: "standard",
      target: "wsl",
      paths: [],
    });
    const banner = page.getByRole("status");
    await banner.waitFor({ state: "visible" });
    const text = await banner.innerText();
    assert.match(text, /当前会话运行在 Windows 宿主模式/);
    assert.match(text, /PowerShell/);
    assert.match(text, /9p/);
    assert.match(text, /Ubuntu/);
    assert.deepEqual(await boxStyle(banner), { display: "flex", borderRadius: "8px" });
    await page.getByRole("button", { name: "切换为 WSL 模式" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "收起" }).waitFor({ state: "visible" });

    await render(page, {
      slots: ["banner"],
      summary: { cwd: WSL },
      preset: "wsl",
      target: "wsl",
      paths: [],
    });
    assert.equal(await page.getByRole("status").count(), 0, "a WSL-preset session stays silent");
  } finally {
    await page.close();
  }
});

test("the browser switch records the preset and the access-record correction", async () => {
  const page = await open();
  try {
    await render(page, {
      slots: ["banner"],
      summary: { cwd: WSL, blank: true },
      preset: "standard",
      target: "wsl",
      paths: [WSL],
    });
    await page.getByRole("button", { name: "切换为 WSL 模式" }).click();
    await page.waitForFunction(() => {
      const e2e = /** @type {any} */ (globalThis).__E2E__;
      return e2e.records.selects.length === 1 && e2e.records.updates.length === 1;
    });
    const recorded = await calls(page);
    assert.deepEqual(recorded.selects, [["s1", "wsl"]]);
    assert.equal(recorded.updates[0]?.ns, "auto-preset");
    assert.equal(recorded.updates[0]?.revision, 7);
    assert.deepEqual(recorded.updates[0]?.patch.windowsWorkspaces, []);
  } finally {
    await page.close();
  }
});

test("the browser collapse reveals the badge without a remount", async () => {
  const page = await open();
  try {
    await render(page, {
      slots: ["banner", "badge"],
      summary: { cwd: WSL, blank: false },
      preset: "standard",
      target: "wsl",
      paths: [WSL],
    });
    const banner = page.getByRole("status");
    await banner.waitFor({ state: "visible" });
    assert.equal(await page.getByText(BADGE, { exact: true }).count(), 0, "the badge is quiet while the banner shows");
    await page.getByRole("button", { name: "收起" }).click();
    const badge = page.getByText(BADGE, { exact: true });
    await badge.waitFor({ state: "visible" });
    assert.deepEqual(await boxStyle(badge), { display: "inline-flex", borderRadius: "999px" });
    assert.equal(await page.getByRole("status").count(), 0, "the banner is collapsed");
  } finally {
    await page.close();
  }
});

test("the browser panel lists the recorded Windows-access directories", async () => {
  const page = await open();
  try {
    await render(page, {
      slots: ["panel"],
      paths: [WSL, LEGACY],
      status: { distros: [], cached: [], running: [] },
    });
    await page.getByText("Windows 访问工作区", { exact: true }).waitFor({ state: "visible" });
    await page.getByText(WSL, { exact: true }).waitFor({ state: "visible" });
    await page.getByText(LEGACY, { exact: true }).waitFor({ state: "visible" });
    const callsNow = await calls(page);
    assert.ok(callsNow.fetches.some((entry) => entry.url === "/api/wsl-env/status"), "the panel read the status route");
  } finally {
    await page.close();
  }
});

test("the browser keeps the warning when the settings read throws", async () => {
  const page = await open();
  try {
    await render(page, {
      slots: ["banner"],
      summary: { cwd: WSL, blank: true },
      preset: "standard",
      target: "wsl",
      paths: [],
      settings: "throws",
    });
    await page.getByRole("status").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "切换为 WSL 模式" }).waitFor({ state: "visible" });
  } finally {
    await page.close();
  }
});

test("the browser menu posts only a WSL workspace to the open-in-app route", async () => {
  const page = await open();
  try {
    await render(page, { slots: [], sessions: { s1: { cwd: WSL }, win: { cwd: "C:\\\\Users\\\\you" } } });
    const result = await page.evaluate(async () => {
      const e2e = /** @type {any} */ (globalThis).__E2E__;
      const menu = e2e.records.menus[0];
      const items = menu.resolve({ sessionId: "s1" });
      const winItems = menu.resolve({ sessionId: "win" });
      await items[0].run();
      return {
        label: items[0].label,
        wslCount: items.length,
        winCount: winItems.length,
        fetches: e2e.records.fetches,
      };
    });
    assert.equal(result.wslCount, 1);
    assert.equal(result.winCount, 0, "a Windows folder keeps the shipped menu");
    assert.match(result.label, /VS Code/);
    assert.equal(result.fetches.length, 1);
    assert.equal(result.fetches[0].url, "/api/wsl-env/open-in-app");
    assert.equal(result.fetches[0].method, "POST");
    assert.deepEqual(JSON.parse(result.fetches[0].body), { path: WSL });
  } finally {
    await page.close();
  }
});


test("the browser wraps the warning inside a narrow composer without horizontal overflow", async () => {
  const page = await open(420);
  try {
    await render(page, {
      slots: ["banner"],
      summary: { cwd: WSL, blank: true },
      preset: "standard",
      target: "wsl",
      paths: [],
    });
    const banner = page.getByRole("status");
    await banner.waitFor({ state: "visible" });
    const metrics = await banner.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    assert.ok(metrics.width <= 420, `the banner stays inside the viewport (${metrics.width}px)`);
    assert.ok(metrics.scroll <= metrics.client + 1, "the warning does not overflow horizontally");
    await page.getByRole("button", { name: "切换为 WSL 模式" }).waitFor({ state: "visible" });
  } finally {
    await page.close();
  }
});
