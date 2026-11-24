/**
 * The probe scripts' shared check runner.
 *
 * Every real-machine probe embeds a Node program that drives the shipped
 * `lib/` code against a live distro. They each carried their own copy of
 * `check()`/tallies, and the copies had already drifted: agent.sh alone knew
 * the `Skip` path. This module is the one copy — import it from the embedded
 * programs through `DSH_WSL_ENV_PROBE_DIR` (exported by probe-env.sh):
 *
 *   const { makeCheck, Skip } = await import(`${process.env.DSH_WSL_ENV_PROBE_DIR}/check.mjs`);
 *   const { check, summary } = makeCheck();
 *   await check("name", () => { ... });
 *   summary("agent probe"); // "N agent probe checks pass", exit code follows
 *
 * A check that throws `Skip` with a reason counts apart from the passes and
 * never fails the run — the probe could not observe its property on this
 * host, which is not the property being broken.
 *
 * @module dsh-plugin-wsl-env/test/probe/check
 */

/** Thrown by a check whose prerequisite the host cannot satisfy. */
export class Skip extends Error {
  /**
   * @param {string} reason - why this host cannot observe the check.
   */
  constructor(reason) {
    super(reason);
    this.name = "Skip";
  }
}

/**
 * One probe's running tallies and its pass/fail printer.
 *
 * @returns {{ check: (name: string, fn: () => void | Promise<void>) => Promise<void>, summary: (label: string) => void }} the runner bound to its tallies.
 */
export function makeCheck() {
  let passed = 0;
  let skipped = 0;
  let failed = 0;
  /**
   * Run one named check; a throw is its failure, a {@link Skip} its deferral.
   * @param {string} name - the check's name.
   * @param {() => void | Promise<void>} fn - the assertions.
   */
  const check = async (name, fn) => {
    try {
      await fn();
      passed += 1;
      console.log(`PASS  ${name}`);
    } catch (error) {
      if (error instanceof Skip) {
        skipped += 1;
        console.log(`SKIP  ${name}\n      ${error.message}`);
        return;
      }
      failed += 1;
      console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
      process.exitCode = 1;
    }
  };
  /**
   * Print the tally line. The caller follows with its own exit.
   * @param {string} label - the probe's name, e.g. "agent probe".
   */
  const summary = (label) => {
    const parts = [`${passed} ${label} checks pass`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (skipped > 0) parts.push(`${skipped} skipped`);
    console.log(`\n${parts.join(", ")}`);
  };
  return { check, summary };
}
