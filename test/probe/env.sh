#!/usr/bin/env bash
# Machine facts the probe scripts share. Source it; do not run it.
#
# Nothing here is baked into the repository: the Windows user, its home directory
# and the distro name are all derived from the machine the probe runs on. Every
# value stays overridable through the DSH_WSL_ENV_* variable named beside it.
#
#   PROFILE  DSH_WSL_ENV_PROFILE       the probe profile directory, as this shell sees it
#   APP      DSH_WSL_ENV_APP           the harness install directory, as this shell sees it
#   CLI      DSH_WSL_ENV_CLI           the desktop CLI entry point, as a WINDOWS path
#   DST      DSH_WSL_ENV_RUNTIME_COPY  the Windows-side runtime mirror
#   DISTRO   DSH_WSL_ENV_DISTRO        the distro name; defaults to this distro
#   LINUX    DSH_WSL_ENV_WORKSPACE_LINUX  this checkout, POSIX spelling
#   UNC      DSH_WSL_ENV_WORKSPACE_UNC    this checkout, UNC spelling
#
# The DSH_WSL_ENV_* values are exported for the probe process, which reads them
# through test/probe/env.mjs or through a generated YAML overlay.

PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_DIR="$(cd "$PROBE_DIR/../.." && pwd)"

# Ask Windows for its own idea of the user profile rather than guessing a name.
# cmd.exe warns about a UNC working directory on stderr, so stderr is dropped.
win_value() {
  cmd.exe /c "echo %$1%" 2>/dev/null | tr -d '\r\n'
}

WIN_HOME="$(wslpath -u "$(win_value USERPROFILE)" 2>/dev/null || true)"
WIN_LOCAL="$(wslpath -u "$(win_value LOCALAPPDATA)" 2>/dev/null || true)"

DISTRO="${DSH_WSL_ENV_DISTRO:-${WSL_DISTRO_NAME:-}}"
if [ -z "$DISTRO" ]; then
  echo "env.sh: not inside WSL, and DSH_WSL_ENV_DISTRO names no distro" >&2
  exit 1
fi
if [ -z "$WIN_HOME" ] || [ -z "$WIN_LOCAL" ]; then
  echo "env.sh: could not read %USERPROFILE%/%LOCALAPPDATA% through cmd.exe." >&2
  echo "env.sh: set DSH_WSL_ENV_PROFILE, DSH_WSL_ENV_APP and DSH_WSL_ENV_CLI by hand." >&2
  exit 1
fi

PROFILE="${DSH_WSL_ENV_PROFILE:-$WIN_HOME/.dsh/profiles/wslfs}"
APP="${DSH_WSL_ENV_APP:-$WIN_LOCAL/Programs/DeepSeek Harness}"
DST="${DSH_WSL_ENV_RUNTIME_COPY:-$WIN_HOME/Documents/deepseek-harness/default-workspace/dsh-plugin-wsl}"
# The CLI entry point has to be spelled the way the Windows process expects, but it
# lives inside `app.asar`, which is an archive rather than a directory: neither
# `wslpath -w` nor any existence check can walk it. Translate the string instead.
win_path() {
  case "$1" in
    /mnt/[a-z]/*) printf '%s' "$(printf '%s' "${1:5:1}" | tr '[:lower:]' '[:upper:]'):${1:6}" | tr '/' '\\' ;;
    *) wslpath -w "$1" ;;
  esac
}

CLI="${DSH_WSL_ENV_CLI:-$(win_path "$APP")\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js}"

LINUX="$REPO_DIR"
UNC="\\\\wsl.localhost\\$DISTRO${LINUX//\//\\}"

export DSH_WSL_ENV_DISTRO="$DISTRO"
export DSH_WSL_ENV_HOME="${DSH_WSL_ENV_HOME:-$HOME}"
export DSH_WSL_ENV_WORKSPACE_LINUX="$LINUX"
export DSH_WSL_ENV_WORKSPACE_UNC="$UNC"

# WSL's interop boundary hands a Linux process's environment to a Windows
# process only for the names WSLENV lists — a plain `VAR=x app.exe` assignment
# is dropped on the floor. The probes boot the harness CLI in node mode with
# exactly that kind of assignment (`ELECTRON_RUN_AS_NODE=1`), so the flag has
# to be listed here, composed with any WSLENV the caller already had; without
# it the app boots as its GUI self and the probe never runs.
export WSLENV="${WSLENV:+$WSLENV:}ELECTRON_RUN_AS_NODE"

# Generate one overlay from its checked-in template, substituting this machine's
# values. The templates carry @NAME@ placeholders precisely so that no user name or
# distro name has to live in the repository.
write_overlay() {
  local template="$1" output="$2"
  shift 2
  local sed_args=() value
  while [ "$#" -gt 0 ]; do
    # A backslash is an escape in sed's replacement, so it has to be doubled.
    value="${2//\\/\\\\}"
    value="${value//&/\\&}"
    sed_args+=(-e "s|@$1@|$value|g")
    shift 2
  done
  sed "${sed_args[@]}" "$PROBE_DIR/$template" >"$PROBE_DIR/$output"
  printf '%s' "\\\\wsl.localhost\\$DISTRO${PROBE_DIR//\//\\}\\$output"
}
