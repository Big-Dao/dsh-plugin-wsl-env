# 自治开发与测试运行规划（≥4 小时无人值守）

> 本文是一个可照单执行的运行规划，不是功能承诺。执行者（人或代理）按 §3 的协议
> 逐任务推进，全程不需要人工决策；每个任务的验收门都是机器可判定的命令。
> 工作项的"依据"均核对到状态层（显式 Status / remaining gap / 仍开放清单），
> 未从计划表直接推断待办。测量与盘点日期：2026-11-06，基线 `0eaca5d`（0.18.0 后）。

**目标：** 在一个无人干预的运行时段内（预算 ≥4 小时），按优先级队列推进本插件的
测试补强与小步开发；每任务独立提交，运行结束留下可审的运行记录与干净的树。

**为什么这些是当前的真活（状态层证据摘要）：**

- 覆盖率：`pnpm run test:coverage`（2026-11-06，含在途未提交工作的工作树）分支覆盖
  低于 88% 的文件：`shell-env.js` 50%、`index.js` 74.03%、`watcher.js` 75%、
  `fsio-agent.js` 76.54%、`git-exec.js` 77.78%、`terminal-route.js` 77.78%、
  `preflight.js` 81.13%、`wsl.js` 81.54%、`fs-routing.js` 83.10%、其余 85–87.9%。
  聚合分支 84.21%，距 84% 的门只差 0.21pp——补哪个文件都在为门槛修堤。
- REVIEW-2026-10-03.md"仍开放"7 项中 4 项可在本仓独立处理（§4 T7/T10/T11）；
  2 项对等锁死（不动），1 项是上游 seam（不碰）。
- ROADMAP-1.0.md 表头"last refreshed 2026-10-31 against 0.15.0"，而仓库已 0.18.0：
  Files 行仍写"GUI 预览是额外往返"（0.18.0 的 FSB 批帧已解决）、WSL-207 的
  状态段被 WSL-313 部分取代（`doctor-live.js` 合入在驻状态）——时效刷新有实据。
- 双 distro 并发探针（WSL-101 唯一无证据的验收腿）与 agent kill/restart 探针
  （WSL-207 残留）从未编写；本机有 WSL 可写可单测脚本骨架，但**运行**留给人工门。

## 1. 运行环境与隔离

- **默认在独立 worktree 中运行**：`git worktree add ../wsl-env-auto-run -b auto-run/<日期>`，
  随后 `pnpm install`。原因：主检出常驻用户/并行会话的在途工作（2026-11-06 观测到
  watchdog/coverage-gate 系列未提交改动），自治运行绝不能与之混写。
- 提交只落在 `auto-run/*` 分支；**全程不 push**（推送与 CI 是外向动作，留给人工）。
  运行结束后由人工审阅合并。
- 收尾时保留 worktree 与分支，不自动删除、不自动合并。

## 2. 全局硬约束（违反任何一条即停止运行并写明）

1. `src/` 是源码，`lib/` 只能由 `pnpm run build` 生成；单测直接运行 `lib/*.js`。
2. 提交前 `pnpm test` 必须全绿；动了被覆盖代码则加跑 `pnpm run test:coverage`。
3. 一次提交只含一个逻辑变更；说明写明改动、原因、检查结果。
4. 不推送、不打 tag（tag 触发 `npm publish`）、不改 `.github/workflows/`、
   不动 `peerDependencies` 下限（仅 Harness 发版提交可抬）。
5. 不运行真机探针套件（须 Harness 关闭，见 AGENTS.md）；不修改用户 distro
   （`wsl.conf`、`useradd` 等）。
6. 类型纪律：`assert.ok`/带注释的 `as`；禁 `any` 与 `!` 断言。
7. 每任务先读状态层证据（本文各任务"依据"栏），实施前核对仍成立；不成立则跳过并记录。

## 3. 自治执行协议

**任务循环**（每个任务相同）：

