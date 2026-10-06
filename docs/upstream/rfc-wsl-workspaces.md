# RFC: WSL workspaces — accidentally usable, accidentally broken

> Draft for upstream `GitHub Discussions` (feature proposal / design discussion).
> All measurements below are from a stock desktop build (0.2.0-rc.2, Windows 11,
> WSL2 Ubuntu 26.04) with **no third-party plugins installed**. File/line
> references are against the 0.2.0-rc.2 source tree.

## Summary

A `\\wsl.localhost\<distro>\...` path passes workspace validation and boots as
a workspace, but the composition has no WSL concept behind it. The result is a
workspace that **reads fine, writes never**: every overwrite/edit fails with
`EIO`, every guarded create with `FS_IO_ERROR` (the share's `ENOTSUP`
survives only in the message text), the GUI terminal lands in
`cmd.exe` ("UNC paths are not supported"), and the consumers that do work do
so over the 9P share at roughly **200× the metadata cost** of the same files
accessed from inside the distro.

This proposal lays out measurements, a consumer inventory, the root cause
(the validator admits what the composition cannot serve), and two directions:
a small guardrail change, and a provider family that mirrors `packages/ssh`.

## Reproduction (stock desktop)

1. Open `\\wsl.localhost\<distro>\home\<you>\proj` as a workspace. The win32
   path check (`packages/workspace/workspace/src/paths.ts:16-23`,
   `root !== '\\' && root !== '/'`) admits UNC without any special handling.
2. Ask the model to edit any existing file → `EIO`, measured as
   `Error: GetFileSecurityW EIO (Win32 1): \\wsl.localhost\...`.
3. Ask it to create a new file → `FS_IO_ERROR`, with the share's `ENOTSUP` in
   the message text rather than in the code.
4. Open a terminal tab → `cmd.exe` prints "UNC paths are not supported" and
   abandons the directory.
5. Search works — the packaged `rg.exe` answers, at the per-query cost of the
   search row below.

## Measurements

| Probe | Windows→WSL (9P, stock path) | Linux→WSL (in-distro) | NTFS (drive workspace) |
|---|---|---|---|
| Per-file metadata (stat) | ~17 000 µs | ~86 µs | ~71 µs |
| ripgrep content search (120 files) | 2031 ms | 7 ms | — |
| ripgrep `--files --no-ignore --hidden` (1660 files) | 6256 ms | 383 ms | — |
| watch (chokidar v4 → fs.watch) | no usable events | — | works |
| write to an existing file | `EIO` | works | works |
| guarded create | `FS_IO_ERROR` (`ENOTSUP` in the message) | works | works |

The direction asymmetry is structural: the Plan9 redirector pays a cross-VM
round trip per metadata request, with no NTFS-style attribute cache. Reducing
syscall counts saves constants; the per-request boundary cost stays.

**Reproducing it.** The columns are one tree seen from three places, not three
machines: the per-request 9P cost moves with the Windows build, the WSL kernel
and the probe itself, so hold the probe shape fixed and read the columns
against each other rather than the constants as absolutes. Row by row, with the
same file set on both sides:

| Row | Windows-side probe | Distro-side probe |
|---|---|---|
| per-file metadata | the harness's `fs.stat` (root `ctx.fs` → `fs-local`) over the tree, 200 first touches, median | `stat(2)` on ext4 over the same 200 files |
| ripgrep content search | the packaged `rg.exe` through root `ctx.subprocess`, cwd = UNC, over the 120-file tree | the same pattern over the same tree |
| ripgrep file listing | the same `rg.exe` with `--files --no-ignore --hidden` over the 1660-file tree | `rg --files --no-ignore --hidden` |
| watch | chokidar v4's `fs.watch` backend on the UNC root, while the file is written in-distro | — (the row is pass/fail on the Windows side) |
| write / guarded create | the fs tool's edit and create on the UNC path | the same two operations in-distro |

The NTFS column is the control: the same trees and the same probes with the
paths on a drive, so the gap between it and the 9P column is the share, not the
implementation. The last two rows are verdicts, not timings: they are the two
operations whose failure surfaces in the Reproduction steps above. Run the two
`rg` rows with the same ripgrep version and the same flags on both sides — the
comparison is the boundary, not the implementations, and the Windows side is
whatever binary the harness packages.

## Why the write path fails (root cause)

`fs-local`'s Windows publication branch assumes NTFS primitives
(`packages/fs/fs-local/src/win32.ts:108-134`, `fsio.ts:622-649`):

- **Overwrite**: copies the source DACL with `GetFileSecurityW` /
  `SetFileSecurityW`, then publishes with `ReplaceFileW`. On the 9P share
  `GetFileSecurityW` returns Win32 error 1 (`ERROR_INVALID_FUNCTION`),
  surfacing as `EIO` — so *every* overwrite and edit fails, not just exotic
  paths.
