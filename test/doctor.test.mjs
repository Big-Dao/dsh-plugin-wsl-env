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
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { peerSatisfied, peerPackageDir, parseWslConfig, parseWslSize, parseIni, parseWslVerbose, effectiveMaskWindowsDrive, distroPath, hostDiskVerdict, localeNameFromReg, localeFromTag, overrideLocale, setDoctorLocale, doctorT, probeHandshake, STALE_SCOPE_REPORT, composeBatch, composeSystemdBatch, parseBatchFacts } from "../scripts/doctor.mjs";
import { mergeLiveResidentStatus } from "../lib/doctor-live.js";
import { doctorReport } from "../lib/index.js";
import { DOCTOR_PEERS_ENV, resolvedPeerVersion, resolvedPeerVersions, versionAbove, withHostPeerVersions } from "../lib/peer-versions.js";
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
  *"-u root"*)
    state="\${FAKE_STATE_DIR:-/nonexistent}"
    printf '%s\n' "$all" > "$state/install-args"
    if [ "\${FAKE_INSTALL_FAIL:-no}" = yes ]; then
      runs=$(cat "$state/install-runs" 2>/dev/null || echo 0); echo $((runs + 1)) > "$state/install-runs"
      printf 'Reading package lists... 0%%\n' >&2
      printf 'E: Unable to locate package bubblewrap\n' >&2
      exit 100
    fi
    : > "$state/installed-bwrap"; exit 0 ;;
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
    state="\${FAKE_STATE_DIR:-/nonexistent}"
    echo x >> "$state/handshake-spawns"
    case "\${FAKE_HANDSHAKE:-ok}" in
      flake-once)
        if [ ! -f "$state/handshake-flaked" ]; then : > "$state/handshake-flaked"; printf 'connection attempt failed because the connected party did not properly respond Wsl/Service/WSAETIMEDOUT\n' >&2; exit 1; fi ;;
      flake-always) printf 'connection attempt failed because the connected party did not properly respond Wsl/Service/WSAETIMEDOUT\n' >&2; exit 1 ;;
      hanging) exec sleep 20 ;;
      garbage) printf 'not a hello\n'; exit 0 ;;
    esac
    if [ "\${FAKE_HANDSHAKE:-ok}" = fail ] && [ ! -f "$state/cache-purged" ]; then exit 0; fi
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
    # One line per spawn (batch scripts are flattened), so a test can count
    # and inspect invocations.
    printf '%s\n' "\$(printf '%s' "\$all" | tr '\n' '|')" >> "\${FAKE_STATE_DIR:-/nonexistent}/sh-c-spawns"
    case "$all" in
      *'DSHBATCH=ok'*)
        # The composed pure-read batch: the canned block is built from the
        # same knobs the single-probe branches used to answer with.
        if [ "$FAKE_FLAKE" = always ]; then printf 'connection attempt failed because the connected party did not properly respond Wsl/Service/WSAETIMEDOUT\n' >&2; exit 1; fi
        if [ "$FAKE_FLAKE" = once ] && [ ! -f "\${FAKE_STATE_DIR:-/nonexistent}/flake-once" ]; then : > "\${FAKE_STATE_DIR:-/nonexistent}/flake-once"; printf 'connection attempt failed because the connected party did not properly respond Wsl/Service/WSAETIMEDOUT\n' >&2; exit 1; fi
        [ "\${FAKE_BATCH_HANG:-no}" = yes ] && sleep 30
        printf 'DSHBATCH=ok\n'
        [ "\${FAKE_IDENTITY:-ok}" = bad ] && printf 'SH=\nHM=\n' || printf 'SH=/bin/bash\nHM=%s\n' "\${FAKE_DISTRO_HOME:-\$HOME}"
        printf 'FAMILY=%s\n' "\${FAKE_FAMILY:-apt-get}"
        printf 'DF=%s\n' "\$(printf '/dev/sdc 262030 151898 110132 %s%% /' "\${FAKE_DISK:-42}")"
        printf 'DATE=%s\n' "\${FAKE_CLOCK:-\$(date +%s)}"
        printf 'CONF_B64=%s\n' "\$(printf '%s' "\${FAKE_WSLCONF:-}" | base64 | tr -d '\n')"
        if [ -f "\${FAKE_STATE_DIR:-/nonexistent}/installed-bwrap" ] || [ "\${FAKE_BWRAP:-yes}" != no ]; then printf 'BWRAP=/usr/bin/bwrap\n'; fi
        printf 'BWTEST=ok\n'
        printf 'SOCK_B64=%s\n' "\$(printf 'R /run/user/1000\nU /run/user/1000/bus\nU /run/user/1000/systemd/private\nS /run/dbus/system_bus_socket\n' | base64 | tr -d '\n')"
        [ "\${FAKE_SYSTEMD:-yes}" = no ] && printf 'PID1=none init\n' || printf 'PID1=systemd systemd\n'
        printf 'SYSTEMD_RUN=/usr/bin/systemd-run\n'
        [ "\${FAKE_BINFMT:-yes}" = no ] || printf 'BINFMT=yes\n'
        printf 'RESOLV=%s\n' "\${FAKE_RESOLV:-365}"
        [ "\${FAKE_DNS:-yes}" = no ] || printf 'DNS=1.2.3.4 deb.debian.org\n'
        printf 'TOOLS_B64=%s\n' "\$( { [ "\${FAKE_RG:-yes}" = no ] && printf 'missing rg\n' || printf 'found rg /usr/bin/rg\n'; [ "\${FAKE_GIT_TOOL:-yes}" = no ] && printf 'missing git\n' || printf 'found git /usr/bin/git\n'; printf 'found inotifywait /usr/bin/inotifywait\n'; } | base64 | tr -d '\n')"
        printf 'ARCH=x86_64\n'
        if [ "\${FAKE_CACHE:-good}" = noexec ] && [ ! -f "\${FAKE_STATE_DIR:-/nonexistent}/cache-purged" ]; then
          cache="noexec \$HOME/.cache/dsh-wsl/agent/${CACHE_DIGEST}/dsh-wsl-agent"
        elif [ "\${FAKE_CACHE:-good}" = noexec ]; then
          cache="none"
        else
          cache="exec \$HOME/.cache/dsh-wsl/agent/${CACHE_DIGEST}/dsh-wsl-agent"
        fi
        printf 'CACHE_B64=%s\n' "\$(printf '%s' "\$cache" | base64 | tr -d '\n')"
        printf 'HOMEEXEC=%s\n' "\${FAKE_HOME_PROBE:-ok}"
        ;;
      *'DSHBATCHB=ok'*)
        [ "\${FAKE_BATCH_HANG:-no}" = yes ] && sleep 30
        printf 'DSHBATCHB=ok\n'
        printf 'USER=running\n'
        printf 'LINGER=Linger=yes\n'
        scope=""
        { [ -f "\${FAKE_STATE_DIR:-/nonexistent}/swept-scopes" ] || [ "\${FAKE_STALE:-no}" != yes ]; } || scope='dsh-wsl-ubuntu-x.scope stale'
        printf 'SCOPES_B64=%s\n' "\$(printf '%s' "\$scope" | base64 | tr -d '\n')"
        case "\${FAKE_SCRIPT_READABLE:-yes}" in
          debian) case "\$all" in *"-d debian"*) printf 'AGENT_READ=no\n' ;; *) printf 'AGENT_READ=yes\n' ;; esac ;;
          no) printf 'AGENT_READ=no\n' ;;
          *) printf 'AGENT_READ=yes\n' ;;
        esac
        ;;
      *'wsl-writable-roots'*)
        case "\${FAKE_GRANTS:-ok}" in
          missing) printf '0|missing\n'; exit 3 ;;
          unreadable) printf '0|unreadable\n'; exit 4 ;;
          symlink) printf '0|symlink -> /real/path\n'; exit 5 ;;
        esac ;;
      *'command -v bwrap'*) [ -f "\${FAKE_STATE_DIR:-/nonexistent}/installed-bwrap" ] && printf '/usr/bin/bwrap' || { [ "\${FAKE_BWRAP:-yes}" = no ] || printf '/usr/bin/bwrap'; } ;;
      *'bwrap --ro-bind'*)
        case "$all" in
          *dsh-doctor-smoke-refuse*) exit 1 ;;
          *'inside'*) printf 'ok' ;;
          *) exit 0 ;;
        esac ;;
      *'systemctl --user stop'*) : > "\${FAKE_STATE_DIR:-/nonexistent}/swept-scopes"; exit 0 ;;
      *'echo "$unit'*)
        if [ -f "\${FAKE_STATE_DIR:-/nonexistent}/swept-scopes" ] && [ "\${FAKE_RECHECK:-}" = scopes ]; then printf 'connection attempt failed because the connected party did not properly respond Wsl/Service/WSAETIMEDOUT\n' >&2; exit 1; fi
        { [ -f "\${FAKE_STATE_DIR:-/nonexistent}/swept-scopes" ] || [ "\${FAKE_STALE:-no}" != yes ]; } || printf 'dsh-wsl-ubuntu-x.scope stale' ;;
      *'[ -f'*) case "\${FAKE_SCRIPT_READABLE:-yes}" in debian) case "$all" in *"-d debian"*) printf no ;; *) printf yes ;; esac ;; no) printf no ;; *) printf yes ;; esac ;;
      *'rm -rf "$HOME/.cache/dsh-wsl/agent"'*) : > "\${FAKE_STATE_DIR:-/nonexistent}/cache-purged"; exit 0 ;;
      *'.cache/dsh-wsl/agent'*)
        if [ -f "\${FAKE_STATE_DIR:-/nonexistent}/cache-purged" ] && [ "\${FAKE_RECHECK:-}" = cache ]; then printf 'connection attempt failed because the connected party did not properly respond Wsl/Service/WSAETIMEDOUT\n' >&2; exit 1; fi
        if [ "\${FAKE_CACHE:-good}" = noexec ]; then
          [ -f "\${FAKE_STATE_DIR:-/nonexistent}/cache-purged" ] && printf 'none' || printf 'noexec %s/.cache/dsh-wsl/agent/${CACHE_DIGEST}/dsh-wsl-agent' "$HOME"
        else printf 'exec %s/.cache/dsh-wsl/agent/${CACHE_DIGEST}/dsh-wsl-agent' "$HOME"; fi ;;
      *'mktemp -d'*) printf '/tmp/dsh-doctor-smoke-fixed' ;;
      *'cat /proc/net/tcp'*) printf '  sl  local_address rem_address   st tx_queue rx_queue\n   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 0 1\n' ;;
      *'hostname -I'*) printf '172.20.0.5 ' ;;
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
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.isolation")?.status, "info");
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
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.grants")?.status, "skipped");
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.isolation")?.status, "skipped");
    assert.equal(report.checks.find((entry) => entry.id === "functional.sandbox")?.status, "skipped");
    assert.equal(report.verdict, "ready", "the opt-out is a warning, not a blocker");
    assert.equal(run.status, 0);
    rmSync(profile, { recursive: true, force: true });
  });

  await check("sandbox.isolation reports the stance and the detected surfaces", () => {
    const profile = join(home, "profiles", "isolation");
    mkdirSync(profile, { recursive: true });
    try {
      writeFileSync(join(profile, "cordis.patch.yml"), "- id: preset-wsl\n  config:\n    plugins:\n      - id: wsl-shell\n        config:\n          socketIsolation: strict\n      - id: wsl-fs\n        config:\n          socketIsolation: strict\n");
      const report = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
      const row = report.checks.find((entry) => entry.id === "sandbox.isolation");
      assert.equal(row?.status, "ok");
      assert.match(String(row?.detail), /strict/);
      assert.match(String(row?.detail), /\/run\/user\/1000\/bus/);
      assert.match(String(row?.detail), /\/run\/dbus\/system_bus_socket/);
      assert.match(String(row?.detail), /interop transport is masked/);
      assert.equal(report.config?.socketIsolation, "strict");
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  });

  await check("sandbox.grants names the configured roots and warns on an unusable one", () => {
    const profile = join(home, "profiles", "grants");
    mkdirSync(profile, { recursive: true });
    try {
      writeFileSync(join(profile, "cordis.patch.yml"), "- id: preset-wsl\n  config:\n    plugins:\n      - id: wsl-shell\n        config:\n          writableRoots: ['/home/andy/.npm']\n      - id: wsl-fs\n        config:\n          writableRoots: ['/home/andy/.npm']\n");
      const healthy = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
      const ok = healthy.checks.find((entry) => entry.id === "sandbox.grants");
      assert.equal(ok?.status, "ok");
      assert.match(String(ok?.detail), /home\/andy\/\.npm/);
      assert.deepEqual(healthy.config?.writableRoots, ["/home/andy/.npm"]);

      const broken = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_GRANTS: "missing" }).stdout));
      const warn = broken.checks.find((entry) => entry.id === "sandbox.grants");
      assert.equal(warn?.status, "warn");
      assert.match(String(warn?.detail), /missing/);
      assert.match(String(warn?.detail), /home\/andy\/\.npm/);
      assert.match(String(warn?.remedy), /mkdir -p/);

      writeFileSync(join(profile, "cordis.patch.yml"), "- id: preset-wsl\n  config:\n    plugins:\n      - id: wsl-shell\n        config:\n          writableRoots: ['/home/andy/.npm']\n      - id: wsl-fs\n        config:\n          writableRoots:\n            - '/home/andy/.cargo'\n");
      const mismatchReport = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
      const mismatch = mismatchReport.checks.find((entry) => entry.id === "sandbox.grants");
      assert.equal(mismatch?.status, "warn");
      assert.match(String(mismatch?.detail), /different roots/);

      writeFileSync(join(profile, "cordis.patch.yml"), "- id: preset-wsl\n  config:\n    plugins:\n      - id: wsl-shell\n        config:\n          writableRoots: ['~/.npm']\n      - id: wsl-fs\n        config:\n          writableRoots: ['~/.npm']\n");
      const tildeReport = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_DISTRO_HOME: "/home/andy" }).stdout));
      const tilde = tildeReport.checks.find((entry) => entry.id === "sandbox.grants");
      assert.equal(tilde?.status, "ok");
      assert.match(String(tilde?.detail), /home\/andy\/\.npm/);
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
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
    for (const tool of ["rg", "git", "inotifywait"]) {
      const entry = report.checks.find((row) => row.id === `tools.${tool}`);
      assert.equal(entry?.status, "ok", `quick probes the optional tool ${tool}`);
    }
    assert.equal(report.checks.find((entry) => entry.id === "distro.dns"), undefined, "quick skips the net section");
    assert.ok(report.checks.find((entry) => entry.id === "session.linger"), "the session prerequisites stay in the quick profile");
  });

  await check("the quick profile warns when ripgrep is missing, install remedy included", () => {
    const run = doctor(["--json", "--quick"], { FAKE_RG: "no" });
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const rg = report.checks.find((entry) => entry.id === "tools.rg");
    assert.equal(rg?.status, "warn", "the missing search dependency is visible in the quick pass");
    assert.match(String(rg?.detail), /missing; the fs-search tool fails \(exit 127\)/);
    assert.match(String(rg?.remedy), /wsl\.exe -d ubuntu -u root -- sh -c "apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap git ripgrep inotify-tools"/);
    assert.equal(report.verdict, "ready", "a missing optional tool never blocks the first command");
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
    assert.match(String(bwrap?.remedy), /sh -c "apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap git ripgrep inotify-tools"/);
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
        { id: "agent.handshake", status: "ok", detail: "probed: a fresh resident, pid 4242, protocol 6, digest matches", distro: "ubuntu", blocksFirstCommand: false },
        { id: "runtime.scopes", status: "info", detail: "none" },
      ],
      summary: { ok: 1, info: 1, warn: 0, fail: 0, skipped: 0 },
    };
    /** A snapshot answering for a resident this process holds. @type {import("../lib/agent.js").AgentStatus} */
    const LIVE = { distro: "ubuntu", state: "ready", pid: 7000, lastError: "", deaths: 0, pending: 0 };
    assert.equal(mergeLiveResidentStatus(report, undefined), report, "no snapshot, no merge");
    assert.equal(mergeLiveResidentStatus(report, { ...LIVE, state: "idle", pid: undefined }), report, "a never-started singleton says nothing about the app's resident");
    const noHandshake = { ...report, checks: report.checks.filter((entry) => entry.id !== "agent.handshake") };
    assert.equal(mergeLiveResidentStatus(noHandshake, LIVE), noHandshake, "no handshake check, no merge");

    const healthy = mergeLiveResidentStatus(report, LIVE);
    const hand = healthy.checks.find((entry) => entry.id === "agent.handshake");
    assert.match(String(hand?.detail), /probed: the live resident \(pid 7000, state ready, deaths 0, pending 0\)/);
    assert.match(String(hand?.detail), /fresh-probe facts: probed: a fresh resident, pid 4242/, "the fresh probe's digest facts are kept");
    assert.equal(hand?.status, "ok", "no error, no verdict change");
    assert.equal(hand?.distro, "ubuntu", "the schema-2 shape fields ride through the merge");
    assert.equal(hand?.blocksFirstCommand, false, "the collector stamps `blocksFirstCommand` as \"this check fails\"; an unchanged verdict keeps its stamp");
    assert.equal(healthy.checks.find((entry) => entry.id === "wsl.version"), report.checks[0], "the other checks pass through");

    const wounded = mergeLiveResidentStatus(report, { ...LIVE, lastError: "agent handshake timed out after 30000ms", deaths: 2 });
    const warn = wounded.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(warn?.status, "warn", "a lastError on a running resident surfaces as warn");
    assert.match(String(warn?.detail), /deaths 2/);
    assert.match(String(warn?.detail), /lastError: agent handshake timed out/);
    assert.equal(wounded.summary.ok, 0, "the ok tally drops");
    assert.equal(wounded.summary.warn, 1, "the warn tally rises");
    assert.equal(report.summary.ok, 1, "the input report is not mutated");

    // The production shape of `dead`: every path into it clears the pid, so a
    // pid-only test used to skip exactly the resident that was down — and with
    // file operations failing closed behind it, the report read `ready`.
    /** @type {import("../lib/agent.js").AgentStatus} */
    const DOWN = { distro: "ubuntu", state: "dead", pid: undefined, lastError: "agent exited again (code=1); reviving in 2s, attempt 1/3", deaths: 1, pending: 0 };
    const down = mergeLiveResidentStatus(report, DOWN);
    const downHand = down.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(downHand?.status, "fail", "a dead live resident fails the check");
    assert.equal(downHand?.blocksFirstCommand, true, "a failing check blocks the first command, as the collector stamps it");
    assert.match(String(downHand?.detail), /probed: the live resident \(pid none, state dead, deaths 1, pending 0\)/);
    assert.equal(down.summary.fail, 1);

    // A resident that came back is diagnosed by what it is now: an accepted
    // handshake clears `lastError`, so a ready resident with no failure keeps
    // the fresh probe's verdict. (It used to warn on the crash it survived
    // until the app restarted.)
    const recovered = mergeLiveResidentStatus(report, { ...LIVE, deaths: 1 });
    assert.equal(recovered.checks.find((entry) => entry.id === "agent.handshake")?.status, "ok", "a recovered resident carries no unresolved failure");
    assert.match(String(recovered.checks.find((entry) => entry.id === "agent.handshake")?.detail), /deaths 1, pending 0\); fresh-probe facts:/);

    // The caller's note on why the resident is not on the native entry rides
    // along as evidence, without touching the verdict.
    const noted = mergeLiveResidentStatus(report, { ...LIVE, deaths: 1 }, { nativeNote: "the native agent failed to start" });
    const notedHand = noted.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(notedHand?.status, "ok");
    assert.match(String(notedHand?.detail), /; native agent: the native agent failed to start$/);

    // The verdict fields the collector derived from ITS checks are derived
    // again from the merged ones: a digest trusts them over the checks.
    /** A CLI-shaped report: every check stamped, the verdict fields derived. @type {import("../lib/doctor-live.js").DoctorReport} */
    const derived = {
      schemaVersion: 2,
      checks: [
        { id: "wsl.version", status: "ok", detail: "WSL version: 2.0.0" },
        { id: "agent.handshake", status: "ok", detail: "probed: a fresh resident, pid 4242, protocol 6, digest matches", distro: "ubuntu", blocksFirstCommand: false },
        { id: "runtime.scopes", status: "info", detail: "none" },
      ],
      summary: { ok: 2, info: 1, warn: 0, fail: 0, skipped: 0 },
      blockers: [],
      verdict: "ready",
      distroVerdicts: [{ name: "ubuntu", verdict: "ready", blockers: [] }],
    };
    const blocked = mergeLiveResidentStatus(derived, DOWN);
    assert.deepEqual(blocked.blockers, ["agent.handshake"], "the handshake failure reaches the blockers");
    assert.equal(blocked.verdict, "blocked", "and the verdict");
    assert.deepEqual(blocked.distroVerdicts, [{ name: "ubuntu", verdict: "blocked", blockers: ["agent.handshake"] }], "and the distro's own verdict");
    const unchanged = mergeLiveResidentStatus(derived, { ...LIVE, deaths: 1 });
    assert.deepEqual(unchanged.blockers, [], "an unchanged verdict leaves the derived fields as they were");
    assert.equal(unchanged.verdict, "ready");

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
    /** @type {import("../lib/doctor-live.js").DoctorReport} */
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
      assert.ok(
        merged.checks.some((entry) => entry.id === "session.preset-seam"),
        "the collector merges the in-process creation-time seam row",
      );

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
    assert.match(run.stdout, /fix: wsl\.exe -d ubuntu -u root -- sh -c "apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap git ripgrep inotify-tools"/);
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

  await check("the peer check prefers the host-resolved set over the plugin's physical tree", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json", "--quick"], {
      [DOCTOR_PEERS_ENV]: JSON.stringify({ "@deepseek-ai/dsh-fs": "0.0.1" }),
    }).stdout));
    const peers = report.checks.find((entry) => entry.id === "peers.versions");
    assert.equal(peers?.status, "fail", "a host-resolved floor miss fails the check");
    assert.match(String(peers?.detail), /@deepseek-ai\/dsh-fs: 0\.0\.1 \(want >=0\.2\.2-rc\.2\)/);
  });

  await check("an authoritative host map is not backfilled from the plugin's tree", () => {
    // A partial map is what the host really resolved; the peers it omits
    // could not be resolved there, so they must stay unchecked — a native
    // lookup would count this checkout's copies as if the host had loaded
    // them. The non-string entry is ignored the same way.
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json", "--quick"], {
      [DOCTOR_PEERS_ENV]: JSON.stringify({ "@deepseek-ai/dsh-fs": "0.2.2-rc.3", "@deepseek-ai/dsh-tools": 42 }),
    }).stdout));
    const peers = report.checks.find((entry) => entry.id === "peers.versions");
    assert.equal(peers?.status, "ok");
    assert.match(String(peers?.detail), /^1 pinned peer\(s\) match \(host runtime\); 10 not resolved by the host runtime$/);
  });

  await check("an empty in-app peer map still suppresses the native lookup", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json", "--quick"], {
      [DOCTOR_PEERS_ENV]: "{}",
    }).stdout));
    const peers = report.checks.find((entry) => entry.id === "peers.versions");
    assert.equal(peers?.status, "ok");
    assert.match(String(peers?.detail), /^0 pinned peer\(s\) match \(host runtime\); 11 not resolved by the host runtime$/);
  });

  await check("a malformed host peer map falls back to the plugin's own lookup", () => {
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json", "--quick"], {
      [DOCTOR_PEERS_ENV]: "{not-json",
    }).stdout));
    const peers = report.checks.find((entry) => entry.id === "peers.versions");
    assert.equal(peers?.status, "ok");
    assert.match(String(peers?.detail), /11 pinned peer\(s\) match/);
    assert.doesNotMatch(String(peers?.detail), /host runtime/);
  });

  await check("the peer check stops at the plugin's own peer position", () => {
    const tree = mkdtempSync(join(tmpdir(), "dsh-peers-"));
    try {
      const plugin = join(tree, "workspace", "plugin");
      mkdirSync(join(plugin, "lib"), { recursive: true });
      writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "plugin", peerDependencies: { "peer-pkg": ">=1.0.0" } }));
      // A copy above the plugin, under another project that declares the peer:
      // the runtime projects the installation's copy at the plugin's position
      // instead, so the native lookup must not report this one.
      writeFileSync(join(tree, "workspace", "package.json"), JSON.stringify({ name: "workspace", peerDependencies: { "peer-pkg": ">=1.0.0" } }));
      mkdirSync(join(tree, "workspace", "node_modules", "peer-pkg"), { recursive: true });
      writeFileSync(join(tree, "workspace", "node_modules", "peer-pkg", "package.json"), JSON.stringify({ name: "peer-pkg", version: "0.0.1" }));
      assert.equal(peerPackageDir("peer-pkg", plugin), undefined, "a copy above the plugin's declaring position is not the plugin's peer set");
      mkdirSync(join(plugin, "node_modules", "peer-pkg"), { recursive: true });
      writeFileSync(join(plugin, "node_modules", "peer-pkg", "package.json"), JSON.stringify({ name: "peer-pkg", version: "1.2.3" }));
      assert.equal(peerPackageDir("peer-pkg", plugin), join(plugin, "node_modules", "peer-pkg"), "the plugin's own copy is its peer set");
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  await check("the host helper resolves this package's peer set and hands it over", () => {
    const versions = resolvedPeerVersions();
    const fsVersion = JSON.parse(readFileSync(join(ROOT, "node_modules", "@deepseek-ai", "dsh-fs", "package.json"), "utf8")).version;
    assert.equal(versions["@deepseek-ai/dsh-fs"], fsVersion);
    assert.equal(Object.keys(versions).length, 11, "every declared peer resolves in this checkout");
    const env = withHostPeerVersions({ PATH: "/bin" }, versions);
    assert.deepEqual(JSON.parse(String(env[DOCTOR_PEERS_ENV])), versions);
    assert.deepEqual(withHostPeerVersions({ PATH: "/bin" }, {}), { PATH: "/bin", [DOCTOR_PEERS_ENV]: "{}" }, "an empty set is still sent: presence marks an in-app run");
  });

  await check("the host helper walks a peer's manifest and falls back to its entry file", () => {
    const tree = mkdtempSync(join(tmpdir(), "dsh-peer-version-"));
    try {
      // A package that does not export ./package.json: the version comes from
      // the manifest above its resolved entry file.
      const pkg = join(tree, "node_modules", "no-manifest-export");
      mkdirSync(join(pkg, "lib"), { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "no-manifest-export", version: "2.0.0", exports: { ".": "./lib/index.js" } }));
      writeFileSync(join(pkg, "lib", "index.js"), "");
      writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "anchor" }));
      const require = createRequire(join(tree, "package.json"));
      assert.equal(resolvedPeerVersion(require, "no-manifest-export"), "2.0.0");
      assert.equal(resolvedPeerVersion(require, "missing-peer"), undefined);
      assert.equal(versionAbove(join(pkg, "lib", "index.js")), "2.0.0");
      // A malformed manifest is skipped, and a readable one without a version
      // does not invent one.
      writeFileSync(join(pkg, "package.json"), "{not-json");
      assert.equal(versionAbove(join(pkg, "lib", "index.js")), undefined);
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "no-manifest-export", exports: { ".": "./lib/index.js" } }));
      assert.equal(versionAbove(join(pkg, "lib", "index.js")), undefined);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  await check("doctorReport hands the doctor the peer set this process resolved", async () => {
    const echo = join(bin, "echo-peers-doctor.mjs");
    writeFileSync(echo, 'const peers = process.env.DSH_WSL_DOCTOR_PEERS ?? "";\nprocess.stdout.write(JSON.stringify({ schemaVersion: 2, checks: [{ id: "peers.versions", status: "ok", detail: peers }], summary: { ok: 1 } }));\n');
    const report = await doctorReport("ubuntu", { doctorPath: echo });
    const detail = String(report.checks.find((entry) => entry.id === "peers.versions")?.detail ?? "");
    const versions = JSON.parse(detail);
    const fsVersion = JSON.parse(readFileSync(join(ROOT, "node_modules", "@deepseek-ai", "dsh-fs", "package.json"), "utf8")).version;
    assert.equal(versions["@deepseek-ai/dsh-fs"], fsVersion);
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

  await check("a recheck that does not answer is unknown, never a fixed scope sweep", () => {
    const recheckState = join(stateDir, "recheck-scopes");
    mkdirSync(recheckState, { recursive: true });
    const run = doctor(["--json", "--fix"], { FAKE_STALE: "yes", FAKE_RECHECK: "scopes", FAKE_STATE_DIR: recheckState });
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const fix = report.checks.find((entry) => entry.id === "fix.scopes");
    assert.equal(fix?.status, "unknown", "an empty answer is not '0 stale'");
    assert.match(String(fix?.detail), /^the sweep ran, but its recheck did not answer \(wsl\.exe reported a wedged service \(Wsl\/Service\/WSAETIMEDOUT\)\); 1 stale before → unknown after$/);
    assert.match(String(fix?.remedy), /^rerun the doctor; if stale scopes remain, systemctl --user list-units 'dsh-wsl-\*\.scope' inside "ubuntu"$/);
    assert.equal(report.checks.find((entry) => entry.id === "runtime.scopes")?.status, "unknown", "the scope row does not claim the after state either");
    assert.equal(report.summary.unknown, 2);
    assert.equal(run.status, 0, "an untrusted read never blocks");
  });

  await check("an unverified cache purge keeps the cache row's before-the-fix verdict", () => {
    const recheckState = join(stateDir, "recheck-cache");
    mkdirSync(recheckState, { recursive: true });
    const run = doctor(["--json", "--fix", "--fix-owned"], { FAKE_CACHE: "noexec", FAKE_RECHECK: "cache", FAKE_STATE_DIR: recheckState });
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const fix = report.checks.find((entry) => entry.id === "fix.cache");
    assert.equal(fix?.status, "unknown");
    assert.match(String(fix?.detail), /^the purge ran, but its recheck did not answer \(wsl\.exe reported a wedged service \(Wsl\/Service\/WSAETIMEDOUT\)\); 1 cached, 1 invalid before → unknown after$/);
    const cache = report.checks.find((entry) => entry.id === "agent.cache");
    assert.equal(cache?.status, "warn", "the row is not revised to a cleaner verdict on a read that did not answer");
    assert.match(String(cache?.detail), /1 cached binary\(ies\), 1 not executable or not runnable/, "the before state stays visible");
    assert.match(String(cache?.remedy), /^the purge above ran, but its recheck did not answer — rerun the doctor; until a read says otherwise this row keeps its before-the-fix verdict$/);
    assert.equal(report.summary.unknown, 1, "only the fix row is unknown");
    assert.equal(report.verdict, "ready", "under agentBackend auto an invalid cache warns; it does not block");
  });

  await check("a failed install quotes its output in the fix row", () => {
    const installState = join(stateDir, "install-failed");
    mkdirSync(installState, { recursive: true });
    const run = doctor(["--json", "--fix", "--install", "--yes"], { FAKE_BWRAP: "no", FAKE_INSTALL_FAIL: "yes", FAKE_STATE_DIR: installState });
    assert.equal(run.status, 1, "bubblewrap is still missing, so the verdict stays blocked");
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const fix = report.checks.find((entry) => entry.id === "fix.install");
    assert.equal(fix?.status, "warn");
    assert.match(String(fix?.detail), /^failed \(last output: "Reading package lists\.\.\. 0% E: Unable to locate package bubblewrap"\)$/, "the reason is in the row, not in output the doctor never prints");
    assert.doesNotMatch(String(fix?.detail), /see the output above/);
    assert.match(String(fix?.remedy), /^wsl\.exe -d ubuntu -u root -- sh -c "apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap git ripgrep inotify-tools"$/);
    assert.equal(report.checks.find((entry) => entry.id === "sandbox.bwrap")?.status, "fail");
  });

  await check("the install command the fix runs is the one it prints", () => {
    const installState = join(stateDir, "install-ran");
    mkdirSync(installState, { recursive: true });
    const run = doctor(["--json", "--fix", "--install", "--yes"], { FAKE_BWRAP: "no", FAKE_STATE_DIR: installState });
    assert.equal(run.status, 0, run.stderr);
    const report = /** @type {Report} */ (JSON.parse(run.stdout));
    const fix = report.checks.find((entry) => entry.id === "fix.install");
    assert.equal(fix?.status, "ok");
    assert.match(String(fix?.detail), /^completed; bubblewrap now at \/usr\/bin\/bwrap, a read-only profile runs$/, "a succeeded fix carries no output tail");
    assert.equal(fix?.remedy, undefined, "a succeeded fix leaves nothing to paste");
    const ran = readFileSync(join(installState, "install-args"), "utf8").trim();
    assert.equal(ran, "-d ubuntu -u root -- sh -c apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap git ripgrep inotify-tools", "the fix runs the command it prints for a failed one, minus the shell quotes");
  });

  await check("pacman installs without refreshing the index, and without reinstalling", () => {
    const installState = join(stateDir, "install-pacman");
    mkdirSync(installState, { recursive: true });
    const report = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_BWRAP: "no", FAKE_FAMILY: "pacman", FAKE_STATE_DIR: installState }).stdout));
    assert.match(String(report.checks.find((entry) => entry.id === "sandbox.bwrap")?.remedy), /^wsl\.exe -d ubuntu -u root -- sh -c "pacman -S --noconfirm --needed bubblewrap git ripgrep inotify-tools", or run "pnpm run bootstrap ubuntu --install"$/);
    const fixed = doctor(["--json", "--fix", "--install", "--yes"], { FAKE_BWRAP: "no", FAKE_FAMILY: "pacman", FAKE_STATE_DIR: installState });
    assert.equal(fixed.status, 0, fixed.stderr);
    assert.equal(readFileSync(join(installState, "install-args"), "utf8").trim(), "-d ubuntu -u root -- sh -c pacman -S --noconfirm --needed bubblewrap git ripgrep inotify-tools");
  });

  await check("the handshake retries a transport flake once, and only a transport flake", async () => {
    const handshakeState = join(stateDir, "handshake-retry");
    mkdirSync(handshakeState, { recursive: true });
    const wsl = join(bin, "wsl.exe");
    const shipped = join(ROOT, "agent", "wsl-agent.sh");
    const spawnLog = join(handshakeState, "handshake-spawns");
    const spawns = () => (existsSync(spawnLog) ? readFileSync(spawnLog, "utf8").split("\n").filter(Boolean).length : 0);
    const savedState = process.env.FAKE_STATE_DIR;
    const savedMode = process.env.FAKE_HANDSHAKE;
    process.env.FAKE_STATE_DIR = handshakeState;
    const probe = (/** @type {number} */ helloMs) => probeHandshake("ubuntu", "/mnt/c/agent/wsl-agent.sh", wsl, shipped, { helloMs, settleMs: 20 });
    try {
      process.env.FAKE_HANDSHAKE = "flake-once";
      const recovered = await probe(2000);
      assert.equal(recovered.ok, true);
      assert.equal(recovered.digestMatches, true);
      assert.equal(spawns(), 2, "a transport flake is tried once more");
      assert.match(String(recovered.detail), /^the first attempt flaked \(agent exited before its HELLO \(Wsl\/Service\/WSAETIMEDOUT\)\); the retry answered$/);

      process.env.FAKE_HANDSHAKE = "garbage";
      rmSync(spawnLog, { force: true });
      const answered = await probe(2000);
      assert.equal(answered.ok, false);
      assert.equal(answered.flaked, false);
      assert.equal(spawns(), 1, "an agent that answers with the wrong first line is not retried");
      assert.match(String(answered.detail), /^unexpected first line: not a hello$/);

      process.env.FAKE_HANDSHAKE = "flake-always";
      rmSync(spawnLog, { force: true });
      const wedged = await probe(2000);
      assert.equal(wedged.ok, false);
      assert.equal(wedged.flaked, true);
      assert.equal(spawns(), 2, "one retry, not more");
      assert.match(String(wedged.detail), /\(tried twice\)$/);

      process.env.FAKE_HANDSHAKE = "hanging";
      rmSync(spawnLog, { force: true });
      const started = Date.now();
      const silent = await probe(1000);
      assert.equal(silent.ok, false);
      assert.equal(silent.flaked, true, "the HELLO deadline is transport-shaped");
      assert.equal(spawns(), 2);
      assert.match(String(silent.detail), /^no HELLO within 1 s \(tried twice\)$/);
      assert.ok(Date.now() - started >= 2000, "each attempt waits its full deadline");
    } finally {
      process.env.FAKE_STATE_DIR = savedState;
      if (savedMode === undefined) delete process.env.FAKE_HANDSHAKE;
      else process.env.FAKE_HANDSHAKE = savedMode;
    }
  });

  await check("a doctor run records the retried handshake, and a wedged one still blocks", () => {
    const retriedState = join(stateDir, "handshake-retried");
    mkdirSync(retriedState, { recursive: true });
    const retried = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_HANDSHAKE: "flake-once", FAKE_STATE_DIR: retriedState }).stdout));
    const recovered = retried.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(recovered?.status, "ok", "one flaked attempt does not block the distro");
    assert.match(String(recovered?.detail), /probed: a fresh resident, pid 4242, protocol 7, digest matches; the first attempt flaked \(.*\); the retry answered$/);
    assert.equal(retried.verdict, "ready");

    const wedgedState = join(stateDir, "handshake-wedged");
    mkdirSync(wedgedState, { recursive: true });
    const wedged = /** @type {Report} */ (JSON.parse(doctor(["--json"], { FAKE_HANDSHAKE: "flake-always", FAKE_STATE_DIR: wedgedState }).stdout));
    const blocked = wedged.checks.find((entry) => entry.id === "agent.handshake");
    assert.equal(blocked?.status, "fail");
    assert.match(String(blocked?.detail), /\(tried twice\)$/);
    assert.equal(wedged.verdict, "blocked");
    assert.deepEqual(wedged.blockers, ["agent.handshake"]);
    assert.equal(wedged.checks.find((entry) => entry.id === "functional.exec")?.status, "skipped", "both smoke legs still skip behind the blocker");
  });

  await check("one scope's pids stay its own in the stale-scope report", async () => {
    // The report runs for real against a fake systemctl. Scope A's control
    // group is this test's own, where a process named like the agent runs;
    // scope B's is PID 1's, where none does. Before the fix B's line carried
    // A's pid: the variable was cleared for `alive` only.
    const fakeBin = join(stateDir, "systemctl-bin");
    mkdirSync(fakeBin, { recursive: true });
    const own = readFileSync("/proc/self/cgroup", "utf8").split("\n").find((line) => line.startsWith("0::"))?.slice(3) ?? "";
    const procs = `/sys/fs/cgroup${own}/cgroup.procs`;
    assert.equal(existsSync(procs), true, "this session's control group lists its processes");
    writeFileSync(join(fakeBin, "systemctl"), `#!/bin/sh
case "$*" in
  "--user is-system-running") exit 0 ;;
  "--user list-units"*) printf 'dsh-wsl-a.scope loaded active running\\ndsh-wsl-b.scope loaded active running\\n' ;;
  "--user show"*) case "$*" in *dsh-wsl-a.scope*) printf '%s\\n' "$FAKE_CGROUP_A" ;; *) printf '/init.scope\\n' ;; esac ;;
  *) exit 0 ;;
esac
`);
    chmodSync(join(fakeBin, "systemctl"), 0o755);
    const resident = spawn("bash", ["-c", "exec -a wsl-agent.sh sleep 60"], { stdio: "ignore" });
    try {
      const pid = /** @type {number} */ (resident.pid);
      for (let waited = 0; waited < 50; waited += 1) {
        if (existsSync(`/proc/${pid}/cmdline`) && readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("wsl-agent.sh")) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("wsl-agent.sh"), "the stand-in resident is named like the agent");
      const report = spawnSync("sh", ["-c", STALE_SCOPE_REPORT], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, FAKE_CGROUP_A: own },
      });
      assert.equal(report.status, 0, report.stderr);
      // Anything else in this control group that is named like the agent —
      // the shell that runs the suite, a parallel test's fake — counts for A.
      const [lineA, lineB] = report.stdout.trim().split("\n");
      assert.match(lineA ?? "", /^dsh-wsl-a\.scope active pids:/);
      const pids = /pids:([0-9 ]+)$/.exec(lineA ?? "")?.[1]?.trim().split(/\s+/).map(Number) ?? [];
      assert.ok(pids.includes(pid), `the stand-in resident (${pid}) is among A's pids ${JSON.stringify(pids)}`);
      assert.equal(lineB, "dsh-wsl-b.scope stale pids:none", "a scope with no agent reports none, not the previous scope's pids");
    } finally {
      resident.kill();
    }
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
    assert.match(run.stderr, /bundle: written to/, "the note about the file is not report content");
    assert.doesNotMatch(run.stdout, /bundle: written to/);
    assert.equal(JSON.parse(run.stdout).schemaVersion, 2, "stdout is the report and nothing else");
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

