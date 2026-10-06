#!/usr/bin/env bash
# Collect a read-only diagnostic report for a bug report, in one command:
#
#     pnpm run diagnose -- [distro]     # distro optional; default distro otherwise
#
# Prints versions and probe verdicts as plain text that can be pasted into an
# issue as-is. It runs NO installation, changes nothing in the distro, and reads
# nothing secret: the report is tool versions, a kernel release and probe
# verdicts. Exit code is always 0 — the report is informational; the verdict
# lines carry the failures.
#
# Deeper sandbox probing lives in `npm run probe:sandbox` (run inside the
# distro); this script answers "what is installed and does bwrap run at all".

set -u
export WSL_UTF8=1 # wsl.exe writes UTF-16LE without it; read as UTF-8 that is mojibake

DISTRO="${1:-}"

ok()    { printf 'ok        %s\n' "$1"; }
miss()  { printf 'MISSING   %s\n' "$1"; }
info()  { printf 'info      %s\n' "$1"; }
header(){ printf '\n== %s ==\n' "$1"; }

echo "# dsh-plugin-wsl-env diagnose report"

header "host"
winver="$(cmd.exe /c ver 2>/dev/null | tr -d '\r' | grep -o '[0-9][0-9.]*' | head -1)"
if [ -n "$winver" ]; then ok "windows build $winver"; else info "windows build unknown (cmd.exe not reachable through interop)"; fi
wsl_ver="$(wsl.exe --version 2>/dev/null | tr -d '\0\r' | head -2 | tr '\n' ' ')"
if [ -n "$wsl_ver" ]; then ok "wsl: $wsl_ver"; else info "wsl --version unsupported on this WSL build"; fi
wsl_status="$(wsl.exe --status 2>/dev/null | tr -d '\0\r' | tr '\n' ' ')"
[ -n "$wsl_status" ] && info "wsl status: $wsl_status"
wsl.exe -l -v 2>/dev/null | tr -d '\0\r' | grep -v '^$' | sed 's/^/          /'

header "plugin"
echo "          plugin version: $(node -p "require('./package.json').version" 2>/dev/null || echo unknown)"
echo "          dsh version: $(dsh --version 2>/dev/null || echo unknown)"

if [ -z "$DISTRO" ]; then
  DISTRO="$(wsl.exe -l -q 2>/dev/null | tr -d '\0\r' | grep -v '^$' | head -1)"
fi
if [ -z "$DISTRO" ]; then
  header "distro"
  miss "no distro installed — 'wsl.exe --list --online' lists names, 'wsl --install -d <name>' installs one"
  exit 0
fi

header "distro: $DISTRO"
in_distro() { wsl.exe -d "$DISTRO" --exec sh -c "$1" 2>/dev/null; }

info "kernel: $(in_distro 'uname -r')"
family="$(in_distro 'for m in apt-get dnf pacman zypper; do command -v $m && break; done' | tr -d '\r')"
case "$family" in
  *apt-get) info "package family: apt" ;;
  *dnf)     info "package family: dnf" ;;
  *pacman)  info "package family: pacman" ;;
  *zypper)  info "package family: zypper" ;;
  *)        info "package family: unknown" ;;
esac

for tool in bwrap rg git inotifywait; do
  if in_distro "command -v $tool" | grep -q .; then
    case "$tool" in
      bwrap)       ver="$(in_distro 'bwrap --version' | tr -d '\r' | head -1)" ;;
      rg)          ver="$(in_distro 'rg --version' | tr -d '\r' | head -1)" ;;
      git)         ver="$(in_distro 'git --version' | tr -d '\r' | head -1)" ;;
      inotifywait) ver="inotifywait (no version flag)" ;;
    esac
    ok "$ver"
  else
    case "$tool" in
      bwrap)       miss "bwrap — REQUIRED; every confined command fails closed without it. Install: wsl.exe -d $DISTRO -u root -- apt-get install -y bubblewrap (or: pnpm run bootstrap -- $DISTRO --install)" ;;
      rg)          miss "ripgrep — the search tool falls back to slower matching without it" ;;
      git)         miss "git — snapshot and diff baselines degrade without it" ;;
      inotifywait) miss "inotify-tools — file watching falls back to polling without it" ;;
    esac
  fi
done

if in_distro 'command -v bwrap' | grep -q .; then
  if in_distro 'bwrap --ro-bind / / -- true'; then
    ok "bwrap runs a read-only profile (the usability probe passes)"
  else
    miss "bwrap is installed but FAILED the read-only profile probe — likely the kernel (unprivileged user namespaces disabled) or an unusable build; reinstalling will not help"
  fi
fi

header "notes"
info "trace file: set DSH_WSL_TRACE=<path> to record the auto-preset decisions, then re-run the scenario"
info "paste this report into the issue's Output section; redact anything you would rather not publish"
exit 0
