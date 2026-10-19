# Upstream seam: LSP navigation for a WSL workspace

Status: researched, **prototype deferred** (2026-10-19). No user-facing claim is
made: the desktop composition does not mount `ctx.lsp` in `0.2.1-rc.2`, so
`lsp` is not a tool the model can call in this plugin's profiles today. This
note records what the seam is, what a WSL-backed provider would require, and
the trigger that turns the prototype back on.

## What exists upstream

The LSP capability is split across three packages in the harness tree
(`packages/lsp/`):

| Package | Role |
|---|---|
| `@deepseek-ai/dsh-lsp` | the `ctx.lsp` service and the provider registry; four read-only operations: `goToDefinition`, `findReferences`, `goToImplementation`, `hover` |
| `@deepseek-ai/dsh-lsp-stdio` | the generic stdio provider: a configured language-server command per workspace, transient document open, serialized queries |
| `@deepseek-ai/dsh-tool-lsp` | the model-facing `lsp` tool, which owns the one-based cursor convention |

It is an optional capability, not part of the agent-loop spine: a composition
must mount the seam, a provider, and the tool; none are in the base profile.

**Checked against `dsh-v0.2.1-rc.2`:** the desktop's
`@deepseek-ai/dsh-base/cordis.patch.yml` (the app's bundled base layer) has no
`lsp` row, and `packages/bundle/*` reference neither `dsh-lsp` nor
`dsh-tool-lsp`. The packages exist and are test-covered upstream, but a
stock desktop session has no LSP surface.

## The pairing the provider assumes

`dsh-lsp-stdio` declares `inject = ['fs', 'lsp', 'subprocess']`: source files
are read through `ctx.fs`, and the language server is spawned through
`ctx.subprocess`. Both must describe **the same execution world**:

- the server's executable is resolved with `ctx.subprocess.resolveExecutable`
  and spawned with `ctx.subprocess.spawn`;
- the queried source is read through `ctx.fs`, which also produces the
  `fileUrl` sent as the transient document's URI;
- `workspaceRoot` is caller-supplied and canonicalized by the provider.

In a WSL session, `ctx.fs` (the preset's isolated `wsl-fs`) and `ctx.subprocess`
currently describe **different worlds**: the filesystem is the distro's, the
subprocess seam is the host's. The plugin's preset isolates `shell` and `fs`
only; the app-level `subprocess-wsl` row exists for the GUI terminal and is not
preset-scoped. Mounting `dsh-lsp-stdio` in the WSL preset today would therefore
launch a Windows language server against distro source and send it URIs it
cannot open.

## What a WSL-backed provider needs

1. **A preset-scoped `subprocess` implementation.** `resolveExecutable` and
   `spawn` must run inside the distro (argv, cwd, env in Linux coordinates),
   with the same lifetime rules as the shell executor's commands. This is the
   largest piece and has no upstream seam today; the terminal's
   `subprocess-wsl` is a different, app-level consumer.
2. **URI and path translation.** The server's world is `file:///home/...`;
   the harness workspace identity is the UNC target
   (`\\wsl.localhost\<distro>\...`). The provider/tool boundary must translate
   both directions (request source, `workspaceFolders`, returned locations),
   or the seam must gain a path/URI adapter instead of providers doing it
   ad hoc.
3. **Confinement and lifecycle.** A language server is a long-lived child of
   the session: it should run under the same sandbox policy as commands
   (`bwrap`), die with the session, and be subject to the same idle reclaim as
   the resident agent. "Same execution world" also implies the server sees the
   workspace at the same `/home/...` path the commands see.
4. **Configuration per distro.** The `servers` record (id → command, extension →
   language id) and executable resolution belong with the session's distro, not
   the host profile: the same `typescript-language-server` may exist in one
   distro and not another.

## Prototype decision

**Deferred, with a trigger.** The prototype cost is dominated by item 1 (a
preset-scoped subprocess provider) and the tool surface does not exist in the
shipped composition, so building it now would produce an unreachable code path.
Revisit when any of these happens:

- the desktop/base composition mounts `dsh-lsp` + `dsh-lsp-stdio` +
  `dsh-tool-lsp` (the tool becomes reachable);
- upstream proposes a preset-scoped subprocess provider or an fs/URI adapter
  for providers;
- a user asks for semantic navigation in a WSL workspace and accepts the
  dependency on one of the above.

Then, in order: a fake stdio language server running **inside the distro**
through the new subprocess provider (unit-level), a real
`typescript-language-server` probe on a Tier 1 image, and only then a docs
claim. Until that proof exists, the plugin's README and ROADMAP say nothing
about LSP support.
