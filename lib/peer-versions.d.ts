/** The private env contract between an in-app spawner and `scripts/doctor.mjs`. */
export declare const DOCTOR_PEERS_ENV = "DSH_WSL_DOCTOR_PEERS";
/**
 * The version declared by the nearest `package.json` above a resolved file.
 *
 * Exported for the coverage suite: the walk's two failure arms (a malformed
 * manifest, and the filesystem root) are not reachable with real peers.
 * @param file - one resolved module file.
 * @returns the version, or undefined when no readable manifest declares one.
 */
export declare function versionAbove(file: string): string | undefined;
/**
 * Resolve one peer's version the way this process loads it.
 *
 * Exported for the coverage suite: a peer that does not export
 * `./package.json` exercises the entry-file fallback.
 *
 * `require.resolve` runs through the host's profile resolution when there is
 * one, so a linked plugin sees the installation's copies and a plain process
 * sees whatever `node_modules` it would actually import. The package's
 * `./package.json` export is preferred because it names the version directly;
 * a package that does not export it still resolves by its entry file.
 *
 * @param require - the anchored resolver.
 * @param name - the peer package.
 * @returns the resolved version, or undefined when the peer is absent.
 */
export declare function resolvedPeerVersion(require: NodeJS.Require, name: string): string | undefined;
/**
 * The peer versions this process resolves.
 *
 * Deliberately uncached: a harness upgrade or a plugin-manager reload changes
 * the answer, and one doctor spawn costs one small resolve per peer.
 *
 * @returns a name → version map; empty when the manifest or the peers are
 *   unreadable.
 */
export declare function resolvedPeerVersions(): Record<string, string>;
/**
 * Overlay the resolved peer set on one doctor child environment.
 *
 * The variable is set even when the map is empty: its **presence** is what
 * tells the doctor that an in-app process already attempted resolution, so a
 * peer missing from the map means "the host could not resolve it" and must be
 * reported as unchecked — not looked up again in the plugin's physical tree,
 * which may hold a stale copy. Absent means the standalone CLI, which has no
 * host resolution and keeps its own lookup.
 *
 * @param env - the base environment (normally a copy of `process.env`).
 * @param versions - the map; defaults to {@link resolvedPeerVersions}.
 * @returns the child environment to spawn with.
 */
export declare function withHostPeerVersions(env: NodeJS.ProcessEnv, versions?: Record<string, string>): NodeJS.ProcessEnv;
