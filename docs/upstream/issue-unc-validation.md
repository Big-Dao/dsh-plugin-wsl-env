# Issue draft: Workspace validation admits UNC paths the file toolchain cannot serve

> Draft for upstream `GitHub Issues` (bug report). Stock desktop 0.2.0-rc.2,
> Windows 11, WSL2 (Ubuntu 26.04), no third-party plugins. File/line
> references are against the 0.2.0-rc.2 source tree — the published tarball
> ships only `lib/`, so they resolve in the repository, not from an install.

## Summary

`packages/workspace/workspace/src/paths.ts:16-23` admits
`\\wsl.localhost\<distro>\...` as a workspace (the win32 check only requires
`root !== '\\' && root !== '/'`), but the file toolchain's Windows publication
path assumes NTFS primitives that the 9P share does not provide. The result is
a workspace that boots, reads, and then fails every write with misleading
errors.

## Steps to reproduce

1. Open `\\wsl.localhost\<distro>\home\<you>\proj` as a workspace in desktop.
2. Ask the model to edit an existing file (any file).
3. Ask the model to create a new file.

## Actual behavior

- **Edit / overwrite an existing file**: fails with `EIO` — the measured text
  is `Error: GetFileSecurityW EIO (Win32 1): \\wsl.localhost\...`. Root cause:
  `fs-local`'s Windows publication copies the source DACL via
  `GetFileSecurityW` (`packages/fs/fs-local/src/win32.ts:88-115`), which on
  the 9P share returns Win32 error 1 (`ERROR_INVALID_FUNCTION`), then
  publishes via `ReplaceFileW` (`win32.ts:122-134`) — neither is a 9P
  primitive (`packages/fs/fs-local/src/fsio.ts:622-647`).
- **Guarded create**: publication uses `link(temp, dest)` (`fsio.ts:633-638`);
  the 9P share rejects hard links, so `link` returns `ENOTSUP`, which the fs
  seam wraps as its generic `FS_IO_ERROR` — the errno survives only in the
  message text (`cannot write "<path>": …`), not as the code.
- Reading and listing work for plain files and directories, over the 9P share,
  at roughly 200× the per-file metadata cost of the same tree from inside the
  distro: ~17 000 µs per `stat` against ~86 µs measured in-distro.
- Symlinked paths are the read-side exception: the share exposes a Linux
  symlink as a reparse point whose POSIX target Windows cannot resolve, so
  `stat`, `realpath` and `read` on `/etc/os-release` or `/lib` return `ENOENT`
  (the seam reports `FS_NOT_FOUND`). On Ubuntu `/bin`, `/lib` and
  `/etc/os-release` are symlinks, so read-only tooling that reaches for them
  fails as well — the breakage is not confined to writes.
- A terminal tab opened on the workspace lands in `cmd.exe`, which prints
  "UNC paths are not supported" and abandons the directory.

## Expected behavior

Either:

1. the adoption path rejects `\\wsl.localhost\...` workspaces with a clear
   "not supported" signal, so users do not discover the limitation as
   `EIO`/`FS_IO_ERROR` mid-session; **or**
2. the toolchain serves these workspaces (a WSL provider family, comparable to
   how `packages/ssh` pairs `fs`/`subprocess`/`sandbox` remotes).

Note that (1) is not free: these workspaces read and list today, and admitting
the form is what lets a WSL-aware directory picker hand the registry a project
directory at all — an outright rejection would also stop setups that work now.
Accepting them read-only, behind a persistent banner, would remove the
misleading mid-session errors without that regression.

## Notes

- The mismatch is between two modules: a lexical validator
  (`workspace/src/paths.ts`) and an NTFS-assuming implementation
  (`fs-local/src/win32.ts`). Nothing connects them, which is why the failure
  appears as per-operation I/O errors rather than an adoption-time signal.
- A third-party plugin exists that serves these workspaces:
  `dsh-plugin-wsl-env` is an incremental version of (2) — a resident-agent
  substrate for `ctx.fs` and shell execution, a root-plane filesystem that
  routes by coordinates, search-spawn rewriting, terminal handling and
  directory-picker integration, with the workspace identity kept as the UNC
  path. It is not complete: the `@`-completion traversal still reads the share
  through upstream's own `node:fs` walk, because the seam it would need does
  not exist yet. Happy to share measurements, traces, or probe scripts if
  useful for deciding between (1) and (2).
