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
#   HELLO|wsl-agent|<protocol version>|<sha256 of this script file>
# The digest lets the host verify that the script it is about to rely on is
# byte-identical to the copy it shipped. The script is read in place — a
# /mnt/c mirror in the deployed layout — so a stale or half-synced runtime
# copy would otherwise pass the version handshake while drifting in behavior.
# Requests the agent accepts, one per line on stdin:
#   PING                          -> PONG
#   SHUTDOWN                      -> exits 0
#   KILL|<id>                     -> SIGTERM the in-flight request with that id
#   SETENV|<key>|<b64 value>      -> export the variable for later requests;
#                                    <key> must be a POSIX identifier, else
#                                    ERR|protocol
#   EXEC|<id>|<b64 cwd>|<timeout seconds|0>|<n args>|<output cap bytes|0>
#       followed by <n args> lines of base64, one argv word each
#       -> ACK|<id> the moment the request is dequeued for execution — the host
#          arms its stuck-request watchdog on this line, so time spent queued
#          behind an earlier request never counts against a budget
#       -> RES|<id>|<exit code>|<b64 stdout>|<b64 stderr>|<stdout cut?1:0>|<stderr cut?1:0>
#          With a cap, stdout and stderr are each cut at that many bytes and
#          the flags say which streams were cut; 0 means the whole capture.
#          or ERR|<id>|<reason>|<b64 message>   (reason: cwd)
#       An EXEC request runs as its own session and process group (`setsid`),
#       so a timeout or a KILL frame takes the whole descendant tree — not
#       just the direct child, which is how a build tool's daemonized
#       grandchild outlives the kill.
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

PROTO_VERSION=4
TMPDIR_AGENT=$(mktemp -d "${TMPDIR:-/tmp}/wsl-agent.XXXXXX")
OUT_FILE="$TMPDIR_AGENT/out"
ERR_FILE="$TMPDIR_AGENT/err"
trap 'rm -rf "$TMPDIR_AGENT"; [ -z "${CURRENT_STAGING:-}" ] || rm -rf -- "$CURRENT_STAGING"; [ -z "${WATCHDOG_PID:-}" ] || kill "$WATCHDOG_PID" 2>/dev/null; exit 0' EXIT

# The content identity of this script file, reported in the handshake: the
# host hashes its own shipped copy and refuses an agent whose file differs.
# cut with an explicit space: sha256sum separates hash and file with spaces,
# and the default tab delimiter would leave the whole line in the field.
AGENT_DIGEST=$(sha256sum -- "$0" 2>/dev/null | cut -d' ' -f1)

# Bounded cleanup: temp dirs from agents whose host died without giving them
# an EXIT (a `wsl --shutdown`, a force-killed wsl.exe). Own pattern only, and
# only when nothing inside moved for an hour — a live agent's dir mtime moves
# on every request (the inflight marker in run_capture is created and
# removed), so a sibling being served right now is never touched. A confined
# agent's /tmp is a private tmpfs: its own dir vanishes with it and it sees
# no siblings, so the sweep is a no-op there.
for stale in "${TMPDIR:-/tmp}"/wsl-agent.*; do
  [ -d "$stale" ] || continue
  [ "$stale" = "$TMPDIR_AGENT" ] && continue
  [ -z "$(find "$stale" -maxdepth 1 -mmin -60 -print -quit 2>/dev/null)" ] && rm -rf -- "$stale" 2>/dev/null
done

