# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The reasoning and the measurements behind each entry are in the archived
engineering record,
[docs/archive/engineering-record.zh.md](docs/archive/engineering-record.zh.md)
(Chinese, repository only — it is history, never a second README). Every `§`
reference below points at that record's numbering.

## [Unreleased]

### Added

- **The plugin page can speak the bundle's language.** The bundle and each of
  its four inserted rows (`subprocess`, `picker`, `shell-env`, `auto-preset`)
  now export localized display metadata — `locale/<lang>.json` with a
  `meta.title` / `meta.description` pair, exposed through `exports` per row —
  which is what the Plugins page reads before falling back to a package.json
  `description`. A Chinese UI now renders Chinese titles and descriptions for
  every row this package owns; previously the rows fell back to raw module
  specifiers (no description at all), and the two official rows it inserts
  keep their upstream English text, which only upstream locale files can fix.
- **docs/UPSTREAM-TERMINAL-TITLE.md — the upstream proposal behind a documented
  limitation, posted as
  [deepseek-ai/deepseek-harness#8769](https://github.com/deepseek-ai/deepseek-harness/discussions/8769).** `subprocess-wsl.hostSessions` routes a Windows-folder session's
  terminal to `powershell.exe`, but the tab still reads `WSL`: the controller
  titles a tab from the composition's single shell profile before the provider
  is consulted, the terminal spawn spec carries no display name, and a plugin
  cannot bridge the gap (a patch layer asserts rather than renames a row's
  module, and disabling the `terminal-controller` row fails web boot — its id
  is what the client's `webTerminals` mount waits behind). The doc records the
  gap, the three closed escape hatches with the web-boot failure that closed
  the second one live, and the smallest upstream change that would close it.
  LIMITATIONS.md gains the matching limitation paragraph with the workarounds
  that do work: double-click rename, and a user-layer `shellCandidates` entry
  whose manual selection is titled after itself.
- **The README carries an Architecture section** (both languages): the two
  mount heights — composition-level `subprocess-wsl` and the preset realm's
  `wsl-shell` / `wsl-fs` — with the per-session terminal routing and the
  command and file execution paths in one diagram and two paragraphs.
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) remains the full reference.

### Fixed

- Stale statements that `hostSessions` had already falsified were corrected in
  place: `cordis.patch.yml`'s consequence note and ARCHITECTURE.md's "the
  terminal follows the app configuration" paragraph still described the
  pre-routing behaviour.

## [0.4.0] - 2026-10-03

One theme: the enterprise review's remediation cycle completes. The
security-decision layer gains its own peer-free module and unit tests, the
coverage gate measures every unit file again, the fallback invariant is probed
for real, and the file tools pick up the audit's fixes — a killed write no
longer strands state, large reads stream instead of staging, `/tmp` writes
land where readers read, cross-distro workdirs are refused, the resident's
Windows environment is pinned, and `maskWindowsDrive` offers the interop
mitigation.

### Added

- **The filesystem provider's policy decisions are a peer-free module with
  their own unit tests.** The security-decision layer — which paths are
  refused for naming another distro, which mode denies a mutation outright,
  which write guards refuse which intents, how a substrate failure maps onto
  the surfaced refusal, and whether a mutation routes to the confined
  resident — used to live inline in `lib/index.js`, a file no unit test can
  import. It is now `lib/fs-decisions.js` (pure in, refusal descriptor out,
  byte-identical messages), with `test/fs-decisions.test.mjs` covering every
  branch, and `lib/index.js` delegating at one `FsError` choke point.

### Fixed

- **The fallback invariant is now probed, not just promised.** PARITY.md's
  hard rule — "`agent: false` must behave like the pre-agent release" — cited
  a probe leg that did not exist, and spelled the key as `wsl.agent: 'off'`
  when it is a boolean. `test/probe/agent.sh` now runs the same operations
  through the resident AND through the one-shot `wsl.exe` path and compares
  outcomes: exit code and stdout bytes (including `$`-metacharacters), stderr
  and working directory, and NUL/CRLF binary safety. All three legs pass
  against a real distro; the doc now names the key correctly and describes
  what the probe actually compares.

- **The coverage gate measures every unit file again.** `test:coverage` listed
  six of the sixteen test files — the thresholds (85/85/70) were met by the
  narrowed set while the full suite sat at 82.45% branches, so branch
  regressions anywhere outside the six were invisible to the gate that claimed
  to guard them. The gate now runs the whole unit suite (95.83% lines / 85.95%
  branches / 91.01% functions), which got there the honest way: new tests for
  the seams the audit found dark — the deny-dialect classification,
  aborted-signal mapping, the transport env pin, handshake mismatch, protocol
  garbage, cwd rejections, pre-aborted signals, idle retirement, mid-flight
  over-cap buffers, failed rebuilds, watcher teardown and error paths, the
  cross-distro workdir predicate, staging sweeps, setuid publication, and the
  real-`/tmp` consistency the file tools now have.

- **Reading a large file no longer copies its remainder to a temp file for
  every window.** `fs_read` staged `tail -c +offset` to disk before `head`
  took the requested bytes — so a full read of a 1 GB file performed ~1000
  window round trips AND ~500 GB of aggregate temp-file writes inside the
  distro, and a window that took over 30 seconds died as an opaque
  "distro I/O failure". The remainder now streams through a `tail | head`
  pipe (the request's own bound is the only staging), read failures still
  classify through the same stderr dialect, and windowed reads are verified
  byte-exact including the final partial window.
- **A request the transport cannot deliver now fails its caller instead of
  stranding it.** `writeLines` used to drop a frame silently when the
  `wsl.exe` process was gone (a thin race between exit handling and the next
  request), leaving a pending entry nothing would ever answer — the caller
  waited forever when it had no timeout, and the watchdog had no process
  left to kill. An undeliverable frame now rejects with
  `AgentUnavailableError` ("the agent exited before the request could be
  sent; it never ran"), the rebuild relay fails undeliverable re-sends the
  same way, and `close()` no longer writes `SHUTDOWN` into an ended stdin
  (whose async write-after-end error could crash the process during its own
  shutdown).

- **A confined write to `/tmp` now lands in the distro's real `/tmp`, where
  every reader reads.** The fence grants `/tmp` as a writable root, but the
  confined resident's profile mounted an ephemeral tmpfs over it — so the
  write reported success into a private tmpfs, the read tools (unconfined)
  could not see it, the post-write stat produced a `missing:` version that
  made the next edit fail with `FS_STALE_VERSION`, and the file evaporated
  when the resident retired. The file-writes resident's profile now binds the
  real `/tmp` read-write (`realTmp`, on by default for the confined factory):
  the write lands where the fence said it would, reads and edits agree, and
  user terminals see the file. Commands keep their ephemeral per-run tmpfs —
  the fresh-temp-area property (and its anti-poisoning guarantee) is
  unchanged, so a command still cannot see files the write tools placed in
  `/tmp` — the documented command-vs-tools split, now safe in both
  directions. Verified live: confined write → plain read returns the content;
  a confined `cat` still reports it absent, as documented.

- **A killed write no longer leaves its staging directory in your files.** A
  `KILL`/`SIGTERM` mid-write could not be trapped, so the private 0700
  staging dir (`.<name>.<pid>.<rand>.tmpdir`) sat in the target's own
  directory forever — and listings showed the debris to the model. The EXIT
  trap now removes the in-flight staging along with the agent's temp dir, and
  each write sweeps the target directory's leftovers whose creating agent's
  PID (it rides the name) is no longer running — a live agent's staging is
  left alone, PID reuse included.
- **A write to a typo'd path refuses instead of materializing the chain.**
  The staging `mkdir -p` silently created every missing parent directory and
  reported success, where the peer's Node-fs publication fails `ENOENT` —
  masking model errors as wins. Parents are no longer created: the refusal is
  `FS_NOT_FOUND`, an existing directory stays fine, and a concurrent creator
  of the directory still wins.
- **Setuid, setgid and sticky bits survive an overwrite or edit.** The mode
  was masked to `0o777` at the stat parse and again at the write, so a
  `4755` binary became `755` and a `1777` directory file lost its sticky bit
  — while LIMITATIONS claimed the bits were kept. The full mode now rides
  stat and write end-to-end (`0o7777`), matching the share substrate's
  `chmod --reference` behaviour.

- **A shell command whose workdir names another WSL distro is refused, where
  it used to run in the pinned distro against whatever tree shares the path.**
  `toLinuxPath` strips a `\\wsl.localhost\<name>\…` UNC's distro name, and the
  shell executor never compared it — so a `debian` workspace's commands ran
  inside the pinned `ubuntu`, silently, while the fs side refused the same
  workspace with `FS_OUTSIDE_DISTRO` ("open a session in that distro" — which
  the user had done). The shell now refuses with the fs side's wording, and
  the shell-env facts stay silent for a foreign-distro session instead of
  presenting another distro's home and shell as this session's.

- **The resident agent no longer inherits the Windows environment's WSLENV
  forwarding.** Spawned bare, `wsl.exe` carried this process's whole
  environment with it, and whatever the user's `WSLENV` names — dev machines
  routinely route secrets (`GITHUB_TOKEN/u` is the documented example) — was
  forwarded into the distro, where every model command inherited it. The
  transport's Windows env is now pinned: the essentials `wsl.exe` itself
  needs, the managed `DSH_*` facts, `WSL_UTF8=1`, and a `WSLENV` that names
  only the managed entries with their original flags. Verified live: a secret
  injected on the Windows side with a forwarding flag appears zero times in
  the distro environment. `forwardEnv` remains one-shot-only today — the
  resident path never forwarded it, and the pin keeps that posture instead of
  widening it silently.

### Added

- **`maskWindowsDrive` on `wsl-shell` and `wsl-fs`** — the mitigation knob for
  the interop hole the sandbox has always documented. The confined profile
  mounts an empty tmpfs over `/mnt`, so the Windows drive's files cannot be
  read or exfiltrated by a "sandboxed" command and its executables cannot be
  launched through interop (the path by which such a command reaches your full
  Windows token). Honest limits, stated wherever the key is: binfmt interop
  dispatches on file content, so a command that can write the workspace can
  still write an executable there and run it — enforcement stays `partial`,
  the result's sandbox fact now carries `windowsDrive: "masked" | "visible"`
  so the model can see which posture it runs under, and the only complete
  closure is distro-level (`[interop] enabled=false` in `wsl.conf`). Default
  `false`: the drive stays visible unless you ask for the mask.

## [0.3.0] - 2026-10-03

One theme: the file tools move into the distro. The `substrate: "agent"` I/O
substrate and its kernel-enforced confined writes land together with the
enterprise review that hardened them — the watchdog that killed the shared
agent for a queue it never chose to join, the output captures nothing bounded,
a root listing that sheared the first character off every child's name, and an
overwrite guard that stopped at the host.

### Fixed

- **One file carries one version string, whichever op answered.** `stat` and
  `list` built their versions from different producers: the stat op used the
  distro's `stat` directives (uutils `stat` rounds timestamps to microseconds)
  while the list walk used `find -printf` (nanosecond-exact), so the same file
  yielded two different version strings and a list-derived guard failed
  against its own stat. `fs_stat` now reads through the same `find -printf`
  the list walk uses — one producer, one string — and `find -L`'s habit of
  reporting a dangling link as the link itself is refused the way the `stat`
  it replaced was, so a dangling link still stats to null like the peer's.

- **An overwrite or edit now re-verifies its version distro-side, one syscall
  before the rename.** The module header claimed the mutation guard "survives
  to the write", but the no-replace link guarded only `createIfAbsent`: an
  overwrite or edit checked the version host-side and then published with an
  unconditional `mv -f`, so a concurrent writer (an editor save, `git stash`,
  another session) that landed between the model's stat and the publish was
  silently clobbered with no `FS_STALE_VERSION`. The `write` op now carries
  the version the write was based on (a `replaceIfVersion` guard's version,
  or the stat an edit was read against), and the agent re-verifies it with a
  fresh stat from the SAME producer `fs_stat` uses — refusing with
  `FS_STALE_VERSION` ("file changed since it was read", or "file no longer
  exists") while the concurrent writer's content stays untouched and no
  staging debris is left behind. The window narrows from a host round trip to
  kernel-adjacent — the honest wording, here and in the module headers,
  LIMITATIONS.md and ARCHITECTURE.md, is that only the create case is closed
  outright.

- **The agent command path now enforces the output budget it always
  advertised.** `maxOutputBytes` rode the config schema but nothing else: the
  agent captured a command's whole stdout and stderr and base64ed both into
  one RES line — multi-gigabyte output meant multi-gigabyte dash command
  substitutions in the distro and a multi-gigabyte host line, with the result
  claiming `truncated: false` all the way. The EXEC frame now carries the
  caller's per-stream budget (`wsl-shell`'s `maxOutputBytes`, wired from the
  agent execution path); the agent cuts each stream at it — only the first
  bytes are encoded, so distro AND host memory are bounded — and the RES line
  reports which streams were cut, which the handle surfaces as honest
  per-stream `truncated` flags (a guarded-create synthesis and frames without
  a budget still read `false`). The host also defends itself against a broken
  or hostile agent: the unbounded readline accumulator is replaced with a
  bounded line splitter that kills the transport when one stdout line exceeds
  the protocol cap instead of buffering it whole.

- **A short-budget request queued behind a long one no longer kills the shared
  agent — and an in-flight command is never silently re-run.** Two defects
  shared one root: the host armed each request's watchdog at SUBMISSION and
  let it kill the one `wsl.exe` carrying every pending request, and the
  rebuild relay then replayed all carried frames verbatim. In the default
  configuration the 10 s `DSH_WSL_PORTS` poller (8 s budget, shared agent) did
  exactly this against any command longer than ~21 s: the poll's watchdog
  killed the transport, the command died mid-flight, and the rebuild
  **re-executed it from scratch** — both callers seeing success (measured: a
  killed `sleep 40` ran twice). Three changes close it: the agent answers
  `ACK|<id>` when it dequeues a request and the host arms the watchdog there,
  so queue time never spends a budget (wire protocol v3 — sync the runtime
  copy and restart the app, an old agent fails the handshake loudly instead of
  misbehaving quietly); the rebuild relays only provably read-only FS frames
  (`stat`/`lstat`/`list`/`realpath`/`read`), failing an in-flight EXEC or
  `write` with "its state is unknown — inspect the distro before retrying"
  instead of re-running it; and an abort now addresses the request's CURRENT
  id, so a relayed request's KILL (and map cleanup) can no longer miss. The
  watchdog-vs-queue experiment now ends with the long command executed exactly
  once and the transport alive.
- **A root listing kept every child's name whole.** `listChildren` sliced each
  `find` record at `parent.length + 1`, which against the bare `/` parent
  sheared the first character off every name (`/etc` → `tc`), and a write to a
  listed child then created `/tc`. The exact prefix is stripped instead, and
  the child join owes its own slash, so `listDir` on
  `\\wsl.localhost\<distro>\` names `/etc`, `/home`, `/usr` correctly.

### Added

- **`substrate: "agent"` — the filesystem's in-distro I/O substrate.** `wsl-fs`
  gains a `substrate` key, default `agent`: the file tools are served through
  the resident in-distro agent instead of the 9p share — identities are
  distro-side `realpath`s, symlinks resolve where they live (no retry
  machinery, `/etc/os-release` just works), mode bits are native, and a
  mutation guard survives to the write's no-replace publication — the
  check-then-write window the share documents closes, exactly as on a Linux
  host. `substrate: "share"` is the opt-out that keeps the previous behaviour
  byte for byte. Both substrates fence writes with the same host-side policy
  check, so this changes fidelity and posture, not enforcement. Known
  differences are in LIMITATIONS.md (notably: new files publish at 0600, the
  peer's own POSIX semantics, where the share took the umask 0644), and an
  agent outage fails with `FS_IO_ERROR` naming the substrate rather than
  degrading to share semantics. Layers: FS operation frames on the agent wire
  protocol (v3, `agent/wsl-agent.sh`), fsio-over-agent mechanics
  (`lib/fsio-agent.js`), provider-shaped orchestration (`lib/fs-substrate.js`),
  and the provider branch (`lib/index.js`). The pure text mechanics are
  replicated from upstream pending the fsio export proposed in
  docs/UPSTREAM-FSIO-EXPORT.md. Probed live: `npm run probe:substrate`.
- **Stage two: kernel-enforced confined writes.** On the agent substrate, a
  mutation under a confined policy rides its own long-lived resident — one
  agent per (distro, mode, workspace), spawned inside the bwrap profile that
  binds exactly what the mode grants (`lib/agent-confined.js`, `argvPrefix` on
  the agent wire). The kernel now refuses what the host-side check would have,
  so a check bug cannot become a write outside the workspace; a mount-table
  refusal surfaces as `FS_SANDBOX_DENIED`, the command path's dialect, and a
  distro without usable bwrap refuses confined writes with the bootstrap
  command instead of downgrading. Escalated (`danger-full-access`) writes ride
  the plain resident, and a policy change simply addresses a different key —
  the previous resident retires through its idle timer. Probed live: the
  confined write inside the workspace lands, and the one outside it is refused
  by the kernel (`probe:substrate`).

### Fixed

- **Every mutation on the agent substrate failed: the confined resident's command
  had no program** — `confinedAgent()` built the resident's `argvPrefix` from the
  raw profile arguments, so the transport handed `wsl.exe` a command beginning at
  `--ro-bind` instead of `bwrap --ro-bind`. The resident exited 1 during its
  handshake, and every write, edit and guarded create on `substrate: "agent"`
  failed with `FS_IO_ERROR: the distro file substrate is unavailable: agent exited
  during handshake (code=1 signal=none)` while reads kept working. Both confinement
  sites now assemble the command through the import-free `lib/bwrap.js`, which is
  what `test/agent.test.mjs` asserts; the same bug stayed invisible because
  `test/probe/substrate.sh` inlined a *third*, correct copy of those arguments —
  it now imports the production builder, so the probe fails with the provider.
- **`WslFileSystem` could not build its agent substrate at all: a constructor
  field shadowed the method of the same name** — the constructor's
  `this.agentSubstrate = undefined` (the cache) overwrote the prototype's
  `async agentSubstrate()` (the accessor), so the first file operation that needed
  the agent threw `this.agentSubstrate is not a function`, which is how a GUI
  session failed its turn in the Desktop app. The cache is now
  `this.agentSubstrateInstance`, named after the sibling `this.agentInstance`, and
  `lib/index.js`'s instance fields no longer collide with any class member.
- **A schemastery member the pinned peer does not publish took the `wsl` preset
  down in the Desktop app** — `WslFileSystem.Config` declared
  `substrate: z.enum(["share", "agent"])`, and `@deepseek-ai/schemastery` 3.18.4
  (what every `@deepseek-ai/dsh-*` peer pins as `~3.18.4`) publishes no `enum`. A
  Config schema is a class field, so the call ran while `lib/index.js` was still
  being imported: the loader logs the `TypeError` and leaves that row with no
  fiber, which the preset audit renders as `never started` — naming neither the
  member nor the file, and only for `wsl-shell` and `wsl-fs`, the two rows that
  load `lib/index.js`. The preset therefore failed to activate, so the app
  reported `2 row(s) did not activate` for those two ids. Now
  `z.union(["share", "agent"])`: same `agent` default, and a bad value still
  fails with `expected "share" | "agent" but got "bogus"`. Measured against the
  app's own runtime, both entries import; `test/syntax.mjs` now checks every
  `z.<member>` in `lib/` against the pinned peer's surface, which fails on
  `z.enum` and passes on `z.union`.
- **`truncated` missing from the agent path's output streams** — the bash tool's
  canonical result copies the field unconditionally (`canonicalBashResult`), so an
  `undefined` failed the wire's lossless-JSON snapshot and EVERY shell tool call
  returned "tool bash returned invalid output: value is not lossless JSON". The
  agent path now always reports `truncated: false` (it never truncates; there are
  no spill files). Regression assertion in `test/agent-exec.test.mjs`.
- **The agent execution path failed every shell call whose request carried an
  absolute UNC workdir** — which is every call a GUI session makes, so the
  harness's own agent session lost its bash tool until the fix. The one-shot
  path converts the spec's workdir inside `argv()` (`toLinuxPath`); the agent
  path carried the workdir as a raw frame field, so the raw UNC reached the
  in-distro `chdir`, the synthesized relay text fired `throwIfWorkdirMissing`,
  and the call died with "could not enter the working directory". The conversion
  now happens at the call site (regression test in `test/shell.test.mjs`).

### Added

- **Phase 5: per-session terminal routing.** `spawnTerminal` now routes on the
  request's directory coordinates (`lib/terminal-route.js`, `subprocess-wsl.hostSessions`,
  default on): a WSL-folder session gets the distro shell, a Windows-folder session gets
  a host `powershell.exe` in its own directory — no more distro terminal at
  `/mnt/<drive>/…` for host sessions. The shell menu stays the single configured profile,
  and every non-`wsl.exe` consumer is untouched. Still limited (LIMITATIONS.md): the
  shell menu is one entry, and directory-less launches land in the distro.
- **Phase 7: developer-loop recipes.** Both READMEs gain a Recipes section: Git
  credential sharing through the Windows Credential Manager, `/mnt/c` 9p
  performance guidance, and the `WSLENV` passthrough policy (prefix-admitted
  `DSH_*`, `/p` translation, `PATH` deliberately excluded).
- **Phase 6: listening-port visibility.** `DSH_WSL_PORTS` joins the managed
  `DSH_*` facts: the ports with a listener inside the distro, comma-separated,
  refreshed every `portsRefreshMs` (default 10s) through the resident agent by
  reading `/proc/net/tcp{,6}` directly — no `ss`, nothing to install. The
  registry's resolve is synchronous by contract, so the snapshot is served
  stale-but-recent; a dev server started moments ago appears on the next
  refresh. Scoped as before: only sessions whose workspace is inside a distro
  see it. Probed live: a real HTTP server appears in the next snapshot.
- **Phase 4: bootstrap.** `npm run bootstrap -- [distro] [--install]` checks the
  distro for bubblewrap (required) plus ripgrep and inotifywait (the optional
  backends later phases prefer), prints the exact copy-paste install command for
  the distro's package family (apt/dnf/pacman/zypper), and with `--install` runs
  it as the distro's root through `wsl.exe -u root` — no sudo prompt inside the
  distro, nothing touches the Windows side. The `SANDBOX_UNAVAILABLE` message now
  names the same command instead of a bare `sudo apt install`. Probed live:
  detect mode on a distro that already has bubblewrap.
- **Phase 3: shell execution through the agent.** `WslShellExecutor` now runs commands
  over the resident agent when it is up (`wsl-shell.agent`, default on): one long-lived
  in-distro process instead of a `wsl.exe` per command, with the timeout enforced
  INSIDE the distro (TERM, then KILL after the grace) instead of against the Windows
  process tree. The confinement argv, the execution-handle shape, the result
  decoration (runner failures, denials, `enforcement: partial`) and the workdir
  failure are all identical to the one-shot path — an out-of-service agent falls back
  to it per call, permanently after the agent's rebuild budget. Probed end-to-end:
  `npm run probe:exec` (confined completion, verbatim shell parsing, in-distro
  timeout, relay-shaped cwd failure, kill). Documented deviation: the agent path has
  no live output streaming — reads after settlement carry the whole stream, and no
  spill files (the protocol line already holds it in memory).
- **Phase 2 (second half, first slice): in-distro publication through the agent.**
  `WslFileSystem` now carries an optional resident agent (`wsl-fs.agent`, default on):
  when available, publication — the replaced file's mode copied onto the staged temp,
  then the atomic rename — is ONE `exec` inside the distro (`lib/fs-publish.js`)
  instead of a `wsl.exe` chmod plus a 9p rename. Any agent failure falls back to the
  legacy two-step path for that call; the flag changes round trips, never what is
  published. Probed: the publication script's mode preservation and creation
  behaviour run in `test/probe/agent.sh` (now 10 checks).
- **Phase 2 (first half): real `watch()`.** `WslFileSystem.watch` now observes from
  inside the distro — a long-lived `wsl.exe` `find -newer` poll loop (`lib/watcher.js`)
  firing the seam's coarse invalidation callback — instead of refusing with
  `FS_IO_ERROR`. Activates on a READY barrier from the loop (a write racing the first
  tick is never invisible), sees creations and deletions (both bump the parent's
  mtime), and cleans up on close. Documented blind spot: files created with an
  mtime older than the stamp (`cp -p`, `tar -x`). Probed end-to-end:
  `npm run probe:watch`. The native-ext4 migration of the remaining fs operations
  stays with Phase 3 of the plan.
- **Phase 1 of the Remote-WSL parity plan (`docs/PARITY.md`): the resident in-distro
  agent.** `agent/wsl-agent.sh` is a dependency-free POSIX shell peer spawned once per
  distro; `lib/agent.js` owns the lifecycle (handshake, lazy start, idle shutdown, one
  rebuild, permanent fallback to the shipped one-shot `wsl.exe` path) and
  `lib/agent-protocol.js` the line protocol (base64 payloads, NUL-safe argv). Not wired
  into the seams yet — the executor and filesystem migrations are the next phases.
  Probed end-to-end against a real distro: `test/probe/agent.sh` (8 checks, including
  binary-safe payloads, an in-distro timeout kill, and a 2 MB single-line response).
  Unit tests cover the codecs and the lifecycle state machine with a fake transport.

### Added

- `docs/PARITY.md`: the plan to reach VS Code Remote-WSL-grade experience — a resident
  in-distro agent as the core, with the `fs` and `shell` seams migrated onto it and the
  current 9p/one-shot paths kept as the documented fallback — plus the Phase-0 contract
  audit that shaped it (watch is a coarse invalidation callback; search spawns the
  packaged ripgrep through `ctx.subprocess`, so the interception point is the
  `subprocess-wsl` subclass).

### Changed

- The package description is rewritten in Chinese to state what the plugin does first —
  it makes a WSL distro the session's execution environment — then covers the execution,
  UI, and sandbox aspects in one clause each.
- Chinese text now says “WSL 子系统” instead of “WSL 发行版”, the phrasing Chinese readers
  more commonly use for a WSL distro (`docs/README.zh.md` and the two archived Chinese
  documents; 99 occurrences).

## [0.1.10] - 2026-10-02

Metadata and one documentation addition. No behaviour change.

### Changed

- The package description now covers all four capabilities — commands, the file tools,
  the folder picker, the GUI terminal — and the confinement, instead of naming only two
  of them. It is the line npm shows under the package name in search results.

### Documentation

- The error table in `docs/ARCHITECTURE.md` states exactly what the model sees on a
  filesystem denial: the denial marker and the escalation hint, line for line. It also
  records why that makes `FS_OUTSIDE_DISTRO` worth its own code — a code the tool layer
  does not decorate with those lines.


## [0.1.9] - 2026-10-02

The last test gap from the closure review: the documented opt-out. No runtime change.

### Added

- `npm run probe:sandbox-off` turns the sandbox off on **both** providers and asserts
  what the documentation promises: `sandboxMode` disappears on each of them, a command
  outside any workspace root runs, the shell result claims no sandbox, and a filesystem
  write outside the workspace root is not fenced (`operation=create`). Without it the
  opt-out and a backend that is merely broken would look alike from the outside — which
  is what `probe:missing-wsl` covers. 5 checks.


## [0.1.8] - 2026-10-02

A probe assertion for the one item the closure review had to record as unverifiable.
No runtime change.

### Added

- `npm run probe:sandbox-shell` asserts that a command past its deadline is reported as
  timed out **and leaves no process behind in the distro** (15 checks, up from 13). The
  escalated path is used on purpose: a confined command also dies with its `bwrap`
  parent, so only the unconfined path shows whether the subprocess service's kill
  actually reaches the distro. It does — measured through `ctx.shell` here, and
  directly by killing a `wsl.exe` relay and watching the distro-side `sleep` disappear
  with it (1 process before, 0 after).

### Documentation

- The review's "unverified: orphaned processes after a timeout" item is closed. The
  earlier attempt could not see the process at all, and said so: the agent's own shell
  ran in a separate PID namespace, where `ps` cannot see the distro's processes.


## [0.1.7] - 2026-10-02

One correctness fix and the error-code reference the closure review asked for.

### Fixed

- A command whose working directory could not be entered was reported as a success.
  `wsl.exe --cd <missing>` does not fail: it writes a relay error to stderr, runs the
  command in `/`, and exits 0 — measured directly, and visible in the shell probe's own
  transcript. A build or a write could therefore act on the wrong tree while every
  signal said it worked. `WslShellExecutor` now matches that relay line and fails with
  the directory and the fallback. Both markers are required (the relay prefix and
  `CreateProcessCommon`), so a command printing its own `chdir(...)` message cannot be
  mistaken for it; the matcher also finds the line when it arrives UTF-16 encoded.
  `npm run probe:sandbox-shell` asserts the behaviour end to end, and
  `test/shell.test.mjs` covers the matcher, including a false-positive case.
- The shell probe's own setup ran into this on the first run: it created the workspace
  root while that not-yet-existing root was its workdir, which had "worked" only because
  `mkdir -p` takes an absolute path. The setup now runs from the distro home, and the
  new assertion pins the failure it used to hide.

### Documentation

- `docs/ARCHITECTURE.md` gains an **Error codes** table: what raises each `FS_*` code
  and `SANDBOX_UNAVAILABLE`, what each one means, and what clears it — including that
  `FS_OUTSIDE_DISTRO` cannot be lifted by a wider permission. It also documents the two
  failures that come from `wsl.exe` itself: a missing, stopped or unregistered distro (a
  `WSL_E_*` code on stdout, UTF-16 on some builds, with an empty stderr) and an
  unenterable working directory. Both READMEs' troubleshooting tables now point at it.
- `docs/LIMITATIONS.md` separates the two workdir cases a deleted directory can produce:
  the bind that bubblewrap refuses, and the directory that cannot be entered.


## [0.1.6] - 2026-10-02

Three probes that close coverage gaps a closure review named, the documentation of a
`/tmp` asymmetry, and one clearer error message. No behaviour changed otherwise.

### Added

- `npm run probe:picker` drives the directory picker in a throwaway boot: the root
  level's crumbs, the Windows home, every installed distro, the documented
  `directory-unreadable` refusal for a relative path and for a directory that does not
  exist, and `maxEntries` with its `truncated` flag. Nothing ran `lib/picker.js` before
  this — the unit tests import only `lib/listing.js`.
- `npm run probe:missing-wsl` boots a profile whose `wslPath` cannot start and pins how
  that is reported: the executable is named, `wslPath` is suggested, the failure is not
  dressed up as a sandbox refusal, and no sandbox facts are claimed for a command that
  never ran. The other fail-closed state — `wsl.exe` works but the distro has no
  `bubblewrap` — is asserted in `test/sandbox.test.mjs`, which drives
  `WslSandbox.confine` against a failing probe, because driving that end to end needs a
  distro without `bubblewrap`.
- `npm run probe:mode` runs `test/probe/mode-probe.mjs`, which measures which POSIX-mode
  facts survive the share. The file was cited by `docs/LIMITATIONS.md` and wired into
  no script at all.
- `test/preset-choice.test.mjs` covers the session-preset decision, now that the rule
  is the pure `lib/preset-choice.js`. The frame timing that applies the decision still
  needs the harness, and the test says so.

### Changed

- `runCapture` names the cause when the executable itself cannot start: the message now
  points at `wslPath` and at WSL being installed, the same way it already did for a
  token denied by the Windows sandbox. `npm run probe:missing-wsl` asserts it.

### Documentation

- `docs/LIMITATIONS.md` states the `/tmp` split: a confined command's `/tmp` is a fresh
  tmpfs while the file tools' fence grants the distro's *real* `/tmp`, so both sides can
  write but neither sees the other's files. Hand a file between them through the session
  workspace. `docs/ARCHITECTURE.md` describes the same distinction where it explains the
  fence, including why the Windows temp directory is deliberately not granted to a
  distro session.


## [0.1.5] - 2026-10-02

Three defects from a design-closure review. Two are cases where a documented remedy
could not work, and one where the cause of a failure was invisible.

### Fixed

- A failed sandbox probe was remembered for the process lifetime, so installing
  `bubblewrap` after the app had started changed nothing until a restart — while the
  error told the user to install exactly that. Only a success is cached now; a failure
  is re-probed on the next command, and concurrent first commands share one probe. The
  policy lives in [`lib/probe-cache.js`](lib/probe-cache.js), which is pure, so the
  regression is pinned on every platform including CI
  ([`test/probe-cache.test.mjs`](test/probe-cache.test.mjs)).
- `restrictToDistro` refused another distro's share with `FS_SANDBOX_DENIED`. The
  file-tool layer turns that code into a denial marker plus an escalation offer
  (`mapError` in `dsh-tool-fs`), and no wider permission can lift this fence: it is a
  configuration choice, not a sandbox decision. It now reports `FS_OUTSIDE_DISTRO`,
  which the tool layer passes through unchanged, and the message says what to do.
- A command that never started because the distro was missing, stopped or
  unregistered reached the model as a bare non-zero exit. `wsl.exe` writes
  `Wsl/Service/WSL_E_DISTRO_NOT_FOUND` to **stdout** — UTF-16LE on some builds — with
  an empty stderr, so every signature in the plugin missed it. `WslShellExecutor` now
  reads that code (NUL-stripped, so either encoding is found), pins `WSL_UTF8` on its
  own spawn so the text is readable, and fails with the distro name and the remedy.
  Deliberately not a sandbox code: a wider permission cannot create a distro.

### Documentation

- Two statements were wrong and are corrected against measurement. `read-only` does
  not leave `/dev/null` as the only writable path: `bwrap --dev /dev` mounts a fresh
  `/dev`, so `/dev/shm` is writable scratch and only `/tmp` stays read-only. And
  `restrictToDistro` does not refuse `/mnt/c`, which is a directory *inside* the
  distro — it refuses another distro's share.
- The shell row's inherited output budgets (`maxOutputBytes`, `maxSpillBytes`,
  `graceMs`) are listed in [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md); the
  fail-closed bullet in [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) matches the
  re-probing behaviour, and what the file tools do when a distro stops mid-session is
  stated there too.

### Changed

- `test:unit` gained `test/probe-cache.test.mjs` and `test/sandbox.test.mjs`;
  `test:coverage` gained the pure one. The sandbox test skips itself where the
  `dsh-sandbox` peer is absent, which is the CI case, and
  [`CONTRIBUTING.md`](CONTRIBUTING.md) explains when a test belongs in which list.


### Fixed

- A shell request that names its workdir only **relatively** now lands on the
  distro user's home, joined under it, when no `cwd` is configured — instead of
  riding on the parent's `process.cwd()` fallback, a Windows directory no
  `wsl.exe --cd` accepts. The empty-workdir case already defaulted to the home;
  the relative tail was the one shape the marker missed. Absolute workdirs in
  any coordinate system are unchanged.
- A Windows UNC path outside the WSL share (`\\server\share\...`) is now
  treated as the world path it already is, instead of being joined onto the
  default workdir as if it were relative — which named a file that existed
  nowhere. It also no longer triggers a `wsl.exe` home query it can never need:
  `isRelativeWorldPath` now reports every UNC form, WSL or not, as absolute.

## [0.1.4] - 2026-10-02

Documentation only: a shorter README, and the reference documents it links to.

### Changed

- The README is a quick start now, and nothing else: install, use, configure, the
  sandbox in brief, troubleshooting, development, and an index of the documents. It
  went from 232 lines to 124. Everything that was not part of getting the plugin
  running moved to the document it belongs to — the full configuration table to
  [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md), the limitations to
  [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md), the file layout to
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (the two design rationales were
  already there), and the verification list to
  [`CONTRIBUTING.md`](CONTRIBUTING.md). The Chinese README was rewritten to match,
  section for section, and still does.
- `docs/CONFIGURATION.md`, `docs/LIMITATIONS.md` and `docs/ARCHITECTURE.md` ship in
  the tarball, so a package consumer has the configuration reference and the honest
  list of limitations without the repository.

## [0.1.3] - 2026-10-02

Repository and release engineering. No runtime behaviour changed.

### Added

- `npm run lint:style` ([`test/style.mjs`](test/style.mjs)): a dependency-free gate
  over the rules `.editorconfig` states, plus three packaging checks — every `files`
  entry still matches tracked content, every `exports` target exists, and exactly one
  readme candidate sits at the package root. That last one is the regression guard
  for the 0.1.1 readme, and it is why the gate exists at all.
- `npm run test:coverage`, with thresholds of 85% lines, 85% branches and 70%
  functions, using Node's built-in coverage. No coverage dependency was added. The
  spawning half of `lib/wsl.js` and the four service modules are covered by the
  probes instead, which is why the function threshold is lower than the others.
- `.github/workflows/release.yml`: a `v*` tag is checked against `package.json`
  ([`scripts/check-release-tag.mjs`](scripts/check-release-tag.mjs)), gated, then
  published with `--provenance` through npm trusted publishing, and the GitHub
  Release is created from the changelog section
  ([`scripts/changelog-section.mjs`](scripts/changelog-section.mjs)). No npm token is
  stored in the repository.
- The governance files a public repository is expected to carry:
  [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md),
  [`SUPPORT.md`](SUPPORT.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md),
  `CODEOWNERS`, a pull-request template, bug-report and contact-link issue templates,
  and a Dependabot configuration for the pinned workflow actions.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the plugin as it is
  today — the providers, how they are mounted, the three path coordinate systems, the
  sandbox, the runtime mirror and the test layers — so the current design no longer
  has to be reconstructed from a changelog and a historical record.
- [`docs/RELEASING.md`](docs/RELEASING.md): the release checklist, including the
  operational facts that cost time to learn.
- [`docs/archive/README.en.md`](docs/archive/README.en.md): an English index of the
  Chinese archive.
- `.nvmrc` names the Node version the coverage job uses.

### Changed

- The probes no longer carry a user name, a home directory or a distro name.
  [`test/probe/env.sh`](test/probe/env.sh) derives them from the machine
  (`%USERPROFILE%`, `%LOCALAPPDATA%`, `WSL_DISTRO_NAME`) and
  [`test/probe/env.mjs`](test/probe/env.mjs) does the same for the Node-side probes,
  which learn their own location from `import.meta.url`. The YAML overlays are now
  templates with `@NAME@` placeholders, and the scripts substitute real values into
  generated copies that `.gitignore` keeps out of the tree. The two profile layers
  use `distro: ''` (WSL's default distro) instead of naming one.
- CI runs the unit suite on Windows as well as Linux. The plugin targets Windows, and
  the Windows legs also prove that the LF guarantee in `.gitattributes` holds on the
  platform whose default is CRLF. The workflow gained least-privilege `permissions`,
  a `concurrency` group, timeouts, and actions pinned by commit SHA.
- `package.json`: `packageManager` is gone, because the package has no dependencies
  and npm is the reference toolchain everywhere else; `author` and `publishConfig`
  are set; `prepublishOnly` runs the gates; and `files` ships `CONTRIBUTING.md`,
  `SECURITY.md` and `SUPPORT.md` so a tarball without the repository still says how
  to contribute, report and get help.
- Both READMEs gained a *Contributing and support* section, and list the new gates.

### Fixed

- Corrected the 0.1.2 entry. It had named the npm CLI's readme rule as the cause of
  the 0.1.1 readme mix-up; that rule does not match `.md` names and is not the code
  path that decides a published package's readme, so the entry now records what was
  observed instead of a mechanism that does not hold. The GitHub Release notes for
  v0.1.2 were corrected the same way.
- Six lines in [`lib/index.js`](lib/index.js) were indented with tabs while the rest
  of the file uses spaces, which the new style gate caught.

## [0.1.2] - 2026-10-02

### Fixed

- The npm package page rendered the Chinese README instead of the English one. 0.1.1
  published `README.md` and `README.zh.md` side by side, and the registry answered
  with `readmeFilename: README.zh.md`. Two candidates are enough to make the outcome
  unreliable, and neither obvious rule explains which one won: it is not the tarball's
  entry order (0.1.1's tarball listed `package/README.md` first), and it is not the
  npm CLI's own selection rule (`@npmcli/package-json/lib/normalize.js` globs
  `{README,README.*}` and accepts `/\.m?a?r?k?d?o?w?n$/i`, which does not match a
  `.md` name at all). The registry is picking by a rule this repository should not
  depend on. The translation now lives at `docs/README.zh.md`, which leaves exactly
  one candidate at the package root and removes the question by construction. The
  English header still links to it and `files` still ships it. 0.1.1 remains on the
  registry with the wrong readme; 0.1.2 supersedes it.

## [0.1.1] - 2026-10-02

Documentation only: the README was reorganised for readers and translated into Chinese. No code changed.

### Added

- A Chinese translation of the README, [docs/README.zh.md](docs/README.zh.md), linked from
  the English header (and back). It is a translation, not the second README that
  was removed earlier: that file's problem was genre — it called itself the current
  description while contradicting the English one — whereas these two say the same
  thing section for section, and the English file remains the only statement of
  current state. The Chinese text also ships in the package (`files`), so the
  tarball is readable in either language; npm still renders `README.md`.

### Changed

- The README is reorganised around a reader's path instead of the design log's:
  "What you get", then Install, Using it, Configure, Sandbox, Troubleshooting —
  with the two architecture essays moved to *Design notes* at the end. It gains
  CI/npm/license badges, a section index, a one-paragraph example session, the
  upgrade command, and a nine-row troubleshooting table. The Configure table was
  re-checked against the schemas: it now labels which values the shipped patch sets
  and which are schema defaults, and no longer omits `timeoutMs`/`maxTimeoutMs`
  or `maxEntries`.
- The Chinese README was rewritten in plain technical Chinese. The first pass was
  dense and literary — comma-spliced clauses, dash-heavy sentences, and calques
  such as 能力事实, 布防 and 围栏 used as a verb — which is what makes a translated
  document hard to read even when it is accurate. It now averages 61 characters per
  sentence, keeps the English term beside the Chinese where the term matters
  (`enforcement`, `escalation`, `interop`), and turns the paragraphs that packed
  three probes or three facts into one sentence into lists. The section names are
  plainer too (能做什么 / 使用 / 常见问题 / 设计说明). Nothing factual changed: the
  two READMEs still match section for section.
- The English README then got the same treatment, once the Chinese rewrite made the
  problem obvious in both languages. A single "what has been verified" sentence ran
  to 125 words; the sandbox section explained itself with asides ("and that is the
  honest part", "stated rather than papered over"); and terms such as *composition*,
  *capability fact*, *isolate realm* and *fence* (as a verb) appeared before they
  were explained. The prose now averages 15 words a sentence with a 42-word maximum,
  the verification list is a list, and each term is glossed where it first appears.

## [0.1.0] - 2026-10-02

First release. A WSL distro can be picked as a workspace, read and written
with the model's own file tools, and run commands in; the GUI terminal opens
inside it; commands are confined by a Linux-side sandbox built in the distro;
and the package installs as a bundle that contributes its own profile layer.

### Added

- **Distro-side sandboxing** (`lib/sandbox.js`, and `sandbox: true` on both
  providers): WSL commands are now confined instead of running unconfined. The
  Windows ACL runner can never reach WSL — its restricted token fails `wsl.exe`
  with `Wsl/E_ACCESSDENIED` — so the confinement is built on the host and
  executed *inside* the distro: `wsl.exe … --exec bwrap --ro-bind / / --dev /dev
  --unshare-pid --proc /proc --die-with-parent [--tmpfs /tmp --bind <workspace>
  <workspace>] -- <shell> -lc <cmd>`. The profile arguments, the denial dialect
  (`read-only file system`) and the runner-failure rules mirror
  `@deepseek-ai/dsh-sandbox-local`'s Linux rung, so a denial reads the same
  whether the command ran on a Linux host or in a distro. `WslShellExecutor` and
  `WslFileSystem` advertise the mode through their `sandboxMode` capability fact,
  which brings back the Permissions selector and the denied→escalate flow
  (`danger-full-access` skips the wrap entirely). Enforcement is reported as
  **`partial`**, not `full`: a distro process can still execute a Windows binary
  through interop, which bubblewrap does not govern — measured, not assumed, by
  the probe below. Without `bubblewrap` in the distro the providers fail closed
  with `SANDBOX_UNAVAILABLE`; `sandbox: false` restores the old posture and
  removes the capability fact with it.
- Sandbox probes. `test/probe/sandbox.sh` (`npm run probe:sandbox`) needs no
  harness: it applies the exact profile arguments and asserts what bubblewrap
  governs — a write outside the workspace refused with EROFS, an ephemeral
  sandbox `/tmp`, a read-only `/mnt/c`, and the interop escape, recorded as
  `INFO` because a Linux sandbox cannot govern a Windows process.
  `test/probe/sandbox-shell.sh` (`npm run probe:sandbox-shell`) boots the
  throwaway profile with the executor mounted and drives the same three modes
  through `ctx.shell`, asserting the result's `denied`/`enforcement` facts.
- `WslSubprocessRuntime` (`ctx.subprocess`, subpath
  `dsh-plugin-wsl-env/subprocess`): the GUI's right-sidebar terminal window now
  opens a shell *inside the distro*, in the Session workspace, instead of
  `cmd.exe` in a UNC directory. It is a `LocalSubprocessRuntime` subclass whose
  only override is `spawnTerminal`, so every ordinary command, the host ripgrep
  search and every other subprocess consumer keeps the shipped implementation.
  The `wsl.exe` launch is rewritten to `wsl.exe -d <distro> --cd <linux dir>`,
  with the request's `DSH_*` facts forwarded through `WSLENV`, and the distro's
  own login shell is left to `wsl.exe` unless the provider pins one.
- Terminal probe (`test/probe/terminal.sh`, `npm run probe:terminal`): boots the
  throwaway Web profile with the provider in place, asks for the same
  `spawnTerminal` request the GUI makes, and asserts the distro, the translated
  initial directory, and the forwarded `DSH_SESSION_ID`.

- `WslShellExecutor` (`ctx.shell`): runs every command inside the distro as
  `wsl.exe -d <distro> --cd <linux dir> --exec <shell> -lc <cmd>`, where the
  shell is the distro user's login shell rather than a hardcoded bash. (§3, §12)
- `WslFileSystem` (`ctx.fs`): maps Linux paths onto the distro's UNC share so the
  host fs stack — including the packaged ripgrep — operates on real distro files,
  with Linux paths as the model-facing `displayPath` and the UNC path as the
  opaque `targetKey`. (§3)
- Symlinked paths resolve by asking the distro for `readlink -f` and retrying
  once, which is what makes `/etc/os-release`, `/bin` and `/lib` readable over a
  share that cannot traverse POSIX symlinks. (§10.4)
- `WslDirectoryPicker` (`ctx.directoryPicker`): lists Windows home and every
  installed distro at the root level, so the shipped GUI dialog becomes the
  single workspace picker for host and distro folders alike. It reports
  `kind: 'browse'` — a third kind would invalidate the three Remote verbs that
  require it. (§8)
- `auto-preset`: binds the `wsl` agent preset when a new session's workspace is
  inside a distro, inside the `ensureSession` frame so the very first mount is
  already correct and the host ACL sandbox never touches a 9p path. (§13, §15)
- `shell-env`: contributes `DSH_WSL_DISTRO`, `DSH_WSL_SHELL` and `DSH_WSL_HOME`
  to the managed `DSH_*` namespace, so the model can read the real environment
  instead of inferring it from a tool name. (§14)
- Behavioural probe harness under `test/probe/`, with two throwaway profiles and
  a negative-control run. (§16.5)
### Changed

- `WslFileSystem` fences its mutations by `ctx.sandboxPolicy`: `writeText` and
  `editText` check the policy before any I/O, re-resolve the target so the checked
  identity is the mutated one, refuse `read-only` and anything outside the
  writable roots with `FS_SANDBOX_DENIED`, and refuse nothing at all under
  `danger-full-access`. The writable roots are the workspace plus the temp area of
  the world that workspace lives in — a distro workspace grants the distro's
  `/tmp`, a Windows-folder workspace keeps upstream's `/tmp` + `os.tmpdir()`.
  `@deepseek-ai/dsh-sandbox` returns as a peer: the plugin imports the shared
  `canonicalPath`/`writableRoots` and the runner-failure/diagnostic classifiers
  rather than restating them.
- The README's "one constraint that shapes everything" section is gone: it said
  the plugin inherits `sandboxMode === undefined`, which is no longer true. The
  replacement states the mechanism (Linux bubblewrap inside the distro), the mode
  table, the `partial` enforcement and its interop cause, the `bubblewrap`
  requirement and the fail-closed behaviour.
- An empty `cwd` now means **the distro user's home** in both WSL providers,
  instead of the host path the shipped default resolves to. `WslFileSystem`'s
  default was `process.cwd()` — a Windows directory no `wsl.exe --cd` accepts —
  and `cordis.patch.yml` papered over it with the author's own `/home/andy`, a
  value that is wrong on every other machine. `WslShellExecutor.resolve()` keeps
  the seam's synchronous contract (`ctx.shell.execute(ctx.shell.resolve(…))` is
  called with no `await` in between) and marks the case with an empty `workdir`;
  `execute()` fills it from the distro's `$HOME`, one cached `wsl.exe` query per
  provider instance. Only relative input consults the base at all, so an
  absolute path never pays for the query, and `DSH_WSL_HOME` now takes the POSIX
  home directly (`linuxHomePath`) instead of converting the world path back. The
  `wslfs` probe follows: its profile no longer pins a `cwd`, and `fs-probe.mjs`
  resolves a relative name and asserts it lands under the home the distro itself
  reports — which is the only place that fallback was reachable at all, since the
  tool layer always passes an absolute Session directory.
- The package is now a DSH **bundle**, so installing it applies the layer instead
  of merely dropping code into a profile. `package.json` declares
  `dsh.bundle.patch` → `./cordis.patch.yml`, which is the declaration
  `dsh plugin --profile <name> add dsh-plugin-wsl-env` reads; `private: true` is
  gone (npm refuses to publish it otherwise), and `repository`/`homepage`/`bugs`
  now point at the GitHub repository. The package is plain JS with no
  dependencies, so a published install needs no `allowBuilds` permission and no
  build step. README's Install section follows: create the profile from the Web
  template, `dsh plugin … add`, then `--dump-config`.
- `cordis.patch.yml` is now only the plugin's own layer. The four machine-local
  rows it used to carry — `agent-default-model`, `ui-settings-account`,
  `ui-chat`, `ui-settings` — moved to
  [examples/profile.cordis.patch.yml](examples/profile.cordis.patch.yml), which
  documents what a reader's own `$DSH_HOME/profiles/<name>/cordis.patch.yml` is
  for and what a by-id row override looks like.
- The terminal is bound at the **composition** level, not in the `wsl` preset.
  `dsh-api-terminal-controller` resolves its execution world with
  `agent.ctx.get("subprocess")`, and an Agent's context is created by the agent
  loop under the root realm (`createScope(loopCtx, …)`, `loopCtx` = the
  root-mounted `ctx.agents`), while a preset's isolate realms belong to
  `dsh-agent-preset-registry`'s own context (`createScope(this.owner, …)`). A
  `subprocess` provider inside `preset-wsl` is therefore invisible to the
  terminal window — the registry's `agentPresets.serviceFor(agent, name)` is the
  sanctioned channel for that gap, and the controller does not use it.
  `cordis.patch.yml` consequently disables the shipped `subprocess` row and
  inserts this provider, and configures `terminal-controller` with
  `shell: { path: wsl.exe, name: WSL }` and `shellCandidates: []`.
- `@deepseek-ai/dsh-subprocess-local` is now a declared peer. A linked plugin's
  bare imports are routed through its `peerDependencies` by the runtime's
  resolution interception, so an undeclared peer is not merely untidy — the
  module fails to import with `failed to import`.
- The README is now **current state only**. The five sections describing designs
  that this one replaced — the per-process `DSH_WSL` switch and the three
  abandoned tool-naming routes — moved to
  [docs/archive/design-history.zh.md](docs/archive/design-history.zh.md), which
  keeps their original numbering and records where each conclusion lives now.
  The README renumbered accordingly; its §0.1 explains the split. The one part of
  the old desktop section that is still current (regenerating the generated
  `preset-wsl` block after an app upgrade) stayed, as §13.9.
- Static review: the manifest now says only what the shipped code does.
  - `main` pointed at `lib/index.js` while `exports["."]` resolved to
    `lib/shell.js`. Only the latter exposes a default export, so a tool that
    read `main` instead of `exports` got a module with no plugin in it.
  - `lib/index.js` re-exported path helpers that nothing could reach: the
    `exports` map does not expose `lib/index.js`, and the helpers already have
    their own `./paths` and `./wsl` subpaths.
  - Dropped an unused `ENV_OVERRIDES` import.
### Known limitations

- The sandbox does not govern WSL interop: a confined distro command can still
  execute a Windows binary from `/mnt/c`, and that process runs outside
  bubblewrap under the ordinary Windows token. Enforcement is therefore reported
  as `partial`, and `npm run probe:sandbox` re-measures the escape. Closing it
  would mean denying execution under `/mnt`, which breaks `/mnt/c/…` Sessions.
- `bubblewrap` must be installed in the distro, and both providers **fail
  closed** without it (`SANDBOX_UNAVAILABLE` rather than a silent unconfined
  run). `sandbox: false` is the documented opt-out. A `workspace-write` profile
  also refuses to bind a workspace root that does not exist, so a Session whose
  workspace directory was deleted reports a runner diagnostic instead of being
  recreated.
- The GUI terminal is an interactive shell and is not wrapped in the sandbox,
  exactly like the shipped terminal provider.
- The runtime mirror's destination lies outside every Session workspace, so the
  sync step of `npm run probe` (and of a manual `sync-to-windows.sh`) needs an
  approved `danger-full-access` escalation when an agent runs it.
- The terminal follows the composition, not the Session: a Session whose
  workspace is a Windows folder gets the same distro terminal, started in that
  folder as `/mnt/<drive>/…`.
- Terminal activity reporting stops at `wsl.exe`, so the controller's unattended
  idle reclamation never fires for these terminals; close the tab to release the
  process.

See the archived record's §7 for the full list, including the 9p
performance caveat, unsupported `watch()`, and the missing executable bit on
freshly created files.
### Removed

- `docs/README.zh.md` stopped being a README: the file moved to
  `docs/archive/engineering-record.zh.md` and left the package's `files` list, so
  npm and GitHub now render exactly one README. The reasoning is under Fixed
  below; nothing was deleted, only renamed out of the slot that made it look
  current.
- Three peer declarations this plugin neither imports nor injects:
  `@deepseek-ai/dsh-sandbox`, `@deepseek-ai/dsh-shell` and
  `@deepseek-ai/dsh-tools`. They were required by the abandoned tool-renaming
  designs (archive §15/§18), which could only stub the sandbox symbols locally
  (archive §15.5). The remaining set is checkable in one command —
  `grep -rho 'from "@deepseek-ai/[^"]*"' lib/ | sort -u` — plus
  `@deepseek-ai/dsh-subprocess` (the service `static inject` requires) and
  `@deepseek-ai/cordis`, which every DSH plugin declares.
  (`@deepseek-ai/dsh-sandbox` came back in this same release: the distro-side
  sandbox imports `canonicalPath`/`writableRoots` and the runner diagnostics, so
  the declaration is earned again rather than vestigial — and that same check is
  what surfaced it, by listing the package this entry had removed.)
### Fixed

- `lib/listing.js` built breadcrumbs with the platform-default
  `dirname`/`basename` from `node:path` rather than the `win32` flavour its own
  comments describe. On Linux — where the CI runners run, and where this
  checkout itself lives — a UNC path parses as a single opaque POSIX segment,
  so the ancestry chain collapsed to `['.', <whole path>]` and three
  `test/listing.test.mjs` checks failed. The helpers serve Windows paths only;
  they now call `win32.dirname`/`win32.basename` explicitly, and the suite
  passes on Linux again.

Documentation that a reader would have acted on, and that was no longer true:

- The repository briefly carried two READMEs. `docs/README.zh.md` called itself the
  current description of the plugin while its conclusions had been superseded
  three times over — most sharply by the sandbox work below — which is exactly
  the ambiguity a second README creates. It is now
  [docs/archive/engineering-record.zh.md](docs/archive/engineering-record.zh.md):
  the same content, renamed out of the README slot and banner-headed as history,
  with README.md the single statement of current state. Nothing was deleted from
  the record; §0.1 names the conclusions that are now historical.
- §2.1 and §3.4 of that record conclude that "any WSL plugin must run on a
  non-sandboxing provider" and that both providers report `sandboxMode:
  undefined` (§9's recorded self-check prints exactly that). The Windows ACL
  constraint in §2.1 holds and is unchanged; the *conclusion* it drew about our
  own confinement does not, because the sandbox now runs inside the distro — see
  the README's *Sandboxing* section.
- §9.4's three-step install ends with writing the plugin's rows into the profile's
  own `cordis.patch.yml` by hand. The package is a bundle now, so that step is
  gone (and the row set it describes has since gained the sandbox config); the
  current install is in README.md.
- §9.6 and §10.5 claimed the `wsl` and `wsltest` profiles were still available,
  and §13.6 said the same about `envweb`. All three are gone.
- The desktop section documented the superseded `build-desktop-patch.mjs`
  regeneration flow instead of `build-preset-wsl.mjs`.
- §15.5 answered "nothing to do after an app upgrade" while the desktop section
  said the generated preset copy has to be regenerated.
- References to `dsh-wsl-research/` now say it is a machine-local directory that
  is not part of the repository.

- `wsl.exe` was handed the command without `--exec`, so the distro's default
  shell expanded it once first: `$x`, `$?`, `$(...)`, `${...}` and backticks were
  silently eaten. (§11)
- The shell was hardcoded to bash, discarding the PATH and rc setup of a user
  whose login shell is zsh, fish or dash. (§12)
- Guarded creation (`createIfAbsent`) failed with `FS_IO_ERROR`, because the host
  backend publishes it with a hard link and the share rejects hard links with
  `ENOTSUP`; the guard is now checked by this backend and publication is a plain
  rename. (§2.2)
- The managed `DSH_*` namespace never reached the distro. WSL imports only the
  names listed in `WSLENV`, and the executor forwarded a fixed allowlist; it now
  forwards the whole prefix, and marks the two Windows-path facts `DSH_HOME` and
  `DSH_PROFILE_DIR` with `/p` so the distro sees `/mnt/c/...`. (§14.7)
- **Every write to an existing file, and therefore every edit, failed** with
  `EIO: GetFileSecurityW EIO (Win32 1)`. `dsh-fs-local` takes a Windows branch
  whenever the destination exists — to inherit the replaced file's DACL — and a
  9p share carries no Windows security descriptor. Publication now uses the POSIX
  path. (§16)
- Overwriting or editing a file silently dropped its POSIX mode, so editing a
  script made it non-executable: the share ignores a host-side `chmod`, and a
  host-side `stat` always reports 0666. The target's real mode is now copied onto
  the staged temp file inside the distro, where a rename preserves it. (§16.3)
