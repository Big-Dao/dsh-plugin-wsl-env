# 晋升地图：对照 ssh 家族的预就绪状态

> 内部文档。记录"如果上游未来收编（或我们按其架构品味重构），本插件到
> `packages/ssh` 同构形态的映射、差距与已就绪件"。上游 CONTRIBUTING.md 明确
> 现阶段不接受外部 PR，因此本文是**预就绪清单**而非 PR 计划；上游英文草稿见
> 同目录 `rfc-wsl-workspaces.md` 与 `issue-unc-validation.md`。

## 1. 目标形态：`packages/wsl/` provider 家族（对照 `packages/ssh/`）

| ssh 家族 | 服务 | 本插件的对应物 | 状态 |
|---|---|---|---|
| `ssh`（连接/传输生命周期、helper 安装、digest、租约） | `ctx.ssh` | `lib/agent.js`（常驻 agent：EXEC/ACK/RES/KILL 行协议、watchdog、idle 自杀、一次重建）+ `lib/agent-shared.js`（按 distro 的进程级单例）+ `agent/wsl-agent.sh` | 🟡 结构就绪；缺 digest 验证与租约机制 |
| `fs-ssh`（`ctx.fs`） | `ctx.fs` | `lib/fs-substrate.js` + `lib/fsio-agent.js`（distro 内 canonical/stat/读/原子写/守卫；写入守卫内联） | 🟢 就绪（PEER-PARITY 逐函数核对过 fsio 复刻） |
| `subprocess-ssh`（`ctx.subprocess`） | `ctx.subprocess` | `lib/index.js` `WslShellExecutor`（agent 路 + one-shot 回退）+ `lib/agent-exec.js`（handle 形态） | 🟢 就绪（超时/终止/截断语义与 one-shot 对齐有 probe） |
| `sandbox-ssh`（远端后端选择） | `ctx.sandbox` | `lib/sandbox-core.js` + `lib/bwrap.js` + `lib/agent-confined.js`（bwrap 组装、probe fail-closed、confined 常驻路由） | 🟢 就绪（enforcement=partial 的诚实报告与上游同款） |
| `lsp-stdio` 成对远程（ssh 依赖 lsp-stdio） | `ctx.lsp` | — | ❌ 未做（desktop 组合本就未挂载 LSP；挂载需 fs+subprocess 成对的远程实现） |
| 终端（`subprocess-ssh` 内） | — | `lib/subprocess.js` `spawnTerminal` + `lib/terminal-activity.js`（distro 侧 idle 观测） | 🟢 就绪 |

## 2. 关键结构差异：为什么现在是"三形态接管"而不是"三行成对替换"

**决定性约束：desktop 是单进程混合世界。** 根 realm 是 session-less 的（`fs-sandbox`/
`subprocess-local` 挂在组合层，不感知会话），而 desktop 要求同一进程同时服务
C:\ 工作区与 `\\wsl.localhost` 工作区（`WorkspaceRegistry` 多条目并存）。ssh 家族
成立的隐含前提是"一个进程一个世界"（headless profile 指向一台主机），在 desktop
上结构不可达。因此：

1. **preset isolate 按会话切环境**——host 的挂载审计强制 isolate
   （`mount.ts:265-267`"Preset services require isolate realms"），正好承接
   "shell/fs 按会话在 host/wsl 两个世界间切换"。
2. **根平面按坐标拦截**——未 isolate 的服务（`subprocess`）在 preset 树内仍解析
   到根，所以终端与搜索只能在根 provider 内按 cwd 坐标分流
   （`terminal-route.js`、`search-route.js` 的判据都是纯坐标函数）。
3. **常驻 agent 用模块级单例**（`agent-shared.js` 的 Map）而非 ctx 服务——因为
   composition 层（subprocess/picker）与 preset isolate 层（shell/fs）都必须拿到
   **同一个** distro 内 resident；ctx 服务是 realm 敏感的，模块单例不是。这一点在
   晋升时是显式决策点，不是疏忽。

## 3. 晋升时的差距清单（按工作量排序）

