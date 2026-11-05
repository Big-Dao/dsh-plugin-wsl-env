# 真机探针套件记录 — 2026-11-05

v0.18.0（peer 0.2.2-rc.1 升版 + 桌面版适配）的发布证据。执行方式同
2026-11-02：distro 内 detached 启动 `run-all-when-closed.sh --include-fs`，
脚本轮询等 Harness 全部会话退出后自动运行 15 项。

## 环境

- Windows 11 + WSL 2，x86_64；distro：Ubuntu（systemd）。
- 插件 0.18.0，checkout `460defd`（tag v0.18.0）；运行前执行了
  `wsl --shutdown`，VM 全新。

## 结果

**pass 15 · fail 0 · skipped 0 · not run 0**（FULL PASS，退出码 0）

原始日志与结果行在 `test/probe/.scratch/full-probe.JuBgMi.log` /
`full-probe.35okI1.results`（机器本地，不入库）。

## 同日两次受污染运行的失败分析（均未计入发布证据）

1. **第一次全套**（旧 VM，应用关闭，干净窗口）：14/15，
   `interop-shell.sh` 失败于 `oneshot/visible` 腿——interop 逃逸未观察到，
   `exit=4294967295`。
2. **应用运行期间的单独复跑**：`resident/visible` 腿死于 agent 握手期
   SIGTERM——探针自启实例与存活应用争用同 distro 的常驻 agent 单例，
   作废（与 2026-11-02 watch.sh 的外来循环教训同类）。

## 定性：interop 间歇性故障，非回归

三次失败根因收敛：旧 VM 的 distro→Windows interop 间歇不可用
（`0xFFFFFFFF` 是 wsl.exe interop 失败的典型返回值）。证据链：

- 应用运行期间的复跑换了一种失败（agent 争用），且 resident/visible 腿
  在干净窗口下单独通过——agent 路径本身无恙；
- 干净窗口的定向复跑报 `INCONCLUSIVE`（探针自检的 interop 基线
  `copied executable could not create the marker` 立不起来）——探针自身
  把它分类为基础设施不可用而非断言失败；
- `wsl --shutdown` 后立即全套重跑即 15/15。

0.18.0 的 `src/` 变更（新 fs 操作的诚实拒绝、`additionalWritableRoots`
授予语义）不触碰 interop/one-shot 路径；`interop-shell.sh` 在 2026-11-02
的 0.17.1 全套中通过。

## 后续

1. 跑全套前先 `wsl --shutdown`：旧 VM 的长寿命 interop 偶发失效会污染
   interop-shell（探针的 INCONCLUSIVE 分类已能正确隔离这类失败）。
2. 探针自启实例在应用运行时不可复跑（agent 单例争用），复跑前先关
   应用——本次已按此流程执行。
3. 本记录是单机单次结果，不构成兼容矩阵（同 2026-11-02 记录的口径）。
