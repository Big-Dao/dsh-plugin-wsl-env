## 环境

- DSH Desktop 0.2.1-rc.3（Windows x64）
- Windows 11；已在两类工作区下复现：WSL UNC 路径（`\\wsl.localhost\...`）与纯 Windows 路径，**失败与工作区路径形态无关**
- 复现率：100%

## 现象

主窗口右上角折叠菜单中的“在应用中打开”工具图标，点击 **VS Code** 后弹出“打开失败”toast，VS Code 未启动。受影响的是 Electron 系应用（VS Code 等）；非 Electron 启动器（文件资源管理器、Git Bash、GitHub Desktop）均正常。

## 根因分析

1. 桌面应用通过 `desktopNodeEnvironment()`（`lib/main.js`）以 `ELECTRON_RUN_AS_NODE: "1"` 启动后端 Host 进程。
2. open-in-app 的启动路径 `launchDetachedApp()`（`@deepseek-ai/dsh-host-open-in-app`）构造子进程环境时使用 `scrubbedParentEnv()`，该清洗只剔除匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 与 `DSH_*` 的变量，**`ELECTRON_RUN_AS_NODE` 被原样继承**。
3. 点击 VS Code 时 Host spawn `Code.exe <workspace>`，VS Code（Electron 应用）读到 `ELECTRON_RUN_AS_NODE=1` 后以纯 Node 模式启动：不开窗口、立即退出（exit code 1），落在 launch watch window 内 → 被判为 launch failed → `POST /open-in-app/open` 返回 502 `launch-failed` → 前端 toast。

## 复现实验

用 DSH 自带 runtime 的 node.exe 复刻插件的 spawn（detached + stdio ignore + scrubbed env）：

```text
# 不带该变量：Code.exe 持续运行 → 判定 launched ✅
# 附加 ELECTRON_RUN_AS_NODE=1：
EXITED QUICKLY code=1 signal=null → 502 launch-failed ❌
```

旁证：`dsh-subprocess-local` 在 spawn PTC runtime 时特意清除了 `ELECTRON_RUN_AS_NODE`，说明该变量存在于 Host 进程环境是已知事实，但 open-in-app 的清洗遗漏了它。

## 建议修复

在 `launchDetachedApp()`（或 `scrubbedParentEnv()` 的共享定义）中一并剔除 `ELECTRON_RUN_AS_NODE`，与 `dsh-subprocess-local` 的既有做法保持一致。此类问题对所有基于 Electron 的目标应用（VS Code、Cursor 等）都会出现。
