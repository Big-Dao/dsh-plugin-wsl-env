/**
 * The peer set the spawning host process resolved, handed to the doctor CLI.
 *
 * The doctor is a separate process on purpose (see `scripts/doctor.mjs`), and
 * a separate Node process resolves bare imports with Node's own lookup only.
 * That is the wrong answer for a linked plugin: the host installs a profile
 * resolution that projects a linked plugin's declared peers onto the
 * installation's single copies, so the doctor's `createRequire` from the
 * plugin directory can land on an unrelated `node_modules` above the mirror
 * (or on nothing at all) while the plugin itself loads the host's copies.
 * This module reads what the plugin process actually resolves — the same
 * `createRequire` lookup, already intercepted by the host when one is
 * installed — and passes it to the child in {@link DOCTOR_PEERS_ENV}. The
 * variable's presence, not its size, is the signal: the map can be partial or
 * empty (a peer the host could not resolve), and the doctor still treats it as
 * authoritative instead of looking the missing peer up again beside the
 * plugin. The standalone CLI, which has no host and therefore no variable,
 * keeps its own lookup and reports peers it cannot see as unchecked.
 *
 * This is a TypeScript source built to `lib/peer-versions.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/peer-versions
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The private env contract between an in-app spawner and `scripts/doctor.mjs`. */
export const DOCTOR_PEERS_ENV = "DSH_WSL_DOCTOR_PEERS";

/** The installed plugin root (`lib/`'s parent), the anchor for its own manifest. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The peer names this package declares, in manifest order.
 * @returns the names; an unreadable manifest lists none.
 */
function peerNames(): string[] {
  try {
    // The manifest is this package's own file; the shape is the declaration it ships.
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { peerDependencies?: Record<string, string> };
    return Object.keys(manifest.peerDependencies ?? {});
  } catch {
    return [];
  }
}

/**
 * The version declared by the nearest `package.json` above a resolved file.
 *
 * Exported for the coverage suite: the walk's two failure arms (a malformed
 * manifest, and the filesystem root) are not reachable with real peers.
 * @param file - one resolved module file.
 * @returns the version, or undefined when no readable manifest declares one.
 */
export function versionAbove(file: string): string | undefined {
  let directory = dirname(file);
  for (;;) {
    try {
      // A peer's manifest is its declaration file; only the version string is read.
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { version?: unknown };
      return typeof manifest.version === "string" ? manifest.version : undefined;
    } catch {
      const parent = dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  }
}

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
export function resolvedPeerVersion(require: NodeJS.Require, name: string): string | undefined {
  try {
    return versionAbove(require.resolve(`${name}/package.json`));
  } catch {
    // Fall through to the entry file; not every package exports its manifest.
  }
  try {
    return versionAbove(require.resolve(name));
  } catch {
    return undefined;
  }
}

/**
 * The peer versions this process resolves.
 *
 * Deliberately uncached: a harness upgrade or a plugin-manager reload changes
 * the answer, and one doctor spawn costs one small resolve per peer.
 *
 * @returns a name → version map; empty when the manifest or the peers are
 *   unreadable.
 */
export function resolvedPeerVersions(): Record<string, string> {
  const require = createRequire(join(ROOT, "package.json"));
  const versions: Record<string, string> = {};
  for (const name of peerNames()) {
    const version = resolvedPeerVersion(require, name);
    if (version !== undefined) versions[name] = version;
  }
  return versions;
}

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
export function withHostPeerVersions(env: NodeJS.ProcessEnv, versions: Record<string, string> = resolvedPeerVersions()): NodeJS.ProcessEnv {
  return { ...env, [DOCTOR_PEERS_ENV]: JSON.stringify(versions) };
}
