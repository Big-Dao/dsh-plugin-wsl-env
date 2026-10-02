# dsh-plugin-wsl-env

**English** · [中文](docs/README.zh.md)

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](LICENSE)

This plugin lets [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) use a WSL distro as its working environment. Commands run inside the distro. The model's file tools read and write real distro files. The folder picker can open a distro folder directly, and the GUI terminal also opens inside the distro instead of `cmd.exe` on a UNC path.

**Windows + WSL2 only.** Installation is one command, and the plugin has no dependencies of its own. The WSL environment applies per session, so a session opened on a Windows folder keeps its normal Windows environment.

[What you get](#what-you-get) · [Install](#install) · [Using it](#using-it) ·
[Configure](#configure) · [Sandbox](#sandbox) · [Troubleshooting](#troubleshooting) ·
[Limitations](#limitations) · [Development](#development) · [Design notes](#design-notes)

## What you get

| Before | After |
|---|---|
| Commands run on Windows | Commands run **inside your distro**, using your login shell, starting in the session's Linux directory |
| `read`/`write`/`edit`/`glob`/`grep` work on Windows paths | These tools work on **the distro's real files**, through the `\\wsl.localhost\<distro>` share |
| The folder picker cannot see WSL | One picker lists the Windows home directory and every installed distro, so you can open `/home/you/project` |
| The terminal opens `cmd.exe` in a UNC directory | The terminal opens **inside the distro**, in the session's directory, as your distro user |
| Commands have no sandbox | Commands are confined by **bubblewrap inside the distro**; see [Sandbox](#sandbox) |

If you open a session on a folder inside a distro, the WSL environment applies automatically. The `wsl` preset is bound while the session is created, so the first tool call already runs in the distro. You do not switch anything by hand.

**How to check that it works.** Ask the model to run `uname -r`. The output should be a WSL2 kernel such as `6.18.40.1-microsoft-standard-WSL2`. You can also run `echo $WSL_DISTRO_NAME`.

## Install

Run these four commands in a Windows terminal:

```powershell
dsh wsl --from-default-profile web --dump-config   # 1. create the profile from the Web template
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 2. install the code and its configuration layer
dsh --profile wsl --dump-config                    # 3. compose only, no boot (the fast check)
dsh --profile wsl                                  # 4. run
```

Step 3 should print a layer named `# == dsh-plugin-wsl-env`, plus the rows that layer changes. The most important row is `- id: terminal-controller`, which should now carry `shell: { path: wsl.exe, name: WSL }`.

Then open a folder under `\\wsl.localhost\<distro>\...` in the GUI. The picker lists every installed distro at its root level. You can also just press **New terminal**.

The package is a DSH **bundle**. It declares `dsh.bundle.patch`, so step 2 applies [`cordis.patch.yml`](cordis.patch.yml) as a configuration layer. You do not merge any patch by hand. Step 1 uses the Web template because this layer overrides rows that only the Web surface has: the app-wide `subprocess` provider, the terminal controller and the directory picker.

You also need **bubblewrap inside the distro** (`sudo apt install bubblewrap`). Without it every command fails immediately. See [Sandbox](#sandbox).

Uninstall: `dsh plugin --profile wsl remove dsh-plugin-wsl-env`.

Upgrade: run `dsh plugin --profile wsl add dsh-plugin-wsl-env` again. The new version replaces the old configuration layer with its own.

> **If you change `lib/` in a checkout, restart the app.** A running process caches ES modules and keeps using the old code until you do.

## Using it

A typical session: open `\\wsl.localhost\ubuntu\home\you\project` as the workspace, then ask "what kernel am I on, and what is in `/etc/os-release`?". The model runs `uname -r` and reads that file inside the distro. Nothing goes through `/mnt/c`, and no files are copied.

- **Open a distro folder.** The picker lists the Windows home directory and one entry per distro. If you pick `\\wsl.localhost\ubuntu\home\you\project`, the session workspace, the shell's working directory and the terminal all follow it.
- **Commands** run as `wsl.exe -d <distro> --cd <linux dir> --exec <your login shell> -lc <command>`. Your `PATH`, `nvm`, `cargo`, `pyenv` and rc files therefore apply. The shell is not hardcoded to bash.
- **Files are the distro's real files.** `/home/you/x` and `\\wsl.localhost\ubuntu\home\you\x` are the same file, and `/mnt/c/...` reaches the Windows disk.
- **The terminal** (right sidebar, then *New terminal*) opens a shell inside the distro, in the session's folder.
- **The model can see its shell environment.** The plugin registers `DSH_WSL_DISTRO`, `DSH_WSL_SHELL` and `DSH_WSL_HOME` in the managed `DSH_*` namespace, and the shell tool points the model at them.
- **Permissions work as they do on a Linux host.** The Permissions selector switches between `read-only`, `workspace-write` (the default) and `danger-full-access`. When a command or a write is refused, the tool offers to run it with wider permissions. If you approve, that single call runs without the sandbox.

## Configure

To change a value, override that row by id in your own profile layer. The file is `$DSH_HOME/profiles/<name>/cordis.patch.yml`; see [`examples/profile.cordis.patch.yml`](examples/profile.cordis.patch.yml). In the table below, *(shipped)* marks the values set by [`cordis.patch.yml`](cordis.patch.yml). The others are schema defaults, listed because they are worth knowing.

| Row | Key | Default | Meaning |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` *(shipped)* | distro name; empty means WSL's default distro |
| | `shell` | `''` | pin a shell inside the distro; empty means the user's login shell |
| | `loginShell` | `true` *(shipped)* | use `<shell> -lc`, which sources your profile, instead of a bare `-c` |
| | `sandbox` | `true` | confine commands with `bubblewrap`; `false` disables the sandbox |
| | `cwd` | `''` | default working directory; empty means the distro user's home |
| | `timeoutMs` / `maxTimeoutMs` | `120000` / `600000` *(shipped)* | per-call time limit, and the ceiling a call may ask for |
| `wsl-fs` | `distro` | `''` *(shipped)* | as above |
| | `restrictToDistro` | `true` *(shipped)* | refuse paths outside the pinned distro, including `/mnt/c` |
| | `sandbox` | `true` | check `writeText` and `editText` against the policy |
| | `resolveSymlinks` | `true` | follow Linux symlinks that the share cannot traverse, such as `/etc/os-release` and `/bin` |
| | `cwd` | `''` | base directory for relative paths; empty means the distro user's home |
| `directory-picker-wsl` | `preferredDistro` | `''` *(shipped)* | the distro listed first in the picker |
| | `includeHostHome` | `true` *(shipped)* | also list the Windows home directory |
| | `maxEntries` | `1000` *(shipped)* | maximum entries listed per directory |
| `subprocess-wsl` | `distro` | `''` *(shipped)* | which distro the GUI terminal opens in |
| | `shell` | `''` | pin a shell; empty lets `wsl.exe` decide |
| | `loginShell` | `true` | whether a pinned shell uses login semantics |

You can override the other keys in the same way; they keep their defaults. Those are `wslPath`, `hostCwd` and `forwardEnv` on the shell and terminal rows, `diffBasisMaxBytes` on `wsl-fs`, and `distroCacheMs` on the picker.

## Sandbox

**In short:** commands are confined by `bubblewrap` inside the distro, and writes are checked against the same policy. The reported enforcement level is `partial`, not `full`, because a process inside the distro can still reach Windows through WSL interop. `bubblewrap` must be installed; without it the plugin refuses to run rather than run unconfined.

On Windows, DSH confines commands with `dsh-sandbox-windows-acl`. It uses a restricted, low-integrity Windows token and an allowlist of writable paths. **That token cannot reach WSL.** `wsl.exe` fails with `Wsl/E_ACCESSDENIED`, and `\\wsl.localhost\<distro>` reports access denied, while both work normally outside the sandbox. The WSL environment therefore cannot reuse the Windows sandbox and uses a Linux sandbox instead. The plugin builds the `bubblewrap` arguments on the Windows side and passes them to `wsl.exe --exec`, which runs them inside the distro:

```text
wsl.exe -d <distro> --cd <linux dir> --exec bwrap \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp --bind <workspace> <workspace>]  --  <shell> -lc <cmd>
```

These are the same arguments DSH uses on a Linux host (`dsh-sandbox-local`), so the behaviour and the error messages match.

| Mode | What a command inside the distro can do |
|---|---|
| `read-only` | read the whole distro; only `/dev/null` is writable, which a shell needs |
| `workspace-write` | the above, plus the session workspace is writable and `/tmp` is a temporary mount |
| `danger-full-access` | no sandbox at all, used for an approved wider-permission request |

`WslFileSystem` checks writes against the same policy and the same writable list. That avoids a mismatch where `bash` could write `/tmp` but the write tool could not. Both providers report their current mode through `sandboxMode`, which is what brings back the Permissions selector and the "refused, then request wider permissions" flow.

**Why the level is `partial`, not `full`.** A process inside the distro can run a Windows program through interop, for example `/mnt/c/.../*.exe`. That is not a Linux process, so bubblewrap does not govern it. It runs with your normal Windows token and can write anywhere you can. `npm run probe:sandbox` demonstrates this, and every run of that probe checks it again. Closing the hole would mean denying execution of programs under `/mnt`. That would also break sessions whose workspace is `/mnt/c/...`, so the hole stays open and is documented here. Network and process visibility are outside the scope of this mode on every platform.

**`bubblewrap` is required, and the failure is closed.** Without it, every confined command reports `SANDBOX_UNAVAILABLE`. The plugin does not fall back to running without a sandbox, and the `sandboxMode` value disappears too, so it never claims to confine when it cannot. If you do not want a sandbox, set `sandbox: false` on either provider. Commands then run unconfined, `sandboxMode` returns `undefined`, and the tool layer tells the model that these operations have no sandbox.

**The GUI terminal is not sandboxed.** It is an interactive shell for a person, which matches the shipped terminal provider.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| every command reports `SANDBOX_UNAVAILABLE` | `bubblewrap` is not installed in the distro | run `sudo apt install bubblewrap`, or set `sandbox: false` on both providers |
| a command or write is refused outside the session folder | expected behaviour of `workspace-write` | accept the wider-permission offer, or open a session on the folder you need |
| writes are refused even inside the workspace | the session is in `read-only` mode | switch the Permissions selector |
| `dsh plugin add` warns that no layer was activated | the dependency was already installed, so `add` had nothing to record | run `dsh plugin --profile wsl remove dsh-plugin-wsl-env`, then add it again |
| the terminal still opens `cmd.exe` | the `terminal-controller` row from the layer did not apply | check that `dsh --profile wsl --dump-config` shows `shell: { path: wsl.exe, name: WSL }` |
| changes to `lib/` have no effect | ES module cache | restart the app |
| `link:\\wsl.localhost\...` leaves a broken symlink | pnpm cannot link a UNC path | link a Windows path instead; developing inside the distro needs the runtime mirror, see [Development](#development) |
| `glob` and `grep` are slow | the Windows-side ripgrep walks the 9p share | expected; narrow the path, or use `bash` to call tools inside the distro |
| the terminal reports `unknown` activity | shell integration only covers `bash`/`zsh` started directly on a POSIX host | close the tab to release the process; idle reclamation does not run for these terminals |

## Limitations

- **The sandbox does not govern WSL interop.** A confined command can still run a Windows program, which escapes the Linux-side boundary. The plugin reports this as `enforcement: partial`. See [Sandbox](#sandbox).
- **`bubblewrap` must be installed**, or both providers fail immediately.
- `workspace-write` binds the workspace root as writable, and bubblewrap refuses a bind whose source directory does not exist. If a session's workspace directory is deleted, commands fail with a runner error; the plugin does not recreate the directory.
- New files get the distro's umask default (0644). A `chmod` from the Windows side on a share path is silently ignored; overwrites and edits keep the original permission bits. Run `chmod +x` inside the distro when you need an executable.
- The check before a write is "check, then write", which is not atomic. This backend checks the caller's guard itself, because the Windows backend publishes a guarded new file with a hard link, and the share does not support hard links. This is the race that `dsh-fs-sandbox` already documents.
- `watch()` (file change monitoring) is not provided. Watching a 9p share is unreliable, so the plugin refuses instead of arming it.
- `glob` and `grep` use the Windows-side ripgrep over the share: correct results, but not fast, and `.gitignore` is interpreted with Windows rules. `editText` reads the whole file into memory before writing it back.
- The terminal belongs to the whole app, not to one session. A session opened on a Windows folder still gets the distro terminal, starting in `/mnt/<drive>/...`, and its shell menu is deliberately reduced to the one configured profile.
- Terminal activity reporting stops at `wsl.exe`, so the controller never reclaims these terminals when they are idle.

## Development

```bash
npm test                     # syntax check and unit tests; no dependencies, runs anywhere
npm run probe:sandbox        # measure inside the distro what bubblewrap does and does not confine
npm run probe                # filesystem probe against a real distro (Windows + WSL only)
npm run probe:sandbox-shell  # boot a real harness and drive the confined executor
npm run probe:terminal       # open a PTY through the terminal provider
```

Layout:

```text
lib/paths.js        pure conversion between the three path formats
lib/wsl.js          wsl.exe interop primitives (no DSH imports)
lib/listing.js      pure directory listing and breadcrumb helpers (no DSH imports)
lib/index.js        WslShellExecutor (ctx.shell) and WslFileSystem (ctx.fs)
lib/sandbox.js      the distro-side bwrap confinement shared by both providers
lib/picker.js       WslDirectoryPicker (ctx.directoryPicker)
lib/subprocess.js   WslSubprocessRuntime (ctx.subprocess), the terminal window
lib/auto-preset.js  per-session environment selection
lib/shell-env.js    registers the DSH_WSL_* environment variables
lib/{shell,fs}.js   one-line subpath entry points
cordis.patch.yml    the bundle configuration layer (dsh.bundle), commented
examples/           one machine-local profile layer, for comparison
test/               unit tests and behaviour probes
docs/archive/       the designs this one replaced, and why
```

`npm test` covers the pure modules and runs a `--check` syntax pass over every shipped module. It cannot import the service modules, because those need DSH peer packages that a bare checkout does not have. Only booting the harness closes that gap; the archived record's §15.4 documents the five rounds of misdiagnosis it once caused.

`test/probe/sandbox.sh` needs no harness. It uses the same arguments that `lib/sandbox.js` builds, and asserts what bubblewrap does and does not confine. It records the interop escape as `INFO`, because a Linux sandbox cannot govern a Windows process.

The other probes boot a throwaway profile bound to the distro:

- The filesystem probe asserts the write path and the write checks. A write outside the policy root, and a write in `read-only` mode, both return `FS_SANDBOX_DENIED`; `danger-full-access` is not checked.
- The shell probe drives all three modes through `ctx.shell` and checks the refusal classification that the tool layer returns.
- The terminal probe asserts the distro, the starting directory, and the `DSH_*` variables forwarded through `WSLENV`.

The setup steps for the throwaway profile are in the header of `test/probe/run.sh`; `terminal.sh` and `sandbox-shell.sh` reuse it.

**What has been verified** on Windows 11 + WSL2 (Ubuntu 26.04):

- the wiring of each service, the UNC path handling and the picker behaviour;
- the plugin mounted end to end in a real profile;
- one real model turn in a WSL-only headless profile: `write → chmod → read → edit → execute`, with the executable bit surviving the edit;
- the terminal provider in a throwaway Web boot and in the daily GUI profile;
- the sandbox in four ways: the arguments measured inside the distro, the filesystem write checks, the shell path (`enforcement: partial`, with refusals classified correctly), and the daily GUI profile, where a write from the agent's own session outside the session workspace is refused inside the distro and the following wider-permission request succeeds.

Counts: 42 unit assertions, 18 filesystem-probe assertions, 10 shell-probe checks, 10 sandbox expectations plus the recorded escape, and 3 terminal assertions.

**The runtime mirror.** The checkout is developed inside the distro, but the harness is a Windows process, and a profile can only link a Windows path: pnpm rewrites `link:\\wsl.localhost\...` into a broken `/wsl.localhost/...` symlink. The Windows copy at `default-workspace/dsh-plugin-wsl` is therefore a runtime mirror. Sync it with `test/probe/sync-to-windows.sh` before launching the app. That destination is outside every session workspace, so an agent running the sync in a confined shell is refused by `workspace-write` and must approve `danger-full-access` for that one command. That is the sandbox behaving as designed, not a broken script; run the sync from a normal distro terminal if you prefer not to see the prompt.

**CI** runs `npm test` on Linux with Node 20, 22 and 24.

## Design notes

Two decisions are not visible in the profile YAML. The full reasoning, the measurements and every rejected design are in the archived engineering record: [docs/archive/engineering-record.zh.md](docs/archive/engineering-record.zh.md). It is a historical document, not a second README; if it disagrees with this file, this file is correct.

**Why the terminal provider is app-wide.** `ctx.shell` and `ctx.fs` are provided per session, inside the isolated scope of the `wsl` agent preset. A workspace on Windows therefore keeps the shipped sandboxed PowerShell environment, while a WSL workspace gets the distro. Both can exist in one process at the same time.

The terminal cannot be provided that way. `dsh-api-terminal-controller` looks up its environment with `agent.ctx.get("subprocess")`. An Agent's context is created by the agent loop under the **root** scope, while a preset's isolated scope is created by `dsh-agent-preset-registry` under the registry's own context. These two scope chains never meet, so a `subprocess` provider mounted inside `preset-wsl` is invisible to the terminal window.

For that reason, [`cordis.patch.yml`](cordis.patch.yml) replaces the **app-wide** `subprocess` row with a subclass that overrides only `spawnTerminal`. Ordinary `spawn()`, the Windows-side ripgrep search, the pwsh executor and the LSP host still use the shipped implementation. The cost is that the terminal follows the app configuration rather than the session; see [Limitations](#limitations).

**Why the sandbox is on the Linux side.** The Windows ACL runner's restricted token cannot reach WSL at all, so the confinement has to be built on the Windows side and run inside the distro. `lib/sandbox.js` copies the Linux `bwrap` approach from `dsh-sandbox-local` instead of using `ctx.sandbox`. `dsh-tool-bash` never asks for `ctx.sandbox` anyway: it reads the executor's `sandboxMode` and `ctx.sandboxPolicy`, and this plugin supplies both.

## License

MIT. See [LICENSE](LICENSE).
