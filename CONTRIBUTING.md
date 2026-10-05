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

## The type gate

`lint:types` runs `tsc --noEmit` under `strict` with `checkJs`: the JavaScript
in `lib/` is fully type-checked, and the types come from the peer packages'
own `.d.ts` — nothing is invented twice. `types/dsh-services.d.ts` pulls in the
`declare module '@deepseek-ai/cordis'` augmentations the service packages ship,
so `ctx.fs`, `ctx.shell`, `ctx.sandboxPolicy` and friends are typed; it declares
nothing itself and ships nowhere.

The gate's scope is the whole repository: `lib/**`, `test/**` and the probe
scripts are all type-checked. The shipped artifact was checked first because it
is where protocol drift with the pinned peers hurts; the tests and probes came
next, and the errors they surfaced were real — a test that pinned a raw number
into an argv, a couple of hand-written JSDoc contracts wider than the code
(`wslErrorCode`, `gitSpawnRewrite`) and narrower than their seams, and one
accepted-but-never-enforced byte-window cap in `lib/workspace-files-wsl.js`,
found because a fake hands the confinement seam an `"full"` enforcement the
core itself never reports.

Three patterns keep the check honest:

- A subclass's own config keys are declared as a `@typedef` mirroring its
  `static Config` schema and read through one explicit cast — the schema and
  the typedef can then only drift apart visibly.
- A test double is typed as the slice of the seam it scripts (a duck
  `@typedef`) and reaches the seam's declared type through one documented cast
  at the injection point — the cast states which contract the double stands in
  for, instead of silencing the mismatch with `any`.
- `@ts-expect-error` is allowed exactly when the suppressed error names a real
  upstream seam gap, carries the reason inline, and the gap is written up in
  `docs/UPSTREAM-*.md`. It is a published finding with a tracking doc, not a
  silencer.

## The build

The plugin must be loadable from a bare checkout: the harness has no
transpilation layer, the Windows runtime mirror is a copy of the tree, and the
tests exercise `lib/*.js` — the published artifact — rather than the sources.
The TypeScript migration therefore keeps sources in `src/`, built JavaScript
and declarations in `lib/`, and the artifacts COMMITTED. `pnpm run build`
(`scripts/build.mjs`) runs two passes:

- **`src/*.ts` → `lib/`** (`tsconfig.build.json`): TypeScript sources, emitted
  as JavaScript plus their declarations, beside the hand-written modules and
  under the same export paths as before.
- **`lib/*.js` → `lib/`** (`tsconfig.dts.json`): declaration-only emit for the
  hand-written, JSDoc-typed modules — this is what gives every public entry a
  `.d.ts`. It must run against a CLEAN tree: a stale `.d.ts` sits exactly where
  TypeScript resolves `./x.js` and is taken as an input, and re-emitting
  through it silently degrades the result (`index.d.ts` lost a precise type to
  `any` this way during the migration). The script therefore deletes the
  declarations the first pass does not own before running the second — they
  are all build products, and a failed pass leaves them missing rather than
  stale, which `lint:build` reports loudly.

Rules that keep this honest:

- Never edit a generated file under `lib/` — its module doc names the source
  to edit and `lint:build` fails the moment the two drift. Generated artifacts
  keep tsc's canonical formatting (four-space, compacted); review `src/` for
  TypeScript-sourced modules.
- `lint:build` (`test/build-freshness.mjs`) snapshots every generated file,
  runs the real build, byte-compares and RESTORES the snapshot — a check, not
  a rebuild; the remedy for drift is `pnpm run build` plus a commit. It is
  part of the gate chain after `test:syntax`.
- Generated files are excluded from the `checkJs` gate in `tsconfig.json`:
  their sources — the TypeScript, or the declarations themselves — are
  type-checked instead, with `noEmitOnError` so a broken build never
  overwrites `lib/`.
- Every JavaScript export carries its `types` condition (enforced by
  `lint:style`), so downstream resolves these declarations; there is no
  second, hand-written type surface.
- The protocol message union and friends are the single home now: consumers
  import them (`@typedef {import("./agent-protocol.js").AgentMessage}
  AgentMessage`) instead of restating them, which is how `lib/agent.js` and
  the script-driven tests read them.

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
| `pnpm test` | style checks, syntax pass, type check, and unit tests | no |
| `pnpm run test:coverage` | unit tests with coverage | no |
| `pnpm run lint:style` | style and lint rules | no |
| `pnpm run lint:types` | the TypeScript check over `lib/` (`tsc --noEmit`) | no |
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
`test:syntax`, `lint:types` and `test:unit` in that order. `prepublishOnly` runs `pnpm test` again
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
