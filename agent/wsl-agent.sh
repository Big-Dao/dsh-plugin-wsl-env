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
#   EXEC|<id>|<b64 cwd>|<timeout seconds|0>|<n args>|<output cap bytes|0>
#       followed by <n args> lines of base64, one argv word each
#       -> ACK|<id> the moment the request is dequeued for execution — the host
#          arms its stuck-request watchdog on this line, so time spent queued
#          behind an earlier request never counts against a budget
#       -> RES|<id>|<exit code>|<b64 stdout>|<b64 stderr>|<stdout cut?1:0>|<stderr cut?1:0>
#          With a cap, stdout and stderr are each cut at that many bytes and
#          the flags say which streams were cut; 0 means the whole capture.
#          or ERR|<id>|<reason>|<b64 message>   (reason: cwd)
#   FS|<id>|<op>|<timeout seconds|0>|<n args>
#       followed by <n args> lines of base64, one argument each — arguments
#       arrive still base64 so a write's content never passes through a shell
#       variable as bytes
#       ops:  stat <path> · lstat <path> · list <dir> · realpath <path>
#             read <path> <offset> <maxbytes> · write <path> <mode|->
#                  <replace|no-replace> <expected version|-> <content-b64>
#       -> ACK|<id> at dequeue, then the same RES|<id>|<exit code>|<b64
#          stdout>|<b64 stderr> line as EXEC.
#          A failed op writes `dsh-fs|<reason>|<b64 message>` as the FIRST line
#          of its stderr (reason: notfound notdir perm loop exists stale io),
#          which the host's adapter maps onto the FsError codes the tool layer
#          knows. A `replace` write carrying an expected version re-verifies it
#          against a fresh stat one syscall before the rename and refuses with
#          `stale` on a mismatch — the concurrent writer wins, the model's
#          stale write does not land.
#
# Confinement is NOT this script's business: the host wraps argv in the bwrap
# profile (lib/sandbox.js) before the frame is sent, so the agent executes
# exactly what the host decided, sandbox included.
#
# Exit codes: 0 on SHUTDOWN or EOF; 130 on an interrupted read. A crash is the
# host's signal to rebuild once and then fall back to one-shot `wsl.exe` mode.

set -u

PROTO_VERSION=3
TMPDIR_AGENT=$(mktemp -d "${TMPDIR:-/tmp}/wsl-agent.XXXXXX")
OUT_FILE="$TMPDIR_AGENT/out"
ERR_FILE="$TMPDIR_AGENT/err"
trap 'rm -rf "$TMPDIR_AGENT"; [ -z "${CURRENT_STAGING:-}" ] || rm -rf -- "$CURRENT_STAGING"; exit 0' EXIT

# The request currently in flight, for KILL and for the exit trap.
CURRENT_PID=
CURRENT_ID=
# The staged-publication directory of an in-flight FS write. TERM/INT would
# otherwise orphan it inside the target's own directory; a KILL cannot be
# trapped, which is what the sweep in fs_write is for.
CURRENT_STAGING=

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

