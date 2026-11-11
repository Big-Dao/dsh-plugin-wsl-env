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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { digestReport, renderDigest, apply, inject, sectionOf as digestSectionOf, SECTIONS, CHECK_CATALOG } from "../lib/wsl-doctor-tool.js";

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
  assert.match(ready.note, /ready covers the checks in this run/);
  assert.match(ready.note, /does not promise/);
});

await check("renderDigest speaks verdict, per-failure remedies, and the ready note", () => {
  const blocked = renderDigest(digestReport(BLOCKED));
  assert.match(blocked, /^wsl doctor verdict: BLOCKED/);
  assert.match(blocked, /\[FAIL\] sandbox\.bwrap: missing; every confined command fails closed without it/);
  assert.match(blocked, /fix: wsl\.exe -d ubuntu -u root -- apt-get install -y bubblewrap/);
  assert.match(blocked, /\[FAIL\] session\.systemd: none init/);
  assert.match(blocked, /\[WARN\] tools\.rg/);
  assert.match(blocked, /\[SKIP\] functional\.exec — skipped: blocked by agent\.handshake/);
  assert.match(blocked, /\[ OK \] peers\.versions/);
  assert.match(blocked, /blocked by: sandbox\.bwrap, session\.systemd/);
  const ready = renderDigest(digestReport(READY));
  assert.match(ready, /^wsl doctor verdict: READY/);
  assert.match(ready, /\[ OK \] sandbox\.bwrap/);
  assert.match(ready, /ready covers the checks in this run/);
});

await check("a multi-distro report groups the tallies by distro and names the session", () => {
  const MULTI = {
    verdict: "blocked",
    blockers: ["session.systemd", "session.linger"],
    distroVerdicts: [
      { name: "ubuntu", verdict: "ready", blockers: [] },
      { name: "alpine-bt", verdict: "blocked", blockers: ["session.systemd", "session.linger"] },
    ],
    checks: [
      { id: "distro.reachable", status: "ok", distro: "ubuntu", title: "Distro \"ubuntu\"", detail: "answers commands" },
      { id: "session.linger", status: "ok", distro: "ubuntu", title: "Linger", detail: "Linger=yes" },
      { id: "distro.reachable", status: "ok", distro: "alpine-bt", title: "Distro \"alpine-bt\"", detail: "answers commands" },
      { id: "session.systemd", status: "fail", distro: "alpine-bt", title: "systemd as PID 1", detail: "none init(alpine-bt)", remedy: "enable [boot] systemd=true" },
      { id: "session.linger", status: "fail", distro: "alpine-bt", title: "Linger", detail: "unset", remedy: "loginctl enable-linger" },
      { id: "tools.rg", status: "warn", distro: "alpine-bt", title: "rg", detail: "missing" },
      { id: "git.win-safe", status: "ok", title: "Windows git trust", detail: "whitelisted" },
    ],
  };
  const digest = digestReport(MULTI, "ubuntu");
  assert.deepEqual(
    digest.distros.map((tally) => [tally.name, tally.ok, tally.warn, tally.fail, tally.session, tally.verdict]),
    [
      ["ubuntu", 2, 0, 0, true, "ready"],
      ["alpine-bt", 1, 1, 2, undefined, "blocked"],
      ["(host)", 1, 0, 0, undefined, undefined],
    ],
    "first-appearance order, per-distro tallies, session flag, distro verdicts; host-wide checks group under (host)",
  );
  const rendered = renderDigest(digest);
  assert.match(rendered, /== ubuntu \(this session's distro\) =/);
  assert.match(rendered, /\[ OK \] session\.linger — Linger: Linger=yes/);
  assert.match(rendered, /== alpine-bt =/);
  assert.match(rendered, /\[FAIL\] session\.systemd — systemd as PID 1: none init\(alpine-bt\)/);
  assert.match(rendered, /\[WARN\] tools\.rg — rg: missing/);
  assert.match(rendered, /fix: enable \[boot\] systemd=true/);
  assert.match(rendered, /== \(host — Windows and global checks\) =/);
  assert.match(rendered, /blocked by: alpine-bt\/session\.systemd, alpine-bt\/session\.linger/, "the footer names every blocker with its id");
  const single = digestReport({ ...MULTI, checks: MULTI.checks.filter((entry) => entry.distro === "ubuntu") }, "ubuntu");
  assert.equal(single.distros.length, 1, "a single-distro report still carries one tally");
});

/** Mount the row against a fake context and capture the registered tool.
 * @param {{ cwd?: string, agentless?: boolean, report?: object, calls?: string[], options?: Array<{ quick?: boolean, sections?: string[] }> }} options - the fixture.
 * @returns {Promise<{ tool: { name: string, execute: (args: { distro?: string, depth?: string, section?: string }, exec: { agent?: unknown, signal?: unknown }) => Promise<{ verdict: string, blockers: string, report: string }> }, calls: string[], options: Array<{ quick?: boolean, sections?: string[] }> }>} the tool, the doctor's call log, and the scope options each call carried. */
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
  assert.match(/** @type {any} */ (tool).description, /Default depth "quick"/);
  assert.doesNotMatch(/** @type {any} */ (tool).description, /first command should succeed/);
  const result = await tool.execute({}, { agent: { id: "a1" } });
  assert.deepEqual(calls, ["ubuntu"], "the session's distro resolves from the workingDirectory service");
  assert.equal(result.verdict, "ready");
  assert.equal(result.blockers, "");
  assert.match(result.report, /^wsl doctor verdict: READY/);
});

