# Peer parity — the fsio replication, verified

The agent substrate's text mechanics (`lib/fsio-text.js`) and its provider
orchestration messages (`lib/fs-substrate.js`, `lib/fsio-agent.js`) are a
deliberate replica of the pinned peer's fsio module, so the model reads the
same refusal dialect on both substrates. This file records the verification of
that claim against the real peers, which are not imported at build time.

- Peer: `@deepseek-ai/dsh-fs-local@0.2.0-rc.2` (the exact version
  `package.json` pins), plus `@deepseek-ai/dsh-fs@0.2.0-rc.2` for the
  `FsVersion` brand the local package imports.
- Method: `npm pack` both pins, extract, and compare the shipped
  `lib/index.js` (unminified ESM) function-by-function and string-by-string
  against this repository. Verified 2026-10-03.

## Verdict

**The replication is faithful.** Every load-bearing line matches the peer's
shipped code; the differences are the substrate's declared extensions, listed
at the end.

## Verified identical

| Item | Evidence (peer `lib/index.js`) | Ours |
|---|---|---|
| `normalizeLineEndings` | `content.replaceAll("\r\n", "\n")` | identical |
| `detectLineEndings` | 4096-char sample; `crlf > lf - crlf` | identical |
| `restoreLineEndings` | LF unchanged; CRLF re-normalizes then `\n` → `\r\n` | identical (`replaceAll` vs `split/join` — equivalent) |
| occurrence counting | non-overlapping left-to-right | `split(needle).length - 1` — equivalent |
| `applyLiteralEdit` | empty needle, not-found, and ambiguous refusals; single-pass `split/join` without rescanning | identical |
| edit refusal strings | `old_string must be a non-empty string` (`FS_EDIT_NOT_FOUND`); ``old_string was not found in "${displayPath}"``; ``old_string matched ${n} times in "${displayPath}"; provide a more specific old_string or set replace_all to true`` (`FS_AMBIGUOUS_EDIT`) | identical |
| invalid UTF-8 | ``cannot ${verb} "${displayPath}": invalid UTF-8 text`` (`FS_NOT_TEXT`) | identical |
| binary detection | 8192-byte sample, NUL check; ``cannot read "${displayPath}": binary file`` (`FS_NOT_TEXT`) | identical |
| size caps | ``cannot read "${displayPath}": ${size} bytes exceeds the ${maxBytes}-byte limit`` and ``content exceeds the ${maxBytes}-byte limit`` (`FS_TOO_LARGE`) | identical |
| `writeText` guards | not-regular (`FS_NOT_REGULAR_FILE`), `file no longer exists` / `file changed since it was read` (`FS_STALE_VERSION`), ``cannot overwrite existing "${displayPath}" without reading it first`` (`FS_NOT_OBSERVED`) | identical |
| `editText` guards | missing file refuses with `FS_STALE_VERSION` "file changed since it was read" (NOT `FS_NOT_FOUND`); not-regular; stale-version | identical — an earlier draft of this audit suspected a divergence here; the peer matches us |
| `listDir` refusal | ``cannot list "${displayPath}": not a directory`` (`FS_NOT_DIRECTORY`) | identical |
| diff-basis gate | `existing !== null && Buffer.byteLength(content) < diffBasisMaxBytes` — keyed on the NEW content's size, `null` above the cap | identical — the gate's new-size keying is inherited by design, not a divergence |
| outcome shapes | `operation: "update" \| "create"`, the `missing:${targetKey}` sentinel version, `before`/`after` | identical |
| version join | `` `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` `` (local `index.js:146`, branded by `dsh-fs`'s `FsVersion`) | `versionOf` — identical shape |

## Deliberate divergences (declared, not drift)

1. **Distro-side version re-verification.** A `replace` write carrying an
   expected version is re-checked by the agent against a fresh stat one
   syscall before the rename (`FS_STALE_VERSION` on mismatch). The peer's
   check-then-write window stops at the host; ours narrows to kernel-adjacent.
2. **Per-stream truncation flags.** The EXEC frame carries an output budget;
   the RES line reports which streams the agent cut, surfaced as honest
   `truncated` flags. The peer's collect-budget machinery is the spill-file
   path we deliberately do not run.
3. **The transport around the ops** (ACK, KILL, the confined resident) is
   protocol this package owns; the peer has no agent.

## Maintenance

When `package.json` bumps the peer pins, re-run this comparison — extract the
new tarballs and diff the regions above. The fastest canary: stat a file, list
its directory, and compare the versions (`test/fsio-agent.test.mjs` asserts the
intra-distro half of this); the strings above are the other half.
