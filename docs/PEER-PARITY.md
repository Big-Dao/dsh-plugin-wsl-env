# Peer parity — the fsio replication, verified

The agent substrate's text mechanics (`lib/fsio-text.js`) and its provider
orchestration messages (`lib/fs-substrate.js`, `lib/fsio-agent.js`) are a
deliberate replica of the pinned peer's fsio module, so the model reads the
same refusal dialect on both substrates. The **read path** holds end to end;
the **edit path** carries two declared divergences, listed at the end. This
file records the verification against the real peers.

- Peers: `@deepseek-ai/dsh-fs-local@0.2.2-rc.1` (the exact version the
  devDependencies pin, and the floor the peer range `>=0.2.2-rc.1` was
  verified against), plus `@deepseek-ai/dsh-fs@0.2.2-rc.1` for the
  `FsVersion` brand the local package imports. Divergence 2 is measured
  against a third peer, `@deepseek-ai/dsh-bash-local@0.2.2-rc.1` — the shell
  executor carries the collect-budget/spill machinery; `spill` and
  `maxSpillBytes` do not appear in `dsh-fs-local` at all.
- The `0.2.2-rc.1` move grows `dsh-fs-local`'s shipped `lib/index.js` from 909
  to 1048 lines (patch/move/delete operations, `expandHomePrefix`, `writeIoError`,
  multi-key locks), so every line reference below was re-walked on 2026-11-05.
  Every replicated string survived verbatim; the fsio **read path** holds end
  to end and the **edit path** carries the same two declared divergences, listed
  at the end. The release also added a `FS_ERROR_CODES` const export with two
  new codes (`FS_PATCH_MISMATCH`, `FS_SAME_TARGET`) for operations this plugin
  does not serve — see the new-peer-operations section at the end.
  `dsh-bash-local@0.2.2-rc.1`'s `lib/index.js` is byte-identical to
  `0.2.1-rc.3`'s (only manifests and locale files changed), so its references
  stand. `dsh-fs@0.2.2-rc.1` still has no `./invariant` export subpath; this
  plugin imports neither it nor `dsh-invariants`.
- What "not imported" means: the peer's **fsio module** is not reachable from
  the package's exports, so `lib/fsio-text.js` reimplements it and imports
  nothing from it (the export is proposed in `docs/UPSTREAM-FSIO-EXPORT.md`).
  The peer **packages** are ordinary build-time imports that stay in the
  shipped artifact — `lib/fs-routing.js` and `lib/index.js` both import
  `LocalFileSystem` from `@deepseek-ai/dsh-fs-local`, and `lib/index.js` also
  imports `FsError` from `@deepseek-ai/dsh-fs`. Neither dependency is
  removable.
- Method: `npm pack` both pins, confirm the bytes, extract, and compare the
  shipped `lib/index.js` (unminified ESM) function-by-function and
  string-by-string against this repository.

```sh
mkdir -p /tmp/peer-audit && cd /tmp/peer-audit
npm pack @deepseek-ai/dsh-fs-local@0.2.1-rc.3 @deepseek-ai/dsh-fs@0.2.1-rc.3 --pack-destination .
openssl dgst -sha512 -binary deepseek-ai-dsh-fs-local-0.2.1-rc.3.tgz | base64 -w0
tar xzf deepseek-ai-dsh-fs-local-0.2.1-rc.3.tgz   # -> package/lib/index.js
wc -l package/lib/index.js                        # expect 909
```

The tarballs this audit compared, by content — the same values
`npm view <pkg>@0.2.2-rc.1 dist.integrity` reports (re-recorded 2026-11-05;
the `0.2.1-rc.3` values they supersede are in git history):

```
@deepseek-ai/dsh-fs-local@0.2.2-rc.1  sha512-tibC9z4YJx7C6DhiWmTc9AYeF+GSh22XVaaDdumwTgBgvFuiNITNGn3E0DTL3skugB3MKnvAvrjybdveNQ7MmQ==
@deepseek-ai/dsh-fs@0.2.2-rc.1        sha512-sbr+u+3dG4KAUdY7FoMLJg/gSE39gvgBMwmvVeR/6acNrlHaIducvnuxRUYAq2V0+NOVnG8fA9sdfBq2uGAfUw==
```

Each row of the table below names the peer's `lib/index.js` line and the
literal both sides must produce. Verified 2026-10-03; the read/edit split
re-verified 2026-10-06; the whole table re-checked against `0.2.1-rc.2`,
2026-10-17, against `0.2.1-rc.3`, 2026-10-26, and against `0.2.2-rc.1`,
2026-11-05 (line numbers shifted; strings identical).

## Verdict

