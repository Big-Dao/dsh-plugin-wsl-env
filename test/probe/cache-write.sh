#!/usr/bin/env bash
# Probe: the `writableRoots` grants the plugin actually binds and enforces.
#
# `test/probe/sandbox.sh` measures the raw bwrap profile. This probe measures
# the plugin's wiring around it: the resolver, the one-time physical check, the
# per-command `bwrap` prefix, and the session runtime's systemd scope + agent.
# A granted cache directory must be writable in both shapes; an ungranted
# sibling must stay EROFS.
#
#   test/probe/cache-write.sh          # or: pnpm run probe:cache-write
#
# The probe writes a temporary workspace, cache and sibling under `$HOME`, so
# it must run from an unconfined shell (the detached suite runner is one). It
# needs `bubblewrap` and `node`; the session leg additionally needs `wsl.exe`
# interop and the systemd user manager, and reports INFO when either is absent.
#
# prereq: { command -v node >/dev/null 2>&1 || { [ -x "$HOME/.local/share/fnm/aliases/default/bin/node" ] && export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"; }; } && command -v node >/dev/null 2>&1 && command -v bwrap >/dev/null 2>&1 && [ -w "$HOME" ] || { echo "cache-write needs node, bubblewrap, and a writable \$HOME (run from the unconfined suite)"; false; }
#
# Exit status: 0 when every expectation held; 1 on a real failure.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$HOME/.local/share/fnm" ] && ! command -v node >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || { echo "cache-write: node not found (fnm env not loaded?)" >&2; exit 1; }
exec node "$HERE/cache-write-probe.mjs"
