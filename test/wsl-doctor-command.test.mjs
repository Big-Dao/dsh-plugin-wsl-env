/**
 * Tests for the `/wsl-doctor` UI command (`lib/wsl-doctor-command.js`): the
 * grammar parser, the registry registration and its handler paths against a
 * fake CLI runner, the no-registry no-op, and the real runner's subprocess
 * shape (a `--help` run that prints no JSON must reject).
 *
 *   node test/wsl-doctor-command.test.mjs
 *
 * @module test/wsl-doctor-command
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  DOCTOR_CLI_SWEEP_TIMEOUT_MS,
  DOCTOR_CLI_TIMEOUT_MS,
  DOCTOR_SCRIPT,
  USAGE,
  apply,
  formatDoctorReport,
  parseDoctorInput,
  runDoctorCli,
} from "../lib/wsl-doctor-command.js";

/** @typedef {import("../lib/wsl-doctor-command.js").WslDoctorCommandDefinition} WslDoctorCommandDefinition */

/**
 * A commands registry fake that records the registration.
 * @returns {{ state: { definitions: WslDoctorCommandDefinition[] }, commands: { register: (definition: WslDoctorCommandDefinition) => void } }}
 */
function fakeRegistry() {
  /** @type {{ definitions: WslDoctorCommandDefinition[] }} */
  const state = { definitions: [] };
  return { state, commands: { register: (definition) => state.definitions.push(definition) } };
}

/**
 * The single definition a fake captured, narrowed.
 * @param {{ state: { definitions: WslDoctorCommandDefinition[] } }} fake
 * @returns {WslDoctorCommandDefinition}
 */
function soleDefinition(fake) {
  const definition = fake.state.definitions[0];
  assert.ok(definition !== undefined, "exactly one command registered");
  return definition;
}

/** One titled check; a throw fails the suite. @param {string} title @param {() => void | Promise<void>} body */
async function check(title, body) {
  await body();
  console.log(`OK   ${title}`);
}

/** The fixture report the fake runner returns: one ok host check, one blocked distro. */
const FIXTURE_REPORT = JSON.stringify({
  schemaVersion: 2,
  verdict: "blocked",
  blockers: ["distro.present"],
  checks: [
    { id: "host.platform", status: "ok", detail: "Windows 10.0.26300.9818; WSL version: 2.0.0" },
    { id: "distro.present", status: "fail", detail: "distro \"missing\" is not installed", remedy: "install it: wsl --install -d missing", distro: "missing" },
  ],
  summary: { ok: 1, fail: 1 },
  distroVerdicts: [{ name: "missing", verdict: "blocked", blockers: ["distro.present"] }],
});

await check("the doctor CLI the command spawns exists beside the built module", () => {
  assert.ok(existsSync(DOCTOR_SCRIPT), DOCTOR_SCRIPT);
});

await check("the grammar parses depths, sections, and distro spellings", () => {
  assert.deepEqual(parseDoctorInput(""), { mode: "quick", distro: "" });
  assert.deepEqual(parseDoctorInput("   "), { mode: "quick", distro: "" });
  assert.deepEqual(parseDoctorInput("quick"), { mode: "quick", distro: "" });
  assert.deepEqual(parseDoctorInput("full"), { mode: "full", distro: "" });
  assert.deepEqual(parseDoctorInput("session"), { mode: "section", section: "session", distro: "" });
  assert.deepEqual(parseDoctorInput("full --distro ubuntu"), { mode: "full", distro: "ubuntu" });
  assert.deepEqual(parseDoctorInput("--distro=debian"), { mode: "quick", distro: "debian" });
  assert.deepEqual(parseDoctorInput("--distro ubuntu net"), { mode: "section", section: "net", distro: "ubuntu" });
  assert.deepEqual(parseDoctorInput("ubuntu"), { mode: "quick", distro: "ubuntu" }, "a bare distro name is the distro");
  assert.throws(() => parseDoctorInput("warp nine"), /nine/);
  assert.throws(() => parseDoctorInput("--distro"), /--distro 需要一个名称/);
});

await check("apply registers the command and the handler runs the CLI with the right flags", async () => {
  const fake = fakeRegistry();
  /** @type {string[][]} */
  const seen = [];
  await apply({
    commands: fake.commands,
    doctorCli: async (argv) => {
      seen.push(argv);
      return FIXTURE_REPORT;
    },
  });
  const definition = soleDefinition(fake);
  assert.equal(definition.name, "wsl-doctor");
  assert.ok(definition.input?.hint.includes("--distro"));

  const run = await definition.handler({ rawInput: "full --distro ubuntu" });
  assert.equal(run.kind, "success");
  assert.deepEqual(seen[0], ["--json", "--distro", "ubuntu"]);
  assert.match(run.text, /distro\.present/);
  assert.match(run.text, /install it/);

  const quick = await definition.handler({ rawInput: "", agent: undefined });
  assert.equal(quick.kind, "success");
  assert.deepEqual(seen[1], ["--json", "--quick"]);

  const section = await definition.handler({ rawInput: "conf" });
  assert.equal(section.kind, "success");
  assert.deepEqual(seen[2], ["--json", "--sections", "conf"]);
});

