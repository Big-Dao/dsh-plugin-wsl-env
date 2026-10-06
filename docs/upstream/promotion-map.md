# 晋升地图：对照 ssh 家族的预就绪状态

> 内部文档。记录"如果上游未来收编（或我们按其架构品味重构），本插件到
> `packages/ssh` 同构形态的映射、差距与已就绪件"。上游 CONTRIBUTING.md 明确
> 现阶段不接受外部 PR，因此本文是**预就绪清单**而非 PR 计划；上游英文草稿见
> 同目录 `rfc-wsl-workspaces.md` 与 `issue-unc-validation.md`。
>
> **适用基线**：本插件 0.8.0；上游 `@deepseek-ai/dsh-*` 的 peer 锁定为
> 0.2.0-rc.2，文中的上游 file:line 引用（`mount.ts`、`git.ts`、
> `packages/api/workspace-files/src/index.ts`、`search.ts` 等）以该版本源码树
> 为准——上游源码不在本仓，要复核需自备该版本；peer 升版后这些行号会静默失效，
> 引用需重新核对。最后核对：2026-10-06。

## 1. 目标形态：`packages/wsl/` provider 家族（对照 `packages/ssh/`）

| ssh 家族 | 服务 | 本插件的对应物 | 状态 |
|---|---|---|---|
| `ssh`（连接/传输生命周期、helper 安装、digest、租约） | `ctx.ssh` | `lib/agent.js`（常驻 agent：EXEC/ACK/RES/KILL 行协议、watchdog、idle 自杀、一次重建）+ `lib/agent-shared.js`（按 distro 的进程级单例）+ `agent/wsl-agent.sh` | 🟢 就绪（0.7.2 后：HELLO 携带脚本内容 sha256，宿主拒绝与包内副本不符的部署物——镜像就地读取的半同步/过期是最现实的失效；客户端租约 `DSH_AGENT_LEASE_MS` 经托管命名空间下发，中继楔死无 EOF 时 agent 自杀；boot 清扫 60 分钟无活动的 `wsl-agent.*` 残留 tmpdir；证明：`test/agent-protocol.test.mjs` + `test/agent.test.mjs`（假传输，CI 全跑），真机 `test/probe/agent.sh`） |
| `fs-ssh`（`ctx.fs`） | `ctx.fs` | `lib/fs-substrate.js` + `lib/fsio-agent.js`（distro 内 canonical/stat/读/原子写/守卫；写入守卫内联） | 🟢 就绪（PEER-PARITY 逐函数核对过 fsio 复刻；证明：`test/fsio-agent.test.mjs` + `test/fs-substrate.test.mjs` + Loader 启动的 `test/fs.boot.test.mjs`，真机 `test/probe/substrate.sh`） |
| `subprocess-ssh`（`ctx.subprocess`） | `ctx.subprocess` | `lib/subprocess.js` `WslSubprocessRuntime`（三条 spawn 改写：终端、搜索 agent 优先 + one-shot 回退、git 只走 one-shot） | 🟢 就绪（两条 spawn 改写的纯决策各有单测：`test/search-route.test.mjs`/`search-exec.test.mjs`、`test/git-route.test.mjs`；`subprocess` 行的禁用由 `test/composition.test.mjs` 跑真 patch 算法核对） |
| （ssh 家族未单列 shell 行） | `ctx.shell` | `lib/index.js` `WslShellExecutor`（agent 路 + one-shot 回退）+ `lib/agent-exec.js`（handle 形态） | 🟢 就绪（`test/provider.test.mjs` 用真类 + 假 agent 覆盖 guard 链/执行路/回退；完成/超时/kill（连同 cwd 失败与登录 shell 原样执行）由真机 `test/probe/exec.sh` 覆盖，截断语义见 `test/agent-exec.test.mjs`/`test/agent-protocol.test.mjs`，agent 路与 one-shot 的对拍是 `test/probe/agent.sh` 的 fallback parity 三项） |
| `sandbox-ssh`（远端后端选择） | `ctx.sandbox` | `lib/sandbox-core.js` + `lib/bwrap.js` + `lib/agent-confined.js`（bwrap 组装、probe fail-closed、confined 常驻路由） | 🟢 就绪（enforcement=partial 的诚实报告与上游同款；证明：`test/sandbox.test.mjs` 的 probe fail-closed/缓存，真机 `test/probe/sandbox.sh`/`sandbox-shell.sh`/`sandbox-off.sh`） |
| `lsp-stdio` 成对远程（ssh 依赖 lsp-stdio） | `ctx.lsp` | — | ❌ 未做（desktop 组合本就未挂载 LSP；挂载需 fs+subprocess 成对的远程实现） |
| 终端（`subprocess-ssh` 内） | — | `lib/subprocess.js` `spawnTerminal` + `lib/terminal-activity.js`（distro 侧 idle 观测） | 🟢 就绪（`test/terminal.test.mjs` + `test/terminal-activity.test.mjs`，真机 `test/probe/terminal.sh`） |

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

