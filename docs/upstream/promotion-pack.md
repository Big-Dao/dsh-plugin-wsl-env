# Promotion pack: moving this plugin into `packages/wsl/*`

Status: packaging proposal (2026-10-19). This document is the layout and proof
half of WSL-301; the seam-by-seam design stays in
[promotion-map.md](promotion-map.md), [rfc-wsl-workspaces.md](rfc-wsl-workspaces.md)
and the `docs/UPSTREAM-*.md` notes. It does not repeat them.

The decision it records: **promotion is packaging and proof, not a blocking
dependency.** Every seam below can be absent and the plugin still installs,
boots a profile and passes its gates — that property is the reason the promotion
can wait.

## Package layout

`packages/wsl/` would mirror the ssh family's shape: small capability packages
with a thin integration package, instead of one large plugin.

| Package | Responsibility | Test split | Seam dependency |
|---|---|---|---|
| `wsl-core` | path coordinate translation (`paths.ts`), distro selection (`distro-route.ts`), `wsl.exe` capture primitives (`wsl.ts`) | pure unit tests (`paths`, `distro-route`, `wsl`) | none |
| `wsl-agent` | resident v5 protocol, native backend selection, session runtime/scope, agent errors | `agent`, `agent-protocol`, `agent-exec`, `native-agent`, `session-scope`, `session-runtime` | none (own transport) |
| `wsl-shell` | shell executor, bwrap profiles, sandbox facts | `shell`, `sandbox`, `provider` (executor half) | spawn seam needed only for the base-class argv hook |
| `wsl-fs` | filesystem provider, fsio substrate, root-plane routing | `fs-decisions`, `fs-routing`, `fsio-agent`, `fsio-text`, `fs-substrate` | fsio export (`UPSTREAM-FSIO-EXPORT`) optional |
| `wsl-terminal` | GUI terminal routing | `terminal`, `terminal-activity` | terminal title (`UPSTREAM-TERMINAL-TITLE`) |
| `wsl-picker` | directory picker | `picker`, `listing` | none (provider seam exists) |
| `wsl-search` | in-distro search | `search-route`, `search-exec` | search provider seam (argv interception today) |
| `wsl-git` | workspace-change snapshots | `git-route` | none (top-level subprocess insert) |
| `wsl-preflight` | session-start advisory + doctor | `preflight`, `doctor`, `peers` | session notice (`UPSTREAM-SESSION-NOTICE`) |
| `wsl-preset` | the `preset-wsl` bundle block | composition test | agent-preset registry |
| `wsl-integration` | composition boot, probes, e2e | `composition`, `test/probe/*`, `test/e2e/install.sh` | none |

Why these boundaries: each row is already a module boundary in `src/`, and its
tests already run against the compiled `lib/` artifact. The split adds package
manifests and per-package `exports`, not new code.

## Seam and RFC index

| Seam | Upstream package | State in this repo | Document |
|---|---|---|---|
| Session environment resolver | agent preset registry | works via the `preset-wsl` isolate realm; a first-class resolver is proposed | [promotion-map.md](promotion-map.md) §4–5 |
| `FileReferenceTraversal` | `dsh-file-reference-local` | RFC addendum ① written; consumer built, unwired (9p walk measured) | [`UPSTREAM-FILE-REFERENCE-SEAM.md`](../UPSTREAM-FILE-REFERENCE-SEAM.md) |
| Search provider | `dsh-tool-search` / host search | argv-shape interception today; provider seam proposed | [promotion-map.md](promotion-map.md) |
| LSP pair (`fs` + `subprocess` in one world) | `dsh-lsp` / `dsh-lsp-stdio` | composition does not mount LSP; needs a preset-scoped subprocess provider | [`UPSTREAM-LSP-SEAM.md`](../UPSTREAM-LSP-SEAM.md) |
| Session notice | none | no plugin-facing notice seam; runtime-context workaround | [`UPSTREAM-SESSION-NOTICE.md`](../UPSTREAM-SESSION-NOTICE.md) |
| Spawn-spec hook | `dsh-bash-local` | private member bridged with a documented `@ts-expect-error` | [`UPSTREAM-SPAWN-SEAM.md`](../UPSTREAM-SPAWN-SEAM.md) |
| Terminal title / font | `dsh-api-terminal-controller`, client | title cannot follow the per-session shell; font forwarding absent | [`UPSTREAM-TERMINAL-TITLE.md`](../UPSTREAM-TERMINAL-TITLE.md), [`UPSTREAM-TERMINAL-FONT.md`](../UPSTREAM-TERMINAL-FONT.md) |
| fsio module export | `dsh-fs-local` | module-internal; replicated in `fsio-text.ts` | [`UPSTREAM-FSIO-EXPORT.md`](../UPSTREAM-FSIO-EXPORT.md) |

## What the composition boot test proves today

[`test/composition.test.mjs`](../../test/composition.test.mjs) applies the
checkout's real `cordis.patch.yml` through `applyEntryPatches` — the same call
`boot()` makes — over a minimal stand-in for the upstream rows, then boots the
composed root filesystem through the real `Loader` and exercises its host and
distro paths. It asserts:

- every composed row has an id and a name (or is a group), no duplicate ids, and
  no skipped-patch warnings;
- `workspace-files` stays enabled, `fs-sandbox` is disabled by name, and
  `fs-routing` / `wsl-preflight` mount as real top-level rows;
- the host-side disables (`subprocess`, `directory-picker`) still land;
- the routing overlay (probe profile + `fs-routing` row) applies with no
  warnings, and the router starts through the Loader, not just composes.

What it does **not** prove, and what a real-composition boot test would add:

- the desktop bundle's full tree (agent presets, terminal controller, GUI slots)
  rather than a minimal upstream stand-in;
- that `preset-wsl` mounts under the agent-preset registry's audit
  (`Preset services require isolate realms`);
- the terminal and picker providers through a real boot;
- two distros at once.

The install path is proven separately by
[`test/e2e/install.sh`](../../test/e2e/install.sh): a packed tarball installs
into a fresh `DSH_HOME`, `--dump-config` composes it with no skipped-patch
warnings, and removal leaves no rows. That is a real CLI composition, not a
unit stub.

## Proof that no seam is required

- `pnpm test` (40 files) passes with only the published peers installed; no
  upstream checkout, patch or fork is present.
- `pnpm run e2e:install` passes against the packed tarball (10/10 on this
  machine), including the upgrade leg.
- The real-machine probe suite runs with the same package (harness probes need
  the app closed; the distro probes do not).
- CI covers Node 22 and 24 on both Ubuntu and Windows.

So promotion work is: move files, add package manifests, keep the tests with
their modules, and add a boot test. None of it changes the plugin's dependency
on the published peers, and none of it is required for the plugin to work.
