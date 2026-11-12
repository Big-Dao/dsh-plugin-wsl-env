/**
 * Unit checks for the durable open-in-app bridge: URI conversion, editor
 * resolution, the detached-launch classifier, the route handler, and the row's
 * child-environment scrub plus route registration.
 *
 *   node --test test/open-in-app.test.mjs
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import {
  apply, createLauncher, createOpenInAppHandler, dropElectronRunAsNode, editorCandidates,
  editorUri, launchDetached, launchEnvironment, resolveEditor, OPEN_IN_APP_PATH,
} from "../lib/open-in-app.js";

/**
 * @typedef {object} Route
 * @property {string} path
 * @property {readonly string[]} methods
 * @property {"buffered" | "streaming"} requestBody
 * @property {(request: Request) => Promise<Response>} fetch
 */

/**
 * @typedef {object} Scope
 * @property {{ fetch: { register: (route: Route) => () => void } }} [connection]
 * @property {(name: string) => unknown} [get]
 * @property {(callback: () => () => void) => void} [effect]
 */

/** A child process stand-in that can emit the two events the launcher reads. */
class FakeChild extends EventEmitter {
  /** The launcher always unrefs a settled child. */
  unref() {}
}

/**
 * One scripted spawn: returns the same fake child every call.
 * @param {FakeChild} child - the child to return.
 * @returns {import("node:child_process").spawn} the spawn seam, cast through unknown.
 */
const spawnOf = (child) => /** @type {import("node:child_process").spawn} */ (
  /** @type {unknown} */ (() => child)
);

/**
 * Build one POST request for the route.
 * @param {unknown} body - JSON body, or a raw string when already serialized.
 * @param {string} [contentType] - request media type.
 * @returns {Request} the request.
 */