1. **monorepo 包布局**（tsconfig 叶子、tests 移至包级、README 的 Model Experience
   格式与 i18n、`## Known Limitations and Deferred Work` 章节）。TypeScript 化本身
   已完成（0.8.0：`src/` 全量为 36 个 `.ts` 模块，`tsc` 构建到 `lib/`，声明随包
   发布，`pnpm run lint:build` 是 `lib/`↔`src/` 漂移门）；环境类型在
   `types/dsh-services.d.ts`，不另设 `src/types.ts`。残余的只有包级化与文档格式。
2. **REAL-composition boot 测试**——0.7.1 起已在本仓落地（`test/fs.boot.test.mjs`
   把 fs 行经 Loader + cordis.yml 启动；devDependencies 锁定 peer 包，CI 安装后
   全量运行），0.7.2 又加了组合测试（`test/composition.test.mjs` 用真实
   `applyEntryPatches` 跑插件的 patch 文件）。残余差距只剩覆盖面：上游形态还
   要求整个组合（agent-loop 等）经 Loader 启动，那要等晋升时并入其测试体系。
3. **`ensureSession` monkey-patch 的替换**——`auto-preset.js` 补丁了 host 的
   sessionController 以实现"目录→preset"。上游不会接受补丁式 hook；需提案正式
   seam（如 session 创建时的 environment resolver）。这是插件最脆弱的接缝。
4. **搜索的 seam 化**——rg spawn 拦截依赖"argv[0] 基名为 rg"的形状识别；正式形态
   应是 tool-fs-search 暴露 provider 口（或根 subprocess 的 transport 抽象）。
5. **helper 的 digest 验证与租约**——已落地（协议 v4）：digest 在 HELLO 握手
   对照包内副本（`agent-shared` 计算一次、两个 resident 工厂共用），租约经
   `DSH_AGENT_LEASE_MS` + WSLENV 下发、脚本内看门狗子 shell 轮询 in-flight
   标记（dash 无 `read -t`，文件标记是可用方案），boot 清扫过期 tmpdir。
   与 ssh 家族的差异是形态性的：ssh 的租约由对端心跳续期，本插件的租约是
   「静默即逝」，因为传输是同机管道——EOF 可靠，楔死才需要它。
6. **未接管的 9P 消费者**——只剩 file-reference-local（`@` 补全直读；
   `inject=['agents']` 且不走 ctx.fs，等上游 FileReferenceTraversal seam，见附录 B）
   与 ptc-runtime。原列的 workspace-changes（host git 跨 9P）已在 0.7.1 接管
   （git-route，subprocess-wsl 顶层 insert，当期生效）；workspace-files（GUI 文件
   树/预览）的行替换虽在 0.7.1 引入，但 patch 行当时嵌在嵌套 `insert:` 里从未挂载，
   直到 0.7.2 的组合修复才真正生效；根平面 fs 的按坐标路由自 0.7.2 起。三者不再
   维持 9P（时间线见 CHANGELOG 0.7.2 的 Fixed 与附录 B 落地记录）。

## 4. 已就绪件的清点（晋升时可直接迁移）

- **常驻 agent 协议**：行协议（`|` 分隔字段 + 单行 base64 负载）的
  EXEC/ACK/RES/KILL、watchdog 在 ACK 后计时、空闲自杀、一次重建、CwdError 合成
  relay stderr（`lib/agent.js`、`lib/agent-protocol.js`）
- **bwrap 组装器**：`lib/bwrap.js` 单一 builder 服务两个 confinement 点；probe
  进程级缓存、fail-closed（`lib/sandbox-core.js`）
- **fs 基座**：distro 内 canonical/stat/流读/原子写/守卫，peer-faithful
  （`lib/fs-substrate.js`、`lib/fsio-agent.js`、`lib/fsio-text.js`，PEER-PARITY 记录）
- **搜索路由与 handle**：`lib/search-route.js`（纯决策；stdin 启发式守卫 `-- .`
  在此）+ `lib/search-exec.js`（agent 承载 facade，one-shot 委托回退）
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

## 附录 A：git 拦截的设计分析（已实现）

`workspace-changes` 的 git 快照经根 `ctx.subprocess` 跑 `[host git, ...args]`，
cwd = 工作区。这是 9P 上最重的操作（`git add --all` 是全工作树扫描）。拦截设计
的三个关键事实（全部源码级确认）：

