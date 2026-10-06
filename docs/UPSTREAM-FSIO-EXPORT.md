# Upstream proposal: export the fsio text helpers from `dsh-fs-local`

Status: draft, not yet filed upstream — no discussion link yet (the filing
convention is [UPSTREAM-TERMINAL-TITLE.md](UPSTREAM-TERMINAL-TITLE.md)).
Targeting `deepseek-harness` @ `packages/fs/fs-local`, the `0.2.0-rc.x` line
this plugin pins exactly (`@deepseek-ai/dsh-fs-local@0.2.0-rc.2`, in both the
dev and peer dependency blocks of `package.json`). This is the Shape-A
upstream half of the in-distro I/O refactor: with the fsio text mechanics
importable, `dsh-plugin-wsl-env` deletes its copies of them.

## The change

The fsio module already exists and is fully documented in the shipped
declarations (`lib/types/fsio.d.ts`). Two facts keep it out of reach:

- `package.json` exports exactly three entries — `"."`, `"./src/*"` and
  `"./package.json"` (lines 16–23). `"./src/*"` is not a way in: `files` is
  `["lib/index.js", "lib/types/**/*.d.ts"]` (lines 24–27), so the sources are
  in the repository but not in the tarball (`npm pack --dry-run` lists nine
  files, none of them under `src/`).
- The published runtime is one bundled file. The fsio code is a region of
  `lib/index.js` (`//#region lib/types/fsio.js`, line 90) — there is no
  `lib/fsio.js` — and that file's only export statement is
  `export { LocalFileSystem, LocalFileSystem as default };` (line 909).

So the reachable seam is the package entry, not a new subpath: re-export the
four text helpers from it, in the runtime and in the declarations.

(A `"./fsio"` subpath does not work as-is — the runtime file it would name does
not exist. Pointing its `types` at `lib/types/fsio.d.ts` instead would publish
the whole fsio surface — `readWholeText`, `readWholeBytes`, `readByteWindow`,
`streamWholeText`, `writeFileAtomic`, `probe`, `probeNoFollow`,
`listDirectory`, `resolveLocalTarget`, `readForEdit`, `readTextForDiff`, … —
while the runtime side offered four names. Types and runtime must promise the
same surface.)

```diff
--- a/packages/fs/fs-local/lib/index.js
+++ b/packages/fs/fs-local/lib/index.js
@@ -906,4 +906,11 @@
 	}
 };
 //#endregion
-export { LocalFileSystem, LocalFileSystem as default };
+export {
+	LocalFileSystem,
+	LocalFileSystem as default,
+	applyLiteralEdit,
+	detectLineEndings,
+	normalizeLineEndings,
+	restoreLineEndings,
+};
```

```diff
--- a/packages/fs/fs-local/lib/types/index.d.ts
+++ b/packages/fs/fs-local/lib/types/index.d.ts
@@ -66,4 +66,5 @@
     private versionAfterWrite;
 }
 export default LocalFileSystem;
+export { applyLiteralEdit, detectLineEndings, normalizeLineEndings, restoreLineEndings } from './fsio.ts';
 //# sourceMappingURL=index.d.ts.map
\ No newline at end of file
```

Both files are generated; the change itself belongs in the sources that emit
them (`src/index.ts` re-exporting from the fsio module, and that module
exporting `detectLineEndings`). The artifact diffs are shown because they are
what a consumer resolves — and they apply as-is to the published `0.2.0-rc.2`
files.

`detectLineEndings` is the one genuinely new name: it is not in
`lib/types/fsio.d.ts` at all — in the bundle it is a non-exported function
(`function detectLineEndings(raw)`, line 587). Declaring it is a
`declare function detectLineEndings(raw: string): LineEndings;` beside its two
siblings, plus the name in the export list at `fsio.d.ts:223` (`LineEndings`
itself is already exported, `:166`). The other three are already declared
there: `normalizeLineEndings` (`:173`), `restoreLineEndings` (`:182`),
`applyLiteralEdit` (`:219`), with the first two exported at `:223`. If upstream
would rather not widen the surface at all, leave `detectLineEndings` out and the
consumer keeps its four-line local copy.

`readForEdit` and `readTextForDiff` are not part of this. They are exported by
the fsio module (`fsio.d.ts:191`, `:207`), but they are I/O orchestration —
which the plugin drives against its own substrate — so the proposal simply does
not re-export them.

## Why the plugin needs it

`dsh-plugin-wsl-env`'s agent substrate (`lib/fsio-agent.js`,
`lib/fs-substrate.js`) re-runs fsio's orchestration inside a WSL distro: reads,
writes, identities and edits execute where the files live, and the host side
keeps only the validation and edit mechanics. Those mechanics —
`applyLiteralEdit`, the line-ending trio, the binary NUL sample, the fatal
UTF-8 decode — are replicated today in `src/fsio-text.ts` (built to
`lib/fsio-text.js`) because the package does not export them. The replica is
byte-for-byte faithful, including error messages, because the tool layer
matches on both the code and the text the model reads — and that faithfulness
is verified, not assumed: [PEER-PARITY.md](PEER-PARITY.md) records the
function-by-function and string-by-string comparison against the pinned peer's
shipped code (verified 2026-10-03; the read/edit split re-verified
2026-10-06). But a replica is a fork surface: every upstream change to the edit
algorithm has to be re-ported by hand.

