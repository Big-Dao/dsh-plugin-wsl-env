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
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/env.sh"   # derives DST; see its header for overrides

[ -f "$SRC/lib/index.js" ] && [ -f "$SRC/package.json" ] || { echo "not a plugin checkout: $SRC" >&2; exit 1; }
[ -f "$DST/lib/index.js" ] || { echo "no runtime mirror at $DST (create it, or set DSH_WSL_ENV_RUNTIME_COPY)" >&2; exit 1; }
# `cd` on both sides so a symlinked path cannot make the two look identical.
[ "$(cd "$SRC" && pwd -P)" != "$(cd "$DST" && pwd -P)" ] || { echo "source and destination are the same directory: $SRC" >&2; exit 1; }

# `.scratch` is the probes' own run scratch — including the full suite's live
# log, which is appended to while this runs. Nothing at runtime reads it and
# git ignores it, so it is not copied at all.
#
# The mirror is a best-effort copy by design ("additive on purpose ... nothing
# here needs the mirror to be exact") and every probe re-syncs, so a file that
# changes while tar reads it — GNU tar's exit 1, `file changed as we read it`,
# observed with the full suite running — is re-copied on the next probe rather
# than failing this one on `set -e`. A real tar failure (exit 2) and any
# extraction failure still abort.
set +e
tar -C "$SRC" --exclude=./.git --exclude=./node_modules --exclude=./test/probe/.scratch -cf - . | tar -C "$DST" -xf -
STATUS=("${PIPESTATUS[@]}")
set -e
if [ "${STATUS[1]}" -ne 0 ] || [ "${STATUS[0]}" -gt 1 ]; then
  echo "sync-to-windows: tar exited ${STATUS[0]}/${STATUS[1]}" >&2
  exit 1
fi

echo "synced $SRC -> $DST"
if diff -rq -x .git -x node_modules "$SRC" "$DST" >/dev/null; then
  echo "mirror identical"
else
  echo "note: the mirror holds files this checkout does not (additive sync never deletes):" >&2
  # `diff` exits 1 on a difference, which `pipefail` would turn into a failed
  # sync; the note is informational, so its status is deliberately dropped.
  { diff -rq -x .git -x node_modules "$SRC" "$DST" || true; } | head -20 >&2
fi
