/**
 * Assertion checks for auto-preset's host-mode advisory and adoption decision.
 *
 * What matters: a distro workspace that keeps the host environment is never
 * silent (the operator sees a `warn` line and the model gets a runtime-context
 * entry), a correctly adopted distro session gets neither, and a subagent does
 * not repeat its parent's advisory. The deferred `select()` retry loop, the
 * creation-time `createSession` wrapper and the doctor's seam row run here
 * against a stand-in facade; the real host frame timing stays probe territory.
 *
 * The checks run against `lib/auto-preset.js` with a stand-in cordis context,
 * exactly as `preflight.test.mjs` does for its row.
 *
 *   node test/auto-preset.test.mjs
 */
import assert from "node:assert/strict";
import { apply } from "../lib/auto-preset.js";
import { autoPresetSeam, publishAutoPresetSeam } from "../lib/auto-preset-seam.js";
import { mergeAutoPresetSeam } from "../lib/doctor-live.js";
import { t, resetMessagesLocaleForTests } from "../lib/messages.js";

const DISTRO_UNC = "\\\\wsl.localhost\\Ubuntu\\home\\you\\proj";
const LEGACY_UNC = "\\\\wsl.localhost\\Ubuntu\\home\\you\\legacy";
const HOST_UNC = "C:\\Users\\you\\proj";

/**
 * The session-agent facade slice the row wraps.
 * @typedef {{ createSession?: (request: { cwd: string, agentPreset?: string, sessionId?: string, reusable?: () => boolean }) => Promise<{ agentPreset?: string }> }} FakeFacade
 */

/**
 * A stand-in cordis context for this row: captures the `agent/created`
 * listener, the preset switches, the create-session wrapper's calls, and the
 * disposers; the `settings` edge is inert (optional at this layer).
 * @param {{ composed?: string, select?: (agent: unknown, preset: string) => Promise<string>, controller?: FakeFacade | null, hasDefault?: boolean, defaultThrows?: boolean, sessionController?: boolean, settings?: { describe: () => Array<{ ns: string, value?: unknown }> }, liveAgents?: any[], logger?: boolean, inspectThrows?: boolean }} [options] - the composed preset, the switch's answer, the session controller's `agents` facade (null for none), and the mount-time seams.
 * @returns {{ ctx: Record<string, unknown>, warns: string[], switches: Array<[string, string]>, handlers: Record<string, (payload: unknown) => void>, calls: Array<Record<string, unknown>>, disposers: Array<() => void>, agents: FakeFacade }}
 */
const fakeCtx = ({ composed = "standard", select, controller, hasDefault = true, defaultThrows = false, sessionController = true, settings, liveAgents = [], logger = true, inspectThrows = false } = {}) => {
  /** @type {string[]} */
  const warns = [];
  /** @type {Array<[string, string]>} */
  const switches = [];
  /** @type {Record<string, (payload: unknown) => void>} */
  const handlers = {};
  /** @type {Array<Record<string, unknown>>} */
  const calls = [];
  /** @type {Array<() => void>} */
  const disposers = [];
  /** @type {FakeFacade} */
  const agents = controller === undefined
    ? {
      createSession: async (/** @type {{ cwd: string, agentPreset?: string, sessionId?: string, reusable?: () => boolean }} */ request) => {
        calls.push(request);
        return { agentPreset: request.agentPreset };
      },
    }
    : controller ?? {};
  /** @type {{ composedPreset: () => string, defaultId?: string, select: (agent: { id: string }, preset: string) => Promise<string> }} */
  const agentPresets = {
    composedPreset: () => {
      if (inspectThrows) throw new Error("compose failed");
      return composed;
    },
    select: async (/** @type {{ id: string }} */ agent, /** @type {string} */ preset) => {
      switches.push([agent.id, preset]);
      return select === undefined ? preset : select(agent, preset);
    },
  };
  if (defaultThrows) {
    // The registry is a peer service: a failed read must not fail adoption.
    Object.defineProperty(agentPresets, "defaultId", {
      get() { throw new Error("preset registry unavailable"); },
      configurable: true,
    });
  } else {
    agentPresets.defaultId = hasDefault ? "standard" : undefined;
  }
  const ctx = {
    logger: logger
      ? {
        debug: () => {},
        warn: (/** @type {string} */ message) => warns.push(message),
      }
      : undefined,
    agents: { list: () => liveAgents },
    on: (/** @type {string} */ event, /** @type {(payload: unknown) => void} */ listener) => {
      handlers[event] = listener;
      return () => true;
    },
    agentPresets,
    inject: (/** @type {string[]} */ names, /** @type {(scope: Record<string, unknown>) => void} */ callback) => {
      if (Array.isArray(names) && names.includes("settings") && settings !== undefined) {
        callback({ settings, on: () => () => true });
        return undefined;
      }
      if (!sessionController) return undefined;
      if (!Array.isArray(names) || !names.includes("sessionController")) return undefined;
      callback({
        sessionController: { agents },
        effect: (/** @type {() => (() => void) | void} */ install) => {
          const dispose = install();
          if (typeof dispose === "function") disposers.push(dispose);
          return dispose;
        },
      });
      return undefined;
    },
  };
  return { ctx, warns, switches, handlers, calls, disposers, agents };
};