const post = (body, contentType = "application/json") => new Request("http://127.0.0.1/api/wsl-env/open-in-app", {
  method: "POST",
  headers: { "content-type": contentType },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("editorUri converts both WSL UNC spellings and encodes the path", () => {
  assert.equal(
    editorUri("\\\\wsl.localhost\\Ubuntu\\home\\andy\\my proj"),
    "vscode-remote://wsl%2BUbuntu/home/andy/my%20proj",
  );
  assert.equal(
    editorUri("\\\\wsl$\\Ubuntu\\home\\andy"),
    "vscode-remote://wsl%2BUbuntu/home/andy",
  );
  assert.equal(editorUri("C:\\Users\\andy\\proj"), undefined);
  assert.equal(editorUri("/home/andy/proj"), undefined);
  assert.equal(editorUri(""), undefined);
});

test("editorUri encodes reserved and non-ASCII path segments and handles the share root", () => {
  assert.equal(
    editorUri("\\\\wsl.localhost\\Ubuntu\\home\\andy\\a#b?c+d e"),
    "vscode-remote://wsl%2BUbuntu/home/andy/a%23b%3Fc%2Bd%20e",
    "a segment is a URI path component, not a query or fragment",
  );
  assert.equal(
    editorUri("\\\\wsl.localhost\\Ubuntu\\home\\andy\\项目"),
    "vscode-remote://wsl%2BUbuntu/home/andy/%E9%A1%B9%E7%9B%AE",
  );
  assert.equal(
    editorUri("\\\\wsl$\\Ubuntu"),
    "vscode-remote://wsl%2BUbuntu/",
    "a distro root still yields an absolute Remote-WSL path",
  );
  assert.equal(editorUri("\\\\wsl.localhost\\"), undefined, "a share without a distro is not a workspace");
  assert.equal(editorUri("\\\\wsl.localhost\\Ubuntu\\"), "vscode-remote://wsl%2BUbuntu/");
  assert.equal(editorUri("\\\\server\\share\\Ubuntu\\home"), undefined, "a plain UNC share is refused");
});

test("editorCandidates follows the install roots, and resolveEditor prefers an existing one", () => {
  const env = {
    LOCALAPPDATA: "C:\\Users\\andy\\AppData\\Local",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
  };
  const candidates = editorCandidates(env);
  assert.equal(candidates.length, 5);
  const first = candidates[0];
  const last = candidates.at(-1);
  assert.ok(first !== undefined);
  assert.ok(last !== undefined);
  assert.match(first, /Microsoft VS Code[\\/]Code\.exe$/, "VS Code in LOCALAPPDATA comes first");
  assert.match(last, /Program Files \(x86\)/, "the x86 root is the last fallback");
  assert.deepEqual(editorCandidates({}), []);
  assert.equal(resolveEditor({ executable: " C:\\Tools\\Code.exe " }, env, () => false), "C:\\Tools\\Code.exe");
  assert.equal(resolveEditor({ executable: "" }, env, (path) => path === first), first);
  assert.equal(resolveEditor({}, env, () => false), "Code.exe");
});

test("dropElectronRunAsNode removes only that name", () => {
  const env = { ELECTRON_RUN_AS_NODE: "1", PATH: "x" };
  assert.equal(dropElectronRunAsNode(env), true);
  assert.deepEqual(env, { PATH: "x" });
  assert.equal(dropElectronRunAsNode(env), false);
});

test("launchEnvironment scrubs the child copy without touching the source", () => {
  const source = { ELECTRON_RUN_AS_NODE: "1", PATH: "x" };
  assert.deepEqual(launchEnvironment(source), { PATH: "x" });
  assert.deepEqual(source, { ELECTRON_RUN_AS_NODE: "1", PATH: "x" });
});

test("launchDetached classifies exit, error, throw, and the watch window", async () => {
  const launchedChild = new FakeChild();
  const success = launchDetached("Code.exe", ["--folder-uri", "u"], { watchMs: 1000, env: {} }, spawnOf(launchedChild));
  launchedChild.emit("exit", 0, null);
  assert.equal(await success, "launched");

  const failedChild = new FakeChild();
  const failure = launchDetached("Code.exe", [], { watchMs: 1000, env: {} }, spawnOf(failedChild));
  failedChild.emit("exit", 1, null);
  assert.equal(await failure, "failed");

  const missingChild = new FakeChild();
  const missing = launchDetached("Code.exe", [], { watchMs: 1000, env: {} }, spawnOf(missingChild));
  missingChild.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));
  assert.equal(await missing, "missing");

  const otherChild = new FakeChild();
  const other = launchDetached("Code.exe", [], { watchMs: 1000, env: {} }, spawnOf(otherChild));
  otherChild.emit("error", Object.assign(new Error("denied"), { code: "EACCES" }));
  assert.equal(await other, "failed");

  const throwing = () => { throw new Error("bad argv"); };
  const thrown = /** @type {import("node:child_process").spawn} */ (/** @type {unknown} */ (throwing));
  assert.equal(await launchDetached("Code.exe", [], { watchMs: 1000, env: {} }, thrown), "failed");

  const liveChild = new FakeChild();
  assert.equal(await launchDetached("Code.exe", [], { watchMs: 5, env: {} }, spawnOf(liveChild)), "launched");
});

