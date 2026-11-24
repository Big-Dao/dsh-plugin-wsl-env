#!/usr/bin/env bash
# The probe scripts' shared preamble: the checkout coordinates, the distro and
# the fnm PATH fallback. Source it; do not run it.
#
# The distro follows env.sh's contract — DSH_WSL_ENV_DISTRO names it, then
# WSL_DISTRO_NAME — but a host that names neither is REFUSED here, loudly.
# The probes used to fall back to a literal "ubuntu" inside their embedded
# Node, so on a host without WSL_DISTRO_NAME they silently probed whatever
# distro happened to be called ubuntu (or failed later with a wsl.exe error
# that named the wrong cause).
#
# Deliberately lighter than env.sh: these probes need the distro name and
# Node, not the Windows-side profile/app/CLI paths env.sh derives through
# cmd.exe. DSH_WSL_ENV_PROBE_DIR is exported for the embedded Node programs,
# which import check.mjs from it.

PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_DIR="$(cd "$PROBE_DIR/../.." && pwd)"
export DSH_WSL_ENV_PROBE_DIR="$PROBE_DIR"

# fnm's shims are not on a non-interactive PATH; source the env the way the
# user's shell would.
if [ -d "$HOME/.local/share/fnm" ] && ! command -v node >/dev/null 2>&1; then
  # fnm's default alias holds the pinned toolchain; `fnm env` would want a
  # symlink under /run, which a confined shell cannot create.
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi

DISTRO="${DSH_WSL_ENV_DISTRO:-${WSL_DISTRO_NAME:-}}"
if [ -z "$DISTRO" ]; then
  echo "probe-env.sh: DSH_WSL_ENV_DISTRO is unset and WSL_DISTRO_NAME names no distro" >&2
  echo "probe-env.sh: run this probe inside WSL, or export DSH_WSL_ENV_DISTRO=<distro>" >&2
  exit 1
fi
export DSH_WSL_ENV_DISTRO="$DISTRO"
