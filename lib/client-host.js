/**
 * Root host half of `dsh-plugin-wsl-env`: a deliberate no-op plugin.
 *
 * The web client-modules roster only scans Loader rows whose name is an exact
 * package name (`exactPackageSpecifier` rejects subpaths), so the browser half
 * declared under `dsh.client` loads only when this package is mounted at its
 * bare name. The shell executor that used to own `.` cannot serve that role:
 * mounted at the composition root it would shadow the shipped host shell for
 * every session. The two roles therefore split —
 *
 *   - `.` (this module): a no-op host half, safe at the composition root; its
 *     only job is anchoring the bare-name row whose manifest the roster reads
 *     to serve `./client`;
 *   - `./shell` (`lib/shell.js`): the session shell executor, mounted inside
 *     the WSL agent preset's isolate realm.
 *
 * Compositions that still mount the bare name get the client half (the doctor
 * composer button) and nothing else; the executor keeps its behavior through
 * the explicit subpath. Before 0.20.0 `.` resolved to the executor itself —
 * a profile that relied on that shape must switch to `dsh-plugin-wsl-env/shell`.
 *
 * This is a TypeScript source built to `lib/client-host.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env
 */
/** A no-op Cordis plugin: no config, no services, no effects. */
export function apply() { }
