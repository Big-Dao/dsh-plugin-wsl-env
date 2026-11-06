/**
 * Tests for `scripts/doctor.mjs`, driven through a fake `wsl.exe`/`cmd.exe` on
 * PATH — the same seam the doctor uses on a real machine, so the checks are
 * exercised as subprocesses rather than mocked in-process.
 *
 *   node test/doctor.test.mjs
 *
 * The fakes are POSIX shell scripts, so the suite skips on Windows (the doctor
 * itself runs there; only this harness cannot).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { peerSatisfied, latestFromPackument } from "../scripts/doctor.mjs";
import { mergeLiveResidentStatus } from "../lib/doctor-live.js";
import { doctorReport } from "../lib/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The digest the agent script self-reports; the fake HELLO carries it. */
const AGENT_DIGEST = createHash("sha256").update(readFileSync(join(ROOT, "agent", "wsl-agent.sh"))).digest("hex");

/** @typedef {{ id: string, status: string, detail?: string, remedy?: string, distro?: string, blocksFirstCommand?: boolean }} Check */
/** @typedef {{ schemaVersion: number, checks: Check[], summary: Record<string, number>, verdict?: string, blockers?: string[], distroVerdicts?: Array<{ name: string, verdict: string, blockers: string[] }>, config?: Record<string, string | string[]> }} Report */

if (process.platform === "win32") {
  console.log("SKIP  doctor tests: the fake wsl.exe is a POSIX script");
  process.exit(0);
}

// The update check asks the live registry; these checks must not depend on the
// network. An empty override asks no registry at all — the doctor reports its
// `info` unreachable line, and the packument parser is exercised directly
// below instead.
process.env.DSH_UPDATE_REGISTRIES = "";

const scratch = mkdtempSync(join(tmpdir(), "dsh-doctor-"));
const bin = join(scratch, "bin");
const home = join(scratch, "dsh-home");
mkdirSync(bin);
mkdirSync(home);

const FAKE_WSL = `#!/bin/sh
case "$*" in
  "-l -q"|"--list -q") printf '%s\\n' \${FAKE_DISTROS:-ubuntu} | tr ' ' '\\n'; exit 0 ;;
  "-l -v") printf '  NAME            STATE           VERSION\\n  ubuntu*         Running         2\\n'; case "\${FAKE_DISTROS:-ubuntu}" in *debian*) printf '  debian          Stopped         2\\n' ;; esac; exit 0 ;;
  "--list --running") printf 'hdr\\nubuntu\\n'; exit 0 ;;
  "--version") printf 'WSL version: 2.0.0\\nKernel version: 6.6.87.2\\n'; exit 0 ;;
esac
all="$*"
case "$all" in
  *"-d ubuntu"*) [ "\${FAKE_STOPPED:-no}" = yes ] && { printf 'WSL_E_DISTRO_NOT_FOUND\\n' >&2; exit 1; } ;;
esac
case "$all" in
  *"-d debian"*) [ "\${FAKE_STOP_DEBIAN:-no}" = yes ] && { printf 'WSL_E_DISTRO_NOT_FOUND\\n' >&2; exit 1; } ;;
esac
case "$all" in
  *"--exec sh /"*)
    if [ "\${FAKE_AGENT_DIGEST:-}" = bad ]; then printf 'HELLO|wsl-agent|7|deadbeef|4242|batch\\n'; else printf 'HELLO|wsl-agent|7|${AGENT_DIGEST}|4242|batch\\n'; fi
    exit 0 ;;
esac
case "$all" in
  *"--exec sh -c"*)
    case "$all" in
      *'printf %s ok'*) printf 'ok' ;;
      *'getent passwd'*) printf '/bin/bash' ;;
      *'printf %s "$HOME"'*) printf '/home/andy' ;;
      *'uname -r'*) printf '6.6.87.2' ;;
      *'for f in apt-get'*) printf 'apt-get' ;;
      *'command -v bwrap'*) [ "\${FAKE_BWRAP:-yes}" = no ] || printf '/usr/bin/bwrap' ;;
      *'bwrap --ro-bind'*) exit 0 ;;
      *'/run/systemd/system'*) [ "\${FAKE_SYSTEMD:-yes}" = no ] && printf 'none init' || printf 'systemd systemd' ;;
      *'command -v systemd-run'*) printf '/usr/bin/systemd-run' ;;
      *'echo "$unit'*) [ "\${FAKE_STALE:-no}" = yes ] && printf 'dsh-wsl-ubuntu-x.scope stale' || true ;;
      *'systemctl --user stop'*) exit 0 ;;
      *'systemctl --user is-system-running'*) printf 'running' ;;
      *'loginctl show-user'*) printf 'Linger=yes' ;;
      *'command -v rg'*) printf '/usr/bin/rg' ;;
      *'command -v git'*) printf '/usr/bin/git' ;;
      *'command -v inotifywait'*) printf '/usr/bin/inotifywait' ;;
      *'cat /proc/net/tcp'*) printf '  sl  local_address rem_address   st tx_queue rx_queue\n   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 0 1\n' ;;
      *'hostname -I'*) printf '172.20.0.5 ' ;;
      *'uname -m'*) printf 'x86_64' ;;
      *'.cache/dsh-wsl/agent'*) printf 'exec abc123' ;;
      *) : ;;
    esac
    ;;
esac
exit 0
`;
const FAKE_CMD = `#!/bin/sh
printf 'Microsoft Windows [Version 10.0.26300.9711]\\n'
`;
const FAKE_GIT_EXE = `#!/bin/sh
case "$*" in
  "--version") printf 'git version 2.54.0.windows.1\n' ;;
  *"--get-all safe.directory"*) printf '//wsl.localhost/*\n' ;;
  *) exit 0 ;;
esac
`;
writeFileSync(join(bin, "wsl.exe"), FAKE_WSL);
writeFileSync(join(bin, "cmd.exe"), FAKE_CMD);
writeFileSync(join(bin, "git.exe"), FAKE_GIT_EXE);
chmodSync(join(bin, "wsl.exe"), 0o755);
chmodSync(join(bin, "cmd.exe"), 0o755);
chmodSync(join(bin, "git.exe"), 0o755);

