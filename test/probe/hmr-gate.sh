#!/usr/bin/env bash
# Run the HMR update gate: install a Git-pinned copy of this plugin into a
# throwaway profile, update it to another pinned commit through the real plugin
# manager, and assert that `dsh.profile.bundles` keeps the bundle, the restart
# composes this plugin's three takeover services, and the profile's patch layer
# stays empty.
#
# The probe uses its own DSH_HOME and `--port 0`, so it can run next to a live
# app; it does need GitHub access for both pinned commits. The session leg is
# best effort: a profile without a model provider still exercises the update.
#
#   test/probe/hmr-gate.sh
#
# Override a leg with HMR_GATE_NAME, HMR_GATE_FROM_SPEC, HMR_GATE_TO_VERSION or
# HMR_GATE_TO_SPEC. The report lands in the gitignored
# test/probe/hmr-gate-report.txt.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=test/probe/env.sh
. "$HERE/env.sh"

NAME="${HMR_GATE_NAME:-dsh-plugin-wsl-env}"
FROM_SPEC="${HMR_GATE_FROM_SPEC:-github:Big-Dao/dsh-plugin-wsl-env#525571f0c568b55b3e8657d0542264178aedc59f}"
TO_VERSION="${HMR_GATE_TO_VERSION:-0.26.2}"
TO_SPEC="${HMR_GATE_TO_SPEC:-github:Big-Dao/dsh-plugin-wsl-env#65018178591b3bcc7fd22a966485e2838c22e0a9}"

[ -x "$APP/DeepSeek Harness.exe" ] || {
  echo "hmr-gate: no harness at $APP; set DSH_WSL_ENV_APP" >&2
  exit 1
}

SCRATCH="$HERE/.scratch"
mkdir -p "$SCRATCH"
WIN_TEMP="$(win_path "$WIN_LOCAL/Temp")"
STAMP="$(date +%Y%m%d-%H%M%S)"
DSH_HOME_WIN="$WIN_TEMP\\dsh-hmr-gate-$STAMP"
DSH_HOME_DIR="$(wslpath -u "$DSH_HOME_WIN")"
PROFILE_DIR="$DSH_HOME_DIR/profiles/gate"
MANIFEST="$PROFILE_DIR/package.json"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
WORKSPACE_WIN="$DSH_HOME_WIN\\workspace"
REPORT_FILE="$HERE/hmr-gate-report.txt"
RUNNER="$SCRATCH/hmr-gate-runner-$STAMP.sh"

: >"$REPORT_FILE"

# The harness is invoked in Node mode; WSLENV is the only way a Linux
# environment reaches that Windows process, so DSH_HOME must be listed too.
WSLENV_VALUE="${WSLENV:-ELECTRON_RUN_AS_NODE}:DSH_HOME"
cat >"$RUNNER" <<EOF
#!/bin/sh
exec env -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_SHELL \\
  -u DSH_WEB_URL -u DSH_WSL_DISTRO -u DSH_WSL_HOME -u DSH_WSL_SHELL \\
  ELECTRON_RUN_AS_NODE=1 DSH_HOME='$DSH_HOME_WIN' WSLENV='$WSLENV_VALUE' \\
  '$APP/DeepSeek Harness.exe' --expose-internals '$CLI' "\$@"
EOF
chmod +x "$RUNNER"

# Record a failure, print the evidence, and stop the gate.
fail() {
  local reason="$1"
  shift
  {
    printf 'HMR GATE FAIL %s\n' "$reason"
    printf '%s\n' "$@"
  } | tee -a "$REPORT_FILE" >&2
  exit 1
}

# Fail when the saved manifest does not select the bundle, or its dependency is
# not the expected Git spec.
assert_manifest() {
  node -e '
const manifest = require(process.argv[1]);
const [name, spec] = process.argv.slice(2);
const failures = [];
const bundles = manifest.dsh?.profile?.bundles ?? [];
if (!bundles.includes(name)) failures.push(`bundles=${JSON.stringify(bundles)}`);
if (manifest.dependencies?.[name] !== spec) failures.push(`dependency=${manifest.dependencies?.[name]}`);
if (failures.length > 0) {
  console.error(failures.join("; "));
  process.exit(1);
}
' "$MANIFEST" "$NAME" "$TO_SPEC"
}

printf 'HMR GATE %s\n' "$NAME $FROM_SPEC -> $TO_VERSION"
printf 'HMR GATE DSH_HOME=%s\n' "$DSH_HOME_WIN"

