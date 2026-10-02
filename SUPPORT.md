# Support

## What is supported

| Area | Supported |
|---|---|
| Operating system | Windows 10 and Windows 11 |
| Linux side | WSL2 with at least one distro |
| DSH packages | the `0.2.0-rc.2`-era packages listed in `peerDependencies` |
| Plugin version | the latest published version only |
| Node | 20, 22, or 24 |

Outside Windows there is nothing for the plugin to attach to. It runs `ctx.shell`
inside the distro through `wsl.exe`. A Linux host, a macOS host, or WSL1 is not a
supported configuration.

## Where to get help

Open an issue in the repository:

https://github.com/Big-Dao/dsh-plugin-wsl-env/issues

Use it for bug reports and for questions about configuration. Search the open and
the closed issues first.

For a security issue, follow [SECURITY.md](SECURITY.md). Do not open a public
issue for one.

## What is not supported

- macOS, and Linux hosts that are not WSL2.
- Windows without WSL2.
- A modified DSH build, or a fork of the harness packages.
- A distro the plugin cannot recognize. Examples are a replaced `/bin/sh`, a
  container-style root filesystem, and a missing `bwrap`.
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
| Sandbox behaviour | the output of `npm run probe:sandbox`, when the sandbox is involved |
| What you expected and what happened | one paragraph each |
| A reproduction | the exact command, or the exact sequence of clicks |

Redact your user name and any path you would rather not publish. The useful part
of `--dump-config` is usually the layer heading and the patched rows, not the whole
file.

## Response times

This is a small project maintained in spare time. There is no service-level
agreement and no guaranteed response time. Security reports have their own targets,
which are listed in [SECURITY.md](SECURITY.md).