/**
 * One created agent whose context records the runtime-context entries it gets.
 * @param {{ id: string, cwd?: string, origin?: string, parentSession?: string, injectMode?: "present" | "missing" | "throws" | "no-context" }} input - identity, workspace, and the advisory seam's availability.
 * @returns {{ agent: { id: string, session: { header: { cwd?: string, origin?: string, parentSession?: string } }, ctx?: { inject?: unknown } }, entries: Array<{ name: string, order: number, text: () => string }> }}
 */
const fakeAgent = ({ id, cwd, origin, parentSession, injectMode = "present" }) => {
  /** @type {Array<{ name: string, order: number, text: () => string }>} */
  const entries = [];
  const inject = (
    /** @type {string[]} */ _names,
    /** @type {(scope: { systemPrompt: { context: (entry: { name: string, order: number, text: () => string }) => unknown } }) => void} */ install,
  ) => {
    if (injectMode === "throws") throw new Error("systemPrompt is not composed here");
    install({ systemPrompt: { context: (entry) => entries.push(entry) } });
  };
  return {
    agent: {
      id,
      session: { header: { cwd, ...(origin === undefined ? {} : { origin }), ...(parentSession === undefined ? {} : { parentSession }) } },
      ctx: injectMode === "no-context" ? undefined : injectMode === "missing" ? {} : { inject },
    },
    entries,
  };
};

/** Let the deferred adoption path run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

let passed = 0;
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

await check("the seam is unknown until published, and drops the method when inactive", () => {
  const initial = autoPresetSeam();
  assert.equal(initial.state, "unknown");
  assert.equal(initial.method, undefined);
  assert.equal(initial.at, 0, "nothing has published yet");
  assert.ok(initial.reason.length > 0, "the state explains itself");

  publishAutoPresetSeam("active", "wrapped for this check", "createSession");
  const active = autoPresetSeam();
  assert.equal(active.state, "active");
  assert.equal(active.method, "createSession");
  assert.equal(active.reason, "wrapped for this check");
  assert.ok(active.at > 0);

  publishAutoPresetSeam("inactive", "the row was disposed");
  assert.equal(autoPresetSeam().method, undefined, "an inactive seam names no method");
  publishAutoPresetSeam("unknown", "the auto-preset row has not mounted in this process");
});

await check("a Windows-access workspace warns and publishes the model-facing advisory", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "a1", cwd: DISTRO_UNC });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  assert.equal(harness.switches.length, 0, "the recorded choice is never overridden");
  assert.equal(harness.warns.length, 1, "the operator gets exactly one log line");
  assert.match(harness.warns[0] ?? "", /host \(Windows\) environment/, "the warning names the real environment");
  assert.equal(entries.length, 1, "the model gets one runtime-context entry");
  assert.equal(entries[0]?.name, "wsl-access-mode");
  assert.equal(entries[0]?.order, 200);
  assert.equal(entries[0]?.text(), t("hostModeWindowsAccess", { cwd: DISTRO_UNC, distro: "Ubuntu" }));
});

await check("a recorded sibling path is not the workspace", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "a2", cwd: "\\\\wsl.localhost\\Ubuntu\\home\\you\\legacy2" });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [LEGACY_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.deepEqual(entries, [], "a whole-segment prefix match must not catch a sibling");
  assert.deepEqual(harness.switches, [["a2", "wsl"]], "the session adopts the WSL preset instead");
  assert.deepEqual(harness.warns, [], "and nothing warns");
});

await check("a normal distro session adopts the WSL preset and says nothing", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "a3", cwd: DISTRO_UNC });
  await apply(/** @type {never} */ (harness.ctx), {});
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.deepEqual(harness.switches, [["a3", "wsl"]]);
  assert.deepEqual(entries, []);
  assert.deepEqual(harness.warns, []);
});

