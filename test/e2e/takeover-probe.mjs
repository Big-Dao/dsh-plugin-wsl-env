/**
 * Boot probe for the install e2e: report which class serves each root-plane
 * takeover, then stop the booted host.
 *
 * The e2e mounts this by absolute path through a `--patch` overlay after
 * upgrading a profile, so the assertion covers the composed bundle rather than
 * `--dump-config`'s composition. The line goes to stdout because the CLI's
 * output is already captured; the write callback flushes it before exit.
 */
export const name = "e2e-takeover-probe";

/** Wait until all three takeover services exist before reading them. */
export const inject = ["subprocess", "fs", "directoryPicker"];

/** @param {{ get: (name: string) => unknown }} ctx - the root context. */
export function apply(ctx) {
  const report = {
    subprocess: /** @type {any} */ (ctx.get("subprocess"))?.constructor?.name ?? null,
    fs: /** @type {any} */ (ctx.get("fs"))?.constructor?.name ?? null,
    directoryPicker: /** @type {any} */ (ctx.get("directoryPicker"))?.constructor?.name ?? null,
  };
  process.stdout.write(`DSH_E2E_TAKEOVER ${JSON.stringify(report)}\n`, () => { process.exit(0); });
}
