#!/usr/bin/env bash
# Run the full harness probe suite AFTER the harness application exits.
#
# Why this exists: the probes boot their own harness instance, and the CLI
# hands arguments to a live instance if one is running — indistinguishable
# from a pass. The agent that stages this script lives inside the harness
# process, so it cannot wait for the exit itself; instead the script is
# launched DETACHED inside the distro (setsid, stdio redirected), where it
# survives the harness and its sandbox, polls for the app to close, then runs
# the suite and writes everything to one log the agent reads on reopen.
#
#   test/probe/run-all-when-closed.sh [--include-fs]
#
# --include-fs also runs run.sh, the filesystem-mutation probe (the slowest,
# and the one that needs the throwaway wslfs profile set up per its header).
# Without it: terminal.sh, mode.sh, missing-wsl.sh, sandbox.sh, sandbox-shell.sh,
# sandbox-off.sh, picker.sh, fs-routing.sh — the fast behavioural set. native-session.sh needs
# the packaged native binary and exercises its own session scope (the app may
# be running; the probe releases the scope it creates).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRATCH="$HERE/.scratch"
mkdir -p "$SCRATCH"
LOG="$(mktemp "$SCRATCH/full-probe.XXXXXX.log")"

echo "full probe suite; log: $LOG" >&2
echo "waiting for the harness application to close..." >&2

# Poll the Windows process list through interop until the app is gone.
# Three failure modes are kept apart on purpose:
#   * `grep -q` would exit as soon as it matches, tasklist would die of
#     SIGPIPE, and `pipefail` would read that as "the app is gone" on the
#     first iteration — so the list is read fully;
#   * a tasklist that CANNOT RUN (missing interop, a stripped PATH) must not
#     be read as "no app" either: it is retried, then aborts the run;
#   * only a successful read with no matching process ends the wait.
FAILED=0
while true; do
  if listing="$(tasklist.exe 2>/dev/null | tr -d '\0')"; then
    FAILED=0
    printf '%s\n' "$listing" | grep -qi "DeepSeek Harness.exe" || break
  else
    FAILED=$((FAILED + 1))
    if [ "$FAILED" -ge 12 ]; then
      echo "tasklist.exe is unreachable; cannot tell whether the app is closed — aborting instead of guessing" >&2
      exit 1
    fi
  fi
  sleep 5
done
echo "harness closed at $(date), starting the suite" >&2

declare -a SUITE=(terminal.sh mode.sh missing-wsl.sh sandbox.sh sandbox-shell.sh interop-shell.sh sandbox-off.sh picker.sh fs-routing.sh agent.sh watch.sh substrate.sh exec.sh native-session.sh)
if [ "${1:-}" = "--include-fs" ]; then
  SUITE=("run.sh" "${SUITE[@]}")
fi

FAILURES=0
for probe in "${SUITE[@]}"; do
  echo ""
  echo "═══ $probe ═══" | tee -a "$LOG"
  if bash "$HERE/$probe" >>"$LOG" 2>&1; then
    echo "PASS  $probe" | tee -a "$LOG"
  else
    echo "FAIL  $probe (status $?)" | tee -a "$LOG"
    FAILURES=$((FAILURES + 1))
  fi
done

echo ""
echo "done: ${#SUITE[@]} probes, $FAILURES failures; full log in $LOG" | tee -a "$LOG"
exit "$FAILURES"
