# 2026-11-11 真机探针全套（0.25.0 发版前）

## 环境

- 插件 checkout `7556530`（`Release 0.25.0`），Windows 侧 Harness 已关闭，
  套件自启 CLI 实例。
- Node 24.19.0（distro 内），Ubuntu 26.04.1 LTS / WSL 2（内核 6.18.58.1）。
- 单机、单 distro（`ubuntu`）；不是跨发行版矩阵结果。

## 结果

**17 项全部通过**：`run.sh`、`terminal.sh`、`mode.sh`、`missing-wsl.sh`、
`sandbox.sh`、`sandbox-shell.sh`、`interop-shell.sh`、`sandbox-off.sh`、
`picker.sh`、`two-distro.sh`、`fs-routing.sh`、`agent.sh`、
`agent-restart.sh`、`watch.sh`、`substrate.sh`、`exec.sh`、
`native-session.sh`。

套件尾部输出：`probe suite: 17 probes — pass 17, fail 0, skipped 0, not run 0`。
完整日志：`test/probe/.scratch/full-probe.xLcG0r.log`（23:47 套件，git 忽略）。

## 环境插曲：前三次运行为何不算数

探针要求应用关闭，而 agent 会话随应用退出；这轮把四次运行的失败原因记下来，
避免下次重复：

1. **首次（7/17）**：从会话的 `workspace-write` 沙箱分离启动，10 项在
   `sync-to-windows` 的 `tar` 上失败——镜子在工作区外，只读挂载拒绝写入。
   处理：先以 `danger-full-access` 同步一次运行时镜像。
2. **第二次（7/17）**：前 7 项通过后在 `sandbox-off.sh` 的同步中于 23:11:56
   被杀，时间点正是应用重启。分离进程仍在旧会话的 `dsh-wsl-*` scope 里，
   重启的 stale-scope 清扫带走了它。处理：改用独立的 `systemd --user` 单元。
3. **第三次（6/17）**：`systemd --user` 的环境没有 `WSL_DISTRO_NAME`，
   `test/probe/env.sh` 判定“not inside WSL”，11 个 source 它的探针立即中止；
   不 source 的 6 项全过。处理：给单元补 `PATH`、`HOME`、`USER`、
   `WSL_DISTRO_NAME`、`WSL_INTEROP`，先用同一环境 `source env.sh` 自检通过。
4. **第四次（17/17）**：`probe-0250-2.service` 在应用退出后跑完整套件。

结论：三次失败都在探针的启动环境，不是产品回归；第四次的环境组合是这类
“应用关闭后运行”的正确姿势。
