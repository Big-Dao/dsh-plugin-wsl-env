#!/usr/bin/env bash
# Read-only alias for `doctor`: the same checks and the same report, with no way
# to change the machine. `--fix`/`--install` are refused here on purpose —
# diagnostics collected for a bug report must not repair anything.
#
#   pnpm run diagnose -- [distro] [--json]
#
# Doctor is `scripts/doctor.mjs`; see its header for what it covers. Exit status
# follows doctor: 0 when no check failed, 1 when one did.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/doctor.mjs" --read-only "$@"
