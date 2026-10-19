#!/usr/bin/env bash
# Measure the @-reference traversal cost: the windows-side walk over the WSL
# UNC share (9p) versus the same walk on the distro's ext4 (WSL-204).
#
# The current `@` completion runs in the harness process on Windows and walks
# the workspace through the share; the proposed `FileReferenceTraversal` seam
# would let the plugin serve the same walk from the distro. This probe measures
# the difference on a synthetic tree so the decision is evidence-based.
#
#   test/probe/file-reference-9p.sh [entries-per-dir]
#
# Needs the app installed (env.sh), no harness boot.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/env.sh"
if ! command -v node >/dev/null 2>&1; then
  export PATH="$HOME/.local/share/fnm/aliases/default/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || { echo "file-reference-9p: node not found" >&2; exit 1; }

PER_DIR="${1:-25}"
DIRS=20
TREE="/tmp/dsh-fr-9p-bench"
rm -rf "$TREE"
for d in $(seq 1 "$DIRS"); do
  mkdir -p "$TREE/dir$d/sub"
  : > "$TREE/dir$d/top.txt"
  for f in $(seq 1 "$PER_DIR"); do : > "$TREE/dir$d/sub/f$f.txt"; done
done
trap 'rm -rf "$TREE"' EXIT

UNC_TREE="\\\\wsl.localhost\\$DISTRO\\tmp\\dsh-fr-9p-bench"
JS='const fs=require("node:fs"),path=require("node:path");const t=performance.now();let f=0,d=0;const walk=(p)=>{for(const e of fs.readdirSync(p,{withFileTypes:true})){if(e.isDirectory()){d++;walk(path.join(p,e.name));}else f++;}};walk(process.env.FR_TREE);console.log(JSON.stringify({ms:performance.now()-t,files:f,dirs:d}));'

walk_win() {
  env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR -u DSH_SESSION_ID -u DSH_SHELL -u DSH_WEB_URL \
    WSLENV="FR_TREE:ELECTRON_RUN_AS_NODE" ELECTRON_RUN_AS_NODE=1 FR_TREE="$UNC_TREE" \
    "$APP/DeepSeek Harness.exe" -e "$JS"
}
walk_local() { FR_TREE="$TREE" node -e "$JS"; }

median() { sort -n | awk '{ a[NR] = $1 } END { print a[int((NR + 1) / 2)] }'; }

echo "== @-reference traversal: 9p vs ext4 =="
echo "tree: $DIRS dirs, $((DIRS * (PER_DIR + 1))) files"
echo
WIN_MS=()
LOCAL_MS=()
for _ in 1 2 3; do
  WIN_MS+=("$(walk_win | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Math.round(JSON.parse(s).ms*10)/10))')")
  LOCAL_MS+=("$(walk_local | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Math.round(JSON.parse(s).ms*10)/10))')")
done
WIN_MED="$(printf '%s\n' "${WIN_MS[@]}" | median)"
LOCAL_MED="$(printf '%s\n' "${LOCAL_MS[@]}" | median)"
RATIO="$(node -e "console.log(Math.round($WIN_MED / $LOCAL_MED * 10) / 10)")"
echo "9p (Windows walk over \\\\wsl.localhost): ${WIN_MED} ms  (samples: ${WIN_MS[*]})"
echo "ext4 (distro walk):                     ${LOCAL_MED} ms  (samples: ${LOCAL_MS[*]})"
echo "RESULT: 9p is ${RATIO}x the ext4 walk on this tree"
echo
echo "The proposed seam (docs/upstream/rfc-wsl-workspaces.md, addendum 1) would let"
echo "the plugin serve readWorkspaceRoot/readDirectory/resolveDisplayDirectory from"
echo "the distro; see docs/UPSTREAM-FILE-REFERENCE-SEAM.md."
