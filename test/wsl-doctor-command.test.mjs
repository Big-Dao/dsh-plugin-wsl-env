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
    { id: "host.windows", status: "ok", detail: "Windows build: 10.0.26300.9818" },
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
  assert.match(text, /host\.windows/);
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

console.log("wsl-doctor-command tests pass");
