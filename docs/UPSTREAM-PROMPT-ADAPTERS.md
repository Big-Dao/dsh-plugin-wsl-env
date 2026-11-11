# Upstream prompt adapters

*Status: temporary plugin-side adapters, 2026-11-11. Host line: DeepSeek Harness
0.2.2-rc.1. Remove each adapter once its upstream issue ships, then re-run the
prompt checks and the WSL probe suite.*

The plugin can present the WSL session correctly without waiting for the host,
because the host's generic prompt facts are written for a Windows workspace. The
adapters are deliberately narrow: each either replaces a host contribution or
adds one sentence, and each names the upstream change that retires it. See `src/cwd-prompt.ts` for the implementation and `test/cwd-prompt.test.mjs`
for the pinned behavior.

## 1. Shell note (`wsl:shell`)

**Adapter.** One system-prompt section after `tool:bash` says commands run in the
distro's login shell with `-lc`, not necessarily bash, and that `~/.bashrc` is
not read. It names `$DSH_WSL_SHELL` as the exact-shell source.

**Why.** The host's `dsh-tool-bash` hardcodes the tool name `bash` and the
description `bash -c`; a WSL preset actually runs the distro user's login shell
(e.g. `zsh -lc`). See [LIMITATIONS](LIMITATIONS.md#shell-startup-semantics-wsl-shell).

**Upstream issue.** `dsh-tool-bash` should consume `ShellExecutor.shellName()` and
derive the model-facing tool name and description from the mounted executor. The
longer-term rename is `dsh-tool-shell`: a POSIX-shell package named `shell`
(model tool `shell`, actual shell in the description), with
`dsh-tool-bash` kept as a compatibility alias. The package name and the
model-facing tool name are separate decisions: the latter is what the model
reads, so both must move together. The plugin deletes this section after the
short-term change ships.

## 2. POSIX policy (`sandbox:policy`)

**Adapter.** A session-scoped `sandbox:policy` context replaces the host line. It
reads `ctx.sandboxPolicy.resolve({ session })`, converts the workspace and any
additional writable roots to POSIX, omits anything without a POSIX spelling, and
adds the conditional partial-enforcement note. No UNC or Windows path is printed.

**Why.** The host renders `workspaceRoot` verbatim; a WSL workspace is a
`\\wsl.localhost\...` UNC. Its policy line also omits the plugin's `partial`
enforcement (WSL interop is outside bwrap). The model should not need to translate
a coordinate system or infer isolation the plugin does not provide.

**Upstream issue.** `dsh-sandbox-policy` should accept/render an execution-world
display path from the provider (POSIX for the WSL preset) and carry the
provider's `enforcement` fact. The adapter lists the host policy's
`additionalWritableRoots` and omits every non-POSIX spelling; the plugin rows'
own `writableRoots` are not part of that host policy, so the upstream contract
also needs the provider's effective writable roots. The plugin deletes this
replacement after that ships.

## 3. Host source (`harness:source`)

**Adapter.** A session-scoped empty `harness:source` section and context shadow
the host values in a WSL session. Nothing is printed.

**Why.** The host names the installed `app.asar` path (`C:\...`) as an
"implementation checkout" and tells the model it may inspect or extend it. In a
WSL session that path is a Windows path, not a readable source checkout; the
model gains nothing from it and may spend calls proving it.

**Upstream issue.** `dsh-harness-dev-context` should detect a packaged
installation and either omit the value or label it as a packaged installation.
The plugin deletes the shadow after that ships.

## 4. Preflight notice (`wsl-preflight`)

**Adapter.** Only a blocked preflight verdict is published as a runtime-context
entry, with its remedy marked as operator action. A ready verdict is log-only.

**Why.** DSH 0.2.1 has no session-notice seam; the runtime context is the only
visible channel. A ready verdict is not an action, so it is noise.

**Upstream issue.** A session notice seam would let the blocked advisory leave
the model's durable context. See
[UPSTREAM-SESSION-NOTICE.md](UPSTREAM-SESSION-NOTICE.md). The plugin then drops
the runtime-context entry.

## Explicit diagnostic exception

`wsl_doctor` is not injected proactively. When the user explicitly asks for a
host diagnosis, its report may name Windows paths for the host-owned checks
(`.wslconfig`, the Windows git trust, and similar). That output is the
diagnostic subject, not prompt context; the adapter set above keeps the
proactive prompt POSIX-only.
