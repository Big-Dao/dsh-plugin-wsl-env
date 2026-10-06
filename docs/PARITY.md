# Parity with VS Code Remote-WSL

What parity means for this plugin, the seam contracts the plan was audited
against, and the phase checklist with each phase's current status. The plan
has landed; the rows below record where each phase ended up and what
deviation, if any, still stands.

Verified against: `dsh-plugin-wsl-env@0.8.0` / peer `0.2.0-rc.2` / agent
protocol v4, 2026-10-06. Update this line when the peer pin or the agent
protocol moves.

## What parity means here

Remote-WSL's experience rests on one thing: a resident server inside the
distro. Everything users love — native ext4 semantics, inotify, native
`rg`, low latency — is a derivative. This plugin's 9p-UNC plus one-shot
`wsl.exe` model can only approach it, so the plan landed a resident
in-distro agent and moved the `fs` and `shell` seams onto it. The agent is
now the only substrate for the file tools; the fallbacks left are at the
transport level — the one-shot `wsl.exe` path that `wsl-shell.agent: false`
pins for command execution, and that a search spawn drops to when the agent
is out, never a share.

Not applicable, recorded so the gap is a decision and not an omission:

- IntelliSense, debuggers, the extension marketplace: editor features. The
  DSH analogue is tool latency and correctness (Phases 1–3).
- Settings Sync, Remote-SSH tunnel chaining, Codespaces: composition-layer
  responsibilities, not this plugin's.

> **Update (2026-10-04).** The plan's transitional invariant — that
> `wsl-shell.agent: false` must equal the pre-agent share-backed behaviour —
> is superseded: the share substrate is refused at construction, and the
> search spawn rides the distro's rg. The share is no longer a fallback path
> of this plugin; the only fallbacks left are transport-level (one-shot
> `wsl.exe` where the resident agent is out), never share I/O.

## Contract audit (Phase 0)

Findings from reading the harness packages inside the app bundle; each one
shaped a phase of the plan.

1. **`ctx.fs.watch` is a coarse invalidation callback, not an event stream.**
   `FileSystem.watch(target, changed, signal)` (dsh-fs) resolves once
   observation is active and returns an async close function; `changed` takes
   no event payload. So the in-distro watcher does not need to classify
   rename vs. modify — any inotify (or polling) hit may call `changed()`.
   Phase 1's watcher is accordingly simpler than planned.
2. **Search is not an `fs` seam.** `dsh-tool-fs-search` spawns the PACKAGED
   ripgrep binary (`@vscode/ripgrep`) through `ctx.subprocess` with a plain
   argv vector and no shell; raw stdout is parsed by the tool. The correct
   interception point is therefore the plugin's `subprocess-wsl` subclass:
   when `argv[0]` is the packaged rg binary and the spec's cwd is inside this
   distro's share, rewrite the spawn to run a distro-side `rg` (falling back
   to `grep -rE` + `find` when absent) with identical stdout conventions.
   Under the agent, that exec rides the agent's `exec` capability.
   **LANDED (2026-10-04), as the design above has it:**
   `WslSubprocessRuntime.spawn` performs the rewrite, the decision living in
   `lib/search-route.js`, and the exec rides the agent's `exec` capability —
   Phase 1's resident — through the minimal handle facade of
   `lib/search-exec.js` (the spawn seam returns its handle synchronously, so
   the facade degrades inside `done`), with the one-shot `wsl.exe --exec`
   handle as the fallback when the agent is out. The `grep -rE` fallback is
   NOT implemented — grep does not read `.gitignore`, so it is not an rg
   substitute; a distro without one surfaces rg's own "command not found",
   and `scripts/bootstrap.sh` reports whether the binary is installed. With
   the share substrate retired the same day, no model-facing search crosses
   the 9p share at all.
3. **`dsh-fs-local` watches with chokidar over the share** — the behaviour
   this plugin replaces: chokidar on 9p is the unreliability that made
   `WslFileSystem.watch` refuse. The in-distro watcher replaces it wholesale.
