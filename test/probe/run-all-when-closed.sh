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

declare -a SUITE=(terminal.sh mode.sh missing-wsl.sh sandbox.sh sandbox-shell.sh interop-shell.sh sandbox-off.sh picker.sh fs-routing.sh agent.sh watch.sh substrate.sh exec.sh native-session.sh)
if [ "${1:-}" = "--include-fs" ]; then
  SUITE=("run.sh" "${SUITE[@]}")
fi
# Offline tests override the suite to run fake probes against the real
# classification and summary logic, and skip the app poll (no interop on a
# Linux CI machine). Not a supported user interface.
if [ -n "${WSL_PROBE_SUITE:-}" ]; then
  read -r -a SUITE <<< "$WSL_PROBE_SUITE"
fi
SUITE_CSV="$(IFS=,; echo "${SUITE[*]}")"
RESULTS="$(mktemp "$SCRATCH/full-probe.XXXXXX.results")"
# Offline tests point this at a temp directory of fake probes; the summary,
# classification and prereq handling still come from this real script.
PROBE_DIR="${WSL_PROBE_DIR:-$HERE}"

# The summary is the verdict on every exit path: 0 full pass, 1 failures,
# 2 incomplete (skips or never-attempted probes). Exiting 0 over skips would
# report a full pass that did not happen.
finish() {
  echo "" | tee -a "$LOG"
  node "$HERE/summarize-probes.mjs" --suite "$SUITE_CSV" "$RESULTS" | tee -a "$LOG" >&2
  summary_status="${PIPESTATUS[0]}"
  echo "full log in $LOG; results in $RESULTS" | tee -a "$LOG" >&2
  exit "$summary_status"
}

echo "waiting for the harness application to close..." >&2

# Poll the Windows process list through interop until the app is gone.
# Three failure modes are kept apart on purpose:
#   * `grep -q` would exit as soon as it matches, tasklist would die of
#     SIGPIPE, and `pipefail` would read that as "the app is gone" on the
#     first iteration — so the list is read fully;
#   * a tasklist that CANNOT RUN (missing interop, a stripped PATH) must not
#     be read as "no app" either: it is retried, then aborts the run —
#     through finish(), so the summary shows every probe as not run;
#   * only a successful read with no matching process ends the wait.
if [ "${WSL_PROBE_SKIP_WAIT:-}" != "1" ]; then
  FAILED=0
  while true; do
    if listing="$(tasklist.exe 2>/dev/null | tr -d '\0')"; then
      FAILED=0
      printf '%s\n' "$listing" | grep -qi "DeepSeek Harness.exe" || break
    else
      FAILED=$((FAILED + 1))
      if [ "$FAILED" -ge 12 ]; then
        echo "tasklist.exe is unreachable; cannot tell whether the app is closed — aborting instead of guessing" >&2
        finish
      fi
    fi
    sleep 5
  done
fi
echo "harness closed at $(date), starting the suite" >&2

for probe in "${SUITE[@]}"; do
  # A probe may declare its prerequisite as a machine-readable header line
  # (`# prereq: <command>`). A failed prerequisite is a SKIP with the
  # command's stderr as the reason — never a pass, never a bare failure.
  prereq="$(sed -n 's/^# prereq: //p' "$PROBE_DIR/$probe" | head -1)"
  if [ -n "$prereq" ] && ! prereq_reason="$(bash -c "$prereq" 2>&1)"; then
    echo "" | tee -a "$LOG"
    echo "═══ $probe ═══" | tee -a "$LOG"
    echo "SKIP  $probe (${prereq_reason:-prerequisite command failed})" | tee -a "$LOG"
    printf 'SKIP\t%s\t%s\n' "$probe" "${prereq_reason:-prerequisite command failed}" >> "$RESULTS"
    continue
  fi
  echo ""
  echo "═══ $probe ═══" | tee -a "$LOG"
  if bash "$PROBE_DIR/$probe" >>"$LOG" 2>&1; then
    echo "PASS  $probe" | tee -a "$LOG"
    printf 'PASS\t%s\n' "$probe" >> "$RESULTS"
  else
    status=$?
    echo "FAIL  $probe (status $status)" | tee -a "$LOG"
    printf 'FAIL\t%s\t%s\n' "$probe" "$status" >> "$RESULTS"
  fi
done

finish
