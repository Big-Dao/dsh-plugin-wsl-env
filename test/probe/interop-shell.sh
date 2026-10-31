#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

[ -f "$PROFILE/cordis.patch.yml" ] || { echo "no probe profile at $PROFILE; see test/probe/run.sh" >&2; exit 1; }
[ -x "$APP/DeepSeek Harness.exe" ] || { echo "no harness at $APP; set DSH_WSL_ENV_APP" >&2; exit 1; }

WORKSPACE="$(mktemp -d /tmp/dsh-interop-probe.XXXXXX)"
LOG="$(mktemp)"
trap 'rm -rf "$WORKSPACE"; rm -f "$LOG"' EXIT
REPORT="$HERE/interop-shell-report.txt"

"$HERE/sync-to-windows.sh"
for mode in resident oneshot; do
  if [ "$mode" = resident ]; then agent=true; session=true; else agent=false; session=false; fi
  for mask in visible masked; do
    if [ "$mask" = masked ]; then masked=true; else masked=false; fi
    OVERLAY="$(write_overlay interop-shell-probe.yml ".generated-interop-shell-$mode-$mask.yml" \
      DISTRO "$DISTRO" WORKSPACE "$WORKSPACE" AGENT "$agent" SESSION "$session" MASKED "$masked" MODE "$mode" MASK "$mask" \
      PROBE_UNC "$UNC\\test\\probe\\interop-shell-probe.mjs" REPORT_UNC "$UNC\\test\\probe\\interop-shell-report.txt")"
    rm -f "$REPORT"
    set +e
    env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID \
      -u DSH_SHELL -u DSH_WEB_URL -u DSH_WSL_DISTRO -u DSH_WSL_HOME -u DSH_WSL_SHELL \
      ELECTRON_RUN_AS_NODE=1 \
      "$APP/DeepSeek Harness.exe" --expose-internals "$CLI" \
      --profile wslfs --patch "$OVERLAY" --no-open --port 0 >"$LOG" 2>&1
    STATUS=$?
    set -e
    if [ -f "$REPORT" ]; then cat "$REPORT"; else echo "no fresh interop report for $mode/$mask" >&2; tail -20 "$LOG" >&2; exit 1; fi
    if [ "$STATUS" -ne 0 ]; then echo "harness exited $STATUS for $mode/$mask" >&2; exit "$STATUS"; fi
    if grep -q '^INTEROPPROBE FAIL ' "$REPORT" || ! grep -Fxq "INTEROPPROBE RESULT: pass $mode $mask" "$REPORT"; then
      echo "invalid or unsuccessful interop report for $mode/$mask" >&2
      exit 1
    fi
  done
done
echo "interop shell matrix passed"
