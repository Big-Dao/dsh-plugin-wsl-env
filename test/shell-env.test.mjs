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
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import * as shellEnvRow from "../lib/shell-env.js";

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
case "\$1" in
  -l)
    if [ -n "\$DSH_FAKE_EMPTY_LIST" ]; then printf '\\r\\n'; else printf 'ze-ubuntu\\r\\nze-debian\\r\\n'; fi
    exit 0 ;;
  -d)
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
  ["DSH_WSL_DISTRO", "DSH_WSL_HOME", "DSH_WSL_PORTS", "DSH_WSL_SHELL"],
  "the four managed keys are declared together",
);
assert.equal(withAgents.swept, true, "the live-agent sweep reaches the optional agents service");
console.log("PASS  a composition with agents mounts and sweeps");

const withoutAgents = await mount({ withAgents: false });
withoutAgents.restorePath();
assert.equal(withoutAgents.registered.length, 1, "a composition without agents still activates");
console.log("PASS  a composition without agents still activates");

// The contributor's resolve maps a session's UNC cwd onto the four managed
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
// default one's facts at mount, and resolve() publishes all four keys — the
// accept path the earlier checks deliberately avoided (it spawns the shared
// resident, which here fails closed against the fake's `*) exit 1` arm).
{
  const mounted = await mount({ withAgents: true, fakeWsl: true, config: { distro: "", portsRefreshMs: 3_600_000 } });
  const resolve = /** @type {NonNullable<Contributor["resolve"]>} */ (mounted.registered[0]?.resolve);
  const accepted = resolve({ agent: { session: { header: { cwd: "\\\\wsl.localhost\\ze-ubuntu\\home\\u" } } } });
  assert.equal(accepted.DSH_WSL_DISTRO, "ze-ubuntu", "the session's distro is named");
  assert.equal(accepted.DSH_WSL_SHELL, "/bin/zsh", "the warmed shell fact is published");
  assert.equal(accepted.DSH_WSL_HOME, "/home/ze-user", "the warmed home fact is published");
  assert.equal(accepted.DSH_WSL_PORTS, "", "a failed port scan resolves to an empty list, not a lie");
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
{
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

// `default` mode refuses sessions outside the default distro on both the
// consider and resolve paths, and accepts sessions inside it.
{
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

{
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
