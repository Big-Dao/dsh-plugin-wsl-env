# Diagnostics: the doctor and the error-code map

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

`verdict: ready` means the first command should succeed in the target
distro(s) under the expected scope; the smoke legs (`functional.exec`,
`functional.sandbox`, `functional.fs`) prove the chain itself — frame I/O,
the confined fence, the batched substrate — not just the prerequisites.
A leg whose prerequisite failed reports `skipped` with the blocker named;
`skipped` never blocks. A read the transport could not vouch for — `wsl.exe`
timed out or wedged mid-probe, common when several distros are probed
concurrently and one of them is cold-booting — reports `unknown` after one
automatic retry, names the flake in its detail, and never blocks or feeds a
config verdict: a flaked read of `/etc/wsl.conf` says the read failed, never
that the file is broken. Rerun the doctor for a clean answer.

`--fix` ends in a re-verified report: every fix is followed by a fresh probe
of what it claims to have fixed, the affected checks carry the after state,
and the verdict is recomputed — `ready`, or the remaining blockers. Remedies
that rewrite user- or distro-owned files (`.wslconfig`, `/etc/wsl.conf`, a
WSL1 conversion, installing a distro) are never automated; the remedy text
says so.

`--bundle <path>` writes a local JSON file (report + versions + effective
configuration) for a setup report; `--redact` replaces home and DSH paths
with `<redacted-*>` placeholders. The bundle contains no file contents, no
environment variables, and no telemetry.

## The surfaces

The doctor answers through three surfaces with one report:

- **The standalone CLI** — `node scripts/doctor.mjs [distro] [--json] [--quick] [--sections …] [--locale <tag>]`.
  The authoritative surface: it loads **no peer dependency and no host
  service**, so it still starts when the plugin's own runtime is the thing
  that is broken. Only pure, peer-free `lib/` modules are imported; the two
  helpers that used to live behind peer-tainted modules (`lib/index.js`,
  `lib/update-check.js`) are inlined and drift-pinned against the lib exports
  by `test/doctor.test.mjs`. Exit 0 = `ready`, 1 = `blocked`.
- **The `/wsl-doctor` UI command** — the composer button drops a
  `/wsl-doctor [quick|full|<section>] [--distro <name>]` line; the commands
  registry executes it host-side, the handler spawns the standalone CLI, and
  the itemized report renders detached from model history (no model turn, no
  tokens). Without a command adapter (headless, ACP) the row is a no-op and
  the CLI is the surface.
- **The `wsl_doctor` model tool** — in-process via `doctorReport()`, so the
  live resident's state merges in. This is the only surface that depends on
  the model path; use the command or the CLI when the plugin's runtime itself
  is under suspicion.

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
| `FS_OUTSIDE_DISTRO` | policy | `config.effective` (the effective `distro`) | the path names another distro's share while the fence is pinned |
| `FS_IO_ERROR` | environment | `distro.reachable`, `distro.disk`, `agent.handshake`, `functional.exec`, `functional.fs` | the catch-all: an agent outage, a wedged distro, a full disk, an unmappable path |
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
| `AgentUnavailableError` | environment | `agent.handshake`, `agent.native`, `agent.cache`, `functional.exec` | the execution layer's revival budget is spent; the named state says so |

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
