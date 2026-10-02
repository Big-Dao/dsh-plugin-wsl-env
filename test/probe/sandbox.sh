#!/usr/bin/env bash
# Probe: what a Linux-side bwrap sandbox actually governs inside a distro.
#
# This is the empirical half of the WSL sandbox design: before the plugin
# confines anything, the profile arguments below are asserted here, so the
# claims in README ("workspace-write means this, and not that") are measured
# rather than assumed. Run it from INSIDE the distro:
#
#   test/probe/sandbox.sh          # or: npm run probe:sandbox
#
# Overridable:
#   DSH_WSL_ENV_WORKSPACE   the writable root to grant (default: this checkout)
#   DSH_WSL_ENV_CMD         cmd.exe as this shell sees it (default:
#                           /mnt/c/Windows/System32/cmd.exe, for the interop check)
#
# Exit status: 0 when every behavioural expectation holds. The WSL interop
# escape is reported as INFO, not FAIL — a Linux sandbox cannot govern a
# Windows process, and the point of recording it is to keep the claim honest.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS="${DSH_WSL_ENV_WORKSPACE:-$(cd "$HERE/../.." && pwd)}"
CMD_EXE="${DSH_WSL_ENV_CMD:-/mnt/c/Windows/System32/cmd.exe}"

# The exact profile @deepseek-ai/dsh-sandbox-local builds for its Linux bwrap
# rung (`packages/sandbox/sandbox-local/src/profiles.ts`), read-only form plus
# the workspace-write grant. Kept in lockstep with lib/sandbox.js.
RO=('--ro-bind' / / '--dev' /dev '--unshare-pid' '--proc' /proc '--die-with-parent')
WW=("${RO[@]}" '--tmpfs' /tmp '--bind' "$WS" "$WS")

OUTSIDE="/home/$USER/dsh-sandbox-probe-outside.txt"
SCRATCH="$WS/.sandbox-probe"
passed=0
failed=0

report() { # report <PASS|FAIL|INFO> <name> [detail]
  printf '%-4s  %s%s\n' "$1" "$2" "${3:+  — $3}"
  case "$1" in
    PASS) passed=$((passed + 1)) ;;
    FAIL) failed=$((failed + 1)) ;;
  esac
}

# Run a command under one profile and capture combined output + status.
run() { local -n profile="$1"; shift; bwrap "${profile[@]}" -- "$@" 2>&1; }

expect_status() { # expect_status <name> <want: zero|nonzero> <profile> <cmd...>
  local name="$1" want="$2" prof="$3"; shift 3
  local out status
  out="$(run "$prof" "$@")"; status=$?
  if { [ "$want" = zero ] && [ "$status" -eq 0 ]; } || { [ "$want" = nonzero ] && [ "$status" -ne 0 ]; }; then
    report PASS "$name"
  else
    report FAIL "$name" "status=$status out=$(printf '%s' "$out" | head -1)"
  fi
}

expect_denied() { # expect_denied <name> <profile> <cmd...>  — must fail with EROFS
  local name="$1" prof="$2"; shift 2
  local out status
  out="$(run "$prof" "$@")"; status=$?
  if [ "$status" -eq 0 ]; then
    report FAIL "$name" "the write was ALLOWED"
  elif printf '%s' "$out" | grep -qi 'read-only file system'; then
    report PASS "$name" "EROFS (bwrap's denial dialect)"
  else
    report FAIL "$name" "denied, but not in the bwrap dialect: $(printf '%s' "$out" | head -1)"
  fi
}

echo "== WSL sandbox probe =="
echo "workspace: $WS"
echo "bwrap:     $(command -v bwrap || echo 'MISSING')"
echo

if ! command -v bwrap >/dev/null 2>&1; then
  report FAIL "bwrap is installed" "install it: sudo apt install bubblewrap"
  echo
  echo "RESULT: cannot probe without bwrap (the provider fails closed in this state)"
  exit 1
fi

# 1. The functional probe the provider itself runs (upstream uses `true`).
expect_status "bwrap can create the read-only profile" zero RO true

# 2. read-only denies writes and still permits reads.
expect_denied "read-only denies a write outside the workspace" RO sh -c "echo x > $OUTSIDE"
expect_status "read-only permits reads" zero RO sh -c 'cat /etc/os-release >/dev/null'

# 3. workspace-write grants exactly the workspace root.
mkdir -p "$SCRATCH"
expect_status "workspace-write writes inside the workspace" zero WW sh -c "echo probe > $SCRATCH/inside.txt"
[ -f "$SCRATCH/inside.txt" ] && report PASS "the workspace write reached the real filesystem" || report FAIL "the workspace write reached the real filesystem"
expect_denied "workspace-write denies a write outside the workspace" WW sh -c "echo x > $OUTSIDE"
[ -f "$OUTSIDE" ] && { report FAIL "the denied write left no file"; rm -f "$OUTSIDE"; } || report PASS "the denied write left no file"

# 4. The temp area is an ephemeral mount, not the distro's /tmp.
expect_status "workspace-write writes its own /tmp" zero WW sh -c 'echo probe > /tmp/dsh-sandbox-probe.txt'
[ -f /tmp/dsh-sandbox-probe.txt ] && { report FAIL "the sandbox /tmp leaked into the distro's /tmp"; rm -f /tmp/dsh-sandbox-probe.txt; } || report PASS "the sandbox /tmp is ephemeral"

# 5. The Windows filesystem is read-only under both profiles.
expect_denied "the Windows mount is read-only" WW sh -c 'echo x > /mnt/c/dsh-sandbox-probe-win.txt'

# 6. The interop escape: a Windows binary still runs and still writes on the
#    Windows side, because it is not a Linux process. Recorded, never failed.
#    The Windows temp directory is asked of cmd.exe rather than guessed from
#    $USER, which is the DISTRO user and need not match the Windows account.
if [ -x "$CMD_EXE" ]; then
  WIN_TEMP="$("$CMD_EXE" /c 'echo %TEMP%' 2>/dev/null | tr -d '\r\n')"
  ESCAPE_POSIX="$(printf '%s' "$WIN_TEMP" | sed -e 's|^\([A-Za-z]\):|/mnt/\l\1|' -e 's|\\|/|g')/dsh-wsl-sandbox-escape.txt"
  rm -f "$ESCAPE_POSIX" 2>/dev/null
  run WW sh -c "cd /mnt/c && '$CMD_EXE' /c 'echo escaped > %TEMP%\\dsh-wsl-sandbox-escape.txt'" >/dev/null 2>&1
  if [ -f "$ESCAPE_POSIX" ]; then
    rm -f "$ESCAPE_POSIX"
    report INFO "interop escape is open" "a Windows process ran and wrote outside the Linux sandbox — inherent, documented"
  else
    report PASS "no interop escape observed" "unexpected for WSL; re-check before claiming a boundary"
  fi
else
  report INFO "interop escape not probed" "no $CMD_EXE from this shell"
fi

rm -rf "$SCRATCH"
echo
if [ "$failed" -eq 0 ]; then
  echo "RESULT: all $passed expectations held"
  exit 0
fi
echo "RESULT: $failed of $((passed + failed)) expectations failed"
exit 1
