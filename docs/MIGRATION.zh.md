# 配置稳定性与迁移

_本页是权威版本；英文译本见 [Configuration stability and migration](MIGRATION.md)。_

发布可以改变什么、破坏性的配置变更如何公布与承接，以及发布必须通过哪些门禁。
[RELEASING.md](RELEASING.md#1-decide-the-version) 中的版本表是版本号递增的依据；本页是这些递增所遵循的约定。

## 1.0 以下的冻结

包版本低于 `1.0.0`，因此磁盘上的 profile 格式与 peer 钉版仍可能在 **minor** 中变动。
在这一自由度内：

- **新增配置键属于 minor。** 该键必须带一个保持既有行为的 schema 默认值；
  仅因存在就改变行为的键属于 major 形态的变更，需要等待。
- **删除或重命名键属于 major**，*或*属于带启动时拒绝并指明迁移方式的 minor（见下文）。
  绝不允许静默接受已退役的键：`preset-wsl` 陷阱与 `substrate` 拒绝的存在，
  正是为了防止这类失败。
- **改变键的含义属于带迁移说明的 minor**，因为按旧含义写成的 profile 仍会继续启动。
  说明必须指出改了什么、如何保留旧姿态，以及行为在何处不同。
- **peer 兼容性按区间声明。** DSH peer 依赖声明下限；开发依赖精确钉版。
  新的上游 peer 版本线由 [peer canary](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/.github/workflows/peer-canary.yml) 测试；
  受测基线或支持区间的变化应写入发布说明。
- **工具名与错误码是 API。** `FS_OUTSIDE_DISTRO`、`SANDBOX_UNAVAILABLE`、
  `FS_STALE_VERSION` 以及诊断脚本（`doctor`、`diagnose`、`preset`、`bootstrap`）
  保留名称与契约；重命名遵循下文的弃用路径。

## 弃用配置值

1. **在引入弃用的版本中公布**：一条 CHANGELOG 记录，以及
   [CONFIGURATION.md](CONFIGURATION.zh.md) 中的对应行。旧值在该版本中继续可用。
2. **含义无歧义时，保留旧写法一个 minor。** 若保留旧写法会静默改变行为，
   则改为在启动时拒绝并打印迁移方式——`substrate: "share"` 即属此例：
   该值被拒绝，消息要求删除该行，因为提供 share 恰恰是插件绝不能做的事。
3. **在下一个 minor 中移除**，并附另一条 CHANGELOG 记录。发布说明指明拒绝出现的版本。

### 案例：`distro: ''`（0.12.0）

`distro: ''` 过去表示“WSL 的默认发行版”。0.12.0 让空值表示 **auto**：
跟随请求工作目录的 UNC 发行版。依赖旧含义的 profile 仍能启动，但行为已经不同。
迁移方式：

```yaml
# 保留旧姿态：所有命令都在 WSL 的默认发行版中执行
- id: preset-wsl
  config:
    plugins:
      # … 完整块；两行都要设置 …
      - id: wsl-shell
        config:
          distro: default
      - id: wsl-fs
        config:
          distro: default
```

`pnpm run preset --distro default` 会打印该块，供手动合并。
`--out` 会替换整个目标文件，包括无关的覆盖项；
见 [CONFIGURATION.md](CONFIGURATION.zh.md#配置-wsl-shell-和-wsl-fs)。0.12.0 的 CHANGELOG
记录说明了该变更；本页是持久副本。`doctor` 在其 host/distro 行中报告生效的
发行版模式，`--dump-config` 显示合成后的值。

## 发布必须通过的门禁

| 门禁 | 方式 | 运行位置 |
|---|---|---|
| 配置文档与 CHANGELOG 为最新 | 审查 diff；`lint:links` 覆盖交叉引用 | CI |
| `pnpm test` | 风格、链接、需求引用、文档一致性、语法、构建新鲜度、tsc 与单元测试文件 | CI（Node 22/24，Ubuntu + Windows） |
| `pnpm run test:coverage` | 行 85 / 分支 84 / 函数 70 | CI（Node 24，Ubuntu） |
| `pnpm run test:browser` | 无头 Chromium 中的插件 web bundle（布局、点击、badge 时序）；安装一次 Chromium | CI（`browser` job，Ubuntu）与发布的 `Gates` |
| peer 版本线受测 | 下限 `>=0.2.2-rc.2`；`peer-canary` 工作流解析 `next` 并运行临时升级 | CI 定时/手动 |
| 打包安装/升级/卸载 | `pnpm run e2e:install`（临时 `DSH_HOME`，0.17.1 → 当前版本，跨 peer 下限抬升，marker） | 手动，本机（2026-11-06 为 10/10；起点从 0.11.0 移至 0.17.1，因为 dsh 0.2.2-rc.1 正确拒绝了精确钉版时期） |
| 真机探针套件 | `test/probe/run-all-when-closed.sh --include-fs`（需要应用关闭） | 手动；2026-10-31 与 2026-11-05 均为 15/15（docs/superpowers/probe-runs/）；套件在 2026-11-06 增至 17 项——同日首次 17 项运行通过 16 项，新的 `two-distro.sh` 因断言载体错误而失败（会话作用域的 `DSH_WSL_DISTRO` 在直接 `ctx.shell` 接缝上不存在）；将探针改为按发行版的 `/tmp` 标记后单独通过，使本机 17 项探针全部通过（2026-11-06-probe-suite.md）；2026-11-12 针对 rc.2 宿主再次 17/17 |
| 干净 Win11 + Ubuntu 首次运行 ≤ 5 分钟 | 干净机器、秒表 | **未运行**（项目机器已配置） |
| aarch64 已执行 | CI 中 qemu 下的 native 18 项检查套件 | **已在 CI 运行**（物理 aarch64 WSL 不在范围内；见 COMPATIBILITY.md） |
| 30 天内无未关闭的 P0 bug | issue tracker | 基于时间；无法从代码检出中断言 |

干净机器首次运行的计时与 30 天 P0 窗口在有人实际测量前保持未运行；
aarch64 qemu 是 CI 门禁。发布说明不得声称未运行的行，
[ROADMAP-1.0.md](ROADMAP-1.0.md#wsl-304--10-readiness) 跟踪 1.0 的遗留项。
跳过其余手动行的发布仍会通过 tag 工作流发布，但其说明会写明执行了哪些门禁。

## 在本地验证迁移

```bash
pnpm run preset --distro default --check <profile>/cordis.patch.yml  # 无嵌套行陷阱
pnpm run doctor --json                                               # 生效的环境事实
dsh --profile <name> --dump-config                                   # 合成后的行（CLI 发行版）
```

迁移后启动失败的 profile 应在错误中指明补救方法；若没有，那就是 bug——
请附上 `doctor --json` 输出报告它。
