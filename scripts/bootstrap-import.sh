#!/usr/bin/env bash
# Import a distro from a rootfs tarball and configure it for this plugin, in
# one pass — the compatibility-matrix run's import traps, automated
# (WSL-310; the traps are documented in docs/COMPATIBILITY.md).
#
#   scripts/bootstrap-import.sh <tarball> <distro-name> [--user <name>] [--dir <windows dir>]
#
# What it does, in order, printing every config write before it applies it:
#
#   1. detect the tarball's architecture from an ELF header (x86_64/aarch64);
#   2. `wsl --import` into %USERPROFILE%\wsl\<name> (or --dir);
#   3. unstick the first launch: a wedged OOBE is terminated and bypassed by
#      starting as root (the Debian 13.5 wedge from the matrix run);
#   4. write /etc/wsl.conf: [boot] systemd=true for systemd families, and
#      [user] default=<name> — an imported default-root distro makes the
#      agent run as root, whose 0600 files no user can read (the substrate
#      probe's four failures);
#   5. create the user when the tarball has none;
#   6. install bubblewrap through the distro's own package manager;
#   7. enable Linger (systemd families only — OpenRC distros run the
#      non-systemd path and sessionSandbox reports the narrower scope);
#   8. hand the result to `doctor <name> --read-only` for the final pass —
#      the bootstrap does not grade itself.
#
# The script is idempotent per distro name: an existing distro of the same
# name is reported and left alone (wsl --import would refuse anyway).

set -euo pipefail

TARBALL="${1:-}"
NAME="${2:-}"
USER_NAME=""
INSTALL_DIR=""
shift 2 2>/dev/null || true
while [ $# -gt 0 ]; do
  case "$1" in
    --user) USER_NAME="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    *) echo "bootstrap-import: unknown argument $1" >&2; exit 1 ;;
  esac
done

[ -n "$TARBALL" ] && [ -f "$TARBALL" ] || { echo "bootstrap-import: usage: $0 <tarball> <distro-name> [--user <name>] [--dir <dir>]" >&2; exit 1; }
[ -n "$NAME" ] || { echo "bootstrap-import: a distro name is required" >&2; exit 1; }
case "$NAME" in *[!a-zA-Z0-9._-]*) echo "bootstrap-import: invalid distro name '$NAME'" >&2; exit 1 ;; esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n== %s ==\n' "$1"; }

# ---- 1. architecture --------------------------------------------------------
step "1. tarball architecture"
# Docker export tars list top-level "bin/…", distro rootfs tars list
# "./usr/bin/…" — and some candidates are directories whose extraction yields
# no bytes, so walk the list until one produces an ELF header.
FIRST_BIN=""
for candidate in $(tar ${TOPT:-} -tf "$TARBALL" | grep -E '^\.{0,2}/?(usr/)?bin/[^/]+$' | head -10); do
  # dd exits after two bytes, which SIGPIPEs tar — pipefail would kill this
  # script for the expected behaviour, so the pipeline is tolerated and only
  # a non-empty header counts.
  header="$( { tar ${TOPT:-} -xOf "$TARBALL" "$candidate" 2>/dev/null || true; } | { dd bs=1 skip=18 count=2 2>/dev/null || true; } | od -An -tx1 | tr -d ' \n' || true)"
  if [ -n "$header" ]; then FIRST_BIN="$candidate"; break; fi
done
# docker export produces an uncompressed tar; the cloud/rootfs images ship
# .gz and .xz. The compression flag follows the filename.
case "$TARBALL" in
  *.gz|*.tgz) TOPT="-z" ;;
  *.xz) TOPT="-J" ;;
  *.bz2) TOPT="-j" ;;
  *) TOPT="" ;;
esac
MACHINE="$header"
# e_machine is little-endian at offset 0x12: bytes "3e 00" = x86_64,
# "b7 00" = aarch64.
case "$MACHINE" in
  3e00) ARCH="x86_64" ;;
  b700) ARCH="aarch64" ;;
  *) echo "bootstrap-import: unknown ELF machine '$MACHINE' — cannot pick the agent architecture" >&2; exit 1 ;;
esac
echo "arch: $ARCH"

# ---- 2. import --------------------------------------------------------------
step "2. import"
if [ -z "$INSTALL_DIR" ]; then
  USERPROFILE_WIN="$(cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d '\r\n')"
  case "$USERPROFILE_WIN" in "%"*) echo "bootstrap-import: cannot read %USERPROFILE% through interop; pass --dir" >&2; exit 1 ;; esac
  INSTALL_DIR="$(wslpath -u "$USERPROFILE_WIN")/wsl/$NAME"
  INSTALL_DIR_WIN="$(wslpath -w "$INSTALL_DIR")"
else
  INSTALL_DIR_WIN="$(wslpath -w "$INSTALL_DIR")"
fi
mkdir -p "$INSTALL_DIR"
if wsl.exe -l -q 2>/dev/null | tr -d '\r\0' | grep -qx "$NAME"; then
  echo "$NAME already exists — skipping the import, continuing with configuration"
else
  echo "import: $TARBALL -> $NAME (base $INSTALL_DIR_WIN)"
  timeout 300 wsl.exe --import "$NAME" "$INSTALL_DIR_WIN" "$(wslpath -w "$TARBALL")" >/dev/null
  echo "imported."
fi

