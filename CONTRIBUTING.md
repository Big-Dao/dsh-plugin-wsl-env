# Contributing

This document covers the development loop, the gates a pull request must pass, and
the conventions this repository uses.

## Prerequisites

| Requirement | Notes |
|---|---|
| Windows 10 or 11 | the plugin targets Windows only |
| WSL2 with at least one distro | `wsl.exe -l -v` lists the installed distros |
| `bubblewrap` in the distro | `sudo apt install bubblewrap`. The sandbox fails closed without it. |
| Node 22.19+, or 24 | the versions CI runs. `engines` requires `^22.19.0 \|\| >=24.0.0`, the harness host's own floor. |

## Toolchain

The runtime package ships an empty `dependencies` object on purpose: it is
loaded into the DSH process and everything it needs arrives as a peer package.
Running the plugin from a checkout has no install step.

Developing and running the gates do have dependencies. The 0.7.x tests import
pinned `@deepseek-ai/*` packages — the composition and boot tests run the
loader's real patch algorithm — so a fresh checkout needs one `pnpm install`
before the gates pass.

pnpm runs the scripts in this repository, pinned through the `packageManager`
field (corepack resolves it). Treat `pnpm run <script>` as the reference
toolchain.

Do not add a runtime dependency — see above. Style tooling is kept out for the
same reason: there is no ESLint and no Prettier. The checks that would normally
need them are built from Node builtins instead. `test/style.mjs` verifies the
rules `.editorconfig` states, and it checks that every `files` entry still
matches tracked content and every `exports` target still exists. The syntax pass
inside `pnpm test` uses Node's own parser.

Exactly three dependencies run install scripts (`@deepseek-ai/dsh-subprocess-local`,
`koffi`, `node-pty` — the native pieces); they are allow-listed in
`pnpm-workspace.yaml` and everything else builds nothing.

## The development loop

1. Clone the repository inside the distro. Most contributors develop there.
2. Make the change.
3. Run the gates below.
4. Restart the DSH app before testing by hand, if you changed anything under
   `lib/`. A running process caches ES modules, so it keeps the old code
   otherwise.

### The runtime mirror

A DSH profile can only link a Windows path. pnpm rewrites
`link:\\wsl.localhost\...` into a broken `/wsl.localhost/...` symlink, so the
harness cannot load the plugin from a distro checkout.

The Windows copy under `default-workspace/dsh-plugin-wsl` is a runtime mirror. Sync
it before launching the app:

```bash
pnpm run sync:windows
```

The mirror destination sits outside a session workspace. An agent that runs the
sync from a confined shell is refused by the `workspace-write` policy and has to
approve a wider permission for that one command. Run the sync from a plain distro
terminal if you would rather not see the prompt.

## Gates before a pull request

| Command | Covers | Needs a harness |
|---|---|---|
| `pnpm test` | style checks, syntax pass, and unit tests | no |
| `pnpm run test:coverage` | unit tests with coverage | no |
| `pnpm run lint:style` | style and lint rules | no |
| `pnpm run probe` | filesystem behaviour against a real distro | yes |
| `pnpm run probe:sandbox` | what bubblewrap confines and what it does not | no |
| `pnpm run probe:sandbox-shell` | the confined executor through a real boot | yes |
| `pnpm run probe:terminal` | the terminal provider | yes |
| `pnpm run probe:substrate` | the agent filesystem substrate over a real `wsl.exe` transport | yes; inside the distro |
| `pnpm run probe:watch` | the in-distro watcher over a real directory | yes; inside the distro |
| `pnpm run probe:agent` | the resident-vs-one-shot fallback parity legs | yes; inside the distro |
| `pnpm run probe:exec` | the agent-backed execution handle: timeout, kill, cwd failure | yes; inside the distro |
| `pnpm run probe:missing-wsl` | how a `wslPath` that cannot start is reported | yes |
| `pnpm run probe:picker` | the picker's root level, its refusals and its cap | yes |
| `pnpm run probe:mode` | which POSIX-mode facts survive the share | no; Windows Node |
| `pnpm run probe:sandbox-off` | the documented opt-out on both providers | yes |

Every script above is wired in `package.json`. `pnpm test` runs `lint:style`,
`test:syntax` and `test:unit` in that order. `prepublishOnly` runs `pnpm test` again
at publish time, so a broken gate stops a release before the upload.

CI runs `pnpm test` on Node 22 and 24, on both `ubuntu-latest` and
`windows-latest`, and `pnpm run test:coverage` on Node 24. The Windows runners are
there because the plugin targets Windows; the coverage thresholds need Node 22.8 or
newer, which is why that job runs on one version.

