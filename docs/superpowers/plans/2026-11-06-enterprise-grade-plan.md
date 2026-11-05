# 企业级达标运行规划（审计驱动，第二轮自治运行）

> 本规划由 2026-11-06 的三路审计（代码质量/架构、文档/配置面、CI/工程方法）驱动，
> 每一项都带 file:line 级证据；执行协议沿用 2026-11-06 自治运行规划的 §3
> （任务循环、失败处置、时间治理、不推送）。分支延续 `auto-run/2026-11-06`。
> 审计基线：`30a3f49`（v0.18.0 + 第一轮运行 17 提交）。

**目标：** 把审计发现的 blocking 与高价值 should-fix 清零，使架构（单一解析算法、
无休眠 API、无类型环）、设计（错误方言一致、目录完整、导出可达）、编码（信任边界
加固、零方言漂移）、测试（夹具收敛、覆盖率续推）、工程方法（CI 供应链与缓存、
文档与事实一致）五个维度都达到本仓自己的最高标准。

**审计结论摘要**（证据见各任务"依据"）：零债务标记、零 `any`/`!`、配置面文档
完全对齐、发布链路健全——基线已在平均线之上；缺口集中在：CI 的供应链/缓存层、
四份互相矛盾的陈旧工程文档、导出可达性、distro 解析的 4 处重复实现、
shell agent 信任边界的校验缺口。

## 任务队列

| ID | 任务 | 依据 | 验收门 |
|---|---|---|---|
| E1 | CI 供应链加固：所有 `pnpm install --frozen-lockfile` 加 `--config.minimum-release-age=0`（release.yml:49-61 已记录该修法，ci.yml 5 处与 peer-canary.yml 漏掉）；自托管 runner 的 `windows-latest` 标签冲突——fork PR 的作业不得落到开发机（fork-gate 条件）+ 在 CONTRIBUTING/SECURITY 记录标签冲突与整改建议 | ci.yml:69 等 5 处; peer-canary.yml:32; ci.yml:11-13 | 下一次 CI 运行绿；yml 语法 |
| E2 | 导出可达性：`doctorReport`/`effectiveMaskWindowsDrive` 在 lib/index.js 但 exports 表无 `"./index"`，CHANGELOG 宣称的集成 API 消费者拿不到 | docs 审计 B2; package.json:16-82 | style 的 exports 检查 + 一个新单测从包根导入成功 |
| E3 | 错误目录补全 + files 清单自洽：ARCHITECTURE.md 补 `FS_PATCH_MISMATCH`/`FS_SAME_TARGET` 行；REQUIREMENTS.zh.md 自称不随包发布却在 files 里——从 files 移除 | docs 审计 B3/B1 | grep 目录 14+2 行齐；npm pack 不含该文件 |
| E4 | distro 解析统一到 `selectDistro`：distroFor/distroForPath/distroForPolicy 三份手工拷贝改为传候选列表的单一算法（src/distro-route.ts:90）；watch 的第五形态并入 | 代码审计 S1 | 全链绿；provider 的路由断言不变 |
| E5 | 休眠 API 移除：`runInDistro`（零调用方）与 `toLinuxPath` 的 `options.distro`（透传无人读）——REVIEW:204 推迟到"下一版"，0.19 前的本次即属之；5 个调用点同步 | 代码审计 S2 | 全链绿；CHANGELOG 移除条目 |
| E6 | 错误方言统一：`unusableShell` 两处逐字重复收敛为一；native-agent 的 setup 拒绝补 `dsh-plugin-wsl: ` 前缀；agent-confined 的 checklist 失败进方言；picker 的引号漂移统一为 FS 方言（已核实非 peer 锁定） | 代码审计 S4 | grep 抽查；全链绿 |
| E7 | 类型环打破：`ResolvedTarget` 从 fs-substrate 移到 fsio-agent（低层），fs-substrate 改为引用 | 代码审计 S7 | lint:types/build 绿 |
| E8 | `executeOneShot`（~250 行）分解为 argv 构建/装饰/降级三个私有方法，行为零变化 | 代码审计 S6 | 全链绿；provider 断言逐字不变 |
| E9 | shell agent 信任边界加固：EXEC/FS 的 `nargs`、`timeout_s`、fs_read 的 `offset`/`max` 数值校验（对齐 FSB 已有模式）；fs_read 非正 max 拒绝而非静默空；脚本头如实声明 GNU 依赖；PEER-PARITY 记录 native 二进制未同步的分歧 | 代码审计 S9/S16/S10 | agent-fs-script 全绿 + 新拒绝臂单测 |
| E10 | `@module` 标签 29 处改为真实包名 `dsh-plugin-wsl-env/...` | 代码审计 S14 | grep 零残留；重建 |
| E11 | 测试夹具收敛：7 份 staged fake-wsl.exe 收敛为 `test/fake-wsl.mjs` 共享助手 | 代码审计 S8 | 全链绿 |
| E12 | 文档批次：CONFIGURATION.zh 的 shell 行补齐；zh README 补 QUICKSTART 链接/两行表/doctor 指针；LIMITATIONS.zh 章节顺序对齐；CONFIGURATION 的 diagnose 节纳入 doctor、ARCHITECTURE 提及 doctor；MIGRATION 引用更新 + run-all-when-closed 头注释如实；CHANGELOG 补 doctor `--wsl`；README 文档表补 MIGRATION/COMPATIBILITY/API 行 + docs/API.md 子路径导出速览；PR 模板探针数改 17 | docs 审计 S1/S2/S3/S4/S6/S7/S8/S9 | links green；双语抽查 |
| E13 | CI 批次：setup-node 加 pnpm 缓存（5 处 + release）；cargo 用 actions/cache 显式路径（不引入第三方 action）；peer-canary 动作 SHA 钉死 + 并发组；coverage 作业上传工件 + $GITHUB_STEP_SUMMARY；checkout 全部 `persist-credentials: false`；预发布版本 `--tag next`；发布后注册表核验步骤化 | 工程审计 S1/S2/S3/S4/S6/N4/S10/N7 | yamllint 语义（actionlint 若可用）；下次 CI 绿 |
| E14 | 工程方法小件：style.mjs 增两道门（test:unit/test:coverage 清单同步、docs 清单反向校验）；.gitignore 收 RUN-LOG.md；.gitattributes 显式 binary 行 | 工程审计 N2/N3/N5 | style 绿 |
| E15 | 收尾：覆盖率余量（fs-routing 主机臂/preflight logger 臂等）视预算推进；运行记录落库 | 第一轮运行记录 backlog | 全链绿 |

**明确不做**：git hooks（CI 已覆盖，属维护者工作流偏好）；dependabot 扩到 npm（peer 手动是有记录的设计决策）；typedoc（新增工具链依赖，收益低于 d.ts 已有质量）；PR fork 门之外的分支保护（GitHub 设置，文档记录）。