# The client lease: when the host goes silent without closing the pipe (a
# wedged relay, not a dead one — EOF exits the read loop), the agent
# terminates itself after the lease window instead of lingering with its
# temp dir. The window rides DSH_AGENT_LEASE_MS from the host's pinned
# environment, set above the host's own idle shutdown, so the lease only
# fires when the host is gone in every way that matters. A request in
# flight pauses the lease (the inflight marker) — a long command with no
# traffic is silence, not absence. Unset (an older host, a manual run)
# disables the lease: the host keeps the lifetime it always had.
LEASE_S=0
case ${DSH_AGENT_LEASE_MS:-} in
  ''|*[!0-9]*) ;;
  *) if [ "$DSH_AGENT_LEASE_MS" -gt 0 ]; then
       LEASE_S=$(( (DSH_AGENT_LEASE_MS + 999) / 1000 ))
       (
         while :; do
           sleep "$LEASE_S" || exit 0
           kill -0 "$$" 2>/dev/null || exit 0
           [ -f "$TMPDIR_AGENT/inflight" ] || kill -s TERM "$$"
         done
       ) &
       WATCHDOG_PID=$!
     fi ;;
esac

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

# Strict decode for payloads whose emptiness would LIE: an argv word that
# fails to decode must refuse the request, not run the command with a silent
# empty word where the host sent text (an empty payload is legitimate and
# decodes fine — only malformed base64 lands here). Sets DEC on success.
b64dec_strict() {
  DEC=$(printf '%s' "$1" | base64 -d 2>/dev/null) && return 0
  DEC=$(printf '%s' "$1" | base64 --decode 2>/dev/null) && return 0
  return 1
}

b64enc_file() {
  # `tr` strips the 76-column wraps GNU and BusyBox base64 both emit; the
  # protocol is one line per payload, so a wrapped encode would tear a large
  # RES line into protocol garbage the host would read as unknown lines.
  base64 "$1" 2>/dev/null | tr -d '\n' || base64 -- "$1" 2>/dev/null | tr -d '\n' || :
}

kill_current() {
  if [ -n "$CURRENT_PID" ]; then
    kill_request TERM "$CURRENT_PID"
  fi
}

# Signal one in-flight request, descendants included. With `setsid` (EXEC
# requests, below) the request is its own process-group leader, so the
# negative PID signals the WHOLE group — every descendant that did not make
# its own session. Without it the group does not exist, the negative-PID kill
# fails with ESRCH, and the direct kill keeps the old guarantee. A shell whose
# `kill` builtin cannot parse `-- -PID` at all also lands here.
kill_request() {
  # $1 = signal name, $2 = request PID.
  kill -s "$1" -- "-$2" 2>/dev/null || kill -s "$1" "$2" 2>/dev/null || :
}

shutdown() {
  kill_current
  exit 0
}
trap shutdown TERM INT HUP

# Whether EXEC requests can run as their own session. `setsid` makes the
# request process a session AND process-group leader (pid = pgid), which is
# what lets kill_request signal the whole descendant tree; the agent's own
# shell cannot do this portably — `set -m` in a non-interactive dash has been
# observed skipping the setpgid entirely, and a kill against a PID that is
# not a group leader is a no-op. A distro without `setsid` keeps working:
# requests then run in the agent's own group and the direct-child kill of the
# pre-setsid behaviour applies.
SETSID=
if command -v setsid >/dev/null 2>&1; then
  SETSID=setsid
fi

timeout_watcher() {
  # $1 = seconds, $2 = pid, $3 = grace seconds. TERM first — the whole group,
  # so a command that ignores TERM takes its descendants with it when the
  # KILL lands; a process that ignores TERM gets KILLed after the grace, so a
  # stuck command cannot hang the request forever.
  sleep "$1"
  kill_request TERM "$2"
  sleep "${3:-3}"
  kill_request KILL "$2"
}