The probes marked "yes" need Windows, WSL2, a mounted harness profile and a linked
checkout, which a hosted runner does not have. Run them on your own machine and
paste the output into the pull request.

## Adding a test

Choose the layer by what the test needs.

| Layer | Location | Use it for |
|---|---|---|
| Unit test | `test/*.test.mjs` | pure logic: path translation, listing, shell argument building, terminal helpers |
| Probe | `test/probe/` | behaviour that needs a real distro, a real profile, or bubblewrap |

Unit tests run under `node --test`. A test that imports only this repository goes in
both the `test:unit` and the `test:coverage` lists in `package.json`, which name
their files explicitly. A test that needs a DSH peer — `test/sandbox.test.mjs`
imports `lib/sandbox.js`, which imports `@deepseek-ai/dsh-sandbox` — goes in
`test:unit` only and must skip itself when the peer is missing, because CI installs
nothing: try the import, print a `SKIP` line, exit 0.

Probes are shell scripts that mount a throwaway profile, plus the small plugin
files they load. Those plugin files are the `*-probe.mjs` and `*-probe.yml` files
in the same directory. The setup steps for the throwaway profile are in the header
of `test/probe/run.sh`. `terminal.sh` and `sandbox-shell.sh` reuse it.

Keep probe output idempotent. Several probes delete their scratch files at the
start, because a leftover file from an earlier run changes the result.

## What has been verified

`pnpm test` covers the pure modules and runs a `--check` pass over every shipped
module. It cannot import the service modules, because those need DSH peer packages
that a bare checkout does not have. Only booting the harness closes that gap, which
is why the probes exist; the archived record's §15.4 documents the five rounds of
misdiagnosis the gap once caused.

`test/probe/sandbox.sh` needs no harness: it uses the same arguments
`lib/sandbox.js` builds and asserts what bubblewrap does and does not confine,
recording the interop escape as `INFO` because a Linux sandbox cannot govern a
Windows process. The other probes boot a throwaway profile bound to the distro:

- the filesystem probe asserts the write path and the write checks — a write outside
  the policy root and a write in `read-only` mode both return `FS_SANDBOX_DENIED`,
  while `danger-full-access` is not checked;
- the shell probe drives all three modes through `ctx.shell` and checks the refusal
  classification the tool layer returns;
- the terminal probe asserts the distro, the starting directory, and the `DSH_*`
  variables forwarded through `WSLENV`.

The setup steps for the throwaway profile are in the header of `test/probe/run.sh`;
`terminal.sh` and `sandbox-shell.sh` reuse it.

On Windows 11 + WSL2 (Ubuntu 26.04) the following has been verified:

- the wiring of each service, the UNC path handling and the picker behaviour;
- the plugin mounted end to end in a real profile;
- one real model turn in a WSL-only headless profile: `write → chmod → read → edit →
  execute`, with the executable bit surviving the edit;
- the terminal provider in a throwaway Web boot and in the daily GUI profile;
- the sandbox in four ways: the arguments measured inside the distro, the filesystem
  write checks, the shell path (`enforcement: partial`, with refusals classified
  correctly), and the daily GUI profile, where a write from the agent's own session
  outside the session workspace is refused inside the distro and the following
  wider-permission request succeeds.

Counts: 57 unit assertions on a bare checkout, plus 5 in `test/sandbox.test.mjs` which
need the `dsh-sandbox` peer and skip themselves without it; 19 filesystem-probe
assertions; 15 shell-probe checks; 9 picker checks; 6 missing-executable checks; 5 mode
checks; 5 opt-out checks and 10 sandbox expectations plus the recorded escape; and 3
terminal assertions.

## Commit and pull request conventions

- Write an imperative subject line: `Fix the npm readme`, not `Fixed` or `Fixes`.
- Do not use conventional-commit prefixes. No `feat:`, `fix:`, or `chore:`.
- Explain why in the body. What changed is already visible in the diff.
- Add a `CHANGELOG.md` entry under `## [Unreleased]` for a behaviour change. A
  change to documentation or to comments does not need one.
- Keep one topic per commit.
- In the pull request, say how you tested it. Paste probe output where a probe is
  relevant.
- Update `README.md` and `docs/README.zh.md` together when a change affects usage.
  The two files match section for section.

## Reporting bugs and security issues

Open a GitHub issue for a bug:

https://github.com/Big-Dao/dsh-plugin-wsl-env/issues

Report a security issue privately. Follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.
