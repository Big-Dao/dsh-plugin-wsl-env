# 需求登记表与追溯矩阵

本文是维护者治理文档，不随包发布（不在 `files` 清单）。它把分散在 README 与
docs/ 各篇里的行为承诺登记成带编号的需求条目，并给每条配上验证途径。它不是
第二份「当前状态陈述」——每条需求的权威正文仍在所指向的文档里，本文只回答
三个问题：**有哪些需求、在哪里规定、靠什么验证**。

**基线**：本文核对于 v0.8.0（commit `6e6128a`）。每次发版，或 CI 配置、
覆盖率阈值等可核验项变更后，本表须重新核验；一切以仓库现状为准。

维护规则与 [PARITY.md](PARITY.md) 的纪律一致：需求变更与登记表改动进同一笔
变更；新增行为承诺先入表再实现；「验证」列与测试同改。登记表的唯一判定
来源是文档与代码的现状，不是意图。

## 判尺

一条需求登记为「完备」，需同时具备六个维度，逐条在「依据」列标注：

1. **行为定义**：触发条件 → 行为 → 结果；
2. **异常与拒绝语义**：失败路径、错误码、什么能解除、什么不能；
3. **边界与非目标**：明示不做什么、已知极限写在哪里；
4. **可验证性**：单测 / 真机探针 / parity 方法；
5. **配置面**：默认值与覆盖方式；
6. **环境约束**：支持矩阵与版本钉。

## 登记表

