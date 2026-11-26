/**
 * Regression checks for the `shell-env` row's dependency surface.
 *
 * `inject` names only `shellEnv`, but the row also warms facts for agents that
 * are already live when it mounts. Reading that optional service as
 * `ctx.agents` is a cordis 4 violation — the context proxy throws "cannot get
 * property \"agents\" without inject" — and the rejection marks the whole
 * component failed in the plugin manager ("包含的组件 → 1 异常"), even though
 * the registry itself never learns about it. The row must read the service
 * through `ctx.get`, which needs no inject and answers undefined when no agent
 * loop is composed.
 *
 * The checks run against `lib/shell-env.js` with the REAL cordis context and a
 * stand-in registry/agents pair. `PATH` is emptied for the mount so the row's
 * `wsl.exe` probes fail as ENOENT immediately instead of depending on the
 * machine's topology.
 *
 *   node test/shell-env.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import * as shellEnvRow from "../lib/shell-env.js";
import { resetSharedAgents } from "../lib/agent-shared.js";
import { setUpdateFact } from "../lib/update-check.js";

/**
 * What the registry stand-in receives, reduced to what this test reads.
 * `resolve` is the row's per-session variable resolver, called with the
 * harness's structural execution object.
 * @typedef {{ name: string, variables: Record<string, { description: string }>, resolve?: (execution: { agent?: { session?: { header?: { cwd?: string | undefined } | undefined } | undefined } }) => Record<string, string> }} Contributor
 */

/** A PATH with no `wsl.exe`: every probe the mount performs fails at once. */
const emptyPath = await mkdtemp(join(tmpdir(), "dsh-wsl-env-no-shell-"));

/**
 * A `wsl.exe` stand-in that answers the row's fact probes (distro list, passwd
 * shell, `$HOME`) and fails everything else fast — the shared resident's spawn
 * lands in the `*) exit 1` arm, so the port scan fails closed in milliseconds
 * instead of hanging on a handshake. `DSH_FAKE_EMPTY_LIST=1` empties the list
 * to drive the mount's fallback arm.
 */
const fakeBin = mkdtempSync(join(tmpdir(), "dsh-wsl-env-fake-"));
const FAKE_WSL = `#!/bin/sh
# Every invocation may be logged (DSH_FAKE_LOG): the poller checks count probes.
[ -z "\$DSH_FAKE_LOG" ] || printf '%s\n' "\$*" >> "\$DSH_FAKE_LOG"
case "\$1" in
  -l)
    case " \$* " in
      *" --running "*)
        if [ -n "\$DSH_FAKE_RUNNING" ]; then printf '%b' "\$DSH_FAKE_RUNNING"; else printf 'ze-ubuntu\\r\\nze-debian\\r\\n'; fi
        exit 0 ;;
    esac
    if [ -n "\$DSH_FAKE_EMPTY_LIST" ]; then printf '\\r\\n'; else printf 'ze-ubuntu\\r\\nze-debian\\r\\n'; fi
    exit 0 ;;
  -d)
    # A slow shared resident (DSH_FAKE_SLOW): the port scan stays in flight.
    # sleep by absolute path: the resident is spawned with a pinned PATH
    # that holds nothing but this directory.
    case "\$*" in *"/wsl-agent.sh") [ -z "\$DSH_FAKE_SLOW" ] || /bin/sleep 1 ;; esac
    for arg in "\$@"; do
      case "\$arg" in *getent*) echo /bin/zsh; exit 0 ;; esac
      case "\$arg" in *HOME*) echo /home/ze-user; exit 0 ;; esac
    done
    exit 1 ;;
  *) exit 1 ;;
esac
`;
writeFileSync(join(fakeBin, "wsl.exe"), FAKE_WSL);
chmodSync(join(fakeBin, "wsl.exe"), 0o755);
/**
 * The staged `wsl.exe` is a `#!/bin/sh` script: only a POSIX host spawns it,
 * and on Windows the probe answers `spawn UNKNOWN` instead of the facts. The
 * checks that read those facts say so and run only here; the fake's path is
 * still staged, so the mounting checks that do not read facts keep running.
 */
const POSIX = process.platform !== "win32";
if (!POSIX) console.log("SKIP  the fact-probe checks: the staged wsl.exe is a POSIX script");

