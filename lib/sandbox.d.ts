export { bwrapProfileArgs } from "./bwrap.js";
/**
 * The confinement over WSL: the probe-then-confine class bound to the peer's
 * failure type. See the core module for the probe policy and the profile.
 */
export const WslSandbox: new (config?: {
    wslPath?: string;
    maskWindowsDrive?: boolean;
} | undefined) => WslSandboxCoreInstance;
export default WslSandbox;