1. **快照本来就跑在私有 git 环境里**（`git.ts:140-175`）：`GIT_INDEX_FILE` 指向
   私有 scratch index（从仓库 index 复制种子），`GIT_OBJECT_DIRECTORY` +
   `GIT_ALTERNATE_OBJECT_DIRECTORIES` 指向私有对象库——"the repository's index,
   object store, work tree, and refs stay unchanged"。因此 distro git 用同样的
   私有环境干活，**用户仓库零风险**；真机验证只记于 0.7.1 发布说明（结论：用户
   index、对象库、refs 未被触碰），本仓没有该次运行的探针或日志——原句的「私有树
   138 文件」「确定性可复现」两项在此无法核对。
2. **env 里的路径是坐标翻译问题**：scratch 在 Windows temp（盘符）、仓库身份在
   UNC——`uncToPosix` 与 `windowsToLinuxMount` 恰好是确定性翻译，无需 wslpath。
3. **发现类命令必须留在 host**：`rev-parse --show-toplevel/--absolute-git-dir/
   --git-path` 输出绝对路径，调用方 `resolve(cwd, line)` 按 UNC 世界解析——
   distro git 会答 Linux 路径破坏解析。排除规则 = argv 含这三个旗标即不拦截。

实现：`lib/git-route.js`（纯决策 + env 翻译）+ `subprocess.js` spawn 的 git
分支（**只走 one-shot**——快照操作不敏感延迟，且 stdin 中继/收集流是宿主
handle 原生的，避免扩展 agent 协议）。已知限制：多目录 `GIT_ALTERNATE_OBJECT_
DIRECTORIES`（列表值）不是被跳过而是被译坏——`translateGitEnv` 对每个 `GIT_*` 值
无条件调用单值翻译，`C:\a;D:\b` 会得到混合形态 `/mnt/c/a;D:/b`（现无调用方设置
列表值；`src/git-route.ts` 的模块注释仍写作 `passes through untranslated`，与
实现不符）；distro 无 git 时报
git 自己的 "command not found"（exit 127）——与搜索同样是**拒绝静默回退**
（fail-closed）：把子进程自己的 command not found 原样上抛，而不是悄悄退回宿主侧。

## 附录 B：剩余 9P 消费者的接管评估

| 消费者 | 源码事实 | 接管评估 |
|---|---|---|
| `file-reference-local`（`@` 补全） | `inject=['agents']`，**不走 ctx.fs**——`search.ts:9,273,286` 直接 `node:fs/promises` readdir/lstat | 🟡 **预就绪**（RFC 增补①已成文：`FileReferenceTraversal` 三函数接口 + Dirent/错误/坐标系三条语义）：遍历漏斗在模块内函数里，插件无法从子类到达——排序引擎（代际/陈旧即答/排名）必须留给上游。消费侧原型 `lib/file-reference-wsl.js` 已测（agent `find -printf '%y'` 保 Dirent 语义、单次 exec 走段替代逐段 lstat、UNC↔POSIX 换算），seam 落地即接管 |
| `workspace-files`（GUI 文件树/预览） | `inject=['fs','sandboxPolicy','sessions','typert']`（`index.ts:184`）——消费**根 ctx.fs**（fs-sandbox，host fs） | 两层结论：①行替换可行但拿到的是根 ctx.fs，要配一个**按坐标路由的 fs facade**（UNC→agent，盘符→host）；②战略终局 = 把该 facade 提升为根平面 `fs-sandbox` 行的替换（所有根消费者自动正确），但根 fs 是 session-less 的，facade 必须纯坐标判定（UNC→distro、盘符→host）且放弃 per-session 语义——需要单独的评审 |
| `workspace-changes`（git 快照） | `git.ts:58` 经根 `ctx.subprocess` spawn host git | ✅ **已接管**（git-route，见附录 A） |

**落地记录（2026-10-04）**：路线二已实现——`lib/fs-routing.js` 的
`WslRoutingFileSystem` 替换根 `fs-sandbox` 行（设计文档
`docs/root-fs-routing.md`）；workspace-files 的四操作维持 agent 直连（快于
本路由），change feed 经路由 fs 获得 distro 真实 watch 事件。（当时禁
`fs-sandbox` 行与插入 `fs-routing` 的条目同样嵌在嵌套 `insert:` 里、都未挂载，
直到 0.7.2 的组合修复才生效——CHANGELOG 0.7.2 的 Fixed。）

**战略注记**：②的"根平面路由 fs facade"与 ssh 家族的"成对远程 provider"在效果上汇合——
区别只在挂载位置（替换根 fs 行 vs 三个 seam 成对）。若上游未来做 desktop+WSL 的正式支持，
这就是合并点。

## 附录 C：workspace-files 接管设计评审