await check("an explicit distro wins, and the blocked digest carries the remedies", async () => {
  const { tool, calls } = await mount({ report: BLOCKED });
  const result = await tool.execute({ distro: "Debian" }, { agent: { id: "a1" } });
  assert.deepEqual(calls, ["Debian"], "an explicit distro wins over the session resolution");
  assert.equal(result.verdict, "blocked");
  assert.equal(result.blockers, "sandbox.bwrap, session.systemd");
  assert.match(result.report, /fix: set \[boot\] systemd=true/);
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
  await tool.execute({ depth: "full" }, { agent: { id: "a1" } });
  assert.deepEqual(options[3], {}, "depth full forwards no scope — a full run");
});

await check("digestReport tallies the sections a scoped report carried, in SECTIONS order", () => {
  const digest = digestReport({
    verdict: "ready",
    blockers: [],
    scope: { sections: ["host", "session", "sandbox"], quick: true },
    checks: [
      { id: "distro.reachable", status: "ok" },
      { id: "distro.identity", status: "info" },
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
  assert.match(rendered, /\[ OK \] distro\.reachable/);
  assert.match(rendered, /\[FAIL\] session\.linger: unset/);
  assert.match(rendered, /\[INFO\] agent\.handshake/);
});

await check("sectionOf parity with the doctor CLI's own mapping", async () => {
  const doctor = await import("../scripts/doctor.mjs");
  const ids = [
    "distro.reachable", "distro.identity", "distro.dns", "distro.wsl-conf-boot",
    "sandbox.bwrap", "functional.sandbox", "session.linger", "runtime.scopes",
    "distro.wsl-conf-interop", "distro.wsl-conf-automount", "config.effective",
    "agent.handshake", "functional.exec", "peers.versions", "git.win-safe", "functional.native",
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

await check("CHECK_CATALOG covers every check id the doctor CLI can emit", () => {
  const source = readFileSync(fileURLToPath(new URL("../scripts/doctor.mjs", import.meta.url)), "utf8");
  /** @type {Set<string>} */
  const emitted = new Set();
  for (const match of source.matchAll(/\bcheck\("([a-z][A-Za-z0-9.-]+)"/g)) emitted.add(match[1] ?? "");
  for (const match of source.matchAll(/\{ id: "([a-z][A-Za-z0-9.-]+)"/g)) emitted.add(match[1] ?? "");
  // The optional-tool loop builds `tools.${tool}` ids from this list.
  const toolsRow = source.match(/const optionalTools = \[\[.*?\]\];/)?.[0] ?? "";
  for (const name of toolsRow.matchAll(/\["([a-z]+)", "/g)) emitted.add(`tools.${name[1] ?? ""}`);
  assert.ok(emitted.size > 30, "the extraction found the CLI's checks, not a broken regex");
  const catalog = new Set(CHECK_CATALOG);
  const missing = [...emitted].filter((id) => !catalog.has(id));
  assert.deepEqual(missing, [], "every emitted id is cataloged");
  const extra = CHECK_CATALOG.filter((id) => !emitted.has(id));
  assert.deepEqual(extra, [], "the catalog carries no id the CLI stopped emitting");
});

await check("a scoped report still lists the unexecuted checks as explicit skips", () => {
  const digest = digestReport({ verdict: "ready", blockers: [], checks: [{ id: "distro.reachable", status: "ok", distro: "ubuntu", title: "Distro \"ubuntu\"", detail: "answers commands" }] });
  const notRun = digest.items.filter((item) => item.distro === "(not run)");
  assert.ok(notRun.length >= CHECK_CATALOG.length - 1, "every unreported catalog id appears once");
  assert.ok(notRun.every((item) => item.status === "skipped" && item.detail === "not run in this scope" && item.scopeSkip === true));
  assert.equal(digest.notRun, notRun.length, "the digest counts the same synthetic rows it lists");
  const rendered = renderDigest(digest);
  assert.match(rendered, /== \(not run in this scope\) =/);
  assert.ok(!rendered.includes("agent.handshake: not run in this scope"), "individual skip rows collapse into one summary line");
  assert.match(rendered, /\[SKIP\] not run in this scope — no scope recorded for this report \(\d+\): .*\bagent\.handshake\b/);
  assert.match(rendered, /\[ OK \] distro\.reachable — Distro "ubuntu": answers commands/);
});

await check("the skip summary names the scope profile that left checks unrun", () => {
  const digest = digestReport({
    verdict: "ready",
    blockers: [],
    checks: [{ id: "distro.reachable", status: "ok", distro: "ubuntu", title: "Distro \"ubuntu\"", detail: "answers commands" }],
    scope: { sections: ["host", "session", "sandbox"], quick: true },
  });
  const rendered = renderDigest(digest);
  assert.match(rendered, /\[SKIP\] not run in this scope — the quick profile covers first-command prerequisites only \(\d+\): .*\bconfig\.wslconfig\b/);
  const sectioned = renderDigest(digestReport({
    verdict: "ready",
    blockers: [],
    checks: [{ id: "distro.reachable", status: "ok", distro: "ubuntu", title: "Distro \"ubuntu\"", detail: "answers commands" }],
    scope: { sections: ["sandbox"], quick: false },
  }));
  assert.match(sectioned, /\[SKIP\] not run in this scope — the run covered only: sandbox \(\d+\):/);
});

// ── Digest localization: the skeleton follows the app's message locale ──────
// The digest renders through the shared message catalogs, so a Chinese UI
// reads a Chinese skeleton (the per-check facts stay English — remedies carry
// copy-paste commands). English is the default, which every earlier assertion
// above already pins.
{
  const { configureMessagesLocale, resetMessagesLocaleForTests } = await import("../lib/messages.js");
  configureMessagesLocale("zh");
  try {
    const rendered = renderDigest(digestReport(BLOCKED));
    assert.match(rendered, /wsl doctor 裁决：BLOCKED/u);
    assert.match(rendered, /== （宿主——Windows 与全局检查） =/u);
    assert.match(rendered, /阻断项：/u);
    assert.match(rendered, /重跑即复核/u);
    assert.ok(rendered.includes("sandbox.bwrap"), "check facts stay verbatim");
    assert.ok(rendered.includes("wsl.exe -d ubuntu -u root -- apt-get install -y bubblewrap"), "remedies stay verbatim");
    assert.match(rendered, /\[SKIP\] functional\.exec——被前置阻断：blocked by agent\.handshake/u, "the gated skip names its blocker in Chinese");
    const ready = renderDigest(digestReport(READY));
    assert.match(ready, /wsl doctor 裁决：READY/u);
    assert.match(ready, /ready 只覆盖本次检查/u);
  } finally {
    resetMessagesLocaleForTests();
  }
  assert.match(renderDigest(digestReport(READY)), /wsl doctor verdict: READY/u, "the default is English again");
}

console.log(`${passed} wsl-doctor-tool checks pass`);