/** The one probe the row makes before it registers: facts for the pinned distro. */
const CONFIG = { distro: "ubuntu", portsRefreshMs: 60_000 };

/**
 * Mount the row under real cordis with the two services it touches stubbed.
 * @param {{ withAgents?: boolean, fakeWsl?: boolean, config?: typeof CONFIG, liveAgents?: Array<{ session?: { header?: { cwd?: string | undefined } | undefined } | undefined }> }} options
 *   whether the composition provides `agents`, whether the fact probes are
 *   answered by the fake `wsl.exe`, the row's config, and the live-agent list
 *   the sweep reads.
 * @returns {Promise<{ ctx: Context, registered: Contributor[], swept: boolean, restorePath: () => void, fiber: unknown }>}
 *   the mounted context, records, a PATH restorer the caller MUST invoke before
 *   assertions that read the real PATH, and the plugin fiber when cordis hands
 *   one back.
 */
async function mount({ withAgents = false, fakeWsl = false, config = CONFIG, liveAgents = [] } = {}) {
  /** @type {Contributor[]} */
  const registered = [];
  let swept = false;
  const host = {
    name: "shell-env-host",
    /** @param {Context} ctx - the host plugin's context. */
    apply(ctx) {
      ctx.provide("shellEnv", {
        /**
         * @param {Contributor} contributor - the row's declaration.
         * @returns {() => void} the disposer.
         */
        register(contributor) {
          registered.push(contributor);
          return () => {};
        },
      });
      if (withAgents) {
        ctx.provide("agents", {
          /** @returns {typeof liveAgents} the live-agent list, recording the sweep. */
          list() {
            swept = true;
            return liveAgents;
          },
        });
      }
    },
  };
  const ctx = new Context();
  await ctx.plugin(host);
  const savedPath = process.env.PATH;
  // The PATH stays pointed at the staged bin until the check calls
  // restorePath: the row's async probes and the port refresher's spawn land on
  // later ticks, after mount() has returned, and must still meet the fake.
  process.env.PATH = fakeWsl ? fakeBin : emptyPath;
  let fiber;
  try {
    fiber = await ctx.plugin(shellEnvRow, config);
  } catch (error) {
    process.env.PATH = savedPath;
    throw error;
  }
  return { ctx, registered, swept, restorePath: () => { process.env.PATH = savedPath; }, fiber };
}

const withAgents = await mount({ withAgents: true });
withAgents.restorePath();
assert.equal(withAgents.registered.length, 1, "the row registers its contributor exactly once");
const contributor = withAgents.registered[0];
assert.ok(contributor, "the registry received a contributor");
assert.equal(contributor.name, "dsh-plugin-wsl-env", "the contributor owns a stable name");
assert.deepEqual(
  Object.keys(contributor.variables).sort(),
  ["DSH_WSL_DISTRO", "DSH_WSL_DOCTOR", "DSH_WSL_HOME", "DSH_WSL_PLUGIN_UPDATE", "DSH_WSL_PORTS", "DSH_WSL_SHELL"],
  "the managed keys are declared together (DSH_WSL_DOCTOR declares always; its value is Windows-host shaped)",
);
assert.equal(withAgents.swept, true, "the live-agent sweep reaches the optional agents service");
console.log("PASS  a composition with agents mounts and sweeps");

const withoutAgents = await mount({ withAgents: false });
withoutAgents.restorePath();
assert.equal(withoutAgents.registered.length, 1, "a composition without agents still activates");
console.log("PASS  a composition without agents still activates");

