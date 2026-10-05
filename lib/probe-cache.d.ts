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
 * @returns {{ run: (key: string, probe: () => Promise<boolean>|boolean) => Promise<boolean>, size: number }}
 */
export function createProbeCache(): {
    run: (key: string, probe: () => Promise<boolean> | boolean) => Promise<boolean>;
    size: number;
};