await check("the session's working directory names the distro when none is passed", async () => {
  const fake = fakeRegistry();
  /** @type {string[][]} */
  const seen = [];
  await apply({
    commands: fake.commands,
    workingDirectory: { ensure: async () => "\\\\wsl.localhost\\ubuntu\\home\\andy" },
    doctorCli: async (argv) => {
      seen.push(argv);
      return FIXTURE_REPORT;
    },
  });
  const run = await soleDefinition(fake).handler({ rawInput: "quick", agent: { id: "agent-1" } });
  assert.equal(run.kind, "success");
  assert.deepEqual(seen, [["--json", "--quick", "--distro", "ubuntu"]]);
});

await check("a non-UNC working directory leaves the distro to the CLI's own selection", async () => {
  const fake = fakeRegistry();
  /** @type {string[][]} */
  const seen = [];
  await apply({
    commands: fake.commands,
    workingDirectory: { ensure: async () => "C:\\Users\\andyz" },
    doctorCli: async (argv) => {
      seen.push(argv);
      return FIXTURE_REPORT;
    },
  });
  const run = await soleDefinition(fake).handler({ rawInput: "", agent: { id: "agent-1" } });
  assert.equal(run.kind, "success");
  assert.deepEqual(seen, [["--json", "--quick"]]);
});

await check("a broken cwd read falls back to the CLI's own selection instead of failing", async () => {
  const fake = fakeRegistry();
  /** @type {string[][]} */
  const seen = [];
  await apply({
    commands: fake.commands,
    workingDirectory: { ensure: async () => { throw new Error("no session"); } },
    doctorCli: async (argv) => {
      seen.push(argv);
      return FIXTURE_REPORT;
    },
  });
  const run = await soleDefinition(fake).handler({ rawInput: "", agent: { id: "agent-1" } });
  assert.equal(run.kind, "success");
  assert.deepEqual(seen, [["--json", "--quick"]]);
});

await check("a cwd service that throws synchronously falls back instead of failing", async () => {
  const fake = fakeRegistry();
  /** @type {string[][]} */
  const seen = [];
  await apply({
    commands: fake.commands,
    workingDirectory: { ensure: () => { throw new Error("boom"); } },
    doctorCli: async (argv) => {
      seen.push(argv);
      return FIXTURE_REPORT;
    },
  });
  const run = await soleDefinition(fake).handler({ rawInput: "", agent: { id: "agent-1" } });
  assert.equal(run.kind, "success");
  assert.deepEqual(seen, [["--json", "--quick"]]);
});

await check("the agent-scoped cwd service names the distro (the production shape)", async () => {
  // The service lives in the agent's scope, not the app-level row's: this is
  // the shape that used to go unnoticed and leave every /wsl-doctor running
  // the configuration's `auto` sweep over each installed distro.
  const fake = fakeRegistry();
  /** @type {string[][]} */
  const seen = [];
  await apply({
    commands: fake.commands,
    get: (name) => (name === "commands" ? fake.commands : undefined),
    doctorCli: async (argv) => {
      seen.push(argv);
      return FIXTURE_REPORT;
    },
  });
  const agent = {
    id: "agent-1",
    session: { header: { cwd: "\\\\wsl.localhost\\ubuntu\\home\\andy" } },
    ctx: { get: /** @param {string} name */ (name) => (name === "workingDirectory" ? { get: () => "\\\\wsl.localhost\\debian\\home\\andy" } : undefined) },
  };
  const run = await soleDefinition(fake).handler({ rawInput: "quick", agent });
  assert.equal(run.kind, "success");
  assert.deepEqual(seen, [["--json", "--quick", "--distro", "debian"]], "the live cd wins over the header cwd");
});

await check("the session header's cwd names the distro when no service is reachable", async () => {
  const fake = fakeRegistry();
  /** @type {string[][]} */
  const seen = [];
  await apply({
    commands: fake.commands,
    get: (name) => (name === "commands" ? fake.commands : undefined),
    doctorCli: async (argv) => {
      seen.push(argv);
      return FIXTURE_REPORT;
    },
  });
  const agent = { id: "agent-1", session: { header: { cwd: "\\\\wsl.localhost\\ubuntu\\home\\andy" } } };
  const run = await soleDefinition(fake).handler({ rawInput: "quick", agent });
  assert.equal(run.kind, "success");
  assert.deepEqual(seen, [["--json", "--quick", "--distro", "ubuntu"]]);
});

await check("an unreadable agent scope still falls through to the header cwd", async () => {
  const fake = fakeRegistry();
  /** @type {string[][]} */
  const seen = [];
  await apply({
    commands: fake.commands,
    get: (name) => (name === "commands" ? fake.commands : undefined),
    doctorCli: async (argv) => {
      seen.push(argv);
      return FIXTURE_REPORT;
    },
  });
  const agent = {
    id: "agent-1",
    session: { header: { cwd: "\\\\wsl.localhost\\FedoraLinux-44\\home\\andy" } },
    ctx: { get: () => { throw new Error("cannot read without inject"); } },
  };
  const run = await soleDefinition(fake).handler({ rawInput: "", agent });
  assert.equal(run.kind, "success");
  assert.deepEqual(seen, [["--json", "--quick", "--distro", "FedoraLinux-44"]]);
});

