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

# The confined shell's bind of /mnt/c is read-only; a plain terminal or a
# danger-full-access run sees the host's writable mount. Fail with the remedy
# instead of letting tar's EROFS surface as a content mismatch.
WRITE_PROBE="$DST/.dsh-sync-write-probe"
if ! ( : > "$WRITE_PROBE" ) 2>/dev/null; then
  echo "sync-to-windows: $DST is not writable; the confined shell sees /mnt/c read-only." >&2
  echo "sync-to-windows: run with danger-full-access or from a plain distro terminal." >&2
  exit 1
fi
rm -f "$WRITE_PROBE"

# `.scratch` is the probes' own run scratch — including the full suite's live
# log, which is appended to while this runs. `.v2c` and `.video_agent` are
# untracked agent artifacts (the former can contain a socket), not part of the
# plugin. Nothing at runtime reads them, so they are not copied at all.
#
# `/mnt/c` is drvfs: utime, chmod, chown and unlink on the mirror can fail with
# "Read-only file system" even though the bytes land, and an existing file may
# be reported as `Cannot open: File exists` when GNU tar tries to replace it.
# The extraction therefore skips that metadata and does not unlink; the content
# diff below is the source of truth, so metadata-only tar errors are tolerated
# while a stale or missing file still fails the sync.
TAR_ERR="$(mktemp "${TMPDIR:-/tmp}/dsh-sync-tar.XXXXXX")"
trap 'rm -f "$TAR_ERR"' EXIT
set +e
tar -C "$SRC" --exclude=./.git --exclude=./node_modules --exclude=./test/probe/.scratch --exclude=./.v2c --exclude=./.video_agent -cf - . 2>>"$TAR_ERR" | tar -C "$DST" -xf - --no-overwrite-dir --touch --no-same-owner --no-same-permissions 2>>"$TAR_ERR"
STATUS=("${PIPESTATUS[@]}")
set -e

# The mirror is additive: files only in the destination are allowed. A file
# that the source has but the mirror lacks or differs from is a real failure,
# even when tar reported only drvfs metadata errors.
DIFF="$(diff -rq -x .git -x node_modules -x .scratch -x .v2c -x .video_agent "$SRC" "$DST" 2>&1 || true)"
PROBLEMS="$(printf '%s\n' "$DIFF" | grep -v -F "Only in $DST" || true)"
if [ -n "$PROBLEMS" ]; then
  echo "sync-to-windows: content mismatch after copy" >&2
  printf '%s\n' "$PROBLEMS" >&2
  if [ -s "$TAR_ERR" ]; then
    echo "sync-to-windows: tar diagnostics:" >&2
    head -20 "$TAR_ERR" >&2
  fi
  exit 1
fi

echo "synced $SRC -> $DST"
if [ -s "$TAR_ERR" ]; then
  echo "sync-to-windows: drvfs metadata warnings ignored (content verified)" >&2
  head -10 "$TAR_ERR" >&2
fi
if printf '%s\n' "$DIFF" | grep -q -F "Only in $DST"; then
  echo "note: the mirror holds files this checkout does not (additive sync never deletes):" >&2
  printf '%s\n' "$DIFF" | grep -F "Only in $DST" | head -20 >&2
fi
echo "mirror content verified"
