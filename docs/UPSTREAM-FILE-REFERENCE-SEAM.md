# Upstream seam: `@` references over a WSL workspace

Status: measured and deferred (2026-10-19). The `@` completion in
`@deepseek-ai/dsh-file-reference-local` walks the workspace with
`node:fs/promises` (`readdir` + `lstat`) from the **Windows** harness process.
For a WSL workspace that walk crosses the 9p share on every directory; the
plugin already has a distro-side traversal, but it cannot be wired until
upstream exposes the funnel. This note records the cost, the seam, and the
decision.

## The measured cost

Probe: [`test/probe/file-reference-9p.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/file-reference-9p.sh)
(three runs, `node:fs` readdir walk, no ranking engine). Tree: 20 directories,
520 files, one level of subdirectories; the same tree walked from Windows over
`\\wsl.localhost\<distro>` and from inside the distro on ext4.

| Walk | Median | Samples |
|---|---|---|
| Windows over 9p (`\\wsl.localhost\...`) | **84.7 ms** | 192.5, 84.7, 63.0 |
| Distro on ext4 | **1.5 ms** | 2.4, 1.5, 1.3 |

The ratio is ~56× on this tree. Variance on the 9p side is large (63–192 ms
across three runs), which is itself the point: the cost is per-directory 9p
traffic, so it grows with the tree and is sensitive to the share's state. A
synthetic 520-entry tree is a floor for a real repository, not a ceiling.

These numbers are the *traversal* only. The fuzzy ranking, generation and
invalidation logic is not part of the measurement — it is the upstream code the
seam must keep.

## The seam

RFC addendum ① (in [rfc-wsl-workspaces.md](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/upstream/rfc-wsl-workspaces.md))
proposes exposing the three module-internal funnels as an injectable strategy:

```ts
interface FileReferenceTraversal {
  readWorkspaceRoot(absolute: string, signal: AbortSignal): Promise<TraversalDirent[]>
  readDirectory(absolute: string, signal: AbortSignal): Promise<TraversalDirent[]>
  resolveDisplayDirectory(root: string, displayDirectory: string, signal: AbortSignal): Promise<string | undefined>
}
```

with three semantics that matter for a remote world:

- **Dirent shape**: entries stay `{ name, isDirectory(), isFile() }`; a symlink
  is neither, so the distro listing uses `find -printf '%y\t%f'` (type char `l`)
  rather than resolving links.
- **Errors**: an unreadable directory yields `[]`; an aborted caller propagates
  the abort.
- **Coordinates**: the returned absolutes stay in the root's own coordinate
  system (UNC for a distro workspace), because upstream joins children with the
  host `node:path` — a POSIX path from the distro layer would be mangled.

## The plugin side is ready

[`src/file-reference-wsl.ts`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/src/file-reference-wsl.ts) implements that
interface over the resident agent: one `find -printf` per directory, a
single-exec segment walk for `resolveDisplayDirectory` (instead of N sequential
`lstat`s), and the UNC/POSIX conversions. It is unit-tested against a fake
agent and deliberately **not** wired into `cordis.patch.yml`: the funnel
functions are module-internal, so wiring today would mean subclassing past them
or re-implementing the ranking engine — the regression path the RFC rules out.

## Decision and trigger

**Fallback: keep the 9p walk.** `@` completion works today; it pays the
per-directory share cost above. There is no plugin-side optimization that is
safe without the seam, and the plugin does not replace the upstream module.

Wire `file-reference-wsl` when either happens:

- upstream exposes the traversal strategy (or an equivalent injectable funnel);
- the plugin's own composition gains a way to supply the strategy without
  patching module internals.

At that point: wire the consumer, add an `@`-completion latency probe (the
traversal probe above is the baseline), and only then claim a speed-up. Until
then neither the README nor the roadmap promises one.
