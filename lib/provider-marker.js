/**
 * The brand the root-plane takeover providers carry for the in-app doctor.
 *
 * `takeover-report` needs to tell this plugin's `subprocess`, `fs` and
 * `directoryPicker` providers from the shipped ones. `instanceof` did that at
 * the cost of an import edge into the whole provider graph — and that graph
 * loads `agent-shared`, which hashes the agent script at module load. A
 * symbol-valued brand on each provider's prototype answers the same question
 * without importing the classes: the diagnostic surface stays small, including
 * in the preset realm where `wsl-doctor-tool` mounts.
 *
 * `Symbol.for` (not `Symbol`) is deliberate: a profile can load two copies of
 * this package, and both should agree on the marker's identity.
 *
 * This is a TypeScript source built to `lib/provider-marker.js`; edit THIS file
 * and run `pnpm run build`.
 *
 * @module dsh-plugin-wsl-env/provider-marker
 */
/** The marker key the takeover providers and the report share. */
export const PLUGIN_PROVIDER = Symbol.for("dsh-plugin-wsl-env/provider");
