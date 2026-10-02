#!/usr/bin/env bash
# Run the filesystem-mutation probe against the runtime copy of the plugin.
#
# One-time setup. `wslfs` is a throwaway profile whose only job is to bind the
# top-level `ctx.fs` to the distro; its patch layer is checked in beside this
# script.
#
#   dsh wslfs --from-default-profile web --dump-config
#   dsh plugin --profile wslfs add "link:$RUNTIME_MIRROR"   # see test/probe/sync-to-windows.sh
#   cp test/probe/wslfs-profile.patch.yml "$WIN_HOME/.dsh/profiles/wslfs/cordis.patch.yml"
#
# The profile layer is a copy, not a link: re-run that `cp` after any change to
# wslfs-profile.patch.yml, or the profile keeps asserting the old one. run.sh
# only re-syncs the plugin code, which is what the link covers.
#
# Then, from inside the distro — which is where `wsl.exe` and the UNC share are
# both reachable from:
#
#   test/probe/run.sh
#
# It syncs the runtime mirror first, whose destination is outside every Session
# workspace: through a confined shell that step needs an approved
# `danger-full-access` escalation (see the header of sync-to-windows.sh).
#
# Every path below is derived from the machine. The overrides are listed in
# test/probe/env.sh, which this script sources.
#
# The harness must NOT already be running when this script boots it. Its CLI
# hands the arguments to the live instance and exits 0 within a second — no
# profile, no probe, no output — which is indistinguishable from a pass except
# that nothing ran. Close the app first (a leftover probe process counts too).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

# The overlay is handed to a WINDOWS process, so both it and the probe it mounts
# need the UNC spelling. The template carries placeholders; this substitutes them.
OVERLAY="$(write_overlay wslfs-probe.yml .generated-wslfs-probe.yml FS_PROBE_UNC "$UNC\\test\\probe\\fs-probe.mjs")"

[ -f "$PROFILE/cordis.patch.yml" ] || { echo "no probe profile at $PROFILE; see the header of $0" >&2; exit 1; }
[ -x "$APP/DeepSeek Harness.exe" ] || { echo "no harness at $APP; set DSH_WSL_ENV_APP" >&2; exit 1; }

"$HERE/sync-to-windows.sh"

# The probe boots the harness the way a person would, then exits the process
# itself. `node` here is the Windows runtime reached through interop, and the
# DSH_* variables the distro sees are POSIX-translated (/mnt/c/...) — they must
# not leak into the Windows process, which would read them as bogus paths.
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID \
    -u DSH_SHELL -u DSH_WEB_URL -u DSH_WSL_DISTRO -u DSH_WSL_HOME -u DSH_WSL_SHELL \
    ELECTRON_RUN_AS_NODE=1 \
    "$APP/DeepSeek Harness.exe" --expose-internals "$CLI" \
    --profile wslfs --patch "$OVERLAY" --no-open --port 0 >/dev/null 2>&1 || true

cat "$HERE/fs-probe.txt"