test("the route validates method, media type, body, and path before launching", async () => {
  /** @type {string[]} */
  const uris = [];
  const handler = createOpenInAppHandler({ launch: async (uri) => { uris.push(uri); return "launched"; } });

  const wrongMethod = await handler(new Request("http://127.0.0.1/api/wsl-env/open-in-app"));
  assert.equal(wrongMethod.status, 405);

  const wrongType = await handler(post({ path: "\\\\wsl.localhost\\Ubuntu\\home" }, "text/plain"));
  assert.equal(wrongType.status, 415);

  const badJson = await handler(post("{not json"));
  assert.equal(badJson.status, 400);

  const notObject = await handler(post("[]"));
  assert.equal(notObject.status, 400);

  const missingPath = await handler(post({}));
  assert.equal(missingPath.status, 400);

  const notUnc = await handler(post({ path: "C:\\proj" }));
  assert.equal(notUnc.status, 400);

  const ok = await handler(post({ path: "\\\\wsl.localhost\\Ubuntu\\home\\andy\\proj" }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {
    ok: true,
    uri: "vscode-remote://wsl%2BUbuntu/home/andy/proj",
  });

  const failed = await createOpenInAppHandler({ launch: async () => "failed" })(post({ path: "\\\\wsl.localhost\\Ubuntu\\home" }));
  assert.equal(failed.status, 502);

  const missing = await createOpenInAppHandler({ launch: async () => "missing" })(post({ path: "\\\\wsl.localhost\\Ubuntu\\home" }));
  assert.equal(missing.status, 502);
  const payload = /** @type {{ error?: string }} */ (await missing.json());
  assert.match(String(payload.error), /executable/);
  assert.deepEqual(uris, ["vscode-remote://wsl%2BUbuntu/home/andy/proj"]);
});

test("apply leaves the Host environment alone and registers the route", () => {
  const previous = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = "1";
  try {
    /** @type {Route[]} */
    const routes = [];
    /** @type {Array<() => () => void>} */
    const effects = [];
    const scope = {
      connection: {
        fetch: {
          /** @param {Route} route */
          register(route) {
            routes.push(route);
            return () => {};
          },
        },
      },
      /** @param {() => () => void} callback */
      effect(callback) {
        effects.push(callback);
        return undefined;
      },
    };
    const ctx = {
      /**
       * @param {readonly string[]} deps
       * @param {(scope: Scope) => void} callback
       */
      inject(deps, callback) {
        assert.deepEqual(deps, ["connection"]);
        callback(scope);
        return undefined;
      },
    };
    apply(ctx, {});
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, "1", "the Host environment is not mutated");
    assert.equal(routes.length, 1);
    const route = routes[0];
    assert.ok(route !== undefined);
    assert.equal(route.path, OPEN_IN_APP_PATH);
    assert.equal(route.methods[0], "POST");
    assert.equal(effects.length, 1);
    const dispose = effects[0];
    assert.ok(dispose !== undefined);
    dispose();
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previous;
  }
});

test("apply tolerates no connection and no inject, and still leaves the Host environment alone", () => {
  const previous = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = "1";
  try {
    apply({}, {});
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, "1", "no inject leaves the environment alone");

    const noConnection = [];
    apply({
      /**
       * @param {readonly string[]} deps
       * @param {(scope: Scope) => void} callback
       */
      inject(deps, callback) {
        assert.deepEqual(deps, ["connection"]);
        callback({ get: () => undefined, effect() {} });
        noConnection.push(true);
      },
    }, {});
    assert.equal(noConnection.length, 1);
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, "1", "a missing connection does not mutate the Host environment");

    /** @type {Route[]} */
    const routes = [];
    apply({
      /**
       * @param {readonly string[]} deps
       * @param {(scope: Scope) => void} callback
       */
      inject(deps, callback) {
        callback({
          get: () => ({ fetch: {
            /** @param {Route} route */
            register(route) { routes.push(route); return () => {}; },
          } }),
          effect() {},
        });
      },
    }, {});
    assert.equal(routes.length, 1);
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, "1", "registering the route does not mutate the Host environment");
  } finally {
    if (previous === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = previous;
  }
});

test("launchDetached hands --folder-uri, a detached stdio, and the scrubbed environment to spawn", async () => {
  /** @type {Array<{ command: string, args: readonly string[], options: Record<string, unknown> }>} */
  const calls = [];
  const child = new FakeChild();
  /**
   * @param {string} command
   * @param {readonly string[]} args
   * @param {Record<string, unknown>} options
   * @returns {FakeChild}
   */
  const spawnSpy = (command, args, options) => {
    calls.push({ command, args, options });
    return child;
  };
  const env = { PATH: "x" };
  const pending = launchDetached(
    "Code.exe",
    ["--folder-uri", "vscode-remote://wsl%2BUbuntu/home"],
    { watchMs: 1000, env },
    /** @type {import("node:child_process").spawn} */ (/** @type {unknown} */ (spawnSpy)),
  );
  child.emit("exit", 0, null);
  assert.equal(await pending, "launched");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.args, ["--folder-uri", "vscode-remote://wsl%2BUbuntu/home"]);
  assert.equal(calls[0]?.options.detached, true);
  assert.equal(calls[0]?.options.stdio, "ignore");
  assert.equal(calls[0]?.options.env, env, "the caller's scrubbed environment is handed over as-is");
});