1. 读任务定义与依据；`git status` 确认干净。
2. 实施；补/改测试与文档。
3. 验收门全绿：`pnpm run build && pnpm test`（触覆盖代码再加 `pnpm run test:coverage`）。
4. 提交（风格随仓史：标题一行 + 正文段落）。
5. 记录到运行日志（§5），进入下一任务。

**失败处置**：门不过 → 最多两轮修复尝试；仍红 → `git checkout -- .`（回滚本任务）
并记录原因，跳到下一任务。**绝不留红树过夜，绝不为了变绿改弱断言或删测试。**

**时间治理**：任务开始前看墙钟；若 `预算剩余 − 本任务估计 < 0`，跳到收尾单元。
每个任务的"估计"是预算上限而非目标；提前完成立即进入下一任务。

**判断纪律**：与 AGENTS.md 一致——条目是否已完成以文档显式状态为准；实现行为以
`src/`、`cordis.patch.yml`、`package.json` 为准；拿不准的事实标注假设，不编造。

## 4. 任务队列（按优先级；估计为预算上限）

| ID | 任务 | 依据（状态层） | 估计 | 验收门 |
|---|---|---|---|---|
| T0 | 基线与隔离：建 worktree、`pnpm install`、基线 `pnpm test` + `test:coverage` 存档数字 | §1 | 20m | 两命令全绿，数字入运行日志 |
| T1 | `shell-env.js` 覆盖：`apply()` 运行时分支（distro 兜底、端口刷新的 scan 失败/异常两臂、`agent/created` 生命周期、`resolve()` 的 pinned/default 拒绝臂、`ctx.effect` 清理） | 覆盖率 50% 分支 / 45% 函数（2026-11-06） | 45m | 该文件分支 ≥80%，全链绿 |
| T2 | `index.js` 覆盖·一：行 127-133、136、176-179、480-481、511-516、1006-1010、1031、1062、1095-1096、1119（sandbox/interop/cwd/env 的拒绝臂） | 覆盖率 74.03% 分支 | 60m | 聚合分支 +0.5pp 以上，全链绿 |
| T3 | `index.js` 覆盖·二：行 1267-1272、1307-1315、1497-1498、1522-1529、1543-1547、1572-1574、1650、1816-1825、1888-1896、1909-1917、1931-1940（fs/diff/watch/picker 面） | 同上 | 60m | 同上 |
| T4 | `fsio-agent.js` 覆盖：fail 分类的方言臂、resolveTarget 边界、批量记录的坏行臂 | 覆盖率 76.54% 分支 | 40m | 该文件 ≥85%，全链绿 |
| T5 | `watcher.js`（75%）+ `agent-shared.js`（函数 50%）：watch 循环的退出/错误臂、共享 agent 的回退臂 | 覆盖率 2026-11-06 | 40m | 两文件分支 ≥85%，全链绿 |
| T6 | 其余 <88% 文件覆盖打包：`preflight.js`、`terminal-route.js`、`git-exec.js`、`git-route.js`、`wsl.js`、`fs-routing.js`、`fs-substrate.js`、`paths.js`、`native-agent.js`、`file-reference-wsl.js`、`agent-protocol.js`、`session-runtime.js`——按文件逐个小补，能补多少补多少 | 覆盖率 2026-11-06 | 45m | 聚合分支 ≥86%，全链绿 |
| T7 | 目录 fsync（REVIEW#1，REVIEW-2026-10-03.md:221）：核对 native agent 能否同变更（工具链在位则双实现并重对拍；否则按 PEER-PARITY 规则记录为后端差异或维持开放，证据写入原条目） | REVIEW"仍开放"第 1 项；docs/LIMITATIONS.md:27-28 | 45m | 二选一落地：代码+测试，或记录性提交（不改 LIMITATIONS 之外的行为） |
| T10 | 探针卫生（REVIEW#3/#4）：`test/probe/.scratch` 清理接入探针脚本收尾（清自己产生的临时目录）；`run-all-when-closed.sh` 补 npm script `probe:all-closed`（注释注明须 Harness 关闭，不接入 `pnpm test`） | REVIEW"仍开放"第 3、4 项 | 25m | style 检查绿；不改变 `pnpm test` 行为 |
| T11 | 文档措辞修正：`fsio-agent.ts` versionOf 的"任一字节变化"串（REVIEW#7，src/fsio-agent.ts:73-77 保留自洽性论述、删绝对化声明）；LIMITATIONS.md:119-121 补 WSL-313 的在驻状态合入事实 | REVIEW"仍开放"第 7 项；ROADMAP-1.0.md:589-597 vs CHANGELOG WSL-313 | 20m | `pnpm run lint:links` 绿 |
| T8 | 双 distro 并发探针**编写**（WSL-101）：按 `test/probe/` 既有模式新写 `two-distro.sh` + 探针脚本，两 distro 并发命令/FS 会话互不串扰；标注 INCONCLUSIVE 语义与 `wsl --shutdown` 前置；**不运行** | docs/ROADMAP-1.0.md:216-222 | 50m | 脚本可 `bash -n`、summarize 兼容；运行记录留人工门 |
| T9 | agent kill/restart 探针**编写**（WSL-207）：驻留进程被杀后的恢复与状态报告探针骨架 | docs/ROADMAP-1.0.md:589-614 | 40m | 同上 |
| T12 | ROADMAP-1.0.md 时效刷新：表头日期与基线版本、Files 行（FSB 批帧已落地，保留 upstream `@` seam 的残留）、WSL-207 状态段补 WSL-313 合入、§a1 各行逐条核对后改写 | ROADMAP-1.0.md:3,59-65,589-597；PEER-PARITY.md:151-153 | 50m | `lint:links` 绿；每处改写附核对日期 |
| T13 | 上游 seam 在线核对（网络只读）：cordis/dsh 仓是否已提供 session-notice（#10263）、`FileReferenceTraversal`、terminal title seam；结论按日期写回八个 `docs/UPSTREAM-*.md` 的现状段；不可达则记录并跳过 | docs/DOCUMENTATION-MAP.md:60；docs/LIMITATIONS.md:65-68,129-132,164-166 | 40m | 改动仅限 UPSTREAM-*.md 现状段 |
| T14 | 收尾单元：全量 `pnpm test` + `test:coverage`、运行日志收口（任务×结果×提交号×数字）、汇总一段 | §5 | 30m | 树干净、日志完整 |

