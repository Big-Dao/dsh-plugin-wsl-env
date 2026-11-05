#!/usr/bin/env bash
# Run the two-distro concurrency probe: boot a throwaway profile whose shell
# executor is the WSL one in AUTO mode, then drive two distros' commands —
# sequentially, concurrently, and as an interleaved burst — and verify each
# lands in its own distro (WSL-101's last unchecked leg).
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
#   test/probe/two-distro.sh
#
# Paths come from test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"
# prereq: n=$(wsl.exe -l -q 2>/dev/null | tr -d '\0\r' | grep -c '[a-z]'); [ "$n" -ge 2 ] || { echo "two-distro probe needs at least two installed distros (found $n)"; exit 1; }

# The first (default) distro and the first OTHER one. The prereq below has
# already guaranteed two exist; a single-distro machine never reaches here
# through the suite.
DISTRO_A="$DISTRO"
DISTRO_B="$(wsl.exe -l -q 2>/dev/null | tr -d '\0\r' | sed '/^[[:space:]]*$/d' | grep -v "^${DISTRO_A}$" | head -1)"
[ -n "$DISTRO_B" ] || { echo "no second distro found beside $DISTRO_A" >&2; exit 1; }

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

OVERLAY="$(write_overlay two-distro-probe.yml .generated-two-distro-probe.yml \
  DISTRO_A "$DISTRO_A" \
  DISTRO_B "$DISTRO_B" \
  ROOT_A "/tmp" \
  ROOT_B "/tmp" \
  PROBE_UNC "$UNC\\test\\probe\\two-distro-probe.mjs" \
  REPORT_UNC "$UNC\\test\\probe\\two-distro-report.txt")"

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

if [ -f "$HERE/two-distro-report.txt" ]; then
  cat "$HERE/two-distro-report.txt"
else
  echo "no report written; harness log:" >&2
  tail -20 "$LOG" >&2
fi
exit "$STATUS"