# Capture one request's output and answer with RES. $1 = request id, $2 =
# timeout seconds ('' or 0 = none), $3 = per-stream output cap in bytes (0 or
# empty = unlimited), $4 = launch mode: `exec` runs "$@" (argv words) as the
# request process; `subshell` runs ( "$@" ) in a forked subshell, which is how
# the FS handlers — shell functions, not executables — run.
run_capture() {
  local req_id timeout_s maxout mode rc watcher_pid out_cut err_cut
  req_id=$1
  timeout_s=$2
  maxout=$3
  mode=$4
  shift 4
  case $maxout in
    ''|*[!0-9]*) maxout=0 ;;
  esac
  : >"$OUT_FILE"
  : >"$ERR_FILE"
  CURRENT_ID=$req_id
  if [ "$mode" = subshell ]; then
    ( "$@" ) >"$OUT_FILE" 2>"$ERR_FILE" &
  else
    "$@" >"$OUT_FILE" 2>"$ERR_FILE" &
  fi
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
  # The cap is what keeps a chatty command from becoming a multi-gigabyte
  # base64 blob inside THIS shell's command substitution: only the first
  # $maxout bytes of each stream are encoded, and the flags tell the host
  # which streams were cut. FS frames pass 0 — their payloads are the host's
  # own read windows, already bounded by the protocol.
  out_cut=0
  err_cut=0
  if [ "$maxout" -gt 0 ]; then
    [ "$(wc -c <"$OUT_FILE" 2>/dev/null || printf 0)" -gt "$maxout" ] && out_cut=1
    [ "$(wc -c <"$ERR_FILE" 2>/dev/null || printf 0)" -gt "$maxout" ] && err_cut=1
    printf 'RES|%s|%s|%s|%s|%s|%s\n' "$req_id" "$rc" \
      "$(head -c "$maxout" -- "$OUT_FILE" | base64 | tr -d '\n')" \
      "$(head -c "$maxout" -- "$ERR_FILE" | base64 | tr -d '\n')" \
      "$out_cut" "$err_cut"
  else
    printf 'RES|%s|%s|%s|%s|%s|%s\n' "$req_id" "$rc" \
      "$(b64enc_file "$OUT_FILE")" "$(b64enc_file "$ERR_FILE")" 0 0
  fi
}

# --- filesystem substrate (FS frames) -------------------------------------
#
# The model's file tools run HERE, against ext4, instead of through the 9p
# share. Every handler reports failure as `dsh-fs|<reason>|<b64 message>` on
# stderr with a nonzero exit; reasons classify the coreutils error text, which
# is why the handlers pin LC_ALL=C.

fs_fail() {
  # $1 = reason token, $2 = message. Exits 1 (the caller's RES carries it).
  # Stderr is the op's error channel; stdout stays pure payload.
  printf 'dsh-fs|%s|%s\n' "$1" "$(printf '%s' "$2" | base64 | tr -d '\n')" >&2
  exit 1
}

fs_classify() {
  # $1 = captured command stderr -> one reason token on stdout. Message
  # matching across coreutils vintages: newer gettext says "Already exists"
  # where older said "File exists".
  case $1 in
    *"No such file"*|*"not found"*) printf 'notfound' ;;
    *"Not a directory"*) printf 'notdir' ;;
    *"Permission denied"*) printf 'perm' ;;
    *"Too many levels"*|*"Too many symbolic links"*) printf 'loop' ;;
    *"File exists"*|*"Already exists"*) printf 'exists' ;;
    *) printf 'io' ;;
  esac
}

fs_stat() {
  # $1 = `-L` (follow) or empty (lstat), $2 = base64 path. Emits one
  # TAB-separated record: type mode size dev ino mtime ctime, produced by the
  # SAME `find -printf` directives the list walk uses — `stat`'s own %.9Y
  # rounds timestamps to microseconds where find is ns-exact, and one file
  # then carried TWO different version strings depending on which op answered
  # (a uutils distro). The host normalizes them into the version string.
  local p out ftype
  p=$(b64dec "$2")
  out=$(find $1 "$p" -maxdepth 0 -printf '%y\t%m\t%s\t%D\t%i\t%T@\t%C@' 2>"$ERR_FILE") || {
    fs_fail "$(fs_classify "$(cat "$ERR_FILE")")" "$(cat "$ERR_FILE")"
  }
  if [ "$1" = "-L" ]; then
    # `find -L` reports a link it cannot resolve (dangling) as the link
    # itself; the `stat -L` this op replaces failed on it with ENOENT, and
    # the peer's probe is null for exactly that — so refuse the same way.
    if [ "$(printf '%s' "$out" | cut -f1)" = l ]; then
      fs_fail notfound "cannot stat \"$p\": the link does not resolve"
    fi
  fi
  printf '%s\n' "$out"
}

