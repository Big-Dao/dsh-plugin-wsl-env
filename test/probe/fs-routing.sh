#!/usr/bin/env bash
# Run the coordinate-routing probe: boot a throwaway profile whose root `fs` is
# the shipped router, then read one ext4 file through its UNC coordinate, one
# Windows file through its drive letter, and refuse another distro's UNC.
#
# One-time setup is the same throwaway profile the filesystem probe uses
# (`test/probe/run.sh` documents it): `wslfs` must exist and the plugin must be
# linked into it. This probe replaces that profile's `wsl-fs` row through an
# overlay, so no second profile is needed.
#
# The harness must NOT already be running when this script boots it — its CLI
# hands the arguments to the live instance and exits 0 without running the
# probe (see `test/probe/run.sh`).
#
#   test/probe/fs-routing.sh
#
# Paths come from test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

DISTRO_FILE="$DSH_WSL_ENV_HOME/.dsh-routing-probe.txt"
HOST_FILE="$WIN_HOME/.dsh-routing-probe.txt"
DISTRO_TEXT="distro-plane-routing-probe"
HOST_TEXT="host-plane-routing-probe"
DISTRO_UNC="\\\\wsl.localhost\\$DISTRO${DISTRO_FILE//\//\\}"

printf '%s' "$DISTRO_TEXT" > "$DISTRO_FILE"
printf '%s' "$HOST_TEXT" > "$HOST_FILE"
LOG="$(mktemp)"
trap 'rm -f "$DISTRO_FILE" "$HOST_FILE" "$LOG"' EXIT

OVERLAY="$(write_overlay fs-routing-probe.yml .generated-fs-routing-probe.yml \
  DISTRO "$DISTRO" \
  DISTRO_PATH "$DISTRO_UNC" \
  DISTRO_LINUX "$DISTRO_FILE" \
  DISTRO_TEXT "$DISTRO_TEXT" \
  HOST_PATH "$(win_path "$HOST_FILE")" \
  HOST_TEXT "$HOST_TEXT" \
  PROBE_UNC "$UNC\\test\\probe\\fs-routing-probe.mjs" \
  REPORT_UNC "$UNC\\test\\probe\\fs-routing-report.txt")"

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

if [ -f "$HERE/fs-routing-report.txt" ]; then
  cat "$HERE/fs-routing-report.txt"
else
  echo "no report was written; harness output follows" >&2
  tail -20 "$LOG" >&2
fi
if grep -q "ROUTINGPROBE FAIL" "$HERE/fs-routing-report.txt" 2>/dev/null; then
  echo "fs-routing probe reported a failing check" >&2
  exit 1
fi
if [ "$STATUS" -ne 0 ]; then
  echo "probe exited $STATUS" >&2
  exit "$STATUS"
fi
echo "fs-routing probe passed"
