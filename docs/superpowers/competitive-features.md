# Competitive feature analysis — where the plugin trails

Status: research record, 2026-11-06. Two web-research passes over official
docs only (VS Code/JetBrains/Dev Containers/WSL surface; Claude Code/Codex/
Gemini CLI/Cursor). Purpose: feed the pain journal's candidate pool with
mechanisms proven elsewhere — each still must pass the three questions before
entering the roadmap.

## What peers do that we already do

Our position is stronger than the raw gap list suggests. Verified already
shipped here: in-distro execution substrate (VS Code's vscode-server /
Cursor's remote-server model, but no per-distro server download — the resident
agent cache plays that role), in-distro rg search and git (Codex eats 9p;
Claude Code documents the silent match loss), kernel-enforced sandbox with
honest `partial` (Claude Code has none on native Windows; Codex's ACL sandbox
breaks on UNC workspaces — issue #47115), coordinate routing per workspace
(Codex's global "Agent Environment" toggle cannot do mixed stations — #37936),
`doctor` with copy-paste remedies (only Codex's `codex doctor` JSON is richer
in shape), b bilingual docs, install e2e.

## Gaps, triaged through the three questions

| # | Peer mechanism | Our gap | Q1 who hurts | Q2 magnitude | Q3 cost of not doing | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Headless/one-shot run** (DSH upstream: `dsh --profile headless "task"`, `--json`, `--session-id`, `--approval-policy never`) | Plugin never verified under headless; `preset-wsl` rows are agent-preset-scoped and headless composes its own preset | Maintainer wants unattended agent runs; CI/scripting users | Whole-feature absence | The plugin is GUI-bound in practice; autonomy story stays undocumented | **Top candidate: verification spike** |
| 2 | **Codex doctor's shape**: ~25 named checks, id/status/remediation/durationMs JSON | `doctor --json` exists but fewer checks; no WSL1-vs-WSL2 check, no interop/PATH diagnostics, no firewall-remedy | Setup-report submitters (forced to paste doctor JSON) | Per failed setup: minutes-to-hours | Diagnose quality is onboarding's core promise | **Candidate: extend doctor** (WSL version check, interop/appendWindowsPath, automount root, .wslconfig parse validation) |
| 3 | **WSL1 detection + graceful degradation** (Claude Code documents it; VS Code documents WSL1 watcher/Alpine limits) | We declare WSL1 a non-goal but never *detect and name* it; a WSL1 user gets unexplained failures | WSL1 users (shrinking population) | Rare; total confusion when hit | Documented non-goal, but failure is silent | Fold into #2 doctor (cheap) |
| 4 | **`.wslconfig` silent-ignore trap + 8-second rule** (malformed file silently ignored; changes need full VM stop) | doctor doesn't parse/validate `.wslconfig`; interop visibility advice may silently not apply | Sandbox users who edit interop settings | Debugging session when it bites | Misdiagnosis risk in our own remedies | Fold into #2 |
| 5 | **Firewall-remedy templates** (JetBrains makes users hand-run `New-NetFirewallRule`) | Ports surface has no firewall-failure signature | Anyone serving a port from distro | Unknown; no logged pain | Unknown | **Shelve until a pain logs it** |
| 6 | **Credential/agent forwarding** (GCM sharing, SSH-agent opt-in, VS Code documented passphrase-hang) | git runs in-distro; credential story undocumented — push from sandbox may hang or fail | Sandbox users pushing code | Unknown; likely real on first push | Annoying surprise, workaroundable (host git identity) | **Candidate: document + probe the credential path** |
| 7 | **Prebuilt base distro** (Dev Containers prebuilds: `wsl --import` a curated tarball → first run skips apt installs) | bootstrap installs packages per distro; five-minute goal pays the apt tax every time | New users (the unmeasured first run) | Minutes on clean machines | First-run goal harder; but timing never measured | **Shelve behind the first-run pain** — revisit if pain log shows onboarding failures |
| 8 | **Trust-prompt scaffolding** (Dev Containers gates each escalation) | Our refusals fail-closed with code+remedy (close in spirit) | — | — | — | No gap worth acting on |
| 9 | **Container sandbox backend** (Gemini: Docker/Podman bind-mount, UID/GID mapping) | bwrap only | Paranoid users | Rare | Documented boundary | Shelve; bwrap+partial is the honest scope |
| 10 | **Cross-boundary search warning** (Claude Code at least documents the silent match loss; we route search in-distro) | No gap — we solved the cause | — | — | — | Inverted: this is a marketing point for README |

## The headless question (2026-11-06, answered by upstream source)

The decoupling the maintainer asked for already exists upstream — the plugin
just never proved it rides along:

- `dsh --profile headless "task"`: one-shot agent over `dsh-base`, no Host,
  HTTP or browser layer; exit 0/1 contract; `--json` event stream; `--session-id`
  resume; `--approval-policy never` for unattended runs (packages/bundle/headless).
- Composition: every `dsh` surface boots the same way — bundle layers in
  `dsh.profile.bundles` order, the profile's `cordis.patch.yml`, overlays
  (apps/cli/src/profile-boot.ts). A headless profile directory
  (`$DSH_HOME/profiles/headless/`) can declare the wsl-env plugin as a bundle
  dependency and its rows load there.
- Open plugin-side question: root-plane rows (`fs-routing`, root `subprocess`)
  apply profile-wide; but `wsl-shell`/`preset-wsl` agent-preset rows are scoped
  to agents selecting that preset, and headless composes its own default
  preset — the shell tool may run host-side with only the fs plane routed.

**Proposed spike (S):** install the plugin into a headless profile, run
`dsh --profile headless "uname -a && pwd"` from a WSL workspace, and record
which planes route. If the shell plane stays host-side, the fix is a headless
profile patch or root-scoping — either way it is the plugin's autonomy story:
scripted, scheduled, UI-closed runs in the right distro under bwrap. This is
the one candidate that changes what the product *is* rather than how it feels.
(2026-11-06 demoted from top candidate: the maintainer's actual autonomy need
is background continuity of desktop-app sessions, not scripted one-shots —
see the continuity probe below. The spike remains valid for CI/scripting use
and needs no urgency.)

## Background continuity of desktop-app sessions (2026-11-06)

The desktop app is "close window, keep process": tray icon, host process
resident (maintainer fact). Architecture-wise the wanted experience — close
the window, the agent keeps working, reopen and reattach to history and live
state — should already work: gateway reconnection and session-controller
reattach exist for exactly this. What has never been tested is an **in-flight
turn across window close/reopen**. Three candidate break points, any of which
the experiment names:

1. the app tears down active sessions on window close (a "polite" interrupt);
2. the plugin's `wsl.exe` child chain gets cleaned up on close (Windows does
   not kill children automatically, but the app may);
3. the systemd session scopes and the distro-side resident agent do not
   survive to reopen.

**Probe (S, real machine, manual window close):** start a background job
writing a marker file after `sleep 120` — one on the host side, one through
the plugin's distro agent — close the window for ~3 minutes, reopen the same
session, then check: turn continuity, job completion notices, marker files,
scope/agent liveness. Whichever leg fails names the fix and its owner
(upstream session teardown vs plugin child-chain hardening).