4. **`dsh-bash-local` carries the timeout machinery** (`clampTimeout`,
   `deadline`, `timeoutOf`, `BASH_TIMEOUT`), which the WSL executor already
   inherits. Migrating exec onto the agent keeps that shape: the deadline
   arms on the host as today, but the SIGTERM→SIGKILL grace fires inside the
   distro via the agent instead of against the Windows process tree.

## Phase checklist

| Phase | Status | Deliverable | Parity row |
| --- | --- | --- | --- |
| 0 | landed | This document; contract audit above | baseline recorded |
| 1 | landed | `lib/agent.js` (with `lib/agent-protocol.js`, `lib/agent-shared.js`) and `agent/wsl-agent.sh`: resident process speaking a line protocol (pipe-separated fields, single-line base64 payloads), version + script-digest handshake, lazy start, idle shutdown, crash-rebuild-once, one-shot `wsl.exe` fallback for execution | resident server |
| 2 | landed | real `watch()` shipped (in-distro mtime poll, `lib/watcher.js`); the native-ext4 migration of the remaining fs operations finished with the share's retirement — every model-facing file operation now runs on the agent, and the share-era workarounds went with it | native file semantics, change invalidation — watch + publication done (a poll, not inotify; blind spots in LIMITATIONS and CONFIGURATION) |
| 3 | landed (deviation: no streaming, no spill files) | `WslShellExecutor` exec via agent; in-distro TERM→KILL; handle shape preserved | native exec latency |
| 4 | landed | `npm run bootstrap`, family-aware install command, `SANDBOX_UNAVAILABLE` names it; the handshake ships the protocol version plus the script digest | open-and-it-works |
| 5 | landed | per-session routing by workspace coordinates (`terminal-route.js`, `hostSessions`); idle distro terminals are reclaimed by a distro-side scan (`lib/terminal-activity.js`) — the host-side shell-activity integration still does not arm for `wsl.exe`, which is why the observation is a scan | terminal per window/session |
| 6 | landed | `DSH_WSL_PORTS` (agent-scanned `/proc/net/tcp{,6}`, timer-refreshed); localhost reachability (WSL2 localhost forwarding is platform behaviour) documented in README | port forwarding visibility |
| 7 | landed | recipes section in both READMEs: credential sharing, `/mnt/c` guidance, `WSLENV` policy | developer-loop odds and ends |

## Fallback invariant

The plan's rule — every phase keeps the pre-phase behaviour byte for byte —
is superseded by the Update above. What is still load-bearing is narrower,
and no longer involves the share:

- **Command execution.** `wsl-shell.agent: false`, and any agent failure at
  runtime, run the command through the one-shot `wsl.exe` path, which is the
  pre-agent `executeOneShot` verbatim; confinement and result decoration are
  identical on both, and the budgets keep their shapes — the agent path cuts
  each stream at `maxOutputBytes` inside the distro and reports
  `truncated: true` with no spill file, where the one-shot path can spill
  (`maxSpillBytes`, `graceMs`). The probe asserts this:
  `pnpm run probe:agent` (`bash test/probe/agent.sh`, Windows + WSL only)
  runs the same operations through the resident and through the one-shot path
  and compares outcomes — exit code, stdout bytes, stderr bytes, working
  directory — not internals.
- **Search has no share fallback either.** The distro rewrite runs on the
  resident agent — a distro-side `rg` must exist — and an agent that is out
  drops the same spawn to the one-shot `wsl.exe --exec` handle
  (`lib/search-exec.js`): a transport fallback, never the 9p share.
- **File tools fail closed.** `wsl-fs.substrate` has one working value,
  `agent`; a profile still carrying the retired `share` is refused at
  construction. When the agent is out these operations fail closed with
  `FS_IO_ERROR` naming the substrate — deliberately, there is no I/O to
  degrade into, and with the share retired no model-facing file path crosses
  9p.
