#!/usr/bin/env bash
# Install / upgrade / uninstall E2E for the packed tarball (WSL-203).
#
#   test/e2e/install.sh [--skip-upgrade] [--previous <version>]
#
# What it proves, on a real Windows + WSL machine:
#   1. `npm pack` produces a tarball, a fresh profile (from the shipped `web`
#      template) installs it with `dsh plugin add`, `--dump-config` composes it
#      without skipped-patch warnings, and `plugin remove` takes it out again.
#   2. Upgrading from the previous minor over an existing profile keeps that
#      profile's `cordis.patch.yml` (a marker line is preserved), lands the new
#      version, and the installed CHANGELOG carries the migration note.
#
# It never touches the real DSH home: every command runs with a fresh DSH_HOME
# under %TEMP%, removed afterwards. `--skip-upgrade` skips the network leg;
# a failed `npm pack <previous>` is a SKIP, not a failure.
#
# Needs the app installed (paths come from ../probe/env.sh) and Node/npm/pnpm
# from the fnm shims. The plugin-management commands are local pnpm calls, so
# the app may stay running; nothing here boots a profile.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../probe/env.sh"

PKG_NAME="dsh-plugin-wsl-env"
SCRATCH="$HERE/.scratch"
LOGS="$SCRATCH/logs"
mkdir -p "$SCRATCH" "$LOGS"
export npm_config_cache="$SCRATCH/npm-cache"
export npm_config_logs_dir="$SCRATCH/npm-logs"
mkdir -p "$npm_config_cache" "$npm_config_logs_dir"
if ! command -v npm >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi
command -v npm >/dev/null 2>&1 || { echo "e2e: npm not found (fnm env not loaded?)" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "e2e: node not found" >&2; exit 1; }

SKIP_UPGRADE=no
PREVIOUS="0.11.0"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-upgrade) SKIP_UPGRADE=yes ;;
    --previous) PREVIOUS="${2:-}"; shift ;;
    *) echo "e2e: unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

CURRENT="$(node -p "require('$HERE/../../package.json').version")"
HOMES=()
FAILURES=0
ok() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
skip() { printf 'SKIP  %s\n' "$1"; }

# A fresh Windows directory under %TEMP%, returned in Windows spelling.
new_home() {
  local name="$1" win tmp
  tmp="$(cmd.exe /c "echo %TEMP%" 2>/dev/null | tr -d '\r\n')"
  win="$tmp\\$name"
  powershell.exe -NoProfile -Command "New-Item -ItemType Directory -Force -Path '$win' | Out-Null" >/dev/null 2>&1
  printf '%s' "$win"
}

# Run the desktop CLI against one isolated DSH_HOME.
run_cli() {
  local home="$1"; shift
  [ -n "$home" ] || { echo "e2e: refusing to run the CLI without DSH_HOME" >&2; exit 1; }
  env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_SHELL -u DSH_WEB_URL \
    DSH_HOME="$home" WSLENV="DSH_HOME:ELECTRON_RUN_AS_NODE" ELECTRON_RUN_AS_NODE=1 \
    "$APP/DeepSeek Harness.exe" --expose-internals "$CLI" "$@"
}

# Copy one tarball from the checkout's UNC share into the Windows temp home.
copy_tarball() {
  local home="$1" tgz="$2" name="$3"
  powershell.exe -NoProfile -Command "Copy-Item -LiteralPath '$UNC\\test\\e2e\\.scratch\\$tgz' -Destination '$home\\$name' -Force" >/dev/null 2>&1
}

cleanup() {
  local home
  for home in "${HOMES[@]}"; do
    powershell.exe -NoProfile -Command "Remove-Item -LiteralPath '$home' -Recurse -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1
  done
}
trap cleanup EXIT

# 1. Pack the current tree.
CURRENT_TGZ="$PKG_NAME-$CURRENT.tgz"
if npm pack --pack-destination "$SCRATCH" >"$LOGS/pack-current.log" 2>&1 && [ -f "$SCRATCH/$CURRENT_TGZ" ]; then
  ok "packed $CURRENT_TGZ"
else
  bad "packing the current tree"
  tail -20 "$LOGS/pack-current.log" >&2
  exit 1
fi

# 2. Install, dump, remove.
HOME_A="$(new_home "dsh-e2e-install-$$")"
HOMES+=("$HOME_A")
copy_tarball "$HOME_A" "$CURRENT_TGZ" "current.tgz"

if run_cli "$HOME_A" --profile e2e --from-default-profile web --dump-config >"$LOGS/init.log" 2>&1; then
  ok "initialized a profile from the web template"
else
  bad "initializing the profile"
  tail -20 "$LOGS/init.log" >&2
fi

