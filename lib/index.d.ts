/** Public exports for the WSL service providers and compatibility helpers. */
export { WslShellExecutor } from "./wsl-shell.js";
export type { ShellExecSpec, ShellExecution, SpawnSeamExecutor } from "./wsl-shell.js";
export { WslFileSystem } from "./wsl-filesystem.js";
export { doctorReport } from "./doctor-report.js";
export { effectiveMaskWindowsDrive } from "./provider-common.js";