await check("a Windows workspace gets neither an advisory nor a preset switch", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "a4", cwd: HOST_UNC });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [LEGACY_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.deepEqual(harness.switches, []);
  assert.deepEqual(entries, []);
  assert.deepEqual(harness.warns, []);
});

await check("a subagent inherits the environment, so it gets no advisory", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "a5", cwd: DISTRO_UNC, origin: "subagent" });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  assert.deepEqual(entries, [], "the parent's context already carries the fact");
  assert.deepEqual(harness.warns, [], "and the log would only repeat it");
});

await check("a session locked by its first turn still gets the advisory", async () => {
  const harness = fakeCtx({
    select: async () => {
      throw Object.assign(new Error("preset locked"), { code: "agent-preset/locked" });
    },
  });
  const { agent, entries } = fakeAgent({ id: "a6", cwd: DISTRO_UNC });
  await apply(/** @type {never} */ (harness.ctx), {});
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.equal(entries.length, 1, "the model is told its commands run in Windows");
  assert.equal(entries[0]?.text(), t("hostModeLocked", { cwd: DISTRO_UNC, distro: "Ubuntu" }));
});

await check("a profile without the WSL preset still tells the model it is in Windows mode", async () => {
  const harness = fakeCtx({
    select: async () => {
      throw Object.assign(new Error("no preset"), { code: "agent-preset/not-found" });
    },
  });
  const { agent, entries } = fakeAgent({ id: "a7", cwd: DISTRO_UNC });
  await apply(/** @type {never} */ (harness.ctx), {});
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.text(), t("hostModePresetUnavailable", { cwd: DISTRO_UNC, distro: "Ubuntu" }));
});

await check("the advisory is published once per session", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "a8", cwd: DISTRO_UNC });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  harness.handlers["agent/created"]?.({ agent });
  assert.equal(entries.length, 1, "a repeated event must not stack context entries");
  assert.equal(harness.warns.length, 1);
});


await check("the creation-time seam fills the preset in the create request", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), {});
  assert.equal(autoPresetSeam().state, "active");
  assert.equal(autoPresetSeam().method, "createSession");
  const createSession = harness.agents.createSession;
  assert.ok(createSession, "the wrapper installed the seam");
  const reusable = () => true;
  const result = await createSession({ cwd: DISTRO_UNC, reusable });
  assert.equal(result.agentPreset, "wsl");
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0]?.agentPreset, "wsl");
  assert.equal(harness.calls[0]?.cwd, DISTRO_UNC);
  assert.equal(harness.calls[0]?.reusable, reusable, "the caller's reuse policy is forwarded untouched");
  assert.deepEqual(harness.warns, []);
});

await check("the registry default is treated as automatic at creation", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC, agentPreset: "standard" });
  assert.equal(harness.calls[0]?.agentPreset, "wsl", "the client's explicit default is not an operator choice");
});

await check("an explicit non-default preset wins at creation", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC, agentPreset: "minimal" });
  assert.equal(harness.calls[0]?.agentPreset, "minimal");
});