await check("the composed batches carry exactly the groups they are asked for", () => {
  const bare = composeBatch({ sandbox: false, session: false, conf: false, net: false, host: false, agent: false });
  assert.match(bare, /DSHBATCH=ok/u);
  assert.match(bare, /SH=/u);
  assert.match(bare, /FAMILY=/u);
  assert.match(bare, /DF=/u);
  assert.match(bare, /DATE=/u);
  assert.match(bare, /CONF_B64=/u);
  assert.doesNotMatch(bare, /BWRAP=|BWTEST=|SOCK_B64=/u, "sandbox facts must not ride a run without the sandbox group");
  assert.doesNotMatch(bare, /PID1=|SYSTEMD_RUN=/u, "session facts must not ride a run without the session group");
  assert.doesNotMatch(bare, /BINFMT=|RESOLV=|DNS=|TOOLS_B64=|ARCH=|CACHE_B64=|HOMEEXEC=/u);
  const full = composeBatch({ sandbox: true, session: true, conf: true, net: true, host: true, agent: true });
  for (const key of ["BWRAP=", "BWTEST=", "SOCK_B64=", "PID1=", "SYSTEMD_RUN=", "BINFMT=", "RESOLV=", "DNS=", "TOOLS_B64=", "ARCH=", "CACHE_B64=", "HOMEEXEC="]) {
    assert.match(full, new RegExp(key.replace(/[$]/gu, "\\$"), "u"), `${key} missing from the full batch`);
  }
  // getent rides its own timeout so a dead resolver cannot hold the batch.
  assert.match(full, /timeout 5 getent hosts/u);
  const systemdBatch = composeSystemdBatch({ sandbox: false, session: true, conf: false, net: false, host: false, agent: true }, "/mnt/c/agent/wsl-agent.sh");
  assert.match(systemdBatch, /timeout 10 systemctl --user is-system-running/u);
  assert.match(systemdBatch, /timeout 10 loginctl show-user/u);
  assert.match(systemdBatch, /SCOPES_B64=/u);
  assert.match(systemdBatch, /AGENT_READ=/u);
  // No readability probe without a path; no systemd legs without the section.
  assert.doesNotMatch(composeSystemdBatch({ sandbox: false, session: false, conf: false, net: false, host: false, agent: true }, ""), /AGENT_READ=/u);
  assert.doesNotMatch(composeSystemdBatch({ sandbox: false, session: false, conf: false, net: false, host: false, agent: true }, "/x"), /USER=|LINGER=|SCOPES_B64=/u);
});

