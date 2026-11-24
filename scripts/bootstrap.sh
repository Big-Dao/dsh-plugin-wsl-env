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
# prints the exact command, runnable as-is. apt refreshes its package index
# first (a freshly installed Debian or Ubuntu has none); that command contains
# a `&&`, so every family's command runs through `sh -c "…"` and the printed
# line carries the same quotes — they keep the operator inside the distro when
# the line is pasted into cmd, PowerShell 5.1 or PowerShell 7.
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

# One spawn answers every pre-install question — the package family and the
# tools' presence — where six serial wsl.exe calls used to do it one each.
# FAMILY is emitted only when found; a distro with none reported keeps the apt
# spelling, which covers the default Ubuntu images.
FACTS="$(run_in_distro '
for f in apt-get dnf pacman zypper; do command -v "$f" >/dev/null 2>&1 && { echo "FAMILY=$f"; break; }; done
for t in bwrap rg git inotifywait; do
  if p=$(command -v "$t" 2>/dev/null); then echo "TOOL $t $p"; else echo "MISSING $t"; fi
done
' "")"

if [ -z "$FACTS" ]; then
  echo "bootstrap: wsl.exe could not run a command in \"$DISTRO\"" >&2
  exit 1
fi

family() {
  printf '%s\n' "$FACTS" | sed -n 's/^FAMILY=//p' | head -n 1
}

install_command() {
  case "$(family)" in
    dnf) echo 'dnf install -y bubblewrap git ripgrep inotify-tools' ;;
    pacman) echo 'pacman -S --noconfirm --needed bubblewrap git ripgrep inotify-tools' ;;
    zypper) echo 'zypper --non-interactive install bubblewrap git ripgrep inotify-tools' ;;
    *) echo 'apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap git ripgrep inotify-tools' ;;
  esac
}

# The pre-install answers come from FACTS; only a post-install check re-probes.
tool_path() {
  printf '%s\n' "$FACTS" | awk -v t="$1" '$1 == "TOOL" && $2 == t { print $3; exit }'
}

present() {
  run_in_distro 'for t in "$@"; do command -v "$t" >/dev/null 2>&1 || exit 1; done' "$1"
}

report() {
  local label="$1" tool="$2"
  if [ -n "$(tool_path "$tool")" ]; then
    echo "ok        $label ($tool)"
  else
    echo "MISSING   $label ($tool)"
  fi
}

echo "distro: $DISTRO"

BW_OK="yes"
if [ -z "$(tool_path bwrap)" ]; then
  BW_OK="no"
fi
if [ "$BW_OK" = "yes" ]; then
  report "bubblewrap (required; commands fail closed without it)" "bwrap"
else
  echo "MISSING   bubblewrap (REQUIRED; every command fails closed without it)"
fi
report "ripgrep (in-distro search backend)" "rg"
  report "git (workspace-changes snapshot backend)" "git"
report "inotifywait (watcher primary backend)" "inotifywait"

CMD="$(install_command)"
echo
echo "install command:"
echo "  wsl.exe -d $DISTRO -u root -- sh -c \"$CMD\""

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
wsl.exe -d "$DISTRO" -u root -- sh -c "$CMD"

if present "bwrap"; then
  echo "bubblewrap installed successfully."
  exit 0
fi
echo "bootstrap: bubblewrap is still missing after the install; check the output above" >&2
exit 1
