# 发布流程

本文是 [RELEASING.md](RELEASING.md) 的中文对照；修改先落中文，再对齐英文。

## 发布证据三道门禁

```text
Source gate: 每次 PR/main 运行
Candidate gate: 每个 tag 发布前
Post-release gate: 每个 stable/next tag 在 registry 传播后
```

源码证据不能替代官方包证据：源码门禁通过并不说明已发布的 tarball 正确，候选门禁与发布后门禁须各自产出官方包 smoke 证据。完整 Windows/WSL 探针覆盖仍以源码兼容门禁为准。候选包在 Windows 上只打包一次，同一个 `.tgz` 作为 `candidate-package` 产物上传并原样发布（`npm publish --provenance --access public <tgz>`，不重新打包）；两个 Windows 任务在 smoke 前均先安装 Ubuntu 24.04 与 WSL 前置依赖。smoke 以 tarball/registry 身份（名称、版本、sha512）标识包，`--dump-config` 只证明 profile 组合包含插件，不证明已安装的精确版本。

其余步骤（确定版本、切分变更日志、完整检查、真机探针与发布后核验）见英文版 [RELEASING.md](RELEASING.md)。
