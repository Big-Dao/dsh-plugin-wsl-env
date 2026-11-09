# Upstream proposal: a same-name service swap that survives live recomposition

Status: observed, filing payload drafted; **not filed yet** — filing against
`deepseek-ai/deepseek-harness` is a maintainer action. The failure was first
seen on the desktop `0.2.2-rc.1` release (app-bundled
`@deepseek-ai/cordis@4.1.0` +
`@deepseek-ai/cordis-plugin-loader@1.1.0`; the npm line still ships
cordis `4.0.5` / loader `1.0.5`), reproduced in isolation against both
version pairs on 2026-11-05, and the mechanism is confirmed down to the
`_unload` diff. The exact filing payload (title, body, command; drafted
2026-11-09) is
[proposal-service-swap.md](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/upstream/proposal-service-swap.md).

## The gap

A plugin row that **replaces** a shipped row providing the same cordis
service (this plugin's `subprocess-wsl` over `subprocess`,
`fs-routing` over `fs-sandbox`, `directory-picker-wsl` over
`directory-picker`) cannot activate through a **live** bundle
enable/disable cycle while any consumer still holds the shipped
service. The enable reports `operation-error` with a diagnostic of the
shape:

```
dsh: warning: 3 entries did not activate
subprocess-wsl (dsh-plugin-wsl-env/subprocess): Error: service "subprocess" has been registered at <LocalSubprocessRuntime>
directory-picker-wsl (dsh-plugin-wsl-env/picker): Error: service "directoryPicker" has been registered at <NativeDirectoryPicker>
fs-routing (dsh-plugin-wsl-env/fs-routing): Error: service "fs" has been registered at <SandboxedFileSystem>
```

The composition itself is correct — the same patch list over an empty
root (a restart, or the install-time path) disables the shipped rows and
activates the replacements cleanly. Only the hot path fails.

## Mechanism

Two independent version changes compose into the failure.

1. **cordis 4.1.0 defers provision disposal behind dependent drain.**
   `Fiber._unload` gained a first step that 4.0.5 did not have:

   ```js
   // 4.1.0 — provisions release only after every dependent has released
   while ([...this.provisions].some((impl) => impl.dependents.size))
     await new Promise((resolve) => this._release = resolve);
   await Promise.all(this._disposables.clear().map(...));   // disposers run HERE
   ```

   4.0.5 ran the disposers first thing. The provide disposer's
   synchronous `delete this.store[...]` — the moment the service
   registration slot frees — therefore moves from "at dispose() call
   time" to "after every dependent fiber has released the service".

2. **loader 1.1.0 awaits the disabled transition.** `Entry.update`'s
   disabled branch changed from `this.fiber?.dispose()` (1.0.5,
   fire-and-forget) to `await this.fiber?.dispose()` (1.1.0), so the
   disable parks on the same dependent drain.

`EntryGroup.update` runs the disable and the insert of one
recomposition in one `Promise.all`, so the challenger fiber starts —
imports, applies, calls `ctx.provide` — while the shipped fiber still
holds the registration. Cordis's guard throws, the challenger's fiber
enters `FAILED`, and `recompose` reports every such entry as an
introduced failure. With live sessions holding the service, the drain
gate is exactly the thing that cannot clear: the old implementation
waits for dependents to release, and the dependents would only release
onto a replacement that cannot register. The enable fails deterministically
on a busy profile and stays failed until a restart.

## Isolated reproduction

One file, driven against both version pairs (`cordis:group` group, one
provider, one challenger for the same service name, one dependent that
releases on a 2 s timer):

| Versions | During the hold | Error |
|---|---|---|
| cordis 4.0.5 + loader 1.0.5 (the 0.2.1 npm line) | challenger `ACTIVE` | none — the shipped slot frees at dispose() call time |
| cordis 4.1.0 + loader 1.1.0 (bundled in 0.2.2-rc.1) | challenger `FAILED`, shipped `UNLOADING` | `service "demo" has been registered at <shipper>` |

After the hold drains, the 4.1.0 challenger stays `FAILED` — the
collision error is terminal for that fiber; recomposition does not
retry it.

## Impact scope

Any bundle whose rows take over a shipped service **by the same service
name** on a profile that hot-reloads (the desktop with HMR enabled).
Rows that provide distinct service names, config-only patches, and
preset-realm mounts are unaffected — the collision needs the same
isolate label on the same realm. This plugin's three root-plane
takeovers are the full affected set here; `wsl-shell-env`,
`auto-preset`, `wsl-preflight`, and `preset-wsl` activate through the
same toggle without complaint.

## What would fix it upstream

The disable-then-insert ordering inside one group update cannot fix
this by itself — under the retain-until-drained semantics the old
registration survives the whole drain, however ordered. Directions
that would:

- **Stage the swap on the provide side**: when a fiber's
  `ctx.provide` collides with an implementation that is currently
  UNLOADING, queue the registration and complete it when the old
  implementation's disposer frees the slot, instead of throwing.
- **Two-phase group updates**: run every disable transition to
  settlement (or at least to provision release) before starting any
  insert transition — the reverse of the `Promise.all` ordering, and
  enough for every takeover where the old service's dependents can
  drain onto nothing (no live sessions) or onto preset-realm
  replacements.
- **A loader-level retry**: an entry whose activation failed with a
  registration collision against a draining fiber is retried once that
  fiber reaches `DISPOSED`. The failed state is otherwise terminal, so
  today's behavior converts a transient overlap into a permanent
  per-entry failure.

## The plugin's posture until then

[docs/LIMITATIONS.md](LIMITATIONS.md#enabling-the-plugin-on-a-running-profile)
records the operator-facing rule: enabling (or re-enabling) the bundle
on a running profile reports the three entries as failed; the selection
is persisted, and **restarting the app applies it** — the cold
composition is correct. Closing sessions first also clears the drain
gate on the hot path, since with no dependents the shipped
implementation releases within the recomposition and the challengers
activate.
