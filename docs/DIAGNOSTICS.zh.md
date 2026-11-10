# 诊断：doctor 与错误码地图

本插件产生的每一个拒绝都有名字。本页是这些名字与 doctor 的对照表：
对每个错误码，说明 `doctor`（`pnpm run doctor`，或
`node scripts/doctor.mjs --json`）是否覆盖其前置条件、由哪个检查 id 应答。
每个码的权威含义与修复在 [ARCHITECTURE.md](ARCHITECTURE.md)（错误码一节）；
本页补充诊断维度与 verdict 契约。

## doctor 的裁决

`doctor --json`（schemaVersion 2）以 `verdict: "ready" | "blocked"` 收尾，
阻断 id 列在 `blockers`，按 distro 的细分在 `distroVerdicts`。阻断规则只有
一条不变式：**`fail` 即阻断**——配置感知体现在状态上（缺 systemd 只在
`sessionSandbox: true` 时 fail；`auto` 点名其 per-command 回退，`false`
点名选择退出，两者均为 warn），因此裁决回答的是**生效配置**——应用实际
加载的 profile 层叠加在出厂 preset 之上——而不是出厂默认。`config.effective`
检查报告读到了什么、从哪里读的。有意的选择退出从不构成失败：当所有表面都
关闭隔离（`sandbox: false` 且 `sessionSandbox: false`），沙箱检查发出
**警告**点名 UNCONFINED 状态，并跳过围栏冒烟——醒目，但不阻断。

`verdict: ready` 表示首条命令应在目标 distro、预期 scope 下成功；smoke 腿
（`functional.exec`、`functional.sandbox`、`functional.fs`）证明链路本身——
帧 I/O、受限围栏、批量 substrate——而不只是前置条件。`functional.exec` /
`functional.fs` 运行 shell agent；当 `auto` 或 `native` 选中 native 二进制时，
`functional.native` 在它之上跑同一条 EXEC 与 FSB 链路。此时 shell agent 是
回退，其失败降为警告并点名原因（未装 GNU `find` 的 BusyBox 会报
`find: unrecognized: -printf`，并给出 `findutils` 的处理办法）——除非配置
钉死 shell agent，或两个后端都答不出，则仍为阻断。前置失败的腿以
`skipped` 报告并点名阻断者；`skipped` 永不阻断。传输层无法担保的读数——
`wsl.exe` 超时或探测中途卡死（多个 distro 并发探测、其中一个正在冷启动时
最常见）——在自动重试一次后报告 `unknown`，detail 点名该次抖动；`unknown`
永不阻断，也不构成配置裁决：`/etc/wsl.conf` 读数抖动说明的是读取失败，
而不是文件损坏。重跑 doctor 即可得到干净答案。

`--fix` 以复验报告收尾：每个修复后都跟着一次对它声称修好的东西的全新探查，
受影响的检查项携带 after 状态，verdict 重算——`ready`，或剩余阻断者。
插件自有状态会被自动修复：残留 scope 清扫，以及缓存条目不可执行时清理
agent 缓存（清理后重新握手）。`--fix-owned` 把运行收窄到这两类——侧边栏
面板的“修复”动作即用它——且不能与 `--install` 同用。会改写用户或 distro
所有文件的修复（`.wslconfig`、`/etc/wsl.conf`、WSL1 转换、安装 distro）
永不开启自动化；补救文本会写明。

`--bundle <path>` 写出本地 JSON 文件（报告 + 版本 + 生效配置）供 setup
report 附带；`--redact` 把 home 与 DSH 路径替换为 `<redacted-*>` 占位符。
bundle 不含文件内容、环境变量，也没有遥测。

## 三个入口

doctor 通过三个入口给出同一份报告；侧边栏的 **WSL 环境** 面板经自己的
路由渲染同一份快速摘要，并提交完整运行动作（`--fix-owned`，按报告标为修复或完整检查）：

- **独立 CLI**——`node scripts/doctor.mjs [distro] [--all] [--json] [--quick] [--sections host,sandbox,session,conf,net,agent] [--fix] [--fix-owned] [--install] [--yes] [--read-only] [--bundle <路径>] [--redact] [--locale <标签>]`
  （与 `--help` 输出同一行）。
  这是权威入口：它**不加载任何 peer 依赖、任何宿主服务**，即使插件的运行时
  本身就是故障源，它也能启动。只 import 纯净、无 peer 的 `lib/` 模块；原先
  挂在 peer 污染模块（`lib/index.js`）后面的唯一 helper 已内联，并由
  `test/doctor.test.mjs` 与 lib 导出对拍防漂移。
  退出码 0 = `ready`，1 = `blocked`，2 = 拒绝（`--read-only` 与
  `--fix`/`--install` 同用、`--fix-owned` 与 `--install` 同用，或对范围化
  运行使用 `--fix`）。
