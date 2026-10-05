# Upstream proposal: re-open `LocalBashExecutor.spawnSpec` to subclasses

Status: draft, targeting `deepseek-harness` @ `packages/bash/bash-local`
(version line `0.2.0-rc.x`). This is the record of a seam this plugin must
override but cannot reach through the supported surface, and of the temporary
bridge this repository carries until the seam opens.

## The requirement

`dsh-plugin-wsl-env` runs every shell command inside a WSL distro. It
subclasses `LocalBashExecutor` and replaces exactly two things: the argv
(`wsl.exe -d <distro> --cd <linux dir> --exec <shell> -lc <cmd>`) and the
process working directory. The second replacement is not a preference —
**a `wsl.exe` child process must be started from a Windows directory**.
`spec.workdir` is a Linux path, which a Windows `CreateProcess` call cannot
use as `cwd`; the Linux directory rides on `--cd` instead, and the spawn
itself starts in `hostCwd` (the operator's `SystemRoot`, or `process.cwd()`).

The executor's own machinery — deadlines, output caps, spill files, managed
background processes — is the shipped implementation's and is inherited
verbatim. But that machinery ends in one place subclasses are expected to
customize:

```js
running = this.ctx.subprocess.spawn(this.spawnSpec(spec, argv, spec.stdoutMaxBytes, spawnSignal));
```

## The gap

`spawnSpec` is declared `private` on `LocalBashExecutor` (both in the
implementation and in `lib/types/index.d.ts`):

```ts
/** Map one resolved bash spec and explicit argv onto a fully-specified subprocess spawn. */
private spawnSpec(spec: ShellExecSpec, argv: readonly string[], stdoutMaxBytes: number, signal?: AbortSignal): SubprocessSpawnSpec;
```

A subclass that must override it therefore faces a closed door:

- TypeScript rejects the subclass (`TS2415`) and any `super.spawnSpec` call
  (`TS2855`), so the natural extension point is unusable in checkJs strict
  builds — which this plugin runs as a CI gate.
- The private declaration is upstream's own extension seam by intent
  elsewhere: `executeArgv` is `protected` precisely so subclasses can replace
  the argv at the execution boundary. The spawn *spec* is the other half of
  that same boundary — the argv says what to run, the spec says where and
  with which environment — and only the first half is open.

## The workaround this repository carries

`lib/index.js` bridges the gap at the type level, without touching the
runtime class:

- The `extends` clause carries a `@ts-expect-error` naming this file, so the
  one deliberate contract break is visible in review instead of hidden.
- The inherited builder is captured once through the `SpawnSeamExecutor`
  typedef (an `Omit`-and-reopen of the base class) and invoked by prototype,
  so `super.spawnSpec` semantics are preserved through a single, typed point:

```js
const inheritedSpawnSpec = /** @type {SpawnSeamExecutor["spawnSpec"]} */ (
  /** @type {any} */ (LocalBashExecutor.prototype).spawnSpec
);
```

The override then only rewrites `cwd` and `env` (UTF-8 pinning for `wsl.exe`
diagnostics, the managed `WSLENV` translation) and keeps everything else the
base produced, spread verbatim.

## The suggested upstream change

One keyword, no behaviour change:

```diff
--- a/packages/bash/bash-local/lib/index.ts (and its .d.ts)
+++ b/packages/bash/bash-local/lib/index.ts
@@
-  private spawnSpec(spec: ShellExecSpec, argv: readonly string[], stdoutMaxBytes: number, signal?: AbortSignal): SubprocessSpawnSpec;
+  protected spawnSpec(spec: ShellExecSpec, argv: readonly string[], stdoutMaxBytes: number, signal?: AbortSignal): SubprocessSpawnSpec;
```

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
2. the `SpawnSeamExecutor` typedef and the `inheritedSpawnSpec` constant,
3. and calls `super.spawnSpec(spec, argv, stdoutMaxBytes, signal)` directly,
   restoring the plain override.