**The read path is faithful; the edit path differs in two declared places.**
Every load-bearing line of the read path matches the peer's shipped code. The
edit path's refusal verb and NUL-sampling bound (divergence 4) and `editText`'s
missing-file split (divergence 5) are deviations rather than unknown drift:
divergence 4 is the consequence of `readForEdit` sharing `readWholeText`, whose
guard is pinned at `test/fsio-agent.test.mjs:409`, and divergence 5 is pinned
by `test/fs-substrate.test.mjs`. The remaining differences are the substrate's
declared extensions, listed at the end.

## Verified identical (except where marked)

| Item | Evidence (peer `lib/index.js`) | Ours |
|---|---|---|
| `normalizeLineEndings` | `:628` `content.replaceAll("\r\n", "\n")` | identical |
| `detectLineEndings` | `:630` 4096-char sample; `crlf > lf - crlf` | identical |
| `restoreLineEndings` | `:643` LF unchanged; CRLF re-normalizes then `\n` → `\r\n` | identical (`replaceAll` vs `split/join` — equivalent) |
| occurrence counting | `:650` non-overlapping left-to-right | `split(needle).length - 1` — equivalent |
| `applyLiteralEdit` | `:741` empty needle, not-found, and ambiguous refusals; single-pass `split/join` without rescanning | identical |
| edit refusal strings | `:743`, `:746`, `:747` — `old_string must be a non-empty string` (`FS_EDIT_NOT_FOUND`); ``old_string was not found in "${displayPath}"``; ``old_string matched ${n} times in "${displayPath}"; provide a more specific old_string or set replace_all to true`` (`FS_AMBIGUOUS_EDIT`) | identical |
| invalid UTF-8, read path | `:343` — ``cannot ${verb} "${displayPath}": invalid UTF-8 text`` (`FS_NOT_TEXT`), verb `read` | identical (the edit path's verb differs; see 4) |
| binary detection, read path | `:99`/`:387` (sample const, guard), stream at `:471-473` — 8192-byte sample, NUL check; ``cannot read "${displayPath}": binary file`` (`FS_NOT_TEXT`) | identical — both accept a NUL at offset 8500, past the sample; the edit path's bound differs, see 4 |
| size caps | `:403`, `:414` — ``cannot read "${displayPath}": ${size} bytes exceeds the ${maxBytes}-byte limit`` and ``content exceeds the ${maxBytes}-byte limit`` (`FS_TOO_LARGE`) | identical |
| `writeText` guards | `:505`, `:506-508` — not-regular (`FS_NOT_REGULAR_FILE`), `file no longer exists` / `file changed since it was read` (`FS_STALE_VERSION`) via `writeTarget` at `:1021-1025`, ``cannot overwrite existing "${displayPath}" without reading it first`` (`FS_NOT_OBSERVED`) | identical |
| `editText` guards — not-regular and stale version | `:938`, `:939` — ``cannot edit "${displayPath}": not a regular file`` (`FS_NOT_REGULAR_FILE`); `file changed since it was read` (`FS_STALE_VERSION`) when the expected version differs (`requireFile` at `:1030-1032`) | identical |
| `editText` guards — missing file | `:937` — one refusal for every caller: `file changed since it was read` (`FS_STALE_VERSION`), with or without an expected version | **diverges by design** — we split on the caller's evidence: with an expected version `file no longer exists` (`FS_STALE_VERSION`), without one `file does not exist` (`FS_NOT_FOUND`). See 5 |
| `listDir` refusal | `:310` — ``cannot list "${displayPath}": not a directory`` (`FS_NOT_DIRECTORY`) | identical |
| diff-basis gate | `:920` — `existing !== null && Buffer.byteLength(content) < diffBasisMaxBytes` — keyed on the NEW content's size, `null` above the cap (the move path inherits the same keying at `:983`/`:997`) | identical — the gate's new-size keying is inherited by design, not a divergence |
| outcome shapes | `:927`, `:992` — `operation: "update" \| "create"`, the `missing:${targetKey}` sentinel version (`:1044`), `before`/`after` | identical |
| version join | `:148` — `` `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` `` (branded by `dsh-fs`'s `FsVersion`) | `versionOf` — identical shape |

## Deliberate divergences (declared, not drift)

1. **Distro-side version re-verification.** A `replace` write carrying an
   expected version is re-checked by the agent against a fresh stat one
   syscall before the rename (`FS_STALE_VERSION` on mismatch). The peer's
   check-then-write window stops at the host; ours narrows to kernel-adjacent.
2. **Per-stream truncation flags.** The EXEC frame carries an output budget;
   the RES line reports which streams the agent cut, surfaced as honest
   `truncated` flags. The collect-budget/spill machinery of the shell peer,
   `@deepseek-ai/dsh-bash-local@0.2.1-rc.3` (`lib/index.js:30`, `:110`), is the
   spill-file path we deliberately do not run.
3. **The transport around the ops** (ACK, KILL, the confined resident) is
   protocol this package owns; the peer has no agent.
4. **The edit path's read dialect.** `readForEdit` delegates to `readWholeText`
   (`src/fsio-agent.ts:526`). That is a shared guard rather than a chosen
   dialect, but a divergence all the same, so it is declared: an edit refused
   for its bytes reads ``cannot read "…": binary file`` or
   ``cannot read "…": invalid UTF-8 text`` — verb `read`, where the peer's
   `readForEdit` (`lib/index.js:664`) says ``cannot edit "…": …``. The NUL
   check is likewise the read path's 8192-byte sample
   (`src/fsio-agent.ts:377-384`, guard at `:380`), where the peer scans the
   whole buffer (`lib/index.js:668`): a file whose first 8192 bytes are clean
   but that carries a NUL later is edited by us and refused by the peer.
   Measured on a 9000-byte fixture with a NUL at offset 8500 — ours `EDITED`,
   the peer `FS_NOT_TEXT: cannot edit "…"`.
5. **`editText` on a missing file splits by evidence.** An edit that carries an
   expected version was grounded in a read, so a vanished file is a stale
   guard (`file no longer exists`, `FS_STALE_VERSION`); an edit with no read
   behind it names a file that never answered the stat, so it takes the read
   path's missing-file dialect (`cannot edit "…": file does not exist`,
   `FS_NOT_FOUND`). The peer throws `file changed since it was read`
   (`FS_STALE_VERSION`, `lib/index.js:937` via `requireFile` at `:1030`) for
   both. Pinned by `test/fs-substrate.test.mjs`.
6. **Publication durability (shell agent, 2026-11-06).** After the publish
   rename, the shell agent fsyncs the destination's containing directory
   (`sync -d`, best effort), so a power loss cannot lose an entry whose file
   contents already survived. The peer's publication makes no directory-fsync
   promise, and the native agent keeps its file-level `sync_all` only
   (`agent/native/spike/src/main.rs` stat write path) — the divergence holds
   until the native binary's next build. Filesystems that refuse a directory
   fsync (and `sync` builds without `-d`) degrade to the peer's promise
   silently.

## The peer's 0.2.2-rc.1 operations: implemented over protocol v7

`0.2.2-rc.1` added three operations to the peer's `FileSystem` base —
`patchText` (hunks via `@deepseek-ai/dsh-fs-patch`, refusal
`FS_PATCH_MISMATCH`), `deleteFile`, and `moveFile` (same-target refusal
`FS_SAME_TARGET`). 0.18.0 shipped them as an honest refusal (an inherited
host call would touch the wrong filesystem); protocol v7
([AGENT-PROTOCOL-V7.md](AGENT-PROTOCOL-V7.md)) now serves them for real:

- **`delete` / `move`** ride two new FS ops in both agent implementations,
  with the peer's guard dialects (source `requireFile`, destination
  `writeTarget`, version re-verification distro-side before the destructive
  step, staging + atomic/no-replace publication, the two-effect
  `sourceDeleted: false` outcome).
