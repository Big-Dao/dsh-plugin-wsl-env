# Upstream: Host "Open in app" inherits `ELECTRON_RUN_AS_NODE`

Status: observed on DSH Desktop `0.2.1-rc.3` (Windows x64, 2026-10-30);
**not a defect of this plugin.** The Host process's open-in-app launcher
inherits `ELECTRON_RUN_AS_NODE=1`, so Electron editors (VS Code, Cursor)
start as Node, exit 1, and the UI reports launch-failed. File Explorer and
other non-Electron launchers work. The failure is the same on a Windows
folder and on a WSL UNC workspace.

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

This repository will not work around the Host spawn: the plugin does not
own that launcher, and a WSL-specific env filter would not help Windows
workspaces.
