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

The runtime package ships no `dependencies` field at all, on purpose: it is
loaded into the DSH process and everything it needs arrives as a peer package.
Running the plugin from a checkout has no install step.

Developing and running the gates do have dependencies. The tests import pinned
`@deepseek-ai/*` packages — the composition test runs the loader's real patch
algorithm, and the boot test starts a row through the real Loader — so a fresh
checkout needs one `pnpm install` before the gates pass.

Those pins are deliberate, and they move with the harness rather than on their
own: the `@deepseek-ai/dsh-*` peers sit at `0.2.0-rc.2`, `@deepseek-ai/cordis`
at `~4.0.4` and `@deepseek-ai/schemastery` at `~3.18.4`. The plugin subclasses
peer classes and mirrors peer protocol, so raising one pin alone is how the
seams drift: bump them in the commit that matches a harness release, re-run the
comparison `docs/PEER-PARITY.md` describes, and let the gate chain and the
probes confirm the result.

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

`lint:types` runs `tsc --noEmit` under `strict` with `checkJs` over what is NOT
generated — `test/**` and the ambient types — and the types come from the peer
packages' own `.d.ts`: nothing is invented twice. `types/dsh-services.d.ts`
pulls in the `declare module '@deepseek-ai/cordis'` augmentations the service
packages ship, so `ctx.fs`, `ctx.shell`, `ctx.sandboxPolicy` and friends are
typed; it declares nothing itself and ships nowhere.

The probe scripts under `test/probe/` are inside the gate as well. The sources
under `src/` are checked by the build program itself (`strict`,
`noEmitOnError`), which is strictly stronger than checking their emitted
JavaScript. The shipped artifact was checked first because it is where protocol
drift with the pinned peers hurts; the tests and probes came next, and the
errors they surfaced were real — a test that pinned a raw number into an argv,
a couple of hand-written JSDoc contracts wider than the code (`wslErrorCode`,
`gitSpawnRewrite`) and narrower than their seams, and one
accepted-but-never-enforced byte-window cap in the distro-routed file service,
found because a fake hands the confinement seam an `"full"` enforcement the core
itself never reports.

Three patterns keep the check honest:

- A subclass's own config keys are declared as a type mirroring its
  `static Config` schema and read through one explicit cast — the schema and
  the type can then only drift apart visibly.
- A test double is typed as the slice of the seam it scripts (a duck
  `@typedef`) and reaches the seam's declared type through one documented cast
  at the injection point — the cast states which contract the double stands in
  for, instead of silencing the mismatch with `any`.
