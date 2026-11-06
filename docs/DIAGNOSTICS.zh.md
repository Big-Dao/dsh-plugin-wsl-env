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
检查报告读到了什么、从哪里读的。

`verdict: ready` 表示首条命令应在目标 distro、预期 scope 下成功；smoke 腿
（`functional.exec`、`functional.sandbox`、`functional.fs`）证明链路本身——
帧 I/O、受限围栏、批量 substrate——而不只是前置条件。前置失败的腿以
`skipped` 报告并点名阻断者；`skipped` 永不阻断。

`--fix` 以复验报告收尾：每个修复后都跟着一次对它声称修好的东西的全新探查，
受影响的检查项携带 after 状态，verdict 重算——`ready`，或剩余阻断者。
会改写用户或 distro 所有文件的修复（`.wslconfig`、`/etc/wsl.conf`、WSL1
转换、安装 distro）永不开户自动化；remedy 文本会写明。

`--bundle <path>` 写出本地 JSON 文件（报告 + 版本 + 生效配置）供 setup
report 附带；`--redact` 把 home 与 DSH 路径替换为 `<redacted-*>` 占位符。
bundle 不含文件内容、环境变量，也没有遥测。

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
| `FS_IO_ERROR` | environment | `distro.reachable`、`distro.disk`、`agent.handshake`、`functional.exec`、`functional.fs` | 兜底：agent 失联、distro 僵死、磁盘满、无法映射的路径 |
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
| `AgentUnavailableError` | environment | `agent.handshake`、`agent.native`、`agent.cache`、`functional.exec` | 执行层的复活预算耗尽；具名状态会说明 |

agent 的结构化 FS 原因（`notfound`、`notdir`、`perm`、`loop`、`stale`、
`io`）在 `lib/fsio-agent.js` 映射到上表各码；线上方言本身见
[AGENT-PROTOCOL-V7.md](AGENT-PROTOCOL-V7.md)。

## doctor 绿但调用仍失败

那是 **policy** 与 **data** 类别在正常工作：doctor 无法预测取决于调用而非
机器的拒绝。若某个 **environment** 类错误码反复出现而 doctor 显示 `ready`，
那是缺陷——附上 `doctor --bundle` 输出提报
（[setup report](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/.github/ISSUE_TEMPLATE/setup_report.yml)
会携带它）。
