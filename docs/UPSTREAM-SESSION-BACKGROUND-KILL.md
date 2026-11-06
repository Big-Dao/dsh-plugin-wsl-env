Closing the desktop window to the tray while a background job runs, then reopening, kills the job with SIGTERM. Session history survives, so nothing was lost on the persistence side — only the running work. The first-hide notice says 「正在运行的任务不会中断」, which this contradicts.

Windows 11 + WSL2 (Ubuntu), desktop app on the 0.2.2-rc.1 line, session in the embedded window.

Reproduce: start `sleep 300; date > /tmp/marker` as a background job, close the window with X, wait ~2 minutes, reopen the same session. The job reports `killed, signal: SIGTERM`, no marker. History is intact.

I instrumented this rather than guessing. Two runs, with a 1 Hz heartbeat job as the probe and a `setsid`-detached process in the same WSL distro as an out-of-tree control:

- The kill lands at reopen, not close. Run 1: kill at +119 s with close at ~+5 s and reopen at ~+120 s. Run 2: kill 17:40:58, reopen ~17:41:00.
- The kill detail is a bare `signal: SIGTERM` with no kill reason — the producer died before the jobs registry could record one.
- The detached control survived both cycles; minutes later it was still ticking.
- The Host process never restarted: a Host-level singleton in the WSL plugin I use was started at 16:33:37, before the probes, and is still the same instance serving after reopen.

So the close is innocent; the session re-adoption on reopen tears down the live scope, and that teardown kills the managed background jobs. I read the source rather than stopping at the measurement:

- `apps/desktop/src/main.ts`, close handler: "Closing hides: the page and the Host keep running, and the next show resumes the same document." Matches the tray behavior I saw.
- `packages/core/agent-loop/src/index.ts` (~496-524): session teardown does `machine.cancel({ kind: 'disposed' })` then `machine.scope.dispose()`. That scope carries the bash provider, whose disposal kills still-running managed processes.
- `packages/shell/bash-local/src/index.ts` header: background processes are "managed (killed and joined at composition teardown) even across an executor reload" — the SIGTERM our jobs died with is exactly this escalation, and the missing kill reason matches: the producer is dead before `jobs-local`'s settlement (~line 607) can record one, so only the producer facts survive.
- Reuse is the intended semantics: `packages/core/session/src/index.ts` `enter()` refuses to overwrite a live store entry, and `packages/api/session-controller/src/agent.ts` dedupes concurrent resumes. But the reopen booted a fresh page, not the resumed document — the session's runtime metadata carried the browser time zone on every turn before the close and `unavailable` on every turn after — and the fresh boot disposed the live scope instead of reusing it.

Expected: re-adoption reuses the live session scope and background jobs keep running across hide/reopen. If tearing down on fresh boot is intended, the hide notice shouldn't promise that running tasks won't be interrupted.

Notes: a WSL-workspace plugin was active; the control process rode the same wsl.exe path and survived, and the plugin's Host-level singletons survived, so it's not part of this. Glad to test a fix or add instrumentation.

（中文摘要：关窗收进托盘时在跑的后台任务，在重开窗口的瞬间被 SIGTERM 杀掉，会话历史完好。两轮插桩实验把死亡时刻钉在重开瞬间；`setsid` 脱离进程树的对照进程存活，插件 Host 级单例（16:33 启动）重开后仍是同一实例，Host 未重启。源码链：main.ts 关窗只 hide；agent-loop 的会话销毁 `machine.cancel({kind:'disposed'})` + `scope.dispose()`；bash-local 在组合拆卸时 SIGTERM 托管后台进程（无 kill reason 与 jobs-local 的 producer-facts-first 结算吻合）；`enter()` 和 resume 去重表明设计意图是复用活会话，而重开实际全新引导页面（会话元数据里浏览器时区从有变 unavailable）并把活作用域拆了。期望：重接管复用活会话，后台任务跨 hide/reopen 存续。复现：后台跑 `sleep 300; date > /tmp/marker`，X 关窗 2 分钟，重开即杀。）
