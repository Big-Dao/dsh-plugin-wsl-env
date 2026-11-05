# API surface

The published API is the generated `lib/*.d.ts` next to each compiled module
(`pnpm run build` keeps them byte-fresh; `lint:build` fails on drift). The
`exports` map in `package.json` is the authority on what a consumer can import;
this page is the quick tour.

| Subpath | Exports | Role |
|---|---|---|
| `.` | `WslShellExecutor` | the model-facing shell executor (`ctx.shell`) |
| `./fs` | `WslFileSystem` | the filesystem provider over the distro (`ctx.fs`) |
| `./index` | `WslShellExecutor`, `WslFileSystem`, `doctorReport`, `effectiveMaskWindowsDrive`, … | the composition root's full named surface — the integration API (`doctorReport` for tooling that wants the doctor's versioned report) |
| `./fs-routing` | `WslRoutingFileSystem` | the root-plane coordinate router |
| `./wsl` | `defaultShell`, `listDistros`, `shellArgs`, `wslTerminalArgv`, … | the `wsl.exe` interop primitives |
| `./agent` | `WslAgent` | the resident-agent transport |
| `./subprocess` | `WslSubprocessRuntime` | the terminal/subprocess runtime |
| `./preflight` | the `wsl-preflight` row | session-start advisories |
| `./paths` | `uncToPosix`, `toLinuxPath`, `toWorldPath`, … | the coordinate mappers |
| `./picker` | `WslDirectoryPicker` | the distro-aware directory picker |
| `./auto-preset` | the `auto-preset` row | first-run profile bootstrap |
| `./shell-env` | the `wsl-shell-env` row | the `DSH_WSL_*` facts registry |

Stability: tool names and error codes are API (docs/MIGRATION.md); the
runtime rows' config keys are documented in docs/CONFIGURATION.md.
