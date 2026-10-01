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
 * @module dsh-plugin-wsl/shell-env
 */

import z from "@deepseek-ai/schemastery";
import { isWslUnc, toLinuxPath } from "./paths.js";
import { defaultDistro, defaultShell, linuxHome } from "./wsl.js";

export const name = "wsl-shell-env";

export const inject = ["shellEnv"];

export const Config = z.object({
  /** Distro these facts describe; empty means this machine's default distro. */
  distro: z.string().default(""),
});

export async function apply(ctx, config = {}) {
  // `resolve` is called synchronously by the registry (`Object.entries` of its
  // result), so every fact has to be resolved up front, not per call.
  const configured = config.distro ?? "";
  const distro = configured.length > 0 ? configured : await defaultDistro();
  const shell = await defaultShell(distro);
  const homeWorld = await linuxHome(distro);
  // The consumer is a shell running INSIDE the distro, so it must see the POSIX
  // path; linuxHome() reports the host-side world path (\\wsl.localhost\...).
  let home = homeWorld;
  try {
    const linux = toLinuxPath(homeWorld);
    if (typeof linux === "string" && linux.length > 0) home = linux;
  } catch {
    /* keep the world path rather than contribute nothing */
  }

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
  };

  const dispose = ctx.shellEnv.register({
    name: "dsh-plugin-wsl-env",
    variables,
    resolve: (execution) => {
      const cwd = execution?.agent?.session?.header?.cwd;
      if (!isWslUnc(cwd)) return {};
      return { DSH_WSL_DISTRO: distro, DSH_WSL_SHELL: shell, DSH_WSL_HOME: home };
    },
  });

  // Disposing matters: a config hot-reload re-runs apply(), and the registry
  // rejects a second contributor claiming the same keys.
  ctx.effect(() => dispose);
}
