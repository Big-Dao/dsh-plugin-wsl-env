# Peer parity — the fsio replication, verified

The agent substrate's text mechanics (`lib/fsio-text.js`) and its provider
orchestration messages (`lib/fs-substrate.js`, `lib/fsio-agent.js`) are a
deliberate replica of the pinned peer's fsio module, so the model reads the
same refusal dialect on both substrates. The **read path** holds end to end;
the **edit path** carries two declared divergences, listed at the end. This
file records the verification against the real peers.

- Peers: `@deepseek-ai/dsh-fs-local@0.2.0-rc.2` (the exact version
  `package.json` pins), plus `@deepseek-ai/dsh-fs@0.2.0-rc.2` for the
  `FsVersion` brand the local package imports. Divergence 2 is measured
  against a third peer, `@deepseek-ai/dsh-bash-local@0.2.0-rc.2` — the shell
  executor carries the collect-budget/spill machinery; `spill` and
  `maxSpillBytes` do not appear in `dsh-fs-local` at all.
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
npm pack @deepseek-ai/dsh-fs-local@0.2.0-rc.2 @deepseek-ai/dsh-fs@0.2.0-rc.2 --pack-destination .
openssl dgst -sha512 -binary deepseek-ai-dsh-fs-local-0.2.0-rc.2.tgz | base64 -w0
tar xzf deepseek-ai-dsh-fs-local-0.2.0-rc.2.tgz   # -> package/lib/index.js
wc -l package/lib/index.js                        # expect 909
```

The tarballs this audit compared, by content — the same values
`npm view <pkg>@0.2.0-rc.2 dist.integrity` reports:

```
@deepseek-ai/dsh-fs-local@0.2.0-rc.2  sha512-lDzh5VlQsXf3nI+E0+T0weYdH1VAoo+htj6Kwc62P7/Lx+xjnYSLQYTeGeaJR1d8H2iQv2FvlwaDKv60AorKdA==
@deepseek-ai/dsh-fs@0.2.0-rc.2        sha512-PuVcI7drTwa19Key54DROoqnDFTTFkl8TPlyrTnS3BSnykm+jKbB13ES/PQEJoRunNdQkNZa12jtbUI4BP/EHw==
```

Each row of the table below names the peer's `lib/index.js` line and the
literal both sides must produce. Verified 2026-10-03; the read/edit split
re-verified 2026-10-06.

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
| `normalizeLineEndings` | `:584` `content.replaceAll("\r\n", "\n")` | identical |
| `detectLineEndings` | `:587` 4096-char sample; `crlf > lf - crlf` | identical |
| `restoreLineEndings` | `:600` LF unchanged; CRLF re-normalizes then `\n` → `\r\n` | identical (`replaceAll` vs `split/join` — equivalent) |
| occurrence counting | `:603` non-overlapping left-to-right | `split(needle).length - 1` — equivalent |
| `applyLiteralEdit` | `:698` empty needle, not-found, and ambiguous refusals; single-pass `split/join` without rescanning | identical |
| edit refusal strings | `:700`, `:703`, `:704` — `old_string must be a non-empty string` (`FS_EDIT_NOT_FOUND`); ``old_string was not found in "${displayPath}"``; ``old_string matched ${n} times in "${displayPath}"; provide a more specific old_string or set replace_all to true`` (`FS_AMBIGUOUS_EDIT`) | identical |
| invalid UTF-8, read path | `:328`, `:331` — ``cannot ${verb} "${displayPath}": invalid UTF-8 text`` (`FS_NOT_TEXT`), verb `read` | identical (the edit path's verb differs; see 4) |
| binary detection, read path | `:369` (guard at `:373`), stream at `:457` — 8192-byte sample, NUL check; ``cannot read "${displayPath}": binary file`` (`FS_NOT_TEXT`) | identical — both accept a NUL at offset 8500, past the sample; the edit path's bound differs, see 4 |
| size caps | `:389`, `:400` — ``cannot read "${displayPath}": ${size} bytes exceeds the ${maxBytes}-byte limit`` and ``content exceeds the ${maxBytes}-byte limit`` (`FS_TOO_LARGE`) | identical |
| `writeText` guards | `:867`, `:869-870`, `:871` — not-regular (`FS_NOT_REGULAR_FILE`), `file no longer exists` / `file changed since it was read` (`FS_STALE_VERSION`), ``cannot overwrite existing "${displayPath}" without reading it first`` (`FS_NOT_OBSERVED`) | identical |
| `editText` guards — not-regular and stale version | `:887`, `:888` — ``cannot edit "${displayPath}": not a regular file`` (`FS_NOT_REGULAR_FILE`); `file changed since it was read` (`FS_STALE_VERSION`) when the expected version differs | identical |
| `editText` guards — missing file | `:886` — one refusal for every caller: `file changed since it was read` (`FS_STALE_VERSION`), with or without an expected version | **diverges by design** — we split on the caller's evidence: with an expected version `file no longer exists` (`FS_STALE_VERSION`), without one `file does not exist` (`FS_NOT_FOUND`). See 5 |
| `listDir` refusal | `:296` — ``cannot list "${displayPath}": not a directory`` (`FS_NOT_DIRECTORY`) | identical |
| diff-basis gate | `:872` — `existing !== null && Buffer.byteLength(content) < diffBasisMaxBytes` — keyed on the NEW content's size, `null` above the cap | identical — the gate's new-size keying is inherited by design, not a divergence |
| outcome shapes | `:876`, `:905` — `operation: "update" \| "create"`, the `missing:${targetKey}` sentinel version, `before`/`after` | identical |
| version join | `:145` — `` `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` `` (branded by `dsh-fs`'s `FsVersion`) | `versionOf` — identical shape |

## Deliberate divergences (declared, not drift)

1. **Distro-side version re-verification.** A `replace` write carrying an
   expected version is re-checked by the agent against a fresh stat one
   syscall before the rename (`FS_STALE_VERSION` on mismatch). The peer's
   check-then-write window stops at the host; ours narrows to kernel-adjacent.
2. **Per-stream truncation flags.** The EXEC frame carries an output budget;
   the RES line reports which streams the agent cut, surfaced as honest
   `truncated` flags. The collect-budget/spill machinery of the shell peer,
   `@deepseek-ai/dsh-bash-local@0.2.0-rc.2` (`lib/index.js:30`, `:110`), is the
   spill-file path we deliberately do not run.
3. **The transport around the ops** (ACK, KILL, the confined resident) is
   protocol this package owns; the peer has no agent.
4. **The edit path's read dialect.** `readForEdit` delegates to `readWholeText`
   (`src/fsio-agent.ts:526`). That is a shared guard rather than a chosen
   dialect, but a divergence all the same, so it is declared: an edit refused
   for its bytes reads ``cannot read "…": binary file`` or
   ``cannot read "…": invalid UTF-8 text`` — verb `read`, where the peer's
   `readForEdit` (`lib/index.js:621`) says ``cannot edit "…": …``. The NUL
   check is likewise the read path's 8192-byte sample
   (`src/fsio-agent.ts:377-384`, guard at `:380`), where the peer scans the
   whole buffer (`lib/index.js:625`): a file whose first 8192 bytes are clean
   but that carries a NUL later is edited by us and refused by the peer.
   Measured on a 9000-byte fixture with a NUL at offset 8500 — ours `EDITED`,
   the peer `FS_NOT_TEXT: cannot edit "…"`.
5. **`editText` on a missing file splits by evidence.** An edit that carries an
   expected version was grounded in a read, so a vanished file is a stale
   guard (`file no longer exists`, `FS_STALE_VERSION`); an edit with no read
   behind it names a file that never answered the stat, so it takes the read
   path's missing-file dialect (`cannot edit "…": file does not exist`,
   `FS_NOT_FOUND`). The peer throws `file changed since it was read`
   (`FS_STALE_VERSION`, `lib/index.js:886`) for both. Pinned by
   `test/fs-substrate.test.mjs`.

## Maintenance

When `package.json` bumps the peer pins, re-run the comparison above — pack the
new tarballs, check the sha512, and walk the table's peer line references
against the replicas. The fastest canary: stat a file, list its directory, and
compare the versions (`test/fsio-agent.test.mjs` asserts the intra-distro half
of this); the strings above are the other half. The split dialect has its own
regression: `test/fs-substrate.test.mjs` asserts the missing-file refusal, and
`test/fsio-agent.test.mjs:409` pins the read-path guard that `readForEdit`
shares with `readWholeText`.
