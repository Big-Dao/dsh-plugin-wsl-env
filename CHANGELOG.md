# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The reasoning and the measurements behind each entry are in
[README.zh.md](README.zh.md); the section numbers below point at the record.

## [Unreleased]

### Changed

- Static review: the manifest now says only what the shipped code does.
  - `main` pointed at `lib/index.js` while `exports["."]` resolved to
    `lib/shell.js`. Only the latter exposes a default export, so a tool that
    read `main` instead of `exports` got a module with no plugin in it.
  - `lib/index.js` re-exported path helpers that nothing could reach: the
    `exports` map does not expose `lib/index.js`, and the helpers already have
    their own `./paths` and `./wsl` subpaths.
  - Dropped an unused `ENV_OVERRIDES` import.

### Removed

- Three peer declarations this plugin neither imports nor injects:
  `@deepseek-ai/dsh-sandbox`, `@deepseek-ai/dsh-shell` and
  `@deepseek-ai/dsh-tools`. They were required by the abandoned tool-renaming
  designs (§15/§18), which could only stub the sandbox symbols locally (§15.5).
  The remaining set is checkable in one command —
  `grep -rho 'from "@deepseek-ai/[^"]*"' lib/ | sort -u` — plus
  `@deepseek-ai/dsh-subprocess` (the service `static inject` requires) and
  `@deepseek-ai/cordis`, which every DSH plugin declares.

### Fixed

Documentation that a reader would have acted on, and that was no longer true:

- §10 and §12 presented the removed `DSH_WSL` process switch as the current way
  to use the plugin. Both are now marked superseded, with a note on what still
  holds inside them, and a new §0.1 reading guide says which sections describe
  the shipped design.
- §9.6 and §11.5 claimed the `wsl` and `wsltest` profiles were still available;
  §16.6 made the same claim about `envweb`. All three are gone.
- §10.8 documented the superseded `build-desktop-patch.mjs` flow; it now names
  `build-preset-wsl.mjs`, the generator the shipped patch was actually made with.
- §20.5 answered "nothing to do after an app upgrade" while §10.8 said the
  generated preset copy has to be regenerated.
- References to `dsh-wsl-research/` now say it is a machine-local directory that
  is not part of the repository.

## [0.1.0] - 2026-10-02

First working release: a WSL distro can be opened, browsed and worked in from a
DeepSeek Harness session, with both capability seams served from the distro.

### Added

- `WslShellExecutor` (`ctx.shell`): runs every command inside the distro as
  `wsl.exe -d <distro> --cd <linux dir> --exec <shell> -lc <cmd>`, where the
  shell is the distro user's login shell rather than a hardcoded bash. (§3, §14)
- `WslFileSystem` (`ctx.fs`): maps Linux paths onto the distro's UNC share so the
  host fs stack — including the packaged ripgrep — operates on real distro files,
  with Linux paths as the model-facing `displayPath` and the UNC path as the
  opaque `targetKey`. (§3)
- Symlinked paths resolve by asking the distro for `readlink -f` and retrying
  once, which is what makes `/etc/os-release`, `/bin` and `/lib` readable over a
  share that cannot traverse POSIX symlinks. (§11.4)
- `WslDirectoryPicker` (`ctx.directoryPicker`): lists Windows home and every
  installed distro at the root level, so the shipped GUI dialog becomes the
  single workspace picker for host and distro folders alike. It reports
  `kind: 'browse'` — a third kind would invalidate the three Remote verbs that
  require it. (§8)
- `auto-preset`: binds the `wsl` agent preset when a new session's workspace is
  inside a distro, inside the `ensureSession` frame so the very first mount is
  already correct and the host ACL sandbox never touches a 9p path. (§16, §20)
- `shell-env`: contributes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL` and `DSH_WSL_HOME`
  to the managed `DSH_*` namespace, so the model can read the real environment
  instead of inferring it from a tool name. (§19)
- Behavioural probe harness under `test/probe/`, with two throwaway profiles and
  a negative-control run. (§21.5)

### Fixed

- `wsl.exe` was handed the command without `--exec`, so the distro's default
  shell expanded it once first: `$x`, `$?`, `$(...)`, `${...}` and backticks were
  silently eaten. (§13)
- The shell was hardcoded to bash, discarding the PATH and rc setup of a user
  whose login shell is zsh, fish or dash. (§14)
- Guarded creation (`createIfAbsent`) failed with `FS_IO_ERROR`, because the host
  backend publishes it with a hard link and the share rejects hard links with
  `ENOTSUP`; the guard is now checked by this backend and publication is a plain
  rename. (§2.2)
- The managed `DSH_*` namespace never reached the distro. WSL imports only the
  names listed in `WSLENV`, and the executor forwarded a fixed allowlist; it now
  forwards the whole prefix, and marks the two Windows-path facts `DSH_HOME` and
  `DSH_PROFILE_DIR` with `/p` so the distro sees `/mnt/c/...`. (§19.7)
- **Every write to an existing file, and therefore every edit, failed** with
  `EIO: GetFileSecurityW EIO (Win32 1)`. `dsh-fs-local` takes a Windows branch
  whenever the destination exists — to inherit the replaced file's DACL — and a
  9p share carries no Windows security descriptor. Publication now uses the POSIX
  path. (§21)
- Overwriting or editing a file silently dropped its POSIX mode, so editing a
  script made it non-executable: the share ignores a host-side `chmod`, and a
  host-side `stat` always reports 0666. The target's real mode is now copied onto
  the staged temp file inside the distro, where a rename preserves it. (§21.3)

### Known limitations

See [README.zh.md §7](README.zh.md) for the full list, including the 9p
performance caveat, unsupported `watch()`, and the missing executable bit on
freshly created files.
