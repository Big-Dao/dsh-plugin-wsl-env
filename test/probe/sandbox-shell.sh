#!/usr/bin/env bash
# Run the shell-confinement probe: boot a throwaway profile with the WSL shell
# executor mounted, then drive real distro commands through the seam and assert
# what the sandbox did.
#
# One-time setup is the same throwaway profile the filesystem probe uses
# (`test/probe/run.sh` documents it): `wslfs`, built from the shipped web
# template with this checkout linked. The overlay here is applied on top, so
# neither this script nor its overlay edits the profile.
#
#   test/probe/sandbox-shell.sh
#
# The bwrap semantics themselves are measured without a harness by
# `test/probe/sandbox.sh`. This script needs a distro with `bubblewrap`
# installed, because the executor fails closed without it.
#
# Every path below is derived from the machine. The overrides are listed in
# test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

# Scratch paths inside the distro, named from the distro's own home directory.
SHELL_SCRATCH="$DSH_WSL_ENV_HOME/.dsh-shellprobe"
OVERLAY="$(write_overlay sandbox-shell-probe.yml .generated-sandbox-shell-probe.yml \
  DISTRO "$DISTRO" SCRATCH "$SHELL_SCRATCH" OUTSIDE "$DSH_WSL_ENV_HOME/dsh-shellprobe-outside.txt")"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

[ -f "$PROFILE/cordis.patch.yml" ] || { echo "no probe profile at $PROFILE; see the header of test/probe/run.sh" >&2; exit 1; }
[ -x "$APP/DeepSeek Harness.exe" ] || { echo "no harness at $APP; set DSH_WSL_ENV_APP" >&2; exit 1; }

"$HERE/sync-to-windows.sh"

# The probe exits the process itself with its own status; the inherited POSIX
# DSH_* facts must not leak into the Windows process, which would read them as
# bogus paths.
set +e
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID \
    -u DSH_SHELL -u DSH_WEB_URL -u DSH_WSL_DISTRO -u DSH_WSL_HOME -u DSH_WSL_SHELL \
    ELECTRON_RUN_AS_NODE=1 \
    "$APP/DeepSeek Harness.exe" --expose-internals "$CLI" \
    --profile wslfs --patch "$OVERLAY" --no-open --port 0 >"$LOG" 2>&1
STATUS=$?
set -e

grep -a '^SHELLPROBE' "$LOG" || true
if [ "$STATUS" -ne 0 ]; then
  echo "probe exited $STATUS" >&2
  grep -av '^SHELLPROBE' "$LOG" | tail -20 >&2
  exit "$STATUS"
fi
echo "shell sandbox probe passed"
