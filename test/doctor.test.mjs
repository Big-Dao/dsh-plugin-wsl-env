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
import { peerSatisfied } from "../scripts/doctor.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The digest the agent script self-reports; the fake HELLO carries it. */
const AGENT_DIGEST = createHash("sha256").update(readFileSync(join(ROOT, "agent", "wsl-agent.sh"))).digest("hex");

/** @typedef {{ id: string, status: string, detail?: string, remedy?: string }} Check */
/** @typedef {{ schemaVersion: number, checks: Check[], summary: Record<string, number> }} Report */

if (process.platform === "win32") {
  console.log("SKIP  doctor tests: the fake wsl.exe is a POSIX script");
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "dsh-doctor-"));
const bin = join(scratch, "bin");
const home = join(scratch, "dsh-home");
mkdirSync(bin);
mkdirSync(home);

const FAKE_WSL = `#!/bin/sh
case "$*" in
  "-l -q") printf 'ubuntu\\n'; exit 0 ;;
  "--version") printf 'WSL version: 2.0.0\\nKernel version: 6.6.87.2\\n'; exit 0 ;;
esac
all="$*"
case "$all" in
  *"-d ubuntu"*) [ "\${FAKE_STOPPED:-no}" = yes ] && { printf 'WSL_E_DISTRO_NOT_FOUND\n' >&2; exit 1; } ;;
esac
case "$all" in
  *"--exec sh /"*)
    if [ "\${FAKE_AGENT_DIGEST:-}" = bad ]; then printf 'HELLO|wsl-agent|5|deadbeef|4242\\n'; else printf 'HELLO|wsl-agent|5|${AGENT_DIGEST}|4242\\n'; fi
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
writeFileSync(join(bin, "wsl.exe"), FAKE_WSL);
writeFileSync(join(bin, "cmd.exe"), FAKE_CMD);
chmodSync(join(bin, "wsl.exe"), 0o755);
chmodSync(join(bin, "cmd.exe"), 0o755);

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
 * Run one named check.
 * @param {string} name - the check name.
 * @param {() => void} fn - the assertions.
 */
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

try {
  check("a healthy machine reports no failures and exits 0", () => {
    const run = doctor(["--json"]);
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.summary.fail, 0);
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.bwrap")?.status, "ok");
    assert.equal(report.checks.find((entry) => entry.id === "peers.versions")?.status, "ok");
  });

  check("missing bubblewrap fails with a copy-paste install remedy", () => {
    const run = doctor(["--json"], { FAKE_BWRAP: "no" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const bwrap = report.checks.find((entry) => entry.id === "sandbox.bwrap");
    assert.equal(bwrap?.status, "fail");
    assert.match(String(bwrap?.remedy), /apt-get install -y bubblewrap/);
  });

  check("no systemd fails and names the wsl.conf remedy", () => {
    const run = doctor(["--json"], { FAKE_SYSTEMD: "no" });
    assert.equal(run.status, 1);
    const systemd = /** @type {Report} */ (JSON.parse(run.stdout)).checks.find((entry) => entry.id === "session.systemd");
    assert.equal(systemd?.status, "fail");
    assert.match(String(systemd?.remedy), /\[boot\] systemd=true/);
  });

  check("stale scopes warn, and --fix sweeps them", () => {
    const warn = doctor(["--json"], { FAKE_STALE: "yes" });
    assert.equal(warn.status, 0);
    assert.equal(/** @type {Report} */ (JSON.parse(warn.stdout)).checks.find((entry) => entry.id === "runtime.scopes")?.status, "warn");
    const fixed = doctor(["--json", "--fix"], { FAKE_STALE: "yes" });
    assert.equal(fixed.status, 0);
    assert.equal(/** @type {Report} */ (JSON.parse(fixed.stdout)).checks.find((entry) => entry.id === "fix.scopes")?.status, "ok");
  });

  check("the agent handshake reports the pid and catches a digest mismatch", () => {
    const good = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    const ok = good.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(ok?.status, "ok");
    assert.match(String(ok?.detail), /pid 4242/);
    const bad = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_AGENT_DIGEST: "bad" }).stdout));
    const mismatch = bad.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(mismatch?.status, "fail");
    assert.match(String(mismatch?.detail), /MISMATCH/);
    assert.match(String(mismatch?.remedy), /sync:windows/);
  });

  check("the human output names the failing check and its remedy", () => {
    const run = doctor([], { FAKE_BWRAP: "no" });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /fail {2}bubblewrap/);
    assert.match(run.stdout, /fix: wsl\.exe -d ubuntu -u root -- apt-get install -y bubblewrap/);
  });

  check("a stopped distro is classified with a recovery remedy", () => {
    const run = doctor(["--json"], { FAKE_STOPPED: "yes" });
    assert.equal(run.status, 1);
    const reachable = /** @type {Report} */ (JSON.parse(run.stdout)).checks.find((entry) => entry.id === "distro.reachable");
    assert.equal(reachable?.status, "fail");
    assert.match(String(reachable?.remedy), /wsl\.exe --shutdown/);
  });

  check("peerSatisfied understands exact pins, floor ranges and caret ranges", () => {
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
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`${passed}/8 doctor checks pass`);
