# Upstream proposal: a terminal tab title that follows the session's shell

Status: proposed upstream as
[deepseek-ai/deepseek-harness#8769](https://github.com/deepseek-ai/deepseek-harness/discussions/8769)
(targeting `packages/api/terminal-controller`, version line `0.2.0-rc.x`). This
is the record of a gap this plugin worked around, could not work around, and
now documents: the GUI terminal titles every tab from the composition's single
shell profile, so a per-session shell choice is invisible in the title.

## The gap

`TerminalController.spawn` fixes a terminal's display title from the resolved
shell profile before the provider is ever consulted:

```ts
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
   controller registers in its constructor. Disabling the row fails web boot:
   `1 entry did not activate: @deepseek-ai/dsh-client-ui-sidebar-terminal:
   pending (waiting for service: webTerminals)`. Verified live against
   `dsh-desktop 0.2.0-rc.2`.
3. **Per-session config.** The `shell` profile is composition state; `!!js`
   expressions evaluate once at config resolution and reach no Session
   identity.

## The proposal

Any one of these closes the gap; the first is the smallest and keeps the
profile name as the fallback:

- `SubprocessTerminalSpawnSpec` gains an optional `displayTitle` (or the handle
  exposes the launched `argv`), and `create()` uses it for `info.title` when
  present — falling back to `shell.name`. A provider that rewrites a launch
  states the program it started; every other launch keeps the profile name.
- Alternatively, the controller derives the title from the effective program
  itself: title `executableName(effectiveArgv[0])` when it differs from
  `shell.path`, else `shell.name`.

With either, this plugin deletes the limitation paragraph in
[LIMITATIONS.md](LIMITATIONS.md) and the `WSL`-over-PowerShell title, for any
provider that rewrites launches — not just WSL.

## Workarounds until then

- Double-click a tab's title to rename it (a shipped client feature; the
  controller's `rename` Remote API accepts 1–120 characters).
- Add `shellCandidates` to the `terminal-controller` row in a user layer: a
  manually selected shell is titled after itself.
