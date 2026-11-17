#!/usr/bin/env bash
# Install / upgrade / uninstall E2E for the packed tarball (WSL-203).
#
#   test/e2e/install.sh [--skip-upgrade] [--previous <version>]
#
# What it proves, on a real Windows + WSL machine:
#   1. `npm pack` produces a tarball, a fresh profile (from the shipped `web`
#      template) installs it through the desktop CLI (`ELECTRON_RUN_AS_NODE` +
#      the app's `cli.js`), `--dump-config`
#      composes it without skipped-patch warnings, and `plugin remove` takes it
#      out again.
#   2. Upgrading from the previous minor over an existing profile keeps that
#      profile's `cordis.patch.yml` (a marker line is preserved), lands the new
#      version, and the installed CHANGELOG carries the migration note.
#   3. Upgrading from the newest published stable and BOOTING the profile with
#      an overlay probe: all three root-plane takeovers are this plugin's
#      classes, so the bundle composes AND mounts (not just --dump-config).
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
# The upgrade origin must be installable on the CURRENT harness runtime: dsh
# 0.2.2-rc.1 enforces the plugin's peer declarations exactly, and versions
# before 0.13.2 pin exact peers (0.2.1-rc.2) that the runtime now rejects —
# by design. 0.13.2 moved to floors (>=0.2.1-rc.3) and 0.18.0 raised them to
# >=0.2.2-rc.1, so the default origin is the last release before that raise:
# upgrading 0.17.1 → current crosses the peer raise, the path a real user on
# the previous version takes.
PREVIOUS="0.17.1"
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

# Boot one profile under a wall-clock deadline. `timeout` cannot run the
# run_cli shell function, so this mirrors it with the executable directly.
boot_cli() {
  local seconds="$1" home="$2"; shift 2
  timeout "$seconds" env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_SHELL -u DSH_WEB_URL \
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
  && grep -q 'name: dsh-plugin-wsl-env/preflight' "$LOGS/dump-installed.yml" \
  && grep -q 'name: dsh-plugin-wsl-env/update-check' "$LOGS/dump-installed.yml"; then
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
      if run_cli "$HOME_B" --profile e2e --dump-config >"$LOGS/up-dump.yml" 2>"$LOGS/up-dump.err" \
        && grep -q 'name: dsh-plugin-wsl-env/update-check' "$LOGS/up-dump.yml"; then
        ok "the upgraded bundle composes the update-check row"
      else
        bad "the upgraded bundle does not compose the update-check row"
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

# 4. Upgrade from the newest published release, then boot the result and
#    assert the root-plane takeovers are this plugin's classes. The dump-config
#    legs prove the composition; this proves it mounts.
VERSIONS_JSON="$(npm view "$PKG_NAME" versions --json 2>/dev/null || true)"
FROM_PUBLISHED=""
if [ -n "$VERSIONS_JSON" ]; then
  FROM_PUBLISHED="$(printf '%s' "$VERSIONS_JSON" | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const current = process.argv[1];
      const stable = JSON.parse(input || "[]").filter((version) => version !== current && !version.includes("-"));
      stable.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
      process.stdout.write(stable.at(-1) ?? "");
    });
  ' "$CURRENT")"
fi
if [ -z "$FROM_PUBLISHED" ]; then
  skip "boot after upgrading the newest published release (no published stable other than $CURRENT)"
else
  HOME_C="$(new_home "dsh-e2e-boot-$$")"
  HOMES+=("$HOME_C")
  copy_tarball "$HOME_C" "$CURRENT_TGZ" "current.tgz"
  if run_cli "$HOME_C" --profile e2e --from-default-profile web --dump-config >"$LOGS/boot-init.log" 2>&1 \
    && run_cli "$HOME_C" plugin --profile e2e add "$PKG_NAME@$FROM_PUBLISHED" >"$LOGS/boot-from.log" 2>&1 \
    && run_cli "$HOME_C" plugin --profile e2e add "$HOME_C\current.tgz" >"$LOGS/boot-to.log" 2>&1; then
    INSTALLED_BOOT="$(node -p "require('$(wslpath -u "$HOME_C")/profiles/e2e/node_modules/$PKG_NAME/package.json').version")"
    if [ "$INSTALLED_BOOT" = "$CURRENT" ]; then
      ok "upgraded $FROM_PUBLISHED -> $CURRENT for the boot leg"
    else
      bad "the boot leg landed $INSTALLED_BOOT, expected $CURRENT"
    fi
    PROBE_YML="$SCRATCH/takeover-probe.yml"
    printf -- "- insert:\n    - id: e2e-takeover-probe\n      name: '%s'\n" "$UNC\\test\\e2e\\takeover-probe.mjs" > "$PROBE_YML"
    powershell.exe -NoProfile -Command "Copy-Item -LiteralPath '$UNC\\test\\e2e\\.scratch\\takeover-probe.yml' -Destination '$HOME_C\\takeover-probe.yml' -Force" >/dev/null 2>&1
    if boot_cli 180 "$HOME_C" --profile e2e --patch "$HOME_C\takeover-probe.yml" --no-open --port 0 >"$LOGS/boot-bundle.log" 2>&1; then
      if grep -q 'DSH_E2E_TAKEOVER {"subprocess":"WslSubprocessRuntime","fs":"WslRoutingFileSystem","directoryPicker":"WslDirectoryPicker"}' "$LOGS/boot-bundle.log"; then
        ok "the booted profile serves all three takeovers from this plugin"
      else
        bad "the booted profile did not serve the three takeovers"
        grep 'DSH_E2E_TAKEOVER' "$LOGS/boot-bundle.log" >&2 || tail -20 "$LOGS/boot-bundle.log" >&2
      fi
    else
      bad "booting the upgraded profile with the takeover probe"
      tail -20 "$LOGS/boot-bundle.log" >&2
    fi
  else
    bad "preparing the boot leg ($FROM_PUBLISHED -> $CURRENT)"
    tail -10 "$LOGS/boot-init.log" "$LOGS/boot-from.log" "$LOGS/boot-to.log" >&2 2>/dev/null || true
  fi
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "install e2e passed (logs in $LOGS)"
else
  echo "install e2e: $FAILURES failure(s); logs in $LOGS"
fi
exit "$FAILURES"
