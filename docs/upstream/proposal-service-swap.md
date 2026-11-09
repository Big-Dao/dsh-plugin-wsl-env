# Submission payload: a same-name service swap that survives live recomposition

Ready to file against `deepseek-ai/deepseek-harness`. **Not filed**: creating a
public upstream discussion is a maintainer action; this file is the exact body
so the filing is one command.

- Repository: `deepseek-ai/deepseek-harness`
- Title: `Proposal: a same-name service swap that survives live recomposition`
- Suggested labels: `bug`, `area:plugin` (adjust to the repository's current
  labels)

Command (from a checkout of this repository, with `gh` authenticated):

```bash
gh issue create --repo deepseek-ai/deepseek-harness \
  --title "Proposal: a same-name service swap that survives live recomposition" \
  --body-file docs/upstream/proposal-service-swap.md
```

---

## Body

A plugin row that **replaces** a shipped row providing the same cordis service
cannot activate through a **live** bundle enable/disable cycle while any
consumer still holds the shipped service. The enable reports `operation-error`
with a diagnostic of the shape:

```
dsh: warning: 3 entries did not activate
subprocess-wsl (dsh-plugin-wsl-env/subprocess): Error: service "subprocess" has been registered at <LocalSubprocessRuntime>
directory-picker-wsl (dsh-plugin-wsl-env/picker): Error: service "directoryPicker" has been registered at <NativeDirectoryPicker>
fs-routing (dsh-plugin-wsl-env/fs-routing): Error: service "fs" has been registered at <SandboxedFileSystem>
```

The composition itself is correct — the same patch list over an empty root (a
restart, or the install-time path) disables the shipped rows and activates the
replacements cleanly. Only the hot path fails, and the failure is terminal for
that fiber: recomposition does not retry it, so the enable stays failed until a
restart.

### Mechanism

Two independent version changes compose into the failure.

1. **cordis 4.1.0 defers provision disposal behind dependent drain.**
   `Fiber._unload` gained a first step that 4.0.5 did not have:

   ```js
   // 4.1.0 — provisions release only after every dependent has released
   while ([...this.provisions].some((impl) => impl.dependents.size))
     await new Promise((resolve) => this._release = resolve);
   await Promise.all(this._disposables.clear().map(...));   // disposers run HERE
   ```

   4.0.5 ran the disposers first thing. The provide disposer's synchronous
   `delete this.store[...]` — the moment the service registration slot frees —
   therefore moves from "at dispose() call time" to "after every dependent
   fiber has released the service".

2. **loader 1.1.0 awaits the disabled transition.** `Entry.update`'s disabled
   branch changed from `this.fiber?.dispose()` (1.0.5, fire-and-forget) to
   `await this.fiber?.dispose()` (1.1.0), so the disable parks on the same
   dependent drain.

`EntryGroup.update` runs the disable and the insert of one recomposition in one
`Promise.all`, so the challenger fiber starts — imports, applies, calls
`ctx.provide` — while the shipped fiber still holds the registration. Cordis's
guard throws, the challenger's fiber enters `FAILED`, and `recompose` reports
every such entry as an introduced failure. With live sessions holding the
service, the drain gate is exactly the thing that cannot clear: the old
implementation waits for dependents to release, and the dependents would only
release onto a replacement that cannot register.

### Isolated reproduction

One file, driven against both version pairs (a `cordis:group` group, one
provider, one challenger for the same service name, one dependent that
releases on a 2 s timer):

| Versions | During the hold | Error |
|---|---|---|
| cordis 4.0.5 + loader 1.0.5 (the 0.2.1 npm line) | challenger `ACTIVE` | none — the shipped slot frees at dispose() call time |
| cordis 4.1.0 + loader 1.1.0 (bundled in the desktop `0.2.2-rc.1`) | challenger `FAILED`, shipped `UNLOADING` | `service "demo" has been registered at <shipper>` |

After the hold drains, the 4.1.0 challenger stays `FAILED` — the collision
error is terminal for that fiber; recomposition does not retry it.

### Scope

