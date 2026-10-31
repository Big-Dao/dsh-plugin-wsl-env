# 仓库文档地图

本文面向仓库维护者，梳理文档的用途、依赖关系和时效；不随 npm 包发布。
配置和行为以当前代码、`cordis.patch.yml` 与 `package.json` 为准；带日期的
实测、提案和历史记录只证明当时的情况，不应覆盖现行行为说明。

## 用户入口与行为契约

- [README](../README.md) 是英文入口，[中文 README](README.zh.md) 是对应译本；
  [快速开始](QUICKSTART.md) 给出安装与首用步骤。
- [配置](CONFIGURATION.md) 解释配置项、默认值和覆盖方式；
  [限制](LIMITATIONS.md) 记录未实现或不能保证的行为；
  [安全政策](../SECURITY.md) 定义漏洞报告与沙箱威胁边界。
- [架构](ARCHITECTURE.md) 描述服务、路由、协议与验证分层；
  [根文件系统路由](root-fs-routing.md) 补充路径坐标和组合层设计。
- [兼容性](COMPATIBILITY.md) 和 [性能](PERFORMANCE.md) 保存带环境、日期的测量；
  [迁移](MIGRATION.md) 说明升级与配置兼容规则。
- [价值说明](VALUE.zh.md) 汇总用途与取舍；[需求追溯](REQUIREMENTS.zh.md)
  将行为承诺关联到权威说明和测试。需求表不是第二份实现规范。

## 开发、发布与支持

- [贡献指南](../CONTRIBUTING.md) 说明环境、检查和探针；
  [AGENTS.md](../AGENTS.md) 是本仓库的代理协作规则。
- [发布流程](RELEASING.md) 定义版本、tag、发布和核验步骤；
  [变更日志](../CHANGELOG.md) 按版本记录变更，不反向改写历史条目。
- [支持政策](../SUPPORT.md)、[行为准则](../CODE_OF_CONDUCT.md)、
  [许可证](../LICENSE) 和 [PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)
  分别约束支持、协作、授权和提交信息。
- [技术路线](ROADMAP.md) 跟踪原生 agent；[1.0 路线](ROADMAP-1.0.md)
  记录产品计划、验收及进度。计划中的历史基线不代表当前实现。
- [Remote-WSL 对照](PARITY.md) 是阶段性契约审计；
  [peer 对拍](PEER-PARITY.md) 记录指定版本的字节和行为对照。

## 设计决定与上游材料

- ADR：[会话级沙箱](adr/0001-session-scoped-sandbox.md)、
  [原生 agent](adr/0002-native-agent.md)。ADR 解释决策时的背景；
  [原生实验](../agent/native/spike/README.md) 描述独立 spike，而非发布二进制。
- 上游接口记录：[文件引用](UPSTREAM-FILE-REFERENCE-SEAM.md)、
  [fsio 导出](UPSTREAM-FSIO-EXPORT.md)、[LSP](UPSTREAM-LSP-SEAM.md)、
  [Open in app](UPSTREAM-OPEN-IN-APP.md)、[会话通知](UPSTREAM-SESSION-NOTICE.md)、
  [spawnSpec](UPSTREAM-SPAWN-SEAM.md)、[终端字体](UPSTREAM-TERMINAL-FONT.md)、
  [终端标题](UPSTREAM-TERMINAL-TITLE.md)。每篇的检查版本和状态应单独核对。
- 上游材料：[晋升地图](upstream/promotion-map.md)、
  [晋升包](upstream/promotion-pack.md)、[UNC 问题草稿](upstream/issue-unc-validation.md)、
  [远程工作区提案](upstream/proposal-remote-workspaces.md)、
  [会话通知提案](upstream/proposal-session-notice.md)、
  [WSL 工作区 RFC](upstream/rfc-wsl-workspaces.md)、
  [Open in app 排查记录](upstream-open-in-app-bug.md)。它们是调查或提交材料，
  不等同于上游已接受的接口或当前发布承诺。

## 历史和辅助材料

- [2026-10-03 审查](../REVIEW-2026-10-03.md) 是有日期的历史审查，不是当前缺陷清单。
- [归档索引](archive/README.md) 和 [英文索引](archive/README.en.md) 指向
  [设计历史](archive/design-history.zh.md) 与
  [工程记录](archive/engineering-record.zh.md)；保留原始时间背景。
- [技能目录](../.agent/skills-catalog.md) 是自动生成的外部技能快照，
  [writing-beats](../.agents/skills/writing-beats/SKILL.md) 是本仓库中的辅助技能；
  它们不定义插件的运行行为。

## 维护关系

实现或默认值改变时，先更新对应的配置、架构和限制，再检查双语 README、
快速开始、需求追溯和支持政策。协议或 peer 版本改变时，同时检查对拍、
ADR、上游接口记录和发布流程；保留测量发生时的版本，不把旧实测写成新验证。
提交前运行 `pnpm test`；真机变更还需按贡献指南执行适用的探针。

## 发布包链接

仓库内的 `lint:links` 检查工作树中的相对链接，不检查 npm 包内容或页面锚点。
`test/packaging.test.mjs` 根据 `npm pack --dry-run --ignore-scripts --json`
的清单检查随包 Markdown 中的相对链接。常用文档与快速开始的截图随包发布；
不随包发布的源码、测试和历史资料链接指向 GitHub 的 `main` 分支，需要联网，
其内容可能随分支更新，不是特定发布版本的快照。该检查不验证外部链接或锚点。