- **Guarded create**: publishes via `link(temp, dest)`; 9P rejects hard links
  with `ENOTSUP`, which the seam wraps as its generic `FS_IO_ERROR` — that
  errno survives only in the message text, not as the code.
- Symlinks: 9P rejects `symlink` with `EPERM`; the share cannot traverse
  Linux symlinks either, so `/etc/os-release` and `/bin` are unreachable from
  the read tools without out-of-band canonicalization.

## Consumer inventory (what touches the share, and how it behaves)

| Root consumer | Mechanism | Behavior on a UNC workspace |
|---|---|---|
| `tool-fs` (read/write/edit) | `ctx.fs` → `fs-local` | reads OK (slow); writes fail as above |
| `tool-fs-search` (glob/grep) | packaged `rg.exe` via root `ctx.subprocess`, cwd = UNC | works, ~2 s/query |
| `terminal-controller` | `agent.ctx.get('subprocess')` → node-pty/ConPTY, `cwd` = UNC | default `ComSpec` (cmd.exe) refuses the UNC cwd; PowerShell would sit on the 9P share |
| `workspace-files` (file tree/preview) | root `ctx.fs` | works (slow); change feed without events |
| `workspace-changes` (git snapshots) | root `ctx.subprocess`, host git | works (slow); Windows git reading the 9P tree |
| `file-reference-local` (`@` completion) | direct `node:fs/promises` readdir | works (slow) |
| shell-activity integration | gated to interactive `bash`/`zsh` on a POSIX host | never armed for any launch on Windows; activity unknown |

## Root cause, stated plainly

The validator admits what the composition cannot serve.
`paths.ts:16-23` is a *lexical* check; `fs-local`'s Windows branch is an
*NTFS-primitive* implementation. Nothing connects the two, so the mismatch
surfaces as per-operation I/O errors that look like bugs rather than as an
unsupported-workspace signal.

## Direction A — guardrail (small)

Make the mismatch explicit: reject UNC workspaces at adoption with a clear
"not supported without a WSL provider" message, or accept them read-only with
a persistent banner. This is a small change to the adoption path plus honest
error codes, and it stops the per-operation `EIO`/`FS_IO_ERROR` from reading as
product bugs.

## Direction B — provider family (larger): a WSL counterpart of `packages/ssh`

