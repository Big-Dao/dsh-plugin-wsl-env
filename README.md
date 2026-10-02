# dsh-plugin-wsl-env

Run a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) session
against a WSL distro. Commands execute *inside* the distro, the model's file tools
read and write real distro files, and the GUI's folder dialog can open one.

> The full engineering record — design rationale, measurements, and every
> discarded design with the reason it was abandoned — is
> **[README.zh.md](README.zh.md)** (Chinese); its §0.1 explains what stayed here and what
> moved to the archive of replaced designs. This file is the short entry point.

## What it does

DSH is a Cordis application whose capabilities are exposed as *service seams*.
The model-facing tools (`bash`, `read`, `write`, `edit`, `glob`, `grep`) consume
those seams and never touch a filesystem or a shell directly. A WSL integration
is therefore not a new tool; it is two seam providers:

| Seam | Provider | Effect |
|---|---|---|
| `ctx.shell` | `WslShellExecutor` | every command runs as `wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>`, wrapped in a distro-side `bwrap` sandbox |
| `ctx.fs` | `WslFileSystem` | Linux paths map onto the distro's UNC share, so the host fs stack (and the packaged ripgrep) operates on real distro files, fenced by the same policy |
| `ctx.subprocess` | `WslSubprocessRuntime` | the GUI's right-sidebar terminal window opens a shell *inside the distro*, in the Session workspace, instead of `cmd.exe` in a UNC directory |

It also ships three smaller integrations:

