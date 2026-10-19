# Submission payload: session-visible notice seam

Ready to file against `deepseek-ai/deepseek-harness`. **Not filed**: creating a
public upstream issue is a maintainer action; this file is the exact body so the
filing is one command.

- Repository: `deepseek-ai/deepseek-harness`
- Title: `Proposal: a session-visible notice seam for plugin advisories`
- Suggested labels: `enhancement`, `area:plugin` (adjust to the repository's
  current labels)

Command (from a checkout of this repository, with `gh` authenticated):

```bash
gh issue create --repo deepseek-ai/deepseek-harness \
  --title "Proposal: a session-visible notice seam for plugin advisories" \
  --body-file docs/upstream/proposal-session-notice.md
```

---

## Body

A plugin that discovers an environment problem at session start has no way to
tell the person looking at the session. The available channels in
`0.2.1-rc.2` are `ctx.logger.warn` (host log, invisible unless opened), a
runtime-context entry (model-visible, not a notification), and `agent/error`
(reserved for failures). There is no `ctx.notices`/toast service and no client
slot for one.

Concrete case: this repository's WSL plugin runs a session-start preflight for
`bubblewrap`, systemd PID 1, the user manager, `systemd-run` and Linger. A
failure is advisory — it must not fail the session or install anything — but it
is exactly the information the user needs *before* the first command fails
closed. Today the plugin publishes the advisory to the log and to a
session-scoped runtime-context entry; the GUI cannot render it as a banner.

Proposal: a small service plus a client slot, mirroring the approval service's
session-scoped contract:

```ts
interface SessionNotice {
  readonly id: string              // producer-owned; re-notifying replaces
  readonly level: 'info' | 'warning'
  readonly text: string
  readonly remedy?: string         // copy-paste fix
}
interface NoticeService {
  notify(session: Session, notice: SessionNotice): Promise<void>
  clear(session: Session, id: string): Promise<void>
}
```

Requirements: visible in the session before the first failed command;
session-scoped; severity + remedy; replaceable/dismissable (a fixed environment
must not keep the old warning); non-fatal (no turn cancelled, no tool result
changed). The host keeps the last value per `(session, id)` for reconnect and
replay.

Nothing here is model-facing: producers that also want the model to see the
advisory keep their runtime-context entry. The seam is presentational.

Full context, current workaround and the plugin's use of it:
`docs/UPSTREAM-SESSION-NOTICE.md` in
`Big-Dao/dsh-plugin-wsl-env`.