`packages/ssh` already defines the architecture for "the workspace is not on
this machine": one connection service plus paired `fs` / `subprocess` /
`sandbox` / `lsp-stdio` providers, an installed-and-digest-verified helper on
the remote side, and remote sandbox-backend selection ("the remote host selects
its installed local sandbox backend"). A WSL family would mirror it with
`wsl.exe -d <distro> --exec` as the transport. One member of that contract
changes shape rather than dropping out:

- **connection**: distro resolution plus a resident helper process on the
  distro side. The transport is a local VM boundary, so the SSH *machinery* —
  keys, a remote daemon, a network stack — has no counterpart here: the helper
  is a plain script spawned over `--exec` and spoken to over its own stdio, so
  nothing listens and nothing is installed. Its *deployment* contract does not
  disappear with the transport, and one property makes it sharper than ssh's:
  the script is read in place from a path the Windows side also sees (in the
  deployed layout, a `/mnt/c` mirror), so a stale or half-synced copy can pass
  a version handshake while drifting in behaviour. A WSL helper therefore needs
  content identity — the handshake carries the sha256 of the file the distro
  actually read, and the host refuses a helper whose bytes differ from the copy
  it shipped, naming the resync — and it needs a lifetime of its own: with no
  daemon registration and no listening socket, it must end itself when the host
  goes silent without ever closing the pipe (the wedged-relay case EOF cannot
  cover), on a lease the host pins through the environment, which a request in
  flight pauses. A boot-time sweep of its own temp residue covers the host that
  died before the helper's exit path could run.
- **fs / subprocess / sandbox**: providers that exec through the helper, with
  the sandbox backend selected on the distro side (e.g. bubblewrap),
- **lsp-stdio**: the pair ssh also carries (`ctx.lsp`) — its remote form is
  `fs` + `subprocess` again, so the rows above are what it needs; the desktop
  composition does not mount LSP today, which makes this the one family member
  a WSL family would bring into existence rather than re-serve,
- composition rows gated on `process.platform === 'win32'` plus a WSL
  availability probe — the same idiom the base bundle already uses for the
  `bash-sandbox` / `pwsh-sandbox` platform split,
- consumers that cannot ride the seams (native dialogs, Windows-side file
  opening) keep working because the workspace identity stays a Windows path.

This closes the whole inventory at once — writes, watch, terminals, search,
and the root consumers — instead of per-consumer patches. LSP is the exception
that proves the shape: it is absent from today's desktop composition, so the
family defines its remote pair rather than taking over a live consumer.

## Prior art

A third-party plugin (`dsh-plugin-wsl-env`) implements an incremental version
of Direction B against the current seams: a resident-agent substrate for
`ctx.fs` and shell execution, search spawn rewriting, distro-side terminal
observation, and directory-picker integration. It exists mostly as evidence
that Direction B is reachable incrementally, and as a source of live
measurements and probes; happy to contribute either.

## Addendum: two seams the inventory points at

Implementing Direction B incrementally (as the third-party plugin does)
surfaced two places where a small upstream seam would let a provider serve
UNC workspaces without per-consumer patches:

1. **The `@` completion traversal.** `file-reference-local` walks the
   workspace with `node:fs/promises` through three module-internal functions
   that funnel all traversal: `readWorkspaceRoot` and `readDirectory` (readdir
   with `withFileTypes`) plus `resolveDisplayDirectory`, a lexical resolve and
   a per-segment `lstat` walk. Exposing them as an injectable strategy is a
   ~10-line change and would let a provider answer completions with a
   distro-side `find` instead of a 9P walk.

   **The concrete proposal.** Group the three filesystem touches into one
   strategy and take it as a third `WorkspaceFileSearch` constructor
   parameter (and a `LocalFileReferenceService` hook beside it), defaulting
   to today's implementations:

   ```ts
   interface FileReferenceTraversal {
     readWorkspaceRoot(absolute: string, signal: AbortSignal): Promise<Dirent[]>;
     readDirectory(absolute: string, signal: AbortSignal): Promise<Dirent[]>;
     resolveDisplayDirectory(root: string, displayDirectory: string,
       signal: AbortSignal): Promise<string | undefined>;
   }
   ```

   The third function matters as much as the two listers: directory-scoped
   queries (`@src/`) reach the filesystem through it, and its per-segment
   `lstat` walk is one 9P round trip per path component in the slow
   direction. Everything above the strategy — the bounded index, the
   generation/invalidation dance, the fuzzy ranking, the excluded-directory
   list — stays upstream-owned, so a provider changes *where* the bytes come
   from, never *how* candidates are chosen.

   The provider side must hold three semantics the current Dirent flow
   implies: entries keep the `{name, isDirectory(), isFile()}` shape with
   symlinks reporting neither (readdir Dirents are lstat-based — a distro
   listing needs `find -printf '%y'`, not `ls -L`, to match); an unreadable
   directory yields `[]` while a failed *root* rejects; and returned
   absolutes stay in the root's own coordinate system, because
   `scanWorkspace` joins children with the host `node:path`. The plugin
   ships a tested implementation of exactly this strategy
   (`lib/file-reference-wsl.js`: resident-agent `find` listings, a
   one-exec segment walk replacing N sequential lstats, UNC↔POSIX
   translation) — the takeover lands the day the parameter exists.

2. **A coordinate-routing root filesystem.** Several root consumers
   (`workspace-files`, and future ones) consume the root `ctx.fs`, which a
   per-session preset cannot influence (the root plane is session-less — and
   note that `workspace-changes`, a `ctx.subprocess` consumer in the inventory
   above, is not a `ctx.fs` one: it injects `subprocess` alone and reads the
   work tree through its own `node:fs/promises`). A root-plane filesystem that
   routes by coordinates — UNC → a distro provider, drive → the local
   implementation — would make every current and future root consumer correct
   on both workspace kinds.
   *(Status note: the plugin now carries a working implementation of this
   shape — `lib/fs-routing.js`, introduced in 0.7.2 and current as of 0.8.0 —
   usable as the reference for the upstream form. One dependency arrived later
   than the router: the `processPathFromHostPath` synchronous-contract gap was
   closed in 0.8.0 inside the backend it delegates to (`WslFileSystem`, which
   does that mapping), so 0.7.2 is the pre-fix pair. Take the reference with
   the deliberate differences its design note (`docs/root-fs-routing.md`)
   records, which an upstream form would inherit silently: the root write fence
   retires (the root plane has no write consumers today, and distro writes
   carry the distro-side fence instead); `processPath` on a UNC target answers
   in Linux form, while `fileUrl` is not routed at all — the inherited
   implementation derives it from `processPath`, and on Windows that derivation
   runs the host platform's encoding first, so `file:///home/...` is not a
   shape to rely on; and watch degrades to `find -newer` polling with its known
   mtime blind spot. A root plane that grows a write consumer would have to
   bring the fence back with it.)*

## Questions for maintainers

1. Is Direction A acceptable as an interim guardrail, or would rejecting
   paths that currently *read* fine be a regression for existing users?
2. For Direction B, is a `packages/wsl` provider family the intended shape,
   or would this be folded into the ssh family as an alternate transport?
3. Should session presets be allowed to influence workspace adoption
   (directory → environment), or does that belong to deployment profiles?