- **`/wsl-doctor` UI 命令**——在输入框输入
  `/wsl-doctor [quick|full|<分区>] [--distro <名称>]`；命令面在宿主侧执行，
  handler 子进程运行独立 CLI，逐项报告直接渲染在 UI 上、不进模型历史
  （无模型回合、零 token）。侧边栏的 **WSL 环境** 面板按发行版运行同源的快速检查，
  结果以状态徽标、编号的待修项与告警列出；已检查的行还提供一个完整 doctor 动作（`--fix-owned`）：报告中存在可自动修复项
  （残留 scope 或损坏的 agent 缓存）时标为 **修复**，否则标为 **完整检查**；
  返回 before → after 的修复行。行内同时给出上次检查时间、来源（手动或页面加载时的后台复核）与结果结构（各状态
  计数与分区分布）。每个已检查的行可展开查看本次运行执行的全部检查项，按分区分组、逐项带状态与依据；
  快速检查未触及的目录项只以“完整检查还会运行 N 项”计数，不伪装成结果。最后一次结果存放在本地（`$DSH_HOME/cache/dsh-plugin-wsl-env/status.json`，
  缺省回退到 `~/.dsh`），刷新后仍可见；后台复核只针对正在运行的发行版，失败时按
  实际观测覆盖已存结果。手动告警保留各自处理办法；
  完整诊断仍走上面的入口与 `/wsl-doctor`。没有命令适配器的部署（headless、ACP）中该行是
  no-op，CLI 就是入口。未给 `--distro` 时，handler 从会话当前工作目录解析
  发行版（先读 agent 作用域的 `workingDirectory` 服务，再退回 Session 头部
  记录的 `cwd`）；两者都给不出 WSL UNC 路径时，由 CLI 的生效配置决定，而
  随包预设的 `auto` 会逐个检查**所有**已安装发行版——多发行版机器上是数分钟
  的开销（收窄到单个发行版的 quick 运行只需数秒）。因此 handler 给子进程设了
  时限（解析出发行版时 120 秒、交给配置决定时 60 秒，均低于命令面自身的
  截止时间），停摆或未收窄的运行会给出消息，说明本次检查的目标与如何收窄。
- **`wsl_doctor` 模型工具**——经 `doctorReport()` 进程内采集，会合并常驻
  agent 的实时状态。采集是异步的：doctor 子进程不再阻塞宿主，工具调用的取消
  会杀掉它，而两分钟时限加上有界的管道排空窗口，能让子进程不再报告时也有
  结论。这是唯一依赖模型链路的入口；怀疑插件运行时本身时，用命令或 CLI。

## 地图

类别图例：

- **environment**——doctor 探查的机器状态；doctor 绿即覆盖。
- **policy**——按调用决定（沙箱围栏、distro 围栏）；doctor 证明围栏形状，
  调用决定具体情形。
- **data**——调用方或数据瞬态；不存在机器前置条件，因此没有 doctor 检查
  认领它。

| 码 | 类别 | doctor 检查 | 一句话 |
|---|---|---|---|
| `SANDBOX_UNAVAILABLE` | environment | `sandbox.bwrap`、`sandbox.bwrap-usable`、`functional.sandbox` | 所请求的隔离无法强制（无可用 bubblewrap） |
| `FS_SANDBOX_DENIED` | policy | `functional.sandbox`（围栏形状） | 文件效果策略拒绝了写入，或内核在驻留 agent 的 profile 处拒绝 |
| `FS_OUTSIDE_DISTRO` | policy | `config.effective`（生效的 `distro`） | 围栏钉死时路径指向另一 distro 的共享 |
| `FS_IO_ERROR` | environment | `distro.reachable`、`distro.disk`、`host.disk`、`agent.handshake`、`agent.home-writable`、`functional.exec`、`functional.fs` | 兜底：agent 失联、distro 僵死、磁盘满、无法映射的路径 |
| `FS_NOT_FOUND` | data | — | 路径不存在——普通答案 |
| `FS_NOT_REGULAR_FILE` | data | — | 需要常规文件处出现了目录、符号链接或设备 |
| `FS_NOT_DIRECTORY` | data | — | 对非目录发起列表 |
| `FS_NOT_TEXT` | data | — | 内容不是 UTF-8 文本 |
| `FS_TOO_LARGE` | data | — | 内容超出调用方携带的字节上限 |
| `FS_ABORTED` | data | — | 调用方自己的信号取消了调用 |
| `FS_NOT_OBSERVED` | data | — | 受守卫的创建命中了存在但未读过的文件 |
| `FS_STALE_VERSION` | data | — | 调用方版本过期；重读后重试 |
| `FS_EDIT_NOT_FOUND` | data | — | 字面编辑没有命中 |
| `FS_AMBIGUOUS_EDIT` | data | — | 字面编辑命中多处 |
| `FS_PATCH_MISMATCH` | data | — | hunk 与文件不再吻合；按新文本重建 |
| `FS_SAME_TARGET` | data | — | move 的源与目的地解析为同一文件 |
| `AgentUnavailableError` | environment | `agent.handshake`、`agent.native`、`agent.cache`、`agent.home-writable`、`functional.exec`、`functional.native` | 执行层的复活预算耗尽；具名状态会说明 |

agent 的结构化 FS 原因（`notfound`、`notdir`、`perm`、`loop`、`stale`、
`io`）在 `lib/fsio-agent.js` 映射到上表各码；线上方言本身见
[AGENT-PROTOCOL-V7.md](AGENT-PROTOCOL-V7.md)。

## doctor 绿但调用仍失败

那是 **policy** 与 **data** 类别在正常工作：doctor 无法预测取决于调用而非
机器的拒绝。若某个 **environment** 类错误码反复出现而 doctor 显示 `ready`，
那是缺陷——附上 `doctor --bundle` 输出提报
（[setup report](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/.github/ISSUE_TEMPLATE/setup_report.yml)
会携带它）。
