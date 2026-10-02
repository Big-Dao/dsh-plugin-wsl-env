#!/bin/sh
# wsl-agent — the resident in-distro peer of dsh-plugin-wsl-env.
#
# The plugin spawns one long-lived instance per distro:
#
#   wsl.exe -d <distro> --exec <login shell> <this script>
#
# and speaks a line protocol over stdio. Fields are separated by `|`; binary
# payloads (cwd, argv words, env values, captured output) travel as single-line
# base64. The protocol deliberately avoids JSON: the agent must run under a
# bare POSIX sh with no dependencies beyond coreutils' `base64`, because the
# one thing a distro is guaranteed to have is a shell.
#
# Handshake — the first line the agent writes:
#   HELLO|wsl-agent|<protocol version>
# Requests the agent accepts, one per line on stdin:
#   PING                          -> PONG
#   SHUTDOWN                      -> exits 0
#   KILL|<id>                     -> SIGTERM the in-flight request with that id
#   SETENV|<key>|<b64 value>      -> export the variable for later requests
#   EXEC|<id>|<b64 cwd>|<timeout seconds|0>|<n args>
#       followed by <n args> lines of base64, one argv word each
#       -> RES|<id>|<exit code>|<b64 stdout>|<b64 stderr>
#          or ERR|<id>|<reason>|<b64 message>   (reason: cwd)
#
# Confinement is NOT this script's business: the host wraps argv in the bwrap
# profile (lib/sandbox.js) before the frame is sent, so the agent executes
# exactly what the host decided, sandbox included.
#
# Exit codes: 0 on SHUTDOWN or EOF; 130 on an interrupted read. A crash is the
# host's signal to rebuild once and then fall back to one-shot `wsl.exe` mode.

set -u

PROTO_VERSION=1
TMPDIR_AGENT=$(mktemp -d "${TMPDIR:-/tmp}/wsl-agent.XXXXXX")
OUT_FILE="$TMPDIR_AGENT/out"
ERR_FILE="$TMPDIR_AGENT/err"
trap 'rm -rf "$TMPDIR_AGENT"; exit 0' EXIT

# The request currently in flight, for KILL and for the exit trap.
CURRENT_PID=
CURRENT_ID=

b64dec() {
  # `base64 -d` with GNU and BusyBox spellings; a decode failure yields empty.
  printf '%s' "$1" | base64 -d 2>/dev/null || printf '%s' "$1" | base64 --decode 2>/dev/null || :
}

b64enc_file() {
  # `tr` strips the 76-column wraps GNU and BusyBox base64 both emit; the
  # protocol is one line per payload, so a wrapped encode would tear a large
  # RES line into protocol garbage the host would read as unknown lines.
  base64 "$1" 2>/dev/null | tr -d '\n' || base64 -- "$1" 2>/dev/null | tr -d '\n' || :
}

kill_current() {
  if [ -n "$CURRENT_PID" ]; then
    kill -TERM "$CURRENT_PID" 2>/dev/null
  fi
}

shutdown() {
  kill_current
  exit 0
}
trap shutdown TERM INT HUP

timeout_watcher() {
  # $1 = seconds, $2 = pid, $3 = grace seconds. TERM first; a process that
  # ignores TERM gets KILLed after the grace, so a stuck command cannot hang
  # the request forever.
  sleep "$1"
  kill -TERM "$2" 2>/dev/null
  sleep "${3:-3}"
  kill -KILL "$2" 2>/dev/null
}

printf 'HELLO|wsl-agent|%s\n' "$PROTO_VERSION"

while IFS= read -r line; do
  case $line in
    PING)
      printf 'PONG\n'
      ;;
    SHUTDOWN)
      shutdown
      ;;
    KILL\|*)
      kill_id=${line#KILL|}
      if [ "$kill_id" = "$CURRENT_ID" ]; then
        kill_current
      fi
      ;;
    SETENV\|*)
      rest=${line#SETENV|}
      key=${rest%%|*}
      b64=${rest#*|}
      # Command substitution strips trailing newlines from the decoded value;
      # acceptable for environment values, documented in the protocol.
      decoded=$(b64dec "$b64")
      export "$key=$decoded"
      ;;
    EXEC\|*)
      header=${line#EXEC|}
      req_id=${header%%|*}
      rest=${header#*|}
      cwd_b64=${rest%%|*}
      rest=${rest#*|}
      timeout_s=${rest%%|*}
      nargs=${rest#*|}
      cwd=$(b64dec "$cwd_b64")
      if ! cd "$cwd" 2>/dev/null; then
        printf 'ERR|%s|cwd|%s\n' "$req_id" "$(printf '%s' "$cwd" | base64 | tr -d '\n')"
        continue
      fi
      # Build the argv from the following base64 lines.
      # shellcheck disable=SC2086
      set --
      n=0
      while [ "$n" -lt "$nargs" ]; do
        IFS= read -r arg_b64 || break
        n=$((n + 1))
        set -- "$@" "$(b64dec "$arg_b64")"
      done
      : >"$OUT_FILE"
      : >"$ERR_FILE"
      CURRENT_ID=$req_id
      "$@" >"$OUT_FILE" 2>"$ERR_FILE" &
      CURRENT_PID=$!
      watcher_pid=
      case $timeout_s in
        ''|0) ;;
        *)
          timeout_watcher "$timeout_s" "$CURRENT_PID" 3 &
          watcher_pid=$!
          ;;
      esac
      wait "$CURRENT_PID"
      rc=$?
      CURRENT_PID=
      CURRENT_ID=
      if [ -n "$watcher_pid" ]; then
        kill "$watcher_pid" 2>/dev/null
        wait "$watcher_pid" 2>/dev/null
      fi
      printf 'RES|%s|%s|%s|%s\n' "$req_id" "$rc" "$(b64enc_file "$OUT_FILE")" "$(b64enc_file "$ERR_FILE")"
      ;;
    *)
      printf 'ERR||protocol|%s\n' "$(printf '%s' "unrecognized request" | base64 | tr -d '\n')"
      ;;
  esac
done

# EOF on stdin: the host is gone. The EXIT trap removes the temp dir.
exit 0
