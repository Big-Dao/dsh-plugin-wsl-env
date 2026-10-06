# Upstream proposal: re-open `LocalBashExecutor.spawnSpec` to subclasses

Status: draft, targeting `deepseek-harness` @ `packages/shell/bash-local`
(version line `0.2.0-rc.x`; the declarations and the diff below were checked
against `dsh-v0.2.0-rc.2`, the version the peer dependency pins, on
2026-10-06). This is the record of a seam this plugin must override but cannot
reach through the supported surface, and of the temporary bridge this
repository carries until the seam opens.

## The requirement

`dsh-plugin-wsl-env` runs every shell command inside a WSL distro. It
subclasses `LocalBashExecutor` and replaces the command's argv with its own —
`wsl.exe -d <distro> --cd <linux dir> --exec <shell> -lc <cmd>` on the
one-shot path (composed by `argv()` and handed to the base's `executeArgv` as
the prepare thunk), the bare in-distro argv in the resident agent's frame on
the agent path. The Windows-side working directory is not a preference:
**a `wsl.exe` child process must be started from a Windows directory**.
`spec.workdir` is a Linux path, which a Windows `CreateProcess` call cannot
use as `cwd`; the Linux directory rides on `--cd` instead. The spawn *spec*
therefore has to start elsewhere — rewritten, in the one member the subclass
cannot reach, to `hostCwd` (the `hostCwd` config key, else the operator's
`%SystemRoot%`, else `process.cwd()`) — and to carry the environment facts the
interop needs (`WSL_UTF8`, the managed `WSLENV` translation).

The subclass also overrides three base members — `resolve`, `execute` and
`onProcessDone` — to route commands through the resident agent and stamp the
sandbox facts on the settled process. Those ride the base's own extension
surface and are not what this document is about; `spawnSpec`, below, is the
one member the subclass cannot reach.

The executor's own machinery — deadlines, output caps, spill files, managed
background processes — is the shipped implementation's and is reused as-is on
the one-shot path. But that machinery ends in one place subclasses are
expected to customize:

```js
running = this.ctx.subprocess.spawn(this.spawnSpec(spec, argv, spec.stdoutMaxBytes, spawnSignal));
```

## The gap

`spawnSpec` is declared `private` on `LocalBashExecutor`. The published
declaration keeps the JSDoc and no signature at all
(`lib/types/index.d.ts:86-87`):

```ts
/** Map one resolved bash spec and explicit argv onto a fully-specified subprocess spawn. */
private spawnSpec;
```

The implementation behind it is `lib/index.js:107`
(`(spec, argv, stdoutMaxBytes, signal)`), and the source at the
`dsh-v0.2.0-rc.2` tag declares `argv: readonly string[]`
(`src/index.ts:151-156`). This plugin's bridge declares `argv: string[]`
instead (`src/index.ts:216-225`); method parameters are checked bivariantly,
so the widening compiles.

A subclass that must override it therefore faces a closed door:

- TypeScript rejects the subclass (`TS2415`) and any `super.spawnSpec` call
  (`TS2855`), so the natural extension point is unusable under the build's
  `strict` pass — which this plugin runs as a CI gate (`pnpm test`).
- The private declaration is upstream's own extension seam by intent
  elsewhere: `executeArgv` is `protected` precisely so subclasses can replace
  the argv at the execution boundary. The spawn *spec* is the other half of
  that same boundary — the argv says what to run, the spec says where and
  with which environment — and only the first half is open.

## The workaround this repository carries

`src/index.ts` bridges the gap at the type level, without touching the
runtime class (`lib/index.js` is its compiled artifact, the copy that ships):

- The `extends` clause carries a `@ts-expect-error` naming this file, so the
  one deliberate contract break is visible in review instead of hidden.
- The inherited builder is captured once through the `SpawnSeamExecutor` type
  alias (an `Omit`-and-reopen of the base class) and invoked by prototype, so
  `super.spawnSpec` semantics are preserved through a single, typed point:

```ts
export type SpawnSeamExecutor = Omit<LocalBashExecutor, "spawnSpec"> & {
  spawnSpec: (
    spec: ShellExecSpec,
    argv: string[],
    stdoutMaxBytes: number,
    signal?: AbortSignal,
  ) => SubprocessSpawnSpec;
};

const inheritedSpawnSpec = (LocalBashExecutor.prototype as unknown as SpawnSeamExecutor).spawnSpec;
```

`src/` is TypeScript, type-checked by the build program (`pnpm run build`,
`tsconfig.build.json`, under `strict` with `noEmitOnError`); the separate
`checkJs` gate (`tsc --noEmit`) covers only `test/**` and the ambient service
types. Both run inside the `pnpm test` chain.

The override then only rewrites `cwd` and `env` (UTF-8 pinning for `wsl.exe`
diagnostics, the managed `WSLENV` translation) and keeps everything else the
base produced, spread verbatim.

## The suggested upstream change

One keyword, no behaviour change:

```diff
--- a/packages/shell/bash-local/src/index.ts
+++ b/packages/shell/bash-local/src/index.ts
@@
-  private spawnSpec(spec: ShellExecSpec, argv: readonly string[], stdoutMaxBytes: number, signal: AbortSignal | undefined): SubprocessSpawnSpec;
+  protected spawnSpec(spec: ShellExecSpec, argv: readonly string[], stdoutMaxBytes: number, signal: AbortSignal | undefined): SubprocessSpawnSpec;
```

The published package ships only `lib/index.js` and `lib/types/**/*.d.ts`,
and the declaration is generated from the source: the keyword change above is
the whole upstream diff, and `lib/types/index.d.ts`'s `private spawnSpec;`
follows from it. (The manifest does declare a `./src/*` export subpath, but
`files` ships no `src/`, so an installed copy resolves that subpath to
nothing — the sources exist only in the repository checkout, which is where
this diff applies.)

`protected` matches the access level the class already grants `executeArgv`
for the same boundary, keeps the method off the public seam
(`ShellExecutor` consumers never see it), and lets a subclass override the
spawn location the way the runtime already intends — `this.spawnSpec(…)`
resolves to the subclass through ordinary dispatch today, so the only thing
the `private` adds is the compile-time wall.

## Related gaps (not required, noted while here)

- The subclass's override returns the same `SubprocessSpawnSpec` shape; if
  the spawn spec ever grows a subclass-relevant extension point (for example
  a documented place to carry per-spawn diagnostics), the bridge widens
  accordingly.

## Removing the bridge

Once the upstream declaration is `protected` (or `spawnSpec` is otherwise
re-opened), this repository deletes:

1. the `@ts-expect-error` on the `extends` clause of `WslShellExecutor`,
2. the `SpawnSeamExecutor` type alias and the `inheritedSpawnSpec` constant,
3. and calls `super.spawnSpec(spec, argv, stdoutMaxBytes, signal)` directly,
   restoring the plain override.

Then run `pnpm test`: the `spawnSpec pins the host cwd, WSL_UTF8, and the
managed WSLENV translation` check in `test/provider.test.mjs` fails if the
rewritten `cwd` or environment stops reaching the spawn spec.