| ID | 需求（一句话） | 权威规格 | 依据 | 验证 | 残差 |
|---|---|---|---|---|---|
| R1 | 命令在发行版内执行：`wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>`，登录 shell 不硬编码 | README「Using it」；ARCHITECTURE「The three service providers」「Failure mode」 | ①②④⑤⑥：命令形态与 `-lc` 语义成文；`WSL_E_*`（stdout/UTF-16/exit 255）与 cwd 回退 exit-0 两类陷阱显式转报错；agent/one-shot 双路径定义 | `shell.test.mjs`、`wsl.test.mjs`、`agent-exec.test.mjs`；probe:sandbox-shell；probe:agent 三条 on/off 对比腿 | — |
| R2 | 文件工具读写真实发行版文件：单一 agent 基座（ext4），share 基座不复存在 | ARCHITECTURE「The filesystem substrate」；LIMITATIONS 首节 | ①②③⑤：读/写/身份在 ext4、原生符号链接与 mode 位；`createIfAbsent` no-replace 关闭 TOCTOU、版本随写 op 下发并在 rename 前复核（`FS_STALE_VERSION`）；新文件 0600、agent 失联 fail-closed 均为明文；0600 与反斜杠文件名为已声明极限 | `fs-substrate.test.mjs`、`fsio-agent.test.mjs`、`agent-fs-script.test.mjs`、`provider.test.mjs`（守卫链）、`fs.boot.test.mjs`；probe:substrate 8/8 | rename 后无目录 fsync（OI-5，已入 LIMITATIONS） |
| R3 | 会话级环境绑定：distro 目录自动绑 `wsl` preset，Windows 目录保持原生 | ARCHITECTURE「How the pieces are mounted」；README「Architecture」 | ①②④：触发条件与 isolate realms 机制成文；registry/agent-loop 两棵树不相交的设计约束可复核 | `preset-choice.test.mjs` | 猴补上游 `ensureSession` 的接缝风险已转 promotion-map 跟踪（非本仓可独立修） |
| R4 | GUI 终端按会话路由：WSL 目录会话得发行版 shell，Windows 目录会话得 PowerShell（`hostSessions`） | ARCHITECTURE「Why the terminal provider is app-level」；LIMITATIONS 终端诸条 | ①②③⑤：路由判定、无目录启动落发行版、idle/busy/unknown 三态回收（`unknown` 必须暂停回收）逐项规定；tab 标题极限给出根因、上游提案与用户缓解 | `terminal.test.mjs`（terminalRoute 判定）、`terminal-activity.test.mjs`；probe:terminal | tab 标题读 `WSL`（UPSTREAM-TERMINAL-TITLE）；host 终端 unknown 不回收——均为已声明边界 |
| R5 | 目录选择器列出已装发行版及其层级 | README「Install」；CONFIGURATION `directory-picker-wsl` 行 | ①②③⑤：根级列表、`includeHostHome`/`maxEntries`/`preferredDistro`、常驻 out 时 one-shot 回退；换行符文件名极限的边界论证闭合（`/` 不可能出现在名字里） | `listing.test.mjs`（`maxEntries` 封顶、行解析）；probe:picker | `preferredDistro` 决定的根级 `path`/`home` 领位、`includeHostHome` 的排序姿态：单测与探针都没有断言（探针只查成员构成与截断旗标） |
| R6 | 端口可见性：`DSH_WSL_PORTS` 按节奏经常驻 agent 刷新 | README「Using it」；CONFIGURATION「`wsl-shell-env`」表 | ①⑤：机制（`/proc/net/tcp{,6}` 扫描）、`portsRefreshMs` 默认 10s、与 WSL2 localhost 转发的关系（平台行为）成文 | `ports.test.mjs`（解析层） | 轮询使常驻 agent 永不闲置回收（OI-4，已入 LIMITATIONS） |
| R7 | 模型可见的发行版事实与 WSLENV 政策：受管 `DSH_*` 前缀准入，`PATH` 刻意不转发 | README「Using it」「Recipes」 | ①②③：两个 Windows 路径变量带 `/p` 翻译、`PATH` 不转发的理由成文；传输环境钉死 essentials+`DSH_*`+过滤后 WSLENV；shell 解析失败则省略事实而非报假值（宁可缺报不误报） | `terminal.test.mjs`（`/p` 翻译）、`agent.test.mjs`（传输环境 WSLENV 钉死为受管项）、`provider.test.mjs`（探针失败重试、不钉占位符） | `lib/shell-env.js`（事实生成）无单测，覆盖率报告不含该模块 |
| R8 | 权限三档（read-only / workspace-write / danger-full-access）与提权提议流 | README「Sandbox」表；ARCHITECTURE「Error codes」 | ①②：三档行为逐档成表；模型可见两行前缀逐字给出；`FS_SANDBOX_DENIED` 可提权而 `FS_OUTSIDE_DISTRO` 不可，且区分理由明文（宽权限开不出另一个发行版） | `fs-decisions.test.mjs`、`provider.test.mjs`、`fsio-agent.test.mjs`（分类） | — |
| R9 | bubblewrap 沙箱：与 Linux runner 同参数、fail-closed、`enforcement: partial` 诚实上报 | ARCHITECTURE「Sandbox」全节；SECURITY「Sandbox enforcement is `partial` by design」 | ①②③⑤⑥：选型依据（ACL 令牌触不到 WSL）、探针失败不缓存、interop 洞 + `maskWindowsDrive` 收窄及其自身极限（binfmt 按内容分发）、完全关闭唯一路径（`wsl.conf`）、`sandbox: false` 退出——行为到边界到逃生门完整成链 | `sandbox.test.mjs`、`probe-cache.test.mjs`；probe:sandbox、probe:sandbox-off | interop 使 enforcement 恒为 partial——已声明的设计边界 |
| R10 | 文件搜索跑发行版自身的 rg，绝不跨 9p share | PARITY「Contract audit」第 2 条；LIMITATIONS「glob 和 grep」条 | ①②③：拦截点与参数逐字转发成文；缺 rg 浮出 exit 127 附 bootstrap 指引；grep 回退被拒绝且理由明文（不读 `.gitignore`，非 rg 替身） | `search-route.test.mjs`、`search-exec.test.mjs` | — |
| R11 | watch() 为发行版内轮询环：粗粒度失效，非事件流 | PARITY「Contract audit」第 1 条；LIMITATIONS watch 两条 | ①②③：契约向上追溯到宿主接缝（`changed()` 无载荷 → 轮询即满足）；更旧 mtime 不可见、节奏非即时、`watchMaxDepth` 旋钮、目标消失响亮报错成文；inotify 标注「计划未随发」 | `watcher.test.mjs`；probe:watch 6/6 | inotify 后端未实现——已声明 |
| R12 | share 基座退役：携带 `substrate: "share"` 的 profile 在 boot 被拒并附迁移 | README/CONFIGURATION/LIMITATIONS 三处一致 | ①②⑤：旧值处置与用户所见成文，迁移指引内嵌 | `fs-decisions.test.mjs`（拒绝消息与迁移指引文案） | boot 期拒绝分支无测试（构造器调 `shareSubstrateRefusal`，`src/index.ts:1056`）：`fs.boot.test.mjs` 只以 `sandbox: true` 启动该行，仓内没有构造 `substrate: "share"` profile 的测试 |
| R13 | bootstrap：bwrap/ripgrep 等的就地体检与安装 | README「Install」「Troubleshooting」；CONFIGURATION | ①②⑤：`--install` 与只读体检两式、体检对象、错误消息补救指引成文 | 0.7.4 起脚本随包（`files` 收录，补救指引在 npm 安装下可用） | 脚本本身无 CI 腿（真机排错路径覆盖） |
| R14 | 安装/卸载/升级流：四步安装、幂等陷阱及补救、ES 模块重启须知 | README「Install」「Troubleshooting」 | ①③：每步预期输出、`add` 幂等性陷阱的补救（先 remove 再 add）、pnpm UNC 链接极限成文 | 人工步骤，无自动化（依赖真实 dsh CLI + Windows） | 无自动化守护 |
| R15 | 错误码方言：每个 `FS_*` 码给出抛出者、含义、解除条件；`wsl.exe` 自身失败显式收编 | ARCHITECTURE「Error codes」表 | ①②：逐码三列成表；两类历史隐形失败（UTF-16 stdout、cwd 回退 exit 0）收编；`FS_OUTSIDE_DISTRO` 独立成码的理由明文 | `fs-decisions.test.mjs`、`fsio-agent.test.mjs`、`fs-substrate.test.mjs`、`provider.test.mjs`（断言码与消息） | — |
| R16 | 对端 parity 合同：fsio 文本机制逐字节复刻钉死的对端版本 | PEER-PARITY 全文 | ①④⑥：钉版、验证方法（npm pack 逐函数比对）、验证日期、刻意分歧逐条声明、bump 钉版即重跑的维护规则 | `fsio-agent.test.mjs`（distro 内半区 canary）；对端比对为手动方法 | 钉版升级后需重跑比对（维护规则） |
| R17 | 常驻 agent 协议：ACK 计时看门狗、只读帧才重放、逐流输出上限、sha256 部署校验、租约存活、进程组两段杀 | CHANGELOG 0.3.0/0.6.0/0.7.3；PARITY Phase 1/Phase 3 | ①②④：每条健壮性属性有规格出处与实证记录；「EXEC/变异 FS 帧禁止盲重发」是写明的不变量 | `agent-protocol.test.mjs`（HELLO 版本+摘要）、`agent.test.mjs`、`agent-exec.test.mjs`（truncated 旗标）、`agent-fs-script.test.mjs`；probe:agent、probe:exec | — |
| R18 | 配置面：每键默认值成文；层组合语义（整行替换、不深合并、后层胜） | CONFIGURATION；`cordis.patch.yml` 头注 | ⑤：随发键成表、未列表键点名；覆盖方式的正确心智模型（整行替换）成文 | `composition.test.mjs`（层组合）；`style.mjs`（`files` 契约） | — |
| R19 | 非目标集：不做什么与为什么 | LIMITATIONS 开篇原则；PARITY「Not applicable」 | ③：已知极限入册；不适用项「记下来免得像遗漏」 | —（文档性） | — |
| R20 | 验证策略：三层（fake → 真脚本过真线 → 真机探针）+ CI 矩阵 + 覆盖率阈值 | ARCHITECTURE「Test layers」；README「Development」 | ④：CI 在 Node 22/24 × Linux/Windows 上跑 `pnpm test`，`pnpm run test:coverage` 只在 Node 24 上跑（门槛旗标需 Node 22.8）；Node 20 有意排除（`engines` 下限）；覆盖率阈值 85/84/70（行/分支/函数），测量集合覆盖 `test/` 下 28 个测试文件中的 27 个，缺席 `fs-routing.test.mjs`（见 OI-7） | `pnpm test`、`pnpm run test:coverage`；CI（ci.yml） | 真机腿仅手动（OI-2）；非功能无量化目标（OI-1）；`fs-routing.test.mjs` 未入测量清单（OI-7） |
| R21 | 安全过程：范围内外、响应时限、partial 属设计边界、凭据政策 | SECURITY 全文 | ②③⑥：范围、3/10/30 个工作日时限（标注「目标非合同」）、partial 定性、凭据零容忍成文 | —（过程性） | — |
| R22 | 支持矩阵：Windows 10/11 + WSL2 + Node `^22.19.0 \|\| >=24.0.0` + 精确钉版 | SUPPORT 全文 | ⑥：支持与不受支持清单、精确钉版的「断得响」兼容预期成文；Node 20 在范围外（理由见 SUPPORT，`engines` 为准） | `peerDependencies` 与 `engines` 钉版（`package.json`）；CI 矩阵（ci.yml） | — |
| R23 | 根平面 `ctx.fs` 按坐标路由：发行版 UNC 由常驻 agent 服务（ext4 读、真实 watch 事件），盘符路径留在宿主；接替随发的 `fs-sandbox` 行 | README「Architecture」；ARCHITECTURE「The two root-plane takeovers」；CONFIGURATION `fs-routing` 行；root-fs-routing.md（设计） | ①②③⑤：路由判定与接替理由（写围栏在根平面无消费者）成文；`distro`/`distroCwd`/`restrictToDistro`/`sandbox`/`maskWindowsDrive`/`watchMaxDepth` 逐键成表，且自成一行、不与会话级行联动；拒另一发行版路径（`FS_OUTSIDE_DISTRO`）与 `sandbox` 失败关闭成文 | `fs-routing.test.mjs`（纯谓词与路径助手） | 类本体无单测（需 DSH peers 与实机）；纯函数测试未入 `test:unit`/`test:coverage` 清单（OI-7） |
| R24 | GUI 文件树与预览在发行版内服务：distro UNC scope 经常驻 agent 读写，盘符 scope 交父类，watch 流不改动 | README「Architecture」；ARCHITECTURE「The two root-plane takeovers」；CONFIGURATION `workspace-files-wsl` 行 | ①②③⑤：路由与替换安全性（对 Windows 目录会话仍走父类）成文；`maxBytes`/`maxFileBytes`/`maxLines`/`maxEntries` 逐键成表；not-found / 非普通文件 / 非文本 / 硬失败四档拒绝阶梯与截断旗标由单测钉死 | `workspace-files-wsl.test.mjs`（builder/parser 与 fake runner 上的 distro 操作） | — |