Any bundle whose rows take over a shipped service **by the same service name**
on a profile that hot-reloads (the desktop with HMR enabled). Rows that provide
distinct service names, config-only patches, and preset-realm mounts are
unaffected — the collision needs the same isolate label on the same realm.
Concrete color from this plugin: the three root-plane takeovers
(`subprocess-wsl`, `fs-routing`, `directory-picker-wsl`) are the full affected
set; `wsl-shell-env`, `auto-preset`, `wsl-preflight`, and `preset-wsl` activate
through the same toggle without complaint.

### What would fix it

The disable-then-insert ordering inside one group update cannot fix this by
itself — under the retain-until-drained semantics the old registration
survives the whole drain, however ordered. Directions that would:

- **Stage the swap on the provide side**: when a fiber's `ctx.provide`
  collides with an implementation that is currently UNLOADING, queue the
  registration and complete it when the old implementation's disposer frees
  the slot, instead of throwing.
- **Two-phase group updates**: run every disable transition to settlement (or
  at least to provision release) before starting any insert transition — the
  reverse of the `Promise.all` ordering, and enough for every takeover where
  the old service's dependents can drain onto nothing (no live sessions) or
  onto preset-realm replacements.
- **A loader-level retry**: an entry whose activation failed with a
  registration collision against a draining fiber is retried once that fiber
  reaches `DISPOSED`. The failed state is otherwise terminal, so today's
  behavior converts a transient overlap into a permanent per-entry failure.

### Versions

- First seen on the desktop `0.2.2-rc.1` release (app-bundled
  `@deepseek-ai/cordis@4.1.0` +
  `@deepseek-ai/cordis-plugin-loader@1.1.0`); reproduced in isolation against
  both version pairs on 2026-11-05; the mechanism is confirmed down to the
  `_unload` diff. At the time of the observation the npm line still shipped
  cordis `4.0.5` / loader `1.0.5`, where the same swap completes (the slot
  frees at dispose() call time).
- Reported from `dsh-plugin-wsl-env` `0.22.0` (2026-11-08), which pins
  `@deepseek-ai/cordis` `4.1.0` and `@deepseek-ai/cordis-plugin-loader`
  `1.1.0` (devDependencies) and declares the peer range
  `@deepseek-ai/cordis` `^4.1.0`.

Full context, the operator-facing workaround and this plugin's use of the
swap: `docs/UPSTREAM-SERVICE-SWAP.md` in `Big-Dao/dsh-plugin-wsl-env`.

---

（中文摘要：同名服务热替换在运行中的组合上无法完成——插件行按同名接管宿主
cordis 服务（如 `subprocess-wsl` 接管 `subprocess`）时，只要有消费者仍持有
旧服务，热路径 enable 必然失败，报 `service "X" has been registered at
<旧实现>`；同样的 patch 列表走冷组合（重启或安装路径）完全正确。机制是两个
独立版本变化叠加：① cordis 4.1.0 的 `Fiber._unload` 把 provision 释放推迟
到全部依赖方排空之后（4.0.5 先跑 disposer，注册槽在 dispose() 调用时即释
放）；② loader 1.1.0 的 `Entry.update` 把 disable 分支改为
`await this.fiber?.dispose()`，disable 停在同一个排空门上。而
`EntryGroup.update` 用一个 `Promise.all` 同时跑 disable 与插入——挑战者在
旧实现仍持有注册时启动，撞守卫进入 `FAILED`，且该状态是终态、重组不重试，
繁忙 profile 上 enable 确定性失败，直到重启。隔离复现：同组一提供者一挑战
者一定时释放的依赖者，4.0.5+1.0.5 挑战者 `ACTIVE` 无错，4.1.0+1.1.0 挑战者
`FAILED`。影响面：热重载 profile 上按同名接管宿主服务的行；不同名、纯配置
patch、preset 领域挂载不受影响。修复方向（三选一即可）：provide 侧对
UNLOADING 中的实现暂存注册、排空后补完成；组更新两阶段化（disable 全部落
定后再插入）；或 loader 对撞名失败的条目在旧 fiber 到达 `DISPOSED` 后重试
一次。完整上下文见 `Big-Dao/dsh-plugin-wsl-env` 的
`docs/UPSTREAM-SERVICE-SWAP.md`。）