test("createLauncher resolves the editor and scrubs the spawned child's environment", async () => {
  const child = new FakeChild();
  /** @type {{ command: string, args: readonly string[], options: Record<string, unknown> } | undefined} */
  let seen;
  /**
   * @param {string} command
   * @param {readonly string[]} args
   * @param {Record<string, unknown>} options
   * @returns {FakeChild}
   */
  const spawnSpy = (command, args, options) => {
    seen = { command, args, options };
    return child;
  };
  const source = {
    ELECTRON_RUN_AS_NODE: "1",
    PATH: "C:\\Windows",
    LOCALAPPDATA: "C:\\Users\\you\\AppData\\Local",
  };
  const launch = createLauncher(
    { executable: "C:\\Tools\\Code.exe", watchMs: 1000 },
    source,
    /** @type {import("node:child_process").spawn} */ (/** @type {unknown} */ (spawnSpy)),
  );
  const pending = launch("vscode-remote://wsl%2BUbuntu/home/you");
  child.emit("exit", 0, null);
  assert.equal(await pending, "launched");
  assert.ok(seen !== undefined, "the launcher spawned the editor");
  assert.equal(seen.command, "C:\\Tools\\Code.exe", "the configured executable is what starts");
  assert.deepEqual(seen.args, ["--folder-uri", "vscode-remote://wsl%2BUbuntu/home/you"]);
  assert.equal(seen.options.detached, true);
  assert.equal(seen.options.env && /** @type {Record<string, unknown>} */ (seen.options.env).ELECTRON_RUN_AS_NODE, undefined,
    "the editor child never starts in Node mode");
  assert.equal(/** @type {Record<string, unknown>} */ (seen.options.env).PATH, "C:\\Windows", "the rest of the host environment survives");
  assert.deepEqual(source, {
    ELECTRON_RUN_AS_NODE: "1",
    PATH: "C:\\Windows",
    LOCALAPPDATA: "C:\\Users\\you\\AppData\\Local",
  }, "the source environment is left alone");
});

test("a child that reports twice settles once and keeps the first outcome", async () => {
  const child = new FakeChild();
  let unrefs = 0;
  child.unref = () => { unrefs += 1; };
  const pending = launchDetached("Code.exe", [], { watchMs: 1000, env: {} }, spawnOf(child));
  child.emit("error", Object.assign(new Error("gone"), { code: "ENOENT" }));
  child.emit("exit", 1, null);
  assert.equal(await pending, "missing", "the first classification wins");
  assert.equal(unrefs, 1, "the settled child is detached exactly once");
});

test("the route accepts the legacy wsl$ share spelling", async () => {
  /** @type {string[]} */
  const launched = [];
  const handler = createOpenInAppHandler({
    launch: async (uri) => { launched.push(uri); return "launched"; },
  });
  const answer = await handler(post({ path: "\\\\wsl$\\Ubuntu\\home\\andy" }));
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), {
    ok: true,
    uri: "vscode-remote://wsl%2BUbuntu/home/andy",
  });
  assert.deepEqual(launched, ["vscode-remote://wsl%2BUbuntu/home/andy"]);
});

test("the route accepts a charset parameter and refuses a body without a media type", async () => {
  const handler = createOpenInAppHandler({ launch: async () => "launched" });
  const utf8 = await handler(post({ path: "\\\\wsl.localhost\\Ubuntu\\home" }, "application/json; charset=utf-8"));
  assert.equal(utf8.status, 200);
  assert.equal(utf8.headers.get("cache-control"), "no-store");
  assert.match(utf8.headers.get("content-type") ?? "", /application\/json/);

  const noType = await handler(new Request("http://127.0.0.1/api/wsl-env/open-in-app", { method: "POST" }));
  assert.equal(noType.status, 415, "a body without a media type is refused");
});

test("the route refuses non-string paths and classifies a rejected launcher", async () => {
  /** @type {(uri: string) => Promise<import("../lib/open-in-app.js").LaunchOutcome>} */
  const launch = async () => "launched";
  const numeric = await createOpenInAppHandler({ launch })(post({ path: 42 }));
  assert.equal(numeric.status, 400, "path must be a string");
  const nullPath = await createOpenInAppHandler({ launch })(post({ path: null }));
  assert.equal(nullPath.status, 400);

  const throwing = await createOpenInAppHandler({
    launch: async () => { throw new Error("spawn exploded"); },
  })(post({ path: "\\\\wsl.localhost\\Ubuntu\\home" }));
  assert.equal(throwing.status, 502, "a rejected launcher is a classified failure, not an unhandled rejection");
  assert.deepEqual(await throwing.json(), { error: "VS Code 启动失败" });
});