fs_list() {
  # $1 = base64 directory. One `find` pass, NUL-delimited records of
  # `type size dev ino mtime ctime path`. No `-L`: the type is the entry's own
  # (lstat), so a symlink is VISIBLE as `l` and the host resolves its target's
  # stat and identity with one follow-up per link — the peer lists follow-stats
  # but has to know which entries are links all the same. Names are safe inside
  # records (records split on NUL, names taken after the 6th TAB).
  local d err
  d=$(b64dec "$1")
  find "$d" -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%D\t%i\t%T@\t%C@\t%p\0' 2>"$ERR_FILE" || {
    err=$(cat "$ERR_FILE")
    fs_fail "$(fs_classify "$err")" "$err"
  }
}

fs_realpath() {
  # $1 = base64 path. The distro-side identity: the strict realpath, and on
  # ENOENT the nearest existing ancestor with the missing suffix appended —
  # fsio's `resolveLocalTarget` walk, run where the symlinks actually live.
  local p anc r suffix err
  p=$(b64dec "$1")
  if r=$(realpath -e -- "$p" 2>/dev/null); then
    printf '%s' "$r"
    return 0
  fi
  anc=$(dirname -- "$p")
  while : ; do
    if r=$(realpath -e -- "$anc" 2>/dev/null); then
      suffix=${p#"$anc"}
      case $suffix in
        # Mirrors fsio's substring check, ".." inside the missing suffix is a
        # traversal across a missing directory, refused rather than joined.
        *..*) fs_fail notfound "cannot resolve \"$p\": parent traversal crosses a missing directory" ;;
      esac
      printf '%s' "$r$suffix"
      return 0
    fi
    err=$(dirname -- "$anc")
    [ "$err" = "$anc" ] && break
    anc=$err
  done
  err=$(realpath -e -- "$p" 2>&1)
  fs_fail "$(fs_classify "$err")" "$err"
}

fs_read() {
  # $1 = base64 path, $2 = base64 byte offset, $3 = base64 max bytes. The
  # window is the bound: at most $3 bytes leave the distro per request; the
  # host loops.
  local p offset max rd err
  p=$(b64dec "$1")
  offset=$(b64dec "$2")
  max=$(b64dec "$3")
  [ "$max" -gt 0 ] || return 0
  rd="$TMPDIR_AGENT/read"
  tail -c +"$(( offset + 1 ))" -- "$p" >"$rd" 2>"$ERR_FILE" || {
    err=$(cat "$ERR_FILE")
    fs_fail "$(fs_classify "$err")" "$err"
  }
  head -c "$max" -- "$rd"
}

