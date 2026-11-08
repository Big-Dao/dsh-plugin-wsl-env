/**
 * Tests for the `wsl_doctor` tool row (WSL-317): the digest's shape, the
 * rendered text, and the mounting — the distro resolution through the
 * workingDirectory service, the explicit-distro override, and the refusals
 * when neither resolves.
 *
 *   node test/wsl-doctor-tool.test.mjs
 *
 * The doctor itself is faked at the context seam (`ctx.doctor`); its
 * collection and merge are the doctor suite's business.
 */
import assert from "node:assert/strict";
import { digestReport, renderDigest, apply, inject, sectionOf as digestSectionOf, SECTIONS } from "../lib/wsl-doctor-tool.js";

const DISTRO_UNC = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj";

const BLOCKED = {
  schemaVersion: 2,
  verdict: "blocked",
  blockers: ["sandbox.bwrap", "session.systemd"],
  distroVerdicts: [{ name: "ubuntu", verdict: "blocked", blockers: ["sandbox.bwrap", "session.systemd"] }],
  summary: { ok: 30, warn: 2, fail: 2, info: 4, skipped: 1 },
  checks: [
    { id: "sandbox.bwrap", status: "fail", detail: "missing; every confined command fails closed without it", remedy: "wsl.exe -d ubuntu -u root -- apt-get install -y bubblewrap" },
    { id: "session.systemd", status: "fail", detail: "none init", remedy: "set [boot] systemd=true in /etc/wsl.conf" },
    { id: "tools.rg", status: "warn", detail: "missing; in-distro search degrades" },
    { id: "functional.exec", status: "skipped", detail: "skipped: blocked by agent.handshake" },
    { id: "peers.versions", status: "ok" },
  ],
};

const READY = {
  schemaVersion: 2,
  verdict: "ready",
  blockers: [],
  distroVerdicts: [{ name: "ubuntu", verdict: "ready", blockers: [] }],
  summary: { ok: 35, warn: 0, fail: 0, info: 4, skipped: 0 },
  checks: [{ id: "sandbox.bwrap", status: "ok" }],
};

let passed = 0;
/**
 * Run one named check.
 * @param {string} name - the check name.
 * @param {() => void} fn - the assertions.
 */
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
};

await check("digestReport lists every failing check with its remedy and counts the rest", () => {
  const digest = digestReport(BLOCKED);
  assert.equal(digest.verdict, "blocked");
  assert.deepEqual(digest.blockers, ["sandbox.bwrap", "session.systemd"]);
  assert.deepEqual(digest.failing.map((entry) => entry.id), ["sandbox.bwrap", "session.systemd"]);
  assert.match(digest.failing[0]?.remedy ?? "", /apt-get install -y bubblewrap/);
  assert.equal(digest.warningCount, 2);
  assert.equal(digest.skippedCount, 1);
  const ready = digestReport(READY);
  assert.deepEqual(ready.failing, []);
  assert.equal(ready.verdict, "ready", "a ready report digests to an empty failing list");
  assert.match(ready.note, /the first command should succeed/);
});

await check("renderDigest speaks verdict, per-failure remedies, and the ready note", () => {
  const blocked = renderDigest(digestReport(BLOCKED));
  assert.match(blocked, /^wsl doctor verdict: BLOCKED/);
  assert.match(blocked, /fail sandbox\.bwrap — missing; every confined command fails closed/);
  assert.match(blocked, /fix: wsl\.exe -d ubuntu -u root -- apt-get install -y bubblewrap/);
  assert.match(blocked, /2 warning\(s\), 1 skipped leg/);
  const ready = renderDigest(digestReport(READY));
  assert.match(ready, /^wsl doctor verdict: READY/);
  assert.match(ready, /the first command should succeed/);
});

/** Mount the row against a fake context and capture the registered tool.
 * @param {{ cwd?: string, agentless?: boolean, report?: object, calls?: string[], options?: Array<{ quick?: boolean, sections?: string[] }> }} options - the fixture.
 * @returns {Promise<{ tool: { name: string, execute: (args: { distro?: string, depth?: string, section?: string }, exec: { agent?: unknown, signal?: unknown }) => Promise<{ verdict: string, blockers: string, failing: string }> }, calls: string[], options: Array<{ quick?: boolean, sections?: string[] }> }>} the tool, the doctor's call log, and the scope options each call carried. */
const mount = async ({ cwd = DISTRO_UNC, agentless = false, report = READY, calls = [], options = [] } = {}) => {
  /** @type {unknown[]} */
  const registered = [];
  const ctx = {
    tools: { register: (/** @type {unknown} */ tool) => registered.push(tool) },
    workingDirectory: { ensure: async () => cwd },
    doctor: async (/** @type {string} */ distro, /** @type {{ quick?: boolean, sections?: string[] } | undefined} */ scope) => {
      calls.push(distro);
      options.push(scope ?? {});
      return report;
    },
  };
  // Synchronous apply, awaited for parity with the row's shape.
  await apply(/** @type {any} */ (ctx));
  return { tool: /** @type {any} */ (registered[0]), calls, options };
};

await check("execute resolves the session distro and returns the digest", async () => {
  const { tool, calls } = await mount();
  assert.equal(tool.name, "wsl_doctor");
  const result = await tool.execute({}, { agent: { id: "a1" } });
  assert.deepEqual(calls, ["ubuntu"], "the session's distro resolves from the workingDirectory service");
  assert.equal(result.verdict, "ready");
  assert.equal(result.blockers, "");
  assert.match(result.failing, /^wsl doctor verdict: READY/);
});

