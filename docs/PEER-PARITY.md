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

## The peer's 0.2.2-rc.1 operations: declared gap, refused at the provider

`0.2.2-rc.1` added three operations to the peer's `FileSystem` base —
`patchText` (hunks via the new `@deepseek-ai/dsh-fs-patch`, refusal
`FS_PATCH_MISMATCH` at `lib/index.js:1036`), `deleteFile`, and `moveFile`
(same-target refusal `FS_SAME_TARGET`). The agent substrate serves read,
write and edit only; implementing these would mean a patch-hunks wire op and
a delete/move pair in the resident protocol, which is substrate work, not
parity drift. What the release makes load-bearing is that the operations now
exist on the base class this plugin extends: an inherited call with a distro
target would run the **host** implementation against a same-named Windows
path (or refuse with a host-dialect `FS_NOT_FOUND` naming the wrong world).

So the providers refuse honestly instead of inheriting:
`WslFileSystem.patchText`/`deleteFile`/`moveFile` (`src/index.ts`) throw
`FS_IO_ERROR` naming the substrate's gap, and `WslRoutingFileSystem`
(`src/fs-routing.ts`) routes by the same coordinate rule as `editText` — a
distro-side endpoint reaches the refusing backend, two Windows endpoints keep
the inherited host implementation. The shipped preset disables the patch
tool beside edit (`applyPatch: false` in `cordis.patch.yml`), so no
model-facing path reaches the refusal today; the overrides exist because the
peer's own consumers may. Pinned by `test/composition.test.mjs` (distro
refusals and a host-side `moveFile` round trip). Peer-side mechanics for the
record: `patchText` re-reads via the whole-buffer `readForEdit`, applies
`applyHunks`, and publishes through the same atomic write — so divergence 4's
binary/UTF-8 dialect carries over to the peer's patch path too.

A related `0.2.2-rc.1` surface change lands in the sandbox vocabulary:
`SandboxExecutionPolicy.additionalWritableRoots` and the
`workspaceWritableRoots` derivation (`roots.js`), whose together-grant
contract this backend honors in `wslWritableRoots` (`src/index.ts`) — a
same-distro UNC extra root is granted as-is; a Windows-path extra root in a
distro workspace fails closed with the peer's `SandboxInvalidRootError`,
because the grant cannot be enforced there without lying about the mode.

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