With the export in place the plugin imports the four functions and deletes its
copies:

```js
import { applyLiteralEdit, detectLineEndings, normalizeLineEndings, restoreLineEndings } from "@deepseek-ai/dsh-fs-local";
```

The rest of the module stays. `BINARY_SAMPLE_BYTES`, `FsCodedError`,
`notTextError`, `decodeUtf8`, `decodeUtf8Stream` and `throwIfAborted`
(`src/fsio-text.ts:23`, `:30`, `:53`, `:67`, `:86`, `:179`) have no counterpart
in the fsio declarations, and the module's other consumers keep importing them
locally (`src/fsio-agent.ts:27-36`, `src/fs-substrate.ts:37`,
`src/index.ts:57`). `lib/fsio-text.js` is not deleted; four of its ten exports
are.

Importing from the entry costs this consumer nothing new: it already imports
`LocalFileSystem` from the same entry (`src/index.ts:45`,
`src/fs-routing.ts:35`) and `@deepseek-ai/dsh-fs` (`src/index.ts:46`). The
entry's non-builtin static imports are `chokidar` (`lib/index.js:3`),
`@deepseek-ai/schemastery` (`:6`) and the `@deepseek-ai/dsh-fs` peer (`:7`) —
all three already in this consumer's graph; `koffi` loads lazily (`await
import("koffi")`, `:25`), so no native dependency is evaluated at import time.

## Why this is safe upstream

- Additive: three of the four names are already declared in the shipped
  `lib/types/fsio.d.ts`; `detectLineEndings` is one new pure function the edit
  path already calls (`readForEdit`, `lib/index.js:629` — the class reaches it
  through `editText`).
- No behaviour change: the class's own call sites are untouched.
- The functions do no I/O and hold no state — text in, text out, structured
  errors — so exporting them cannot widen the I/O contract.
- They are pure but **not peer-free**: the module they live in imports
  `FsError`, `FsTargetKey` and `FsVersion` from the `@deepseek-ai/dsh-fs` peer
  (`lib/index.js:7`) and uses them throughout (`FsError` thrown at `:700`,
  `:703`, `:704`; `FsTargetKey` at `:175`, `:196`, `:207`; `FsVersion` at
  `:146`), so importers of these helpers take that peer at runtime. They do not
  take cordis — the bundle imports none. The plugin accepts the peer
  dependency: both packages are already runtime imports of it, and its tool
  layer maps the `code` token and the message, not the error class.
- Semver: an additive export. On the `0.2.0-rc.x` line it ships in the next
  pre-release — the `0.2` position does not move, so this is not a minor bump
  of a released line; and because the consuming plugin pins the exact version,
  adoption is an explicit pin bump, never an automatic upgrade.

## Landing it (consumer side)

1. Bump both pins in `package.json` (`devDependencies` and `peerDependencies`)
   to the peer that carries the export.
2. `pnpm run build` — `lib/` is committed, and `test/build-freshness.mjs`
   enforces that it is a byte-identical, closed image of `src/`.
3. Re-run the comparison in [PEER-PARITY.md](PEER-PARITY.md) (its Maintenance
   section) against the new pin before trusting anything else.
4. Delete the four replicas and point the call sites at the peer, then
   `pnpm test`.

Files that move with it:

- `src/fsio-text.ts` — drop `applyLiteralEdit`, `detectLineEndings`,
  `normalizeLineEndings`, `restoreLineEndings`; keep the rest.
- `src/fsio-agent.ts` (imports `:27-36`, `detectLineEndings` used at `:528`)
  and `src/fs-substrate.ts` (`:37`) — take the four from the peer. Where they
  land decides the module's peer story: importing them directly keeps
  `src/fsio-text.ts` peer-free — and `test/fsio-text.test.mjs`, which imports
  nothing but node builtins and the local module (`:9-18`), runnable without
  the peer — while re-exporting them through it does not. Either way the
  "peer-free" self-descriptions in `src/fsio-agent.ts:14-16` and
  `src/fs-substrate.ts:25` need a pass.
- `lib/*` — the rebuilt artifacts.
- `test/fsio-text.test.mjs` (the replica's tests, including the
  `detectLineEndings` checks at `:69-72`) and `test/fsio-agent.test.mjs:22`,
  which imports two of the four from `lib/fsio-text.js`. If that test file is
  dropped or renamed, also the `test:coverage` and `test:unit` lists at
  `package.json:114` and `:116`.
- The documents that describe the replica as current: `docs/ARCHITECTURE.md:173`
  and `:416` (the two entries marked "replicated … pending the … export"),
  `docs/PEER-PARITY.md:3` and `:17` (plus its Maintenance section),
  `docs/upstream/promotion-map.md:82` — and this file, whose status then becomes
  "landed".

Done when: the pinned peer resolves the four names from both its runtime entry
and its declarations, the plugin imports them there, `pnpm test` passes, and no
document still calls `lib/fsio-text.js` a replica of them.

## Follow-up (separate proposal, not required)

A larger seam — parameterizing `LocalFileSystem`'s fsio call sites so a
subclass can substitute an I/O substrate — would let integrations inherit the
whole backend instead of re-running its orchestration. The export above is the
prerequisite and is sufficient on its own; the parameterization is worth
discussing only after a consumer exists in the wild.
