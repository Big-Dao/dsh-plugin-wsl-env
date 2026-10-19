# Upstream proposal: a session-visible notice seam for plugin advisories

Status: proposed upstream; **not filed yet** — this environment has no issue
channel, so the text below is ready for the maintainers to file against
`deepseek-ai/deepseek-harness` (version line `0.2.1-rc.x`; the gap was checked
against `dsh-v0.2.1-rc.2` on 2026-10-19). The exact filing payload (title, body,
command) is [proposal-session-notice.md](upstream/proposal-session-notice.md). The plugin ships the workaround
described at the end: the advisory goes to the log **and** into the session's
runtime context, which is model-visible and appears in the session transcript,
but is not a dedicated banner.

## The gap

A plugin that discovers an environment problem at session start has no way to
tell the person looking at the session. The available channels are:

- `ctx.logger.warn(...)` — the host log. A user who never opens the log never
  sees it; `docs/LIMITATIONS.md` records this boundary.
- a runtime-context entry (`ctx.systemPrompt.context(...)`) — model-visible,
  reaches the transcript on the next assembly, but is not a notification and
  has no dismissal or severity semantics.
- `agent/error` — reserved for failures; an advisory that must never fail a
  session cannot use it.

There is no `ctx.notices`/`ctx.ui`/toast service in `0.2.1-rc.2`, and no
client slot for one. The plugin's `wsl-preflight` therefore warns into the log
and the runtime context, and the full check is `pnpm run doctor`
([`scripts/doctor.mjs`](../scripts/doctor.mjs)).

## What an advisory needs

`wsl-preflight` runs when a distro session opens. Its findings are advisory:
a missing `bubblewrap`, a distro without systemd, a missing `systemd-run`, or a
user manager without Linger. None of them may fail the session — the first
command fails closed on its own if it must — and none may install anything.
What the author needs is exactly what the rule says:

- **visible in the session** before the first failed command, not only in the
  log;
- **associated with a session**, so the notice appears in the session that
  triggered the probe (two sessions on two distros can see different notices);
- **severity and a remedy**, so the UI can render a warning with a
  copy-pasteable fix rather than a bare string;
- **disposable**, since a probe re-runs and a fixed environment must not keep
  the old warning forever;
- **non-fatal**: no turn is cancelled, no tool result is changed.

## Proposed shape

A small service plus a client slot, mirroring the approval service's
session-scoped contract:

```ts
/** One session-scoped advisory. */
interface SessionNotice {
  /** Stable producer-owned id; re-notifying replaces by id. */
  readonly id: string
  /** `info` or `warning`; errors stay on `agent/error`. */
  readonly level: 'info' | 'warning'
  /** One-line text and an optional copy-paste remedy. */
  readonly text: string
  readonly remedy?: string
}

interface NoticeService {
  /**
   * Show or replace one notice for a session. Rejects when the session is
   * not open; the producer owns the id and can dismiss it with `clear`.
   */
  notify(session: Session, notice: SessionNotice): Promise<void>
  /** Remove a notice the producer published earlier. */
  clear(session: Session, id: string): Promise<void>
}
```

The client renders notices in the session header or above the composer with a
dismiss control; the host keeps the last value per `(session, id)` so a
reconnect and a replay agree. Nothing is model-visible unless the producer
also adds a runtime-context entry, which keeps this seam purely presentational.

## What this plugin would do with it

`wsl-preflight` would publish one `SessionNotice` per verdict (`id:
"wsl-preflight"`, `level: "warning"`, `text` = the one-line finding, `remedy` =
the existing copy-paste command or `/etc/wsl.conf` change), replace it on the
next verdict, and `clear` it when the probe passes. The runtime-context entry
would stay as the model-facing half; the notice would be the human-facing one.

## Workaround until it lands

- `ctx.logger.warn` carries the full remedy.
- A session-scoped runtime-context entry (`wsl-preflight`) repeats it in the
  transcript, so it is visible to the model and in the context snapshot.
- `pnpm run doctor` is the deterministic, human-facing check; its `--json`
  output is the issue-template ask.