await check("a Windows-access workspace keeps the host preset at creation", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC });
  assert.equal(harness.calls[0]?.agentPreset, undefined);
});

await check("a Windows workspace keeps the host preset at creation", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: HOST_UNC });
  assert.equal(harness.calls[0]?.agentPreset, undefined);
});

await check("a preset refusal falls back to the caller's request", async () => {
  /** @type {Array<{ cwd: string, agentPreset?: string }>} */
  const seen = [];
  const harness = fakeCtx({
    controller: {
      createSession: async (/** @type {{ cwd: string, agentPreset?: string }} */ request) => {
        seen.push(request);
        if (request.agentPreset === "wsl") {
          throw Object.assign(new Error("unknown agent preset"), { code: "agent-preset/not-found" });
        }
        return { agentPreset: request.agentPreset };
      },
    },
  });
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  const result = await createSession({ cwd: DISTRO_UNC });
  assert.equal(seen.length, 2, "the wrapper retried once");
  assert.equal(seen[0]?.agentPreset, "wsl");
  assert.equal(seen[1]?.agentPreset, undefined, "with the caller's own choice");
  assert.equal(result.agentPreset, undefined);
});

await check("a controller without createSession disables the seam visibly", async () => {
  const harness = fakeCtx({ controller: {} });
  await apply(/** @type {never} */ (harness.ctx), {});
  assert.equal(autoPresetSeam().state, "inactive");
  assert.equal(harness.warns.length, 1);
  assert.match(harness.warns[0] ?? "", /createSession/);
});

await check("the creation-time seam is removed on dispose", async () => {
  const harness = fakeCtx();
  const original = harness.agents.createSession;
  await apply(/** @type {never} */ (harness.ctx), {});
  assert.notEqual(harness.agents.createSession, original);
  for (const dispose of harness.disposers.splice(0)) dispose();
  assert.equal(harness.agents.createSession, original, "the original method is restored");
  assert.equal(autoPresetSeam().state, "inactive");
});

await check("the doctor reports the creation-time seam", async () => {
  /**
   * An empty doctor report with the check row type the merge appends.
   * @returns {{ checks: Array<{ id: string, status: string, detail?: string, remedy?: string }>, summary: Record<string, number> }}
   */
  const emptyReport = () => ({ checks: [], summary: {} });

  publishAutoPresetSeam("active", "test", "createSession");
  const active = mergeAutoPresetSeam(emptyReport());
  const activeRow = active.checks.find((entry) => entry.id === "session.preset-seam");
  assert.equal(activeRow?.status, "ok");
  assert.match(String(activeRow?.detail), /active \(createSession\)/);
  assert.equal(active.summary.ok, 1);

  publishAutoPresetSeam("inactive", "the host exposes no createSession");
  const inactive = mergeAutoPresetSeam(emptyReport());
  const inactiveRow = inactive.checks.find((entry) => entry.id === "session.preset-seam");
  assert.equal(inactiveRow?.status, "warn");
  assert.match(inactiveRow?.remedy ?? "", /createSession/);
  assert.match(String(inactiveRow?.detail), /inactive: the host exposes no createSession/);
  assert.match(String(inactiveRow?.detail), /first mount/, "the consequence is named");
  assert.equal(inactive.summary.warn, 1);

  publishAutoPresetSeam("unknown", "test unknown");
  const unknown = mergeAutoPresetSeam(emptyReport());
  const unknownRow = unknown.checks.find((entry) => entry.id === "session.preset-seam");
  assert.equal(unknownRow?.status, "info");
  assert.match(String(unknownRow?.detail), /has not initialized in this process/);
  publishAutoPresetSeam("active", "test reset", "createSession");
});


await check("a create request without a usable cwd is forwarded untouched", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession(/** @type {any} */ ({}));
  await createSession(/** @type {any} */ ({ cwd: 42 }));
  assert.deepEqual(harness.calls, [{}, { cwd: 42 }], "the wrapper does not invent a preset for a request it cannot read");
});

