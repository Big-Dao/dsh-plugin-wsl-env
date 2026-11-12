# Upstream: Host "Open in app" inherits `ELECTRON_RUN_AS_NODE`

Status: observed on DSH Desktop `0.2.1-rc.3` (Windows x64, 2026-10-30);
**not a defect of this plugin.** The Host process's open-in-app launcher
inherits `ELECTRON_RUN_AS_NODE=1`, so Electron editors (VS Code, Cursor)
start as Node, exit 1, and the UI reports launch-failed. File Explorer and
other non-Electron launchers work. The failure is the same on a Windows
folder and on a WSL UNC workspace.

Update 2026-11-06: the `0.2.1-rc.5` line cleared the flag in
`launchDetachedApp` (`clearedElectronFlag`, extracted in
[app.asar.0.2.1-rc.5.open-in-app.index.js](upstream/app.asar.0.2.1-rc.5.open-in-app.index.js)),
and **`0.2.2-rc.1` lost that clearing** — the regression is back on the
current runtime.

**No host patch is required for this plugin's path.** The `wsl-open-in-app`
row (below) registers its own authenticated launch route and scrubs
`ELECTRON_RUN_AS_NODE` from the editor child's environment, so the plugin's
**在 VS Code 中打开（WSL）** menu item works on an unpatched archive and lands in
Remote-WSL. The shipped "Open in app" item still inherits the flag and still
fails; that half remains the upstream ask. The local archive patches described
below are historical. `test/probe/open-in-app-patch.sh` now reports the plugin
bridge's presence and the archive's state as diagnostic facts; it no longer
prescribes re-patching, because an app upgrade cannot drop the plugin row.

### Historical local patch 2 — WSL workspaces open through `--folder-uri` (verified 2026-11-06)

Riding on the same re-patch: a WSL UNC workspace
(`\\wsl.localhost\<distro>\...`) passed as a plain path opens a plain-folder
window where every command runs on the Windows side, and VS Code only
*suggests* "Reopen Folder in WSL". The patched `launchArgs` converts a WSL
UNC path (both `wsl.localhost` and `wsl$` spellings) to
`vscode-remote://wsl%2B<distro>/<posix path>` and passes it as
`--folder-uri=<uri>` — but only when the launch command is an Electron
editor (`Code.exe`, `Code - Insiders.exe`, `Cursor.exe`, `Windsurf.exe`);
every other launcher (terminals, Explorer) keeps the literal path, and
drive-letter paths are never rewritten. Two shapes were tried before this
one settled: the URI as a positional argument opens an untitled *file* whose
content is the URI text, so the explicit `--folder-uri=` form is required.
The patched module is archived in
[app.asar.0.2.2-rc.1.open-in-app.index.js](upstream/app.asar.0.2.2-rc.1.open-in-app.index.js).

### Bridge in this repository

`src/open-in-app.ts` replaces the archive patch with two Host-side facts:

- the `wsl-open-in-app` row scrubs `ELECTRON_RUN_AS_NODE` from the **editor
  child's** environment before spawning it, so an Electron editor starts as an
  application; the Host process environment is left alone, because deleting the
  name there breaks Node-mode helpers such as the Windows Job runner;
- the row registers `POST /api/wsl-env/open-in-app` on the authenticated
  `/api` channel. The browser's session-header menu posts the Session cwd; the
  handler accepts only a `\\wsl...` UNC path, builds the
  `vscode-remote://wsl%2B<distro>/<path>` URI, and launches the editor with
  `--folder-uri`.

An app upgrade replaces `app.asar` but not the plugin, so the fix survives
upgrades; no local patch is needed. If upstream clears the flag itself, the
first step becomes a no-op.

Upstream ask, extended: besides clearing `ELECTRON_RUN_AS_NODE`, resolve a
WSL UNC workspace to its `vscode-remote` URI for Electron editors, so the
launched window is already in Remote-WSL.

User-facing note: [LIMITATIONS.md](LIMITATIONS.md#host-open-in-app).

## Environment

- DSH Desktop 0.2.1-rc.3, Windows 11
- Reproduced on both `\\wsl.localhost\...` workspaces and plain Windows
  paths; 100% of VS Code launches failed

## What happens

The desktop window's overflow menu "Open in app" → VS Code shows an "打开失败"
/ launch-failed toast. VS Code never opens.

## Cause

1. The desktop app starts the backend Host through
   `desktopNodeEnvironment()` (`lib/main.js`) with
   `ELECTRON_RUN_AS_NODE: "1"`.
2. Open-in-app's `launchDetachedApp()` (`@deepseek-ai/dsh-host-open-in-app`)
   builds the child environment with `scrubbedParentEnv()`, which strips
   keys matching `/KEY|PASSWORD|SECRET|TOKEN/i` and `DSH_*`.
   `ELECTRON_RUN_AS_NODE` is left in place.
3. Host then spawn's `Code.exe <workspace>`. VS Code (Electron) sees
   `ELECTRON_RUN_AS_NODE=1`, runs as plain Node, opens no window, and
   exits 1 inside the launch watch window → `POST /open-in-app/open`
   returns 502 `launch-failed`.

`dsh-subprocess-local` already clears `ELECTRON_RUN_AS_NODE` when it
spawns the PTC runtime, so the Host carrying that variable is a known
fact; open-in-app's scrub list does not follow it.

## Reproduction

Using the app's bundled `node.exe`, spawn `Code.exe` detached with stdio
ignored and a scrubbed parent env:

- without `ELECTRON_RUN_AS_NODE`: `Code.exe` stays running → launched
- with `ELECTRON_RUN_AS_NODE=1`: process exits quickly, code 1 → 502

## Ask

Drop `ELECTRON_RUN_AS_NODE` in `launchDetachedApp()` (or in the shared
`scrubbedParentEnv()`), matching `dsh-subprocess-local`. Any Electron
target (VS Code, Cursor, …) hits the same path.

The plugin owns a narrow launch bridge because the upstream launcher offers no
configuration seam: one environment-name deletion plus one WSL-only route. The
upstream ask above remains the permanent fix.
