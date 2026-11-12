#!/usr/bin/env bash
# Report the open-in-app state of this machine.
#
# The plugin no longer patches the installed app.asar. Its `wsl-open-in-app`
# row registers an authenticated launch route and scrubs
# ELECTRON_RUN_AS_NODE from the editor child's environment, so the plugin's
# "在 VS Code 中打开（WSL）" menu item works on an unpatched archive. The shipped
# "Open in app" item still inherits the flag and still fails; that remains an
# upstream fix.
#
# This probe is diagnostic: it reports
#   - whether the plugin bridge is installed in the runtime mirror, and
#   - which state the shipped launcher's archive is in
#     (upstream-fixed / locally-patched / broken).
# A `broken` archive is not a failure while the bridge is installed; it only
# means the shipped item is still upstream-broken.
#
# Read-only on the install; safe any time. Exit 0 when the bridge is installed
# (or the archive is upstream-fixed), 1 when neither the bridge nor an upstream
# fix is present, 2 on "cannot check".
#
#   test/probe/open-in-app-patch.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

ASAR="$APP/resources/app.asar"
[ -f "$ASAR" ] || { echo "open-in-app-patch: no app archive at $ASAR (set DSH_WSL_ENV_APP)" >&2; exit 2; }

# The plugin bridge: the row must be in the runtime mirror's patch and its
# module must carry the child-scoped scrub helper.
BRIDGE_MODULE="$DST/lib/open-in-app.js"
BRIDGE_PATCH="$DST/cordis.patch.yml"
bridge=0
if [ -f "$BRIDGE_MODULE" ] && [ -f "$BRIDGE_PATCH" ] \
  && grep -aq 'launchEnvironment' "$BRIDGE_MODULE" 2>/dev/null \
  && grep -aq 'wsl-open-in-app' "$BRIDGE_PATCH" 2>/dev/null; then
  bridge=1
fi

# The archive states, by byte-string search (the archive stores file contents
# verbatim). `clearedElectronFlag` and `editorRemoteUri` are the historical
# local patches; their absence is expected now.
upstream_fixed=0; patched1=0; patched2=0
if grep -aq 'delete env.ELECTRON_RUN_AS_NODE' "$ASAR" 2>/dev/null && ! grep -aq 'clearedElectronFlag' "$ASAR" 2>/dev/null; then
  upstream_fixed=1
fi
grep -aq 'clearedElectronFlag' "$ASAR" 2>/dev/null && patched1=1
grep -aq 'editorRemoteUri' "$ASAR" 2>/dev/null && patched2=1

if [ "$bridge" = 1 ]; then
  echo "PASS  open-in-app-patch — plugin bridge installed; no host patch is needed"
  if [ "$upstream_fixed" = 1 ]; then
    echo "PASS  open-in-app-patch — the shipped launcher also clears the flag upstream"
  elif [ "$patched1" = 1 ] && [ "$patched2" = 1 ]; then
    echo "INFO  open-in-app-patch — an optional local archive patch is also present"
  else
    echo "INFO  open-in-app-patch — the shipped \"Open in app\" item still fails (inherits ELECTRON_RUN_AS_NODE); use the plugin's \"在 VS Code 中打开（WSL）\" menu"
  fi
  exit 0
fi

if [ "$upstream_fixed" = 1 ]; then
  echo "PASS  open-in-app-patch — the shipped launcher clears the flag upstream (plugin bridge not found)"
  exit 0
fi
if [ "$patched1" = 1 ] && [ "$patched2" = 1 ]; then
  echo "PASS  open-in-app-patch — historical local archive patch present (plugin bridge not found)"
  exit 0
fi
if [ "$patched1" = 1 ] || [ "$patched2" = 1 ]; then
  echo "INFO  open-in-app-patch — partial historical archive patch: flag-clear=$patched1 remote-uri=$patched2"
  echo "      the plugin bridge is missing; update/sync the plugin instead of finishing the archive patch"
  exit 1
fi
if grep -aq 'launchDetachedApp' "$ASAR" 2>/dev/null; then
  echo "FAIL  open-in-app-patch — no plugin bridge and the shipped launcher does not clear ELECTRON_RUN_AS_NODE"
  echo "      remedy: update the plugin (it owns the bridge) and run pnpm run sync:windows; do not patch app.asar"
  exit 1
fi
echo "SKIP  open-in-app-patch — launchDetachedApp not found in the archive; layout changed, re-check the bridge design"
exit 2
