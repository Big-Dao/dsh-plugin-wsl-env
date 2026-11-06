# Upstream report: background jobs are killed at session re-adoption

Status: **filed upstream as
[#12433](https://github.com/deepseek-ai/deepseek-harness/discussions/12433)
(2026-11-06; General category — the repository disables issues).** Evidence
complete. Target: the DeepSeek Harness repository; #10263 is the precedent for
session-surface asks.

## Symptom

Close the desktop app window while a background job is in flight, wait, reopen:
the session's history and conversation state survive (persistence works, the
reopened page shows the same conversation), but the in-flight background job
has been killed with SIGTERM. The app's own first-hide notice promises
"正在运行的任务不会中断" — the promise is broken by the reopen, not the close.

## Evidence (2026-11-06, real machine, Windows 11 + WSL2, desktop app)

Two-probe experiment. Probe A: harness background jobs (1 Hz heartbeat
appending timestamps, plus a 150 s sleep writing a marker). Probe B: a
`setsid`-detached process inside the same WSL distro, outside the session's
managed process tree, as a control. The maintainer closed the window with the
X button (tray icon stayed — process resident), waited ~2 minutes, reopened.

| Observation | Value |
|---|---|
| Managed job lifetime | died at reattach: probe A kill at +119 s (close ≈ +5 s, reopen ≈ +120 s); probe A2 kill at 17:40:58 with reopen ≈ 17:41:00 |
| Kill detail | bare `signal: SIGTERM` — producer facts only, no kill reason recorded |
| Detached control | survived the whole close/reopen cycle, still ticking minutes later |
| Host process identity | never restarted — the WSL plugin's Host-level singleton resident agent (started 16:33:37, before all probes) is the same instance serving after reopen |
| Distro children of the app | inotify watch loop started 16:59:13 also survived both cycles |
| Session state | conversation context fully intact after reopen |

Conclusion: window close kills nothing (the tray-residency promise is kept);
the SIGTERM lands at session re-adoption, scoped to the session's managed
process tree; the Host, the plugin substrate, and unmanaged distro processes
are untouched.

## Source-level chain (dsh `v0.2.2-rc.1` line)

1. Window close is hide-only: `apps/desktop/src/main.ts` — "Closing hides: the
   page and the Host keep running, and the next show resumes the same
   document." Matches the tray observation.
2. Managed background shells die at composition teardown:
   `packages/shell/bash-local/src/index.ts` — "still-running background process
   stays managed (killed and joined at composition teardown) even across an
   executor reload", with managed-range SIGTERM→SIGKILL escalation. Matches the
   bare producer-facts kill detail.
3. The disposal path: `session/disposed` → `machine.cancel({ kind: 'disposed' })`
   → `machine.scope.dispose()` (`packages/core/agent-loop/src/index.ts`) →
   cordis scope teardown → the bash provider's managed-range kill. So a session
   scope disposal necessarily kills in-flight managed background jobs.
4. The Host did not restart (singleton evidence above), so the disposal was
   emitted by the living Host during re-admission.

## The reload signal

Design says the next show "resumes the same document". Observed otherwise: the
session's per-turn runtime metadata carried the browser time zone on every turn
before the close, and `unavailable` on every turn after the reopen — the client
did not resume the same document; it booted fresh. Combined with the collision
boundaries in `packages/core/session/src/index.ts` (`enter()` refuses to
overwrite a live store entry; resume dedupes concurrent resumes in
`packages/api/session-controller/src/agent.ts`), the intended semantics is
clearly reuse of the live session. The fresh boot instead ends up disposing the
live session scope and rebuilding it — which is what kills the jobs.

## Reproduction

1. Open a session, start a background job that runs for minutes (e.g. `sleep
   300; date > /tmp/marker`), confirm it is running.
2. Close the app window with X (tray stays).
3. Wait ~2 minutes, reopen the window, return to the same session.
4. The job reports `killed, signal: SIGTERM`; the marker is never written.
   Session history is intact, which is the contradiction: persistence was
   considered worth preserving, the work was not.

## Expected

Re-adoption reuses the live session scope (as `enter()`/resume-dedup intend);
in-flight background jobs continue across hide/reopen. Alternatively, if
disposal on fresh boot is intended, the hide notice must stop promising that
running tasks will not be interrupted.

## Notes

