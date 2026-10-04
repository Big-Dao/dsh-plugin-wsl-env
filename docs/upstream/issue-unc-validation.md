# Issue draft: Workspace validation admits UNC paths the file toolchain cannot serve

> Draft for upstream `GitHub Issues` (bug report). Stock desktop 0.2.0-rc.2,
> Windows 11, WSL2 (Ubuntu 24.04), no third-party plugins.

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

- **Edit / overwrite an existing file**: fails with `EIO`. Root cause:
  `fs-local`'s Windows publication copies the source DACL via
  `GetFileSecurityW` (`packages/fs/fs-local/src/win32.ts:108-115`), which on
  the 9P share returns Win32 error 1 (`ERROR_INVALID_FUNCTION`), then
  publishes via `ReplaceFileW` (`win32.ts:122-134`) — neither is a 9P
  primitive (`packages/fs/fs-local/src/fsio.ts:622-647`).
- **Guarded create**: fails with `ENOTSUP`. Publication uses
  `link(temp, dest)` (`fsio.ts:633-638`); the 9P share rejects hard links.
- Reading and listing work (over the 9P share, at roughly 200× the per-file
  metadata cost of the same tree from inside the distro).
- A terminal tab opened on the workspace lands in `cmd.exe`, which prints
  "UNC paths are not supported" and abandons the directory.

## Expected behavior

Either:

1. the adoption path rejects `\\wsl.localhost\...` workspaces with a clear
   "not supported" signal, so users do not discover the limitation as
   `EIO`/`ENOTSUP` mid-session; **or**
2. the toolchain serves these workspaces (a WSL provider family, comparable to
   how `packages/ssh` pairs `fs`/`subprocess`/`sandbox` remotes).

## Notes

- The mismatch is between two modules: a lexical validator
  (`workspace/src/paths.ts`) and an NTFS-assuming implementation
  (`fs-local/src/win32.ts`). Nothing connects them, which is why the failure
  appears as per-operation I/O errors rather than an adoption-time signal.
- A third-party plugin exists that serves these workspaces end to end
  (resident helper inside the distro); happy to share measurements, traces, or
  probe scripts if useful for deciding between (1) and (2).
