# 支持政策

[English](SUPPORT.md)

## 支持范围

| 领域 | 支持情况 |
|---|---|
| 操作系统 | Windows 10 与 Windows 11 |
| Linux 侧 | WSL2，至少一个发行版；随包的会话 runtime 需要 systemd 作为 PID 1，并启用 lingering 用户管理器（`loginctl enable-linger`）。若要在 preset 中保留逐命令沙箱，请在 `wsl-shell` 和 `wsl-fs` 上都设置 `sessionSandbox: false` |
| DSH 包 | `peerDependencies` 声明 `0.2.2-rc.1` 下限；更新的版本需要兼容性验证 |
| 插件版本 | 仅最新发布版本 |
| Node | 22.19+（`^22.19.0`），或 24 及以后（`>=24.0.0`） |

DSH 这一行每周检查：`.github/workflows/peer-canary.yml` 解析每个钉定 peer 的
`next` dist-tag，将该版本线安装到临时副本，并运行 `pnpm test` 与组合启动测试。
成功运行会在摘要中打印确切的版本差异；请据此更新上表。运行失败（红色）表示
插件尚未针对新版本线验证。

Node 20 被有意排除在区间外：下限就是 harness 宿主自身的版本，CI 覆盖 22 与 24。
`package.json` 中的 `engines` 才是权威声明，而不是本表。

在 Windows 之外，插件没有可接入的对象。它通过 `wsl.exe` 在发行版内运行
`ctx.shell`。Linux 宿主、macOS 宿主或 WSL1 都不是受支持的配置。

## 获取帮助

在仓库中开一个 issue：

https://github.com/Big-Dao/dsh-plugin-wsl-env/issues/new/choose

选择器提供 **feature request** 与 **setup report**；setup report 要求提供
`doctor --json` 输出，这正是让首次运行问题无需往返即可诊断的关键。安全 issue
请改用私有公告链接（见 [SECURITY.md](SECURITY.zh.md)）。

用 issue 提交 bug 报告与配置问题。先搜索未关闭和已关闭的 issue，并检查答案
是否已经成文：[docs/LIMITATIONS.md](docs/LIMITATIONS.zh.md) 列出已知的设计边界，
[README.md](docs/README.zh.md#常见问题) 中的“常见问题”表覆盖常见故障
（`SANDBOX_UNAVAILABLE`、缺少 `rg` 等）。

安全 issue 请遵循 [SECURITY.md](SECURITY.zh.md)。不要为此开公开 issue。

## 不支持的范围

- macOS，以及非 WSL2 的 Linux 宿主。
- 没有 WSL2 的 Windows。
- 修改过的 DSH 构建，或 harness 包的分支。
- 插件无法识别的发行版，即其探针报告的情况：`wsl.exe -l -q` 中没有发行版，
  `$HOME` 为空或不是绝对路径，或 `getent passwd` / `$SHELL` 探针得不到绝对
  shell。检测逻辑位于 `src/wsl.ts`。
- 没有 `bwrap` 的发行版。此类环境中的命令失败关闭，而不是无约束运行。
- 上游 `@deepseek-ai/*` 包。请报告给各自的项目。
- 第三方 npm 镜像。请从包发布所在的 registry 安装。

## 兼容性预期

DSH peer 区间从 `0.2.2-rc.1` 开始；开发依赖为测试精确钉定该版本。Cordis 与
Schemastery 使用 caret peer 区间。接受的区间并不保证与每个更新的版本兼容：
上游变更可能需要本插件发布新版本。

没有长期支持分支。修复只进入最新版本。

## 分类处理与发布节奏

- **路线图。** 公开计划是 [docs/ROADMAP-1.0.md](docs/ROADMAP-1.0.md)；
  未关闭的 issue #5–#22 对应其 WSL-1xx/2xx/3xx 块。
- **分类目标。** `priority:P1` 报告在三个工作日内获得首次响应，尽力而为。
  安全报告遵循 [SECURITY.md](SECURITY.zh.md) 中的响应目标。
- **节奏。** 有值得发布的变化时发布，大约每两到四周一次；tag 工作流及其门禁见
  [docs/RELEASING.md](docs/RELEASING.md)，配置稳定性与迁移规则见
  [docs/MIGRATION.md](docs/MIGRATION.zh.md)。没有长期支持分支。
- **Good first issues。** `good first issue` 标签标记无需先前上下文的改动；
  [Good first issue 与贡献者路径](CONTRIBUTING.zh.md#good-first-issue-与贡献者路径)
  列出常见形态与领取方式。

## 一份好的 bug 报告包含什么

一条命令的路径：`pnpm run diagnose`（在插件的代码检出中运行，或
`bash scripts/diagnose.sh`）会收集下表的大部分内容——Windows 版本、WSL 状态、
发行版、内核、包管理族、四个工具及其版本，以及 bwrap 功能探针——形成可直接
粘贴的报告。先运行它，再补充它看不到的内容：

| 项目 | 获取方式 |
|---|---|
| 诊断报告 | `pnpm run diagnose <distro>`（只读；分享前审查并脱敏） |
| 插件版本 | `npm ls dsh-plugin-wsl-env`，或你构建所用的 git tag |
| DSH 版本 | 你运行的 harness 版本 |
| 合成配置 | profile 的 `package.json` 与 `cordis.patch.yml`（`dsh-plugin-wsl-env` 层及其修补的行）。桌面应用没有 `dsh` 命令 |
| 沙箱行为（深入） | 在发行版内运行（先 `wsl.exe -d <distro>`）`npm run probe:sandbox` 的输出——探针会调用 `bwrap` 并读取那里的 `lib/bwrap.js`，因此发行版内两者都需要 |
| 你期望什么、实际发生了什么 | 各写一段 |
| 复现 | 精确命令，或精确的点击顺序 |

隐去你的用户名以及任何你不愿公开的路径。`cordis.patch.yml` 中有用的部分通常是
层标题与被修补的行，而不是整个文件。

## 响应时间

这是一个利用业余时间维护的小项目。没有服务级别协议，也不保证响应时间。
安全报告有自己的目标，列在 [SECURITY.md](SECURITY.zh.md)。
