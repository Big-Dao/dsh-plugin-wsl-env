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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import * as shellEnvRow from "../lib/shell-env.js";

/** What the registry stand-in receives, reduced to what this test reads. */
/** @typedef {{ name: string, variables: Record<string, { description: string }> }} Contributor */

/** A PATH with no `wsl.exe`: every probe the mount performs fails at once. */
const emptyPath = await mkdtemp(join(tmpdir(), "dsh-wsl-env-no-shell-"));

/** The one probe the row makes before it registers: facts for the pinned distro. */
const CONFIG = { distro: "ubuntu", portsRefreshMs: 60_000 };

/**
 * Mount the row under real cordis with the two services it touches stubbed.
 * @param {{ withAgents: boolean }} options - whether the composition provides `agents`.
 * @returns {Promise<{ ctx: Context, registered: Contributor[], swept: boolean }>} the mounted context and records.
 */
async function mount({ withAgents }) {
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
          /** @returns {never[]} an empty live-agent list, recording the sweep. */
          list() {
            swept = true;
            return [];
          },
        });
      }
    },
  };
  const ctx = new Context();
  await ctx.plugin(host);
  const savedPath = process.env.PATH;
  process.env.PATH = emptyPath;
  try {
    await ctx.plugin(shellEnvRow, CONFIG);
  } finally {
    process.env.PATH = savedPath;
  }
  return { ctx, registered, swept };
}

const withAgents = await mount({ withAgents: true });
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
assert.equal(withoutAgents.registered.length, 1, "a composition without agents still activates");
console.log("PASS  a composition without agents still activates");
