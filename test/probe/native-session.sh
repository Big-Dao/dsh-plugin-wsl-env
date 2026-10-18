#!/usr/bin/env bash
# Native session-runtime probe (ADR 0002, A4). See native-session.mjs.
#
#   bash test/probe/native-session.sh
#
# The app may be running; the probe creates and releases its own scope.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/native-session.mjs" "$@"