if run_cli "$HOME_A" plugin --profile e2e add "$HOME_A\\current.tgz" >"$LOGS/add.log" 2>&1; then
  if grep -q "$PKG_NAME $CURRENT" "$LOGS/add.log"; then
    ok "plugin add installed $PKG_NAME $CURRENT"
  else
    bad "plugin add did not report $PKG_NAME $CURRENT"
  fi
else
  bad "plugin add"
  tail -20 "$LOGS/add.log" >&2
fi

run_cli "$HOME_A" --profile e2e --dump-config >"$LOGS/dump-installed.yml" 2>"$LOGS/dump-installed.err"
if grep -qE '^\- id: preset-wsl$' "$LOGS/dump-installed.yml" \
  && grep -q 'name: dsh-plugin-wsl-env/fs-routing' "$LOGS/dump-installed.yml" \
  && grep -q 'name: dsh-plugin-wsl-env/preflight' "$LOGS/dump-installed.yml"; then
  ok "--dump-config composes the plugin rows"
else
  bad "--dump-config is missing the plugin rows"
fi
if grep -q 'patch: entry' "$LOGS/dump-installed.err"; then
  bad "the composed patch reported skipped entries"
  grep 'patch: entry' "$LOGS/dump-installed.err" >&2
else
  ok "the composed patch applied without skipped entries"
fi

if run_cli "$HOME_A" plugin --profile e2e remove "$PKG_NAME" >"$LOGS/remove.log" 2>&1; then
  run_cli "$HOME_A" --profile e2e --dump-config >"$LOGS/dump-removed.yml" 2>"$LOGS/dump-removed.err"
  if [ "$(grep -c 'dsh-plugin-wsl-env' "$LOGS/dump-removed.yml")" -eq 0 ]; then
    ok "plugin remove took every row out"
  else
    bad "plugin remove left plugin rows behind"
  fi
else
  bad "plugin remove"
  tail -20 "$LOGS/remove.log" >&2
fi

# 3. Upgrade from the previous minor.
if [ "$SKIP_UPGRADE" = yes ]; then
  skip "upgrade from $PREVIOUS (--skip-upgrade)"
elif npm pack "$PKG_NAME@$PREVIOUS" --pack-destination "$SCRATCH" >"$LOGS/pack-previous.log" 2>&1 && [ -f "$SCRATCH/$PKG_NAME-$PREVIOUS.tgz" ]; then
  HOME_B="$(new_home "dsh-e2e-upgrade-$$")"
  HOMES+=("$HOME_B")
  copy_tarball "$HOME_B" "$PKG_NAME-$PREVIOUS.tgz" "previous.tgz"
  copy_tarball "$HOME_B" "$CURRENT_TGZ" "current.tgz"
  if run_cli "$HOME_B" --profile e2e --from-default-profile web --dump-config >"$LOGS/up-init.log" 2>&1 \
    && run_cli "$HOME_B" plugin --profile e2e add "$HOME_B\\previous.tgz" >"$LOGS/up-old.log" 2>&1; then
    ok "installed the previous minor ($PREVIOUS)"
    powershell.exe -NoProfile -Command "Add-Content -LiteralPath '$HOME_B\\profiles\\e2e\\cordis.patch.yml' -Value '# e2e-upgrade-marker'" >/dev/null 2>&1
    if run_cli "$HOME_B" plugin --profile e2e add "$HOME_B\\current.tgz" >"$LOGS/up-new.log" 2>&1; then
      HOME_LINUX="$(wslpath -u "$HOME_B")"
      INSTALLED="$(node -p "require('$HOME_LINUX/profiles/e2e/node_modules/$PKG_NAME/package.json').version")"
      if [ "$INSTALLED" = "$CURRENT" ]; then
        ok "upgrade landed $CURRENT"
      else
        bad "upgrade landed $INSTALLED, expected $CURRENT"
      fi
      if [ "$(grep -c 'e2e-upgrade-marker' "$HOME_LINUX/profiles/e2e/cordis.patch.yml")" -ge 1 ]; then
        ok "the profile patch survived the upgrade"
      else
        bad "the profile patch did not survive the upgrade"
      fi
      if grep -q 'The distro follows the workspace' "$HOME_LINUX/profiles/e2e/node_modules/$PKG_NAME/CHANGELOG.md"; then
        ok "the installed CHANGELOG carries the migration note"
      else
        bad "the installed CHANGELOG has no migration note"
      fi
    else
      bad "upgrading to $CURRENT"
      tail -20 "$LOGS/up-new.log" >&2
    fi
  else
    bad "installing the previous minor or initializing its profile"
  fi
else
  skip "upgrade from $PREVIOUS (npm pack failed; network or version unavailable)"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "install e2e passed (logs in $LOGS)"
else
  echo "install e2e: $FAILURES failure(s); logs in $LOGS"
fi
exit "$FAILURES"