norm_time() {
  # `seconds.fraction` in the host's 19-digit spelling: the fraction padded to
  # nine digits (truncated beyond), whole seconds padded when the distro's
  # stat has no fraction at all. This is what the host's `nanoseconds()`
  # produces from fs_stat's directives, so the strings compare equal.
  local s=${1%%.*} f=${1#*.}
  if [ "$f" = "$1" ]; then
    f=""
  fi
  while [ ${#f} -lt 9 ]; do
    f="${f}0"
  done
  printf '%s%.9s' "$s" "$f"
}

fs_version() {
  # One path's version string from the SAME producer the stat and list ops
  # use (`find -printf`), joined the way the host joins a stat record's five
  # ingredients. Empty output (non-zero) means the path is gone.
  local out dev ino size mtime ctime
  out=$(find "$1" -maxdepth 0 -printf '%D\t%i\t%s\t%T@\t%C@' 2>/dev/null) || return 1
  dev=$(printf '%s' "$out" | cut -f1)
  ino=$(printf '%s' "$out" | cut -f2)
  size=$(printf '%s' "$out" | cut -f3)
  mtime=$(printf '%s' "$out" | cut -f4)
  ctime=$(printf '%s' "$out" | cut -f5)
  printf '%s:%s:%s:%s:%s' "$dev" "$ino" "$size" "$(norm_time "$mtime")" "$(norm_time "$ctime")"
}

drop_staging() {
  # Remove the current write's staging dir and forget it, so the EXIT trap
  # never re-removes (or, worse, removes a newer write's staging) after it.
  rm -rf -- "$staging"
  CURRENT_STAGING=
}

sweep_staging() {
  # $1 = directory, $2 = base name. Remove this directory's leftover staging
  # dirs whose creating agent is gone — the PID rides the name, and a process
  # that is not running cannot clean up after its own KILL. A live PID keeps
  # its dir (the safe direction, PID reuse included).
  local d pid
  for d in "$1/.$2."*.*.tmpdir; do
    [ -d "$d" ] || continue
    pid=${d#"$1/.$2."}
    pid=${pid%%.*}
    case $pid in
      ''|*[!0-9]*) continue ;;
    esac
    kill -0 "$pid" 2>/dev/null || rm -rf -- "$d"
  done
}

fs_write() {
  # $1 = base64 path, $2 = base64 mode (`-` keeps none), $3 = base64
  # `replace` or `no-replace`, $4 = expected version (`-` for none) — the
  # version string this write was based on, re-verified one syscall before the
  # rename so a concurrent writer wins instead of being clobbered — and $5 =
  # content STILL base64. Mirrors fsio's POSIX publication: a private 0700
  # sibling staging dir, a 0600 temp, fsync, chmod, then an atomic rename — or
  # a hard link that refuses to replace for guarded creates.
  local path mode publish expected dir base staging tmp u err version
  path=$(b64dec "$1")
  mode=$(b64dec "$2")
  publish=$(b64dec "$3")
  expected=$(b64dec "$4")
  dir=$(dirname -- "$path")
  base=$(basename -- "$path")
  [ -n "$base" ] && [ "$base" != "/" ] || fs_fail notfound "empty file name"
  # Leftover staging dirs from a KILLed write (a KILL cannot be trapped) would
  # sit in the target's directory forever and show up in listings. The creating
  # agent's PID rides the name: one whose process is gone is an orphan, so
  # sweep it before staging this write.
  sweep_staging "$dir" "$base"
  if [ ! -d "$dir" ]; then
    # Deliberately NO `mkdir -p`: a typo'd parent chain must refuse (the peer's
    # Node-fs publication fails ENOENT there), not materialize silently. An
    # existing directory after a failed mkdir is a concurrent creator, not an
    # error.
    mkdir -- "$dir" 2>"$ERR_FILE" || {
      err=$(cat "$ERR_FILE")
      [ -d "$dir" ] || fs_fail "$(fs_classify "$err")" "$err"
    }
  fi
  u=$(head -c 8 /dev/urandom 2>/dev/null | od -An -tx1 | tr -d ' \n')
  staging="$dir/.$base.$$.${u:-0}.tmpdir"
  mkdir -- "$staging" 2>"$ERR_FILE" || {
    # A read-only bind names itself here — the kernel refusing what the policy
    # granted — so the real stderr travels, not a paraphrase of it.
    err=$(cat "$ERR_FILE")
    fs_fail "$(fs_classify "$err")" "$err"
  }
  CURRENT_STAGING=$staging
  chmod 700 -- "$staging" 2>/dev/null
  tmp="$staging/$base.tmp"
  # Decode straight to the file: the base64 text is the one form that crosses
  # a shell variable without a NUL-byte or quoting hazard.
  printf '%s' "$5" | base64 -d >"$tmp" 2>/dev/null || {
    drop_staging
    fs_fail io "cannot stage content"
  }
  chmod 600 -- "$tmp"
  sync -f -- "$tmp" 2>/dev/null || :
  if [ "$mode" != "-" ]; then
    chmod "$mode" -- "$tmp" 2>"$ERR_FILE" || {
      err=$(cat "$ERR_FILE")
      drop_staging
      fs_fail io "$err"
    }
  fi
  if [ "$publish" = "replace" ] && [ -n "$expected" ] && [ "$expected" != "-" ]; then
    # The version the overwrite/edit was based on is re-verified HERE — one
    # syscall before the rename, where the host's round-trip-wide window was.
    # The producer is fs_stat's own stat directives, so this comparison never
    # trips the stat/find skew a list-derived version would.
    version=$(fs_version "$path")
    if [ "$version" != "$expected" ]; then
      drop_staging
      if [ -n "$version" ]; then
        fs_fail stale "cannot write \"$path\": file changed since it was read"
      fi
      fs_fail stale "cannot write \"$path\": file no longer exists"
    fi
  fi
  if [ "$publish" = "no-replace" ]; then
    # Coreutils `ln` resolves an existing DIRECTORY destination (linking beside
    # it) where the peer's link(2) refuses any existing path, so the existence
    # guard is checked before the call and the landing spot verified after it.
    if [ -e "$path" ] || [ -L "$path" ]; then
      drop_staging
      fs_fail exists "cannot write \"$path\": it already exists"
    fi
    ln -- "$tmp" "$path" 2>"$ERR_FILE" || {
      err=$(cat "$ERR_FILE")
      drop_staging
      # A concurrent creator wins the race; classify by what is on disk now.
      if [ -e "$path" ] || [ -L "$path" ]; then
        fs_fail exists "$err"
      fi
      fs_fail "$(fs_classify "$err")" "$err"
    }
    if ! [ "$tmp" -ef "$path" ]; then
      # ln linked BESIDE the target (a directory appeared under us): undo the
      # stray link and refuse, the guarded create did not publish.
      rm -f -- "$path/${base}.tmp"
      drop_staging
      fs_fail exists "cannot write \"$path\": it was created concurrently"
    fi
  else
    mv -f -- "$tmp" "$path" 2>"$ERR_FILE" || {
      err=$(cat "$ERR_FILE")
      drop_staging
      fs_fail "$(fs_classify "$err")" "$err"
    }
  fi
  drop_staging
}

fs_dispatch() {
  # $1 = op, $2.. = raw base64 arguments (handlers decode what they need to
  # treat as a path; write's content stays base64 until it hits the file).
  local op
  op=$1
  shift
  LC_ALL=C
  export LC_ALL=C
  case $op in
    stat)     fs_stat -L "$1" ;;
    lstat)    fs_stat "" "$1" ;;
    list)     fs_list "$1" ;;
    realpath) fs_realpath "$1" ;;
    read)     fs_read "$1" "$2" "$3" ;;
    write)    fs_write "$1" "$2" "$3" "$4" "$5" ;;
    *)        fs_fail notfound "unknown fs op" ;;
  esac
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
      rest=${rest#*|}
      nargs=${rest%%|*}
      maxout=${rest#*|}
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
      # Dispatched: tell the host now, so its watchdog measures execution and
      # not the queue wait this request just went through.
      printf 'ACK|%s\n' "$req_id"
      run_capture "$req_id" "$timeout_s" "$maxout" exec "$@"
      ;;
    FS\|*)
      header=${line#FS|}
      req_id=${header%%|*}
      rest=${header#*|}
      op=${rest%%|*}
      rest=${rest#*|}
      timeout_s=${rest%%|*}
      nargs=${rest#*|}
      # Arguments stay base64 (write's content must never become a shell
      # variable of raw bytes); handlers decode what they treat as a path.
      set --
      n=0
      while [ "$n" -lt "$nargs" ]; do
        IFS= read -r arg_b64 || break
        n=$((n + 1))
        set -- "$@" "$arg_b64"
      done
      # Same dispatch signal as EXEC: the FS budget starts at the op, not at
      # the queue position. No capture cap — the payloads are the host's own
      # read windows, bounded by the protocol.
      printf 'ACK|%s\n' "$req_id"
      run_capture "$req_id" "$timeout_s" 0 subshell fs_dispatch "$op" "$@"
      ;;
    *)
      printf 'ERR||protocol|%s\n' "$(printf '%s' "unrecognized request" | base64 | tr -d '\n')"
      ;;
  esac
done

# EOF on stdin: the host is gone. The EXIT trap removes the temp dir.
exit 0
