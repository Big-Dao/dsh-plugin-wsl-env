/**
 * `ctx.fs` entrypoint — load as `dsh-plugin-wsl/fs` in a profile patch.
 *
 * This is a TypeScript source built to `lib/fs.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/fs
 */
export { WslFileSystem as default, WslFileSystem } from "./index.js";
