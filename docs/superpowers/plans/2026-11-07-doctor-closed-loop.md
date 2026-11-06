# Doctor 闭环运行规划（WSL-316，商业级达标）

> 本规划落地 issue [#35](https://github.com/Big-Dao/dsh-plugin-wsl-env/issues/35) 的
> 两份设计（2026-11-06 初版、2026-11-07 商业级增补）。验收标准：
> **doctor 绿 ⇒ 首条命令成功**——检查、修复、复检构成闭环，verdict 是机器可读的
> 就绪裁决而非检查项堆叠。规划时基线：`8c6094c`（0.19.0 + 文档批次）。

**范围（已与维护者确认）：** WSL-316 全部检查与机制 + A 级五项（A1 多 distro 全检、
A2 磁盘、A3 `.wslconfig` 语义、A4 错误码矩阵、A5 计时）+ B 级五项（B1 bundle、
B2 DNS/时钟、B3 git 白名单 fix、B4 卫生、B5 弃用键）。C 级明确不做（见文末）。

**分工协议：** 代理执行全部编码与单测、本侧真机验证（doctor 对真实 `wsl.exe`，
只读）；需要 DSH 应用关闭的探针套件腿与 GUI 会话闭环腿，产出逐步清单由维护者执行。
提交协议：一次提交一个逻辑变更，每次提交前 `pnpm test` 全绿；全部完成后推送并核对 CI。

## 任务队列

| ID | 任务 | 依据 | 验收门 |
|---|---|---|---|
| D1 | 规划工件：本文 + ROADMAP-1.0 增 WSL-316 节 + 文档地图登记 | [#35 增补 comment](https://github.com/Big-Dao/dsh-plugin-wsl-env/issues/35#issuecomment-6691256051) | `lint:links` 绿 |
| D2 | 报告重构 `schemaVersion: 2`：`blocksFirstCommand`、`verdict`/`blockers`/`distroVerdicts`、`skipped` 状态泛化、配置感知阻断（`effectiveConfig` 经 preset helper 同源解析路径读 `$DSH_HOME/profiles/*/cordis.patch.yml`；键 `distro`/`sessionSandbox`/`sandbox`/`maskWindowsDrive`/`agentBackend`） | #35 设计 §1、B4 | 单测 verdict 矩阵：systemd fail × `auto`/`true`/`false`；bwrap fail × `sandbox: false`；`doctor-live` 合并对 v2 兼容 |
| D3 | A1：`--all` 与目标集推导（显式 `--distro` > 生效行 pin > auto/default ⇒ 全部已装）；按 distro 聚合 verdict | #35 增补 A1 | fake 矩阵：两 distro 一台不可达不掩盖其余；`--all` 与默认目标集各有断言 |
| D4 | 新检查 `distro.wsl-mode` + `config.wslconfig`（含 A3 语义校验与读取路由报告） | #35 初版 + 增补 A3 | fake `wsl.exe -l -v` WSL1/WSL2；`.wslconfig` 畸形/未知键/越界值/`localhostForwarding=false` 各一臂 |
| D5 | 新检查 `distro.wsl-conf-boot`/`-interop`/`-automount` 与运行时事实交叉 | #35 初版 | interop-off、root-moved、pending-terminate × `maskWindowsDrive` 开/关 |
| D6 | A2 `distro.disk`（df -Pm /，90/97 阈值）+ B2 `distro.dns`/`distro.clock`（60s 漂移） | #35 增补 A2/B2 | 阈值边界单测；离线时 dns 腿诚实降级 info |
| D7 | smoke 三腿 `functional.exec`/`.sandbox`/`.fs`（复用 `lib/agent-protocol.js`、`lib/bwrap.js` 原语）+ 临时目录清理断言 | #35 设计 §2、B4 | 故障注入：EXEC 中途杀 resident 点名腿；noexec 缓存走 shell agent 仍达裁决 |
| D8 | fix 闭环：fix 后受影响检查复跑、before→after、verdict 重算；B3 `git.win-safe` 白名单纳入确认式 `--fix` | #35 设计 §3、B3 | fake 矩阵：修复前后 verdict 变化断言；`--read-only` 拒绝不变 |
| D9 | B5 弃用键检出（`substrate: "share"`、`distro: ''` → MIGRATION.md 指向） | #35 增补 B5 | profile 扫描 fake 一臂 |
| D10 | A5 分节计时（人读输出 + `timingsMs`）；测量后依仓库规则决定并行化 | #35 增补 A5 | Tier 1 实测时长记录在运行清单；超 10s 才并行 |
| D11 | B1 `--bundle <path>`（本地诊断文件 + `--redact` 脱敏 + 内容/隐私说明字段） | #35 增补 B1 | 打包测试覆盖新文件；redact 前后对比单测 |
| D12 | A4 `docs/DIAGNOSTICS.md` + `.zh.md`：全部具名错误码 → 检查项/瞬态分类 | #35 增补 A4 | 每个已发布错误码一行；links 绿 |
| D13 | 文档同步：LIMITATIONS（verdict 契约、remedy-only 边界）、CONFIGURATION（doctor/bundle）、QUICKSTART、`setup_report.yml` 提 bundle、CHANGELOG 按 RELEASING 约定 | #35 验收 | 双语成对；`lint:links` 绿 |
| D14 | 本侧真机验证：doctor 对真实 `wsl.exe` 全量跑通（含新检查的真实数据面） | 分工协议 | 真机输出记录进 probe-runs |
| D15 | 收尾：用户侧执行清单（关 App 探针套件 + GUI 闭环正反向腿）；推送、`git ls-remote` 核对、CI 复核 | 分工协议 | CI 绿；issue 验收清单逐项勾选或注明执行者 |

## 顺序与依赖

D1 → D2（形状定形，后续全部挂其上）→ D3 → D4–D6（检查批次，可合并提交）→
D7 → D8 → D9 → D10 → D11 → D12–D13（文档批次）→ D14 → D15。
D4/D5/D6 若一提交内聚（同为"新增环境检查"）允许合并为一个逻辑变更。

## 明确不做

遥测与自动上报；GUI 诊断面（上游 #10263 等待中）；消息本地化；防火墙 remedy
（无 logged pain，维持搁置）；distro 代装与 WSL1 自动转换（remedy-only）；
`durationMs` 独立 JSON 字段（D10 分节计时覆盖其用途）；安全声明升级（`partial` 不变）。
