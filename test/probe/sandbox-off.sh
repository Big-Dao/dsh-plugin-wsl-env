#!/usr/bin/env bash
# Run the sandbox-opt-out probe: boot a throwaway profile with `sandbox: false` on both
# providers, then assert that the mode facts disappear and that the operations which
# would be refused under `workspace-write` now happen.
#
# One-time setup is the same throwaway profile the filesystem probe uses
# (`test/probe/run.sh` documents it).
#
#   test/probe/sandbox-off.sh
#
# Paths come from test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

OUTSIDE="$DSH_WSL_ENV_HOME/dsh-sandboxoff-outside.txt"
OVERLAY="$(write_overlay sandbox-off-probe.yml .generated-sandbox-off-probe.yml \
  DISTRO "$DISTRO" OUTSIDE "$OUTSIDE" \
  PROBE_UNC "$UNC\\test\\probe\\sandbox-off-probe.mjs" \
  REPORT_UNC "$UNC\\test\\probe\\sandbox-off-report.txt")"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

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

if [ -f "$HERE/sandbox-off-report.txt" ]; then
  cat "$HERE/sandbox-off-report.txt"
else
  echo "no report was written; harness output follows" >&2
  tail -20 "$LOG" >&2
fi
if [ "$STATUS" -ne 0 ]; then
  echo "probe exited $STATUS" >&2
  exit "$STATUS"
fi
echo "sandbox-off probe passed"