await check("an explicit distro wins, and the blocked digest carries the remedies", async () => {
  const { tool, calls } = await mount({ report: BLOCKED });
  const result = await tool.execute({ distro: "Debian" }, { agent: { id: "a1" } });
  assert.deepEqual(calls, ["Debian"], "an explicit distro wins over the session resolution");
  assert.equal(result.verdict, "blocked");
  assert.equal(result.blockers, "sandbox.bwrap, session.systemd");
  assert.match(result.failing, /fix: set \[boot\] systemd=true/);
});

await check("an unresolvable distro refuses with the pass-one hint", async () => {
  const { tool } = await mount({ cwd: "/mnt/c/Users/x/proj" });
  await assert.rejects(
    () => tool.execute({}, { agent: { id: "a1" } }),
    /could not resolve the session's distro/,
    "a host cwd names no distro",
  );
  await assert.rejects(
    () => tool.execute({}, {}),
    /requires an agent Session/,
    "no agent and no distro is a refusal, not a guess",
  );
});

await check("digestReport derives everything when the report lacks the optional fields", async () => {
  const digest = digestReport({ checks: [
    { id: "x.y", status: "fail", detail: "d", remedy: "" },
    { id: "a.b", status: "ok" },
  ] });
  assert.equal(digest.verdict, "blocked", "no verdict field — derived from the failing checks");
  assert.deepEqual(digest.blockers, ["x.y"], "no blockers field — derived too");
  assert.equal(digest.warningCount, 0, "no summary — counted from the checks");
  assert.equal(digest.skippedCount, 0);
  assert.deepEqual(digest.distroVerdicts, []);
  assert.equal(digest.failing[0]?.remedy, "no remedy — see docs/DIAGNOSTICS.md", "an empty remedy names the map");
  const rendered = renderDigest(digest);
  assert.match(rendered, /  fix: no remedy — see docs\/DIAGNOSTICS\.md/, "an empty remedy renders the map pointer instead");
});

await check("the row injects only its eager reads", () => {
  assert.deepEqual(inject, ["tools", "workingDirectory"], "cordis 4 refuses an undeclared ctx property read; doctor resolves per call");
});

await check("depth quick and section follow-ups reach the collector as scope options", async () => {
  const { tool, options } = await mount();
  await tool.execute({ depth: "quick" }, { agent: { id: "a1" } });
  await tool.execute({ section: "session" }, { agent: { id: "a1" } });
  await tool.execute({}, { agent: { id: "a1" } });
  assert.deepEqual(options[0], { quick: true }, "depth quick forwards the quick profile");
  assert.deepEqual(options[1], { sections: ["session"] }, "section forwards a one-section scope");
  assert.deepEqual(options[2], {}, "the default call is a full run, no scope");
});

await check("digestReport tallies the sections a scoped report carried, in SECTIONS order", () => {
  const digest = digestReport({
    verdict: "ready",
    blockers: [],
    scope: { sections: ["host", "session", "sandbox"], quick: true },
    checks: [
      { id: "distro.reachable", status: "ok" },
      { id: "distro.kernel", status: "info" },
      { id: "session.linger", status: "fail", detail: "unset", remedy: "enable-linger" },
      { id: "sandbox.bwrap", status: "ok" },
      { id: "agent.handshake", status: "info", detail: "out of scope" },
    ],
  });
  assert.deepEqual(digest.sections, [
    { section: "host", ok: 1, warn: 0, fail: 0, unknown: 0 },
    { section: "sandbox", ok: 1, warn: 0, fail: 0, unknown: 0 },
    { section: "session", ok: 0, warn: 0, fail: 1, unknown: 0 },
  ], "info-only and out-of-scope sections do not appear; order follows SECTIONS");
  assert.deepEqual(digest.scope, { sections: ["host", "session", "sandbox"], quick: true });
  const rendered = renderDigest(digest);
  assert.match(rendered, /  host: 1 ok/);
  assert.match(rendered, /  session: 0 ok, 1 fail/);
  assert.doesNotMatch(rendered, /agent:/, "a section with no non-skipped checks is silent");
});

await check("sectionOf parity with the doctor CLI's own mapping", async () => {
  const doctor = await import("../scripts/doctor.mjs");
  const ids = [
    "distro.reachable", "distro.kernel", "distro.dns", "distro.wsl-conf-boot",
    "sandbox.bwrap", "functional.sandbox", "session.linger", "runtime.scopes",
    "distro.wsl-conf-interop", "distro.wsl-conf-automount", "config.effective",
    "agent.handshake", "functional.exec", "peers.versions", "git.win-safe", "update.latest",
  ];
  for (const id of ids) {
    assert.equal(digestSectionOf(id), doctor.sectionOf(id), `sectionOf("${id}") agrees with the CLI`);
  }
  assert.deepEqual(doctor.SECTIONS, SECTIONS, "the section lists match");
});

await check("a provided doctor service wins through ctx.get without an inject", async () => {
  /** @type {unknown[]} */
  const registered = [];
  /** @type {string[]} */
  const calls = [];
  const ctx = {
    get: (/** @type {string} */ name) => name === "doctor"
      ? async (/** @type {string} */ distro) => { calls.push(distro); return READY; }
      : undefined,
    tools: { register: (/** @type {unknown} */ tool) => registered.push(tool) },
    workingDirectory: { ensure: async () => DISTRO_UNC },
  };
  await apply(ctx);
  const tool = /** @type {{ name: string, execute: (args: { distro?: string }, exec: { agent?: unknown }) => Promise<{ verdict: string }> }} */ (registered[0]);
  const result = await tool.execute({}, { agent: { id: "a1" } });
  assert.deepEqual(calls, ["ubuntu"], "the provided service collects, the digest is its report's");
  assert.equal(result.verdict, "ready");
});

console.log(`${passed} wsl-doctor-tool checks pass`);