await check("the wrapper forwards host fields it does not read", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  const reusable = () => false;
  await createSession(/** @type {any} */ ({
    cwd: DISTRO_UNC,
    sessionId: "s-9",
    agentPreset: "standard",
    reusable,
    title: "kept",
    workspaceWindow: { id: 1 },
  }));
  const call = harness.calls[0];
  assert.ok(call !== undefined);
  assert.equal(call.agentPreset, "wsl");
  assert.equal(call.sessionId, "s-9", "the host's session id survives");
  assert.equal(call.reusable, reusable, "the reuse policy survives");
  assert.equal(call.title, "kept");
  assert.deepEqual(call.workspaceWindow, { id: 1 }, "an unknown host field survives");
});

await check("a create failure that is not a preset refusal reaches the caller", async () => {
  const harness = fakeCtx({
    controller: {
      createSession: async () => {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      },
    },
  });
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await assert.rejects(createSession({ cwd: DISTRO_UNC }), /disk full/);
});

await check("without a registry default, an explicit preset id is the operator's choice", async () => {
  const harness = fakeCtx({ hasDefault: false });
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC, agentPreset: "standard" });
  await createSession({ cwd: DISTRO_UNC });
  assert.equal(harness.calls[0]?.agentPreset, "standard", "an id cannot equal an unknown default");
  assert.equal(harness.calls[1]?.agentPreset, "wsl", "an absent id is still automatic");
});

await check("the deferred adoption retries a transient switch failure", async () => {
  let calls = 0;
  const harness = fakeCtx({
    select: async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("busy"), { code: "agent-preset/busy" });
      return "wsl";
    },
  });
  const { agent } = fakeAgent({ id: "retry", cwd: DISTRO_UNC });
  await apply(/** @type {never} */ (harness.ctx), { attempts: 3, retryMs: 1 });
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.equal(harness.switches.length, 3, "the loop waited through two transient failures");
  assert.deepEqual(harness.warns, [], "a switch that eventually lands is not a warning");
});

await check("the deferred adoption gives up after its attempt budget", async () => {
  const harness = fakeCtx({
    select: async () => {
      throw Object.assign(new Error("preset service is busy"), { code: "agent-preset/busy" });
    },
  });
  const { agent } = fakeAgent({ id: "exhausted", cwd: DISTRO_UNC });
  await apply(/** @type {never} */ (harness.ctx), { attempts: 2, retryMs: 1 });
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.equal(harness.switches.length, 2, "the attempt budget is honoured");
  assert.equal(harness.warns.length, 1, "the operator is told once");
  assert.match(harness.warns[0] ?? "", /could not bind preset "wsl"/);
  assert.match(harness.warns[0] ?? "", /preset service is busy/, "the last failure is named");
});

await check("an event without an agent is ignored", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), {});
  harness.handlers["agent/created"]?.({});
  harness.handlers["agent/created"]?.(undefined);
  await settle();
  assert.deepEqual(harness.switches, []);
  assert.deepEqual(harness.warns, []);
});

await check("a volatile Windows-access field is read at decision time", async () => {
  /** @type {readonly string[]} */
  let paths = [];
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: { get: () => paths } });
  const first = fakeAgent({ id: "volatile-1", cwd: DISTRO_UNC });
  harness.handlers["agent/created"]?.({ agent: first.agent });
  await settle();
  assert.deepEqual(harness.switches, [["volatile-1", "wsl"]], "an empty live record adopts the WSL preset");

  // The sidebar edit reaches the next decision without a remount.
  paths = [DISTRO_UNC];
  const second = fakeAgent({ id: "volatile-2", cwd: DISTRO_UNC });
  harness.handlers["agent/created"]?.({ agent: second.agent });
  await settle();
  assert.equal(harness.switches.length, 1, "the edited record keeps the next session on the host preset");
  assert.equal(second.entries.length, 1, "and that session is told why");

  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC });
  const call = harness.calls.at(-1);
  assert.equal(call?.agentPreset, undefined, "the creation seam reads the same live field");
});

