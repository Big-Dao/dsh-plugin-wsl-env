# Diagnostics: the doctor and the error-code map

[中文](DIAGNOSTICS.zh.md)

Every refusal this plugin produces is named. This page is the map between
those names and the doctor: for each error code, whether the `doctor`
(`pnpm run doctor`, or `node scripts/doctor.mjs --json`) covers its
precondition, and which check id answers for it. The authoritative meaning
and remedy of each code live in [ARCHITECTURE.md](ARCHITECTURE.md#error-codes);
this page adds the diagnostics dimension and the verdict contract.

## The doctor's verdict

`doctor --json` (schemaVersion 2) ends in `verdict: "ready" | "blocked"`
with the blocking ids in `blockers`, and a per-distro breakdown in
`distroVerdicts`. The blocking rule has one invariant: **a `fail` blocks** —
config-awareness lives in the statuses (a missing systemd only fails under
`sessionSandbox: true`; `auto` names its per-command fallback and `false`
names the opt-out, both as warnings), so the verdict answers under the
**effective configuration** — the profile layers the app loads, overlaid on
the shipped preset — not the shipped defaults. The `config.effective` check
reports what was read and from where.

`verdict: ready` means every check this run covered passed in the target
distro(s) under the expected scope; it is not a promise about a later
command. The smoke legs (`functional.exec`,
`functional.sandbox`, `functional.fs`) prove the chain itself — frame I/O,
the confined fence, the batched substrate — not just the prerequisites.
`functional.exec` / `functional.fs` run the shell agent; when `auto` or
`native` selects the native binary, `functional.native` runs the same EXEC and
FSB chain over it. The shell agent is then the fallback, so its failures are
warnings and name their cause (a BusyBox distro without GNU `find` reports
`find: unrecognized: -printf` and the `findutils` remedy) — unless the shell
agent is the configured backend, or neither backend answers, where the leg
blocks. A leg whose prerequisite failed reports `skipped` with the blocker
named; `skipped` never blocks. A read the transport could not vouch for — `wsl.exe`
timed out or wedged mid-probe, common when several distros are probed
concurrently and one of them is cold-booting — reports `unknown` after one
automatic retry, names the flake in its detail, and never blocks or feeds a
config verdict: a flaked read of `/etc/wsl.conf` says the read failed, never
that the file is broken. Rerun the doctor for a clean answer.

`--fix` ends in a re-verified report: every fix is followed by a fresh probe
of what it claims to have fixed, the affected checks carry the after state,
and the verdict is recomputed — `ready`, or the remaining blockers. The
plugin-owned state is repaired automatically: the stale-scope sweep and a
purge of the agent cache when an entry is not executable (the handshake is
re-probed after the purge). `--fix-owned` narrows a run to exactly those two —
the sidebar panel's repair action uses it — and cannot be combined with
`--install`. Remedies that rewrite user- or distro-owned files (`.wslconfig`,
`/etc/wsl.conf`, a WSL1 conversion, installing a distro) are never automated;
the remedy text says so.

`--bundle <path>` writes a local JSON file (report + versions + effective
configuration) for a setup report; `--redact` replaces home and DSH paths
with `<redacted-*>` placeholders. The bundle contains no file contents, no
environment variables, and no telemetry.

## The surfaces

The doctor answers through three surfaces with one report; the sidebar's
**WSL environment** panel renders the same quick digest over its own route and
posts the full-run action (`--fix-owned`, labeled 修复 or 完整检查):

- **The standalone CLI** — `node scripts/doctor.mjs [distro] [--all] [--json] [--quick] [--sections host,sandbox,session,conf,net,agent] [--fix] [--fix-owned] [--install] [--yes] [--read-only] [--bundle <path>] [--redact] [--locale <tag>]`
  (the same line `--help` prints).
  The authoritative surface: it loads **no peer dependency and no host
  service**, so it still starts when the plugin's own runtime is the thing
  that is broken. Only pure, peer-free `lib/` modules are imported; the one
  helper that used to live behind a peer-tainted module (`lib/index.js`) is
  inlined and drift-pinned against the lib export by `test/doctor.test.mjs`. Exit 0 = `ready`, 1 = `blocked`, 2 = refused
  (`--read-only` with `--fix`/`--install`, `--fix-owned` with `--install`, or
  `--fix` on a scoped run).
- **The `/wsl-doctor` UI command** — typing
  `/wsl-doctor [quick|full|<section>] [--distro <name>]` in the composer — the commands
  registry executes it host-side, the handler spawns the standalone CLI, and
  the itemized report renders detached from model history (no model turn, no
  tokens). The sidebar's **WSL environment** panel runs the same quick
  check per distro through the authenticated status route, showing a badge with
  numbered failing items and warnings, and a second action on a checked row: the full doctor with `--fix-owned`,
  labeled **修复** when the report carries a repairable finding (stale scopes
  or a broken agent cache) and **完整检查** otherwise, answered with its
  before → after fix rows. The row also states when the check ran, its source
  (manual or the page-load background refresh), and how its results landed —
  per-status totals and per-section tallies. Each checked row expands to the
  full list of checks that run executed, grouped by section with each status
  and its evidence; the catalog rows a quick run never touched are counted
  (`N more in the full run`), not listed as results. The last result is stored locally
  (`$DSH_HOME/cache/dsh-plugin-wsl-env/status.json`, falling back to `~/.dsh`)
  so a reload still shows it; a background refresh runs only for distros that
  are already up, and a failed one replaces the stored result as observed.
  Manual warnings keep their remedies; full diagnosis still uses the entry above and `/wsl-doctor`. Without a command adapter (headless, ACP) the row is a no-op and
  the CLI is the surface. Without `--distro` the handler names the distro from
  the session's live working directory (the agent-scoped `workingDirectory`
  service first, then the Session header's `cwd`); when neither yields a WSL
  UNC path the CLI's effective configuration decides, and the shipped `auto`
  probes **every** installed distro — a sweep that costs minutes on a machine
  with several (a scoped quick run is seconds). The handler therefore bounds
  the subprocess (120 s when it has a distro, 60 s when the configuration has
  to choose, both below the command dispatcher's own deadline) so a stalled or
  unscoped run settles with a message naming the target it examined and how to
  narrow it.
- **The `wsl_doctor` model tool** — in-process via `doctorReport()`, so the
  live resident's state merges in. The collection is asynchronous: the doctor
  subprocess never blocks the Host, the tool call's cancellation kills it, and
  a two-minute deadline plus a bounded drain window settle a run whose child
  never reports. This is the only surface that depends on the model path; use
  the command or the CLI when the plugin's runtime itself is under suspicion.

One check is surface-dependent by construction: `session.preset-seam` reports
whether `auto-preset` could wrap the host's `agents.createSession` in this
process. That is host-process state, so the standalone CLI cannot see it; the
command, the panel and the model tool merge the row in. A missing row in a CLI
report means "not observable from a subprocess", not "the seam is fine".

## The map

Class legend:

- **environment** — a machine state the doctor probes; `doctor` green covers
  it.
- **policy** — a per-call decision (the sandbox fence, the distro fence);
  the doctor proves the fence's shape, the call decides the case.
- **data** — caller- or data-transient; no machine precondition exists, so
  no doctor check claims it.

| Code | Class | Doctor checks | In one line |
|---|---|---|---|
| `SANDBOX_UNAVAILABLE` | environment | `sandbox.bwrap`, `sandbox.bwrap-usable`, `functional.sandbox` | the requested confinement cannot be enforced (no usable bubblewrap) |
| `FS_SANDBOX_DENIED` | policy | `functional.sandbox` (the fence shape) | the file-effect policy refused the write, or the kernel refused it at the resident's profile |
| `SANDBOX_INVALID_ROOT` | configuration | — (the per-entry `writableRoots` check runs on first use; the doctor does not pre-run it) | an extra writable root is malformed, names another world, or fails the physical-directory check |
| `FS_OUTSIDE_DISTRO` | policy | `config.effective` (the effective `distro`) | the path names another distro's share while the fence is pinned |
| `FS_IO_ERROR` | environment | `distro.reachable`, `distro.disk`, `host.disk`, `agent.handshake`, `agent.home-writable`, `functional.exec`, `functional.fs` | the catch-all: an agent outage, a wedged distro, a full disk, an unmappable path |
| `FS_NOT_FOUND` | data | — | the path does not exist — the ordinary answer |
| `FS_NOT_REGULAR_FILE` | data | — | a directory, symlink or device where a regular file is required |
| `FS_NOT_DIRECTORY` | data | — | a list was asked of a non-directory |
| `FS_NOT_TEXT` | data | — | the content is not UTF-8 text |
| `FS_TOO_LARGE` | data | — | the content exceeds the caller's byte cap |
| `FS_ABORTED` | data | — | the caller's own signal cancelled the call |
| `FS_NOT_OBSERVED` | data | — | a guarded create targeted a file that existed unread |
| `FS_STALE_VERSION` | data | — | the caller's version is stale; re-read and retry |
| `FS_EDIT_NOT_FOUND` | data | — | the literal edit matched nothing |
| `FS_AMBIGUOUS_EDIT` | data | — | the literal edit matched more than once |
| `FS_PATCH_MISMATCH` | data | — | the hunks no longer match the file; rebuild them |
| `FS_SAME_TARGET` | data | — | a move whose source and destination are the same file |
| `AgentUnavailableError` | environment | `agent.handshake`, `agent.native`, `agent.cache`, `agent.home-writable`, `functional.exec`, `functional.native` | the execution layer's revival budget is spent; the named state says so |

The agent's structured FS reasons (`notfound`, `notdir`, `perm`, `loop`,
`stale`, `io`) map onto the codes above at `lib/fsio-agent.js`; the wire
dialect itself is [AGENT-PROTOCOL-V7.md](AGENT-PROTOCOL-V7.md).

## When the doctor is green but a call still fails

That is the **policy** and **data** classes doing their jobs: a refusal the
doctor cannot predict because it depends on the call, not the machine. If a
call fails repeatedly with an **environment**-class code while the doctor
says `ready`, that is a bug — file it with the `doctor --bundle` output (a
[setup report](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/.github/ISSUE_TEMPLATE/setup_report.yml)
carries it).
