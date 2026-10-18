# ADR 0001 — Session-scoped execution world

- **Status:** accepted; shipped on for the shell provider (the filesystem
  provider's unification and the crash sweep remain open)
- **Date:** 2026-10-18
- **Supersedes:** the per-command bwrap model for commands; the per-command
  profile remains for `sessionSandbox: false` and the agent-unavailable
  fallback.

## Context

The plugin's first principle is fidelity: the model and the GUI should be able
to treat the distro as a real Linux development environment, and only discover
the plugin when a policy denies something. The current execution unit is one
**command**, which breaks that in three ordinary workflows:

1. **Background processes die with the command.** `sandbox-core.confine`
   wraps each command in `bwrap … --unshare-pid --die-with-parent …`. bwrap is
   PID 1 of a new namespace; when the command exits, bwrap exits and the
   kernel kills everything in the namespace. `npm run dev &` reports success
   and is dead immediately. Measured with the shipped profile arguments:
   with `--unshare-pid` the background process is gone after the command;
   without it, the process survives (`PPID 1`) and `ps` shows it.
2. **`/tmp` is per command.** A `workspace-write` command gets a fresh tmpfs
   at `/tmp`, while the file tools' fence writes to the distro's real `/tmp`.
   Both succeed; neither sees the other. A real environment has one `/tmp`.
3. **`ps` and `pkill` only see the command's namespace.** A dev server
   started in the GUI terminal is invisible to a confined `pgrep`, and a
   confined `pkill` cannot stop it — even though both run as the same user.

The spike is `test/probe/session-sandbox.sh`. Its bwrap legs pass; the systemd
leg has since been validated through a live session runtime (not only a
terminal): `ps -p 1` is `systemd`, the command's cgroup is the session's
`dsh-wsl-*.scope`, a background process started by one command is visible to
the next, `/tmp` is shared across commands, and the scope disappears after the
session ends (`systemctl --user list-units 'dsh-wsl-*' --all` → 0 units).

## Options

**A. Session-scoped runtime (recommended).** One long-lived agent per
(session, policy) runs under a systemd **user scope**, inside a bwrap mount
profile **without `--unshare-pid`**, with the distro's real `/tmp` bound for
`workspace-write`. Commands are children of the agent. Background processes
persist, `/tmp` is shared, `ps` shows the session's processes. Session end
stops the scope; the cgroup reaps every descendant, including processes a
command left behind.

**B. Per-command systemd scope.** Keep a scope per command but drop the PID
namespace; the scope outlives the command (systemd-run --scope returns when
the command exits, the scope's cgroup remains while processes live), and the
host stops the tracked units at session end. Persistence, `/tmp` and `ps`
work, but unit-per-command means N units to track, no shared mount/profile
per session, and cleanup depends on the host remembering every unit.

**C. Status quo.** Per-command `--unshare-pid`; maximal per-command isolation,
incompatible with dev servers, shared `/tmp`, and cross-process tooling.

**D. Native supervisor with manual cgroups.** Portable only where cgroup
delegation is available; more code than A and no systemd service/journal
benefits. A later option if systemd is dropped.

## Decision

Adopt **A** as the target runtime for sessions whose policy needs a persistent
world (`workspace-write` and `read-only`; `danger-full-access` keeps the
unconfined runtime). Use **B** only as an intermediate step if A's
session-level policy granularity proves too coarse during migration.

The runtime shape:

```
wsl.exe --exec systemd-run --user --scope --quiet --unit=dsh-wsl-<session>
  --bwrap profile (mounts only; NO --unshare-pid; --bind /tmp for workspace-write)
  -- sh <agent-script>
```

- The agent is the scope's main process; its commands inherit the mount
  profile and the scope's cgroup.
- Background processes remain in the cgroup after the command returns; they
  are visible to later commands and to the GUI terminal.
- Session end: `systemctl --user stop <unit>` kills the cgroup — this replaces
  the PID namespace's per-command cleanup. The host generates and remembers
  the unit name.
- A policy change (e.g. an approved escalation) starts a new runtime; the old
  one retires through its idle timer/session end.
- `--die-with-parent` stays on bwrap for the agent itself; without a PID
  namespace it no longer kills the agent's descendants, which is the point:
  the scope owns them.

## Runtime ownership

The agent is a process-global singleton per distro today (`src/agent-shared.ts`):
the shell executor, the filesystem provider and the port snapshot share one
resident, deliberately, so startup is paid once. A **session** scope forces a
decision this ADR cannot defer:

- The scope's lifetime must be the session's, not the idle timer's — an idle
  agent closes after ten minutes, which would kill a dev server the user
  started.
- A scope is per runtime, so the runtime must be keyed by something that
  identifies the session; the shared per-distro map cannot serve unchanged.
- The shell executor and the filesystem provider are separate providers in the
  same session; they must agree on the runtime key and share its refcount, or
  one will stop a scope the other is still using.

Recommended shape: a refcounted session-runtime registry keyed by
`(distro, workspaceRoot, policy)`, created on first use by either provider and
closed when the last user releases it (session end). The idle timer remains a
safety net only while the runtime has no live users. The cost is one agent per
live session instead of one per distro; the trade is fidelity (persistent
processes, shared `/tmp`, `ps`) and cleanup (stopping the scope) for processes
and startup. The alternative — a single distro scope shared by all sessions —
is simpler, but it makes one session's background processes every session's,
and session end cannot stop the scope without killing the others; it is kept
as a fallback if the per-session cost proves unacceptable.

The launcher builders and the refcounted registry have landed
(`src/session-scope.ts`, `src/session-runtime.ts`, with unit tests), and the
shell executor is wired behind `sessionSandbox`, on in the shipped preset.
The preflight is wired (a success is cached, a failure is refused with a
remedy); the filesystem provider's unification is the next change.

## Consequences

- **Setup:** systemd must be PID 1 in the distro (`/etc/wsl.conf`
  `[boot] systemd=true`), the user manager must be reachable, `systemd-run`
  must exist, and `Linger` must be enabled for a headless `wsl.exe --exec`
  (`loginctl enable-linger $USER`). The preflight checks all four and refuses
  with the remedy; the shipped preset turns the runtime on, so a machine
  without them sees that refusal on the first command, not a silent
  per-command fallback.
- **Isolation:** mount isolation is unchanged (ro-bind, workspace bind,
  `/mnt` masking). The PID namespace is gone for commands, so a command can
  signal other processes of the same distro user. That is what a real
  environment allows; it is not a privilege gain (the same user could already
  do it from the GUI terminal), and it is strictly more faithful. The
  `enforcement: partial` contract is unchanged and should say that PID
  isolation is not claimed.
- **Resources:** one agent per (session, policy) instead of one per distro.
  Idle shutdown and the lease still apply; the scope is stopped at session
  end.
- **FS mutations:** the confined resident for writes remains a separate
  profile today. Unifying it with the session runtime is a follow-up; until
  then commands and file writes can see different mount views, which the
  current design already documents.
- **One-shot fallback:** `agent: false` and the `AgentUnavailableError` path
  still spawn per-command `wsl.exe`; they keep the old behavior and are not
  session-faithful. The fallback's contract should say so.

## Migration

1. **Spike (this ADR + probe).** Run the systemd leg in a real WSL terminal;
   record `/tmp`, background-process and `ps` results.
2. **Launcher (done).** The scope argv/stop builder, the unit-name generator
   and the refcounted registry are in place; the shell executor is wired
   behind `sessionSandbox`, on in the shipped preset.
3. **Preflight (done).** Detect systemd, the user manager, `Linger`, and
   `systemd-run --user`; refuse with the remedy when the flag is on and the
   platform cannot honor it. Only success is cached.
4. **Probes (live-validated; suite extension pending).** The live session
   showed a background process across two commands, `/tmp` across commands,
   `ps` visibility, and scope cleanup after session end. Extending
   `session-sandbox.sh` and the real-machine suite to cover the file-tool
   `/tmp` case is still open.
5. **Default on (done).** The shipped preset sets `sessionSandbox: true`;
   the per-command profile remains for `sessionSandbox: false` and the
   agent-unavailable fallback. `docs/LIMITATIONS.md` scope the two-`/tmp`
   note to the off case and records the crash caveat.

## Open questions

- `systemd-run --scope` stop semantics across systemd versions; the probe uses
  `systemctl --user stop <unit>` and falls back to reporting a failure.
- Scope vs transient service for the agent (a service would give
  `Restart=`/journal for free, but `--pipe`/stdio and exit-code propagation
  need re-verification).
- Unit naming and collision handling (`dsh-wsl-<session>` length, session
  identity source).
- Whether the FS resident and the command runtime should share a scope, and
  how a mid-session escalation retires the old one.