- **`patchText`** has no frame on purpose: hunks are applied in-process by
  the peer's own `applyHunks` (`@deepseek-ai/dsh-fs-patch` is now a peer
  dependency), so the mismatch dialect is the peer's byte-for-byte, then the
  result publishes through the same guarded atomic write an edit takes.
- **Structured FS errors**: failed FS ops answer with `FSERR|id|reason|b64`
  instead of the stderr sniffing notation (which stays parsed for older
  agents).
- **Batched FS frames** (`FSB`): one round trip for the GUI preview's
  stat+list+read shape; `readWholeText` and `listChildren` use it when the
  resident advertises `batch`. Benchmark: `test/probe/gui-preview-batch.sh`.
- **Negotiation**: the host accepts agents 6–7 and gates every v7 frame on
  the HELLO version, so a half-updated mirror degrades to v6 behaviour.

Pinned by `test/fs-substrate.test.mjs` (patch/delete/move over the live v7
script), `test/composition.test.mjs` (routing forwards the three ops),
`agent/native/spike/test.mjs` (both agents: batch, delete, move, capabilities)
and `test/agent-protocol.test.mjs` (HELLO caps, FSERR, FSB encoding).
Divergence 4's binary/UTF-8 dialect note now also covers the patch path, which
re-reads through `readForEdit`.

## Maintenance

When a peer floor or dev pin moves in `package.json`, re-run the comparison
above — pack the new tarballs, check the sha512, and walk the table's peer line
references against the replicas. The weekly peer-canary resolves the `next`
dist-tag into a scratch tree and runs the gate chain against it, so the signal
to raise the floor arrives before a user reports a drift. The fastest canary:
stat a file, list its directory, and
compare the versions (`test/fsio-agent.test.mjs` asserts the intra-distro half
of this); the strings above are the other half. The split dialect has its own
regression: `test/fs-substrate.test.mjs` asserts the missing-file refusal, and
`test/fsio-agent.test.mjs:409` pins the read-path guard that `readForEdit`
shares with `readWholeText`.
