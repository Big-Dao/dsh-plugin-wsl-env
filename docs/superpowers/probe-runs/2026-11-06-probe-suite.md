# 2026-11-06 真机探针全套（首个 17 项套件）

## 环境

- 插件 checkout `20fa64d`（v7 协议、doctor `--wsl`、`./index` 子路径均已包含），
  外加当日未提交的 `two-distro-probe.mjs` 断言载体修复。
- Node 24.19.0（distro 内），Windows 侧 Harness 已关闭（套件自启 CLI 实例）。
- 机器：单机双 distro（默认 distro + 一个第二 distro），非矩阵结果。

## 结果

套件 17 项：16 通过，`two-distro.sh` 失败（首跑）；修复后单独复跑通过。
最终状态：**17 项探针在本机全部有通过记录**。

- PASS：run.sh、terminal.sh、mode.sh、missing-wsl.sh、sandbox.sh、
  sandbox-shell.sh、interop-shell.sh、sandbox-off.sh、picker.sh、
  fs-routing.sh、agent.sh、**agent-restart.sh（WSL-207 kill/restart 腿，首跑）**、
  watch.sh、substrate.sh、exec.sh、native-session.sh；
  以及修复后的 **two-distro.sh（WSL-101 并发腿，首跑）**。
- 完整日志：`test/probe/.scratch/full-probe.gCGnY6.log`（14:33 套件）。

## two-distro 首跑失败的根因与修复

失败形态：6 个 `printf "$DSH_WSL_DISTRO"` 检查全 FAIL（stdout 为空），
全部 workdir 检查（含并发与 burst 交错）通过——路由本身无恙。

根因：探针把"落在自己的 distro"的断言载体选成了会话环境变量。
`dsh-plugin-wsl-env/shell-env` 的 `resolve` 从
`execution.agent.session.header.cwd` 读工作区 distro，而探针经
`ctx.shell.resolve({ command, workdir })` 直接驱动、没有 agent 会话，
托管 `DSH_*` 命名空间在该 seam 上合法缺席。这是探针设计缺陷，
不是产品回归。

修复：改为在各 distro 的 `/tmp` 各植一个标记文件（两个 distro 的
`/tmp` 是独立文件系统，正是被测性质），每条腿报告自己看到的标记，
顺序/并发/burst 三种交错下均断言不串；结束时清理标记。复跑 8 项
检查全 PASS。

## 环境插曲

套件运行与复跑之间，WSL 的 `C:` drvfs（9p）挂载整体翻成只读，
`sync-to-windows` 以 tar exit 2 失败。按会话独立挂载命名空间在普通
终端 `umount -l` + 重新 `mount -t drvfs -o rw` 后恢复。探针失败与此
无关（失败早于挂载翻转）。

## 与 0.19.0 发版的关系

`RELEASING.md` 要求行为变更后重跑全套并留存输出——本记录即为该
证据。发版说明可如实声明：17 项真机探针全部通过（two-distro 经
一次探针侧修复后通过；失败非产品缺陷）。e2e:install 自 2026-10-19
未重跑，发布说明须保持该行如实。
