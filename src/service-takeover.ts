/**
 * Deferred registration for the plugin's same-name root-plane takeovers.
 *
 * The bundle patch disables the shipped `subprocess`/`fs`/`directoryPicker`
 * rows and inserts this plugin's providers under the same service names. On a
 * cold boot the shipped rows never start, so the provider registers freely.
 * On a LIVE recomposition the outgoing provision can still be registered while
 * the replacement mounts — the HMR plugin-update path (`updateBundle` removes
 * the old bundle layer, the shipped rows re-activate, then the incoming layer
 * disables them again) or a busy-profile enable while live sessions hold the
 * service. Cordis refuses the duplicate registration, the row enters FAILED,
 * and the plugin manager reports the update as failed and rolls back (issue
 * #39, upstream deepseek-harness#12510).
 *
 * A row that mounts through this helper stays ACTIVE either way: when the name
 * is free it registers immediately (the cold path, unchanged), and when a
 * provision is still registered it waits for `internal/service` to report the
 * slot released, then registers. The recomposition therefore succeeds, the
 * outgoing provider keeps serving until its dependents release, and the
 * takeover lands as soon as it does — or at the next restart, if a dependent
 * never releases (the in-app doctor's `providers.takeover` row names the
 * provider still in place).
 *
 * Guards:
 * - `ctx.reflect.get(name, false)` reads the store including an UNLOADING
 *   implementation, so a slot that is about to free still reads as occupied.
 * - The handler never registers from a fiber that is itself unloading: the
 *   release it observes can be its own disposal, and a provision registered
 *   then would be owned by a dying fiber.
 *
 * This is a TypeScript source built to `lib/service-takeover.js`; edit THIS
 * file and run `pnpm run build`.
 *
 * @module dsh-plugin-wsl-env/service-takeover
 */

import { FiberState, type Context } from "@deepseek-ai/cordis";

/**
 * Register a same-name takeover provider now, or after the outgoing provision
 * releases.
 *
 * @param ctx - the row's context; the provision is owned by its fiber.
 * @param service - the service name the provider registers.
 * @param mount - constructs the provider on `ctx` (its constructor performs
 *   the registration and owns the cleanup).
 */
export function mountTakeover(ctx: Context, service: string, mount: () => void): void {
  /** Whether the service store still holds an implementation, unloading included. */
  const occupied = (): boolean => ctx.reflect.get(service, false) !== undefined;
  if (!occupied()) {
    mount();
    return;
  }
  ctx.logger?.warn?.(
    `dsh-plugin-wsl-env: "${service}" is still registered by an outgoing provider; the WSL provider will take over when it releases — restart DSH to apply it immediately`,
  );
  ctx.on("internal/service", (name: string, value: unknown) => {
    if (name !== service || value !== undefined) return;
    if (occupied()) return;
    // The observed release may be this fiber's own disposal; never register
    // from a fiber that is unloading.
    if (ctx.fiber.state !== FiberState.ACTIVE) return;
    ctx.logger?.debug?.(`dsh-plugin-wsl-env: "${service}" was released; the WSL provider takes over now`);
    mount();
  });
}
