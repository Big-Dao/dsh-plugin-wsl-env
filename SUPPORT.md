# Support

## What is supported

| Area | Supported |
|---|---|
| Operating system | Windows 10 and Windows 11 |
| Linux side | WSL2 with at least one distro, and systemd as PID 1 with a lingering user manager (`loginctl enable-linger`) for the shipped session runtime. Set `sessionSandbox: false` on the preset's `wsl-shell` to keep the per-command sandbox instead |
| DSH packages | the `0.2.1-rc.3`-or-newer packages the `peerDependencies` floors declare; an app on a newer harness installs unchanged |

The DSH row is checked weekly: `.github/workflows/peer-canary.yml` resolves the
`next` dist-tag of every pinned peer, installs that line into a scratch copy and
runs `pnpm test` plus the composition boot test. A successful run prints the
exact version delta in its summary; update the row above from that summary. A
red run means the plugin has not been validated against the new line yet.
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

https://github.com/Big-Dao/dsh-plugin-wsl-env/issues/new/choose

The chooser offers a **feature request** and a **setup report**; the setup
report requires the `doctor --json` output, which is what makes a first-run
problem diagnosable without a round trip. For a security issue, use the private
advisory link instead (see [SECURITY.md](SECURITY.md)).

Use issues for bug reports and for questions about configuration. Search the open and
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
exactly. One example is `@deepseek-ai/dsh-fs: 0.2.1-rc.2`. An upstream change can
require a new release of this plugin. The exact pins are what make that break
loudly instead of quietly.

There is no long-term support branch. Fixes go to the latest version.

## Triage and release cadence

- **Roadmap.** The public plan is [docs/ROADMAP-1.0.md](docs/ROADMAP-1.0.md);
  the open issues #5–#22 map to its WSL-1xx/2xx/3xx blocks.
- **Triage target.** A `priority:P1` report gets its first response within three
  business days, best effort. Security reports follow the response targets in
  [SECURITY.md](SECURITY.md).
- **Cadence.** Releases ship when there is a change worth shipping, roughly every
  two to four weeks; the tag workflow and its gates are in
  [docs/RELEASING.md](docs/RELEASING.md), and the configuration-stability and
  migration rules are in [docs/MIGRATION.md](docs/MIGRATION.md). There is no
  long-term support branch.
- **Good first issues.** The `good first issue` label marks changes that need no
  prior context; [CONTRIBUTING.md](CONTRIBUTING.md#good-first-issues-and-the-contributor-path)
  lists the usual shapes and how to claim one.

## What a good bug report contains

The one-command path: `pnpm run diagnose` (from a checkout of the plugin, or
`bash scripts/diagnose.sh`) collects most of the table below — Windows build,
WSL status, distro, kernel, package family, the four tools with their versions,
and a bwrap functional probe — as a paste-ready report. Run it first, then add
what it cannot see:

| Item | How to get it |
|---|---|
| The diagnose report | `pnpm run diagnose -- <distro>` (read-only; safe to paste) |
| Plugin version | `npm ls dsh-plugin-wsl-env`, or the git tag you built from |
| DSH version | the version of the harness you run |
| The composed configuration | `dsh --profile <name> --dump-config`, in particular the `dsh-plugin-wsl-env` layer and the rows it patches |
| Sandbox behaviour, in depth | the output of `npm run probe:sandbox`, run from inside the distro (`wsl.exe -d <distro>` first) — the probe calls `bwrap` and reads `lib/bwrap.js` there, so it needs both in the distro |
| What you expected and what happened | one paragraph each |
| A reproduction | the exact command, or the exact sequence of clicks |

Redact your user name and any path you would rather not publish. The useful part
of `--dump-config` is usually the layer heading and the patched rows, not the whole
file.

## Response times

This is a small project maintained in spare time. There is no service-level
agreement and no guaranteed response time. Security reports have their own targets,
which are listed in [SECURITY.md](SECURITY.md).
