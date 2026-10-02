#!/usr/bin/env bash
# Run the directory-picker probe: boot a throwaway profile with the WSL picker
# mounted, then list the root level, a refused path, and a capped level.
#
# One-time setup is the same throwaway profile the filesystem probe uses
# (`test/probe/run.sh` documents it). The scratch level the probe lists is created
# here, inside the distro, because the cap has to be observable: three subdirectories
# against a cap of two.
#
#   test/probe/picker.sh
#
# Paths come from test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

MAX_ENTRIES=2
SCRATCH_LINUX="$DSH_WSL_ENV_HOME/.dsh-pickerprobe"
# The distro's own root, not the checkout's: a Linux path becomes a UNC path by
# replacing its separators and prefixing the share.
SCRATCH_UNC="\\\\wsl.localhost\\$DISTRO${SCRATCH_LINUX//\//\\}"
mkdir -p "$SCRATCH_LINUX/alpha" "$SCRATCH_LINUX/beta" "$SCRATCH_LINUX/gamma"

OVERLAY="$(write_overlay picker-probe.yml .generated-picker-probe.yml \
  DISTRO "$DISTRO" HOST_HOME "$(win_path "$WIN_HOME")" MAX_ENTRIES "$MAX_ENTRIES" \
  SCRATCH_UNC "$SCRATCH_UNC" \
  PROBE_UNC "$UNC\\test\\probe\\picker-probe.mjs" \
  REPORT_UNC "$UNC\\test\\probe\\picker-report.txt")"
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

if [ -f "$HERE/picker-report.txt" ]; then
  cat "$HERE/picker-report.txt"
else
  echo "no report was written; harness output follows" >&2
  tail -20 "$LOG" >&2
fi
if [ "$STATUS" -ne 0 ]; then
  echo "probe exited $STATUS" >&2
  exit "$STATUS"
fi
echo "picker probe passed"
