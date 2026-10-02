#!/usr/bin/env bash
# Run the filesystem-mutation probe against the runtime copy of the plugin.
#
# One-time setup. `wslfs` is a throwaway profile whose only job is to bind the
# top-level `ctx.fs` to the distro; its patch layer is checked in beside this
# script.
#
#   dsh wslfs --from-default-profile web --dump-config
#   dsh plugin --profile wslfs add 'link:C:\Users\andyz\Documents\deepseek-harness\default-workspace\dsh-plugin-wsl'
#   cp test/probe/wslfs-profile.patch.yml "$USERPROFILE/.dsh/profiles/wslfs/cordis.patch.yml"
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

# The overlay is handed to a WINDOWS process, so it needs the UNC spelling of
# this directory. Derived rather than hard-coded, so the checkout can move.
OVERLAY="\\\\wsl.localhost\\${WSL_DISTRO_NAME:-ubuntu}${HERE//\//\\}\\wslfs-probe.yml"

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
