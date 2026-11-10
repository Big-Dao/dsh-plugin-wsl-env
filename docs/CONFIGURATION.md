# Configuration

*The Chinese version ([CONFIGURATION.zh](CONFIGURATION.zh.md)) is authoritative; this page is its English translation.*

## Profile patches

Store profile settings in `$DSH_HOME/profiles/<name>/cordis.patch.yml`. Use
[`examples/profile.cordis.patch.yml`](../examples/profile.cordis.patch.yml) as a
starting point. The bundled [`cordis.patch.yml`](../cordis.patch.yml) lists the
rows and values shipped by this plugin.

A profile layer can target a top-level row by `id`. Plugin rows at that level
include `fs-routing`, `directory-picker-wsl`, `subprocess-wsl`, `wsl-shell-env`,
`wsl-preflight`, `auto-preset`, `wsl-cwd-prompt`, `wsl-cwd-prompt-tool`,
`wsl-update-check`, `wsl-doctor-command`, `wsl-status`, `wsl-env-client-host`, and
`preset-wsl`. The `wsl-shell`, `wsl-fs` and `wsl-doctor-tool` rows are nested
inside `preset-wsl.config.plugins`; a profile entry targeting those ids directly
is ignored with a `patch: entry <id> not found` warning.

A root-level `- id: wsl-shell` / `wsl-fs` entry patches a top-level row that
does not exist in the shipped composition, so it is ignored with a warning.
An entry indented under `- insert:` is a different thing: it adds a real
top-level row, which is how a probe profile can mount these providers without
the preset. The doctor's `config.preset-trap` check only reports the former.

A row's `config` is replaced as a whole. Include any non-default values from
the bundled row that you want to retain. This matters most for `preset-wsl`,
whose config contains the complete preset and its nested plugins.

In the tables below, **shipped** marks a value explicitly set in the bundled
row. Other values are schema defaults. An omitted key uses the schema default.

## Configure `wsl-shell` and `wsl-fs`

These rows are nested inside `preset-wsl`. Use the helper to change their
settings:

```bash
pnpm run preset --distro Ubuntu --session-sandbox false
```

Supported edits are `--distro`, `--session-sandbox`, `--sandbox`,
`--mask-windows-drive`, and `--agent-backend`. Without `--out`, the helper
prints the full `preset-wsl` block to merge into the profile manually. Use
`pnpm run preset --check <file>` to detect profile layers that target nested
rows directly; on detecting them it prints the block to use. `--out` replaces
the entire destination file, including other overrides, even when it already
contains a `preset-wsl` row. It refuses to replace an existing file without
that row unless you pass `--force`. Prefer manual merging for existing profiles.

To edit the preset manually, replace the entire `preset-wsl` row. Its config is
not deep-merged: preserve `id`, `order`, and every item in `plugins`. Copy the
current block from `cordis.patch.yml` or from
`dsh --profile <name> --dump-config` (CLI distribution — the desktop app has no
`dsh` command), then change the nested values. Re-copy it
after a plugin upgrade that changes the preset.

### `wsl-shell`

