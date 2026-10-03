# Parity with VS Code Remote-WSL

What parity means for this plugin, the seam contracts the plan was audited
against, and the phase checklist. Every phase below ends with rows of this
table ticked and this document updated in the same change.

## What parity means here

Remote-WSL's experience rests on one thing: a resident server inside the
distro. Everything users love — native ext4 semantics, inotify, native
`rg`, low latency — is a derivative. This plugin's 9p-UNC plus one-shot
`wsl.exe` model can only approach it. The plan therefore lands a resident
in-distro agent and migrates the `fs` and `shell` seams onto it, keeping the
current paths as the documented fallback (`wsl.agent: false` must equal
today's behaviour byte for byte).

Not applicable, recorded so the gap is a decision and not an omission:

- IntelliSense, debuggers, the extension marketplace: editor features. The
  DSH analogue is tool latency and correctness (Phases 1–3).
- Settings Sync, Remote-SSH tunnel chaining, Codespaces: composition-layer
  responsibilities, not this plugin's.

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
3. **`dsh-fs-local` watches with chokidar over the share** — the behaviour
   this plugin replaces: chokidar on 9p is the unreliability that made
   `WslFileSystem.watch` refuse. The in-distro watcher replaces it wholesale.
4. **`dsh-bash-local` carries the timeout machinery** (`clampTimeout`,
   `deadline`, `timeoutOf`, `BASH_TIMEOUT`), which the WSL executor already
   inherits. Migrating exec onto the agent keeps that shape: the deadline
   arms on the host as today, but the SIGTERM→SIGKILL grace fires inside the
   distro via the agent instead of against the Windows process tree.

## Phase checklist

| Phase | Deliverable | Parity row |
| --- | --- | --- |
| 0 | This document; contract audit above | baseline recorded |
| 1 | `lib/agent/` + `wsl-agent` resident process: NDJSON-over-stdio protocol, capability handshake, lazy start, idle shutdown, crash-rebuild-once, permanent fallback | resident server |
| 2 | real `watch()` SHIPPED (in-distro poll, `lib/watcher.js`); the native-ext4 migration of the remaining fs operations (and with it the workaround deletions) continues alongside Phase 3 | native file semantics, inotify — watch + publication done |
| 3 | DONE — `WslShellExecutor` exec via agent; in-distro TERM→KILL; handle shape preserved (deviation: no streaming, no spill files) | native exec latency |
| 4 | DONE (except the agent/plugin version handshake, which lands with the first agent-behaviour change after release) — `npm run bootstrap`, family-aware install command, `SANDBOX_UNAVAILABLE` names it | open-and-it-works |
| 5 | DONE (routing half) — per-session routing by workspace coordinates (`terminal-route.js`, `hostSessions`); activity-based idle reclaim of distro terminals remains a documented limitation (PTY activity stops at `wsl.exe`) | terminal per window/session — routing done |
| 6 | DONE — `DSH_WSL_PORTS` (agent-scanned `/proc/net/tcp{,6}`, timer-refreshed); localhost reachability (WSL2 localhost forwarding is platform behaviour) documented in README | port forwarding visibility |
| 7 | DONE — recipes section in both READMEs: credential sharing, `/mnt/c` guidance, `WSLENV` policy | developer-loop odds and ends |

## Fallback invariant

Every phase must keep `wsl.agent: false` (and, per capability, any runtime
fallback) behaviourally identical to the pre-phase release. Probes assert
this: `agent.sh` runs the same operations through the resident and through
the one-shot `wsl.exe` path and compares outcomes — exit code, stdout bytes,
stderr bytes, working directory — not internals.