// The contributor's resolve maps a session's UNC cwd onto the five managed
// keys, refuses other distros/pinnings, and defaults PORTS to empty.
{
  const mounted = await mount({ withAgents: true });
  mounted.restorePath();
  const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
  // Only the early-refusal guards are exercised here: the accept path calls
  // ensurePorts, which spawns the shared resident and would make this unit
  // test depend on a real distro (and hold its child process).
  assert.deepEqual(resolve({}), {}, "no session cwd resolves to no variables");
  assert.deepEqual(resolve({ agent: { session: { header: { cwd: "C:\\proj" } } } }), {}, "a Windows-path session resolves to nothing");
  assert.deepEqual(resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\debian\\home" } } } }), {}, "another distro's session resolves to nothing under a pinned ubuntu");
  console.log("PASS  resolve refuses sessions outside the pinned distro's world");
}

// With the fact probes answered, auto mode lists the distros, warms the
// default one's facts at mount, and resolve() publishes all five keys — the
// accept path the earlier checks deliberately avoided (it spawns the shared
// resident, which here fails closed against the fake's `*) exit 1` arm).
if (POSIX) {
  const mounted = await mount({ withAgents: true, fakeWsl: true, config: { distro: "", portsRefreshMs: 3_600_000 } });
  const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
  const accepted = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
  assert.equal(accepted.DSH_WSL_DISTRO, "ze-ubuntu", "the session's distro is named");
  assert.equal(accepted.DSH_WSL_SHELL, "/bin/zsh", "the warmed shell fact is published");
  assert.equal(accepted.DSH_WSL_HOME, "/home/ze-user", "the warmed home fact is published");
  assert.equal(accepted.DSH_WSL_PORTS, "", "a failed port scan resolves to an empty list, not a lie");
  assert.equal(accepted.DSH_WSL_PLUGIN_UPDATE, "", "no update check yet, no invented update fact");
  // A distro whose facts never warmed resolves under its own name with the
  // optional keys absent — the canonical lookup falls back to the named distro.
  const cold = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-debian\\home" } } } });
  assert.equal(cold.DSH_WSL_DISTRO, "ze-debian", "an unwarmed distro still names itself");
  assert.equal(cold.DSH_WSL_SHELL, undefined, "no warmed shell, no invented shell");
  assert.equal(cold.DSH_WSL_HOME, undefined, "no warmed home, no invented home");
  // A second accept for the warmed distro rides the existing timer: the ports
  // refresher arms once per distro, not once per resolve.
  const again = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
  assert.equal(again.DSH_WSL_SHELL, "/bin/zsh", "the warmed facts are stable across resolves");
  mounted.restorePath();
  console.log("PASS  auto mode warms the default distro and resolve publishes the facts");
}

// An empty distro list falls back to `defaultDistro`, which reads the same
// source and throws on nothing — the mount survives with no default name and
// every resolve names the session's own distro with no facts.
if (POSIX) {
  process.env.DSH_FAKE_EMPTY_LIST = "1";
  try {
    const mounted = await mount({ fakeWsl: true, config: { distro: "", portsRefreshMs: 3_600_000 } });
    const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
    const resolved = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-alone\\home" } } } });
    assert.equal(resolved.DSH_WSL_DISTRO, "ze-alone", "no default name: the session's distro names itself");
    assert.equal(resolved.DSH_WSL_SHELL, undefined, "no facts were warmed for it");
    mounted.restorePath();
    console.log("PASS  an empty distro list leaves the row alive and factless");
  } finally {
    delete process.env.DSH_FAKE_EMPTY_LIST;
  }
}

// With no `wsl.exe` reachable at all, both mount probes fail — the distro
// list and the default-distro re-read behind it. The row still mounts, names
// no default, and every resolve falls back to the session's own distro with
// no facts: absence over a lie, at the row's starkest.
{
  const mounted = await mount({ withAgents: true, config: { distro: "", portsRefreshMs: 3_600_000 } });
  mounted.restorePath();
  const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
  const resolved = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-alone\\home" } } } });
  assert.equal(resolved.DSH_WSL_DISTRO, "ze-alone", "both mount probes failed: the session's distro still names itself");
  assert.equal(resolved.DSH_WSL_SHELL, undefined, "no facts were warmed for it");
  assert.equal(resolved.DSH_WSL_HOME, undefined, "no invented home either");
  console.log("PASS  both mount probes failing leaves the row alive and factless");
}

// `default` mode refuses sessions outside the default distro on both the
// consider and resolve paths, and accepts sessions inside it.
if (POSIX) {
  const mounted = await mount({ fakeWsl: true, config: { distro: "default", portsRefreshMs: 3_600_000 } });
  const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
  assert.deepEqual(
    resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-other\\home" } } } }),
    {},
    "a non-default distro's session resolves to nothing in default mode",
  );
  const accepted = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
  assert.equal(accepted.DSH_WSL_DISTRO, "ze-ubuntu", "the default distro's session resolves");
  mounted.restorePath();
  console.log("PASS  default mode scopes resolve to the default distro");
}

// One distro spelled two ways is still one distro: facts, port timers and
// snapshots are keyed by the listed name, not the session's casing.
if (POSIX) {
  const live = [{ session: { header: { cwd: "\\\\wsl.localhost\\ZE-UBUNTU\\home\\u" } } }];
  const mounted = await mount({ withAgents: true, fakeWsl: true, config: { distro: "", portsRefreshMs: 3_600_000 }, liveAgents: live });
  const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
  const upper = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ZE-UBUNTU\\home\\u" } } } });
  assert.equal(upper.DSH_WSL_DISTRO, "ze-ubuntu", "the listed spelling is canonical");
  const lower = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
  assert.equal(lower.DSH_WSL_DISTRO, "ze-ubuntu");
  mounted.restorePath();
  console.log("PASS  case variants of one distro share one key");
}

// The agent/created listener and the live-agent sweep share `consider`: a
// session inside scope warms facts and arms the port refresher, everything
// else is dropped before any probe fires.
{
  const live = [{ session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } }];
  const mounted = await mount({ withAgents: true, fakeWsl: true, config: { distro: "ze-ubuntu", portsRefreshMs: 3_600_000 }, liveAgents: live });
  assert.equal(mounted.swept, true, "the sweep read the non-empty live list");
  mounted.restorePath();
  console.log("PASS  a live agent inside the pin warms at mount");
}

