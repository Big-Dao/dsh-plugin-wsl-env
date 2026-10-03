# Upstream proposal: export the fsio module from `dsh-fs-local`

Status: draft, targeting `deepseek-harness` @ `packages/fs/fs-local` (version
line `0.2.0-rc.x`). This is the Shape-A upstream half of the in-distro I/O
refactor: with the fsio module exported, `dsh-plugin-wsl-env` deletes its
in-plugin replicas (`lib/fsio-text.js`) and imports the originals.

## The change

The fsio module already exists, is fully documented, and is pure (no peers
beyond types). It is only not reachable: `package.json` exports `"."` and
`"./package.json"`, and `lib/index.js` does not re-export the helpers. Two
lines of surface, no behaviour change:

```diff
--- a/packages/fs/fs-local/package.json
+++ b/packages/fs/fs-local/package.json
@@
   "exports": {
     ".": {
       "types": "./lib/types/index.d.ts",
       "default": "./lib/index.js"
     },
+    "./fsio": {
+      "types": "./lib/types/fsio.d.ts",
+      "default": "./lib/fsio.js"
+    },
     "./src/*": "./src/*",
     "./package.json": "./package.json"
   },
```

```diff
--- a/packages/fs/fs-local/lib/index.js
+++ b/packages/fs/fs-local/lib/index.js
@@
-export { LocalFileSystem, LocalFileSystem as default };
+export {
+  LocalFileSystem,
+  LocalFileSystem as default,
+  applyLiteralEdit,
+  detectLineEndings,
+  normalizeLineEndings,
+  restoreLineEndings,
+};
```

(The module layout differs between the repo's `src/` and the built `lib/`;
the export list is what matters. `readForEdit` and `readTextForDiff` stay
internal — they are I/O orchestration, which the plugin drives against its own
substrate — only the pure text mechanics are needed.)

## Why the plugin needs it

`dsh-plugin-wsl-env`'s agent substrate (`lib/fsio-agent.js`,
`lib/fs-substrate.js`) re-runs fsio's orchestration inside a WSL distro: reads,
writes, identities and edits execute where the files live, and the host side
keeps only the validation and edit mechanics. Those mechanics —
`applyLiteralEdit`, the line-ending trio, the binary NUL sample, the fatal UTF-8
decode — are replicated today (`lib/fsio-text.js`) because the package does not
export them. The replica is byte-for-byte faithful, including error messages,
because the tool layer matches on both the code and the text the model reads;
but a replica is a fork surface: every upstream change to the edit algorithm
has to be re-ported by hand.

With the export in place the plugin deletes `lib/fsio-text.js` and imports:

```js
import { applyLiteralEdit, detectLineEndings, normalizeLineEndings, restoreLineEndings } from "@deepseek-ai/dsh-fs-local/fsio";
```

## Why this is safe upstream

- No new API surface beyond re-exporting functions that already exist and are
  documented in `lib/types/fsio.d.ts`.
- No behaviour change: the class's own call sites are untouched.
- The functions are pure (text in, text out, structured errors), so exporting
  them cannot widen the I/O contract.
- Semver: additive export, a minor bump.

## Follow-up (separate proposal, not required)

A larger seam — parameterizing `LocalFileSystem`'s fsio call sites so a
subclass can substitute an I/O substrate — would let integrations inherit the
whole backend instead of re-running its orchestration. The export above is the
prerequisite and is sufficient on its own; the parameterization is worth
discussing only after a consumer exists in the wild.
