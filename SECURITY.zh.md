# 安全政策

_本页是权威版本；英文译本见 [Security policy](SECURITY.md)。_

## 支持的版本

只有最新发布版本会获得安全修复。

| 版本 | 是否支持 |
|---|---|
| npm 的 `latest` 标签所指向的版本 | 是 |
| 所有更早版本 | 否 |

## 报告漏洞

私下报告疑似漏洞。使用本仓库的 GitHub 私有漏洞报告：

https://github.com/Big-Dao/dsh-plugin-wsl-env/security/advisories/new

如果你无法使用该表单，请开一个普通 issue 索取私有渠道。不要在该 issue 中写入
利用细节。维护者会回复一个可私下发送细节的渠道。

在修复发布之前，不要在公开 issue、discussion 或 pull request 中发布利用细节。

## 报告应包含的内容

- 你测试的插件版本。`npm ls dsh-plugin-wsl-env` 会打印它，或注明你构建所用的
  tag。
- 你的 Windows 版本与你使用的发行版。`wsl.exe -l -v` 列出各发行版。
- DSH 版本与 profile 名称。
- 你期望发生什么，实际发生了什么。
- 你能构造的最小复现，附精确命令。
- 当时是否启用了沙箱。`sandbox: true` 是默认值。

## 响应时间

这些是目标，不是承诺。

| 阶段 | 目标 |
|---|---|
| 确认收到报告 | 3 个工作日内 |
| 初步评估与严重性判定 | 10 个工作日内 |
| 修复，或已记录的缓解措施 | 30 个工作日内 |

如果报告不在范围内，我们会说明并解释原因。

## 披露

确认的漏洞通过常规发布流程修复与披露，而不是单独的安全流程。

- 修复随包的下一个版本发布；上方的“支持的版本”表只覆盖该版本。
- 该版本在 [`CHANGELOG.md`](CHANGELOG.md) 中记录修复，GitHub
  Release 说明取自该节。
- 携带修复的版本发布后，公告会发布在本仓库的 Security 标签页，即私有报告
  提交之处。

不在范围内、或无法确认为漏洞的报告会被关闭，不发布公告。

## 范围

在范围内：

- 插件自身 `lib/` 下的代码；
- 已发布的包 `dsh-plugin-wsl-env`。

不在范围内：

- `@deepseek-ai/` 下的上游 DSH 包。请报告给各自的项目。
- WSL 本身、Windows 内核，以及 `bubblewrap`。
- 用户自己发行版的配置。这包括其 `sudoers` 规则、挂载的文件系统，以及其中
  安装的解释器。
- 任何需要攻击者已经控制用户的 Windows 账户或其发行版账户的情形。

## 沙箱隔离按设计为 `partial`

插件将沙箱隔离级别报告为 `partial`，而非 `full`。发行版内的进程仍可通过
WSL interop 启动 Windows 程序，例如 `/mnt/c/.../*.exe`。该程序在 Linux
沙箱之外运行。

这是已记录的设计边界，本身不是漏洞。在发行版内运行
`npm run probe:sandbox` 会在你的机器上演示这一点；发行版内必须安装
`bubblewrap` 与 `node`。README 的“沙箱”一节对此有说明。

严格 profile（`maskWindowsDrive: true` 配合 `sandbox: true`，且没有覆盖性的
`interopVisibility: visible`）会收窄这一点：
受限 profile 用空的 tmpfs 遮蔽 `/mnt`，因此无法从那里启动 `/mnt` 路径下的
可执行文件。其他挂载点与不受约束的文件读取不在覆盖范围内。它并未堵死这个
洞——写入工作区的 Windows 可执行文件仍会运行，因为 WSL 的 `binfmt_misc`
按内容而非位置分派——所以上报的隔离级别仍是 `partial`。彻底关闭需要发行版
级别（`/etc/wsl.conf` 中的 `[interop] enabled=false`）。三种状态及其证据列在
[docs/CONFIGURATION.md](docs/CONFIGURATION.zh.md#windows-interop) 的表中。

如果你发现不依赖 interop 的逃逸、遮蔽后的 profile 可从 `/mnt` 绕过，或插件
在 interop 可达时报告 `full`，仍欢迎报告。

已知有一类逃逸尚未修复：受限命令可以请求发行版用户自己的服务管理器启动一个
unit，而该 unit 在挂载 profile 之外运行——对发行版用户主目录的写入会成功，
而围栏内同样的写入会被拒绝。遮蔽 `/mnt` 不能收窄这条路径，因为它从不涉及
interop。在修复发布前，socket 路径与复现步骤暂不公开；发现、验证与推迟决定
记录在
[docs/superpowers/value-discovery-2026-11-10.md](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/superpowers/value-discovery-2026-11-10.md)
（E4）。与其他逃逸一样，请通过上方的私有渠道报告新实例。

## 凭据

本仓库不应包含任何凭据、token 或私钥，包括 npm token、GitHub token 和发行版
密码。如果你发现此类内容被提交到这里，请通过上方的私有渠道报告。不要为此
开公开 issue。
