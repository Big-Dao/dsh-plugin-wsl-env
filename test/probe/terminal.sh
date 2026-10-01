#!/usr/bin/env bash
# Run the terminal probe: boot a throwaway profile, open a terminal through the
# WSL subprocess provider, and assert the shell it lands in.
#
# One-time setup is the same throwaway profile the filesystem probe uses
# (`test/probe/run.sh` documents it): `wslfs`, built from the shipped web
# template with this checkout linked. The overlay here is applied on top, so
# neither this script nor its overlay edits the profile.
#
#   test/probe/terminal.sh
#
# Overridable, for a machine laid out differently:
#
#   DSH_WSL_ENV_PROFILE  the probe profile directory, as this shell sees it
#   DSH_WSL_ENV_APP      the DeepSeek Harness install directory, as this shell sees it
#   DSH_WSL_ENV_CLI      the desktop CLI entry point, as a WINDOWS path
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="${DSH_WSL_ENV_PROFILE:-/mnt/c/Users/andyz/.dsh/profiles/wslfs}"
APP="${DSH_WSL_ENV_APP:-/mnt/c/Users/andyz/AppData/Local/Programs/DeepSeek Harness}"
CLI="${DSH_WSL_ENV_CLI:-C:\\Users\\andyz\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js}"

# Both the overlay and the probe it mounts are handed to a WINDOWS process, so
# they need the UNC spelling of this directory.
OVERLAY="\\\\wsl.localhost\\${WSL_DISTRO_NAME:-ubuntu}${HERE//\//\\}\\terminal-probe.yml"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

[ -f "$PROFILE/cordis.patch.yml" ] || { echo "no probe profile at $PROFILE; see the header of test/probe/run.sh" >&2; exit 1; }
[ -x "$APP/DeepSeek Harness.exe" ] || { echo "no harness at $APP; set DSH_WSL_ENV_APP" >&2; exit 1; }

"$HERE/sync-to-windows.sh"

# The probe opens a PTY and exits the process itself with its own status; the
# inherited POSIX DSH_* facts must not leak into the Windows process, which
# would read them as bogus paths.
set +e
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID \
    -u DSH_SHELL -u DSH_WEB_URL -u DSH_WSL_DISTRO -u DSH_WSL_HOME -u DSH_WSL_SHELL \
    ELECTRON_RUN_AS_NODE=1 \
    "$APP/DeepSeek Harness.exe" --expose-internals "$CLI" \
    --profile wslfs --patch "$OVERLAY" --no-open --port 0 >"$LOG" 2>&1
STATUS=$?
set -e

grep -a '^TERMPROBE' "$LOG" || true
if [ "$STATUS" -ne 0 ]; then
  echo "probe exited $STATUS" >&2
  grep -av '^TERMPROBE' "$LOG" | tail -20 >&2
  exit "$STATUS"
fi
echo "terminal probe passed"
