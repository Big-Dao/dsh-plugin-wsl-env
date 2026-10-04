#!/usr/bin/env bash
# Prepare a distro for this plugin: bubblewrap (required, commands fail closed
# without it) plus the optional tools later phases use — ripgrep for in-distro
# search, git for workspace-changes snapshots, inotifywait for the watcher's
# primary backend.
#
#   scripts/bootstrap.sh [distro]            detect, print what is missing
#   scripts/bootstrap.sh [distro] --install  ALSO run the install commands
#
# The install runs as the distro's root through `wsl.exe -d <distro> -u root --`,
# so it never touches the Windows side and never needs a sudo prompt inside the
# distro. Without --install the script is strictly read-only: it reports and
# prints the exact commands, runnable as-is.
#
# Exit status: 0 when everything REQUIRED is present (or was installed), 1 when
# bubblewrap is still missing.

set -euo pipefail

DISTRO="${1:-}"
INSTALL="no"
for arg in "$@"; do
  case $arg in
    --install) INSTALL="yes" ;;
  esac
done
# A leading distro argument is positional; strip it from a re-scan. (The loop
# above only looks for the flag.)
if [ "${1:-}" = "--install" ]; then
  DISTRO="${WSL_DISTRO_NAME:-}"
fi

if [ -z "$DISTRO" ]; then
  DISTRO="${WSL_DISTRO_NAME:-}"
fi
if [ -z "$DISTRO" ]; then
  echo "bootstrap: no distro named and WSL_DISTRO_NAME is unset" >&2
  exit 1
fi

run_in_distro() {
  wsl.exe -d "$DISTRO" --exec sh -c "$1" sh "$2"
}

# The package family decides the install command; a distro with none reported
# gets the apt spelling, which covers the default Ubuntu images.
family() {
  run_in_distro 'for f in apt-get dnf pacman zypper; do command -v "$f" >/dev/null 2>&1 && { echo "$f"; exit 0; }; done; echo unknown' ""
}

install_command() {
  case "$(family)" in
    apt-get) echo 'apt-get install -y bubblewrap git ripgrep inotify-tools' ;;
    dnf) echo 'dnf install -y bubblewrap git ripgrep inotify-tools' ;;
    pacman) echo 'pacman -Sy --noconfirm bubblewrap git ripgrep inotify-tools' ;;
    zypper) echo 'zypper --non-interactive install bubblewrap git ripgrep inotify-tools' ;;
    *) echo 'apt-get install -y bubblewrap git ripgrep inotify-tools' ;;
  esac
}

present() {
  run_in_distro 'for t in "$@"; do command -v "$t" >/dev/null 2>&1 || exit 1; done' "$1"
}

report() {
  local label="$1" tool="$2"
  if run_in_distro "command -v $tool >/dev/null 2>&1" ""; then
    echo "ok        $label ($tool)"
  else
    echo "MISSING   $label ($tool)"
  fi
}

echo "distro: $DISTRO"

BW_OK="yes"
if present "bwrap"; then
  report "bubblewrap (required; commands fail closed without it)" "bwrap"
else
  BW_OK="no"
  echo "MISSING   bubblewrap (REQUIRED; every command fails closed without it)"
fi
report "ripgrep (in-distro search backend)" "rg"
  report "git (workspace-changes snapshot backend)" "git"
report "inotifywait (watcher primary backend)" "inotifywait"

CMD="$(install_command)"
echo
echo "install command:"
echo "  wsl.exe -d $DISTRO -u root -- $CMD"

if [ "$BW_OK" = "yes" ]; then
  echo
  echo "bubblewrap is present; nothing required is missing."
  exit 0
fi

if [ "$INSTALL" != "yes" ]; then
  echo
  echo "bubblewrap is missing. Re-run with --install to run the command above, or paste it yourself." >&2
  exit 1
fi

echo
echo "installing..."
wsl.exe -d "$DISTRO" -u root -- $CMD

if present "bwrap"; then
  echo "bubblewrap installed successfully."
  exit 0
fi
echo "bootstrap: bubblewrap is still missing after the install; check the output above" >&2
exit 1