> **状态（2026-10-06）**：本附录是设计评审的历史记录，两条路线均已落地——
> 路线一随 0.7.1 发布（`lib/workspace-files-wsl.js` 行替换 + agent 直连），但其
> patch 行当时嵌在嵌套 `insert:` 里从未挂载，0.7.2 的组合修复后才在实机生效；
> 路线二随 0.7.2 落地（`lib/fs-routing.js` 的 `WslRoutingFileSystem` 替换根
> `fs-sandbox` 行，设计文档见 `docs/root-fs-routing.md`）。下文保留当时的方案与
> 权衡；表内与实现不一致的四处配方（list/stat/read/readBytes）已就地更正为实际形态。

源码事实（`packages/api/workspace-files/src/index.ts`，465 行）：`WorkspaceFiles
extends TypertRemoteService`，`inject=['fs','sandboxPolicy','sessions','typert']`；
read/readBytes/stat/list/changes 五个 @Remote 操作**全部漏斗到 `this.ctx.fs`**
（resolve/lstat/stat/listDir/readByteRange/readBytes/contains/processPath/
fileUrl），坐标基点 = `workspaceFileScope.workspaceRoot` = session header cwd
（WSL 工作区即 UNC）。行替换（插件模式）拿到的仍是根 ctx.fs——**子类无法通过
继承改换 fs**，因为 fs 来自 context 而非字段。

### 路线一（0.7.1 引入，0.7.2 组合修复后生效）：子类覆写 @Remote 操作 + agent 直连

`WorkspaceFilesWsl extends WorkspaceFiles`，覆写 read/readBytes/stat/list 四个
操作，`changes`（watch 流）始终委托 `super`：`scope.workspaceRoot` 非 distro UNC
→ `super.*`（host 原生）；distro UNC → 常驻 agent 直连，distro 内复刻各操作的语义：

| 操作 | distro 侧实现 | 语义要点 |
|---|---|---|
| list | agent `ls -1ALp <dir>`（`-L` 解引用、`-p` 目录后缀）+ `head -n max+1`，多取一条判截断（`listDistroArgv`） | 含 `--` 路径尾、目录 `/` 后缀；contains = Linux 路径前缀检查（workspaceRoot 的 Linux 形态） |
| stat | agent `stat -c %F`（不跟随）+ `stat -L -c '%s\t%D\t%i\t%Y\t%Z'`，合成 `dev:ino:size:mtime:ctime` version（`statRecordArgv`） | version 与 fsio 格式不同但仅 GUI 消费（不透明字符串） |
| read（行分页） | agent `sed -n "${offset},$((offset+limit))p"`（多取一行判 EOF；stat 记录走 stderr，`pageArgv`）；NUL/UTF-8 与字节帽在宿主侧裁页时判定 | eof = 行数 < limit |
| readBytes | agent `tail -c "+$((offset+1))" \| head -c <len>`（stat 记录走 stderr，`bytesArgv`） | eof 按size 判定 |
| changes（watch 流） | **不接管**：委托 super（其 feed 走 ctx.fs.watch=轮询，行为不变） | 保持现状 |

- 优点：不动根平面；与 picker 完全同构；工作树增量可控。
- 代价：**语义复刻面**（分页字节边界、NUL、排序稳定性、错误码映射
  not-found/outside-workspace）——每项都要对拍上游行为；上游改 WorkspaceFiles
  时子类要跟。
- 变更面（已执行）：cordis.patch.yml 按其余根平面接管同款的两段式——禁
  `workspace-files` 行 + 插入 `workspace-files-wsl` 变体。

### 路线二（已落地，0.7.2）：根平面路由 fs facade

替换根 `fs-sandbox` 行为**按坐标路由的 fs**：UNC → distro substrate
（现 WslFileSystem 全套），盘符 → 宿主原生（fs-local，保留 ACL 语义与
fs-sandbox 围栏）。一次替换，**所有根消费者自动正确**（workspace-files 无需
子类、workspace-changes 的 fs 侧、未来消费者）。

- 决定性风险：根 fs 是 session-less 的；路由必须**纯坐标判定**（UNC→distro、
  盘符→host），放弃 per-session 语义（根 fs-sandbox 的 policy 围栏对 UNC 路径
  的可写根判定要重新推导——policy.workspaceRoot 是部署默认，多工作区下的
  writableRoots 语义要重设计）。
- 与 ssh 家族的关系：这就是"成对远程 provider"在单进程混合世界的落法——
  上游若做 desktop+WSL 正式支持，合并点在此。

### 结论（已执行）

当时的建议是"路线一先行、路线二独立评审"，执行结果一致：路线一随 0.7.1 发布
（0.7.2 组合修复后生效），路线二随 0.7.2 落地。路线二的核心未决问题（根平面 fs 的 per-session 语义）以
**根围栏退役**的形态了结——根平面当前没有写消费者，围栏语义留待未来出现根平面
写消费者时随行（`docs/root-fs-routing.md` §2.2）。残余事项：路线一的子类需跟随
上游 `WorkspaceFiles` 的变更（见上文"代价"）。
