# 真机探针套件记录 — 2026-11-02

工作项 3（真机回归与发布证据）要求的受控真机记录。执行方式：distro 内
detached 启动 `run-all-when-closed.sh --include-fs`，脚本轮询等
Harness 全部会话退出后自动运行 15 项，输出经新四态汇总器结算。

## 环境

- Windows 11 + WSL 2（WSL 3.0.3.0，内核 6.18.54.1-1，WSLg 1.0.79），
  x86_64；distro：Ubuntu（systemd）。
- 插件 0.17.1，checkout `816e80d`（四态汇总器已包含）；Node 24.19.0。
- 执行窗口：应用关闭后自动开始；第 6 项探针期间应用被重新打开（见失败分析）。

## 四态结果

**pass 13 · fail 2 · skipped 0 · not run 0**（退出码 1）

全部 15 项均实际运行；无跳过、无未运行。原始日志与结果行在
`test/probe/.scratch/full-probe.0lQBs9.log`（机器本地，不入库）。

通过：run.sh、terminal.sh、mode.sh、missing-wsl.sh、sandbox.sh、
interop-shell.sh、sandbox-off.sh、picker.sh、fs-routing.sh、agent.sh、
substrate.sh、exec.sh、native-session.sh。
失败：sandbox-shell.sh（status 1）、watch.sh（status 1）。

## 失败分析

- **watch.sh**：唯一失败断言 "closing the watcher stops the distro-side
  loop" 用全局 `pgrep` 计数 `wsl-watch` 循环，把**其他来源的循环**也算进
  来（套件时 14 个陈旧 PID；复跑时 1 个活跃 PID，来自另一 Harness 会话
  的 watcher，正监视 AGENTS.md）。该探针自身启动的循环已正确关闭。
  **已修复（同日，816e80d 之后）：** 检查模式改为 `wsl-watch.*<本探针目录>`，
  只统计监视本探针目录的循环；修复后在同一台机器（外来活跃循环仍在）上
  7/7 通过、退出码 0。
- **sandbox-shell.sh**：零输出、status 1。初判为"应用重开导致 CLI 静默
  转交"，**该归因有误**：此探针以 `ELECTRON_RUN_AS_NODE=1` 自启独立实例
  （`--port 0`），应用打开时单独重跑仍 15 项检查全部通过，说明存活实例
  不影响它。真实原因未定——`set -euo pipefail` 下命令替换或 sourced
  helper 失败会无输出退出。**已改进（同日）：** 探针增加 EXIT 诊断
  trap，早退时报告状态码、行号、overlay 路径与 launcher 日志尾部，
  下次再现时可直接定位。

## 后续

1. ~~watch.sh 循环检查误计外来循环~~——已修复（见上）。
2. sandbox-shell.sh 的无输出早退原因未定，诊断 trap 已就位；待下次
   全套运行观察。若再现，按 trap 输出定位后补充记录。
3. 本记录是单机单次结果，不构成兼容矩阵（同 2026-10-31 记录的口径）。
