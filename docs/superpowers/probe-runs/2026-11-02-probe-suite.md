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

两项均判定为运行环境干扰，非产品回归；判定依据如下。

- **sandbox-shell.sh**：零输出、status 1——与脚本头部文档写明的
  "CLI 把参数转交给存活实例后秒退，无 profile 无探针无输出" 完全一致：
  套件运行中途 Harness 被重新打开。应用打开状态下单独重跑，15 项检查
  全部通过（含沙箱方言、拒绝分类、超时清理等断言）。
- **watch.sh**：唯一失败断言 "closing the watcher stops the distro-side
  loop" 用全局 `pgrep` 计数 `wsl-watch` 循环，把**其他来源的循环**也算进
  来（套件时 14 个陈旧 PID；复跑时 1 个活跃 PID，来自另一 Harness 会话
  的 watcher，正监视 AGENTS.md）。该探针自身启动的循环已正确关闭。

## 后续

1. watch.sh 的循环检查应只统计本探针自身的循环（按其监视目录或
   stamp 归属过滤），否则任何活跃 Harness 会话都会误报——探针健壮性
   缺口，待修复后复跑。
2. sandbox-shell.sh 的失败模式（静默转交）符合文档但不可与"通过"区分
   输出为零的情况——可让探针在检测到转交时显式输出并被记为 SKIP。
   两项均为探针改进，不阻塞本记录的归档。
3. 本记录是单机单次结果，不构成兼容矩阵（同 2026-10-31 记录的口径）。