| Package | Provides |
|---|---|
| `dsh-plugin-wsl-env/picker` | `ctx.directoryPicker` — lists Windows home *and* every installed distro at the root level, so one dialog opens a host folder or a distro folder |
| `dsh-plugin-wsl-env/auto-preset` | binds the `wsl` agent preset when a new session's workspace is inside a distro, in the `ensureSession` frame, so the very first mount is already correct and the host ACL sandbox never touches a 9p path |
| `dsh-plugin-wsl-env/shell-env` | contributes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL`, `DSH_WSL_HOME` to the managed `DSH_*` namespace the model reads |

## Why the terminal provider sits at the composition level

`ctx.shell` and `ctx.fs` are served *per Session*: they live in the `wsl` agent
preset's isolate realm, so a host workspace keeps the shipped sandboxed
PowerShell environment while a WSL workspace gets the distro, concurrently.

The terminal window cannot be served that way, and the reason is not visible in
the profile YAML. `dsh-api-terminal-controller` resolves its execution world from
the Session's own context — `agent.ctx.get("subprocess")` — and an Agent's
context is created by the agent loop under the **root** realm
(`createScope(loopCtx, …)`, where `loopCtx` is the root-mounted `ctx.agents`),
while a preset's isolate realms are created by `dsh-agent-preset-registry` under
the **registry's** context (`createScope(this.owner, …)`). The two subtrees never
meet, so a `subprocess` provider mounted inside `preset-wsl` is invisible to the
terminal window. The registry ships `agentPresets.serviceFor(agent, name)` for
exactly that gap; the terminal controller does not use it.

So [`cordis.patch.yml`](cordis.patch.yml) replaces the composition-level
`subprocess` row instead, with a subclass whose only override is
`spawnTerminal`: a `wsl.exe` launch is rewritten to
`wsl.exe -d <distro> --cd <linux dir>`, and everything else — every ordinary
`spawn()`, the host ripgrep search, the pwsh executor, the LSP host — reaches the
shipped implementation untouched.

Consequence worth stating plainly: the terminal follows the **composition**, not
the Session. A Session whose workspace is a Windows folder gets the same distro
terminal, started in that folder as `/mnt/<drive>/…`. That is the honest limit of
a per-session execution world that no Session identity reaches; and because
`terminalEnvironment()` and `resolveExecutable()` receive no Session at all, the
controller is configured with the single shell profile that matters
(`shell: { path: wsl.exe }`) rather than having executable lookup rewritten for
every root consumer to make one shell menu prettier.

## Sandboxing: a different mechanism, not the Windows one

On Windows, DSH confines commands with `dsh-sandbox-windows-acl`: a restricted,
low-integrity token plus a write allowlist. **That token cannot reach WSL at
all** — `wsl.exe` fails with `Wsl/E_ACCESSDENIED` and `\\wsl.localhost\<distro>`
reports access denied. Both work normally outside the sandbox. There is no way
to run a distro command under that token, so the WSL execution world cannot
inherit the Windows sandbox.

It gets the Linux one instead. `lib/sandbox.js` builds a **bubblewrap** profile
on the host and hands it to `wsl.exe --exec`, so the confinement is created and
enforced *inside* the distro:

```
wsl.exe -d <distro> --cd <linux dir> --exec bwrap \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp --bind <workspace> <workspace>]  --  <shell> -lc <cmd>
```

That is DSH's own Linux rung, argument for argument (`dsh-sandbox-local`), which
is why the semantics and the diagnostics line up with a Linux host:

| Mode | What the distro command gets |
|---|---|
| `read-only` | the whole distro read-only, `/dev/null` writable — the sink a shell needs |
| `workspace-write` | the above plus the Session workspace bound read-write and an ephemeral `/tmp` |
| `danger-full-access` | no wrap at all; the approved escalation |

`WslFileSystem` fences the same policy on its own mutation path (`writeText`,
`editText`) against the same writable roots, so "the write tool cannot write
/tmp but bash can" asymmetries do not arise. Both providers report the mode
through their `sandboxMode` capability fact, which is what brings back the
Permissions selector and the *denied → request escalation* flow.

**Enforcement is `partial`, and this is the honest part.** A WSL distro process
can execute a *Windows* binary through interop (`/mnt/c/…/*.exe`). That process
is not a Linux process: bubblewrap does not govern it, and it runs under your
ordinary Windows token, able to write anywhere you can. `npm run probe:sandbox`
demonstrates exactly that, and keeps demonstrating it. Closing the hole means
denying execution under `/mnt`, which would also break `/mnt/c/…` Sessions — so
it is stated rather than papered over. Network and process visibility are
outside `SandboxMode`'s vocabulary on every platform.

Two consequences worth knowing:

- **`bubblewrap` is required in the distro** (`sudo apt install bubblewrap`).
  Without it the provider *fails closed*: every confined command reports
  `SANDBOX_UNAVAILABLE` instead of quietly running unconfined. The capability
  fact also disappears with the enforcement — an unusable runner never leaves a
  "confined" claim behind.
- Configure `sandbox: false` on either provider to get the pre-sandbox
  behaviour back: commands run unconfined and `sandboxMode` returns `undefined`,
  so the tool layer tells the model these operations are not confined.

## Requirements

- Windows with WSL2 and at least one distro.
- `bubblewrap` inside the distro, for the sandbox (see above).
- DSH `0.2.0-rc.2`-era packages (`@deepseek-ai/dsh-base`, `dsh-web-app`).
- **No dependencies.** Everything the package needs is a peer, supplied by the
  profile that mounts it.

## Install

The package is a DSH **bundle**: its `package.json` declares
`dsh.bundle.patch`, so `dsh plugin add` installs the code *and* applies
[`cordis.patch.yml`](cordis.patch.yml) as a configuration layer. There is no
patch to merge by hand. Start from the Web template, because the layer
substitutes web-surface rows — the composition-level `subprocess` provider, the
terminal controller, the directory picker:

```powershell
dsh wsl --from-default-profile web --dump-config   # create the profile from the Web template
dsh plugin --profile wsl add dsh-plugin-wsl-env    # npm; or link:C:\path\to\checkout while developing
dsh --profile wsl --dump-config        # compose only, no boot: the fastest check
dsh --profile wsl
```

`cordis.patch.yml` is commented line by line and is the authoritative install
reference, including the generated `preset-wsl` block. Two of its rows are not
additions but substitutions: it **disables** the shipped composition-level
`subprocess` provider and inserts this package's in its place, and it gives
`terminal-controller` the `wsl.exe` shell profile. Both are needed for the
terminal window and neither can live in the preset — see above.

Machine-local preferences do not belong in that file. Layers compose as
bundles, then the profile's own `cordis.patch.yml`, then the home-level one,
then `--patch` overlays, and a later layer wins per row — so override a row by
id in `$DSH_HOME/profiles/<name>/cordis.patch.yml`.
[`examples/profile.cordis.patch.yml`](examples/profile.cordis.patch.yml) is one
such layer, and shows what a row override looks like.

> A running process caches ES modules. **Restart the app after changing `lib/`**,
> or the old code stays loaded.

## Layout

```
lib/paths.js        pure path translation between the three coordinate systems
lib/wsl.js          wsl.exe interop primitives (no DSH imports)
lib/listing.js      pure directory-listing and breadcrumb helpers (no DSH imports)
lib/index.js        WslShellExecutor (ctx.shell) + WslFileSystem (ctx.fs)
lib/sandbox.js      the distro-side bwrap confinement both providers apply
lib/picker.js       WslDirectoryPicker (ctx.directoryPicker)
lib/subprocess.js   WslSubprocessRuntime (ctx.subprocess) — the terminal window
lib/auto-preset.js  per-session environment selection
lib/shell-env.js    DSH_WSL_* environment facts
lib/{shell,fs}.js   one-line subpath entry points
cordis.patch.yml    the bundle patch layer (dsh.bundle), with comments
examples/           a machine-local profile layer, for contrast
test/               unit tests and the behavioural probes
docs/archive/       the designs this one replaced, and why
```

## Testing

```bash
npm test                  # syntax check + unit tests — dependency-free, runs anywhere
npm run probe:sandbox     # the bwrap profile's semantics, measured inside the distro
npm run probe             # filesystem probe against a real distro (Windows + WSL only)
npm run probe:sandbox-shell  # shell probe: drives the confined executor through a real boot
npm run probe:terminal    # terminal probe: opens a PTY through the provider
```

`npm test` covers the pure modules plus a `--check` parse pass over every shipped
module. It cannot import the service modules: they need DSH peers that a bare
checkout does not have. That leaves an evaluation-time gap which only booting the
harness closes — see README.zh.md §15.4 for the five rounds of misdiagnosis that
gap once caused.

`test/probe/sandbox.sh` needs no harness at all: it applies the exact profile
arguments `lib/sandbox.js` builds and asserts what bubblewrap does and does not
govern — including the interop escape, which it records as `INFO` rather than a
failure because a Linux sandbox cannot govern a Windows process.

`test/probe/` drives the seams inside throwaway profiles bound to the distro.
The filesystem probe asserts the whole publication path — create, read, version
guard, edit, overwrite, mode preservation, and the two guard rejections — plus
the fence: a write outside the policy root and a `read-only` write are both
refused with `FS_SANDBOX_DENIED`, and `danger-full-access` is not fenced. The
shell probe boots the same profile with the WSL executor mounted and asserts the
same three modes through `ctx.shell`, including the denial classification the
tool layer renders. The terminal probe boots the Web profile with the provider in
place, asks for the same `spawnTerminal` request the GUI makes, and asserts the
shell it lands in: distro, initial directory, and the `DSH_*` fact forwarded
through `WSLENV`.

Those probes need a Windows-side profile whose `node_modules/dsh-plugin-wsl-env`
points at the checkout; `test/probe/run.sh` documents the one-time setup in its
header, and `terminal.sh` and `sandbox-shell.sh` reuse that same profile.

## Verified

Local, on Windows 11 + WSL2 (Ubuntu 26.04):

- the seam wiring, UNC primitives and picker behaviour, in and out of process;
- the plugin mounted in a real profile, end to end;
- a **real model turn** in a WSL-only headless profile:
  `write → chmod → read → edit → execute`, with the executable bit surviving the
  edit;
- the same `write`/`edit` tools in the daily GUI profile;
- the **terminal provider**, booted in the Web composition:
  `spawnTerminal({ argv: ["wsl.exe"], cwd: <UNC workspace> })` lands in
  `ubuntu` as the distro user's login shell (`/usr/bin/zsh`), in the workspace's
  Linux path, with the request's `DSH_SESSION_ID` forwarded. `npm run
  probe:terminal` re-runs exactly that, and it is what the throwaway Web boot
  showed;
- the same provider **in the daily GUI profile**: pressing *New terminal* starts,
  from the harness process, exactly
  `wsl.exe -d ubuntu --cd /home/andy/Projects/dsh/plugins/dsh-plugin-wsl-env`
  (recorded from the live process table), and the window lands in the distro
  user's zsh.
- the **sandbox**, three ways: the profile arguments measured directly in the
  distro (`npm run probe:sandbox`: a write outside the workspace is refused with
  EROFS, the sandbox's `/tmp` is ephemeral, `/mnt/c` is read-only, and the
  interop escape is recorded); the filesystem fence (`npm run probe`: a write
  outside the policy root and a `read-only` write both refused with
  `FS_SANDBOX_DENIED`, `danger-full-access` not fenced); and the shell path
  (`npm run probe:sandbox-shell`: `sandboxMode` advertised, the same three modes
  through `ctx.shell`, the refusal classified as a denial with
  `enforcement: partial`).

42 unit assertions, 18 filesystem-probe assertions and 10 shell-probe checks
pass; the bwrap probe adds 10 measured expectations plus the recorded escape, and
the terminal probe asserts three more.

## Known limitations

- **The sandbox does not govern WSL interop.** A confined distro command can
  still execute a Windows binary from `/mnt/c`, and that Windows process runs
  outside bubblewrap under your ordinary token. Closing it would mean denying
  execution under `/mnt`, which breaks `/mnt/c/…` Sessions; the provider reports
  `enforcement: partial` for exactly this reason, and `npm run probe:sandbox`
  re-measures it. Network and process visibility are outside the mode vocabulary
  on every platform.
- **`bubblewrap` must be installed in the distro**, and the providers fail
  closed without it (`SANDBOX_UNAVAILABLE` for every confined command). That is
  deliberate: the alternative is a silent run without the boundary the model was
  told it has. `sandbox: false` is the documented opt-out.
- A `workspace-write` profile binds the workspace root read-write, and bubblewrap
  refuses a bind whose source does not exist — so a Session whose workspace
  directory has been deleted fails closed with a runner diagnostic rather than
  being recreated.
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
- The terminal is a **composition** property, not a Session one (see above): a
  Windows-folder Session gets the distro terminal at `/mnt/<drive>/…`, and the
  shell menu is deliberately reduced to the one configured profile.
- The GUI terminal is an interactive shell and is **not** wrapped in the
  sandbox, exactly like the shipped terminal provider: the mode vocabulary
  governs command execution and file mutations, not a human's interactive
  session.
- Terminal activity reporting stops at `wsl.exe`. The shipped provider's shell
  integration runs only for a direct `bash`/`zsh` launch on a POSIX host, so a
  distro terminal reports `unknown` activity and the controller's unattended idle
  reclamation never fires for it — close the tab to release the process.

## Repository notes

The checkout is developed inside the distro, but the harness is a Windows process
and a profile can only link a Windows path (`link:\\wsl.localhost\…` is rewritten
to a broken `/wsl.localhost/…` symlink by pnpm). The Windows copy under
`default-workspace/dsh-plugin-wsl` is therefore a **runtime mirror**; keep the two
in sync with `test/probe/sync-to-windows.sh` before launching the app.

## License

MIT — see [LICENSE](LICENSE).