await check("a resolved target gets the long budget, an unresolved one the sweep budget", async () => {
  // A scoped run finishes in seconds; an unresolved one hands the choice to
  // the configuration, whose `auto` sweeps every installed distro. The second
  // case is bounded tightly so the card cannot sit "executing" for minutes.
  const fake = fakeRegistry();
  /** @type {Array<number | undefined>} */
  const budgets = [];
  await apply({
    commands: fake.commands,
    doctorCli: async (_argv, _signal, timeoutMs) => {
      budgets.push(timeoutMs);
      return FIXTURE_REPORT;
    },
  });
  const handler = soleDefinition(fake).handler;
  await handler({ rawInput: "quick --distro ubuntu" });
  await handler({ rawInput: "quick" });
  assert.deepEqual(budgets, [DOCTOR_CLI_TIMEOUT_MS, DOCTOR_CLI_SWEEP_TIMEOUT_MS]);
});

await check("the settled error names the target the run examined", async () => {
  const scoped = fakeRegistry();
  await apply({ commands: scoped.commands, doctorCli: async () => { throw new Error("spawn failed"); } });
  const named = await soleDefinition(scoped).handler({ rawInput: "quick --distro ubuntu" });
  assert.equal(named.kind, "error");
  assert.match(named.text, /发行版 ubuntu/);

  const unscoped = fakeRegistry();
  await apply({ commands: unscoped.commands, doctorCli: async () => { throw new Error("spawn failed"); } });
  const fallback = await soleDefinition(unscoped).handler({ rawInput: "quick" });
  assert.equal(fallback.kind, "error");
  assert.match(fallback.text, /配置指定的目标/);
});

await check("grammar violations settle as direct errors with usage text", async () => {
  const fake = fakeRegistry();
  await apply({ commands: fake.commands, doctorCli: async () => { throw new Error("unreachable"); } });
  const handler = soleDefinition(fake).handler;
  const bad = await handler({ rawInput: "warp nine" });
  assert.equal(bad.kind, "error");
  assert.match(bad.text, /nine/);
  assert.ok(bad.text.includes(USAGE));
  const missing = await handler({ rawInput: "--distro" });
  assert.equal(missing.kind, "error");
  assert.match(missing.text, /需要一个名称/);
});

await check("a CLI infrastructure failure settles as an error, a blocked verdict does not", async () => {
  const failing = fakeRegistry();
  await apply({
    commands: failing.commands,
    doctorCli: async () => { throw new Error("spawn failed"); },
  });
  const failed = await soleDefinition(failing).handler({ rawInput: "quick" });
  assert.equal(failed.kind, "error");
  assert.match(failed.text, /spawn failed/);

  const blocked = fakeRegistry();
  await apply({ commands: blocked.commands, doctorCli: async () => FIXTURE_REPORT });
  const verdict = await soleDefinition(blocked).handler({ rawInput: "quick" });
  assert.equal(verdict.kind, "success", "exit 1 from the CLI is a blocked verdict, not a failed diagnosis");
  assert.match(verdict.text, /blocked/i);
});

await check("without a commands registry the row is a silent no-op", async () => {
  await apply({ doctorCli: async () => { throw new Error("unreachable"); } });
  await apply({ commands: undefined, doctorCli: async () => { throw new Error("unreachable"); } });
  await apply({ get: (name) => (name === "commands" ? undefined : undefined) });
  console.log("     headless no-op accepted");
});

await check("the registry resolves through ctx.get like production does", async () => {
  const fake = fakeRegistry();
  await apply({
    get: (name) => (name === "commands" ? fake.commands : undefined),
    doctorCli: async () => FIXTURE_REPORT,
  });
  assert.equal(fake.state.definitions.length, 1);
});

await check("formatDoctorReport digests the CLI's versioned JSON", () => {
  const text = formatDoctorReport(FIXTURE_REPORT, "missing");
  assert.match(text, /host\.platform/);
  assert.match(text, /distro\.present/);
});

await check("the real runner rejects stdout that is not a JSON report", async () => {
  const help = spawnSync(process.execPath, [DOCTOR_SCRIPT, "--help"], { encoding: "utf8", timeout: 60_000 });
  assert.notEqual(help.status, null);
  await assert.rejects(
    () => runDoctorCli(["--help"]),
    /未能给出报告/,
    "--help prints usage, never a JSON report",
  );
});

await check("the real runner settles a run that outlives its deadline", async () => {
  // A doctor that never reports must not leave the command "executing": the
  // deadline kills the child and the rejection names the timeout and the way
  // to narrow the next run. The 1 ms budget makes it deterministic — the
  // doctor cannot boot, probe, and report inside it.
  await assert.rejects(
    () => runDoctorCli(["--json", "--quick"], undefined, 1),
    /秒内没有给出报告[\s\S]*--distro/,
    "the deadline settles with the narrowing hint",
  );
});

console.log("wsl-doctor-command tests pass");
