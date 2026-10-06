# Upstream proposal: a terminal tab title that follows the session's shell

Status: proposed upstream as
[deepseek-ai/deepseek-harness#8769](https://github.com/deepseek-ai/deepseek-harness/discussions/8769)
(targeting `packages/api/terminal-controller`, version line `0.2.0-rc.x`). The
plugin worked around the execution half of this gap — a Windows-folder
session's terminal runs a host shell (`subprocess-wsl.hostSessions`) — and
could not work around the title half. This is the record: the GUI titles every
tab from the composition's single shell profile, so a per-session shell choice
is invisible in the title.

## The gap

The display title is fixed from the resolved shell profile and never revisited.
The private `TerminalController.spawn` builds `info`, with `title: shell.name`,
only after `await subprocess.spawnTerminal(...)` has returned, and it does not
read back what that call started:

```ts
const handle = await subprocess.spawnTerminal({
  argv: [shell.path, ...shell.args], cwd: environment.cwd, cols: request.cols, ...
})
const info: WebTerminalInfo = {
  id: request.id, shell, title: shell.name, cwd: environment.cwd, ...
}
```

`shell` is `resolveShell(subprocess, this.config.shell, signal)` — the
composition's configured profile (`shell.name: WSL` in this plugin's layer),
kept verbatim; `resolveExecutable` swaps only the `path`. Two properties of the
seam make the title unable to follow a per-session shell:

- `SubprocessTerminalSpawnSpec` carries no display-name field, so a provider
  that rewrites the launch (this plugin routes a Windows-folder session's
  `wsl.exe` launch to `powershell.exe` — `subprocess-wsl.hostSessions`) cannot
  say what it actually started.
- The controller never reads the effective program back from the
  `SubprocessTerminalHandle`, so the rewrite is invisible to `info.title`.

The result on this plugin's default configuration: a terminal that runs
PowerShell under a tab that reads `WSL`.

## Why a plugin cannot bridge it

Three escape hatches were evaluated against `0.2.0-rc.2` and each is closed:

1. **Replace the controller row's module with a subclass** that corrects the
   title after `super.spawn` (the class exports itself; `BrowserTerminal.rename`
   is public and lands before `create()` publishes the terminal). Closed by the
   patch-layer contract: *"A truthy name asserts the existing plugin name
   rather than renaming it"* (`packages/boot/app-boot/src/config-schema/document.ts`)
   — an id-targeted patch can replace `config`, but not the module.
2. **Disable the shipped row and insert the subclass under a new id.** Closed
   by the web composition: the row id is load-bearing. The web-app bundle
   inserts `terminal-controller`, and the client model that the
   `dsh-client-ui-sidebar-terminal` entry waits for mounts with
   `inject = ['remote', 'remote.terminal']` — the `terminal` namespace the host
   controller registers in its constructor. Disabling the row fails web boot
   with this two-line error:

   ```text
   web boot: 1 entry did not activate
   @deepseek-ai/dsh-client-ui-sidebar-terminal: pending (waiting for service: webTerminals)
   ```

   Verified live against `dsh-desktop 0.2.0-rc.2` (Electron 44.0.0).
3. **Per-session config.** The `shell` profile is composition state; `!!js`
   expressions evaluate once at config resolution and reach no Session
   identity.

## The proposal

Any one of these closes the gap; the first is the smallest and keeps the
profile name as the fallback:

- `SubprocessTerminalSpawnSpec` gains an optional `displayTitle` (or the handle
  exposes the launched `argv`), and `spawn()` uses it for `info.title` when
  present — falling back to `shell.name`. A provider that rewrites a launch
  states the program it started; every other launch keeps the profile name.
- Alternatively, the controller derives the title from the effective program
  itself: title `executableName(effectiveArgv[0])` when it differs from
  `shell.path`, else `shell.name`.

With either, this plugin deletes the limitation paragraph in
[LIMITATIONS.md](LIMITATIONS.md) and the `WSL`-over-PowerShell title, for any
provider that rewrites launches — not just WSL. The same limitation is stated
as current fact in four places. Three go stale the day the proposal lands; the
fourth is already out of step and needs the corrections above whenever it is
next touched:

- the GUI-terminal comment block in [`cordis.patch.yml`](../cordis.patch.yml);
- the closing paragraph of "Why the terminal provider is app-level" in
  [ARCHITECTURE.md](ARCHITECTURE.md);
- R4's `残差` (residual) column in [REQUIREMENTS.zh.md](REQUIREMENTS.zh.md);
- the `WSL` tab-title bullet under "Terminals" in
  [LIMITATIONS.md](LIMITATIONS.md) — the paragraph named just above. It says
  the controller titles a tab *before* the provider rewrites the launch, the
  reverse of the ordering corrected at the top of this file, and it carries the
  one-line `shellCandidates` workaround that drops the row's `shell` block.

## Workarounds until then

- Double-click a tab's title to rename it (a shipped client feature; the
  controller's `rename` Remote API accepts 1–120 characters).
- Re-declare the `terminal-controller` row in a user layer with a non-empty
  `shellCandidates`: a manually selected shell is titled after itself. A patch
  config replaces the whole config rather than deep-merging it
  (`packages/boot/app-boot/src/config-schema/document.ts`), so the override has
  to carry this plugin's `shell` block verbatim — `path: wsl.exe`, `name: WSL`,
  `args: []` — or the terminal stops being a distro terminal. Expect the menu
  to grow the host shells discovery finds on the root provider, which receives
  no directory: executables this terminal never starts (the second bullet of
  the GUI-terminal comment in [`cordis.patch.yml`](../cordis.patch.yml)).
  [LIMITATIONS.md](LIMITATIONS.md) still carries the older one-line form of
  this tip, which drops the `shell` block; the version above is the one that
  works.
