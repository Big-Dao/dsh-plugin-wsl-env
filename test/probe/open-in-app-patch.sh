#!/usr/bin/env bash
# Detect whether the installed DeepSeek Harness still carries the open-in-app
# ELECTRON_RUN_AS_NODE regression: the desktop Host starts with
# ELECTRON_RUN_AS_NODE=1, and a Host that does not drop the variable before
# spawning a launched app sends every Electron editor (VS Code, Cursor) into
# Node mode — the "打开失败" toast. 0.2.1-rc.5 cleared the flag in
# `launchDetachedApp` (`clearedElectronFlag`); 0.2.2-rc.1 lost it. This probe
# reads the same bytes a patched archive would carry (see
# docs/UPSTREAM-OPEN-IN-APP.md and docs/upstream/app.asar.*.open-in-app.index.js)
# and says which of the three states the install is in:
#
#   upstream-fixed  — the bundle clears the flag itself; no local patch needed
#   locally-patched — the local patch is present (re-apply after app upgrades)
#   broken          — neither; VS Code launches will fail until patched
#
# Read-only on the install; safe to run any time. Exit 0 on fixed or patched,
# 1 on broken, 2 on "cannot check" (app not found / search tool missing).
#
#   test/probe/open-in-app-patch.sh
#
# Paths come from test/probe/env.sh, which this script sources.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

ASAR="$APP/resources/app.asar"
[ -f "$ASAR" ] || { echo "open-in-app-patch: no app archive at $ASAR (set DSH_WSL_ENV_APP)" >&2; exit 2; }

# The asar stores file contents verbatim, so a byte string search over the
# archive finds the module code without extracting it. Two local patches ride
# on the archive (see docs/UPSTREAM-OPEN-IN-APP.md):
#   patch 1 — `clearedElectronFlag`: drop ELECTRON_RUN_AS_NODE before the
#             spawn, so Electron editors do not start as Node;
#   patch 2 — `editorRemoteUri` + `folder-uri`: a WSL UNC workspace opens
#             through `--folder-uri=vscode-remote://wsl%2B<distro>/...`,
#             landing in Remote-WSL instead of a plain-folder window.
upstream_fixed=0; patched1=0; patched2=0
if grep -aq 'delete env.ELECTRON_RUN_AS_NODE' "$ASAR" 2>/dev/null && ! grep -aq "clearedElectronFlag" "$ASAR" 2>/dev/null; then
  upstream_fixed=1
fi
grep -aq "clearedElectronFlag" "$ASAR" 2>/dev/null && patched1=1
grep -aq "editorRemoteUri" "$ASAR" 2>/dev/null && patched2=1

if [ "$upstream_fixed" = 1 ]; then
  echo "PASS  open-in-app-patch — upstream clears the flag itself"
  [ "$patched2" = 1 ] && echo "PASS  open-in-app-patch — remote-WSL folder-uri patch present"
  exit 0
fi
if [ "$patched1" = 1 ] && [ "$patched2" = 1 ]; then
  echo "PASS  open-in-app-patch — both local patches present (flag clear + remote-WSL folder-uri)"
  exit 0
fi
if [ "$patched1" = 1 ] || [ "$patched2" = 1 ]; then
  echo "FAIL  open-in-app-patch — partial local patch: flag-clear=$patched1 remote-uri=$patched2 (re-apply from docs/UPSTREAM-OPEN-IN-APP.md)"
  exit 1
fi
if grep -aq 'launchDetachedApp' "$ASAR" 2>/dev/null; then
  echo "FAIL  open-in-app-patch — launchDetachedApp spawns without clearing ELECTRON_RUN_AS_NODE; Electron apps will fail to open"
  echo "      remedy: re-apply the local patches (docs/UPSTREAM-OPEN-IN-APP.md)"
  exit 1
fi
echo "SKIP  open-in-app-patch — launchDetachedApp not found in the archive; layout changed, re-check the patch design"
exit 2