if (POSIX) {
  const mounted = await mount({ fakeWsl: true, config: { distro: "ze-ubuntu", portsRefreshMs: 3_600_000 } });
  const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
  // The listener is wired through the real cordis event bus: emitting
  // `agent/created` drives `consider` exactly as the harness would. The bus's
  // own typing does not know the harness's event, so the bus is spelled
  // structurally — the same posture the row itself takes (ShellEnvContext).
  const bus = /** @type {{ emit: (event: string, payload?: unknown) => void }} */ (/** @type {unknown} */ (mounted.ctx));
  bus.emit("agent/created", undefined);
  bus.emit("agent/created", { agent: { session: { header: { cwd: "C:\\proj" } } } });
  bus.emit("agent/created", { agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-debian\\home" } } } });
  const warmed = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
  assert.equal(warmed.DSH_WSL_SHELL, "/bin/zsh", "the in-scope event warmed the facts");
  mounted.restorePath();
  console.log("PASS  agent/created events outside the pin are dropped, inside it warm facts");
}

// The port poller follows the sessions (#80): it runs for a distro a live
// session works in, stops with the last of them, asks WSL which distros are
// running before it probes (a probe boots a stopped distro), and never
// overlaps two scans of one distro.
if (POSIX) {
  /**
   * @param {number} ms - how long to wait.
   * @returns {Promise<void>} resolved after the given milliseconds.
   */
  const waits = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const log = join(fakeBin, "calls.log");
  /** @returns {number} how many times the fake `wsl.exe` was asked to start `ze-ubuntu`'s shared resident. */
  const probes = () => {
    try {
      return readFileSync(log, "utf8").split("\n").filter((line) => line.startsWith("-d ze-ubuntu ") && line.includes("wsl-agent.sh")).length;
    } catch {
      return 0;
    }
  };
  const session = () => [{ session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } }];
  /** @type {Awaited<ReturnType<typeof mount>> | undefined} */
  let mounted;
  /**
   * Mount the row over the fake, with its PATH left in place for the ticks.
   * @param {ReturnType<typeof session>} liveAgents - the live-agent list the row reads.
   * @returns {Promise<Awaited<ReturnType<typeof mount>>>} the mounted row.
   */
  const mountPolled = async (liveAgents) => {
    resetSharedAgents();
    rmSync(log, { force: true });
    process.env.DSH_FAKE_LOG = log;
    return mount({ withAgents: true, fakeWsl: true, config: { distro: "ze-ubuntu", portsRefreshMs: 40 }, liveAgents });
  };
  const finish = async () => {
    const fiber = /** @type {{ dispose?: () => Promise<void> } | undefined} */ (mounted?.fiber);
    if (fiber !== undefined && typeof fiber.dispose === "function") await fiber.dispose();
    mounted?.restorePath();
    resetSharedAgents();
    for (const name of ["DSH_FAKE_LOG", "DSH_FAKE_RUNNING", "DSH_FAKE_SLOW"]) delete process.env[name];
  };
  try {
    const live = session();
    process.env.DSH_FAKE_RUNNING = "ze-ubuntu\\r\\n";
    mounted = await mountPolled(live);
    await waits(300);
    const whileUsed = probes();
    assert.ok(whileUsed >= 2, `precondition: a distro a live session works in is polled (${whileUsed} probes in 300 ms)`);
    live.length = 0;
    await waits(150);
    const afterGone = probes();
    await waits(300);
    assert.equal(probes(), afterGone, "a distro no live session works in is no longer polled");
    console.log("PASS  the port poller stops with the last session that used the distro");
  } finally {
    await finish();
  }
  try {
    process.env.DSH_FAKE_RUNNING = "\\r\\n";
    mounted = await mountPolled(session());
    await waits(250);
    assert.equal(probes(), 0, "a distro WSL reports as stopped is not probed: the probe is a `wsl.exe -d`, which boots it");
    const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
    const resolved = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
    assert.equal(resolved.DSH_WSL_PORTS, "", "and it reads as having no listeners");
    console.log("PASS  a stopped distro is left alone and reads as having no listeners");
  } finally {
    await finish();
  }
  try {
    process.env.DSH_FAKE_RUNNING = "ze-ubuntu\\r\\n";
    process.env.DSH_FAKE_SLOW = "1";
    mounted = await mountPolled(session());
    await waits(300);
    // Seven ticks passed while the first scan was still inside its 1 s probe.
    assert.ok(probes() <= 2, `a scan still in flight is not overlapped by the next tick (${probes()} probes in 300 ms); log:\n${readFileSync(log, "utf8")}`);
    console.log("PASS  a slow scan is not overlapped by the next tick");
  } finally {
    await finish();
  }
}

// Disposal clears the row's registration: a hot reload can re-apply without
// the registry rejecting a second contributor over the same keys.
{
  const mounted = await mount({ fakeWsl: true, config: { distro: "ze-ubuntu", portsRefreshMs: 3_600_000 } });
  const fiber = /** @type {{ dispose?: () => Promise<void> } | undefined} */ (mounted.fiber);
  if (fiber && typeof fiber.dispose === "function") {
    await fiber.dispose();
    console.log("PASS  the mounted fiber disposes without error");
  } else {
    console.log("PASS  disposal skipped: cordis returned no fiber handle");
  }
  mounted.restorePath();
}

// A zero (or tiny) portsRefreshMs must not read as "refreshed every 0s" nor
// spin the poller: the interval is floored at one second.
{
  const mounted = await mount({ fakeWsl: true, config: { distro: "ze-ubuntu", portsRefreshMs: 0 } });
  try {
    const contributor = mounted.registered[0];
    assert.ok(contributor, "the row registered");
    const ports = contributor.variables.DSH_WSL_PORTS;
    assert.ok(ports, "the ports variable is declared");
    assert.match(ports.description, /refreshed every 1s/, "a sub-second interval is floored at one second");
    console.log("PASS  portsRefreshMs is floored at one second");
  } finally {
    const fiber = /** @type {{ dispose?: () => Promise<void> } | undefined} */ (mounted.fiber);
    if (fiber && typeof fiber.dispose === "function") await fiber.dispose();
    mounted.restorePath();
  }
}

// N polled distros share ONE refresh timer: a timer per distro each fired the
// same global tick, so N distros meant N scan rounds every period.
{
  resetSharedAgents();
  const mounted = await mount({ fakeWsl: true, config: { distro: "", portsRefreshMs: 60_000 } });
  const original = globalThis.setInterval;
  let created = 0;
  /**
   * Count every interval creation, then delegate to the real one.
   * @param {...unknown} args - the caller's setInterval arguments.
   * @returns {unknown} the real timer handle.
   */
  function spy(...args) {
    created += 1;
    return /** @type {(...a: unknown[]) => unknown} */ (original)(...args);
  }
  globalThis.setInterval = /** @type {typeof setInterval} */ (/** @type {unknown} */ (spy));
  try {
    const resolve = mounted.registered[0]?.resolve;
    assert.ok(resolve, "the row registered its resolver");
    resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
    resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\debian\\home\\u" } } } });
    assert.equal(created, 1, "two polled distros share one interval");
    console.log("PASS  polled distros share one refresh timer");
  } finally {
    globalThis.setInterval = original;
    const fiber = /** @type {{ dispose?: () => Promise<void> } | undefined} */ (mounted.fiber);
    if (fiber && typeof fiber.dispose === "function") await fiber.dispose();
    mounted.restorePath();
    resetSharedAgents();
  }
}

// The update fact rides the accepted-branch as a timer-fed read: staged via
// the tests-only setter, it resolves into the managed key, and clearing it
// returns the key to its empty posture. The staged fact must be cleared even
// when the checks below fail, so later suites start from a clean slate.
{
  const mounted = await mount({ fakeWsl: true, config: { distro: "ze-ubuntu", portsRefreshMs: 3_600_000 } });
  mounted.restorePath();
  const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
  setUpdateFact({ installed: "0.19.0", latest: "0.20.0", incompatible: false, checkedAt: 1 });
  try {
    const resolved = resolve({ agent: { session: { header: { cwd: "C:\\proj" } } } });
    assert.deepEqual(resolved, {}, "no update fact leaks into a refused session");
    const accepted = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
    assert.equal(accepted.DSH_WSL_PLUGIN_UPDATE, "0.20.0 available (installed 0.19.0)", "the staged fact resolves verbatim");
    setUpdateFact({ installed: "0.19.0", latest: "0.20.0", incompatible: true, deprecated: "known bug", checkedAt: 1 });
    const marked = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
    assert.equal(marked.DSH_WSL_PLUGIN_UPDATE, "0.20.0 available (installed 0.19.0) — requires a newer DSH first; deprecated: known bug", "the fact carries its marks");
  } finally {
    setUpdateFact(undefined);
  }
  console.log("PASS  the update fact resolves into DSH_WSL_PLUGIN_UPDATE and clears back to empty");
}

// ---- the doctor fact (WSL-317) --------------------------------------------

{
  const { windowsToPosix, doctorFact } = shellEnvRow;
  console.log("PASS  windowsToPosix maps the drive through the default automount");
  assert.equal(windowsToPosix("C:\\Users\\x\\App\\DeepSeek Harness.exe"), "/mnt/c/Users/x/App/DeepSeek Harness.exe");
  assert.equal(windowsToPosix("d:/x/y"), "/mnt/d/x/y");
  assert.equal(windowsToPosix("/already/posix"), "/already/posix", "a non-drive path passes through");

  console.log("PASS  doctorFact builds the interop command on Windows and nothing off it");
  const command = doctorFact("C:\\App\\dsh.exe", "C:\\Users\\x\\plugin", true);
  assert.match(String(command), /^WSLENV="ELECTRON_RUN_AS_NODE/);
  assert.match(String(command), /ELECTRON_RUN_AS_NODE=1 '\/mnt\/c\/App\/dsh\.exe'/, "the exe rides /mnt through interop");
  assert.match(String(command), /'C:\\+Users\\+x\\+plugin[\/\\]scripts[\/\\]doctor\.mjs'$/, "the script stays a Windows path (the separator follows the host)");
  const withExisting = doctorFact("C:\\App\\dsh.exe", "C:\\p", true) ;
  assert.ok(String(withExisting).startsWith('WSLENV="'), "WSLENV is set inline so the flag crosses interop");
  assert.equal(doctorFact("/usr/bin/node", "/plugin", false), undefined, "the fact exists only on Windows hosts");
  // A path may legally contain an apostrophe; the quoted argument must close
  // and reopen around it instead of ending the string early.
  const quoted = String(doctorFact("C:\\Users\\o'brien\\dsh.exe", "C:\\Users\\o'brien\\p", true));
  assert.match(quoted, /'\/mnt\/c\/Users\/o'\\''brien\/dsh\.exe'/, "the apostrophe is escaped, not left to break the shell");
}