await check("parseBatchFacts decodes the base64 keys and ignores everything else", () => {
  const payload = Buffer.from("R /run/user/1000\nU /run/user/1000/bus\n", "utf8").toString("base64");
  const facts = parseBatchFacts(["DSHBATCH=ok", "SH=/bin/bash", "SOCK_B64=" + payload, "this line has no equals", "=empty-key", "", "CONF_B64=" + Buffer.from("[boot]\nsystemd=true\n", "utf8").toString("base64")].join("\n"));
  assert.equal(facts.DSHBATCH, "ok");
  assert.equal(facts.SH, "/bin/bash");
  assert.equal(facts.SOCK_B64, "R /run/user/1000\nU /run/user/1000/bus\n");
  assert.equal(facts.CONF_B64, "[boot]\nsystemd=true\n");
  assert.equal(facts["this line has no equals"], undefined);
  assert.equal(facts[""], undefined);
});

await check("the per-distro reads go out as one batch, not one spawn per fact", async () => {
  const spawnsFile = join(stateDir, "sh-c-spawns");
  rmSync(spawnsFile, { force: true }); // the counter accumulates across the suite's runs; this check counts its own
  const quick = /** @type {Report} */ (JSON.parse(doctor(["--json", "--quick"]).stdout));
  assert.equal(quick.checks.find((entry) => entry.id === "distro.reachable")?.status, "ok");
  const spawns = readFileSync(spawnsFile, "utf8").trim().split("\n").filter((line) => line.length > 0);
  const batches = spawns.filter((line) => line.includes("DSHBATCH=ok") || line.includes("DSHBATCHB=ok"));
  assert.equal(batches.length, 2, "a quick run pays exactly two batch spawns");
  // The pure-read batch carries the always-on facts that used to be one spawn
  // each; the quick profile excludes `net`, so resolv.conf rides the full run.
  assert.ok(batches.some((line) => line.includes("df -Pm /") && line.includes("/etc/wsl.conf")), "df and the conf read must share one spawn");
  assert.ok(spawns.length <= 5, `a quick run keeps its in-distro spawns small, saw ${spawns.length}`);
  rmSync(spawnsFile, { force: true });
  const full = /** @type {Report} */ (JSON.parse(doctor(["--json"]).stdout));
  assert.equal(full.checks.find((entry) => entry.id === "distro.reachable")?.status, "ok");
  const fullSpawns = readFileSync(spawnsFile, "utf8").trim().split("\n").filter((line) => line.length > 0);
  assert.ok(fullSpawns.length <= 10, `a full run keeps its in-distro spawns small, saw ${fullSpawns.length}`);
  const fullBatch = fullSpawns.find((line) => line.includes("DSHBATCH=ok")) ?? "";
  assert.ok(fullBatch.includes("/etc/resolv.conf") && fullBatch.includes("uname -m") && fullBatch.includes("CACHE_B64"), "the full batch carries the net and agent facts too");
});

