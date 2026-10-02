#!/usr/bin/env bash
# Run the missing-executable probe: boot a throwaway profile whose `wslPath` cannot
# start, and assert how that failure is reported.
#
# One-time setup is the same throwaway profile the filesystem probe uses
# (`test/probe/run.sh` documents it). Nothing is uninstalled: the overlay points
# `wslPath` at a program that does not exist.
#
#   test/probe/missing-wsl.sh
#
# Paths come from test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

SCRATCH="$DSH_WSL_ENV_HOME/.dsh-missingwslprobe"
OVERLAY="$(write_overlay missing-wsl-probe.yml .generated-missing-wsl-probe.yml \
  MISSING_WSL 'C:\dsh-plugin-wsl-env-probe\no-such-wsl.exe' \
  SCRATCH "$SCRATCH" \
  PROBE_UNC "$UNC\\test\\probe\\missing-wsl-probe.mjs" \
  REPORT_UNC "$UNC\\test\\probe\\missing-wsl-report.txt")"
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

if [ -f "$HERE/missing-wsl-report.txt" ]; then
  cat "$HERE/missing-wsl-report.txt"
else
  echo "no report was written; harness output follows" >&2
  tail -20 "$LOG" >&2
fi
if [ "$STATUS" -ne 0 ]; then
  echo "probe exited $STATUS" >&2
  exit "$STATUS"
fi
echo "missing-wsl probe passed"
