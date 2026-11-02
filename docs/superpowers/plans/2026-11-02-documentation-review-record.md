# 文档审查记录（2026-11-02）

对应 `2026-10-31-community-optimization.md` 工作项 1 的清单要求：按
[文档地图](../../DOCUMENTATION-MAP.md) 列出受版本影响的文档，记录用途、
适用版本、审查状态及证据。审查状态分三档：**已审**（本轮逐项对照权威
来源核对过）、**抽审**（本轮部分核对）、**未审**（本轮未触及）。
适用版本指文档描述的行为对应的插件版本；带日期的历史材料保留原始版本。

## 用户入口与行为契约

| 文档 | 用途 | 适用版本 | 状态 | 证据 |
|---|---|---|---|---|
| README.md / README.zh.md | 英文入口与中文译本 | 0.17.x | 已审 | f9525f4：sessionSandbox 随包值表述、中文版补 doctor 段与 preset --check 行 |
| docs/QUICKSTART.md / .zh.md | 安装与首用步骤 | 0.17.x | 已审 | f9525f4：英文版中文残留注释修正；其余命令与 package.json/scripts 逐一核对 |
| docs/CONFIGURATION.md / .zh.md | 配置键、默认值、覆盖方式 | 0.17.x | 已审 | f9525f4：59 个配置键对照 src/index.ts 与 cordis.patch.yml 全部一致；修中文锚点 |
| docs/LIMITATIONS.md / .zh.md | 未实现或不保证的行为 | 0.17.x | 已审 | f9525f4：约 40 条逐条对照 src/，无已失效条目；补 interopVisibility、loginShell、GIT_* 多目录三条 |
| SECURITY.md | 漏洞报告与沙箱威胁边界 | 0.17.x | 已审 | 四面威胁边界、enforcement: partial、interopVisibility 三态、报告渠道、probe 前置均与 src/sandbox-core.ts、src/bwrap.ts、src/index.ts 一致；无失实项（2026-11-02 审计，零改动） |
| docs/ARCHITECTURE.md | 服务、路由、协议、验证分层 | 0.17.x | 未审 | — |
| docs/root-fs-routing.md | 路径坐标与组合层设计 | 0.15.0+ | 抽审 | e5a17e1：探针计数（15 项含 fs-routing.sh）与脚本 SUITE 一致 |
| docs/COMPATIBILITY.md | 带环境日期的测量 | 0.17.x | 抽审 | f9525f4：修正 CI job 名 native-package；"Not yet measured" 与路线图一致（e5a17e1） |
| docs/PERFORMANCE.md | 9p 对比与 GUI 预览基线 | 0.17.x | 未审 | — |
| docs/MIGRATION.md | 升级与配置兼容规则 | 0.17.x | 抽审 | e5a17e1：15 项探针记录行与套件一致 |
| docs/VALUE.zh.md / REQUIREMENTS.zh.md | 价值与需求追溯 | 0.17.x | 抽审 | lint:requirements：19/25 行引用的测试存在且接线（e5a17e1 期间运行） |

## 开发、发布与支持

| 文档 | 用途 | 适用版本 | 状态 | 证据 |
|---|---|---|---|---|
| CONTRIBUTING.md / AGENTS.md | 开发循环与协作规则 | 当前 main | 抽审 | e5a17e1：AGENTS 的"全套 15 项探针"与脚本一致 |
| docs/RELEASING.md | 版本、tag、发布步骤 | 当前 main | 未审 | — |
| CHANGELOG.md | 按版本记录变更 | 全版本 | 未审 | — |
| SUPPORT.md 等 | 支持与社区约束 | 当前 main | 未审 | — |
| docs/ROADMAP.md | 原生 agent 技术路线 | 历史+当前 | 未审 | — |
| docs/ROADMAP-1.0.md | 1.0 计划与验收 | 0.15.0 基线起 | 抽审 | e5a17e1：全部未勾选项核对为当前状态；探针计数一致；"12 probes"仅存于 historical 基线表 |
| superpowers/plans/2026-10-31-community-optimization.md | 社区优化计划 | — | 已审 | e5a17e1 勾选条目 46 并附核对记录 |
| docs/PARITY.md / PEER-PARITY.md | 对拍记录 | 指定 peer 版本 | 未审 | — |

## 设计决定与上游材料

| 文档 | 用途 | 适用版本 | 状态 | 证据 |
|---|---|---|---|---|
| docs/adr/0001、0002 | 决策背景 | 决策时版本 | 未审 | — |
| docs/UPSTREAM-*.md（8 篇） | 上游接口缺口记录 | 各自检查版本 | 未审 | 文档地图已注明"每篇的检查版本和状态应单独核对" |
| docs/upstream/（7 篇） | 调查与提交材料 | — | 未审 | 文档地图已注明"不等同于上游已接受" |

## 历史和辅助材料

REVIEW-2026-10-03.md、docs/archive/、技能目录：历史材料按地图约定保留
原始时间背景，不参与时效审查；本轮未改动。

## 范围外说明

`lint:links` 覆盖仓库相对链接（本轮 282 条 0 失效）；npm 包内链接由
`test/packaging.test.mjs` 覆盖（随 `pnpm test` 运行）；外部链接与页面
锚点不在自动检查范围内，本轮仅手工核对了被指出的一处页内锚点。
