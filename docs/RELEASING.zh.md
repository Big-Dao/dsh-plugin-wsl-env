# 发布流程（中文摘要）

本文是 [RELEASING.md](RELEASING.md) 的中文摘要；完整步骤以英文版为准，修改先落
英文，再同步本摘要的对应行。

## 发布证据三道门禁

```text
Source gate: 每次 PR/main 运行
Candidate gate: 每个 tag 发布前（workflow_dispatch 可空跑，不发布）
Post-release gate: 每个 stable/next tag 在 registry 传播后
```

源码证据不能替代官方包证据：源码门禁通过并不说明已发布的 tarball 正确，候选门
禁与发布后门禁须各自产出官方包 smoke 证据。完整 Windows/WSL 探针覆盖仍以源码兼
容门禁为准。

候选门禁的关键事实：

- 候选 tarball 在 **Ubuntu** 上只打包一次（Windows 文件系统没有 exec 位，Windows
  打包会把随包 shell 脚本打成 0644）；同一个 `.tgz` 作为 `candidate-package` 产
  物上传，Windows smoke 与 publish 均使用这份字节，不重新打包。
- 官方 Harness 安装包从官方 CDN 的精确版本路径解析
  （`download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-<version>-win-x64.exe`）；
  CDN 不提供官方 checksum，smoke 记录下载文件的 sha256 作为证据而非比对。
- smoke 用 `dsh --version` 验证实际安装版本等于请求版本；两个 Windows 任务在
  smoke 前均先经 `.github/actions/provision-wsl` 安装 distro 与 WSL 前置依赖。
- smoke 以 tarball/registry 身份（名称、版本、sha512）标识包；`--dump-config`
  证明 profile 组合包含插件且无 skipped 条目；经插件的命令、文件操作与沙箱拒绝
  由 `test/probe/official-smoke-probe.mjs` 在官方 CLI 无头启动上覆盖（挂载插件的
  WSL shell executor，属 provider 级证据；session 运行时路径仍以源码门禁为准），
  失败即 FAIL。
- 发布使用的 dist-tag 由 `scripts/check-release-tag.mjs --dist-tag` 决定：任何带
  预发布段的版本发到 `next`，其余发到 `latest`；tag 检查同时拒绝不是
  `MAJOR.MINOR.PATCH[-pre]` 形式的版本。

其余步骤（确定版本、切分变更日志、完整检查、真机探针与发布后核验）见英文版
[RELEASING.md](RELEASING.md)。
