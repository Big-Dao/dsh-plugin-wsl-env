# dsh-plugin-wsl-env

Run a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) session
against a WSL distro. Commands execute *inside* the distro, the model's file tools
read and write real distro files, and the GUI's folder dialog can open one.

> The full engineering record — design rationale, measurements, and every
> discarded design with the reason it was abandoned — is
> **[README.zh.md](README.zh.md)** (Chinese); its §0.1 says which sections still
> describe the shipped design. This file is the short entry point.

## What it does

DSH is a Cordis application whose capabilities are exposed as *service seams*.
The model-facing tools (`bash`, `read`, `write`, `edit`, `glob`, `grep`) consume
those seams and never touch a filesystem or a shell directly. A WSL integration
is therefore not a new tool; it is two seam providers:

| Seam | Provider | Effect |
|---|---|---|
| `ctx.shell` | `WslShellExecutor` | every command runs as `wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>` |
| `ctx.fs` | `WslFileSystem` | Linux paths map onto the distro's UNC share, so the host fs stack (and the packaged ripgrep) operates on real distro files |

It also ships two smaller integrations:

| Package | Provides |
|---|---|
| `dsh-plugin-wsl-env/picker` | `ctx.directoryPicker` — lists Windows home *and* every installed distro at the root level, so one dialog opens a host folder or a distro folder |
| `dsh-plugin-wsl-env/auto-preset` | binds the `wsl` agent preset when a new session's workspace is inside a distro, in the `ensureSession` frame, so the very first mount is already correct and the host ACL sandbox never touches a 9p path |
| `dsh-plugin-wsl-env/shell-env` | contributes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL`, `DSH_WSL_HOME` to the managed `DSH_*` namespace the model reads |

## The one constraint that shapes everything

On Windows, DSH confines commands with `dsh-sandbox-windows-acl`: a restricted,
low-integrity token plus a write allowlist. **That token cannot reach WSL at
all** — `wsl.exe` fails with `Wsl/E_ACCESSDENIED` and `\\wsl.localhost\<distro>`
reports access denied. Both work normally outside the sandbox.

So this plugin subclasses the *non-sandboxing* executors and inherits
`sandboxMode === undefined`, which is the honest capability fact: the tool layer
reads it and advertises that these commands are not confined. WSL access is
inherently outside the harness's file sandbox; do not paper over that by
reporting a mode this provider does not enforce.

## Requirements

- Windows with WSL2 and at least one distro.
- DSH `0.2.0-rc.2`-era packages (`@deepseek-ai/dsh-base`, `dsh-web-app`).
- **No dependencies.** Everything the package needs is a peer, supplied by the
  profile that mounts it.

## Install

The plugin is consumed through a profile patch layer, not as an application.
Create a profile, link the checkout into it, then use the shipped
[`cordis.patch.yml`](cordis.patch.yml) as the user layer:

```powershell
dsh wsl --from-default-profile web --dump-config
dsh plugin --profile wsl add link:C:\path\to\dsh-plugin-wsl-env
# merge cordis.patch.yml into %USERPROFILE%\.dsh\profiles\wsl\cordis.patch.yml
dsh --profile wsl --dump-config        # compose only, no boot: the fastest check
dsh --profile wsl
```

`cordis.patch.yml` is commented line by line and is the authoritative install
reference, including the generated `preset-wsl` block.

> A running process caches ES modules. **Restart the app after changing `lib/`**,
> or the old code stays loaded.

## Layout

```
lib/paths.js        pure path translation between the three coordinate systems
lib/wsl.js          wsl.exe interop primitives (no DSH imports)
lib/listing.js      pure directory-listing and breadcrumb helpers (no DSH imports)
lib/index.js        WslShellExecutor (ctx.shell) + WslFileSystem (ctx.fs)
lib/picker.js       WslDirectoryPicker (ctx.directoryPicker)
lib/auto-preset.js  per-session environment selection
lib/shell-env.js    DSH_WSL_* environment facts
lib/{shell,fs}.js   one-line subpath entry points
cordis.patch.yml    the profile patch layer, with comments
test/               unit tests and the behavioural probe
```

## Testing

```bash
npm test          # syntax check + unit tests — dependency-free, runs anywhere
npm run probe     # behavioural probe against a real distro (Windows + WSL only)
```

`npm test` covers the pure modules plus a `--check` parse pass over every shipped
module. It cannot import the service modules: they need DSH peers that a bare
checkout does not have. That leaves an evaluation-time gap which only booting the
harness closes — see README.zh.md §20.4 for the five rounds of misdiagnosis that
gap once caused.

`test/probe/` drives `ctx.fs` inside a throwaway profile that binds it to the
distro, and asserts the whole publication path: create, read, version guard,
edit, overwrite, mode preservation, and the two guard rejections. It also carries
a negative-control mode. See README.zh.md §21.5 for the recorded output.

The probe needs a Windows-side profile whose `node_modules/dsh-plugin-wsl-env`
points at the checkout; `test/probe/run.sh` documents the one-time setup in its
header.

## Verified

Local, on Windows 11 + WSL2 (Ubuntu 26.04):

- the seam wiring, UNC primitives and picker behaviour, in and out of process;
- the plugin mounted in a real profile, end to end;
- a **real model turn** in a WSL-only headless profile:
  `write → chmod → read → edit → execute`, with the executable bit surviving the
  edit;
- the same `write`/`edit` tools in the daily GUI profile.

26 unit assertions and 14 probe assertions pass.

## Known limitations

- Freshly created files get the distro umask default (0644), not an executable
  bit: a host-side `chmod` over the share is silently ignored. Overwrites and
  edits *do* preserve the mode. `chmod +x` from inside the distro when needed.
- Guards are check-then-act, not atomic: this backend checks the caller's guard
  itself because the host backend's guarded publication uses a hard link the
  share rejects. The race is the one `dsh-fs-sandbox` already documents.
- `watch()` is refused outright rather than armed unreliably over 9p.
- `glob`/`grep` run the host ripgrep over the share: correct, but not fast, and
  the `.gitignore` semantics are the host's.
- `editText` reads and rewrites the whole file in memory.

## Repository notes

The checkout is developed inside the distro, but the harness is a Windows process
and a profile can only link a Windows path (`link:\\wsl.localhost\…` is rewritten
to a broken `/wsl.localhost/…` symlink by pnpm). The Windows copy under
`default-workspace/dsh-plugin-wsl` is therefore a **runtime mirror**; keep the two
in sync with `test/probe/sync-to-windows.sh` before launching the app.

## License

MIT — see [LICENSE](LICENSE).
