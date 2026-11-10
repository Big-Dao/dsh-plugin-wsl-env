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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { peerSatisfied, parseWslConfig, parseWslSize, parseIni, parseWslVerbose, effectiveMaskWindowsDrive, distroPath, hostDiskVerdict, localeNameFromReg, localeFromTag, overrideLocale, setDoctorLocale, doctorT } from "../scripts/doctor.mjs";
import { mergeLiveResidentStatus } from "../lib/doctor-live.js";
import { doctorReport } from "../lib/index.js";
import { effectiveMaskWindowsDrive as libEffectiveMaskWindowsDrive } from "../lib/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The digest the agent script self-reports; the fake HELLO carries it. */
const AGENT_DIGEST = createHash("sha256").update(readFileSync(join(ROOT, "agent", "wsl-agent.sh"))).digest("hex");
/** The content-addressed cache entry the fake native binary lives under. */
const CACHE_DIGEST = "a".repeat(64);

/** @typedef {{ id: string, status: string, detail?: string, remedy?: string, distro?: string, blocksFirstCommand?: boolean }} Check */
/** @typedef {{ schemaVersion: number, checks: Check[], summary: Record<string, number>, verdict?: string, blockers?: string[], distroVerdicts?: Array<{ name: string, verdict: string, blockers: string[] }>, config?: Record<string, string | string[]>, scope?: { sections: string[], quick: boolean } }} Report */

if (process.platform === "win32") {
  console.log("SKIP  doctor tests: the fake wsl.exe is a POSIX script");
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), "dsh-doctor-"));
const bin = join(scratch, "bin");
const home = join(scratch, "dsh-home");
const stateDir = join(scratch, "state");
mkdirSync(bin);
mkdirSync(home);
mkdirSync(stateDir);