/**
 * Run the doctor with the fakes first on PATH.
 * @param {string[]} args - doctor arguments.
 * @param {Record<string, string>} [env] - extra environment.
 * @returns {{ status: number | null, stdout: string, stderr: string }} the run.
 */
const doctor = (args, env = {}) => spawnSync(process.execPath, ["scripts/doctor.mjs", ...args], {
  cwd: ROOT,
  encoding: "utf8",
  env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, DSH_HOME: home, ...env },
});

let passed = 0;
/**
 * Run one named check, awaiting an async body before it can pass.
 *
 * The body may be async — `doctorReport` spawns the real script — so the
 * helper awaits it. A synchronous `fn()` call used to print PASS before any
 * assertion ran, turn a rejection into an unhandled one, and let the fixture
 * cleanup below the loop delete the fake `wsl.exe` while the subprocess was
 * still using it.
 *
 * @param {string} name - the check name.
 * @param {() => void | Promise<void>} fn - the assertions.
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

try {
  await check("the ports survey lists listeners with their URL and the LAN line", () => {
    const run = doctor(["--read-only"]);
    assert.match(run.stdout, /listening ports in ubuntu/);
    assert.match(run.stdout, /http:\/\/localhost:3000/);
    assert.match(run.stdout, /netsh interface portproxy add v4tov4 listenport=3000 listenaddress=0\.0\.0\.0 connectport=3000 connectaddress=172\.20\.0\.5/);
  });

  await check("a healthy machine reports no failures and exits 0", () => {
    const run = doctor(["--json"]);
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.summary.fail, 0);
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.bwrap")?.status, "ok");
    assert.equal(report.checks.find((entry) => entry.id === "peers.versions")?.status, "ok");
  });

  await check("the verdict is ready under the effective config and stamps the distro scope", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    assert.equal(report.verdict, "ready");
    assert.deepEqual(report.blockers, []);
    assert.deepEqual(report.distroVerdicts, [{ name: "ubuntu", verdict: "ready", blockers: [] }]);
    assert.equal(report.config?.sessionSandbox, "true", "the shipped preset's value is the effective one absent profile layers");
    assert.match(String(report.config?.source), /shipped preset/);
    const bwrap = report.checks.find((entry) => entry.id === "sandbox.bwrap");
    assert.equal(bwrap?.distro, "ubuntu", "distro-scoped checks carry their distro");
    assert.equal(bwrap?.blocksFirstCommand, false, "ok never blocks");
    const peers = report.checks.find((entry) => entry.id === "peers.versions");
    assert.equal(peers?.distro, undefined, "host-level checks stay unstamped");
    assert.equal(peers?.blocksFirstCommand, false);
    const effective = report.checks.find((entry) => entry.id === "config.effective");
    assert.equal(effective?.status, "ok");
    assert.match(String(effective?.detail), /from the shipped preset/);
  });

  await check("a missing systemd blocks under the shipped sessionSandbox: true", () => {
    const run = doctor(["--json"], { FAKE_SYSTEMD: "no" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.equal(report.verdict, "blocked");
    assert.ok(report.blockers?.includes("session.systemd"));
    const systemd = report.checks.find((entry) => entry.id === "session.systemd");
    assert.equal(systemd?.status, "fail");
    assert.equal(systemd?.blocksFirstCommand, true);
    assert.equal(report.distroVerdicts?.[0]?.verdict, "blocked");
    assert.ok(report.distroVerdicts?.[0]?.blockers.includes("session.systemd"));
  });

  await check("a missing systemd downgrades when the profile sets sessionSandbox: false", () => {
    const profile = join(home, "profiles", "noscope");
    mkdirSync(profile, { recursive: true });
    const out = spawnSync(process.execPath, ["scripts/profile-preset.mjs", "--out", join(profile, "cordis.patch.yml"), "--session-sandbox", "false"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const run = doctor(["--json"], { FAKE_SYSTEMD: "no" });
    assert.equal(run.status, 0, "the verdict follows the effective config, not the shipped default");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.equal(report.verdict, "ready");
    const systemd = report.checks.find((entry) => entry.id === "session.systemd");
    assert.equal(systemd?.status, "warn");
    assert.match(String(systemd?.detail), /sessionSandbox: false does not use the session scope/);
    assert.equal(systemd?.blocksFirstCommand, false, "warn never blocks");
    assert.equal(report.config?.sessionSandbox, "false");
    assert.match(String(report.config?.source), /profile "noscope"/);
    const effective = report.checks.find((entry) => entry.id === "config.effective");
    assert.match(String(effective?.detail), /noscope: sessionSandbox/);
    rmSync(profile, { recursive: true, force: true });
  });

  await check("sessionSandbox: auto downgrades a missing scope to the named fallback", () => {
    const profile = join(home, "profiles", "autoscope");
    mkdirSync(profile, { recursive: true });
    const out = spawnSync(process.execPath, ["scripts/profile-preset.mjs", "--out", join(profile, "cordis.patch.yml"), "--session-sandbox", "auto"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const run = doctor(["--json"], { FAKE_SYSTEMD: "no" });
    assert.equal(run.status, 0);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const systemd = report.checks.find((entry) => entry.id === "session.systemd");
    assert.equal(systemd?.status, "warn");
    assert.match(String(systemd?.detail), /falls back to the per-command bwrap profile/);
    assert.equal(report.verdict, "ready");
    rmSync(profile, { recursive: true, force: true });
  });

  await check("--all checks every installed distro and aggregates per-distro verdicts", () => {
    const run = doctor(["--json", "--all"], { FAKE_DISTROS: "ubuntu debian" });
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.equal(report.verdict, "ready");
    assert.deepEqual(report.distroVerdicts?.map((entry) => entry.name), ["ubuntu", "debian"]);
    const bwrap = report.checks.filter((entry) => entry.id === "sandbox.bwrap");
    assert.deepEqual(bwrap.map((entry) => entry.distro), ["ubuntu", "debian"], "every distro-scoped check ran once per target, stamped");
  });

  await check("one unreachable distro does not mask the others", () => {
    const run = doctor(["--json", "--all"], { FAKE_DISTROS: "ubuntu debian", FAKE_STOP_DEBIAN: "yes" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const debian = report.distroVerdicts?.find((entry) => entry.name === "debian");
    assert.equal(debian?.verdict, "blocked");
    assert.ok(debian?.blockers.includes("distro.reachable"));
    assert.equal(report.distroVerdicts?.find((entry) => entry.name === "ubuntu")?.verdict, "ready");
    assert.equal(report.checks.filter((entry) => entry.id === "session.systemd").length, 1, "an unreachable distro contributes only its refusal");
  });

  await check("the effective distro pin narrows the target set", () => {
    const profile = join(home, "profiles", "pinned");
    mkdirSync(profile, { recursive: true });
    const out = spawnSync(process.execPath, ["scripts/profile-preset.mjs", "--out", join(profile, "cordis.patch.yml"), "--distro", "debian"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const run = doctor(["--json"], { FAKE_DISTROS: "ubuntu debian" });
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.deepEqual(report.distroVerdicts?.map((entry) => entry.name), ["debian"]);
    assert.equal(report.config?.distro, "debian");
    rmSync(profile, { recursive: true, force: true });
  });

  await check("missing bubblewrap fails with a copy-paste install remedy", () => {
    const run = doctor(["--json"], { FAKE_BWRAP: "no" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const bwrap = report.checks.find((entry) => entry.id === "sandbox.bwrap");
    assert.equal(bwrap?.status, "fail");
    assert.match(String(bwrap?.remedy), /apt-get install -y bubblewrap/);
    assert.match(String(bwrap?.remedy), /pnpm run bootstrap ubuntu --install/);
    assert.equal(report.verdict, "blocked", "every confined command fails closed without bwrap");
    assert.ok(report.blockers?.includes("sandbox.bwrap"));
  });

  await check("no systemd fails and names the wsl.conf remedy", () => {
    const run = doctor(["--json"], { FAKE_SYSTEMD: "no" });
    assert.equal(run.status, 1);
    const systemd = /** @type {Report} */ (JSON.parse(run.stdout)).checks.find((entry) => entry.id === "session.systemd");
    assert.equal(systemd?.status, "fail");
    assert.match(String(systemd?.remedy), /\[boot\] systemd=true/);
  });

  await check("stale scopes warn, and --fix sweeps them", () => {
    const warn = doctor(["--json"], { FAKE_STALE: "yes" });
    assert.equal(warn.status, 0);
    assert.equal(/** @type {Report} */ (JSON.parse(warn.stdout)).checks.find((entry) => entry.id === "runtime.scopes")?.status, "warn");
    const fixed = doctor(["--json", "--fix"], { FAKE_STALE: "yes" });
    assert.equal(fixed.status, 0);
    assert.equal(/** @type {Report} */ (JSON.parse(fixed.stdout)).checks.find((entry) => entry.id === "fix.scopes")?.status, "ok");
  });

  await check("read-only refusal gives a runnable fix command", () => {
    const run = doctor(["--read-only", "--fix"]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /pnpm run doctor --fix/);
  });

  await check("profile patch warning gives a runnable preset command", () => {
    const profile = join(home, "profiles", "bad");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "cordis.patch.yml"), "- id: wsl-shell\n");
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    const warning = report.checks.find((entry) => entry.id === "config.preset-trap");
    assert.match(String(warning?.remedy), /pnpm run preset --check <patch>/);
    rmSync(profile, { recursive: true, force: true });
  });

  await check("the agent handshake names its probe source and catches a digest mismatch", () => {
    const good = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    const ok = good.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(ok?.status, "ok");
    assert.match(String(ok?.detail), /probed: a fresh resident, pid 4242/, "the report states the probe source (WSL-313 acceptance)");
    const bad = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_AGENT_DIGEST: "bad" }).stdout));
    const mismatch = bad.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(mismatch?.status, "fail");
    assert.match(String(mismatch?.detail), /MISMATCH/);
    assert.match(String(mismatch?.remedy), /sync:windows/);
  });

  await check("the live-resident merge names the probe source and keeps the fresh facts (WSL-313)", () => {
    /** The minimal healthy report shape the merge expects. @type {Report} */
    const report = {
      schemaVersion: 2,
      checks: [
        { id: "wsl.version", status: "ok", detail: "WSL version: 2.0.0" },
        { id: "agent.handshake", status: "ok", detail: "probed: a fresh resident, pid 4242, protocol 6, digest matches", distro: "ubuntu", blocksFirstCommand: true },
        { id: "runtime.scopes", status: "info", detail: "none" },
      ],
      summary: { ok: 1, info: 1, warn: 0, fail: 0, skipped: 0 },
    };
    /** A snapshot answering for a resident this process holds. @type {import("../lib/agent.js").AgentStatus} */
    const LIVE = { distro: "ubuntu", state: "ready", pid: 7000, lastError: "", deaths: 0, pending: 0 };
    assert.equal(mergeLiveResidentStatus(report, undefined), report, "no snapshot, no merge");
    assert.equal(mergeLiveResidentStatus(report, { ...LIVE, pid: undefined }), report, "a never-started singleton says nothing about the app's resident");
    const noHandshake = { ...report, checks: report.checks.filter((entry) => entry.id !== "agent.handshake") };
    assert.equal(mergeLiveResidentStatus(noHandshake, LIVE), noHandshake, "no handshake check, no merge");

    const healthy = mergeLiveResidentStatus(report, LIVE);
    const hand = healthy.checks.find((entry) => entry.id === "agent.handshake");
    assert.match(String(hand?.detail), /probed: the live resident \(pid 7000, state ready, deaths 0, pending 0\)/);
    assert.match(String(hand?.detail), /fresh-probe facts: probed: a fresh resident, pid 4242/, "the fresh probe's digest facts are kept");
    assert.equal(hand?.status, "ok", "no error, no verdict change");
    assert.equal(hand?.distro, "ubuntu", "the schema-2 shape fields ride through the merge");
    assert.equal(hand?.blocksFirstCommand, true);
    assert.equal(healthy.checks.find((entry) => entry.id === "wsl.version"), report.checks[0], "the other checks pass through");

    const wounded = mergeLiveResidentStatus(report, { ...LIVE, lastError: "agent handshake timed out after 30000ms", deaths: 2 });
    const warn = wounded.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(warn?.status, "warn", "a lastError on a running resident surfaces as warn");
    assert.match(String(warn?.detail), /deaths 2/);
    assert.match(String(warn?.detail), /lastError: agent handshake timed out/);
    assert.equal(wounded.summary.ok, 0, "the ok tally drops");
    assert.equal(wounded.summary.warn, 1, "the warn tally rises");
    assert.equal(report.summary.ok, 1, "the input report is not mutated");

    const dead = mergeLiveResidentStatus(report, { ...LIVE, state: "dead", lastError: "permanently out after 4 deaths", deaths: 4 });
    assert.equal(dead.checks.find((entry) => entry.id === "agent.handshake")?.status, "fail", "a dead live resident fails the check");

    // A fresh probe that carries a remedy keeps it through the merge — the
    // digest-mismatch shape, merged instead of discarded.
    const withRemedy = {
      ...report,
      checks: [{ id: "agent.handshake", status: "fail", detail: "probed: a fresh resident, pid 4242, digest MISMATCH", remedy: "resync the runtime copy (pnpm run sync:windows), then restart the app" }, ...report.checks.filter((entry) => entry.id !== "agent.handshake")],
      summary: { ok: 0, info: 1, warn: 0, fail: 1 },
    };
    const mergedRemedy = mergeLiveResidentStatus(withRemedy, LIVE);
    assert.equal(mergedRemedy.checks.find((entry) => entry.id === "agent.handshake")?.remedy, "resync the runtime copy (pnpm run sync:windows), then restart the app", "the remedy survives the merge");

    // Degenerate shapes: a detail-less check and a summary without the key
    // the tally shift touches must not crash the merge.
    const sparse = {
      schemaVersion: 1,
      checks: [{ id: "agent.handshake", status: "ok" }],
      summary: { ok: 1 },
    };
    const mergedSparse = mergeLiveResidentStatus(sparse, { ...LIVE, lastError: "transient", state: "ready" });
    assert.equal(mergedSparse.summary.warn, 1, "a missing tally key counts up from zero");
    assert.match(String(mergedSparse.checks[0]?.detail), /fresh-probe facts: $/, "a detail-less fresh check degrades to an empty tail");
  });

  await check("doctorReport collects the real script and merges the injected live snapshot", async () => {
    // doctorReport spawns `node scripts/doctor.mjs --json`; the doctor's own
    // wsl.exe resolution is pinned with --wsl so the fake is authoritative
    // regardless of the runner's PATH. The check asserts COLLECTION and MERGE
    // only — whether the doctor's other environment checks pass is the
    // machine's business, not this suite's, so a nonzero exit with a
    // well-formed report is fine (CI runners have no bubblewrap). What must
    // fail is a subprocess that produced no report.
    //
    // A staged fake that does not answer its own probe means this runner
    // cannot host the e2e (observed on CI's ubuntu runners, whose exec
    // environment rejects the fake's shebang interop); skip it like every
    // environment-gated probe instead of failing on a foreign machine.
    const staged = spawnSync(join(bin, "wsl.exe"), ["-l", "-q"], { encoding: "utf8", timeout: 10000 });
    if (staged.status !== 0 || !/ubuntu/.test(staged.stdout)) {
      console.log(`SKIP  (e2e) the staged fake did not answer -l -q (status ${staged.status}, stdout ${JSON.stringify(staged.stdout.slice(0, 40))})`);
      return;
    }
    {
      const merged = await doctorReport("ubuntu", {
        wslPath: join(bin, "wsl.exe"),
        envPath: bin,
        liveStatus: { distro: "ubuntu", state: "dead", pid: 7000, lastError: "wedge observed in the live app", deaths: 4, pending: 0 },
      }).catch((error) => {
        // Full facts for the CI-only failure: what the fake answers when the
        // doctor suite calls it directly, and the doctor's own human output.
        const direct = spawnSync(join(bin, "wsl.exe"), ["-l", "-q"], { encoding: "utf8", timeout: 10_000 });
        const human = spawnSync(process.execPath, [join(ROOT, "scripts", "doctor.mjs"), "ubuntu"], { encoding: "utf8", timeout: 60_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` } });
        assert.fail(`the doctor subprocess produced no report: ${/** @type {Error} */ (error).message}\n`
          + `direct fake -l -q: status=${direct.status} stdout=${JSON.stringify(direct.stdout)} stderr=${JSON.stringify(direct.stderr.slice(0, 120))}\n`
          + `doctor human tail: ${human.stdout.split("\n").filter((line) => /host\.|distro\./.test(line)).join(" | ") || human.stderr.slice(0, 200)}`);
      });
      const handshake = merged.checks.find((entry) => entry.id === "agent.handshake");
      assert.ok(handshake, "the collected report has the handshake check");
      assert.equal(handshake.status, "fail", "the dead live resident fails the merged check");
      assert.match(String(handshake?.detail), /probed: the live resident/);
      assert.match(String(handshake?.detail), /fresh-probe facts: probed: a fresh resident, pid 4242/);

      // Outside the app (no resident this process holds), the report is the
      // fresh probe verbatim — the merge never invents facts. The same
      // collection-only contract applies: a doctor exit over this machine's
      // own failed environment checks must not fail THIS check. The
      // handshake assertion is conditional: on a runner where the fake's
      // -l -q answer comes back empty the doctor returns before the
      // handshake check ever runs (host.distros fails first), and that
      // runner quirk is not what this check owns.
      const fresh = await doctorReport("ubuntu", { wslPath: join(bin, "wsl.exe"), envPath: bin }).catch((error) => {
        assert.fail(`the doctor subprocess produced no report: ${/** @type {Error} */ (error).message}`);
      });
      const freshHandshake = fresh.checks.find((entry) => entry.id === "agent.handshake");
      if (freshHandshake !== undefined) {
        assert.match(String(freshHandshake?.detail), /probed: a fresh resident/);
        assert.doesNotMatch(String(freshHandshake?.detail), /probed: the live resident/);
      }
    }
  });

  await check("doctorReport rejects with the spawn detail when the doctor produces no report", async () => {
    // A doctor that exits without versioned JSON (a crash, an unknown-option
    // throw) must reject with the spawn failure and the stderr tail — the
    // caller's only diagnostics for a run that never reported. The injected
    // crasher pins the trigger deterministically (the shipped script cannot
    // be made to exit silently on a healthy machine).
    const crasher = join(bin, "crash-doctor.mjs");
    writeFileSync(crasher, "process.exit(1);\n");
    await assert.rejects(
      doctorReport("ubuntu", { doctorPath: crasher, wslPath: join(bin, "wsl.exe"), envPath: bin }),
      /** @param {Error} error */ (error) => /doctor run failed/.test(error.message) && /exited with code/.test(error.message),
      "the rejection names the exit and the absent stderr",
    );
  });

  await check("the Windows git trust check reports the whitelist and a missing-git info", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    const ok = report.checks.find((entry) => entry.id === "git.win-safe");
    assert.equal(ok?.status, "ok", "the fake git.exe whitelists the share");
    assert.match(String(ok?.detail), /whitelisted/);
  });

  await check("the human output names the failing check and its remedy", () => {
    const run = doctor([], { FAKE_BWRAP: "no" });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /fail {2}bubblewrap/);
    assert.match(run.stdout, /fix: wsl\.exe -d ubuntu -u root -- apt-get install -y bubblewrap/);
  });

  await check("a stopped distro is classified with a recovery remedy", () => {
    const run = doctor(["--json"], { FAKE_STOPPED: "yes" });
    assert.equal(run.status, 1);
    const reachable = /** @type {Report} */ (JSON.parse(run.stdout)).checks.find((entry) => entry.id === "distro.reachable");
    assert.equal(reachable?.status, "fail");
    assert.match(String(reachable?.remedy), /wsl\.exe --shutdown/);
  });

  await check("peerSatisfied understands exact pins, floor ranges and caret ranges", () => {
    assert.equal(peerSatisfied("0.2.1-rc.2", "0.2.1-rc.2"), true);
    assert.equal(peerSatisfied("0.2.2-rc.2", "0.2.1-rc.2"), false);
    assert.equal(peerSatisfied("0.2.1-rc.2", ">=0.2.1-rc.3"), false);
    assert.equal(peerSatisfied("0.2.1-rc.3", ">=0.2.1-rc.3"), true);
    assert.equal(peerSatisfied("0.2.1-rc.10", ">=0.2.1-rc.9"), true, "numeric prerelease identifiers compare numerically, not lexically");
    assert.equal(peerSatisfied("0.2.1", ">=0.2.1-rc.3"), true, "the release sorts above its own prerelease floor");
    assert.equal(peerSatisfied("0.2.2-rc.1", ">=0.2.1-rc.3"), true);
    assert.equal(peerSatisfied("1.0.0", ">=0.2.1-rc.3"), true);
    assert.equal(peerSatisfied("4.0.4", "^4.0.5"), false);
    assert.equal(peerSatisfied("4.0.5", "^4.0.5"), true);
    assert.equal(peerSatisfied("4.9.9", "^4.0.5"), true);
    assert.equal(peerSatisfied("5.0.0", "^4.0.5"), false);
    assert.equal(peerSatisfied("0.3.0", "^0.2.1"), false, "a caret on 0.x locks the minor");
    assert.equal(peerSatisfied("4.0.5", ">=4"), true, "a bare major floor parses as 4.0.0");
    assert.equal(peerSatisfied("3.9.9", ">=4"), false);
    assert.equal(peerSatisfied("4.0.5", "<4.0.0"), undefined);
    assert.equal(peerSatisfied("4.0.5", "*"), undefined, "shapes outside the manifest's vocabulary stay unchecked");
  });

  await check("the update check answers on demand and never fails the run", () => {
    const run = doctor(["--json"]);
    assert.equal(run.status, 0, run.stderr);
    const update = /** @type {Report} */ (JSON.parse(run.stdout)).checks.find((entry) => entry.id === "update.latest");
    // The empty override asked no registry: the honest answer is "cannot tell",
    // as `info`, with the page that asks it live named as the way out.
    assert.equal(update?.status, "info");
    assert.match(String(update?.detail), /registry was unreachable/);
  });

  await check("latestFromPackument reads the stable channel and its marks", () => {
    const packument = {
      name: "dsh-plugin-wsl-env",
      "dist-tags": { latest: "0.20.0", next: "0.21.0-rc.1" },
      versions: {
        "0.20.0": { deprecated: "superseded by 0.20.1" },
        "0.21.0-rc.1": {},
      },
    };
    assert.deepEqual(latestFromPackument(packument), { version: "0.20.0", deprecated: "superseded by 0.20.1" });
    assert.deepEqual(
      latestFromPackument({ "dist-tags": { latest: "0.20.0" }, versions: { "0.20.0": {} } }),
      { version: "0.20.0" },
      "a healthy release carries no marks",
    );
    assert.equal(latestFromPackument({}), undefined, "no dist-tags, no release");
    assert.equal(latestFromPackument({ "dist-tags": {} }), undefined, "no latest tag, no release");
    assert.equal(latestFromPackument({ "dist-tags": { latest: "0.20.0" }, versions: {} }), undefined, "a tag without a document names no release");
    assert.equal(latestFromPackument("not an object"), undefined, "a non-object body names no release");
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`${passed} doctor checks pass`);