# ---- 3. unstick the first launch --------------------------------------------
step "3. first launch"
unstick() {
  local n
  for n in 1 2; do
    if timeout 30 wsl.exe -d "$NAME" -u root -- /bin/true >/dev/null 2>&1; then
      echo "first launch ok (as root)"
      return 0
    fi
    echo "launch attempt $n wedged — terminating and retrying"
    timeout 30 wsl.exe --terminate "$NAME" >/dev/null 2>&1 || true
    sleep 2
  done
  return 1
}
unstick || { echo "bootstrap-import: the distro does not answer even as root — see docs/COMPATIBILITY.md's Debian OOBE note" >&2; exit 1; }

# ---- 4./5. family, user, wsl.conf --------------------------------------------
step "4. package family and user"
FAMILY="$(wsl.exe -d "$NAME" -u root --exec sh -c 'for f in apt-get dnf pacman zypper apk; do command -v "$f" >/dev/null 2>&1 && { echo "$f"; exit 0; }; done; echo unknown' | tr -d '\r\n')"
echo "family: $FAMILY"
[ "$FAMILY" != "unknown" ] || { echo "bootstrap-import: no known package manager — cannot install bubblewrap" >&2; exit 1; }

if [ -z "$USER_NAME" ]; then
  USER_NAME="$(printf '%s' "$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r\n')" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-' | cut -c1-24)"
  [ -n "$USER_NAME" ] || USER_NAME="dsh-user"
fi
if ! wsl.exe -d "$NAME" -u root -- id "$USER_NAME" >/dev/null 2>&1; then
  echo "creating user: $USER_NAME"
  case "$FAMILY" in
    apk) wsl.exe -d "$NAME" -u root -- sh -c "apk add -q shadow >/dev/null 2>&1; adduser -D -s /bin/ash '$USER_NAME'" ;;
    *) wsl.exe -d "$NAME" -u root -- useradd -m -s /bin/bash "$USER_NAME" ;;
  esac
fi

echo "writing /etc/wsl.conf:"
SYSTEMD="no"
case "$FAMILY" in
  apk) echo "  (OpenRC — no [boot] systemd line; sessionSandbox reports the narrower scope per WSL-201)" ;;
  *) SYSTEMD="yes"; echo "  [boot] systemd=true" ;;
esac
echo "  [user] default=$USER_NAME"
echo "  -> /etc/wsl.conf"
case "$SYSTEMD" in
  yes) wsl.exe -d "$NAME" -u root -- sh -c '{ echo "[boot]"; echo "systemd=true"; echo "[user]"; echo "default='"$USER_NAME"'"; } > /etc/wsl.conf' ;;
  *) wsl.exe -d "$NAME" -u root -- sh -c '{ echo "[user]"; echo "default='"$USER_NAME"'"; } > /etc/wsl.conf' ;;
esac
wsl.exe -d "$NAME" -u root -- cat /etc/wsl.conf
timeout 30 wsl.exe --terminate "$NAME" >/dev/null 2>&1 || true
sleep 2
echo ""
echo "NOTE: [boot] systemd=true takes effect only after a full \"wsl.exe --shutdown\""
echo "(exit everything, run it, then reopen) — the distro terminate above is not enough."

# ---- 6. bubblewrap ------------------------------------------------------------
step "6. bubblewrap"
# systemd rides the install for the families that ship it: docker-export
# tarballs strip it, and a written [boot] systemd=true without the package is
# a boot that never starts.
case "$FAMILY" in
  apt-get) INSTALL_CMD="apt-get update -qq && apt-get install -y -qq --no-install-recommends bubblewrap git ripgrep inotify-tools systemd systemd-sysv" ;;
  dnf) INSTALL_CMD="dnf install -y -q bubblewrap git ripgrep inotify-tools systemd" ;;
  pacman) INSTALL_CMD="pacman -Sy --noconfirm --needed bubblewrap git ripgrep inotify-tools systemd" ;;
  zypper) INSTALL_CMD="zypper --non-interactive install bubblewrap git ripgrep inotify-tools systemd" ;;
  apk) INSTALL_CMD="apk add -q bubblewrap git coreutils" ;;
esac
wsl.exe -d "$NAME" -u root -- sh -c "$INSTALL_CMD"
wsl.exe -d "$NAME" --exec bwrap --version >/dev/null 2>&1 && echo "bwrap ok"

# ---- 7. Linger ----------------------------------------------------------------
step "7. Linger"
if [ "$SYSTEMD" = "yes" ]; then
  # root runs it: the user manager may be up while enable-linger still asks
  # for the polkit privilege the fresh user does not have.
  wsl.exe -d "$NAME" -u root -- loginctl enable-linger "$USER_NAME" 2>/dev/null \
    && echo "Linger enabled for $USER_NAME" \
    || echo "Linger could not be enabled — the session runtime will degrade; run inside the distro: loginctl enable-linger $USER_NAME (as root)"
else
  echo "skipped (no systemd)"
fi

# ---- 8. doctor pass ------------------------------------------------------------
step "8. doctor --read-only"
echo "cd $(pwd) && node scripts/doctor.mjs $NAME --read-only"
node "$HERE/doctor.mjs" "$NAME" --read-only || {
  echo "bootstrap-import: doctor reported failures — fix them, or file them if they are fresh-distro traps this script should self-heal" >&2
  exit 1
}
echo "bootstrap-import: $NAME ready"