await check("a volatile field that is not a list is treated as empty", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), {
    windowsWorkspaces: { get: () => /** @type {never} */ ("not a list") },
  });
  const { agent } = fakeAgent({ id: "bad-volatile", cwd: DISTRO_UNC });
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.deepEqual(harness.switches, [["bad-volatile", "wsl"]]);
});

await check("a configured target preset is used by both the seam and the event path", async () => {
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), { preset: "linux" });
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC });
  assert.equal(harness.calls[0]?.agentPreset, "linux", "creation fills the configured target");

  const { agent } = fakeAgent({ id: "custom-target", cwd: DISTRO_UNC });
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.deepEqual(harness.switches, [["custom-target", "linux"]], "the deferred path selects the same target");
});

await check("a registry default that cannot be read is not treated as the caller's pick", async () => {
  const harness = fakeCtx({ defaultThrows: true });
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC, agentPreset: "standard" });
  await createSession({ cwd: DISTRO_UNC });
  assert.equal(harness.calls[0]?.agentPreset, "standard", "an unreadable default cannot be matched");
  assert.equal(harness.calls[1]?.agentPreset, "wsl", "an absent id stays automatic");

  // The event path reads the same registry; a broken getter must not crash it.
  const { agent } = fakeAgent({ id: "broken-registry", cwd: DISTRO_UNC });
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.deepEqual(harness.switches, [], "the current preset cannot be proven to be the default");
  assert.deepEqual(harness.warns, []);
});

await check("a preset refusal without a code is recognised by its message", async () => {
  /** @type {Array<{ cwd: string, agentPreset?: string }>} */
  const seen = [];
  const harness = fakeCtx({
    controller: {
      createSession: async (/** @type {{ cwd: string, agentPreset?: string }} */ request) => {
        seen.push(request);
        if (request.agentPreset === "wsl") throw new Error('Unknown agent preset "wsl"');
        return {};
      },
    },
  });
  await apply(/** @type {never} */ (harness.ctx), {});
  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC, sessionId: "s-1" });
  assert.equal(seen.length, 2, "the wrapper retried the caller's request");
  assert.equal(seen[0]?.agentPreset, "wsl");
  assert.equal(seen[1]?.agentPreset, undefined);
});

await check("an agent without the systemPrompt seam still logs the advisory", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "no-seam", cwd: DISTRO_UNC, injectMode: "missing" });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  assert.deepEqual(entries, [], "no seam means no context entry");
  assert.equal(harness.warns.length, 1, "the operator still gets the fact");
  assert.match(harness.warns[0] ?? "", /host \(Windows\) environment/);
});

await check("a throwing systemPrompt seam degrades to the log line", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "bad-seam", cwd: DISTRO_UNC, injectMode: "throws" });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  assert.deepEqual(entries, [], "the advisory is not published");
  assert.equal(harness.warns.length, 1, "and the session is not failed");
});

await check("an agent payload without a context still logs the advisory", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "no-context", cwd: DISTRO_UNC, injectMode: "no-context" });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  assert.deepEqual(entries, []);
  assert.equal(harness.warns.length, 1, "the event listener does not throw");
});

await check("a throwing volatile Windows-access read behaves like an empty record", async () => {
  const config = {
    windowsWorkspaces: {
      get: () => {
        throw new Error("config layer unavailable");
      },
    },
  };
  const harness = fakeCtx();
  await apply(/** @type {never} */ (harness.ctx), config);
  const { agent } = fakeAgent({ id: "broken-volatile", cwd: DISTRO_UNC });
  harness.handlers["agent/created"]?.({ agent });
  await settle();
  assert.deepEqual(harness.switches, [["broken-volatile", "wsl"]], "the decision still runs");
  assert.deepEqual(harness.warns, [], "a config read failure is not a session warning");

  const createSession = harness.agents.createSession;
  assert.ok(createSession);
  await createSession({ cwd: DISTRO_UNC });
  const call = harness.calls.at(-1);
  assert.equal(call?.agentPreset, "wsl", "session creation is not failed by the config read");
});

