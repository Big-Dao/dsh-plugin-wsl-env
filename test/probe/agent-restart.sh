#!/usr/bin/env bash
# Run the agent kill/restart probe: boot a throwaway profile whose shell
# executor pins the profile's distro, warm the resident, `pkill` every
# resident from inside, and verify the next commands recover through the
# executor's one rebuild (WSL-207's residue).
#
# One-time setup is the same throwaway profile the other probes use
# (`test/probe/run.sh` documents it): `wslfs` must exist and the plugin must be
# linked into it.
#
# The harness must NOT already be running when this script boots it — its CLI
# hands the arguments to the live instance and exits 0 without running the
# probe (see `test/probe/run.sh`). Inside the suite (`run-all-when-closed.sh`)
# that ordering is the suite's own.
#
#   test/probe/agent-restart.sh
#
# Paths come from test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# prereq: command -v pkill >/dev/null 2>&1 || { echo "agent-restart probe needs pkill (procps) in this distro"; exit 1; }
. "$HERE/env.sh"

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

OVERLAY="$(write_overlay agent-restart-probe.yml .generated-agent-restart-probe.yml \
  DISTRO "$DISTRO" \
  PROBE_UNC "$UNC\\test\\probe\\agent-restart-probe.mjs" \
  REPORT_UNC "$UNC\\test\\probe\\agent-restart-report.txt")"

[ -f "$PROFILE/cordis.patch.yml" ] || { echo "no probe profile at $PROFILE; see the header of test/probe/run.sh" >&2; exit 1; }
[ -x "$APP/DeepSeek Harness.exe" ] || { echo "no harness at $APP; set DSH_WSL_ENV_APP" >&2; exit 1; }

"$HERE/sync-to-windows.sh"

set +e
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID \
    -u DSH_SHELL -u DSH_WEB_URL -u DSH_WSL_DISTRO -u DSH_WSL_HOME -u DSH_WSL_SHELL \
    ELECTRON_RUN_AS_NODE=1 \
    "$APP/DeepSeek Harness.exe" --expose-internals "$CLI" \
    --profile wslfs --patch "$OVERLAY" --no-open --port 0 >"$LOG" 2>&1
STATUS=$?
set -e

if [ -f "$HERE/agent-restart-report.txt" ]; then
  cat "$HERE/agent-restart-report.txt"
else
  echo "no report written; harness log:" >&2
  tail -20 "$LOG" >&2
fi
exit "$STATUS"
