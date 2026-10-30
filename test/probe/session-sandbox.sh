#!/usr/bin/env bash
# Manual spike for the session-scoped sandbox (docs/adr/0001).
#
# Run from a real WSL distro terminal — NOT from inside DSH: the app's own
# shell tool runs under bwrap with --unshare-pid, so the user manager's bus is
# unreachable there and every process check would describe the sandbox, not
# the session.
#
#   bash test/probe/session-sandbox.sh
#
# The script checks the primitives the ADR relies on:
#   1. the user manager is reachable and the user can linger;
#   2. a background process started under a transient scope outlives the
#      scope's main command, is visible in ps, and dies with the scope;
#   3. a bwrap profile WITHOUT --unshare-pid keeps a background process alive
#      and visible (the current per-command profile with --unshare-pid kills
#      it — the same command is run both ways);
#   4. --bind /tmp shares the distro's /tmp, --tmpfs /tmp isolates it.
#
# Nothing here is wired into `pnpm test`; the systemd leg needs a real session.
set -u

USER="${USER:-$(id -un 2>/dev/null || echo root)}"
export USER

passed=0
failed=0
skipped=0
ok() { printf 'PASS  %s\n' "$1"; passed=$((passed + 1)); }
bad() { printf 'FAIL  %s\n' "$1"; failed=$((failed + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; skipped=$((skipped + 1)); }

marker="dsh-session-spike-$$"
work=$(mktemp -d "${TMPDIR:-/tmp}/dsh-session-spike.XXXXXX")
cleanup() {
  pkill -f -- "$marker" 2>/dev/null || true
  rm -rf -- "$work"
}
trap cleanup EXIT

printf '== systemd ==\n'
if [ "$(ps -p 1 -o comm= 2>/dev/null)" != "systemd" ]; then
  skip "systemd is PID 1 (this shell runs inside a PID namespace; run from a WSL terminal)"
else
  ok "systemd is PID 1"
  if systemctl --user is-system-running >/dev/null 2>&1; then
    ok "systemd --user is reachable"
    linger=$(loginctl show-user "$USER" -p Linger 2>/dev/null || true)
    if [ "$linger" = "Linger=yes" ]; then
      ok "the user manager lingers without a login session"
    else
      skip "Linger is '$linger' — run 'loginctl enable-linger $USER' for a headless session"
    fi
    unit="$marker-scope"
    if systemd-run --user --scope --quiet --unit="$unit" sh -c "sh -c 'sleep 5' $marker & echo started" >/dev/null 2>&1; then
      sleep 0.5
      if pgrep -f -- "$marker" >/dev/null 2>&1; then
        ok "a background process outlives the scope's main command"
        # The point is ps visibility, not lookup: show the row, do not pgrep.
        # shellcheck disable=SC2009
        if ps -eo pid,ppid,args | grep -F -- "$marker" | grep -v grep >/dev/null 2>&1; then
          ok "the background process is visible in ps"
        else
          bad "the background process is not visible in ps"
        fi
      else
        bad "the background process did not outlive the command"
      fi
      if systemctl --user stop "$unit.scope" >/dev/null 2>&1; then
        sleep 0.5
        if pgrep -f -- "$marker" >/dev/null 2>&1; then
          bad "stopping the scope left its processes behind"
        else
          ok "stopping the scope clears its process tree"
        fi
      else
        bad "systemctl --user stop $unit.scope failed"
      fi
    else
      bad "systemd-run --user --scope failed"
    fi
  else
    skip "systemd --user is not reachable (no user manager; enable lingering and log in again)"
  fi
fi

printf '== bwrap: process lifetime and ps ==\n'
if ! command -v bwrap >/dev/null 2>&1; then
  skip "bwrap is not installed"
else
  base=(--ro-bind / / --dev /dev --proc /proc --die-with-parent --bind /tmp /tmp --bind "$work" "$work")
  bwrap "${base[@]}" -- sh -lc "sh -c 'sleep 5' $marker & echo started" >/dev/null 2>&1 || bad "the no-PID-namespace bwrap run failed"
  sleep 0.5
  if pgrep -f -- "$marker" >/dev/null 2>&1; then
    ok "without --unshare-pid, a background process survives the command"
    # The point is ps visibility, not lookup: show the row, do not pgrep.
    # shellcheck disable=SC2009
    if ps -eo args | grep -F -- "$marker" | grep -v grep >/dev/null 2>&1; then
      ok "it is visible in ps"
    else
      bad "it is not visible in ps"
    fi
  else
    bad "without --unshare-pid, the background process did not survive"
  fi
  pkill -f -- "$marker" 2>/dev/null || true

  bwrap "${base[@]}" --unshare-pid -- sh -lc "sh -c 'sleep 5' $marker & echo started" >/dev/null 2>&1 || bad "the PID-namespace bwrap run failed"
  sleep 0.5
  if pgrep -f -- "$marker" >/dev/null 2>&1; then
    bad "with --unshare-pid, the background process survived (expected it to die with the namespace)"
    pkill -f -- "$marker" 2>/dev/null || true
  else
    ok "with --unshare-pid, the background process dies with the command"
  fi

  printf '== bwrap: /tmp ==\n'
  echo shared >"/tmp/$marker"
  if bwrap "${base[@]}" -- sh -c "cat /tmp/$marker" 2>/dev/null | grep -qx shared; then
    ok "--bind /tmp shares the distro's /tmp"
  else
    bad "--bind /tmp did not share /tmp"
  fi
  if bwrap --ro-bind / / --dev /dev --proc /proc --die-with-parent --tmpfs /tmp --bind "$work" "$work" -- sh -c "cat /tmp/$marker" >/dev/null 2>&1; then
    bad "--tmpfs /tmp did not isolate /tmp"
  else
    ok "--tmpfs /tmp isolates /tmp"
  fi
  rm -f -- "/tmp/$marker"
fi

printf '\n%d passed, %d failed, %d skipped\n' "$passed" "$failed" "$skipped"
[ "$failed" -eq 0 ] || exit 1
