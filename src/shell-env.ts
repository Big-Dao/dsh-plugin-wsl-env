/**
 * Contribute the WSL environment's facts to the managed `DSH_*` namespace.
 *
 * `dsh-shell-env` owns `ctx.shellEnv`, the registry that rebuilds the trusted
 * `DSH_*` variables injected into every model shell call. That is DSH's sanctioned
 * channel for telling a model what its shell environment actually is — the shell
 * tool's own description points the model at it ("Managed `$DSH_*` variables
 * expose current harness environment facts").
 *
 * It has one built-in key that looks like it should carry this, and does not:
 *
 *     collect() { const values = { [DSH_HOME_ENV]: this.dshHome, [DSH_SHELL_KEY]: "1" } }
 *
 * `DSH_SHELL` is a marker FLAG (`=1`) meaning "a DSH-managed shell call", not the
 * shell path, and it is in `RESERVED_BASH_ENV_KEYS`, so a contributor may not own
 * it. The supported way to convey the real shell is a `DSH_`-prefixed key of our
 * own, declared with a description and resolved synchronously.
 *
 * Scoping uses the same test as `auto-preset`: the agent's recorded workspace
 * directory. A session whose workspace is inside a distro is exactly a session
 * whose shell calls run in that distro — so a host session sees none of these.
 *
 * This is a TypeScript source built to `lib/shell-env.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/shell-env
 */

import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";
import { isAnotherDistrosUnc, isWslUnc } from "./paths.js";
import { defaultDistro, defaultShell, linuxHomePath } from "./wsl.js";
import { sharedAgent } from "./agent-shared.js";
import { listeningPorts } from "./ports.js";

export const name = "wsl-shell-env";

export const inject = ["shellEnv"];

export const Config = z.object({
  /** Distro these facts describe; empty means this machine's default distro. */
  distro: z.string().default(""),
  /** How often the listening-port snapshot refreshes, in milliseconds. */
  portsRefreshMs: z.number().default(10 * 1000),
});

/** The config schema's validated output. */
export interface ShellEnvConfig {
  /** Distro these facts describe; empty means this machine's default distro. */
  distro?: string;
  /** How often the listening-port snapshot refreshes, in milliseconds. */
  portsRefreshMs?: number;
}

/**
 * The execution slice the shell-env registry hands a contributor's `resolve`;
 * the harness's execution object is structural here.
 */
export interface ShellEnvExecution {
  /** The executing session's agent stub. */
  agent?: { session?: { header?: { cwd?: string | undefined } | undefined } | undefined } | undefined;
}

/**
 * The cordis context extended with the `shellEnv` registry slice this plugin
 * contributes through. The registry belongs to the harness and its
 * declaration is not visible to this plugin, so it is spelled structurally on
 * top of the framework's {@link Context}.
 */
export type ShellEnvContext = Context & {
  shellEnv: {
    register: (contributor: {
      name: string,
      variables: Record<string, { description: string }>,
      resolve: (execution: ShellEnvExecution | undefined) => Record<string, string>,
    }) => () => void,
  },
};

/**
 * Contribute the WSL environment's facts to the shell-env registry.
 *
 * @param ctx - the cordis context.
 * @param config - the schema-validated plugin config.
 */
export async function apply(ctx: ShellEnvContext, config: ShellEnvConfig = {}): Promise<void> {
  // `resolve` is called synchronously by the registry (`Object.entries` of its
  // result), so every fact has to be resolved up front, not per call.
  const configured = config.distro ?? "";
  const distro = configured.length > 0 ? configured : await defaultDistro();
  // undefined when both probes failed (a cold distro): the fact is then
  // simply absent, which beats presenting the "bash" placeholder as the
  // distro's login shell for this process's lifetime.
  const shell = await defaultShell(distro);
  // The consumer is a shell running INSIDE the distro, so the fact is the POSIX
  // path, not the host-side world path.
  const home = await linuxHomePath(distro);

  const variables = {
    DSH_WSL_DISTRO: {
      description: `Name of the WSL distro this workspace lives in (${distro}).`,
    },
    DSH_WSL_SHELL: {
      description: `Absolute path of the login shell that model shell calls run in inside ${distro}. Commands are executed by this shell, not by bash.`,
    },
    DSH_WSL_HOME: {
      description: `Home directory of the user model shell calls run as inside ${distro}.`,
    },
    DSH_WSL_PORTS: {
      description: `Ports with a listener inside ${distro} (comma-separated, ascending), as of the last snapshot — refreshed every ${Math.round((config.portsRefreshMs as number) / 1000)}s, so a dev server started moments ago may not be listed yet. Empty means none were listening at the last scan.`,
    },
  };

  // The port snapshot refreshes on a timer and is served synchronously: the
  // registry's resolve is sync by contract, so live reads are impossible —
  // the timer bounds staleness instead (see lib/ports.js).
  let ports: number[] = [];
  const refreshPorts = async () => {
    ports = await listeningPorts(sharedAgent(distro), 8000);
  };
  void refreshPorts();
  const portsTimer = setInterval(() => void refreshPorts(), config.portsRefreshMs);
  portsTimer.unref?.();

  const dispose = ctx.shellEnv.register({
    name: "dsh-plugin-wsl-env",
    variables,
    resolve: (execution) => {
      const cwd = execution?.agent?.session?.header?.cwd;
      if (cwd === undefined || !isWslUnc(cwd)) return {};
      // The facts describe ONE distro. A workspace under another distro's UNC
      // is not that distro — the shell refuses its commands outright (the
      // cross-distro guard) — so the honest resolution is no facts at all,
      // not another distro's home and shell presented as this session's.
      if (isAnotherDistrosUnc(cwd, distro)) return {};
      const facts: Record<string, string> = {
        DSH_WSL_DISTRO: distro,
        DSH_WSL_HOME: home,
        DSH_WSL_PORTS: ports.join(","),
      };
      if (shell !== undefined) facts.DSH_WSL_SHELL = shell;
      return facts;
    },
  });

  // Disposing matters: a config hot-reload re-runs apply(), and the registry
  // rejects a second contributor claiming the same keys.
  ctx.effect(() => () => {
    clearInterval(portsTimer);
    dispose();
  });
}
