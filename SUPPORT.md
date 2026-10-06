# Support

## What is supported

| Area | Supported |
|---|---|
| Operating system | Windows 10 and Windows 11 |
| Linux side | WSL2 with at least one distro |
| DSH packages | the `0.2.0-rc.2`-era packages listed in `peerDependencies` |
| Plugin version | the latest published version only |
| Node | 22.19+ (`^22.19.0`), or 24 and later (`>=24.0.0`) |

Node 20 is outside the range on purpose: the floor is the harness host's own, and
CI covers 22 and 24. `engines` in `package.json` is the authoritative statement,
not this table.

Outside Windows there is nothing for the plugin to attach to. It runs `ctx.shell`
inside the distro through `wsl.exe`. A Linux host, a macOS host, or WSL1 is not a
supported configuration.

## Where to get help

Open an issue in the repository:

https://github.com/Big-Dao/dsh-plugin-wsl-env/issues

Use it for bug reports and for questions about configuration. Search the open and
the closed issues first, and check whether the answer is already written down:
[docs/LIMITATIONS.md](docs/LIMITATIONS.md) lists the known design boundaries, and
the Troubleshooting table in [README.md](README.md#troubleshooting) covers the
common failures (`SANDBOX_UNAVAILABLE`, a missing `rg`, and the rest).

For a security issue, follow [SECURITY.md](SECURITY.md). Do not open a public
issue for one.

## What is not supported

- macOS, and Linux hosts that are not WSL2.
- Windows without WSL2.
- A modified DSH build, or a fork of the harness packages.
- A distro the plugin cannot recognize, which is what its probes report: no
  distro from `wsl.exe -l -q`, a `$HOME` that is empty or not an absolute path,
  or no absolute shell from the `getent passwd` / `$SHELL` probes. The detection
  lives in `src/wsl.ts`.
- A distro without `bwrap`. Commands there fail closed rather than run
  unconfined.
- The upstream `@deepseek-ai/*` packages. Report those to their own projects.
- Third-party npm mirrors. Install from the registry the package was published to.

## Compatibility expectations

The upstream packages are a release candidate, so the peer versions are pinned
exactly. One example is `@deepseek-ai/dsh-fs: 0.2.0-rc.2`. An upstream change can
require a new release of this plugin. The exact pins are what make that break
loudly instead of quietly.

There is no long-term support branch. Fixes go to the latest version.

## What a good bug report contains

| Item | How to get it |
|---|---|
| Plugin version | `npm ls dsh-plugin-wsl-env`, or the git tag you built from |
| DSH version | the version of the harness you run |
| Distro and kernel | `wsl.exe -l -v`, and `uname -r` inside the distro |
| Windows build | `winver` |
| The composed configuration | `dsh --profile <name> --dump-config`, in particular the `dsh-plugin-wsl-env` layer and the rows it patches |
| Sandbox behaviour | the output of `npm run probe:sandbox`, run from inside the distro (`wsl.exe -d <distro>` first) — the probe calls `bwrap` and reads `lib/bwrap.js` there, so it needs both in the distro |
| What you expected and what happened | one paragraph each |
| A reproduction | the exact command, or the exact sequence of clicks |

Redact your user name and any path you would rather not publish. The useful part
of `--dump-config` is usually the layer heading and the patched rows, not the whole
file.

## Response times

This is a small project maintained in spare time. There is no service-level
agreement and no guaranteed response time. Security reports have their own targets,
which are listed in [SECURITY.md](SECURITY.md).
