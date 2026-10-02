# Configuration

Every value lives in a profile row, and a row is overridden by id in your own
profile layer: `$DSH_HOME/profiles/<name>/cordis.patch.yml`. Start from
[`examples/profile.cordis.patch.yml`](../examples/profile.cordis.patch.yml), and keep
[`cordis.patch.yml`](../cordis.patch.yml) open beside it — that file is the commented
reference for every value the plugin ships.

In the table below, *(shipped)* marks the values set by `cordis.patch.yml`. The rest
are schema defaults, listed because they are the ones worth knowing.

| Row | Key | Default | Meaning |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` *(shipped)* | distro name; empty means WSL's default distro |
| | `shell` | `''` | pin a shell inside the distro; empty means the user's login shell |
| | `loginShell` | `true` *(shipped)* | use `<shell> -lc`, which sources your profile, instead of a bare `-c` |
| | `sandbox` | `true` | confine commands with `bubblewrap`; `false` disables the sandbox |
| | `cwd` | `''` | default working directory; empty means the distro user's home |
| | `timeoutMs` / `maxTimeoutMs` | `120000` / `600000` *(shipped)* | per-call time limit, and the ceiling a call may ask for |
| `wsl-fs` | `distro` | `''` *(shipped)* | as above |
| | `restrictToDistro` | `true` *(shipped)* | refuse a path in **another distro**'s share. `/mnt/c` is a directory *inside* the pinned distro, so it is not affected. The refusal carries `FS_OUTSIDE_DISTRO`; that is not a sandbox decision, so the file tools do not offer a wider permission for it. Set `false` to allow another distro's share |
| | `sandbox` | `true` | check `writeText` and `editText` against the policy |
| | `resolveSymlinks` | `true` | follow Linux symlinks that the share cannot traverse, such as `/etc/os-release` and `/bin` |
| | `cwd` | `''` | base directory for relative paths; empty means the distro user's home |
| `directory-picker-wsl` | `preferredDistro` | `''` *(shipped)* | the distro listed first in the picker |
| | `includeHostHome` | `true` *(shipped)* | also list the Windows home directory |
| | `maxEntries` | `1000` *(shipped)* | maximum entries listed per directory |
| `subprocess-wsl` | `distro` | `''` *(shipped)* | which distro the GUI terminal opens in |
| | `shell` | `''` | pin a shell; empty lets `wsl.exe` decide |
| | `loginShell` | `true` | whether a pinned shell uses login semantics |

You can override the other keys in the same way; they keep their defaults. Those are
`wslPath`, `hostCwd` and `forwardEnv` on the shell and terminal rows,
`diffBasisMaxBytes` on `wsl-fs`, and `distroCacheMs` on the picker. The shell row
also inherits the shipped output budgets — `maxOutputBytes` (64000 bytes per
stream before the rest spills to a temporary file), `maxSpillBytes` (67108864) and
`graceMs` (3000, the SIGTERM-to-SIGKILL grace) — from `dsh-bash-local`, which
documents them in full.

## Which distro is used

`distro: ''` means the distro `wsl.exe` treats as default, so an installation with a
single distro needs no configuration. Name one when you have several, or when the
default is not the one you want sessions in.

## Turning the sandbox off

`sandbox: false` on `wsl-shell` and `wsl-fs` runs commands and writes without
confinement. `sandboxMode` then reports `undefined`, and the tool layer tells the
model that these operations have no sandbox. That is the documented opt-out; see
[ARCHITECTURE.md](ARCHITECTURE.md#sandbox) for what the sandbox does and does not
cover.
