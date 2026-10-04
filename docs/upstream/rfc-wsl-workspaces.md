# RFC: WSL workspaces — accidentally usable, accidentally broken

> Draft for upstream `GitHub Discussions` (feature proposal / design discussion).
> All measurements below are from a stock desktop build (0.2.0-rc.2, Windows 11,
> WSL2 Ubuntu 24.04) with **no third-party plugins installed**. File/line
> references are against the 0.2.0-rc.2 source tree.

## Summary

A `\\wsl.localhost\<distro>\...` path passes workspace validation and boots as
a workspace, but the composition has no WSL concept behind it. The result is a
workspace that **reads fine, writes never**: every overwrite/edit fails with
`EIO`, every guarded create with `ENOTSUP`, the GUI terminal lands in
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
2. Ask the model to edit any existing file → `EIO`.
3. Ask it to create a new file → `ENOTSUP`.
4. Open a terminal tab → `cmd.exe` prints "UNC paths are not supported" and
   abandons the directory.
5. Search works — at ~2 s per query.

## Measurements

| Probe | Windows→WSL (9P, stock path) | Linux→WSL (in-distro) | NTFS (drive workspace) |
|---|---|---|---|
| Per-file metadata (stat) | ~17 000 µs | ~86 µs | ~71 µs |
| ripgrep content search (120 files) | 2031 ms | 7 ms | — |
| ripgrep `--files --no-ignore --hidden` (1660 files) | 6256 ms | 383 ms | — |
| watch (chokidar v4 → fs.watch) | no usable events | — | works |
| write to an existing file | `EIO` | works | works |
| guarded create | `ENOTSUP` | works | works |

The direction asymmetry is structural: the Plan9 redirector pays a cross-VM
round trip per metadata request, with no NTFS-style attribute cache. Reducing
syscall counts saves constants; the per-request boundary cost stays.

## Why the write path fails (root cause)

`fs-local`'s Windows publication branch assumes NTFS primitives
(`packages/fs/fs-local/src/win32.ts:108-134`, `fsio.ts:622-649`):

- **Overwrite**: copies the source DACL with `GetFileSecurityW` /
  `SetFileSecurityW`, then publishes with `ReplaceFileW`. On the 9P share
  `GetFileSecurityW` returns Win32 error 1 (`ERROR_INVALID_FUNCTION`),
  surfacing as `EIO` — so *every* overwrite and edit fails, not just exotic
  paths.
- **Guarded create**: publishes via `link(temp, dest)`; 9P rejects hard links
  with `ENOTSUP`.
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
error codes, and it stops the per-operation `EIO`/`ENOTSUP` from reading as
product bugs.

## Direction B — provider family (larger): a WSL counterpart of `packages/ssh`

`packages/ssh` already defines the architecture for "the workspace is not on
this machine": one connection service plus paired `fs` / `subprocess` /
`sandbox` providers, an installed-and-digest-verified helper on the remote
side, and remote sandbox-backend selection ("the remote host selects its
installed local sandbox backend"). A WSL family would mirror it with
`wsl.exe -d <distro> --exec` as the transport:

- **connection**: distro resolution, a resident helper process on the distro
  side (the transport is a local VM boundary, so no SSH machinery is needed),
- **fs / subprocess / sandbox**: providers that exec through the helper, with
  the sandbox backend selected on the distro side (e.g. bubblewrap),
- composition rows gated on `process.platform === 'win32'` plus a WSL
  availability probe — the same idiom the base bundle already uses for the
  `bash-sandbox` / `pwsh-sandbox` platform split,
- consumers that cannot ride the seams (native dialogs, Windows-side file
  opening) keep working because the workspace identity stays a Windows path.

This closes the whole inventory at once — writes, watch, terminals, search,
and the root consumers — instead of per-consumer patches.

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
   workspace with `node:fs/promises` readdir/lstat through two
   module-internal functions (`readDirectory`, `readWorkspaceRoot`) that
   funnel all traversal. Exposing them as an injectable strategy is a
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
   (`workspace-files`, `workspace-changes`, and future ones) consume the root
   `ctx.fs`, which a per-session preset cannot influence (the root plane is
   session-less). A root-plane filesystem that routes by coordinates — UNC →
   a distro provider, drive → the local implementation — would make every
   current and future root consumer correct on both workspace kinds.
   *(Status note: the plugin now carries a working implementation of this
   shape — `lib/fs-routing.js`, released as 0.7.2 — usable as the reference
   for the upstream form.)*

## Questions for maintainers

1. Is Direction A acceptable as an interim guardrail, or would rejecting
   paths that currently *read* fine be a regression for existing users?
2. For Direction B, is a `packages/wsl` provider family the intended shape,
   or would this be folded into the ssh family as an alternate transport?
3. Should session presets be allowed to influence workspace adoption
   (directory → environment), or does that belong to deployment profiles?