1. **TypeScript 化 + monorepo 包布局**（`src/types.ts`、tsconfig 叶子、tests 移至
   包级、README 的 Model Experience 格式与 i18n、`## Known Limitations and
   Deferred Work` 章节）。本插件为 JS + JSDoc，无构建链。
2. **REAL-composition boot 测试**——上游要求 product-visible 插件必须经 Loader
   启动测试用 cordis.yml（`packages/AGENTS.md` testing 政策），而本仓库测试环境
   缺少多数 peer 包（`dsh-bash-local`/`dsh-fs-local`/`dsh-fs`/`agent-loop` 等），
   无法在本仓跑；现以 probes（真机、真 profile）替代。晋升时并入其测试体系。
3. **`ensureSession` monkey-patch 的替换**——`auto-preset.js` 补丁了 host 的
   sessionController 以实现"目录→preset"。上游不会接受补丁式 hook；需提案正式
   seam（如 session 创建时的 environment resolver）。这是插件最脆弱的接缝。
4. **搜索的 seam 化**——rg spawn 拦截依赖"argv[0] 基名为 rg"的形状识别；正式形态
   应是 tool-fs-search 暴露 provider 口（或根 subprocess 的 transport 抽象）。
5. **helper 的 digest 验证与租约**——对照 `dsh-ssh` 的 artifact digest + 心跳
   租约 + 有界清理；插件的 agent 协议已有 watchdog/idle/一次重建，缺部署物校验。
6. **未接管的 9P 消费者**——workspace-files（GUI 文件树/预览，根 ctx.fs）/
   workspace-changes（host git 跨 9P）/ file-reference-local（`@` 补全直读）/
   ptc-runtime。晋升后随根平面 provider 自动正确；在此之前维持 9P。

## 4. 已就绪件的清点（晋升时可直接迁移）

- **常驻 agent 协议**：NDJSON EXEC/ACK/RES/KILL、watchdog 在 ACK 后计时、空闲
  自杀、一次重建、CwdError 合成 relay stderr（`lib/agent.js`、`lib/agent-protocol.js`）
- **bwrap 组装器**：`lib/bwrap.js` 单一 builder 服务两个 confinement 点；probe
  进程级缓存、fail-closed（`lib/sandbox-core.js`）
- **fs 基座**：distro 内 canonical/stat/流读/原子写/守卫，peer-faithful
  （`lib/fs-substrate.js`、`lib/fsio-agent.js`、`lib/fsio-text.js`，PEER-PARITY 记录）
- **搜索路由与 handle**：`lib/search-route.js`（纯决策）+ `lib/search-exec.js`
  （agent 承载 facade，one-shot 委托回退；stdin 启发式守卫 `-- .`）
- **终端观测**：`lib/terminal-activity.js`（exec-time environ 计数语义）+
  `lib/subprocess.js` 的 `DSH_TERMINAL_ID` 标记
- **坐标层**：`lib/paths.js`（UNC_RE/DRIVE_RE/包含判定）+ `lib/terminal-route.js`/
  `lib/search-route.js` 两个纯决策模块
- **picker**：distro 列表 + agent 优先的列目录/建目录（`lib/picker.js`）
- **诚实语义**：enforcement=partial、FS_SANDBOX_DENIED、unknown 不回收、
  sandboxMode 与强制共同进退

## 5. 显式决策记录

- **保留 UNC 身份**：缓存/会话头/GUI 的 key 全部是 `\\wsl.localhost\...`；改用
  Linux 路径身份会破坏既有会话与 Windows 桥（用 Windows 应用打开文件）。
- **模块级 agent 单例优先于 ctx 服务**：见 §2.3。
- **watch 用轮询而非 inotify**：`ctx.fs.watch` 契约只要求粗粒度失效回调；
  `find -newer` 轮询在长驻 wsl.exe 内，无需 inotifywait 依赖（已知盲点：
  mtime 早于 stamp 的文件）。
- **删除而非兼容**：share 基座退役后，`agent`/`resolveSymlinks`/`publish`/
  `withCanonicalRetry`/`guardRefusal` 全部删除——上游若收编，删除即历史。