const FAKE_WSL = `#!/bin/sh
case "$*" in
  "-l -q"|"--list -q") printf '%s\\n' \${FAKE_DISTROS:-ubuntu} | tr ' ' '\\n'; exit 0 ;;
  "-l -v") printf '  NAME            STATE           VERSION\\n  ubuntu*         Running         %s\\n' "$([ "\${FAKE_WSL1:-no}" = yes ] && printf 1 || printf 2)"; case "\${FAKE_DISTROS:-ubuntu}" in *debian*) printf '  debian          Stopped         2\\n' ;; esac; exit 0 ;;
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
  *"-u root"*) : > "\${FAKE_STATE_DIR:-/nonexistent}/installed-bwrap"; exit 0 ;;
esac
case "$all" in
  *"--exec bwrap"*)
    case "$all" in
      *dsh-doctor-smoke-refuse*) exit 1 ;;
      *'inside'*) printf 'ok' ;;
      *) exit 0 ;;
    esac ;;
esac
case "$all" in
  *"--exec /"*)
    printf 'HELLO|wsl-agent|7|${CACHE_DIGEST}|5150|conc,batch\n'
    [ "\${FAKE_NATIVE:-ok}" = bad ] && exit 0
    while IFS= read -r line; do
      case "$line" in
        SHUTDOWN) exit 0 ;;
        PING) printf 'PONG\\n' ;;
        EXEC\\|*|FS\\|*|FSB\\|*)
          id="$(printf '%s' "$line" | cut -d'|' -f2)"
          printf 'ACK|%s\\n' "$id"
          case "$line" in
            FSB\\|*) payload="$(printf 'OK 1|eA==\\nOK 2|eA==\\n' | base64 | tr -d '\\n')"; printf 'RES|%s|0|%s||0|0\\n' "$id" "$payload" ;;
            *) printf 'RES|%s|0|%s||0|0\\n' "$id" "$(printf 'x86_64' | base64 | tr -d '\\n')" ;;
          esac ;;
      esac
    done
    exit 0 ;;
esac
case "$all" in
  *"--exec sh /"*)
    if [ "\${FAKE_HANDSHAKE:-ok}" = fail ] && [ ! -f "\${FAKE_STATE_DIR:-/nonexistent}/cache-purged" ]; then exit 0; fi
    if [ "\${FAKE_AGENT_DIGEST:-}" = bad ]; then printf 'HELLO|wsl-agent|7|deadbeef|4242|batch\\n'; else printf 'HELLO|wsl-agent|7|${AGENT_DIGEST}|4242|batch\\n'; fi
    [ "\${FAKE_RESIDENT_DIES:-no}" = yes ] && exit 0
    while IFS= read -r line; do
      case "$line" in
        SHUTDOWN) exit 0 ;;
        PING) printf 'PONG\\n' ;;
        EXEC\\|*|FS\\|*|FSB\\|*)
          id="$(printf '%s' "$line" | cut -d'|' -f2)"
          printf 'ACK|%s\\n' "$id"
          case "$line" in
            FSB\\|*)
              if [ "\${FAKE_FSB:-ok}" = busybox ]; then
                inner="$(printf 'find: unrecognized: -printf\\nBusyBox v1.37.0' | base64 | tr -d '\\n')"
                payload="$(printf 'BAD 1|io|%s' "$inner" | base64 | tr -d '\\n')"
              else
                payload="$(printf 'OK 1|eA==\\nOK 2|eA==\\n' | base64 | tr -d '\\n')"
              fi
              printf 'RES|%s|0|%s||0|0\\n' "$id" "$payload" ;;
            *) printf 'RES|%s|0|%s||0|0\\n' "$id" "$(printf 'x86_64' | base64 | tr -d '\\n')" ;;
          esac ;;
      esac
    done
    exit 0 ;;
esac
case "$all" in
  *"--exec sh -c"*)
    case "$all" in
      *'.dsh-doctor-XXXXXXXX'*) printf '%s' "\${FAKE_HOME_PROBE:-ok}" ;;
      *'printf %s ok'*)
        if [ "$FAKE_FLAKE" = always ]; then printf 'connection attempt failed because the connected party did not properly respond Wsl/Service/WSAETIMEDOUT\n' >&2; exit 1; fi
        if [ "$FAKE_FLAKE" = once ] && [ ! -f "\${FAKE_STATE_DIR:-/nonexistent}/flake-once" ]; then : > "\${FAKE_STATE_DIR:-/nonexistent}/flake-once"; printf 'connection attempt failed because the connected party did not properly respond Wsl/Service/WSAETIMEDOUT\n' >&2; exit 1; fi
        printf 'ok' ;;
      *'SH='*) [ "\${FAKE_IDENTITY:-ok}" = bad ] && printf 'SH=\nHM=\n' || printf 'SH=/bin/bash\nHM=%s\n' "$HOME" ;;
      *'uname -r'*) printf '6.6.87.2' ;;
      *'for f in apt-get'*) printf 'apt-get' ;;
      *'apt-get install'*) : > "\${FAKE_STATE_DIR:-/nonexistent}/installed-bwrap"; exit 0 ;;
      *'command -v bwrap'*) [ -f "\${FAKE_STATE_DIR:-/nonexistent}/installed-bwrap" ] && printf '/usr/bin/bwrap' || { [ "\${FAKE_BWRAP:-yes}" = no ] || printf '/usr/bin/bwrap'; } ;;
      *'bwrap --ro-bind'*)
        case "$all" in
          *dsh-doctor-smoke-refuse*) exit 1 ;;
          *'inside'*) printf 'ok' ;;
          *) exit 0 ;;
        esac ;;
      *'/run/systemd/system'*) [ "\${FAKE_SYSTEMD:-yes}" = no ] && printf 'none init' || printf 'systemd systemd' ;;
      *'command -v systemd-run'*) printf '/usr/bin/systemd-run' ;;
      *'systemctl --user stop'*) : > "\${FAKE_STATE_DIR:-/nonexistent}/swept-scopes"; exit 0 ;;
      *'echo "$unit'*) { [ -f "\${FAKE_STATE_DIR:-/nonexistent}/swept-scopes" ] || [ "\${FAKE_STALE:-no}" != yes ]; } || printf 'dsh-wsl-ubuntu-x.scope stale' ;;
      *'systemctl --user stop'*) exit 0 ;;
      *'systemctl --user is-system-running'*) printf 'running' ;;
      *'loginctl show-user'*) printf 'Linger=yes' ;;
      *'command -v rg'*) printf '/usr/bin/rg' ;;
      *'command -v git'*) printf '/usr/bin/git' ;;
      *'command -v inotifywait'*) printf '/usr/bin/inotifywait' ;;
      *'[ -f'*) case "\${FAKE_SCRIPT_READABLE:-yes}" in debian) case "$all" in *"-d debian"*) printf no ;; *) printf yes ;; esac ;; no) printf no ;; *) printf yes ;; esac ;;
      *'cat /etc/wsl.conf'*) printf '%s' "\${FAKE_WSLCONF:-}" ;;
      *'df -Pm /'*) printf 'Filesystem 1M-blocks Used Available Capacity Mounted\n/dev/sdc 262030 151898 110132 %s%% /\n' "\${FAKE_DISK:-42}" ;;
      *'date +%s'*) printf '%s' "\${FAKE_CLOCK:-$(date +%s)}" ;;
      *'wc -c < /etc/resolv.conf'*) printf '%s' "\${FAKE_RESOLV:-365}" ;;
      *'getent hosts'*) [ "\${FAKE_DNS:-yes}" = no ] || printf '1.2.3.4 deb.debian.org\n' ;;
      *'binfmt_misc/WSLInterop'*) [ "\${FAKE_BINFMT:-yes}" = no ] || printf 'yes' ;;
      *'cat /proc/net/tcp'*) printf '  sl  local_address rem_address   st tx_queue rx_queue\n   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 0 1\n' ;;
      *'hostname -I'*) printf '172.20.0.5 ' ;;
      *'uname -m'*) printf 'x86_64' ;;
      *'rm -rf "$HOME/.cache/dsh-wsl/agent"'*) : > "\${FAKE_STATE_DIR:-/nonexistent}/cache-purged"; exit 0 ;;
      *'.cache/dsh-wsl/agent'*)
        if [ "\${FAKE_CACHE:-good}" = noexec ]; then
          [ -f "\${FAKE_STATE_DIR:-/nonexistent}/cache-purged" ] && printf 'none' || printf 'noexec %s/.cache/dsh-wsl/agent/${CACHE_DIGEST}/dsh-wsl-agent' "$HOME"
        else printf 'exec %s/.cache/dsh-wsl/agent/${CACHE_DIGEST}/dsh-wsl-agent' "$HOME"; fi ;;
      *'mktemp -d'*) printf '/tmp/dsh-doctor-smoke-fixed' ;;
      *'rm -rf'*) exit 0 ;;
      *) : ;;
    esac
    ;;
esac
exit 0
`;
const FAKE_CMD = `#!/bin/sh
case "$*" in
  *"echo %USERPROFILE%"*) printf 'C:\\\\Users\\\\andy\\n'; exit 0 ;;
  *"type"*) printf '%s' "\${FAKE_WSLCONFIG:-}"; exit 0 ;;
  *) printf 'Microsoft Windows [Version 10.0.%s]\\n' "\${FAKE_WINBUILD:-26300.9711}"; exit 0 ;;
esac
`;
const FAKE_GIT_EXE = `#!/bin/sh
case "$*" in
  "--version") printf 'git version 2.54.0.windows.1\n' ;;
  *"--get-all safe.directory"*) [ -f "\${FAKE_STATE_DIR:-/nonexistent}/git-whitelisted" ] && printf '//wsl.localhost/*\n'; exit 0 ;;
  *"--add safe.directory"*) : > "\${FAKE_STATE_DIR:-/nonexistent}/git-whitelisted"; exit 0 ;;
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
  env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, DSH_HOME: home, FAKE_STATE_DIR: stateDir, ...env },
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
    assert.equal(report.checks.find((entry) => entry.id === "functional.native")?.status, "ok", "the cached native binary answers HELLO with its cache digest");
    assert.equal(report.checks.find((entry) => entry.id === "agent.home-writable")?.status, "ok");
    assert.equal(report.checks.find((entry) => entry.id === "host.platform")?.status, "ok");
  });

  await check("host.platform fails on a Windows build below the WSL 2 floor", () => {
    const old = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_WINBUILD: "17763.1" }).stdout));
    const platform = old.checks.find((entry) => entry.id === "host.platform");
    assert.equal(platform?.status, "fail");
    assert.match(String(platform?.detail), /19041/);
    assert.equal(old.verdict, "blocked");
    const modern = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_WINBUILD: "19045.4291" }).stdout));
    assert.equal(modern.checks.find((entry) => entry.id === "host.platform")?.status, "ok");
  });

  await check("distroPath translates Windows drives through the distro's automount root", () => {
    assert.equal(distroPath("C:\\Users\\andy\\a.txt", "/mnt"), "/mnt/c/Users/andy/a.txt");
    assert.equal(distroPath("/home/andy/a.sh", "/mnt"), "/home/andy/a.sh");
    assert.equal(distroPath("\\\\server\\share", "/mnt"), undefined);
    assert.equal(distroPath("D:\\x", "/c"), "/c/d/x");
  });

  await check("hostDiskVerdict warns before the Windows volume fills and fails when it is full", () => {
    const G = 1024 ** 3;
    assert.equal(hostDiskVerdict(50 * G, 500 * G).status, "ok");
    assert.equal(hostDiskVerdict(4 * G, 500 * G).status, "warn");
    assert.equal(hostDiskVerdict(1 * G, 500 * G).status, "fail");
  });

  await check("a disabled sandbox warns loudly and skips the fence instead of blocking", () => {
    const profile = join(home, "profiles", "no-sandbox");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "cordis.patch.yml"), "- id: preset-wsl\n  config:\n    sessionSandbox: false\n    plugins:\n      - id: wsl-shell\n        config:\n          sandbox: false\n- id: fs-routing\n  config:\n    sandbox: false\n");
    const run = doctor(["--json"]);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const bwrap = report.checks.find((entry) => entry.id === "sandbox.bwrap");
    assert.equal(bwrap?.status, "warn");
    assert.match(String(bwrap?.detail), /UNCONFINED/);
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.bwrap-usable")?.status, "skipped");
    assert.equal(report.checks.find((entry) => entry.id === "functional.sandbox")?.status, "skipped");
    assert.equal(report.verdict, "ready", "the opt-out is a warning, not a blocker");
    assert.equal(run.status, 0);
    rmSync(profile, { recursive: true, force: true });
  });

  await check("the identity check names a broken passwd entry", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_IDENTITY: "bad" }).stdout));
    const identity = report.checks.find((entry) => entry.id === "distro.identity");
    assert.equal(identity?.status, "fail");
    assert.match(String(identity?.detail), /shell=\(none\)/);
    assert.equal(report.verdict, "blocked");
  });

  await check("a pinned native backend turns a broken cache into a blocker", () => {
    const profile = join(home, "profiles", "native-pin");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "cordis.patch.yml"), "- id: preset-wsl\n  config:\n    agentBackend: native\n    plugins:\n      - id: wsl-shell\n        config:\n          agentBackend: native\n");
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_CACHE: "noexec" }).stdout));
    assert.equal(report.checks.find((entry) => entry.id === "agent.cache")?.status, "fail");
    assert.equal(report.checks.find((entry) => entry.id === "functional.native")?.status, "skipped");
    assert.equal(report.verdict, "blocked");
    rmSync(profile, { recursive: true, force: true });
  });

  await check("a BusyBox shell fallback warns instead of blocking when the native backend is selected", () => {
    const run = doctor(["--json"], { FAKE_FSB: "busybox" });
    assert.equal(run.status, 0, "the fallback failure is not the first-command path");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const fs = report.checks.find((entry) => entry.id === "functional.fs");
    assert.equal(fs?.status, "warn");
    assert.match(String(fs?.detail), /find: unrecognized: -printf/, "the batch failure is decoded, not printed as base64");
    assert.match(String(fs?.detail), /shell agent is the fallback/);
    assert.equal(report.checks.find((entry) => entry.id === "functional.native")?.status, "ok", "the native legs answer the same chain");
    assert.equal(report.verdict, "ready");
  });

  await check("auto fails when neither the native nor the shell backend answers the chain", () => {
    const run = doctor(["--json"], { FAKE_FSB: "busybox", FAKE_NATIVE: "bad" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.equal(report.checks.find((entry) => entry.id === "functional.native")?.status, "fail");
    assert.match(String(report.checks.find((entry) => entry.id === "functional.native")?.detail), /shell fallback failed too/);
    assert.equal(report.verdict, "blocked");
  });

  await check("the same BusyBox failure blocks when the shell agent is the configured backend", () => {
    const profile = join(home, "profiles", "shell-pin");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "cordis.patch.yml"), "- id: preset-wsl\n  config:\n    agentBackend: shell\n    plugins:\n      - id: wsl-shell\n        config:\n          agentBackend: shell\n");
    const run = doctor(["--json"], { FAKE_FSB: "busybox" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const fs = report.checks.find((entry) => entry.id === "functional.fs");
    assert.equal(fs?.status, "fail");
    assert.match(String(fs?.remedy), /findutils/);
    assert.equal(report.checks.find((entry) => entry.id === "functional.native")?.status, "skipped");
    rmSync(profile, { recursive: true, force: true });
  });

  await check("the quick profile runs prerequisites only and stamps the scope", async () => {
    const run = doctor(["--json", "--quick"]);
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.deepEqual(report.scope, { sections: ["host", "session", "sandbox"], quick: true });
    for (const id of report.checks.map((/** @type {{ id: string }} */ c) => c.id)) {
      assert.doesNotMatch(id, /^(functional\.|agent\.)/, "quick never runs the agent smokes or the agent chain");
    }
    assert.equal(report.checks.some((entry) => entry.id.startsWith("tools.")), false, "quick skips the optional-tool probes");
    assert.equal(report.checks.find((entry) => entry.id === "distro.dns"), undefined, "quick skips the net section");
    assert.ok(report.checks.find((entry) => entry.id === "session.linger"), "the session prerequisites stay in the quick profile");
  });

  await check("--sections bounds the report and the verdict answers for the requested scope", async () => {
    const run = doctor(["--json", "--sections", "sandbox"]);
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    assert.deepEqual(report.scope?.sections, ["sandbox"]);
    const ids = report.checks.map((/** @type {{ id: string }} */ c) => c.id);
    assert.ok(ids.includes("distro.reachable"), "the transport gate stays in every scoped run");
    assert.ok(ids.includes("sandbox.bwrap"), "the selected section reports");
    assert.ok(!ids.includes("session.linger"), "other sections stay out");
    assert.equal(report.verdict, "ready", "a scoped verdict answers for its scope only");
  });

  await check("a one-shot transport flake is retried and does not taint the verdict", async () => {    rmSync(join(stateDir, "flake-once"), { force: true });
    const run = doctor(["--json"], { FAKE_FLAKE: "once" });
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const reachable = report.checks.find((entry) => entry.id === "distro.reachable");
    assert.equal(reachable?.status, "ok", "the retry recovers the flaked reachability probe");
    assert.equal(report.summary.unknown, 0);
    assert.equal(report.verdict, "ready");
  });

  await check("a persistent flake reports unknown, never a config verdict", async () => {
    const run = doctor(["--json"], { FAKE_FLAKE: "always" });
    assert.equal(run.status, 0, "unknown never blocks");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const reachable = report.checks.find((entry) => entry.id === "distro.reachable");
    assert.equal(reachable?.status, "unknown");
    assert.equal(reachable?.blocksFirstCommand, false, "unknown is not a blocker");
    assert.match(String(reachable?.detail), /transport flake/);
    assert.equal(report.summary.unknown, 1, "the flaked distro stops at reachability — no config rows follow");
    assert.equal(report.verdict, "ready");
    assert.deepEqual(report.distroVerdicts, [{ name: "ubuntu", verdict: "ready", blockers: [] }]);
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

  await check("a WSL1 distro is named as the root cause and blocks", () => {
    const run = doctor(["--json"], { FAKE_WSL1: "yes" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const mode = report.checks.find((entry) => entry.id === "distro.wsl-mode");
    assert.equal(mode?.status, "fail");
    assert.match(String(mode?.detail), /WSL 1 — a declared non-goal/);
    assert.match(String(mode?.remedy), /--set-version ubuntu 2/);
    assert.ok(report.blockers?.includes("distro.wsl-mode"));
    const healthy = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    assert.equal(healthy.checks.find((entry) => entry.id === "distro.wsl-mode")?.status, "ok", "a WSL2 distro reads ok");
  });

  await check("parseWslConfig names the silent-ignore trap and the range problems", () => {
    assert.deepEqual(parseWslConfig("[wsl2]\nmemory=4GB\nprocessors=8\n"), { problems: [], keyCount: 2 }, "a clean file has no findings");
    assert.equal(parseWslSize("4GB"), 4 * 1024 ** 3);
    assert.equal(parseWslSize("512MB"), 512 * 1024 ** 2);
    assert.equal(parseWslSize("8368805888"), 8368805888);
    assert.equal(parseWslSize("soon"), undefined);
    const bad = parseWslConfig("[wsl2]\nmemory=0\nbadline\nfoo=bar\nmemory=abc\nlocalhostForwarding=false\n[experimental]\nsparseVhd=true\n[mystery]\nx=1\n");
    assert.equal(bad.keyCount, 6);
    assert.ok(bad.problems.some((problem) => /memory=0 — the VM gets no memory/.test(problem)), String(bad.problems));
    assert.ok(bad.problems.some((problem) => /line 3 is not "key = value"/.test(problem)));
    assert.ok(bad.problems.some((problem) => /unknown key "foo"/.test(problem)));
    assert.ok(bad.problems.some((problem) => /memory="abc" is not a size/.test(problem)));
    assert.ok(bad.problems.some((problem) => /localhostForwarding=false/.test(problem)));
    assert.ok(bad.problems.some((problem) => /unknown section \[mystery\]/.test(problem)));
  });

  await check("config.wslconfig reads through the cmd.exe route and warns, never blocks", () => {
    const run = doctor(["--json"], { FAKE_WSLCONFIG: "[wsl2]\nmemory=0\n" });
    assert.equal(run.status, 0, "a hazardous .wslconfig degrades advice; it never blocks the first command");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const wslconfig = report.checks.find((entry) => entry.id === "config.wslconfig");
    assert.equal(wslconfig?.status, "warn");
    assert.match(String(wslconfig?.detail), /memory=0/);
    assert.match(String(wslconfig?.remedy), /wsl\.exe --shutdown/);
    const healthy = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    assert.equal(healthy.checks.find((entry) => entry.id === "config.wslconfig")?.status, "ok", "no content means the defaults apply");
    assert.equal(healthy.checks.find((entry) => entry.id === "config.wslconfig")?.distro, undefined, "the global VM config is host-level");
  });

  await check("parseIni reads wsl.conf sections for the cross-checks", () => {
    const conf = parseIni("[boot]\nsystemd=true\n\n[interop]\nEnabled=false\n# comment\nappendWindowsPath=false\n[automount]\nroot=/windir\n");
    assert.equal(conf.boot?.systemd, "true");
    assert.equal(conf.interop?.enabled, "false", "keys lowercase for lookup");
    assert.equal(conf.interop?.appendwindowspath, "false", "keys are fully lowercased");
    assert.equal(conf.automount?.root, "/windir");
    assert.deepEqual(parseIni("no sections here\n"), {}, "a line without = is skipped");
  });

  await check("/etc/wsl.conf defaults read as informative rows", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    assert.equal(report.checks.find((entry) => entry.id === "distro.wsl-conf-boot")?.status, "info");
    assert.equal(report.checks.find((entry) => entry.id === "distro.wsl-conf-interop")?.status, "ok");
    assert.equal(report.checks.find((entry) => entry.id === "distro.wsl-conf-automount")?.status, "ok");
  });

  await check("a conf value not in effect is named, and the runtime requirement still blocks", () => {
    const run = doctor(["--json"], { FAKE_SYSTEMD: "no", FAKE_WSLCONF: "[boot]\nsystemd=true\n" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const boot = report.checks.find((entry) => entry.id === "distro.wsl-conf-boot");
    assert.equal(boot?.status, "warn");
    assert.match(String(boot?.detail), /set but not in effect/);
    assert.match(String(boot?.remedy), /--terminate ubuntu/);
    assert.ok(report.blockers?.includes("session.systemd"), "the scope requirement still blocks under sessionSandbox: true");
  });

  await check("interop disabled in wsl.conf warns with the affected surfaces", () => {
    const run = doctor(["--json"], { FAKE_WSLCONF: "[interop]\nenabled=false\n" });
    assert.equal(run.status, 0);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const interop = report.checks.find((entry) => entry.id === "distro.wsl-conf-interop");
    assert.equal(interop?.status, "warn");
    assert.match(String(interop?.detail), /Windows git, open-in-app/);
    assert.match(String(interop?.remedy), /--terminate ubuntu/);
  });

  await check("an automount root off /mnt defeats the masking stance and says so", () => {
    const profile = join(home, "profiles", "masked");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "cordis.patch.yml"), "- id: fs-routing\n  config:\n    maskWindowsDrive: true\n");
    const run = doctor(["--json"], { FAKE_WSLCONF: "[automount]\nroot=/windir\n" });
    assert.equal(run.status, 0);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const automount = report.checks.find((entry) => entry.id === "distro.wsl-conf-automount");
    assert.equal(automount?.status, "warn");
    assert.match(String(automount?.detail), /\/windir/);
    assert.match(String(automount?.detail), /not covered/);
    rmSync(profile, { recursive: true, force: true });
    const plain = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_WSLCONF: "[automount]\nroot=/windir\n" }).stdout));
    assert.equal(plain.checks.find((entry) => entry.id === "distro.wsl-conf-automount")?.status, "ok", "without the stance, a moved root is factual, not defeating");
  });

  await check("a near-full root disk warns at 90 and fails at 97", () => {
    const warn = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_DISK: "93" }).stdout));
    const warnDisk = warn.checks.find((entry) => entry.id === "distro.disk");
    assert.equal(warnDisk?.status, "warn");
    assert.match(String(warnDisk?.detail), /93% used/);
    const fail = doctor(["--json"], { FAKE_DISK: "97" });
    assert.equal(fail.status, 1, "at 97% the first cache write is where it breaks");
    const report = /** @type {Report} */ (JSON.parse(fail.stdout));
    assert.ok(report.blockers?.includes("distro.disk"));
    assert.equal(/** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout)).checks.find((entry) => entry.id === "distro.disk")?.status, "ok");
  });

  await check("a desynced clock warns with the shutdown resync", () => {
    const run = doctor(["--json"], { FAKE_CLOCK: "1000000000" });
    assert.equal(run.status, 0, "a clock skew degrades TLS; it does not block the first command");
    const clock = /** @type {Report} */ (JSON.parse(run.stdout)).checks.find((entry) => entry.id === "distro.clock");
    assert.equal(clock?.status, "warn");
    assert.match(String(clock?.detail), /off the host/);
    assert.match(String(clock?.remedy), /wsl\.exe --shutdown/);
    assert.equal(/** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout)).checks.find((entry) => entry.id === "distro.clock")?.status, "ok");
  });

  await check("dns degrades honestly: a missing resolv.conf and a failed probe are different lines", () => {
    const missing = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_RESOLV: "0" }).stdout));
    const missingDns = missing.checks.find((entry) => entry.id === "distro.dns");
    assert.equal(missingDns?.status, "warn");
    assert.match(String(missingDns?.detail), /missing or empty/);
    assert.match(String(missingDns?.remedy), /generateResolvConf/);
    const dead = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_DNS: "no" }).stdout));
    const deadDns = dead.checks.find((entry) => entry.id === "distro.dns");
    assert.equal(deadDns?.status, "warn");
    assert.match(String(deadDns?.detail), /did not resolve/);
    assert.equal(/** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout)).checks.find((entry) => entry.id === "distro.dns")?.status, "ok");
  });

  await check("the smoke legs ride the real protocol shapes", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    assert.equal(report.checks.find((entry) => entry.id === "functional.exec")?.status, "ok");
    assert.equal(report.checks.find((entry) => entry.id === "functional.sandbox")?.status, "ok");
    const fs = report.checks.find((entry) => entry.id === "functional.fs");
    assert.equal(fs?.status, "ok");
    assert.match(String(fs?.detail), /the dir is removed/, "the batch leg cleans its temp dir");
  });

  await check("skipped legs name their blocker and never block", () => {
    const run = doctor(["--json"], { FAKE_AGENT_DIGEST: "bad" });
    assert.equal(run.status, 1, "the handshake digest failure still blocks");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const exec = report.checks.find((entry) => entry.id === "functional.exec");
    assert.equal(exec?.status, "skipped");
    assert.match(String(exec?.detail), /blocked by agent\.handshake/);
    assert.equal(exec?.blocksFirstCommand, false, "skipped never blocks — its blocker already does");
    assert.equal(report.checks.find((entry) => entry.id === "functional.fs")?.status, "skipped");
    assert.equal(report.checks.find((entry) => entry.id === "functional.sandbox")?.status, "ok", "the fence leg does not need the resident");
    assert.equal(report.summary.skipped, 2);
  });

  await check("a resident dying mid-smoke fails the leg when the shell agent is the path", () => {
    const profile = join(home, "profiles", "shell-pin");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "cordis.patch.yml"), "- id: preset-wsl\n  config:\n    agentBackend: shell\n    plugins:\n      - id: wsl-shell\n        config:\n          agentBackend: shell\n");
    const run = doctor(["--json"], { FAKE_RESIDENT_DIES: "yes" });
    assert.equal(run.status, 1);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const exec = report.checks.find((entry) => entry.id === "functional.exec");
    assert.equal(exec?.status, "fail");
    assert.match(String(exec?.detail), /exited mid-smoke/);
    assert.ok(report.blockers?.includes("functional.exec"));
    rmSync(profile, { recursive: true, force: true });
  });

  await check("the fence leg is skipped when bubblewrap is missing, and the resident legs still run", () => {
    const run = doctor(["--json"], { FAKE_BWRAP: "no" });
    assert.equal(run.status, 1, "bwrap missing still blocks");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const sandbox = report.checks.find((entry) => entry.id === "functional.sandbox");
    assert.equal(sandbox?.status, "skipped");
    assert.match(String(sandbox?.detail), /blocked by sandbox\.bwrap/);
    assert.equal(report.checks.find((entry) => entry.id === "functional.exec")?.status, "ok", "the resident legs do not need bwrap");
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

  await check("a bad agent cache is purged and re-verified", () => {
    const cacheState = join(stateDir, "cache-purge");
    mkdirSync(cacheState, { recursive: true });
    const fixed = doctor(["--json", "--fix", "--fix-owned"], { FAKE_CACHE: "noexec", FAKE_STATE_DIR: cacheState });
    assert.equal(fixed.status, 0, "the cache purge clears the only finding");
    const report = /** @type {Report} */ (JSON.parse(fixed.stdout));
    const fix = report.checks.find((entry) => entry.id === "fix.cache");
    assert.equal(fix?.status, "ok");
    assert.match(String(fix?.detail), /1 cached, 1 invalid before → 0 cached, 0 invalid after/);
    assert.equal(report.checks.find((entry) => entry.id === "agent.cache")?.status, "info");
  });

  await check("a failed handshake is re-probed after the cache purge", () => {
    const handshakeState = join(stateDir, "cache-handshake");
    mkdirSync(handshakeState, { recursive: true });
    const fixed = doctor(["--json", "--fix", "--fix-owned"], { FAKE_CACHE: "noexec", FAKE_HANDSHAKE: "fail", FAKE_STATE_DIR: handshakeState });
    const report = /** @type {Report} */ (JSON.parse(fixed.stdout));
    assert.equal(report.checks.find((entry) => entry.id === "fix.cache")?.status, "ok");
    const handshake = report.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(handshake?.status, "ok");
    assert.match(String(handshake?.detail), /re-probed after the cache purge/);
  });

  await check("--fix-owned implies --fix and never touches git or installs packages", () => {
    const ownedState = join(stateDir, "cache-owned");
    mkdirSync(ownedState, { recursive: true });
    const fixed = doctor(["--json", "--fix-owned", "--yes"], { FAKE_BWRAP: "no", FAKE_CACHE: "noexec", FAKE_STATE_DIR: ownedState });
    assert.equal(fixed.status, 1, "the missing bubblewrap still blocks");
    const report = /** @type {Report} */ (JSON.parse(fixed.stdout));
    assert.equal(report.checks.find((entry) => entry.id === "fix.cache")?.status, "ok", "--fix-owned runs the fix loop without --fix");
    assert.equal(report.checks.some((entry) => entry.id === "fix.install"), false);
    assert.equal(report.checks.some((entry) => entry.id === "fix.git-trust"), false);
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.bwrap")?.status, "fail");
    assert.equal(existsSync(join(ownedState, "git-whitelisted")), false, "the Windows git whitelist is left alone");
  });

  await check("--fix-owned refuses --install", () => {
    const run = doctor(["--fix-owned", "--install"]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /--fix-owned.*--install/);
  });

  await check("--read-only refuses --fix-owned", () => {
    const run = doctor(["--read-only", "--fix-owned"]);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /pnpm run doctor --fix/);
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

  await check("an indented insert of the nested rows is not a preset trap", () => {
    const profile = join(home, "profiles", "insert-ok");
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, "cordis.patch.yml"), "- insert:\n    - id: wsl-fs\n      name: 'dsh-plugin-wsl-env/fs'\n");
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    assert.equal(report.checks.some((entry) => entry.id === "config.preset-trap"), false, "an insert adds a top-level row; it is not an id patch");
    assert.equal(report.checks.find((entry) => entry.id === "config.deprecated")?.status, "ok");
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

  await check("doctorReport kills a run that outlives its deadline", async () => {
    // The collector used to spawn the doctor synchronously, so a doctor that
    // never reports blocked the Host's event loop until the spawn deadline and
    // could not be cancelled. The deadline now settles the promise with a
    // message naming the timeout.
    const slow = join(bin, "slow-doctor.mjs");
    writeFileSync(slow, "setInterval(() => {}, 1000);\n");
    await assert.rejects(
      doctorReport("ubuntu", { doctorPath: slow, timeoutMs: 150 }),
      /** @param {Error} error */ (error) => /doctor run failed: timed out after 150ms/.test(error.message),
      "the deadline settles the run instead of blocking the caller",
    );
  });

  await check("doctorReport honours the caller's abort signal", async () => {
    const slow = join(bin, "abort-doctor.mjs");
    writeFileSync(slow, "setInterval(() => {}, 1000);\n");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(
      doctorReport("ubuntu", { doctorPath: slow, signal: controller.signal }),
      /** @param {Error} error */ (error) => /doctor run failed: doctor run aborted/.test(error.message),
      "an aborted run settles as an aborted diagnosis",
    );
  });

  await check("doctorReport caps a runaway doctor's output", async () => {
    // The synchronous collector capped the pipe with `maxBuffer`; the async one
    // must keep the same promise or a runaway child grows the Host unbounded.
    const flood = join(bin, "flood-doctor.mjs");
    writeFileSync(flood, "process.stdout.write('x'.repeat(5 * 1024 * 1024));\nsetInterval(() => {}, 1000);\n");
    await assert.rejects(
      doctorReport("ubuntu", { doctorPath: flood, timeoutMs: 30_000 }),
      /** @param {Error} error */ (error) => /produced more than \d+ bytes/.test(error.message),
      "the output cap settles the run",
    );
  });

  await check("the Windows git trust check reports the whitelist and a missing-git info", () => {
    writeFileSync(join(stateDir, "git-whitelisted"), "");
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

  await check("the fix loop re-verifies: swept scopes show before → after and the verdict recomputes", () => {
    rmSync(join(stateDir, "swept-scopes"), { force: true });
    const before = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_STALE: "yes" }).stdout));
    assert.equal(before.checks.find((entry) => entry.id === "runtime.scopes")?.status, "warn");
    const fixed = doctor(["--json", "--fix"], { FAKE_STALE: "yes" });
    assert.equal(fixed.status, 0, "after the sweep the verdict is recomputed as ready");
    const report = /** @type {Report} */ (JSON.parse(fixed.stdout));
    const fix = report.checks.find((entry) => entry.id === "fix.scopes");
    assert.equal(fix?.status, "ok");
    assert.match(String(fix?.detail), /1 stale before → 0 after/);
    const scopes = report.checks.find((entry) => entry.id === "runtime.scopes");
    assert.notEqual(scopes?.status, "warn", "the runtime.scopes entry carries the after state (no stale left)");
  });

  await check("the install fix re-verifies bubblewrap and the fence", () => {
    const run = doctor(["--json", "--fix", "--install", "--yes"], { FAKE_BWRAP: "no" });
    assert.equal(run.status, 0, "the install lands, the fence runs, the verdict is recomputed");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const fix = report.checks.find((entry) => entry.id === "fix.install");
    assert.equal(fix?.status, "ok");
    assert.match(String(fix?.detail), /now at \/usr\/bin\/bwrap/);
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.bwrap")?.status, "ok", "the sandbox.bwrap entry carries the after state");
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.bwrap-usable")?.status, "ok");
    assert.equal(report.verdict, "ready");
  });

  await check("deprecated profile keys are named with their migration", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    assert.equal(report.checks.find((entry) => entry.id === "config.deprecated")?.status, "ok", "the earlier fixture profiles carry no retired keys");
    const retiredDir = join(home, "profiles", "retired");
    mkdirSync(retiredDir, { recursive: true });
    writeFileSync(join(retiredDir, "cordis.patch.yml"), "- id: fs-routing\n  config:\n    substrate: share\n");
    const blocked = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    const retired = blocked.checks.find((entry) => entry.id === "config.deprecated");
    assert.equal(retired?.status, "fail", "a boot refusal the doctor can name before the session even starts, so it blocks");
    assert.match(String(retired?.detail), /refuses to boot/);
    assert.match(String(retired?.remedy), /docs\/MIGRATION\.md/);
    rmSync(retiredDir, { recursive: true, force: true });
    const emptyDir = join(home, "profiles", "empty-distro");
    mkdirSync(emptyDir, { recursive: true });
    writeFileSync(join(emptyDir, "cordis.patch.yml"), "- id: fs-routing\n  config:\n    distro: ''\n");
    const empty = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    const note = empty.checks.find((entry) => entry.id === "config.deprecated");
    assert.equal(note?.status, "info", "the empty-distro meaning change boots, so it informs instead of warning");
    assert.match(String(note?.detail), /has meant auto.*since 0\.12\.0|since 0\.12\.0/);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  await check("parseWslVerbose reads the default marker on both sides of the name", () => {
    const modern = parseWslVerbose("  NAME            STATE           VERSION\n* ubuntu         Running         2\n  Debian          Stopped         2\n");
    assert.deepEqual(modern, [{ name: "ubuntu", isDefault: true, version: "2" }, { name: "Debian", isDefault: false, version: "2" }], "WSL 3.x puts the star before the name");
    const legacy = parseWslVerbose("  NAME            STATE           VERSION\n  ubuntu*         Running         2\n");
    assert.deepEqual(legacy, [{ name: "ubuntu", isDefault: true, version: "2" }], "WSL 2.x puts the star after the name");
  });

  await check("a script the target distro cannot read skips the handshake honestly", () => {
    const run = doctor(["--json"], { FAKE_SCRIPT_READABLE: "debian", FAKE_DISTROS: "ubuntu debian" });
    assert.equal(run.status, 0, "an unprobeable handshake is an environment limit, not a broken install");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const hand = report.checks.find((entry) => entry.id === "agent.handshake" && entry.distro === "debian");
    assert.equal(hand?.status, "info");
    assert.match(String(hand?.detail), /not readable at .* inside "debian"/);
    const exec = report.checks.find((entry) => entry.id === "functional.exec" && entry.distro === "debian");
    assert.equal(exec?.status, "skipped");
    assert.match(String(exec?.detail), /the handshake could not run in this distro/);
    assert.equal(exec?.blocksFirstCommand, false);
    const ubuntuHand = report.checks.find((entry) => entry.id === "agent.handshake" && entry.distro === "ubuntu");
    assert.equal(ubuntuHand?.status, "ok", "the host distro still probes for real");
  });

  await check("--bundle writes the local diagnostic file, and --redact removes the paths", () => {
    const bundlePath = join(scratch, "bundle.json");
    const run = doctor(["--json", "--bundle", bundlePath], { FAKE_STOPPED: "no" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /bundle: written to/);
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    assert.equal(bundle.kind, "dsh-plugin-wsl-env doctor bundle");
    assert.equal(bundle.report.verdict, "ready");
    assert.equal(bundle.report.schemaVersion, 2);
    assert.match(String(bundle.plugin.version), /^\d+\./, "the plugin version rides along for the setup report");
    assert.equal(bundle.redacted, false);
    rmSync(bundlePath, { force: true });
    const redactedPath = join(scratch, "bundle-redacted.json");
    const redacted = doctor(["--bundle", redactedPath, "--redact"]);
    assert.equal(redacted.status, 0, redacted.stderr);
    const payload = readFileSync(redactedPath, "utf8");
    assert.equal(payload.includes(homedir()), false, "the home path (the distro.identity detail) is gone");
    assert.match(payload, /<redacted-home>/);
    assert.equal(JSON.parse(payload).report.verdict, "ready", "the redacted file is still valid JSON with the full report");
    rmSync(redactedPath, { force: true });
  });

  await check("a bundle is written even when the run ends early on a blocked machine", () => {
    const bundlePath = join(scratch, "bundle-blocked.json");
    const run = doctor(["--json", "--distro", "missing", "--bundle", bundlePath]);
    assert.equal(run.status, 1);
    const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));
    assert.equal(bundle.report.verdict, "blocked");
    assert.ok(bundle.report.blockers.includes("distro.present"));
    rmSync(bundlePath, { force: true });
  });

  await check("the git whitelist joins the fixable set behind the confirmation gate", () => {
    rmSync(join(stateDir, "git-whitelisted"), { force: true });
    const unfixed = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
    assert.equal(unfixed.checks.find((entry) => entry.id === "git.win-safe")?.status, "warn");
    const fixed = doctor(["--json", "--fix", "--yes"]);
    assert.equal(fixed.status, 0);
    const report = /** @type {Report} */ (JSON.parse(fixed.stdout));
    const fix = report.checks.find((entry) => entry.id === "fix.git-trust");
    assert.equal(fix?.status, "ok");
    assert.match(String(fix?.detail), /added "\/\/wsl\.localhost\/\*"/);
    const trust = report.checks.find((entry) => entry.id === "git.win-safe");
    assert.equal(trust?.status, "ok", "the git.win-safe entry carries the after state");
    assert.equal(report.verdict, "ready");
  });
// ── Host-locale output ───────────────────────────────────────────────────────
// The human skeleton renders in the host's language: catalogs in
// `locale/doctor/{en,zh}.json`, detection through the registry, and
// `--locale` / `DSH_WSL_DOCTOR_LOCALE` overrides. `--json` stays English and
// language-independent.
{
  // The two catalogs ship the same keys, so a skeleton line cannot render
  // English in a zh run because a key was forgotten on one side.
  const en = JSON.parse(readFileSync(join(ROOT, "locale", "doctor", "en.json"), "utf8"));
  const zh = JSON.parse(readFileSync(join(ROOT, "locale", "doctor", "zh.json"), "utf8"));
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "catalog key parity");

  // Placeholders substitute; an unknown placeholder stays visible for triage.
  assert.equal(doctorT("summary", { ok: 1, warn: 0, fail: 0, info: 2 }), "1 ok, 0 warn, 0 fail, 2 info");
  assert.equal(doctorT("ports.title", { distro: "ubuntu" }), "listening ports in ubuntu");
  assert.equal(doctorT("no.such.key"), "no.such.key");
  assert.match(doctorT("mark.fail"), /^fail|失败$/u);

  // Detection and overrides.
  assert.equal(localeNameFromReg("\n    LocaleName    REG_SZ    zh-CN\n"), "zh-CN");
  assert.equal(localeNameFromReg("reg: unable to find LocaleName"), "");
  assert.equal(localeFromTag("zh-CN"), "zh");
  assert.equal(localeFromTag("zh_TW"), "zh");
  assert.equal(localeFromTag("en-US"), "en");
  assert.equal(localeFromTag(""), "en");
  assert.equal(overrideLocale("zh"), "zh");
  assert.equal(overrideLocale(""), "en");

  // The flag localizes the human skeleton end to end through the fakes.
  const zhRun = doctor(["--quick", "--locale", "zh"]);
  assert.match(zhRun.stdout, /环境诊断/u);
  assert.match(zhRun.stdout, /通过/u);
  assert.match(zhRun.stdout, /裁决: (READY|BLOCKED)/u);
  assert.doesNotMatch(zhRun.stdout, /verdict: (READY|BLOCKED)/u);
  // `--json` is a data surface: English values, no locale subprocess.
  const jsonRun = doctor(["--quick", "--json", "--locale", "zh"]);
  assert.match(jsonRun.stdout, /"verdict"/u);
  assert.doesNotMatch(jsonRun.stdout, /环境诊断/u);
  // The environment override selects zh without the flag.
  const envRun = doctor(["--quick"], { DSH_WSL_DOCTOR_LOCALE: "zh-CN" });
  assert.match(envRun.stdout, /裁决:/u);
  // Restore the default for the test process's own doctorT reads.
  setDoctorLocale("en");
  console.log("doctor locale catalog, detection, and overrides pass");
}
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`${passed} doctor checks pass`);

// ── Peer-free inlining parity ────────────────────────────────────────────────
// The doctor inlines the one helper that lives behind a peer-tainted lib
// module (`lib/index.js`) so it still starts when the plugin's runtime is
// broken. This assertion pins the inline copy against the lib export, so a
// semantic edit to one side cannot drift quietly.
{
  /** @type {Array<[Parameters<typeof import("../lib/index.js").effectiveMaskWindowsDrive>[0], boolean]>} */
  const maskCases = [
    [{}, false],
    [{ maskWindowsDrive: true }, true],
    [{ maskWindowsDrive: false }, false],
    [{ interopVisibility: "masked" }, true],
    [{ interopVisibility: "disabled" }, true],
    [{ interopVisibility: "visible" }, false],
    [{ interopVisibility: "visible", maskWindowsDrive: true }, false],
    [{ interopVisibility: "masked", maskWindowsDrive: false }, true],
  ];
  for (const [config, expected] of maskCases) {
    assert.equal(effectiveMaskWindowsDrive(config), expected, `inline mask ${JSON.stringify(config)}`);
    assert.equal(effectiveMaskWindowsDrive(config), libEffectiveMaskWindowsDrive(config), `parity mask ${JSON.stringify(config)}`);
  }
  console.log("doctor inlined helper matches the lib export");
}