- `@ts-expect-error` is allowed exactly when the suppressed error names a real
  upstream seam gap, carries the reason inline, and the gap is written up — in a
  `docs/UPSTREAM-*.md` tracking doc when the fix is an upstream ask (the
  `LocalBashExecutor.spawnSpec` seam has one), or in the source comment itself
  when the honest fix needs a protocol decision this package owns (the exit-4
  relay's unknown entry kind is the other site, deliberately left visible). It
  is a published finding, not a silencer.

## The build

The plugin must be loadable from a bare checkout: the harness has no
transpilation layer, the Windows runtime mirror is a copy of the tree, and the
tests exercise `lib/*.js` — the published artifact — rather than the sources.
Sources live in `src/`, built JavaScript and declarations in `lib/`, and the
artifacts stay COMMITTED. `pnpm run build` (`scripts/build.mjs`) runs one pass —
`tsc -p tsconfig.build.json` — emitting every `src/*.ts` as JavaScript plus its
declaration under the same export paths as the hand-written modules it
replaced. Imports name the artifact (`./x.js`); `nodenext` resolves that
through the TypeScript source. The build then prunes declarations no source
owns (a rename leftover), so `lib/` is exactly the artifacts of `src/`.

Rules that keep this honest:

- Never edit a generated file under `lib/` — its module doc names the source
  to edit and `lint:build` fails the moment the two drift. Generated artifacts
  keep tsc's canonical formatting (four-space, compacted); review `src/` for
  every module.
- `lint:build` (`test/build-freshness.mjs`) enforces that the corpus is closed
  — every `lib/*.js` has its `src/<name>.ts`, every source has both artifacts —
  then snapshots every generated file, runs the real build, byte-compares and
  RESTORES the snapshot: a check, not a rebuild; the remedy for drift is
  `pnpm run build` plus a commit. It is part of the gate chain after
  `test:syntax`.
- Generated files are not in the `checkJs` gate at all (`tsconfig.json` covers
  `test/**` and the ambient types); their sources are type-checked by the build
  program with `noEmitOnError`, so a broken build never overwrites `lib/`.
- Every JavaScript export carries its `types` condition (enforced by
  `lint:style`), so downstream resolves these declarations; there is no
  second, hand-written type surface.
- The protocol message union and friends are the single home now: consumers
  import them (`@typedef {import("./agent-protocol.js").AgentMessage}
  AgentMessage`) instead of restating them, which is how `lib/agent.js` and
  the script-driven tests read them.

### Adding a module

1. Write `src/<name>.ts`; imports name the artifact (`./x.js`), which
   `nodenext` resolves through the TypeScript source. Move every type into the
   signature, keep the prose, and keep every exported NAME — types included,
   since consumers import them (`import("./paths.js").DistroPath`). Close the
   module doc with the note that names the generated artifact.
2. `pnpm run build`, then `pnpm test`. There is no exclude list to maintain and
   no registration step: the build and `lint:build` derive everything from
   `src/`, and `lib/` is generated output — never edit it by hand.
3. If the module gets a row of its own on the Plugins page, add its display
   metadata as `locale/<name>/en.json` and `locale/<name>/zh.json` — a
   `meta.title` / `meta.description` pair each — and expose both through
   `exports` (`./<name>/locale/en.json`, `./<name>/locale/zh.json`), which is
   what that page reads before falling back to the package `description`. The
   bundle's own pair is `locale/en.json` / `locale/zh.json`, and `subprocess`,
   `picker`, `shell-env` and `auto-preset` carry theirs; `files` already ships
   `locale/**/*.json`, and `lint:style` fails an `exports` target that does not
   exist.

## The development loop

1. Clone the repository inside the distro. Most contributors develop there.
2. Make the change.
3. Run the gates below.
4. If you changed anything under `lib/`, run `pnpm run sync:windows` first and
   then restart the DSH app. The app loads the Windows mirror (see below), so a
   restart without the sync just reloads the old code; a running process also
   caches ES modules.

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
| `pnpm test` | style checks, syntax pass, build consistency, type check, and unit tests | no |
| `pnpm run test:coverage` | unit tests with coverage | no |
| `pnpm run lint:style` | style and lint rules | no |
| `pnpm run lint:build` | the build-freshness check: every source has its artifacts and the committed bytes match a real build | no |
| `pnpm run lint:types` | the TypeScript check over `test/**` and the ambient types (`tsc --noEmit`) | no |
| `pnpm run probe` | filesystem behaviour against a real distro | yes |
| `pnpm run probe:sandbox` | what bubblewrap confines and what it does not | no |
| `pnpm run probe:sandbox-shell` | the confined executor through a real boot | yes |
| `pnpm run probe:terminal` | the terminal provider | yes |
| `pnpm run probe:substrate` | the agent filesystem substrate over a real `wsl.exe` transport | no; inside the distro |
| `pnpm run probe:watch` | the in-distro watcher over a real directory | no; inside the distro |
| `pnpm run probe:agent` | the resident-vs-one-shot fallback parity legs | no; inside the distro |
| `pnpm run probe:exec` | the agent-backed execution handle: timeout, kill, cwd failure | no; inside the distro |
| `pnpm run probe:missing-wsl` | how a `wslPath` that cannot start is reported | yes |
| `pnpm run probe:picker` | the picker's root level, its refusals and its cap | yes |
| `pnpm run probe:mode` | which POSIX-mode facts survive the share | no; Windows Node |
| `pnpm run probe:sandbox-off` | the documented opt-out on both providers | yes |

Every script above is wired in `package.json`. `pnpm test` runs `lint:style`,
`test:syntax`, `lint:build`, `lint:types` and `test:unit` in that order.
`prepublishOnly` runs `pnpm test` again at publish time, so a broken gate stops a
release before the upload.

CI runs `pnpm test` on Node 22 and 24, on both `ubuntu-latest` and
`windows-latest`, and `pnpm run test:coverage` on Node 24. The Windows runners are
there because the plugin targets Windows; the coverage thresholds need Node 22.8 or
newer, which is why that job runs on one version.

The probes marked "yes" need Windows, WSL2, a mounted harness profile and a linked
checkout, which a hosted runner does not have. Run them on your own machine and
paste the output into the pull request.

The rows marked "no; inside the distro" (`substrate`, `watch`, `agent`, `exec`)
still need Windows and WSL2, but no harness boot and no profile: run them from a
distro terminal with Node available, and they reach `wsl.exe` through interop.

Two conveniences for the real-machine set. `test/probe/run-all-when-closed.sh
--include-fs` runs all twelve probes once the app has exited. And `ci.yml` has a
`probes` job you dispatch by hand: `sandbox` runs whenever WSL is present, then
`mode`, `terminal`, `picker` and `missing-wsl` where the harness app is
installed. It is named for a self-hosted Windows runner although its `runs-on`
carries the hosted `windows-latest` label, and it is not a green no-op on a
hosted runner — the `sandbox` leg fails, not skips, where the default distro has
no bubblewrap.

## Adding a test

Choose the layer by what the test needs.

| Layer | Location | Use it for |
|---|---|---|
| Unit test | `test/*.test.mjs` | pure logic: path translation, listing, shell argument building, terminal helpers |
| Probe | `test/probe/` | behaviour that needs a real distro, a real profile, or bubblewrap |

Unit tests run under `node --test`. The `test:unit` and the `test:coverage` lists
in `package.json` name their files explicitly; a test that only touches this
repository belongs in both. Two lags in those lists today are hygiene to fix in
passing, not a pattern to copy: each names one file twice
(`test/fsio-text.test.mjs` in `test:unit`, `test/fs.boot.test.mjs` in
`test:coverage`), and `test/fs-routing.test.mjs` is in neither
(`docs/REQUIREMENTS.zh.md` tracks that as OI-7).

A test that imports a pinned `@deepseek-ai/*` package goes in the same lists and
needs no guarding — CI runs `pnpm install --frozen-lockfile` over the locked tree
before `pnpm test`. Five files import such packages at runtime today —
`test/provider.test.mjs` is what covers the assembled service rows, and
`test/composition.test.mjs` runs the loader's real patch algorithm — and a sixth
(`test/terminal-activity.test.mjs`) reaches a peer only through a JSDoc type
import, which `checkJs` still resolves.

Where a peer-free seam exists, prefer it. `test/sandbox.test.mjs` runs against
`lib/sandbox-core.js`, with a stand-in for the peer's `SandboxUnavailableError`
contract, which leaves only the one-line peer binding in `lib/sandbox.js`. That
line is covered by the harness probes, which boot the plugin and so reach
`WslSandbox` through `lib/index.js` — not by `probe:sandbox`, which reads only
the argument builder out of `lib/bwrap.js`. A test that cannot run everywhere
must skip itself — print a `SKIP` line and exit 0 — the way that file does on
`win32`, where its fake `wsl.exe` (a POSIX script) cannot execute.

Probes are shell scripts, plus the small plugin files they load: the `*-probe.mjs`
and `*-probe.yml` files in the same directory. Two shapes. The harness probes
(`run.sh`, `terminal.sh`, `sandbox-shell.sh`, `picker.sh`, `missing-wsl.sh`,
`sandbox-off.sh`) boot a throwaway profile whose setup steps are in the header of
`test/probe/run.sh`; the five others reuse the profile `run.sh` creates rather
than making their own. The distro probes (`substrate.sh`, `watch.sh`, `agent.sh`,
`exec.sh`) boot nothing: they run from a distro terminal and drive the resident
agent through the `wsl.exe` interop transport. `sandbox.sh` and `mode.sh` sit
outside both groups — no harness boot, no profile.

Keep probe output idempotent. Several probes delete their scratch files at the
start, because a leftover file from an earlier run changes the result.

## What has been verified

`pnpm test` runs the whole unit suite once the one `pnpm install` above has
fetched the pinned packages: the files that import them statically exercise the
services through the loader and their declared types, and `test:syntax` keeps a
`node --check` pass over every shipped module. What no test on a Linux leg can
reach is the Windows-plus-WSL2 topology itself: a real `wsl.exe`, a real distro,
a real harness boot. That is the gap the probes close; the archived record's
§15.4 documents the five rounds of misdiagnosis it once caused.

`test/probe/sandbox.sh` needs no harness: it uses the same arguments
`lib/sandbox.js` builds and asserts what bubblewrap does and does not confine,
recording the interop escape as `INFO` because a Linux sandbox cannot govern a
Windows process. The harness probes boot a throwaway profile bound to the distro:

- the filesystem probe asserts the write path and the write checks — a write outside
  the policy root and a write in `read-only` mode both return `FS_SANDBOX_DENIED`,
  while `danger-full-access` is the approved escalation and its write is asserted
  to land;
- the shell probe drives all three modes through `ctx.shell` and checks the refusal
  classification the tool layer returns;
- the terminal probe asserts the distro, the starting directory, and the `DSH_*`
  variables forwarded through `WSLENV`.

The setup steps for that throwaway profile are in the header of
`test/probe/run.sh`; the harness probes share the one profile it creates.

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

Counts: 28 unit test files under `test/` — 27 of them registered in the
`test:unit` list, see the OI-7 note above — which need the pinned packages
installed, and over 1000 `assert` call sites across them; 19 filesystem-probe
assertions; 15 shell-probe checks; 9 picker checks; 6 missing-executable checks;
5 mode checks; 5 opt-out checks and 10 sandbox expectations plus the recorded
escape; and 3 terminal assertions.

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
