#!/usr/bin/env bash
# Batched-read comparison for the GUI-preview shape (WSL-312 acceptance):
# the same stat+list+stat+read+stat preview against the resident agent, timed
# as individual FS frames versus one protocol-7 batch frame, on both the
# shell and the native backend.
#
# The WSL-206 latency baseline lives in gui-preview.sh; this probe answers a
# protocol question and needs neither a harness boot nor a profile. The
# harness may be running: the probe spawns its own resident.
#
#   test/probe/gui-preview-batch.sh
#
# Paths come from test/probe/env.sh, which this script sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"

[ -n "${DISTRO:-}" ] || { echo "no distro resolved; set DSH_WSL_ENV_DISTRO" >&2; exit 1; }
[ -x "$APP/DeepSeek Harness.exe" ] || { echo "no harness at $APP; set DSH_WSL_ENV_APP" >&2; exit 1; }

# The Windows-side Electron binary runs as plain Node for the benchmark client;
# its lib/ imports resolve against the checkout, the same modules the app runs.
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID \
  -u DSH_SHELL -u DSH_WEB_URL -u DSH_WSL_DISTRO -u DSH_WSL_HOME -u DSH_WSL_SHELL \
  ELECTRON_RUN_AS_NODE=1 \
  "$APP/DeepSeek Harness.exe" --expose-internals "$HERE/gui-preview-batch.mjs" \
    "$DISTRO" "$REPO_DIR" "$REPO_DIR/agent/wsl-agent.sh" "$REPO_DIR/agent/native/linux-x86_64/dsh-wsl-agent"
