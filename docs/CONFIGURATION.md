# Configuration

## Profile patches

Store profile settings in `$DSH_HOME/profiles/<name>/cordis.patch.yml`. Use
[`examples/profile.cordis.patch.yml`](../examples/profile.cordis.patch.yml) as a
starting point. The bundled [`cordis.patch.yml`](../cordis.patch.yml) lists the
rows and values shipped by this plugin.

A profile layer can target a top-level row by `id`. Plugin rows at that level
include `fs-routing`, `directory-picker-wsl`, `subprocess-wsl`, `wsl-shell-env`,
`wsl-preflight`, `auto-preset`, and `preset-wsl`. The `wsl-shell` and `wsl-fs`
rows are nested inside `preset-wsl.config.plugins`; a profile entry targeting
either id directly is ignored with a `patch: entry <id> not found` warning.

A row's `config` is replaced as a whole. Include any non-default values from
the bundled row that you want to retain. This matters most for `preset-wsl`,
whose config contains the complete preset and its nested plugins.

In the tables below, **shipped** marks a value explicitly set in the bundled
row. Other values are schema defaults. An omitted key uses the schema default.

## Configure `wsl-shell` and `wsl-fs`

These rows are nested inside `preset-wsl`. Use the helper to change their
settings:

```bash
pnpm run preset -- --distro Ubuntu --session-sandbox false --out "$DSH_HOME/profiles/<name>/cordis.patch.yml"
```

Supported edits are `--distro`, `--session-sandbox`, `--sandbox`,
`--mask-windows-drive`, and `--agent-backend`. Without `--out`, the helper
prints the full `preset-wsl` block. Use `pnpm run preset -- --check <file>`
to detect profile layers that target nested rows directly; it prints the block
to use. The helper will not overwrite a file that has no `preset-wsl` row
unless you pass `--force`.

To edit the preset manually, replace the entire `preset-wsl` row. Its config is
not deep-merged: preserve `id`, `order`, and every item in `plugins`. Copy the
current block from `cordis.patch.yml` or from
`dsh --profile <name> --dump-config`, then change the nested values. Re-copy it
after a plugin upgrade that changes the preset.

### `wsl-shell`

