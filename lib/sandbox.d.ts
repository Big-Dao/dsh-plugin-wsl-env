/**
 * The Linux-side confinement this plugin applies to commands that run inside a
 * distro.
 *
 * ## Why this is not `ctx.sandbox`
 *
 * DSH's local sandbox provider selects its runner chain by `process.platform`.
 * This harness process is Windows, so it selects the windows-acl runner — and
 * that runner's restricted, low-integrity token **cannot reach WSL at all**
 * (`wsl.exe` fails with `Wsl/E_ACCESSDENIED`). The confinement that governs a
 * distro command therefore has to be *built* on the host and *executed* inside
 * the distro, which is what this module produces: an argv whose program is
 * `bwrap`, handed to `wsl.exe --exec` like any other distro command.
 *
 * Consuming the seam is deliberately not part of this: `dsh-tool-bash` reads
 * `ctx.shell.sandboxMode` (the executor's capability fact) plus
 * `ctx.sandboxPolicy`, and never asks `ctx.sandbox` for anything. A WSL
 * executor can therefore own its confinement without shadowing the
 * composition-level provider that host sessions still need.
 *
 * ## Fidelity to the upstream Linux rung
 *
 * The profile arguments, the denial dialect and the runner-failure rules mirror
 * `@deepseek-ai/dsh-sandbox-local`'s `bwrap` rung, so a denial reads the same to
 * the tool layer whether the command ran on a Linux host or inside a distro.
 * The one deliberate difference is the core's `partial` enforcement: see
 * `lib/sandbox-core.js` for what it reports and why.
 *
 * The class itself lives in `lib/sandbox-core.js`, free of DSH peers — this
 * module is the shipped binding that hands it the peer's `SandboxUnavailableError`,
 * so `instanceof` consumers keep matching the class their composition knows.
 *
 * This is a TypeScript source built to `lib/sandbox.js`; edit THIS file and run
 * `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
 *
 * @module dsh-plugin-wsl/sandbox
 */
export { bwrapProfileArgs } from "./bwrap.js";
/**
 * The confinement over WSL: the probe-then-confine class bound to the peer's
 * failure type. See the core module for the probe policy and the profile.
 */
export declare const WslSandbox: new (config?: {
    wslPath?: string;
    maskWindowsDrive?: boolean;
} | undefined) => import("./sandbox-core.js").WslSandboxCoreInstance;
export default WslSandbox;
