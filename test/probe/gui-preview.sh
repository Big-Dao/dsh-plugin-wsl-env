#!/usr/bin/env bash
# Measure the GUI-preview path (stat / listDir / 1 MiB page read) through the
# WSL filesystem backend (WSL-206). Needs a distro + node, no harness boot.
#
#   test/probe/gui-preview.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"
if ! command -v node >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || { echo "gui-preview: node not found (fnm env not loaded?)" >&2; exit 1; }

FILE="/tmp/dsh-gui-preview-1m.bin"
head -c 1048576 /dev/urandom > "$FILE"
trap 'rm -f "$FILE"' EXIT
UNC_FILE="$UNC\\..\\..\\tmp\\dsh-gui-preview-1m.bin"
# The checkout UNC maps to this repo; the file is in the distro's /tmp, so
# build its UNC from the distro share directly.
DISTRO_UNC="\\\\wsl.localhost\\$DISTRO\\tmp\\dsh-gui-preview-1m.bin"
DSH_WSL_GUI_PREVIEW_FILE="$DISTRO_UNC" \
DSH_WSL_GUI_PREVIEW_DIR="$UNC" \
  node "$HERE/gui-preview.mjs"
