# 性能：ext4 agent 对比 9p 共享

[English](PERFORMANCE.md)

本插件存在的理由不只是正确性：通过 Windows 9p 共享提供的 WSL 工作区，
明显慢于经常驻 agent 在发行版 ext4 上读取同样的文件。本页记录测量结果及
复现方法；不对测量范围之外做推断。

## 两种 substrate

| | 9p 共享（`\\wsl.localhost\...`） | 本插件 |
|---|---|---|
| 文件 I/O | 宿主栈每次操作都跨越 VM 边界 | 常驻 agent 在发行版内、目标的后备文件系统上提供读写 |
| 变更通知 | 轮询该共享 | 可用时对无界目录使用 inotify，否则轮询 |
| 命令 | 宿主进程 | 经 `wsl.exe` 的发行版登录 shell |

插件的根文件系统将每条 WSL 路径路由到发行版后端（`fs-routing`），因此
GUI 文件树、预览和模型的文件工具都走 agent 路径。设计与权衡见
[root-fs-routing.md](root-fs-routing.md)；已知限制见
[LIMITATIONS.zh.md](LIMITATIONS.zh.md)。

## 测量数字

机器：Windows 11 + WSL 2，Ubuntu，x86_64，即本项目的开发机。绝对数字
取决于机器；比例和预算才是重点。

| 场景 | 9p 共享 | Agent（ext4） | 来源 |
|---|---|---|---|
| 16 个并发共享读取，shell agent 对比 native agent | — | shell：342–614 ms（排队最高 583 ms）；native：A7 之后 **2.4–4.1 ms**，首次启动约 70 ms（仅一次） | [ADR 0002 fs 队列](adr/0002-native-agent.md#fs-queue-measurement-a6-2026-10-18) |
| 单次 FS 操作（宿主往返） | — | p95 ≈ 22 ms | [ROADMAP-1.0.md](ROADMAP-1.0.md#7-metrics) |
| GUI 预览后端：`stat` | — | p95 **2.7 ms** | `pnpm run probe:gui-preview`（20 次迭代，2026-10-19） |
| GUI 预览后端：目录列举 | — | p95 **5.1 ms** | 同上 |
| GUI 预览后端：1 MiB 页面 | — | p95 **63.5 ms/MiB** | 同上 |
| 整文件读取 1 MiB（native agent） | — | 中位 **15.0 ms**（读窗口放进批量帧时为 26.6 ms） | #76，2026-11-24 |
| 解析一个 16 MiB 的响应帧（按 64 KiB 分块到达） | — | 占用宿主事件循环 **83 ms**（逐块拼接到一个增长的字符串时为 2678 ms） | 同上，纯宿主侧 |
| 列举含 200 个符号链接的目录 | — | 中位 **6.1 ms**（每个链接各走两次往返时为 136.3 ms） | 同上 |

2026-11-24 的前三行在 WSL 2 Ubuntu x86_64 上测得：native agent 直接在
发行版内启动（不经 `wsl.exe`），取 15 次运行的中位数；括号里是同一台
机器上改动之前的代码。它们对应三处结构性开销——读载荷在批量帧里被
base64 编码两次、每来一块就把整帧重新拼接并扫描、每个符号链接各付两次
往返——所以消除的是随大小平方增长的那一项，而不只是常数。

GUI 预览数字覆盖一次预览所支付的、经路由的后端操作。随包的
`workspace-files` 服务会在其上追加自己的调用；该服务的形态在
[LIMITATIONS.zh.md](LIMITATIONS.zh.md) 中保持定性描述。1 s/MiB 预算余量
很大，因此这些测量并不构成进一步优化（被推迟的 v6 FS 并发）的理由。

## 复现

在发行版内，使用该 checkout：

```bash
pnpm run probe:gui-preview        # stat / listDir / 1 MiB page read, p50/p95
node test/probe/fs-queue.mjs      # the agent queue, sequential vs concurrent, with per-op latency
```

两者都需要 WSL 互操作、可用的发行版和 Node；都不启动 harness。队列测量还
需要 systemd 和可用的原生二进制；它打印实际耗时和队列指标，但不强制延迟
预算。GUI 预览探针报告 p50/p95/max，并在超出预算时失败。

## 未测量的内容

- 端到端 GUI 绘制时间（浏览器和服务自身的工作不在这些探针范围内）。
- 大文件或大量小文件的 9p 数字；A6 比较的是 shell 与 native agent，而不是
  Windows 侧的 9p 共享。
- 物理 aarch64 硬件上的 WSL 延迟（原生 18 项检查套件在 CI 中于 qemu 下
  运行；那是功能正确性，不是宿主往返测量）。
