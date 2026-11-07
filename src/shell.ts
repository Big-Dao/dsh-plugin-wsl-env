/**
 * `ctx.shell` executor for the WSL agent preset — load as
 * `dsh-plugin-wsl-env/shell` (before 0.20.0 the package root resolved here;
 * the root is now the no-op web client host half, see `src/client-host.ts`).
 *
 * This is a TypeScript source built to `lib/shell.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/shell
 */
export { WslShellExecutor as default, WslShellExecutor } from "./index.js";
