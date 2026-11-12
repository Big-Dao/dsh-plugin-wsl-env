# API surface

*The Chinese version ([API.zh.md](API.zh.md)) is authoritative; this page is its English translation.*

The published API is the generated `lib/*.d.ts` next to each compiled module
(`pnpm run build` keeps them byte-fresh; `lint:build` fails on drift). The
`exports` map in `package.json` is the authority on what a consumer can import;
this page is the quick tour.

| Subpath | Exports | Role |
|---|---|---|
| `.` | — | the no-op root host half: a deliberate no-op plugin mounted at the bare package name, anchoring the browser client below (before 0.21.0 this resolved to the executor itself — see `./shell`) |
| `./shell` | `WslShellExecutor` | the model-facing shell executor (`ctx.shell`), mounted inside the WSL preset's isolate realm |
| `./client` | — (no importable surface) | the browser half the harness's web client loader serves for the bare-name row: the sidebar status panel and the access-mode prompt |
| `./fs` | `WslFileSystem` | the filesystem provider over the distro (`ctx.fs`) |
| `./index` | `WslShellExecutor`, `WslFileSystem`, `doctorReport`, `effectiveMaskWindowsDrive`, … | the composition root's full named surface — the integration API (`doctorReport` for tooling that wants the doctor's versioned report) |
| `./fs-routing` | `WslRoutingFileSystem` | the root-plane coordinate router |
| `./wsl` | `defaultShell`, `listDistros`, `shellArgs`, `wslTerminalArgv`, … | the `wsl.exe` interop primitives |
| `./agent` | `WslAgent` | the resident-agent transport |
| `./subprocess` | `WslSubprocessRuntime` | the terminal/subprocess runtime |
| `./preflight` | the `wsl-preflight` row | session-start advisories (and once at plugin load with `startup: true`) |
| `./cwd-prompt` | the `wsl-cwd-prompt` row | rewrites the runtime context's working directory to the distro's POSIX form |
| `./cwd-prompt-tool` | the `wsl-cwd-prompt-tool` row | serves the model's read/`cd` tool with distro-POSIX `cwd` output |
| `./file-reference-wsl` | `traversalArgv`, `parseTraversalListing`, `FileReferenceTraversal`, … | the distro-side traversal strategy for `@` completion (pure library — built and tested, not yet wired to a row; see ARCHITECTURE) |
| `./wsl-doctor-tool` | the `wsl-doctor-tool` row | the `wsl_doctor` model tool: in-process diagnosis with scoping (`depth`, `section`) |
| `./wsl-doctor-command` | the `wsl-doctor-command` row | the `/wsl-doctor` UI command: spawns the standalone doctor CLI, renders detached from model history |
| `./status` | the `wsl-status` row | the sidebar panel's route over `/api`: installed distros, one distro's quick doctor, and the `--fix-owned` full run (repair when repairable, full check otherwise); the last result persists across reloads and running distros' stored results refresh in the background |
| `./paths` | `uncToPosix`, `toLinuxPath`, `toWorldPath`, … | the coordinate mappers |
| `./picker` | `WslDirectoryPicker` | the distro-aware directory picker |
| `./auto-preset` | the `auto-preset` row | first-run profile bootstrap |
| `./shell-env` | the `wsl-shell-env` row | the `DSH_WSL_*` facts registry |
| `./update-check` | the `wsl-update-check` row | the once-a-day update notice (fact store + host-delegated check) |

The `./<name>/locale/*.json` subpaths carry the Plugins-page display metadata
and the runtime message catalogs; `./package.json` re-exports the manifest.

Stability: tool names and error codes are API (docs/MIGRATION.md); the
runtime rows' config keys are documented in docs/CONFIGURATION.md.