时间合计约 11 小时：**≥4 小时的预算只消费队列前段**（预计 T0–T5/T6），
余下任务留作下一次运行的存量。预算治理见 §3。

## 5. 运行日志与收尾

- 日志路径：`docs/superpowers/runs/<日期>-autonomous-run.md`（运行结束时随收尾单元
  提交；运行中先写在 worktree 根的 `RUN-LOG.md`，避免半截文档进历史）。
- 每任务一行：`T<N> | 结果(done/skipped/reverted) | 提交号 | 验收数字 | 备注（失败原因/假设）`。
- 收尾汇总：总耗时、任务完成数、覆盖率前后对比、留给人工的事项清单
  （真机探针运行、合并 worktree、是否推送）。

## 6. 明确排除（自治运行不做，原因）

- 真机探针**运行**与 `wsl --shutdown`：须 Harness 关闭与人工在场（AGENTS.md；
  docs/superpowers/probe-runs/2026-11-05-probe-suite.md 的操作规程）。
- 非 systemd distro 腿、interop-disabled 腿（WSL-201/208）：需 distro 级变更。
- 上游 seam 的实现（ensureSession 猴补、FileReferenceTraversal、terminal title）：
  非本仓可独立修（REVIEW#5；docs/upstream/promotion-map.md:62）。
- CI 变更（nightly probes、自托管 runner、canary 自动开 issue——后者已记录为
  "workflow 无 issue 权限，维持不做"，ROADMAP-1.0.md:660-664）。
- 发布与版本决策（0.19/1.0）：干净机器计时、30 天无 P0 是人工门（ROADMAP-1.0.md:785-787）。
- 对等锁死项（CRLF 4096 启发式、diff-basis 门、`grep -rE` 回退）：要改必须上游一起改。
