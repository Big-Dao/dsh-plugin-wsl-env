# API 表面

_本页是权威版本；英文译本见 [API surface](API.md)。_

已发布的 API 就是每个编译模块旁生成的 `lib/*.d.ts`（`pnpm run build` 保持
其逐字节最新；`lint:build` 在发生漂移时失败）。`package.json` 中的
`exports` 映射是消费者可导入内容的权威；本页是快速导览。

| 子路径 | 导出 | 角色 |
|---|---|---|
| `.` | — | 有意为之的空操作根宿主半边：一个在裸包名处挂载的空操作插件，用于锚定其下的浏览器客户端（0.21.0 之前这里解析到执行器本身——见 `./shell`） |
| `./shell` | `WslShellExecutor` | 面向模型的 shell 执行器（`ctx.shell`），挂载在 WSL preset 的 isolate realm 内 |
| `./client` | —（无可导入表面） | harness 的 web 客户端加载器为裸包名行提供的浏览器半边：侧边栏状态面板与访问模式提示 |
| `./fs` | `WslFileSystem` | 发行版之上的文件系统提供者（`ctx.fs`） |
| `./index` | `WslShellExecutor`、`WslFileSystem`、`doctorReport`、`effectiveMaskWindowsDrive`、… | 组合根完整的具名表面——集成 API（`doctorReport` 供需要 doctor 版本化报告的工具体使用） |
| `./fs-routing` | `WslRoutingFileSystem` | 根平面坐标路由器 |
| `./wsl` | `defaultShell`、`listDistros`、`shellArgs`、`wslTerminalArgv`、… | `wsl.exe` 互操作原语 |
| `./agent` | `WslAgent` | 常驻 agent 传输层 |
| `./subprocess` | `WslSubprocessRuntime` | 终端/子进程运行时 |
| `./preflight` | `wsl-preflight` 行 | 会话启动提示（以及在插件加载时以 `startup: true` 执行一次） |
| `./cwd-prompt` | `wsl-cwd-prompt` 行 | 将运行时上下文的工作目录改写为发行版的 POSIX 形式 |
| `./cwd-prompt-tool` | `wsl-cwd-prompt-tool` 行 | 为模型的读取/`cd` 工具提供以发行版 POSIX 形式表示的 `cwd` 输出 |
| `./file-reference-wsl` | `traversalArgv`、`parseTraversalListing`、`FileReferenceTraversal`、… | 用于 `@` 补全的发行版侧遍历策略（纯库——已构建并测试，尚未接入行；见 ARCHITECTURE） |
| `./wsl-doctor-tool` | `wsl-doctor-tool` 行 | `wsl_doctor` 模型工具：带作用域（`depth`、`section`）的进程内诊断 |
| `./wsl-doctor-command` | `wsl-doctor-command` 行 | `/wsl-doctor` UI 命令：启动独立 doctor CLI，渲染结果不进入模型历史 |
| `./status` | `wsl-status` 行 | 侧栏面板经 `/api` 的路由：已安装发行版、单个发行版的快速 doctor，以及 `--fix-owned` 完整运行（可修复时修复，否则完整检查）；最近结果跨重载保留，运行中发行版的已存结果在后台刷新 |
| `./paths` | `uncToPosix`、`toLinuxPath`、`toWorldPath`、… | 坐标映射器 |
| `./picker` | `WslDirectoryPicker` | 能感知发行版的目录选择器 |
| `./auto-preset` | `auto-preset` 行 | 首次运行的 profile 引导 |
| `./shell-env` | `wsl-shell-env` 行 | `DSH_WSL_*` 事实注册表 |
| `./update-check` | `wsl-update-check` 行 | 每天一次的更新提示（事实存储 + 委托宿主的检查） |

`./<name>/locale/*.json` 子路径承载 Plugins 页面的显示元数据和运行时消息
目录；`./package.json` 重新导出 manifest。

稳定性：工具名和错误码属于 API（[MIGRATION.zh.md](MIGRATION.zh.md)）；
运行时行的配置键记录在
[CONFIGURATION.zh.md](CONFIGURATION.zh.md) 中。
