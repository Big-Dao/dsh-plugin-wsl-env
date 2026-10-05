/**
 * The caching policy for a functional probe: which verdicts may be remembered.
 *
 * A SUCCESS is durable — if `bwrap` created a profile a minute ago it will create
 * one now. A FAILURE is not: it describes the machine as it is at that moment, and
 * the common case is a package that is not installed *yet*. Remembering a failure
 * would make the documented remedy (`sudo apt install bubblewrap`) silently
 * ineffective until the app restarts, while the error message tells the user to
 * install exactly that. So a failure is dropped and the next call probes again.
 *
 * Probes are I/O, and concurrent first calls would otherwise each pay for one.
 * Storing the in-flight promise makes them share a single probe.
 *
 * Pure by construction — no Node API, no clock — so the policy is unit-testable
 * without the peers `lib/sandbox.js` needs.
 *
 * This is a TypeScript source built to `lib/probe-cache.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 */

/** One probe cache's surface. */
export interface ProbeCache {
  /**
   * Run one probe under the policy.
   *
   * @param key - the probe's cache key.
   * @param probe - the probe to run on a miss. A throw is a failed probe, never
   *   a propagated error.
   * @returns the verdict; a success is remembered, a failure is not.
   */
  run(key: string, probe: () => Promise<boolean> | boolean): Promise<boolean>;
  /** Remembered successes, for tests and diagnostics. */
  readonly size: number;
}

/**
 * Build one probe cache.
 *
 * @returns the policy object `lib/sandbox-core.js` holds per provider.
 */
export function createProbeCache(): ProbeCache {
  const verdicts = new Map<string, true | Promise<boolean>>();
  return {
    async run(key, probe) {
      const cached = verdicts.get(key);
      if (cached !== undefined) return cached;

      const pending = (async () => {
        try {
          return await probe();
        } catch {
          return false;
        }
      })();
      verdicts.set(key, pending);

      const verdict = await pending;
      if (verdict) verdicts.set(key, true);
      else verdicts.delete(key);
      return verdict;
    },
    /** Remembered successes, for tests and diagnostics. */
    get size() {
      return verdicts.size;
    },
  };
}
