/**
 * `ctx.shell` entrypoint — load as `dsh-plugin-wsl` in a profile patch.
 *
 * This is a TypeScript source built to `lib/shell.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/shell
 */
export { WslShellExecutor as default, WslShellExecutor } from "./index.js";