if ! timeout 180 "$RUNNER" --profile gate --from-default-profile web --dump-config \
  >"$SCRATCH/hmr-gate-init-$STAMP.log" 2>&1; then
  fail "profile init" "$(tail -5 "$SCRATCH/hmr-gate-init-$STAMP.log")"
fi
if ! timeout 420 "$RUNNER" plugin --profile gate add "$FROM_SPEC" \
  >"$SCRATCH/hmr-gate-install-$STAMP.log" 2>&1; then
  fail "installing $FROM_SPEC" "$(tail -10 "$SCRATCH/hmr-gate-install-$STAMP.log")"
fi
if ! node -e '
const manifest = require(process.argv[1]);
const bundles = manifest.dsh?.profile?.bundles ?? [];
if (!bundles.includes(process.argv[2])) {
  console.error(`bundle ${process.argv[2]} is not selected: ${JSON.stringify(bundles)}`);
  process.exit(1);
}
' "$MANIFEST" "$NAME"; then
  fail "the install did not select $NAME"
fi
if grep -qF "$NAME" "$PATCH_FILE"; then
  fail "the profile patch already names $NAME; the gate expects an empty layer"
fi
cmd.exe /c mkdir "$WORKSPACE_WIN" >/dev/null 2>&1 || true

PROBE_UNC="$(win_path "$HERE/hmr-gate-probe.mjs")"
REPORT_UPDATE="$SCRATCH/hmr-gate-update-$STAMP.txt"
REPORT_VERIFY="$SCRATCH/hmr-gate-verify-$STAMP.txt"
UPDATE_OVERLAY="$(write_overlay hmr-gate-probe.yml .generated-hmr-gate-update.yml \
  MODE update NAME "$NAME" VERSION "$TO_VERSION" SPEC "$TO_SPEC" \
  WORKSPACE "$WORKSPACE_WIN" REPORT "$(wslpath -w "$REPORT_UPDATE")" PROBE "$PROBE_UNC")"
VERIFY_OVERLAY="$(write_overlay hmr-gate-probe.yml .generated-hmr-gate-verify.yml \
  MODE verify NAME "$NAME" VERSION "$TO_VERSION" SPEC "$TO_SPEC" \
  WORKSPACE "$WORKSPACE_WIN" REPORT "$(wslpath -w "$REPORT_VERIFY")" PROBE "$PROBE_UNC")"

rm -f "$REPORT_UPDATE"
timeout 420 "$RUNNER" --profile gate --patch "$UPDATE_OVERLAY" --no-open --port 0 \
  >"$SCRATCH/hmr-gate-update-$STAMP.log" 2>&1 || true
[ -f "$REPORT_UPDATE" ] || fail "the update probe wrote no report" \
  "$(tail -10 "$SCRATCH/hmr-gate-update-$STAMP.log")"
grep -q "HMRPROBE UPDATE OK" "$REPORT_UPDATE" \
  || fail "the update did not report applied with no restore" "$(cat "$REPORT_UPDATE")"
if ! assert_manifest; then
  fail "the manifest lost the selection after the update" "$(cat "$REPORT_UPDATE")"
fi
if grep -qF "$NAME" "$PATCH_FILE"; then
  fail "the profile patch names $NAME after the update" "$(cat "$PATCH_FILE")"
fi

rm -f "$REPORT_VERIFY"
timeout 180 "$RUNNER" --profile gate --patch "$VERIFY_OVERLAY" --no-open --port 0 \
  >"$SCRATCH/hmr-gate-verify-$STAMP.log" 2>&1 || true
[ -f "$REPORT_VERIFY" ] || fail "the verify probe wrote no report" \
  "$(tail -10 "$SCRATCH/hmr-gate-verify-$STAMP.log")"
grep -q "HMRPROBE VERIFY OK" "$REPORT_VERIFY" \
  || fail "the restart did not compose all three takeover services" "$(cat "$REPORT_VERIFY")"
for provider in WslSubprocessRuntime WslRoutingFileSystem WslDirectoryPicker; do
  grep -q "$provider" "$REPORT_VERIFY" \
    || fail "the restart did not compose $provider" "$(cat "$REPORT_VERIFY")"
done

{
  printf 'HMR GATE PASS %s %s -> %s\n' "$NAME" "$FROM_SPEC" "$TO_VERSION"
  printf 'HMR GATE DSH_HOME=%s\n' "$DSH_HOME_WIN"
  sed 's/^/update: /' "$REPORT_UPDATE"
  sed 's/^/verify: /' "$REPORT_VERIFY"
} | tee "$REPORT_FILE"
