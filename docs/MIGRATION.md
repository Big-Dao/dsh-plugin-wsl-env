# Configuration stability and migration

What a release may change, how a breaking configuration change is announced and
carried, and which gates a release must clear. The version table in
[RELEASING.md](RELEASING.md#1-decide-the-version) is the source for the bump; this
page is the contract those bumps follow.

## The freeze below 1.0

The package is below `1.0.0`, so the on-disk profile format and the peer pins may
still move in a **minor**. Within that freedom:

- **Adding a configuration key is a minor.** The key must have a schema default
  that preserves the previous behavior; a key that changes behavior by existing
  is a major-shaped change and waits.
- **Removing or renaming a key is a major** *or* a minor with a boot-time refusal
  that names the migration (see below). Silent acceptance of a retired key is
  never allowed: it is the failure the `preset-wsl` trap and the `substrate`
  refusal exist to prevent.
- **Changing a key's meaning is a minor with a migration note**, because a profile
  written for the old meaning keeps booting. The note must say what changed, how
  to keep the old posture, and where the behavior differs.
- **Peer compatibility is ranged.** DSH peer dependencies declare a minimum;
  development dependencies are pinned exactly. A new upstream peer line is
  tested by the [peer canary](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/.github/workflows/peer-canary.yml); changes to
  the tested baseline or supported range belong in the release note.
- **Tool names and error codes are API.** `FS_OUTSIDE_DISTRO`,
  `SANDBOX_UNAVAILABLE`, `FS_STALE_VERSION` and the diagnostic scripts
  (`doctor`, `diagnose`, `preset`, `bootstrap`) keep their names and contracts;
  a rename follows the deprecation path below.

## Deprecating a configuration value

1. **Announce it in the release that introduces the deprecation**: a CHANGELOG
   entry and the row in [CONFIGURATION.md](CONFIGURATION.md). The old value keeps
   working for that release.
2. **Keep the old spelling for one minor** when it is unambiguous. When keeping
   it would silently change behavior, refuse it at boot instead and print the
   migration — the `substrate: "share"` case: the value is refused with the
   message that says to delete the line, because serving the share is exactly
   what the plugin must not do.
3. **Remove it in the next minor** with another CHANGELOG entry. The release note
   names the version where the refusal appeared.

### Case study: `distro: ''` (0.12.0)

`distro: ''` used to mean "WSL's default distro". 0.12.0 made the empty value
mean **auto**: follow the request workdir's UNC distro. A profile that relied on
the old meaning keeps booting, but now behaves differently. The migration:

```yaml
# keep the old posture: every command in WSL's default distro
- id: preset-wsl
  config:
    plugins:
      # … full block; set on both rows …
      - id: wsl-shell
        config:
          distro: default
      - id: wsl-fs
        config:
          distro: default
```

`pnpm run preset --distro default` prints that block for manual merging.
`--out` replaces the whole destination file, including unrelated overrides;
see [CONFIGURATION.md](CONFIGURATION.md#configure-wsl-shell-and-wsl-fs). The CHANGELOG
entry for 0.12.0 states the change; this page is the durable copy. `doctor`
reports the effective distro mode in its host/distro rows, and `--dump-config`
shows the composed value.

## Gates a release must clear

| Gate | How | Runs where |
|---|---|---|
| Config docs and CHANGELOG current | review the diff; `lint:links` covers cross-references | CI |
| `pnpm test` | style, links, syntax, build freshness, tsc, 40 unit files | CI (Node 22/24, Ubuntu + Windows) |
| `pnpm run test:coverage` | lines 85 / branches 84 / functions 70 | CI (Node 24, Ubuntu) |
| Peer line tested | `peer-canary` workflow resolves `next` and runs the scratch upgrade | CI schedule/manual |
| Packed install/upgrade/uninstall | `pnpm run e2e:install` (temp `DSH_HOME`, 0.11.0 → current, marker) | manual, this machine (10/10 on 2026-10-19) |
| Real-machine probe suite | `test/probe/run-all-when-closed.sh --include-fs` (needs the app closed) | manual; 15 probes passed on this Windows/WSL machine on 2026-10-31 |
| Clean Win11 + Ubuntu first run ≤ 5 min | a clean machine, a stopwatch | **not run** (the project's machine is already configured) |
| aarch64 executed | the native 18-check suite under qemu in CI | **run in CI** (physical aarch64 WSL is out of scope; see COMPATIBILITY.md) |
| No open P0 bug for 30 days | issue tracker | time-based; cannot be asserted from a checkout |

The clean-machine first-run timing and the 30-day P0 window stay unrun until
someone measures them; aarch64 qemu is a CI gate. A release note must not
claim an unrun row, and [ROADMAP-1.0.md](ROADMAP-1.0.md#wsl-304--10-readiness)
tracks the 1.0 leftovers. A release that skips the remaining manual rows still
ships through the tag workflow, but its notes say which gates were executed.

## Verifying a migration locally

```bash
pnpm run preset --distro default --check <profile>/cordis.patch.yml  # no nested-row trap
pnpm run doctor --json                                               # effective environment facts
dsh --profile <name> --dump-config                                      # composed rows
```

A profile that fails to boot after a migration should name the remedy in the
error; if it does not, that is a bug — report it with the `doctor --json` output.