| Key | Default / shipped value | Description |
|---|---|---|
| `distro` | `''` (shipped) | Empty or `auto` follows the request workdir's distro. `default` selects WSL's default distro; a name pins commands to that distro. |
| `shell` | `''` | Empty resolves the distro user's login shell (`getent passwd`, then `$SHELL`). When both probes fail the command errors out instead of running under another shell — set an absolute Linux path here to pin one. |
| `loginShell` | `true` (shipped) | Use login semantics for POSIX shells. Non-POSIX shells use their own command form. |
| `agent` | `true` | Use the resident agent. If it is unavailable, commands use the one-shot `wsl.exe` path. Set `false` to always use that path. Cwd and sandbox refusals are returned directly. |
| `agentBackend` | `auto` (shipped) | `auto` selects the packaged static-musl binary at `agent/native/linux-<arch>/dsh-wsl-agent` or the `DSH_WSL_AGENT_NATIVE` override; otherwise it uses the shell agent. `native` fails if it cannot prepare; `shell` forces the shell agent. Applies to commands, confined writes, and shared reads. |
| `sessionSandbox` | `false`; shipped `true` | `true` runs the session in a persistent systemd user scope. Requires `agent: true`, systemd as PID 1 (`[boot] systemd=true` in `/etc/wsl.conf`), a user manager, `systemd-run`, and Linger (`loginctl enable-linger <user>`). `false` uses a per-command sandbox. `auto` uses the scope when available and otherwise keeps commands confined per command. The result reports `sessionScope: 'session'` or `'per-command'`. |
| `sandbox` | `true` | Confine commands with `bwrap`. A missing or unusable `bwrap` fails closed. `false` runs commands without confinement. |
| `interopVisibility` | Unset; effective default is `visible` | `visible`, `masked`, or `disabled`. When set, this takes precedence over `maskWindowsDrive`. See [Windows interop](#windows-interop). |
| `maskWindowsDrive` | `false` | For confined commands, mount an empty tmpfs over `/mnt`. See [Windows interop](#windows-interop). |
| `writableRoots` | `[]` | Extra distro directories granted read-write under `workspace-write` (`~` allowed), for toolchain caches or a linked worktree's shared Git directory. Each entry must be an existing physical directory; entries already inside the workspace, `/tmp` or `/dev/shm`, or nested inside another grant, are ignored. Put the same list on `wsl-fs`. See [Toolchain caches](#toolchain-caches-and-extra-writable-roots). |
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
| `writableRoots` | `[]` | Same key and rules as on `wsl-shell`. Confined writes and commands must see one mount table, so configure the same list on both rows. See [Toolchain caches](#toolchain-caches-and-extra-writable-roots). |
| `substrate` | `agent` (shipped) | File operations use the in-distro agent. The legacy `share` value is refused at startup. |
| `cwd` | `''` | Base directory for relative paths. Empty uses the distro user's home. |
| `watchMaxDepth` | `0` | Watch the full tree. A positive depth uses bounded polling and can miss changes below the bound until a change above it triggers the callback. |
| `wslPath` | `wsl.exe` | Path to `wsl.exe`. |
| `diffBasisMaxBytes` | `10485760` | UTF-8 byte limit per side of an overwrite diff. Larger files are written without a diff. |

### Toolchain caches and extra writable roots

The default `workspace-write` grants only the session workspace and the temp
areas (`/tmp`, the distro's real `/tmp` under the session runtime). npm, pnpm,
cargo and friends keep their package caches under `$HOME`, so installing a
dependency that is not already cached fails with `EROFS`. Configure the same
list on the **nested** `wsl-shell` and `wsl-fs` rows; `pnpm run preset
--writable-roots '~/.npm,~/.cache'` writes both into the printed `preset-wsl`
block, or edit the block by hand:

```yaml
              - id: wsl-shell
                config:
                  writableRoots: ['~/.npm', '~/.cache', '~/.local/share/pnpm']
              - id: wsl-fs
                config:
                  writableRoots: ['~/.npm', '~/.cache', '~/.local/share/pnpm']
```

Rules:

- `~` and `~/...` expand against the distro user's home; every other entry must
  be an absolute Linux path.
- The directory must already exist and must be a physical directory (symlinks
  are refused). Create it with `mkdir -p` first, or let one unconfined command
  create it.
- Entries already inside the workspace, `/tmp` or `/dev/shm`, or nested inside
  another grant, are ignored: they are already writable, and binding them would
  only add a symlink-redirection risk.
- Keep both rows equal; otherwise commands and confined writes can see
  different mount tables, and the session runtime keys diverge.
- It applies only to `workspace-write`. `read-only` ignores it, and
  `danger-full-access` does not go through the sandbox at all.
- Security boundary: executable content in a granted directory (for example a
  package cache's binaries) can be used by a later build or command. This is an
  explicit narrowing of the sandbox, not a way to turn it off; `enforcement`
  stays `partial`.
- The shared `sandboxPolicy.additionalWritableRoots` is honored too (same-distro
  UNC or Linux spelling), but it applies to the whole profile. When the same
  profile also serves Windows sessions, prefer the plugin key above.

### `fs-routing`

This top-level row serves root-level `ctx.fs` calls. It routes distro UNC paths
to the agent-backed filesystem and drive paths to the host filesystem. Its
distro settings are independent of `wsl-fs`.
The Loader validates the host and distro settings before mounting this row;
values rejected by the schema prevent the router from starting. A `null`
field value uses its schema default.

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
| | `includeHostHome` | `true` (shipped) | Offer the Windows path branch; its walk starts at the drive roots. |
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
| | `windowsWorkspaces` | `[]` | Distro directories opened for Windows access (UNC paths). Sessions under them keep the host preset; the add-workspace prompt writes here, and Settings can change it back. |
| `wsl-status` | `cacheMs` | `15000` | How long one distro's verdict stays fresh in memory, in milliseconds (the last result is persisted separately). |
| | `timeoutMs` | `90000` | Deadline for one check or repair run, in milliseconds. |
| | `wslPath` | `wsl.exe` | `wsl.exe` used to list the distros. |
| `wsl-preflight` | `distro` | `''` | Distro to check. Empty or `auto` follows the session workspace. |
| | `wslPath` | `wsl.exe` | Path to `wsl.exe`. |
| | `sandbox` | `true` | Run the session-start `bwrap` check. |
| | `sessionSandbox` | `true` | Also check systemd, the user manager, `systemd-run`, and Linger. Set false when the profile does not use a session runtime. |
| | `startup` | `true` | Also run the same checks once at plugin load — install + restart — against the pinned or WSL-default distro, so the verdict is in the log before any session opens. |
| `wsl-shell-env` | `distro` | `''` | Distro used to populate the `DSH_WSL_*` environment facts. |
| | `portsRefreshMs` | `10000` | Listening-port snapshot interval, in milliseconds. |
| `wsl-cwd-prompt` | `enabled` | `true` (shipped) | Rewrite the runtime context's working-directory entry to the distro's POSIX form. |
| `wsl-update-check` | `enabled` | `true` | Whether the plugin checks the app's plugin manager for a newer stable release. The result is served as `DSH_WSL_PLUGIN_UPDATE`; the check never installs. |
| | `intervalMs` | `86400000` | Check interval, in milliseconds (first check 2–10 minutes after startup); floored at one minute. |

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

### zsh/fnm recipe for model-run commands

Commands run as `<shell> -lc`, so `~/.zshrc` is never read — see
[LIMITATIONS](LIMITATIONS.md#shell-startup-semantics-wsl-shell) for why. Put
fnm's hook in `~/.zprofile` instead, with a fallback for the sandbox, where
`/run` is read-only and fnm cannot create its multishell symlink directory:

```zsh
# ~/.zprofile — fnm for non-interactive login shells (mirrors the ~/.zshrc hook)
path=("$HOME/.local/share/fnm" $path)  # the fnm binary itself
_fnm_env="$(command -v fnm &>/dev/null && fnm env --shell zsh 2>/dev/null)" && eval "$_fnm_env"
if [[ -z "${FNM_MULTISHELL_PATH:-}" || ! -e "${FNM_MULTISHELL_PATH}/bin/node" ]]; then
  path=("$HOME/.local/share/fnm/aliases/default/bin" $path)  # sandbox fallback
fi
unset _fnm_env
```

Interactive terminals keep the hook in `~/.zshrc` and are unaffected; the
`aliases/default` fallback only takes over where the multishell link cannot
exist.

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

`interopVisibility` controls whether `/mnt` is masked for confined commands;
it does not itself disable Windows interop. If unset, `maskWindowsDrive: false`
gives the `visible` behavior.

| Value | Effect |
|---|---|
| `visible` | Leaves `/mnt` visible. Confined commands can read Windows files and launch Windows executables through WSL interop. |
| `masked` | Mounts an empty tmpfs over `/mnt` in confined profiles. Commands cannot access paths under `/mnt`; other mounts and unrestricted file reads are not covered. |
| `disabled` | Applies the same `/mnt` mask as `masked`; it does not disable interop or edit `wsl.conf`. Configure the distro separately as described below. |

`maskWindowsDrive: true` is equivalent to `interopVisibility: masked`.
When `interopVisibility` is set, it takes precedence over
`maskWindowsDrive`.

### Three scenarios across four surfaces

What a setting changes depends on which surface acts. Confined commands run
in the `wsl-shell` sandbox; confined writes are checked by the `wsl-fs`
write sandbox; unrestricted file reads go through the shared read agent and
are not sandbox-governed; a Windows-side host operation is anything that
ends up executing on Windows.

| Surface | `visible` (default) | `masked` | distro-level `enabled=false` |
|---|---|---|---|
| Confined command (`wsl-shell`) | reads Windows files and launches Windows executables under `/mnt` | `/mnt` is an empty tmpfs in the profile: path operations under it fail | interop is refused by the distro itself; `/mnt` visibility still follows the mask above |
| Confined write (`wsl-fs`) | the write policy checks the target; `/mnt` visibility plays no role | the same mask applies to the write profile | unchanged — the write boundary was never interop-dependent |
| Unrestricted read (shared read agent) | reads `/mnt` freely | **not covered**: the mask lives in confined profiles only, the read agent still sees `/mnt` | **not governed by the plugin** |
| Windows-side host operation | reachable through `/mnt` | **still reachable**: `binfmt_misc` dispatches by file content, so a Windows executable copied into the workspace runs anyway (`enforcement: partial`) | the only real closure — and it is a manual `wsl.conf` step |

Masking affects real workflows on purpose: a script living under a Windows
path (a checkout under `/mnt/c`, tools on the Windows `PATH`) can no longer
be read or run by confined commands — move it into the distro or grant the
visible stance. Masking never deletes anything: the tmpfs shadows the view
inside one confined profile; the files on `/mnt/c` are untouched.

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
pnpm run preset --sandbox true --mask-windows-drive true
```

Merge the printed block into the profile. The `visible` and `masked` behavior
is covered by `test/probe/interop-shell.sh` for both resident and one-shot
commands. The distro-level disabled state requires a manual check because it
changes WSL configuration.

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

The `wsl-preflight` row runs these checks when a session opens, and — with
`startup: true`, the default — once at plugin load against the pinned or
WSL-default distro, so an install plus restart already carries the verdict in
the log; a session on that distro then repeats only the runtime-context entry.
It also checks
the session-runtime prerequisites when `sessionSandbox: true`. The warning is
advisory: it does not install packages or change the providers' fail-closed
behavior. Set `sandbox: false` on this row or remove it to silence the
preflight warning. Set `sessionSandbox: false` when the profile does not use a
session runtime.

Setting `sandbox: false` on `wsl-shell` or `wsl-fs` runs commands or writes
without confinement; their `sandboxMode` becomes `undefined`. The tool layer
reports that no sandbox is active. On `fs-routing`, the setting disables the
mutation fence; that row reports `sandboxMode: undefined` either way. When
every surface opts out — `sandbox: false` on all three rows *and*
`sessionSandbox: false` — the doctor still reports it, as a **warning** that
names the unconfined posture and skips the fence smoke; the opt-out never
blocks the verdict.

### Message language

The plugin's refusal and remedy messages (the `sessionSandbox` preflight
verdicts, the `bwrap` install and repair hints, and the distro/workdir
command errors) follow the harness app's Language setting: the preference is
read from the host `locale` entry's `preference` field through the host
settings service, and a language switch takes effect without a restart.
Chinese (`zh`, including `zh-CN` and `zh-Hans` tags) and English ship; every
other language renders English. A profile without the settings service, or
one whose user never picked a language, falls back to the process's ICU
default locale — the OS UI language in the desktop app — so a zh-CN Windows
with a provisional-Chinese UI still renders Chinese; an explicit Settings
choice always wins over that fallback. Commands, config keys and file paths
inside a message are never translated. Two message groups stay English by
design: the `FS_*` refusal texts in `fs-decisions` and the fsio replica (the
tool layer matches on those strings byte-for-byte). The standalone
`scripts/doctor.mjs` carries its own catalogs: its fixed skeleton renders in
the host language — detected from the Windows locale, overridable with
`--locale <tag>` or `DSH_WSL_DOCTOR_LOCALE` — while per-check titles, details
and remedies stay English (remedies carry copy-paste commands), and `--json`
stays language-independent.

## Diagnose configuration and refusals

In a session the model can run the diagnosis itself: the `wsl_doctor` tool
(mounted inside `preset-wsl`) calls the doctor in-process and returns the
verdict as an itemized listing — every check with an explicit status marker,
grouped by distro, the copy-paste remedy under every failure — the user just
asks for a diagnosis. The tool is interactive by design: `depth: "quick"` (the
default) runs the prerequisites only (~10 s in one distro: host facts, the
session sandbox quartet, bubblewrap — no smokes, no registry query, no port
survey) and is the right first call; `section` narrows a follow-up to one area
(`host`, `sandbox`, `session`, `conf`, `net`, `agent`); `depth: "full"` is
the complete scan and answers for everything. The `/wsl-doctor` command (the
`wsl-doctor-command` row, registered when the deployment has a commands
registry) runs the same diagnosis host-side — grammar
`[quick|full|<section>] [--distro <name>]` — and renders the same digest in
the UI, detached from model history. The CLI mirrors the same
scoping: `--quick` and `--sections <csv>` bound what a run probes, and a
scoped `--json` report carries its `scope` so a verdict always names the
scope it answers for (`--fix` still requires a full run).
`DSH_WSL_DOCTOR` additionally carries a ready-to-run command that executes
the doctor script from inside the distro (the app's own runtime as Node,
through interop) — run it as `sh -c "$DSH_WSL_DOCTOR --json"`. And
`pnpm run doctor` is the one-command environment check: Windows/WSL versions,
the per-distro WSL mode, `.wslconfig` and `/etc/wsl.conf` cross-checks, the
disk, the clock, DNS, the distro and its shell, bubblewrap, systemd/Linger,
the peer floor, a fresh agent handshake, stale session scopes, the known
profile-patch and deprecated-key traps — each failure with a copyable remedy.
The run ends in a verdict (`ready` or `blocked`) computed under the effective
configuration: `--json` is the machine contract (schemaVersion 2), `--fix`
re-verifies what it fixed (the plugin-owned stale-scope sweep and agent-cache
purge are automatic; packages need `--fix --install` and an explicit
confirmation; `--fix-owned` restricts a run to the plugin-owned two), `--all`
checks every installed distro, `--bundle
<path>` writes the attachable diagnostic file (`--redact` strips the paths),
and `--locale <tag>` (or `DSH_WSL_DOCTOR_LOCALE`) selects the skeleton
language without re-probing. `--yes` skips the confirmation prompt (not the
confirmation gate itself), and `--read-only` refuses to run together with
`--fix` or `--install`.
See [DIAGNOSTICS.md](DIAGNOSTICS.md) for the verdict contract and the
error-code map. With the CLI distribution, `dsh --profile <name> --dump-config` inspects
the composed profile without booting it and shows whether a row override
applied; the desktop app has no `dsh` command, so read `cordis.patch.yml` and
the Plugins page there.
The sidebar's **WSL environment** panel renders the same quick digest over
`GET /api/wsl-env/status` and posts the full-run action to the same route: a
doctor run with `--fix-owned`, which sweeps stale session scopes and purges a
broken agent cache, then re-verifies both. Each row states when the check ran, its source (manual or background) and its
result structure (per-status totals and per-section tallies). The last result
per distro is stored at `$DSH_HOME/cache/dsh-plugin-wsl-env/status.json`
(`~/.dsh/...` when the host names no home), so a page reload or app restart
still shows it. On load, a stored result for a distro that is currently
running is re-checked in the background; a failed background run overwrites
the stored result. Nothing is labeled expired — delete the file to reset the
panel's history. The label follows the report: **修复** when
such a repairable finding is present, **完整检查** otherwise; every other
warning keeps its manual remedy. It never installs packages or rewrites
Windows-owned or user configuration.
Use `scripts/bootstrap.sh <distro>` to inspect distro prerequisites.

| Symptom | Result | Action |
|---|---|---|
| Command sandbox unavailable | `SANDBOX_UNAVAILABLE`; message distinguishes missing or unusable `bwrap`. | Install `bubblewrap`, repair user namespaces, or set `sandbox: false` on `wsl-shell`. |
| Confined write unavailable | `FS_IO_ERROR` with the `bwrap` remedy. | Install or repair `bubblewrap`; to disable the fence, set `sandbox: false` on `wsl-fs` or `fs-routing`. |
| File operations fail while the distro is stopped | `FS_IO_ERROR`: distro substrate unavailable. | Start the distro. If the agent remains unavailable, restart the session. |
| Command cannot start in the selected distro | `WSL_E_*` code naming the distro. | Start that distro or change `distro`. Wider permissions do not resolve a stopped distro. |
| `wsl.exe` cannot start | Error names the executable and the row's `wslPath`. | Correct `wslPath` and confirm WSL is installed. |
| WSL hangs during a command | Command reaches its deadline without completion. | Retry once, then run `wsl.exe --shutdown` and reopen the session. |
| A watched change does not notify | Polling can miss changes that preserve the observed metadata; no error is guaranteed. | Check the watcher limits in [LIMITATIONS.md](LIMITATIONS.md). |
| A path in another distro is refused | `FS_OUTSIDE_DISTRO`. | Use `distro: ''` or `auto` to follow the workspace, or open the session in the target distro. |

See [ARCHITECTURE.md — Error codes](ARCHITECTURE.md#error-codes) for the full
error reference and [LIMITATIONS.md](LIMITATIONS.md) for the design boundaries.
