#!/usr/bin/env bash
# Run the POSIX-mode probe against the share.
#
# `mode-probe.mjs` needs Windows Node but no harness boot and no profile. It asks the
# share the three questions the filesystem backend's publication step depends on:
# whether a host `stat` sees the distro's POSIX mode, whether a host `chmod` takes
# effect, and whether an in-distro `chmod` of a staged temp file survives a host-side
# rename over the target. Those answers are what the "a host chmod is silently
# ignored" limitation and the mode-preservation steps of `fs-probe.mjs` rest on.
#
#   test/probe/mode.sh
#
# Paths come from test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

[ -x "$APP/DeepSeek Harness.exe" ] || { echo "no harness at $APP; set DSH_WSL_ENV_APP" >&2; exit 1; }

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

# The inherited POSIX DSH_* facts must not leak into the Windows process, which
# would read them as bogus paths.
set +e
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID \
    -u DSH_SHELL -u DSH_WEB_URL -u DSH_WSL_DISTRO -u DSH_WSL_HOME -u DSH_WSL_SHELL \
    ELECTRON_RUN_AS_NODE=1 \
    "$APP/DeepSeek Harness.exe" "$HERE/mode-probe.mjs" >"$LOG" 2>&1
STATUS=$?
set -e

cat "$LOG"
if [ "$STATUS" -ne 0 ]; then
  echo "mode probe exited $STATUS" >&2
  exit "$STATUS"
fi
echo "mode probe passed"
