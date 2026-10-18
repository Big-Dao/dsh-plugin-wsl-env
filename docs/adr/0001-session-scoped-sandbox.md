# ADR 0001 — Session-scoped execution world

- **Status:** proposed (spike done; implementation pending)
- **Date:** 2026-10-18
- **Supersedes:** the per-command bwrap model for *unconfined-policy* sessions
  only in the sense described below; the per-command profile remains the
  fallback until the session runtime ships.

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

The spike is `test/probe/session-sandbox.sh`. Its bwrap legs pass here; its
systemd leg must run from a real WSL terminal (the app's own shell runs under
bwrap with an unshared PID namespace, so the user manager's bus is
unreachable there), and is the remaining manual verification.

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

## Consequences

- **Setup:** systemd must be PID 1 in the distro (`/etc/wsl.conf`
  `[boot] systemd=true`), the user manager must be reachable, and `Linger`
  must be enabled for a headless `wsl.exe --exec` (`loginctl enable-linger
  $USER`). This machine satisfies the first two (`systemd=true`, 259) but has
  `Linger=no`; the probe reports it. Preflight must gate the session runtime
  with those remediations, per the plugin's existing refusal pattern.
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
2. **Launcher.** Add the scope argv/stop builder and the unit-name generator,
   with pure tests; wire it behind a `sessionSandbox` config flag (default
   off).
3. **Preflight.** Detect systemd, the user manager, `Linger`, and
   `systemd-run --user`; refuse with the remedy when the flag is on and the
   platform cannot honor it.
4. **Probes.** Extend `session-sandbox.sh` and the real-machine suite:
   background dev server across two commands, `/tmp` across a command and a
   file-tool write, `ps`/`pkill` across the terminal and a command, scope
   cleanup after session end.
5. **Default on** for sessions whose preflight passes; keep the per-command
   profile for the fallback. Update `docs/LIMITATIONS.md` (the two `/tmp`s and
   the background-process note) and the sandbox enforcement wording.

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