await check("--probe-timeout bounds a hung batch instead of the shared deadline", async () => {
  const started = Date.now();
  const hung = doctor(["--json", "--quick", "--probe-timeout", "1500"], { FAKE_BATCH_HANG: "yes" });
  const elapsed = Date.now() - started;
  const report = /** @type {Report} */ (JSON.parse(hung.stdout));
  const reachable = report.checks.find((entry) => entry.id === "distro.reachable");
  assert.equal(reachable?.status, "unknown", "a batch killed by the probe deadline is a transport flake, not a config verdict");
  assert.match(String(reachable?.detail), /transport flake/u);
  // One attempt (1.5 s) + settle (2 s) + retry (1.5 s) — well under the 60 s
  // default; the run must have bounded itself, not waited it out.
  assert.ok(elapsed < 20_000, `the hung probe settled in ${elapsed} ms`);
});

await check("--probe-timeout refuses a value that is not a positive integer", () => {
  for (const value of ["abc", "0", "-5", "1.5", ""]) {
    const bad = doctor(["--json", "--probe-timeout", value]);
    assert.notEqual(bad.status, 0, `--probe-timeout ${JSON.stringify(value)} must be refused`);
    assert.match(bad.stderr, /--probe-timeout/u);
  }
  assert.equal(doctor(["--json", "--quick", "--probe-timeout", "1500"]).status, 0);
});
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