| Key | Default / shipped value | Description |
|---|---|---|
| `distro` | `''` (shipped) | Empty or `auto` follows the request workdir's distro. `default` selects WSL's default distro; a name pins commands to that distro. |
| `shell` | `''` | Empty resolves the distro user's login shell. Set an absolute Linux path to pin a shell. |
| `loginShell` | `true` (shipped) | Use login semantics for POSIX shells. Non-POSIX shells use their own command form. |
| `agent` | `true` | Use the resident agent. If it is unavailable, commands use the one-shot `wsl.exe` path. Set `false` to always use that path. Cwd and sandbox refusals are returned directly. |
| `agentBackend` | `auto` (shipped) | `auto` selects the packaged static-musl binary at `agent/native/linux-<arch>/dsh-wsl-agent` or the `DSH_WSL_AGENT_NATIVE` override; otherwise it uses the shell agent. `native` fails if it cannot prepare; `shell` forces the shell agent. Applies to commands, confined writes, and shared reads. |
| `sessionSandbox` | `false`; shipped `true` | `true` runs the session in a persistent systemd user scope. Requires `agent: true`, systemd as PID 1 (`[boot] systemd=true` in `/etc/wsl.conf`), a user manager, `systemd-run`, and Linger (`loginctl enable-linger <user>`). `false` uses a per-command sandbox. `auto` uses the scope when available and otherwise keeps commands confined per command. The result reports `sessionScope: 'session'` or `'per-command'`. |
| `sandbox` | `true` | Confine commands with `bwrap`. A missing or unusable `bwrap` fails closed. `false` runs commands without confinement. |
| `interopVisibility` | Unset; effective default is `visible` | `visible`, `masked`, or `disabled`. When set, this takes precedence over `maskWindowsDrive`. See [Windows interop](#windows-interop). |
| `maskWindowsDrive` | `false` | For confined commands, mount an empty tmpfs over `/mnt`. See [Windows interop](#windows-interop). |
| `cwd` | `''` | Default workdir. Empty uses the distro user's home. |
| `timeoutMs` / `maxTimeoutMs` | `120000` / `600000` (shipped) | Default per-call timeout and the maximum timeout a call may request. |
| `wslPath` | `wsl.exe` | Path to `wsl.exe`. |
| `hostCwd` | Unset | Windows workdir for the `wsl.exe` process. Defaults to `%SystemRoot%` when available. |
| `forwardEnv` | `[]` | Additional host environment names to forward through `WSLENV`. See [Environment forwarding](#environment-forwarding). |

### `wsl-fs`

| Key | Default / shipped value | Description |
|---|---|---|
| `distro` | `''` (shipped) | Empty or `auto` follows the target path's distro. `default` selects WSL's default distro; a name pins the filesystem. |
| `restrictToDistro` | `true` (shipped) | With a pinned distro, refuse paths in another distro's share with `FS_OUTSIDE_DISTRO`. |
| `sandbox` | `true` | Check writes against the sandbox policy. Confined writes fail closed if `bwrap` is unavailable. |
| `sessionSandbox` | `false`; shipped `true` | Use the same session runtime as `wsl-shell`. `auto` falls back to a per-policy confined resident when the session runtime is unavailable. |
| `maskWindowsDrive` | `false` | Hide `/mnt` from confined mutations. Reads are unaffected. |
| `substrate` | `agent` (shipped) | File operations use the in-distro agent. The legacy `share` value is refused at startup. |
| `cwd` | `''` | Base directory for relative paths. Empty uses the distro user's home. |
| `watchMaxDepth` | `0` | Watch the full tree. A positive depth uses bounded polling and can miss changes below the bound until a change above it triggers the callback. |
| `wslPath` | `wsl.exe` | Path to `wsl.exe`. |
| `diffBasisMaxBytes` | `10485760` | UTF-8 byte limit per side of an overwrite diff. Larger files are written without a diff. |

### `fs-routing`

This top-level row serves root-level `ctx.fs` calls. It routes distro UNC paths
to the agent-backed filesystem and drive paths to the host filesystem. Its
distro settings are independent of `wsl-fs`.

| Key | Default / shipped value | Description |
|---|---|---|
| `distro` | `''` (shipped) | Empty or `auto` routes each UNC path to its named distro. `default` selects WSL's default distro; a name pins the route. |
| `wslPath` | `wsl.exe` (shipped) | Path to `wsl.exe`, used to resolve the default distro. |
| `sandbox` | `true` (shipped) | Check routed mutations against `ctx.sandboxPolicy`; fail closed if `bwrap` is unavailable. The row reports `sandboxMode: undefined` whether the fence is enabled or disabled. |
| `maskWindowsDrive` | `false` (shipped) | Hide `/mnt` from confined routed mutations. |
| `restrictToDistro` | `true` (shipped) | Refuse paths in another distro's share when `distro` is pinned. |
| `watchMaxDepth` | `0` (shipped) | Watch the full tree. A positive depth uses bounded polling. |
| `distroCwd` | `''` | Default distro workdir; empty uses the distro user's home. |
| `cwd` | `process.cwd()` | Working directory for the host filesystem backend. |
| `diffBasisMaxBytes` | `10485760` | Shared overwrite-diff limit for the host and routed backends. |

The root router is app-level, not session-owned, so it does not use
`sessionSandbox`.

### Picker and terminal rows

| Row | Key | Default / shipped value | Description |
|---|---|---|---|
| `directory-picker-wsl` | `preferredDistro` | `''` (shipped) | Distro shown first and used for the Home location. |
| | `includeHostHome` | `true` (shipped) | Include the Windows home directory. |
| | `maxEntries` | `1000` (shipped) | Maximum entries returned for one directory. |
| | `wslPath` | `wsl.exe` | Path to `wsl.exe`. |
| | `distroCacheMs` | `5000` | Cache lifetime for the distro list. |
| `subprocess-wsl` | `distro` | `''` (shipped) | Empty or `auto` follows the launch directory's distro. `default` selects WSL's default; a name pins the distro. |
| | `shell` | `''` | Shell to pin inside the distro. Empty lets `wsl.exe` select the login shell. |
| | `loginShell` | `true` | Login semantics for a pinned shell. |
| | `hostSessions` | `true` | A session opened on a Windows folder gets host PowerShell in that folder. WSL-folder sessions use the distro shell. Set `false` to use the composition-owned terminal for every session. |
| | `terminalIdleReclaim` | `true` | Reclaim idle distro terminals based on their marked processes. An unknown activity state pauses reclamation. |
| | `cwd` | `''` | Fallback launch directory when none is supplied. |
| | `wslPath` | `wsl.exe` | Path to `wsl.exe`. |
| | `hostCwd` | Unset | Windows workdir for the `wsl.exe` process. Defaults to `%SystemRoot%` when available. |
| | `forwardEnv` | `[]` | Additional host environment names to forward through `WSLENV`. |

### Other top-level rows

| Row | Key | Default | Description |
|---|---|---|---|
| `auto-preset` | `preset` | `wsl` | Preset to bind when a session workspace is inside a distro. An explicit operator selection is preserved. |
| | `attempts` | `6` | Number of attempts to bind the preset. |
| | `retryMs` | `150` | Delay between attempts, in milliseconds. |
| `wsl-preflight` | `distro` | `''` | Distro to check. Empty or `auto` follows the session workspace. |
| | `wslPath` | `wsl.exe` | Path to `wsl.exe`. |
| | `sandbox` | `true` | Run the session-start `bwrap` check. |
| | `sessionSandbox` | `true` | Also check systemd, the user manager, `systemd-run`, and Linger. Set false when the profile does not use a session runtime. |
| `wsl-shell-env` | `distro` | `''` | Distro used to populate the `DSH_WSL_*` environment facts. |
| | `portsRefreshMs` | `10000` | Listening-port snapshot interval, in milliseconds. |

The GUI file tree and previews use the bundled `workspace-files` row through
`fs-routing`; they do not use a separate WSL provider row. To change its
peer-defined limits, override `workspace-files` by id in the profile layer.

## Shared command settings

The shell row inherits output and process settings from
`@deepseek-ai/dsh-bash-local`:

| Key | Default | Description |
|---|---|---|
| `maxOutputBytes` | `64000` | Per-stream captured output limit. The agent enforces this limit inside the distro and marks truncated results. |
| `maxSpillBytes` | `67108864` | Per-stream spill-file limit on the one-shot path. |
| `graceMs` | `3000` | Grace period between SIGTERM and SIGKILL. |

With `agent: true`, captured output is limited inside the distro and no spill
file is written. `maxSpillBytes` and `graceMs` apply when `agent: false` or
when the resident agent is unavailable and execution uses one-shot `wsl.exe`.

## Environment forwarding

WSL imports a host environment variable only when its name is listed in
`WSLENV`. The providers forward `NO_COLOR`, `TERM`, `PAGER`, `GIT_PAGER`,
`LANG`, `LC_ALL`, and managed `DSH_*` names by default. `forwardEnv` adds names
to that list; `PATH` is never forwarded.

For `wsl-shell`, `forwardEnv` applies to the one-shot `wsl.exe` path. The
resident agent receives only the managed `DSH_*` environment, so custom names
in `forwardEnv` do not reach commands running through that agent. The
`subprocess-wsl` setting applies to its WSL launches.

## Distro selection

For command and terminal rows, an empty `distro` or `distro: auto` follows
the request's UNC workdir. When the request does not name a distro, WSL's
default distro is used. For `wsl-fs`, `auto` follows each target path. For
`fs-routing`, each UNC target selects its own distro.

`distro: default` always selects WSL's default distro. A distro name pins the
row to that distro. With `restrictToDistro: true`, a path in another distro's
share is refused with `FS_OUTSIDE_DISTRO`. The Windows drive mounted at
`/mnt/c` is inside the selected distro and is not rejected by this fence.

## Windows interop

`interopVisibility` controls access to Windows files and executables from
confined commands. If unset, `maskWindowsDrive: false` gives the `visible`
behavior.

| Value | Effect |
|---|---|
| `visible` | Leaves `/mnt` visible. Confined commands can read Windows files and launch Windows executables through WSL interop. |
| `masked` | Mounts an empty tmpfs over `/mnt` in confined profiles. Commands cannot access Windows files or launch executables from `/mnt`. |
| `disabled` | Applies the masked profile and prints the distro-level steps for disabling interop. It does not edit `wsl.conf`. |

`maskWindowsDrive: true` is equivalent to `interopVisibility: masked`.
When `interopVisibility` is set, it takes precedence over
`maskWindowsDrive`.

Masking narrows access; it does not close interop. WSL can still run a Windows
executable written into the workspace because `binfmt_misc` dispatches by file
content. Enforcement therefore remains `partial`, and results report
`windowsDrive: 'masked'`. To disable interop for the distro, add this section
to `/etc/wsl.conf`:

```ini
[interop]
enabled=false
```

Then run `wsl.exe --shutdown`. This distro-level change is required to close
interop.

To apply the masked profile to both nested rows:

```bash
pnpm run preset -- --sandbox true --mask-windows-drive true --out "$DSH_HOME/profiles/<name>/cordis.patch.yml"
```

The `visible` and `masked` behavior is covered by
`test/probe/sandbox.sh`. The distro-level disabled state requires a manual
check because it changes WSL configuration.

## Sandbox and preflight

`sandbox: true` is the default for `wsl-shell`, `wsl-fs`, and
`fs-routing`. Confined commands and mutations require a usable `bwrap` inside
the distro. If it is missing or unusable, commands fail with
`SANDBOX_UNAVAILABLE` and writes fail with `FS_IO_ERROR`; neither operation
falls back to an unconfined run. The error distinguishes a missing package from
a present but unusable `bwrap`.

Install the prerequisite with the bootstrap helper:

```bash
scripts/bootstrap.sh <distro> --install
```

Without `--install`, the helper performs a read-only check. On apt-based
distros, the direct install command is:

```bash
wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap
```

The `wsl-preflight` row runs these checks when a session opens. It also checks
the session-runtime prerequisites when `sessionSandbox: true`. The warning is
advisory: it does not install packages or change the providers' fail-closed
behavior. Set `sandbox: false` on this row or remove it to silence the
sandbox warning. Set `sessionSandbox: false` when the profile does not use a
session runtime.

Setting `sandbox: false` on `wsl-shell` or `wsl-fs` runs commands or writes
without confinement; their `sandboxMode` becomes `undefined`. The tool layer
reports that no sandbox is active. On `fs-routing`, the setting disables the
mutation fence; that row reports `sandboxMode: undefined` either way.

## Diagnose configuration and refusals

Use `dsh --profile <name> --dump-config` to inspect the composed profile
without booting it. The output shows whether a row override applied. Use
`scripts/bootstrap.sh <distro>` to inspect distro prerequisites.

| Symptom | Result | Action |
|---|---|---|
| Command sandbox unavailable | `SANDBOX_UNAVAILABLE`; message distinguishes missing or unusable `bwrap`. | Install `bubblewrap`, repair user namespaces, or set `sandbox: false` on `wsl-shell`. |
| Confined write unavailable | `FS_IO_ERROR` with the `bwrap` remedy. | Install or repair `bubblewrap`; to disable the fence, set `sandbox: false` on `wsl-fs` or `fs-routing`. |
| File operations fail while the distro is stopped | `FS_IO_ERROR`: distro substrate unavailable. | Start the distro. If the agent remains unavailable, restart the session. |
| Command cannot start in the selected distro | `WSL_E_*` code naming the distro. | Start that distro or change `distro`. Wider permissions do not resolve a stopped distro. |
| `wsl.exe` cannot start | Error names the executable and the row's `wslPath`. | Correct `wslPath` and confirm WSL is installed. |
| WSL hangs during a command | Command reaches its deadline without completion. | Retry once, then run `wsl.exe --shutdown` and reopen the session. |
| A watched path does not notify | `FS_IO_ERROR` from `watch`. | Watch a path inside the selected distro. |
| A path in another distro is refused | `FS_OUTSIDE_DISTRO`. | Use `distro: ''` or `auto` to follow the workspace, or open the session in the target distro. |

See [ARCHITECTURE.md — Error codes](ARCHITECTURE.md#error-codes) for the full
error reference and [LIMITATIONS.md](LIMITATIONS.md) for the design boundaries.
