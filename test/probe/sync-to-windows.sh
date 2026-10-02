#!/usr/bin/env bash
# Mirror this checkout onto the Windows copy that the harness profiles link to.
#
# The plugin is developed inside the distro, but the harness process — and
# therefore a profile's `node_modules/dsh-plugin-wsl-env` — is a Windows process,
# and pnpm cannot link a UNC path: `link:\\wsl.localhost\...` is rewritten to
# `/wsl.localhost/...` and leaves a broken symlink. So the runtime copy is kept
# in sync explicitly instead.
#
#   test/probe/sync-to-windows.sh
#
# Override the destination with DSH_WSL_ENV_RUNTIME_COPY (a path this shell can
# see, normally /mnt/c/...). The sync is additive on purpose: a delete-in-sync
# would let a stray file in the mirror cost someone work, and nothing here needs
# the mirror to be exact.
#
# The destination is OUTSIDE every DSH session workspace, so an agent running
# this through a confined shell must approve an escalation first: the
# workspace-write policy refuses the write, by design, and the tool layer offers
# `danger-full-access` for exactly this retry. Run it from a plain distro
# terminal to avoid the prompt.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DST="${DSH_WSL_ENV_RUNTIME_COPY:-/mnt/c/Users/andyz/Documents/deepseek-harness/default-workspace/dsh-plugin-wsl}"

[ -f "$SRC/lib/index.js" ] && [ -f "$SRC/package.json" ] || { echo "not a plugin checkout: $SRC" >&2; exit 1; }
[ -f "$DST/lib/index.js" ] || { echo "no runtime mirror at $DST (create it, or set DSH_WSL_ENV_RUNTIME_COPY)" >&2; exit 1; }
# `cd` on both sides so a symlinked path cannot make the two look identical.
[ "$(cd "$SRC" && pwd -P)" != "$(cd "$DST" && pwd -P)" ] || { echo "source and destination are the same directory: $SRC" >&2; exit 1; }

tar -C "$SRC" --exclude=./.git --exclude=./node_modules -cf - . | tar -C "$DST" -xf -

echo "synced $SRC -> $DST"
if diff -rq -x .git -x node_modules "$SRC" "$DST" >/dev/null; then
  echo "mirror identical"
else
  echo "note: the mirror holds files this checkout does not (additive sync never deletes):" >&2
  # `diff` exits 1 on a difference, which `pipefail` would turn into a failed
  # sync; the note is informational, so its status is deliberately dropped.
  { diff -rq -x .git -x node_modules "$SRC" "$DST" || true; } | head -20 >&2
fi