登记覆盖面：上表登记 README 与 docs/ 中对外成文的行为承诺（含随发的服务面）。
**有意未接线**的模块不设条目——`lib/file-reference-wsl.js`（`@` 补全的发行版侧
遍历）按 ARCHITECTURE 的说明 built but deliberately unwired，没有对外承诺可登记；
其单测仍留在 `test:unit` 与 `test:coverage` 清单内。

## 开放事项

登记时发现的、尚未构成需求条目的缺口。编号 OI-*，解决后在本表记归属。

| # | 事项 | 性质 | 出处 |
|---|---|---|---|
| OI-1 | 非功能无量化目标：冷启动上界、常驻 agent 内存上界、watch 通知延迟上界均无规定 | 决策待定（开发工具语境可辩护，企业语境缺口） | 本表 R20 残差 |
| OI-2 | 真机回归（协议/基座/沙箱的最高风险面）仅手动探针；CI runner 无 WSL distro | 环境受限决策，已如实记录 | ARCHITECTURE「Test layers」 |
| OI-3 | 默认翻转（substrate、协议 v3→v4）无灰度、无遥测；迁移安全押在 boot 拒绝与响亮错误上 | OSS 取舍，企业语境缺口 | CHANGELOG 0.3.0 / 0.7.3 |
| OI-4 | 端口轮询经共享 agent 使常驻进程永不闲置回收（LIMITATIONS 已记）；工程修复＝移出共享 agent 或改 one-shot | 工程项 | `lib/shell-env.js:79` |
| OI-5 | 写发布后无目录 fsync，机器崩溃可丢 rename（LIMITATIONS 已记）；修复＝rename 后对父目录 fsync | 工程项 | `agent/wsl-agent.sh:490` |
| OI-7 | `test/fs-routing.test.mjs` 只导入本仓模块，却不在 `test:unit` / `test:coverage` 清单内（与 CONTRIBUTING「Adding a test」的规则相抵），`lib/fs-routing.js` 因此只有 71.24/50.00/15.79 的覆盖；修复＝把它补进两个清单 | 卫生项 | `package.json` scripts；`test/fs-routing.test.mjs:8-10` |

OI-1 至 OI-3 属流程决策而非文档补课；OI-4/OI-5/OI-7 是可独立处置的工程项。
OI-6（工作区未提交三件套）已随 `6e6128a`（0.8.0）解决，自本表移除。
