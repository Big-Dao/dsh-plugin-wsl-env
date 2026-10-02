# dsh-plugin-wsl-env

**English** · [中文](README.zh.md)

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](LICENSE)

Run a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) session
against a WSL distro: commands execute *inside* the distro, the model's file tools
read and write real distro files, the folder picker can open a distro folder, and
the GUI terminal opens there instead of `cmd.exe`.

**Windows + WSL2 only.** One install command, no dependencies of its own, and the
WSL environment is bound **per session** — a session on a Windows folder keeps the
shipped Windows environment untouched.

[What you get](#what-you-get) · [Install](#install) · [Using it](#using-it) ·
[Configure](#configure) · [Sandbox](#sandbox) · [Troubleshooting](#troubleshooting) ·
[Limitations](#limitations) · [Development](#development) · [Design notes](#design-notes)

## What you get

| Instead of | You get |
|---|---|
| commands running on Windows | commands running **in your distro**, in your login shell, in the session's Linux directory |
| `read`/`write`/`edit`/`glob`/`grep` on Windows paths | the same tools on **real distro files**, through the `\\wsl.localhost\<distro>` share |
| a folder picker that cannot see WSL | one picker listing the Windows home **and every installed distro**, so a session can open `/home/you/project` |
| a terminal on `cmd.exe` in a UNC directory | a terminal **inside the distro**, in the session's folder, as your distro user |
| commands with no boundary | commands confined by **`bubblewrap` inside the distro** — see [Sandbox](#sandbox) |

A session opened on a distro folder gets the WSL environment automatically: the
`wsl` agent preset is bound while the session is created, so the very first tool
call is already correct.

**Wondering if it works?** Ask the model to run `uname -r` — a WSL2 kernel such
as `6.18.40.1-microsoft-standard-WSL2` — or `echo $WSL_DISTRO_NAME`.

## Install

Four commands, from a Windows terminal:

```powershell
dsh wsl --from-default-profile web --dump-config   # 1. create the profile from the Web template
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 2. install the code AND its config layer
dsh --profile wsl --dump-config                    # 3. compose check, no boot (the fast one)
dsh --profile wsl                                  # 4. run
```

Step 3 should show a `# == dsh-plugin-wsl-env` layer and rows patched by it —
in particular `- id: terminal-controller` with `shell: { path: wsl.exe, name: WSL }`.

Then, in the GUI: open a folder under `\\wsl.localhost\<distro>\…` (the picker
lists every distro at its root level), or press **New terminal**.

The package is a DSH **bundle**: it declares `dsh.bundle.patch`, so step 2 applies
[`cordis.patch.yml`](cordis.patch.yml) as a configuration layer. Nothing is merged
by hand. Step 1 starts from the Web template because that layer *substitutes*
web-surface rows — the composition-level `subprocess` provider, the terminal
controller, the directory picker.

Also required: **`bubblewrap` inside the distro** (`sudo apt install bubblewrap`).
Without it every command fails closed — see [Sandbox](#sandbox).

Uninstall with `dsh plugin --profile wsl remove dsh-plugin-wsl-env`.

To upgrade later, install again — the new version replaces the layer with the
bundle's current one: `dsh plugin --profile wsl add dsh-plugin-wsl-env`.

> **Editing `lib/` in a checkout? Restart the app.** A running process caches ES
> modules and keeps the old code otherwise.

## Using it

A session looks like this: open `\\wsl.localhost\ubuntu\home\you\project` as the
workspace, ask *"what kernel am I on, and what does /etc/os-release say?"*, and the
model runs `uname -r` and reads the file **inside the distro** — no `/mnt/c`
detour, no copied files.

- **Open a distro folder.** The picker shows the Windows home plus one entry per
  distro. Pick `\\wsl.localhost\ubuntu\home\you\project`; the session workspace,
  the shell's working directory and the terminal all follow it.
- **Commands** run as `wsl.exe -d <distro> --cd <linux dir> --exec <your login
  shell> -lc <cmd>`, so your `PATH`, `nvm`, `cargo`, `pyenv` and rc files are in
  effect — not a hardcoded `bash`.
- **Files are real distro files.** `/home/you/x` and
  `\\wsl.localhost\ubuntu\home\you\x` name the same file, and `/mnt/c/…` reaches
  the Windows disk.
- **The terminal** (right sidebar → *New terminal*) opens a shell inside the
  distro, in the session's folder.
- **The model is told what its shell is**: `DSH_WSL_DISTRO`, `DSH_WSL_SHELL` and
  `DSH_WSL_HOME` are contributed to the managed `DSH_*` namespace, which the shell
  tool points the model at.
- **Permissions behave as on a Linux host.** The Permissions selector switches
  between `read-only`, `workspace-write` (default) and `danger-full-access`; a
  denied command or write comes back with an escalation hint, and an approved
  escalation runs that one call unconfined.

## Configure

Override a row by id in your own profile layer,
`$DSH_HOME/profiles/<name>/cordis.patch.yml`
([`examples/profile.cordis.patch.yml`](examples/profile.cordis.patch.yml) is one).
Values marked *(shipped)* are what [`cordis.patch.yml`](cordis.patch.yml) sets;
the rest are the schema defaults, listed because they are the ones worth knowing.

| Row | Key | Default | Meaning |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` *(shipped)* | distro name; empty uses WSL's default |
| | `shell` | `''` | pin a shell inside the distro; empty resolves the user's login shell |
| | `loginShell` | `true` *(shipped)* | `<shell> -lc` (sources your profile) instead of a bare `-c` |
| | `sandbox` | `true` | confine commands with `bubblewrap`; `false` opts out |
| | `cwd` | `''` | default workdir; empty means the distro user's home |
| | `timeoutMs` / `maxTimeoutMs` | `120000` / `600000` *(shipped)* | per-call deadline and the ceiling a call may ask for |
| `wsl-fs` | `distro` | `''` *(shipped)* | as above |
| | `restrictToDistro` | `true` *(shipped)* | refuse paths outside the pinned distro (including `/mnt/c`) |
| | `sandbox` | `true` | fence `writeText`/`editText` by the policy |
| | `resolveSymlinks` | `true` | follow Linux symlinks the share cannot traverse (`/etc/os-release`, `/bin`) |
| | `cwd` | `''` | base for relative paths; empty means the distro user's home |
| `directory-picker-wsl` | `preferredDistro` | `''` *(shipped)* | distro listed first in the picker |
| | `includeHostHome` | `true` *(shipped)* | also list the Windows home directory |
| | `maxEntries` | `1000` *(shipped)* | cap per directory listing |
| `subprocess-wsl` | `distro` | `''` *(shipped)* | what the GUI terminal opens |
| | `shell` | `''` | pin a shell; empty leaves the choice to `wsl.exe` |
| | `loginShell` | `true` | login semantics for a pinned shell |

Every other schema key can be overridden the same way and keeps its own default:
`wslPath`, `hostCwd` and `forwardEnv` on the shell and terminal rows,
`diffBasisMaxBytes` on `wsl-fs`, `distroCacheMs` on the picker.

## Sandbox

**Short version:** commands are confined by `bubblewrap` *inside* the distro, the
file tools are fenced by the same policy, and enforcement is reported as `partial`
because a distro process can still reach Windows through WSL interop. `bubblewrap`
must be installed, and the failure mode is closed, not silent.

On Windows, DSH confines commands with `dsh-sandbox-windows-acl`: a restricted,
low-integrity token plus a write allowlist. **That token cannot reach WSL at all**
— `wsl.exe` fails with `Wsl/E_ACCESSDENIED` and `\\wsl.localhost\<distro>` reports
access denied, while both work normally outside the sandbox. So the WSL execution
world cannot inherit the Windows sandbox; it gets the Linux one instead. The
plugin builds a **bubblewrap** profile on the host and hands it to `wsl.exe --exec`,
so confinement is created and enforced *inside* the distro:

```text
wsl.exe -d <distro> --cd <linux dir> --exec bwrap \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp --bind <workspace> <workspace>]  --  <shell> -lc <cmd>
```

That is DSH's own Linux rung, argument for argument (`dsh-sandbox-local`), which is
why the semantics and the diagnostics line up with a Linux host:

| Mode | What the distro command gets |
|---|---|
| `read-only` | the whole distro read-only, `/dev/null` writable — the sink a shell needs |
| `workspace-write` | the above plus the session workspace bound read-write and an ephemeral `/tmp` |
| `danger-full-access` | no wrap at all; the approved escalation |

`WslFileSystem` fences the same policy on its own mutation path against the same
writable roots, so "bash can write `/tmp` but the write tool cannot" asymmetries do
not arise. Both providers report the mode through their `sandboxMode` capability
fact, which is what brings back the Permissions selector and the
denied → escalate flow.

**Enforcement is `partial`, not `full`, and that is the honest part.** A distro
process can still execute a *Windows* binary through interop
(`/mnt/c/…/*.exe`). That process is not a Linux process: bubblewrap does not govern
it, and it runs under your ordinary Windows token, able to write anywhere you can.
`npm run probe:sandbox` demonstrates it and keeps demonstrating it. Closing the
hole would mean denying execution under `/mnt`, which would also break `/mnt/c/…`
sessions — so it is stated rather than papered over. Network and process
visibility are outside the mode vocabulary on every platform.

**`bubblewrap` is required and the failure is closed.** Without it, every confined
command reports `SANDBOX_UNAVAILABLE` instead of quietly running unconfined, and
the capability fact disappears with the enforcement — an unusable runner never
leaves a "confined" claim behind. Set `sandbox: false` on either provider to opt
out: commands then run unconfined and `sandboxMode` returns `undefined`, so the
tool layer tells the model these operations are not confined.

The **GUI terminal is not wrapped** in the sandbox — it is a human's interactive
shell, exactly like the shipped terminal provider.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| every command fails with `SANDBOX_UNAVAILABLE` | no `bubblewrap` in the distro | `sudo apt install bubblewrap`, or set `sandbox: false` on both providers |
| a command or write is refused outside the session folder | `workspace-write`, working as designed | accept the proposed escalation, or open a session on the folder you need |
| writes are refused even inside the workspace | the session is in `read-only` | switch the Permissions selector |
| `dsh plugin add` warns that no layer was activated | the dependency was already installed, so `add` had nothing to record | `dsh plugin --profile wsl remove dsh-plugin-wsl-env`, then add again |
| the terminal opens `cmd.exe` | the layer's `terminal-controller` row did not apply | `dsh --profile wsl --dump-config` should show `shell: { path: wsl.exe, name: WSL }` |
| edits to `lib/` have no effect | ES module cache | restart the app |
| a `link:\\wsl.localhost\…` install leaves a broken symlink | pnpm cannot link a UNC path | link a Windows path instead; developing inside the distro needs the runtime mirror (see [Development](#development)) |
| `glob`/`grep` are slow | the host ripgrep walks the 9p share | expected — narrow the path, or use `bash` with in-distro tools |
| the terminal reports `unknown` activity | shell integration runs only for a direct `bash`/`zsh` on a POSIX host | close the tab to release the process; idle reclamation will not fire |

## Limitations

- **The sandbox does not govern WSL interop** (see [Sandbox](#sandbox)): a
  confined command can still run a Windows binary, which escapes the Linux
  boundary. Reported as `enforcement: partial`.
- **`bubblewrap` must be installed**, and the providers fail closed without it.
- A `workspace-write` profile binds the workspace root read-write, and bubblewrap
  refuses a bind whose source does not exist — a session whose workspace directory
  was deleted fails with a runner diagnostic rather than being recreated.
- Freshly created files get the distro umask default (0644); a host-side `chmod`
  over the share is silently ignored. Overwrites and edits *do* preserve the mode.
  Use `chmod +x` from inside the distro when you need it.
- Mutation guards are check-then-act, not atomic: this backend checks the caller's
  guard itself because the host backend publishes guarded creations with a hard
  link the share rejects. It is the race `dsh-fs-sandbox` already documents.
- `watch()` is refused outright rather than armed unreliably over 9p.
- `glob`/`grep` run the host ripgrep over the share: correct, but not fast, and
  `.gitignore` semantics are the host's. `editText` rewrites the whole file in
  memory.
- The terminal is a **composition** property, not a session one: a session on a
  Windows folder still gets the distro terminal, started at `/mnt/<drive>/…`, and
  its shell menu is deliberately reduced to that one profile.
- Terminal activity reporting stops at `wsl.exe`, so the controller's idle
  reclamation never fires for these terminals.

## Development

```bash
npm test                     # syntax check + unit tests — dependency-free, runs anywhere
npm run probe:sandbox        # what bubblewrap governs, measured inside the distro
npm run probe                # filesystem probe against a real distro (Windows + WSL only)
npm run probe:sandbox-shell  # drives the confined executor through a real harness boot
npm run probe:terminal       # opens a PTY through the terminal provider
```

Layout:

```text
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

`npm test` covers the pure modules plus a `--check` parse pass over every shipped
module. It cannot import the service modules — they need DSH peers a bare checkout
does not have — so only booting the harness closes that evaluation gap; the
archived record's §15.4 documents the five rounds of misdiagnosis it once caused.

`test/probe/sandbox.sh` needs no harness: it applies the exact profile arguments
`lib/sandbox.js` builds and asserts what bubblewrap does and does not govern,
recording the interop escape as `INFO` because a Linux sandbox cannot govern a
Windows process. The other probes boot throwaway profiles bound to the distro: the
filesystem probe asserts the publication path plus the fence (outside the policy
root and under `read-only` both refused with `FS_SANDBOX_DENIED`,
`danger-full-access` not fenced), the shell probe drives all three modes through
`ctx.shell` and checks the denial classification the tool layer renders, and the
terminal probe asserts the distro, the initial directory and the `DSH_*` fact
forwarded through `WSLENV`. `test/probe/run.sh` documents the one-time profile
setup in its header; `terminal.sh` and `sandbox-shell.sh` reuse it.

**What is verified** (Windows 11 + WSL2, Ubuntu 26.04): the seam wiring, UNC
primitives and picker behaviour; the plugin mounted end to end in a real profile;
a real model turn in a WSL-only headless profile (`write → chmod → read → edit →
execute`, executable bit surviving the edit); the terminal provider in both the
throwaway Web boot and the daily GUI profile; and the sandbox four ways — the
profile arguments measured in the distro, the filesystem fence, the shell path
(`enforcement: partial`, denial classified), and the daily GUI profile, where an
agent command writing outside the session workspace is refused inside the distro
and the escalation that follows succeeds. 42 unit assertions, 18 filesystem-probe
assertions, 10 shell-probe checks, 10 sandbox expectations plus the recorded
escape, and 3 terminal assertions.

**The runtime mirror.** The checkout lives inside the distro, but the harness is a
Windows process and a profile can only link a Windows path (`link:\\wsl.localhost\…`
becomes a broken `/wsl.localhost/…` symlink under pnpm). The Windows copy under
`default-workspace/dsh-plugin-wsl` is therefore a runtime mirror; keep it in sync
with `test/probe/sync-to-windows.sh` before launching the app. That destination
lies outside every session workspace, so an agent running the sync through a
confined shell is refused by `workspace-write` and has to approve
`danger-full-access` for that one command — the sandbox working as designed, not a
broken script. Run it from a plain distro terminal when the prompt is unwelcome.

**CI** runs `npm test` on Linux for Node 20, 22 and 24.

## Design notes

Two decisions are not visible in the profile YAML; the full reasoning, the
measurements and every discarded design are in the archived engineering record —
[docs/archive/engineering-record.zh.md](docs/archive/engineering-record.zh.md)
(Chinese). It is history, not a second README: where it and this file disagree,
this file is the current state.

**Why the terminal provider sits at the composition level.** `ctx.shell` and
`ctx.fs` are served per session, from the `wsl` agent preset's isolate realm, so a
host workspace keeps the shipped sandboxed PowerShell environment while a WSL
workspace gets the distro — concurrently, in one process. The terminal cannot be
served that way: `dsh-api-terminal-controller` resolves its world with
`agent.ctx.get("subprocess")`, and an Agent's context is created by the agent loop
under the **root** realm, while a preset's isolate realms are created by
`dsh-agent-preset-registry` under the **registry's** context. The two subtrees never
meet, so a `subprocess` provider mounted inside `preset-wsl` is invisible to the
terminal window. [`cordis.patch.yml`](cordis.patch.yml) therefore replaces the
composition-level `subprocess` row with a subclass whose only override is
`spawnTerminal`; every ordinary `spawn()`, the host ripgrep search, the pwsh
executor and the LSP host reach the shipped implementation untouched. The cost is
that the terminal follows the composition, not the session (see
[Limitations](#limitations)).

**Why the sandbox is Linux-side.** The Windows ACL runner's restricted token
cannot reach WSL at all, so the confinement has to be built on the host and
executed inside the distro. `lib/sandbox.js` therefore mirrors
`dsh-sandbox-local`'s Linux `bwrap` rung instead of consuming `ctx.sandbox` — which
`dsh-tool-bash` never asks for anyway: it reads the executor's `sandboxMode` fact
and `ctx.sandboxPolicy`, both of which this plugin supplies.

## License

MIT — see [LICENSE](LICENSE).
