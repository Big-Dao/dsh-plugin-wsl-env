# Configuration stability and migration

[中文](MIGRATION.zh.md)

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
| `pnpm test` | style, links, requirement citations, doc consistency, syntax, build freshness, tsc, and the unit files | CI (Node 22/24, Ubuntu + Windows) |
| `pnpm run test:coverage` | lines 85 / branches 84 / functions 70 | CI (Node 24, Ubuntu) |
| `pnpm run test:browser` | the plugin web bundle in headless Chromium (layout, clicks, badge timing); install Chromium once | CI (`browser` job, Ubuntu) and the release `Gates` |
| Peer line tested | floor `>=0.2.2-rc.2`; the `peer-canary` workflow resolves `next` and runs the scratch upgrade | CI schedule/manual |
| Packed install/upgrade/uninstall + boot | `pnpm run e2e:install` (temp `DSH_HOME`, 0.17.1 → current over the peer raise, marker; newest published stable → current, then a boot-time probe asserts all three takeovers are this plugin's classes; **host-stopped path, not the HMR update**) | manual, this machine (13/13 on 2026-11-17 with the boot leg; the origin moved 0.11.0 → 0.17.1 because dsh 0.2.2-rc.1 rightly rejects the exact-pin era) |
| HMR update path (running profile) | install the previous published version in a temp `DSH_HOME`, start the host with a live session, upgrade to the candidate through the plugin manager; assert `application: applied` and no rollback, and after a restart that `subprocess`/`fs`/`directoryPicker` are served by this plugin's classes (the update itself may land deferred, with `providers.takeover` a warn) | **passed on 2026-11-17** with a throwaway `DSH_HOME` (web template; HMR and plugin-manager rows present), 0.26.1 from the registry, a live `standard` session, and `updateBundle` to `0.26.3-rc.0`: `application: applied`, `changed: true`, `restore: null`, and after a restart all three services were this plugin's classes. The run used the headless web composition, not the desktop GUI. The same harness with a Git-pinned dependency lost the bundle from `dsh.profile.bundles` (a separate Git-install finding, not the registry path); **rechecked on 0.2.2-rc.5 on 2026-11-19 with the same commit pair and it no longer reproduces** — the selection is written back after remove and all three services stay this plugin's classes after a restart (record: docs/superpowers/probe-runs/2026-11-19-hmr-gate-rc5.md). Record: docs/superpowers/probe-runs/2026-11-17-hmr-gate.md; repeatable gate: `test/probe/hmr-gate.sh` (own `DSH_HOME`, needs GitHub access) |
| Session-scoped sandbox (ADR 0001) | `pnpm run probe:session-sandbox` from a real WSL terminal (systemd user manager; not inside DSH, not in the closed-app suite) | manual; **11 passed / 0 failed / 0 skipped on 2026-11-17** — run in a fresh WSL session (`wsl.exe -d ubuntu --exec`), which sees systemd as PID 1; the probe asserts manager reachability, linger, transient-scope lifetime, `/tmp` sharing and `--unshare-pid` |
| Real-machine probe suite | `test/probe/run-all-when-closed.sh --include-fs` (app must be closed) | Local and hosted runs are both supported. The suite was 15/15 on 2026-10-31 and 2026-11-05, grew to 17 probes and passed locally in November, and added `auto-preset.sh` and `cache-write.sh`. The GitHub-hosted `windows-latest` gate passed run `44813184608` on 2026-11-20. The complete suite has 19 entries; hosted success requires every entry to report PASS with no SKIP or NOT RUN. |
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
pnpm run e2e:install                                                 # packed install/upgrade/uninstall chain
```

The desktop app has no `dsh` command; the composed state is the profile's
`package.json` and `cordis.patch.yml`, read directly.

A profile that fails to boot after a migration should name the remedy in the
error; if it does not, that is a bug — report it with the `doctor --json` output.
