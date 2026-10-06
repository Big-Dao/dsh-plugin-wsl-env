# Configuration

Every value lives in a profile row, and a row is overridden by id in your own
profile layer: `$DSH_HOME/profiles/<name>/cordis.patch.yml`. Start from
[`examples/profile.cordis.patch.yml`](../examples/profile.cordis.patch.yml), and keep
[`cordis.patch.yml`](../cordis.patch.yml) open beside it — that file is the commented
reference for every value the plugin ships.

Which rows a patch can reach depends on where they sit. `fs-routing`,
`workspace-files-wsl`, `directory-picker-wsl`, `subprocess-wsl`, `wsl-shell-env`
and `preset-wsl` are top-level rows, so `- id: <row>` in your layer patches them.
`wsl-shell` and `wsl-fs` are not top-level: they are plugins of the `wsl` agent
preset, nested inside the `preset-wsl` row's `config.plugins`. A patch that
targets them by id matches nothing — the loader logs `patch: entry "wsl-shell"
not found` (a warning, not an error), the profile boots anyway, and the value you
wrote is not in force. See
[Overriding the rows inside `preset-wsl`](#overriding-the-rows-inside-preset-wsl).

In the table below, *(shipped)* marks the values set by `cordis.patch.yml`. The rest
are schema defaults, listed because they are the ones worth knowing. `wsl-shell-env`
has its own table at the end of this page.

| Row | Key | Default | Meaning |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` *(shipped)* | distro name; empty means WSL's default distro |
| | `shell` | `''` | pin a shell inside the distro; empty means the user's login shell |
| | `loginShell` | `true` *(shipped)* | use `<shell> -lc`, which sources your profile, instead of a bare `-c`. Applies only to the POSIX family; a non-POSIX shell (fish, csh) still gets a bare `-c` |
| | `agent` | `true` | run commands over the resident in-distro agent (one long-lived process; in-distro timeout); the one-shot `wsl.exe` path is fallen back to only when the agent is out of service. Anything else — a cwd refusal, a sandbox refusal — is the command's own verdict and is raised, not retried on the other path |
| | `sandbox` | `true` | confine commands with `bubblewrap`; `false` disables the sandbox. Needs a usable `bwrap` inside the distro and fails closed without one (`SANDBOX_UNAVAILABLE`, never an unconfined run) — see [Turning the sandbox off](#turning-the-sandbox-off) |
| | `maskWindowsDrive` | `false` | shadow `/mnt` with an empty tmpfs in every confined profile: the Windows drive's files cannot be read or exfiltrated and its executables cannot be launched through interop — the hole that lets a "sandboxed" command reach your full Windows token. A narrowing, not a closure (a command can still write an executable into the workspace and run it — binfmt dispatches on content, not location), so enforcement stays `partial` and the result's sandbox fact reports `windowsDrive: "masked"`. The complete closure is distro-level: `[interop] enabled=false` in `wsl.conf` |
| | `cwd` | `''` | default working directory; empty means the distro user's home |
| | `timeoutMs` / `maxTimeoutMs` | `120000` / `600000` *(shipped)* | per-call time limit, and the ceiling a call may ask for |
| `wsl-fs` | `distro` | `''` *(shipped)* | as above |
| | `restrictToDistro` | `true` *(shipped)* | refuse a path in **another distro**'s share. `/mnt/c` is a directory *inside* the pinned distro, so it is not affected. The refusal carries `FS_OUTSIDE_DISTRO`; that is not a sandbox decision, so the file tools do not offer a wider permission for it. Set `false` to allow another distro's share |
| | `sandbox` | `true` | check `writeText` and `editText` against the policy. Needs a usable `bwrap` in the distro too, and fails closed the same way: a distro without one refuses confined mutations (`FS_IO_ERROR`, with the install guidance) rather than downgrading them |
| | `maskWindowsDrive` | `false` | as on `wsl-shell`: confined fs mutations publish through a resident whose profile shadows `/mnt` (same honest limits) |
| | `substrate` | `agent` *(shipped)* | which I/O substrate serves the file tools. Only the resident in-distro agent (`lib/fs-substrate.js`) exists: reads, writes and identities run on ext4 — native symlinks, native mode bits, and the mutation guard survives to the write's atomic publication, kernel-enforced by the confined resident when the policy is confined. The former `share` opt-out (the Windows-side host stack over the 9p share) is refused at boot; delete the line. The comment shipped beside this key in `cordis.patch.yml` still calls `share` the opt-out — that comment is out of date, and the boot refusal is what runs |
| | `cwd` | `''` | base directory for relative paths; empty means the distro user's home |
| | `watchMaxDepth` | `0` | how deep the in-distro watch scan walks; `0` walks the whole tree. Bound it (e.g. `4`) when the watched tree holds a `node_modules` — a change below the bound is seen only when another change above it fires the same callback |
| `fs-routing` | `distro` | `''` *(shipped)* | which distro the root-plane filesystem routes to; empty resolves WSL's default. **A row of its own**, with its own copy of the distro knobs — changing `wsl-fs` does not change this one, nor the other way round |
| | `wslPath` | `wsl.exe` *(shipped)* | path to `wsl.exe`; used here only to resolve the default distro |
| | `sandbox` | `true` *(shipped)* | fence routed mutations by `ctx.sandboxPolicy`; same `bwrap` requirement and fail-closed refusal as `wsl-fs`. The routing row reports no `sandboxMode` — `undefined` whether the fence is on or off |
| | `maskWindowsDrive` | `false` *(shipped)* | as on `wsl-shell`, for routed mutations |
| | `restrictToDistro` | `true` *(shipped)* | refuse a path in another distro's share (`FS_OUTSIDE_DISTRO`) |
| | `watchMaxDepth` | `0` *(shipped)* | how deep the routed watch scan walks; `0` walks the whole tree |
| | `distroCwd` | `''` | the routed backend's default workdir; empty means the distro user's home. `cwd` belongs to the host backend only — the distro side reads `distroCwd` — while `diffBasisMaxBytes` is shared: it bounds the overwrite diff on both sides |
| `workspace-files-wsl` | `maxBytes` | `2097152` *(shipped)* | byte cap on one page of a text read, and the default byte window of a byte read |
| | `maxFileBytes` | `33554432` *(shipped)* | full-file byte cap for the byte reader |
| | `maxLines` | `5000` *(shipped)* | line cap on one text read |
| | `maxEntries` | `2000` *(shipped)* | directory entries listed per level before the listing is flagged truncated |
| `directory-picker-wsl` | `preferredDistro` | `''` *(shipped)* | the distro listed first in the picker |
| | `includeHostHome` | `true` *(shipped)* | also list the Windows home directory |
| | `maxEntries` | `1000` *(shipped)* | maximum entries listed per directory |
| `subprocess-wsl` | `distro` | `''` *(shipped)* | which distro the GUI terminal opens in |
| | `shell` | `''` | pin a shell; empty lets `wsl.exe` decide |
| | `loginShell` | `true` | whether a pinned shell uses login semantics |
| | `hostSessions` | `true` | give a session opened on a Windows folder a host `powershell.exe` in its own directory instead of the distro shell at `/mnt/<drive>/…`; `false` restores the composition-owned distro terminal for every session |
| | `terminalIdleReclaim` | `true` | let the controller reclaim an idle distro terminal: the launch is marked with a per-terminal `DSH_TERMINAL_ID`, and the handle's `inspectActivity` counts the marked processes through the resident agent — one (the shell at its prompt) is idle, more than one (a running command or a nested shell) is busy, `unknown` (agent out) pauses reclamation. `false` restores close-by-hand |

## Overriding the rows inside `preset-wsl`

`wsl-shell` and `wsl-fs` are mounted as plugins of the `wsl` agent preset, inside
the `preset-wsl` row's `config.plugins`. The loader indexes top-level entry ids —
plus the plugin lists of rows that are themselves groups — and `preset-wsl` is a
plain entry whose plugins sit inside its `config`, so those two ids are not
addressable from a patch layer at all. A layer of

```yaml
- id: wsl-shell
  config:
    distro: Ubuntu

- id: wsl-fs
  config:
    restrictToDistro: false
```

changes nothing and does not fail: the log carries
`patch: entry "wsl-shell" not found` and `patch: entry "wsl-fs" not found`, and the
composed config keeps the shipped values.

The route that works is to override the `preset-wsl` row as a whole. A row's
`config` is replaced whole, never deep-merged, so the replacement has to carry
`id`, `order` and the entire `plugins` list — every plugin, the `wsl-env` group
and everything after it. Copy the whole `- id: preset-wsl` block out of
[`cordis.patch.yml`](../cordis.patch.yml) (or out of
`dsh --profile <name> --dump-config`), paste it into your layer, and edit only the
values you want:

```yaml
- id: preset-wsl
  config:
    id: wsl
    order: 2
    plugins:
      - id: wsl-env
        name: cordis:group
        group: true
        isolate:
          shell: true
          fs: true
        config:
          - id: wsl-shell
            name: 'dsh-plugin-wsl-env'
            config:
              distro: Ubuntu          # ← the edit
              loginShell: true
              timeoutMs: 120000
              maxTimeoutMs: 600000
          - id: wsl-fs
            name: 'dsh-plugin-wsl-env/fs'
            config:
              distro: ''
              restrictToDistro: false # ← the edit
              substrate: agent
          # … and the rest of the group, verbatim — do not leave a plugin out …
```

Leaving a plugin out of the replacement drops it: the preset would mount only the
plugins you listed. The keys described above are the only reason to rewrite this
row, so treat the `preset-wsl` block as one unit and re-copy it after a plugin
upgrade that changes it.

For the root-plane filesystem — the row that serves `ctx.fs` outside any session,
`fs-routing` — no rewrite is needed: it is a top-level row, and
`restrictToDistro`, `sandbox` and `maskWindowsDrive` can be set on it directly.
That governs different traffic from `wsl-fs`; see
[`docs/root-fs-routing.md`](root-fs-routing.md).

## Other keys

You can override the other keys in the same way, with one split: every row in the
table below except `wsl-shell` and `wsl-fs` is top-level, so `- id: <row>` in your
own layer patches it — those two are inside `preset-wsl` and take the rewrite
above. They all keep their defaults:

| Row | Key | Default | Meaning |
|---|---|---|---|
| `wsl-shell` (in `preset-wsl`) | `wslPath` | `wsl.exe` | path to `wsl.exe`, for an installation that is not on `PATH` |
| | `hostCwd` | unset → `%SystemRoot%` | the Windows directory the `wsl.exe` process itself starts in |
| | `forwardEnv` | `[]` | extra host environment variable names to forward into the distro through `WSLENV`. This is the one key here that widens what crosses the boundary: `NO_COLOR`, `TERM`, `PAGER`, `GIT_PAGER`, `LANG`, `LC_ALL` and every managed `DSH_*` name ride along without it, and `PATH` is deliberately never forwarded |
| `wsl-fs` (in `preset-wsl`) | `wslPath` | `wsl.exe` | as above; used only to resolve the default distro |
| | `diffBasisMaxBytes` | `10485760` | UTF-8 byte limit per side of an overwrite diff; a larger file publishes without a diff |
| `fs-routing` | `cwd`, `diffBasisMaxBytes` | `process.cwd()`, `10485760` | `cwd` configures the host side only (the distro side reads `distroCwd`); `diffBasisMaxBytes` is shared by both — it also bounds the routed backend's overwrite diff |
| `directory-picker-wsl` | `wslPath` | `wsl.exe` | as above |
| | `distroCacheMs` | `5000` | how long a resolved distro list stays fresh before `wsl.exe` is asked again |
| `subprocess-wsl` | `wslPath` | `wsl.exe` | as above |
| | `cwd` | `''` | fallback directory when a launch names none |
| | `hostCwd` | unset → `%SystemRoot%` | as on `wsl-shell` |
| | `forwardEnv` | `[]` | as on `wsl-shell`, for terminal launches |

The shell row also inherits the shipped output budgets from `dsh-bash-local`,
which documents them in full: `maxOutputBytes` (64000), `maxSpillBytes`
(67108864) and `graceMs` (3000, the SIGTERM-to-SIGKILL grace). The spill keys
belong to the one-shot path: with `agent: true` — the default — the capture is
cut at `maxOutputBytes` per stream inside the distro, the result reports
`truncated: true`, and no temporary file is written, so `maxSpillBytes` and
`graceMs` have nothing to bound. They apply when `agent` is `false` or the agent
is out of service and the call rides the one-shot `wsl.exe` path.

## Which distro is used

`distro: ''` means the distro `wsl.exe` treats as default, so an installation with a
single distro needs no configuration. Name one when you have several, or when the
default is not the one you want sessions in.

## Turning the sandbox off

`sandbox: false` on `wsl-shell` and `wsl-fs` runs commands and writes without
confinement. `sandboxMode` then reports `undefined`, and the tool layer tells the
model that these operations have no sandbox. `fs-routing` takes the same key and
drops the fence on the root-plane filesystem the same way, but that service reports
no `sandboxMode` either way — it inherits the base class's empty getter — so the
key decides the fence, not a capability fact the model reads. That is the documented
opt-out; see [ARCHITECTURE.md](ARCHITECTURE.md#sandbox) for what the sandbox does
and does not cover.

The default posture needs `bubblewrap` **inside the distro** and fails closed: a
distro without a usable `bwrap` refuses the command (`SANDBOX_UNAVAILABLE`) or the
write (`FS_IO_ERROR`, the message carrying the same guidance) instead of
running it unconfined. The refusal distinguishes the two causes — `bwrap`
missing (install it) from `bwrap` present but failing (usually the kernel's
unprivileged user namespaces; reinstalling will not help) — and the direct
install command it prints follows the distro's own package family
(apt/dnf/pacman/zypper). A failed probe is re-run,
so installing `bubblewrap` takes effect on the next command without a restart.
Install it with `scripts/bootstrap.sh <distro> --install`, or directly:
`wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap`. Run without
`--install`, `scripts/bootstrap.sh <distro>` is a read-only check that prints what
is missing.

The same probe also runs when a session opens: the `wsl-preflight` row warns
with the full remedy if `bwrap` is unusable, so the news arrives with the
session rather than with the first failed command. It is advisory — it never
installs anything and never changes the fail-closed semantics; drop the
`wsl-preflight` row from your layer (or set `sandbox: false` on it) to silence
the warning.

## Checking a change, and what refuses

`dsh --profile <name> --dump-config` composes the profile and prints the result
without booting. It is the fastest way to see whether a row you wrote landed —
including the warning that says it did not — and for the rows inside `preset-wsl`
the composed tree it prints carries the block to copy back into your layer.
`scripts/bootstrap.sh <distro>` does the same for the distro-side prerequisites.

When something refuses, the message names the row or the code:

| Symptom | What you see | What clears it |
|---|---|---|
| commands fail with no usable sandbox | `SANDBOX_UNAVAILABLE` — the text says whether `bwrap` is missing or present but failing, with the matching remedy | missing: install `bubblewrap` (`scripts/bootstrap.sh <distro> --install`, or the printed family command); present-but-failing: check `bwrap --version` and the kernel's unprivileged user namespaces, or set `sandbox: false` on `wsl-shell` |
| writes fail with no usable sandbox | `FS_IO_ERROR`, with the same `bwrap` remedy the commands carry | the same install, or `sandbox: false` on `wsl-fs` (`fs-routing` for root-plane writes) |
| file tools fail while the distro is down | `FS_IO_ERROR`, "the distro file substrate is unavailable" | start the distro (`wsl.exe -l -v`), restart the session if it stays out |
| a command never starts | a `WSL_E_*` code naming the distro | start it with `wsl.exe -d <distro>`, or point `distro` at another one — wider permissions do not help |
| `wsl.exe` itself cannot be started | the error names the executable and says to check `wslPath` on this row | fix `wslPath`, and check WSL is installed |
| WSL wedges mid-command | no completion within the deadline | retry once, then `wsl.exe --shutdown` and reopen |
| a watched path never fires | `FS_IO_ERROR` from `watch` | watch a path inside the pinned distro |
| a path in another distro is refused | `FS_OUTSIDE_DISTRO` | open a session in that distro, or set `restrictToDistro: false` |

The full code table — what each code means and what clears it — is
[ARCHITECTURE.md § Error codes](ARCHITECTURE.md#error-codes); the design boundaries
behind the fail-closed choices above are in [LIMITATIONS.md](LIMITATIONS.md).

## `wsl-shell-env`

| Key | Default | Meaning |
| --- | --- | --- |
| `distro` | `''` | the distro the `DSH_WSL_*` facts describe |
| `portsRefreshMs` | `10000` | how often the `DSH_WSL_PORTS` listening-port snapshot refreshes through the resident agent |
