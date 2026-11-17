#!/usr/bin/env bash
# Probe: a session created on a WSL workspace adopts the `wsl` preset through
# the real session controller (the creation-time seam `auto-preset` wraps).
#
# The unit suite fakes that seam; this is the only check against the real host.
# It boots the throwaway `wslfs` profile (see `test/probe/run.sh`), inserts
# `auto-preset-probe.mjs` by absolute path through an overlay, and asserts the
# preset the controller reports. A host that dropped `createSession` fails with
# the reason, not a skip.
#
#   test/probe/auto-preset.sh
#
# The harness must NOT already be running (the CLI would hand the arguments to
# the live instance and exit without booting a probe).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

REPORT="$HERE/auto-preset-report.txt"
LOG="$(mktemp)"
rm -f "$REPORT"
trap 'rm -f "$LOG"' EXIT

OVERLAY="$(write_overlay auto-preset-probe.yml .generated-auto-preset-probe.yml \
  WORKSPACE_UNC "$UNC" \
  PROBE_UNC "$UNC\\test\\probe\\auto-preset-probe.mjs" \
  REPORT_UNC "$UNC\\test\\probe\\auto-preset-report.txt")"

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

if [ -f "$REPORT" ]; then
  cat "$REPORT"
else
  echo "no report was written; harness output follows" >&2
  tail -20 "$LOG" >&2
  exit 1
fi
if grep -q "AUTOPRESET FAIL" "$REPORT"; then
  echo "auto-preset probe reported a failing check" >&2
  exit 1
fi
if [ "$STATUS" -ne 0 ]; then
  echo "probe exited $STATUS" >&2
  exit "$STATUS"
fi
echo "auto-preset probe passed"