await check("the advisory follows the profile's locale row", async () => {
  const harness = fakeCtx({
    settings: {
      describe: () => [{ ns: "locale", value: { preference: "zh-CN" } }],
    },
  });
  try {
    await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
    const { agent, entries } = fakeAgent({ id: "zh", cwd: DISTRO_UNC });
    harness.handlers["agent/created"]?.({ agent });
    assert.equal(entries.length, 1);
    const text = entries[0]?.text() ?? "";
    assert.match(text, /Windows 访问/, "the model reads the localized advisory");
    assert.match(text, /PowerShell/);
    assert.doesNotMatch(text, /recorded as a Windows-access workspace/);
  } finally {
    resetMessagesLocaleForTests();
  }
});

await check("a session that existed before the row mounted is still inspected", async () => {
  const { agent, entries } = fakeAgent({ id: "swept", cwd: DISTRO_UNC });
  const harness = fakeCtx({ liveAgents: [agent] });
  await apply(/** @type {never} */ (harness.ctx), {});
  await settle();
  assert.deepEqual(harness.switches, [["swept", "wsl"]]);
  assert.deepEqual(entries, []);
});

await check("a child session with a parent is not told twice", async () => {
  const harness = fakeCtx();
  const { agent, entries } = fakeAgent({ id: "child", cwd: DISTRO_UNC, parentSession: "parent-1" });
  await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
  harness.handlers["agent/created"]?.({ agent });
  assert.deepEqual(entries, [], "the parent's context already carries the fact");
  assert.deepEqual(harness.warns, []);
});

await check("an agent whose preset cannot be read is reported, not crashed", async () => {
  const harness = fakeCtx({ inspectThrows: true });
  const { agent, entries } = fakeAgent({ id: "broken", cwd: DISTRO_UNC });
  await apply(/** @type {never} */ (harness.ctx), {});
  harness.handlers["agent/created"]?.({ agent });
  assert.deepEqual(entries, []);
  assert.match(harness.warns[0] ?? "", /cannot inspect the new agent/);
});

await check("a row without a logger reports the host mode on stderr", async () => {
  const harness = fakeCtx({ logger: false });
  const { agent } = fakeAgent({ id: "stdio", cwd: DISTRO_UNC });
  /** @type {string[]} */
  const written = [];
  const original = process.stderr.write;
  /** @param {any} chunk */
  const write = (chunk) => { written.push(String(chunk)); return true; };
  process.stderr.write = /** @type {any} */ (write);
  try {
    await apply(/** @type {never} */ (harness.ctx), { windowsWorkspaces: [DISTRO_UNC] });
    harness.handlers["agent/created"]?.({ agent });
  } finally {
    process.stderr.write = original;
  }
  assert.match(written.join(""), /auto-preset: .*host \(Windows\) environment/);
});

await check("a composition without sessionController leaves the seam unknown", async () => {
  publishAutoPresetSeam("unknown", "test baseline");
  const harness = fakeCtx({ sessionController: false });
  await apply(/** @type {never} */ (harness.ctx), {});
  assert.equal(autoPresetSeam().state, "unknown");
});

await check("the doctor merge preserves the caller's report", () => {
  publishAutoPresetSeam("active", "test", "createSession");
  const input = { checks: [{ id: "host.bwrap", status: "ok", detail: "x" }], summary: { ok: 1 } };
  const merged = mergeAutoPresetSeam(input);
  assert.notEqual(merged, input, "a fresh report is returned");
  assert.equal(merged.checks.length, 2, "the existing check is kept beside the seam row");
  assert.deepEqual(merged.summary, { ok: 2 });
  assert.deepEqual(input, { checks: [{ id: "host.bwrap", status: "ok", detail: "x" }], summary: { ok: 1 } }, "the input is untouched");
  const bare = mergeAutoPresetSeam(/** @type {any} */ ({}));
  assert.equal(bare.checks.length, 1, "a report without rows still gets the check");
  assert.deepEqual(bare.summary, { ok: 1 });
});

console.log(`\n${passed} auto-preset checks pass`);