# Capture one request's output and answer with RES. $1 = request id, $2 =
# timeout seconds ('' or 0 = none), $3 = per-stream output cap in bytes (0 or
# empty = unlimited), $4 = launch mode: `exec` runs "$@" (argv words) as the
# request process, in its own session via `setsid` when the distro has it —
# the timeout and KILL then signal the whole descendant group; `subshell` runs
# ( "$@" ) in a forked subshell, which is how the FS handlers — shell
# functions, not executables — run.
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
  # The inflight marker pauses the lease watchdog for this request and
  # refreshes the temp dir's mtime for the boot sweep; removing it after the
  # answer re-arms both.
  : >"$TMPDIR_AGENT/inflight"
  if [ "$mode" = subshell ]; then
    ( "$@" ) >"$OUT_FILE" 2>"$ERR_FILE" &
  elif [ -n "$SETSID" ]; then
    ( exec setsid "$@" ) >"$OUT_FILE" 2>"$ERR_FILE" &
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
  rm -f "$TMPDIR_AGENT/inflight"
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
  # The LIST TARGET follows symlinks, like every read path: `find` does not
  # traverse its starting point, so a symlink-to-directory used to list EMPTY
  # with exit 0 - a silent wrong answer where the peer's readdir answers with
  # the target's children. Resolve first, then enumerate; the entries keep
  # their own (lstat) types.
  d=$(realpath -L -- "$d" 2>"$ERR_FILE") || {
    err=$(cat "$ERR_FILE")
    fs_fail "$(fs_classify "$err")" "$err"
  }
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
  # host loops. The remainder is STREAMED through the pipe, never staged —
  # staging copied the whole tail to a temp file once per window, which made
  # a full read of a large file quadratic in the file's own size. tail's
  # stderr lands in ERR_FILE (its SIGPIPE death once `head` has had its fill
  # writes nothing there), so a real read failure is still classified.
  local p offset max err
  p=$(b64dec "$1")
  offset=$(b64dec "$2")
  max=$(b64dec "$3")
  [ "$max" -gt 0 ] || return 0
  : >"$ERR_FILE"
  tail -c +"$(( offset + 1 ))" -- "$p" 2>"$ERR_FILE" | head -c "$max" -- 2>/dev/null
  if [ -s "$ERR_FILE" ]; then
    err=$(cat "$ERR_FILE")
    fs_fail "$(fs_classify "$err")" "$err"
  fi
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
    # A host/agent contract breach is an I/O-class failure, not a file that
    # was not found: the mapped reason reads FS_IO_ERROR host-side.
    *)        fs_fail protocol "unknown fs op" ;;
  esac
}

printf 'HELLO|wsl-agent|%s|%s\n' "$PROTO_VERSION" "$AGENT_DIGEST"

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
      # The key exports into EVERY later request's environment, so it must be
      # a POSIX identifier: anything else would be a silent no-op for the
      # command (or a name collision with a shell special). Refused loudly.
      case $key in
        ""|[0-9]*|*[!A-Za-z0-9_]*)
          printf 'ERR||protocol|%s\n' "$(printf '%s' "SETENV key is not a POSIX identifier" | base64 | tr -d '\n')"
          continue
          ;;
      esac
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
      # Build the argv from the following base64 lines. Two refusal paths
      # before anything runs: a payload that does not decode (it would
      # silently become an EMPTY argv word — a different command than the
      # host sent), and a frame that ends before its declared argument count
      # (a truncated frame must never execute; EOF also means the host is
      # gone, and the exit trap cleans up).
      # shellcheck disable=SC2086
      set --
      n=0
      bad_decode=0
      while [ "$n" -lt "$nargs" ]; do
        IFS= read -r arg_b64 || exit 0
        n=$((n + 1))
        if ! b64dec_strict "$arg_b64"; then
          bad_decode=1
          continue
        fi
        set -- "$@" "$DEC"
      done
      if [ "$bad_decode" -ne 0 ]; then
        printf 'ERR|%s|protocol|%s\n' "$req_id" "$(printf '%s' "an argv payload failed to decode" | base64 | tr -d '\n')"
        continue
      fi
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
      # A frame that ends before its declared argument count must never run
      # its op on a partial argument list — and EOF means the host is gone.
      set --
      n=0
      while [ "$n" -lt "$nargs" ]; do
        IFS= read -r arg_b64 || exit 0
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