- The WSL plugin (dsh-plugin-wsl-env) is not involved: its transport chain and
  Host-level singletons survived, and the control process rode the same
  wsl.exe path while escaping the kill.
- Happy to test a fix or provide more instrumentation on this machine.

## 中文版（双语报告后半）

### 摘要

桌面应用（Windows）窗口收进托盘时若有后台任务在飞，**重新打开窗口的瞬间任务会被 SIGTERM 杀死**——而会话历史完好保留。这与首隐藏提示的承诺「正在运行的任务不会中断，可在系统托盘中重新打开窗口」直接矛盾。

### 环境

- DeepSeek Harness 桌面版，Windows 11 + WSL2（Ubuntu），观察于 0.2.2-rc.1 线
- 会话经内嵌窗口使用；Host 进程驻留托盘

### 复现步骤

1. 打开会话，启动一个运行数分钟的后台任务（如 `sleep 300; date > /tmp/marker`），确认在跑。
2. 点 **X** 关闭窗口（托盘图标保留——进程驻留）。
3. 等约 2 分钟，重开窗口，回到同一会话。
4. 任务显示 `killed, signal: SIGTERM`；marker 未落盘。会话历史完好——这正是矛盾点：持久化被保住了，工作没保住。

### 证据（2026-11-06，双探针实验）

探针：harness 后台任务带 1 秒心跳时间戳（另有 150 秒 marker sleep）；对照组为同一 WSL distro 内 `setsid` 脱离会话受管进程树的进程。

| 观测 | 数值 |
|---|---|
| 受管任务死亡时刻 | 重开瞬间：第一轮 kill 在 +119 s（关闭 ≈ +5 s，重开 ≈ +120 s）；第二轮 kill 17:40:58，重开 ≈ 17:41:00 |
| 死亡详情 | 裸 `signal: SIGTERM`——仅生产者事实，无 kill reason |
| 脱离对照组（同 distro、同 wsl.exe 路径） | 跨整个关窗/重开周期存活，数分钟后仍在跳 |
| Host 进程身份 | 从未重启——WSL 插件的 Host 级单例常驻 agent（16:33:37 启动，早于全部实验）在重开后仍是同一实例 |
| 会话状态 | 重开后对话上下文完整 |

结论：关窗不杀任何东西（托盘驻留承诺兑现）；SIGTERM 落在**重开时的会话重新接管**，范围是会话的受管进程树。

### 源码级分析（v0.2.2-rc.1 线）

1. 关窗只 hide：`apps/desktop/src/main.ts`——"Closing hides: the page and the Host keep running, and the next show resumes the same document."
2. 受管后台 shell 死于组合拆卸：`packages/shell/bash-local/src/index.ts`——"still-running background process stays managed (killed and joined at composition teardown) even across an executor reload"，托管段 SIGTERM→SIGKILL 升级。与裸生产者事实的死亡详情吻合。
3. 拆卸路径：`session/disposed` → `machine.cancel({ kind: 'disposed' })` → `machine.scope.dispose()`（`packages/core/agent-loop/src/index.ts`）→ cordis 作用域拆卸 → bash provider 清理托管 PID 段。会话作用域被 dispose，在飞受管后台任务必然被杀。
4. Host 未重启（见上单例证据），所以 dispose 是活着的 Host 在重接管时发出的。

### 重载信号

设计说下次显示"恢复同一文档"。实测不然：关闭前每轮的会话运行时元数据都带浏览器时区，重开后每轮变成 `unavailable`——客户端不是恢复同一文档，而是全新启动。结合 `packages/core/session/src/index.ts` 的冲突边界（`enter()` 拒绝覆盖同 id 活条目）与 `packages/api/session-controller/src/agent.ts` 的 resume 去重，设计语义显然是**复用活会话**——但新引导最终把活会话作用域拆掉重建，这正是杀任务的那一步。

### 期望

重接管复用活会话作用域；在飞后台任务跨 hide/reopen 继续。或者，如果新引导时拆卸是有意为之，首隐藏提示必须停止承诺"运行中的任务不会中断"。

### 备注

- 现场有 WSL 工作区插件（dsh-plugin-wsl-env）；对照进程走同一条 wsl.exe 路径却逃过一劫、Host 级单例全部存活，插件已排除嫌疑。
- 愿意配合测试修复或在本地做更多插桩。