test("apply launches the configured executable and withdraws the route on dispose", async () => {
  /** @type {Route[]} */
  const routes = [];
  /** @type {Array<() => void>} */
  const effects = [];
  let withdrawn = 0;
  apply(/** @type {any} */ ({
    inject(/** @type {readonly string[]} */ _deps, /** @type {(scope: any) => void} */ callback) {
      callback({
        connection: {
          fetch: {
            /** @param {Route} route */
            register(route) {
              routes.push(route);
              return () => { withdrawn += 1; };
            },
          },
        },
        effect(/** @type {() => () => void} */ install) {
          effects.push(install());
        },
      });
    },
  }), { executable: "dsh-plugin-test-missing-editor", watchMs: 200 });
  const route = routes[0];
  assert.ok(route !== undefined, "the row registered the route");
  const answer = await route.fetch(post({ path: "\\\\wsl.localhost\\Ubuntu\\home" }));
  assert.equal(answer.status, 502);
  const payload = /** @type {{ error?: string }} */ (await answer.json());
  assert.match(String(payload.error), /executable/, "the configured executable is what spawn tried");
  effects[0]?.();
  assert.equal(withdrawn, 1, "the disposer withdraws the registered route");
});

test("the route drives the scrubbed launcher end to end", async () => {
  const child = new FakeChild();
  /** @type {{ command: string, args: readonly string[], options: Record<string, unknown> } | undefined} */
  let seen;
  /**
   * @param {string} command
   * @param {readonly string[]} args
   * @param {Record<string, unknown>} options
   * @returns {FakeChild}
   */
  const spawnSpy = (command, args, options) => {
    seen = { command, args, options };
    return child;
  };
  const handler = createOpenInAppHandler({
    launch: createLauncher(
      { executable: "C:\\Tools\\Code.exe", watchMs: 1000 },
      { ELECTRON_RUN_AS_NODE: "1", PATH: "C:\\Windows" },
      /** @type {import("node:child_process").spawn} */ (/** @type {unknown} */ (spawnSpy)),
    ),
  });
  const pending = handler(post({ path: "\\\\wsl.localhost\\Ubuntu\\home\\you" }));
  child.emit("exit", 0, null);
  const answer = await pending;
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), {
    ok: true,
    uri: "vscode-remote://wsl%2BUbuntu/home/you",
  });
  assert.ok(seen !== undefined);
  assert.equal(seen.command, "C:\\Tools\\Code.exe");
  assert.deepEqual(seen.args, ["--folder-uri", "vscode-remote://wsl%2BUbuntu/home/you"]);
  assert.equal(seen.options.env && /** @type {Record<string, unknown>} */ (seen.options.env).ELECTRON_RUN_AS_NODE, undefined);
});

test("a malformed UTF-16 path is refused instead of throwing", async () => {
  assert.equal(
    editorUri("\\\\wsl.localhost\\Ubuntu\\bad\uD800"),
    undefined,
    "a lone surrogate in the path is not a workspace",
  );
  assert.equal(
    editorUri("\\\\wsl.localhost\\bad\uD800\\home"),
    undefined,
    "nor is one in the distro name",
  );
  assert.equal(
    editorUri("\\\\wsl.localhost\\Ubuntu\\emoji\u{1F600}"),
    "vscode-remote://wsl%2BUbuntu/emoji%F0%9F%98%80",
    "a well-formed non-BMP character still encodes",
  );

  let launches = 0;
  const handler = createOpenInAppHandler({
    launch: async () => { launches += 1; return "launched"; },
  });
  const answer = await handler(post({ path: "\\\\wsl.localhost\\Ubuntu\\bad\uD800" }));
  assert.equal(answer.status, 400, "the route classifies the refusal");
  assert.equal(launches, 0, "nothing is spawned for an unencodable path");
});
