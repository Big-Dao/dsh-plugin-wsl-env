# 架构

[English](ARCHITECTURE.md)

本文件描述插件当前的实际状态。它覆盖代码做了什么，以及每个部分位于何处。
设计背后的推理，包括被否决的设计，记录在
[`CHANGELOG.md`](../CHANGELOG.md) 和
[`archive/engineering-record.zh.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/archive/engineering-record.zh.md)
中。

## 这里的“provider”指什么

DSH 以服务的形式暴露自身能力。面向模型的工具（`bash`、`read`、`write`、
`edit`、`glob`、`grep`）消费这些服务，它们从不直接接触文件系统或 shell。

本插件为其中三项提供 WSL 后端实现，替换三个应用层行（`subprocess`、
`fs-sandbox`、`directory-picker`），并新增下文列出的较小集成。

## 三个服务提供者

| 服务 | 类 | 文件 | 作用 |
|---|---|---|---|
| `ctx.shell` | `WslShellExecutor` | [`lib/wsl-shell.js`](../lib/wsl-shell.js) | 在发行版的登录 shell 中运行每条命令，默认经由常驻的发行版内 agent，并包在发行版侧的 `bwrap` 沙箱里；agent 不在时，或设置 `agent: false` 时，同一条命令退回到一个 `wsl.exe -d <distro> --cd <linux dir> --exec <login shell> -lc <cmd>` 进程。 |
| `ctx.fs` | `WslFileSystem` | [`lib/wsl-filesystem.js`](../lib/wsl-filesystem.js) | 通过常驻的发行版内 agent 服务 WSL 路由的文件操作；此前的 Windows 侧 share 底座已退役（见下文）。 |
| `ctx.subprocess` | `WslSubprocessRuntime` | [`lib/subprocess.js`](../lib/subprocess.js) | 在发行版内、会话工作区中打开 GUI 终端，并把文件搜索与 git 快照的 spawn 改写到发行版内（见下文）。 |

`WslShellExecutor` 继承随包的 `LocalBashExecutor`，`WslFileSystem` 继承随包的
`LocalFileSystem`。只覆盖需要发行版的那部分。

## 根平面的文件系统接管

根级 `ctx.fs` 没有会话，因此无法由 agent preset 提供服务。该层用一个按坐标
路由的子类整体替换它的随包行：

| 服务 | 类 | 文件 | 作用 |
|---|---|---|---|
| `ctx.fs`（根平面） | `WslRoutingFileSystem` | [`lib/fs-routing.js`](../lib/fs-routing.js) | 根文件系统，按坐标路由：发行版 UNC 标识在发行版内服务（可用时用 inotify，否则轮询），盘符路径保持宿主原生。它接替随包的 `fs-sandbox` 行——该行的写围栏在根平面没有消费者，模型的写入走 preset 文件系统。设计见 [`root-fs-routing.md`](root-fs-routing.md)。 |

GUI 文件树与预览保留随包的 `workspace-files` 行。它的客户端半边是侧边栏预览
所需的浏览器 `file` 资源提供者，因此用仅服务端的子类替换该行会丢掉它；随包的
服务改为通过被路由的根文件系统读取 WSL 路径。代价是每次列表、`stat` 或分页
读取都多出几次 `ctx.fs` 往返（见 [LIMITATIONS.zh.md](LIMITATIONS.zh.md)）。

这次接管发生在组合层，理由与终端正好互为镜像（见下文）：没有会话标识能到达
根文件系统。它是一个顶层的 `disabled:` 条目，指向随包行，外加一个只含替代行的
`insert:` 列表——因为写在 insert 列表*内部*的 `disabled` 不是 patch，而是一行
重复 id 的数据行；而嵌套的 `insert:` 根本不会被解释。
[`cordis.patch.yml`](../cordis.patch.yml) 承载完整的行列表，`test/composition.test.mjs`
用真实的 patch 算法跑一遍该文件，以保持结构诚实。

还有一个模块随包构建，但有意不接线：
[`lib/file-reference-wsl.js`](../lib/file-reference-wsl.js)，即 `@` 补全的
发行版侧遍历策略。它已构建、已测试，但**未**接入 `cordis.patch.yml`——它消费的
接缝是一项上游提案
（[`upstream/rfc-wsl-workspaces.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/upstream/rfc-wsl-workspaces.md)），
而要在没有它的情况下抵达这些漏斗（funnel），就得用子类越过模块内部的函数。

## 较小的集成

| 子路径 | 类或名称 | 文件 | 作用 |
|---|---|---|---|
| `dsh-plugin-wsl-env/picker` | `WslDirectoryPicker` | [`lib/picker.js`](../lib/picker.js) | 文件夹选择器的两个世界：一个分类根，带 Windows 分支（从盘符开始）和 WSL 分支（每个已安装发行版一行）；发行版层级在发行版内部列出（用常驻 agent 的 `find`，它不在时用一次性 `wsl.exe`）。 |
| `dsh-plugin-wsl-env/auto-preset` | `auto-preset` | [`lib/auto-preset.js`](../lib/auto-preset.js) | 当新会话的工作区位于某个发行版内时，绑定 `wsl` agent preset。 |
| `dsh-plugin-wsl-env/shell-env` | `wsl-shell-env` | [`lib/shell-env.js`](../lib/shell-env.js) | 向受管的 `DSH_*` 命名空间贡献 `DSH_WSL_DISTRO`、`DSH_WSL_SHELL`、`DSH_WSL_HOME` 和 `DSH_WSL_PORTS`，并选取会话工作区所属的发行版（默认/钉死的事实于挂载时探测；其他发行版在其会话出现时预热）。端口列表是每个活跃发行版的快照，每 `portsRefreshMs`（默认 10000）刷新一次，因此刚启动的服务器可能尚未列出。 |
| `dsh-plugin-wsl-env/preflight` | `wsl-preflight` | [`lib/preflight.js`](../lib/preflight.js) | 在会话开始时运行环境提示——若 `startup: true`（默认值），还在插件加载时运行一次——把 doctor 风格的判定作为不阻断的警告呈现。 |
| `dsh-plugin-wsl-env/update-check` | `wsl-update-check` | [`lib/update-check.js`](../lib/update-check.js) | 大约每天一次向应用的插件管理器询问是否有更新的稳定版本，并把该事实带在 `DSH_WSL_PLUGIN_UPDATE` 中；自身从不抓取。 |
| `dsh-plugin-wsl-env/cwd-prompt` | `wsl-cwd-prompt` | [`lib/cwd-prompt.js`](../lib/cwd-prompt.js) | 把运行时上下文的工作目录条目改写为发行版的 POSIX 形式；新增一句 `wsl:shell` 说明；把 `sandbox:policy` 替换为仅 POSIX 的渲染；并在 WSL 会话中抑制宿主的 `harness:source` 值。后三项是临时适配器，跟踪于 [UPSTREAM-PROMPT-ADAPTERS.md](UPSTREAM-PROMPT-ADAPTERS.md)。 |
| `dsh-plugin-wsl-env/cwd-prompt-tool` | `wsl-cwd-prompt-tool` | [`lib/cwd-prompt-tool.js`](../lib/cwd-prompt-tool.js) | 以 harness 随包提供的相同语义提供模型的 read/`cd` 工具，把返回的 `cwd` 改写为发行版的 POSIX 形式。 |
| `dsh-plugin-wsl-env/wsl-doctor-tool` | `wsl-doctor-tool` | [`lib/wsl-doctor-tool.js`](../lib/wsl-doctor-tool.js) | `wsl_doctor` 模型工具：进程内的 doctor（合并活跃常驻 agent 的状态），按 `depth`/`section` 限定范围，渲染为逐项摘要。 |
| `dsh-plugin-wsl-env/wsl-doctor-command` | `wsl-doctor-command` | [`lib/wsl-doctor-command.js`](../lib/wsl-doctor-command.js) | `/wsl-doctor` UI 命令：把独立的 doctor CLI 作为宿主子进程启动，并在与模型历史分离的界面中渲染同一份摘要。 |
| `dsh-plugin-wsl-env/status` | `wsl-status` | [`lib/status.js`](../lib/status.js) | 侧边栏面板的路由（`GET /api/wsl-env/status`）：列出已安装的发行版，并对其中一个发行版运行 quick doctor；同一路由上的 `POST` 以 `--fix-owned` 运行完整 doctor（当陈旧的 scope 或损坏的 agent 缓存可修复时标为修复，否则为完整检查；两者都会重新验证）。响应经 Host 连接已认证的 exact-Fetch 通道返回；每个发行版的最近结果持久化在 `$DSH_HOME/cache/dsh-plugin-wsl-env/status.json`，运行中发行版的已存结果会在后台刷新。 |
| `dsh-plugin-wsl-env`（裸名） | `wsl-env-client-host` | [`lib/client-host.js`](../lib/client-host.js) | 有意为之的空操作宿主半边；它的裸名挂载让 web 客户端名册能够提供 `./client`：侧边栏的 WSL 环境面板，以及添加后的访问模式提示。 |

三个路径与 interop 助手不导入任何 DSH 包。
[`lib/paths.js`](../lib/paths.js) 负责路径转换。
[`lib/listing.js`](../lib/listing.js) 构建目录列表与面包屑。
[`lib/wsl.js`](../lib/wsl.js) 持有 `wsl.exe` interop 原语。

[`lib/provider-common.js`](../lib/provider-common.js) 是提供者间的粘合层，而不是
无 peer 依赖的助手：它导入 `@deepseek-ai/dsh-sandbox`，在 shell 与文件系统
提供者之间共享发行版解析、home 缓存、运行时选择和可写根转换。

## 各部件如何挂载

[`cordis.patch.yml`](../cordis.patch.yml) 是 bundle 层。它是 patch 条目的顶层
YAML 数组，`dsh plugin --profile <name> add dsh-plugin-wsl-env` 在 CLI 发行版上
把它作为一层应用；桌面应用通过侧边栏 **Plugins** 页面（**Add plugin**）应用
同一个 bundle，并记录到 profile 的 `dsh.profile.bundles` 中。

环境按会话而非按进程：

| 行 | 挂载位置 | 为什么在那里 |
|---|---|---|
| `wsl-shell`、`wsl-fs` | 位于 `preset-wsl` 内——一个带隔离域的 agent preset | 使一个进程可以同时服务 Windows 工作区和发行版工作区 |
| `subprocess-wsl` | 在应用层（即组合层）；随包的 `subprocess` 行被禁用 | 因为没有会话标识能到达终端控制器，见下文 |
| `workspace-files` | 随包、未替换 | 其客户端半边是侧边栏预览所需的浏览器 `file` 资源提供者；它通过被路由的根文件系统读取 WSL 路径 |
| `fs-routing` | 在应用层；随包的 `fs-sandbox` 行被禁用 | 根 `ctx.fs` 无会话，且其写围栏在根平面没有消费者 |
| `directory-picker-wsl`、`wsl-shell-env`、`auto-preset`、`wsl-preflight`、`wsl-update-check`、`wsl-cwd-prompt`、`wsl-cwd-prompt-tool`、`wsl-doctor-command`、`wsl-status`、`wsl-env-client-host` | 在应用层 | 它们回答的问题不限定于单个 preset；`shell-env` 按会话工作区解析其事实，而提示/诊断类行必须在会话从未打开时也能应答 |
| `wsl-doctor-tool` | 位于 `preset-wsl` 内（面向模型） | 工具面跟随 preset：在 Windows 文件夹上的会话保留随包工具 |

preset 挂载需要隔离域。缺少时，registry 以
`Preset services require isolate realms: shell, fs` 拒绝这些提供者。

### 终端提供者为何位于应用层

agent preset 在其隔离域中运行服务。preset registry 在自己的上下文下用
`createScope(this.owner, ...)` 创建该域。agent loop 则在根域下用
`createScope(loopCtx, ...)` 创建 Agent 上下文。

终端控制器用 `agent.ctx.get("subprocess")` 解析其执行世界，而该查找落在第二棵
树中。因此挂载在第一棵树里的提供者对它是不可见的。registry 为此缺口提供了
`agentPresets.serviceFor(agent, name)`，但终端控制器并未使用它。

于是该层禁用随包的 `subprocess` 行，并在应用层原位插入
`dsh-plugin-wsl-env/subprocess`。子类覆盖两个方法：`spawnTerminal` 把 `wsl.exe`
启动改写为 `wsl.exe -d <distro> --cd <linux dir>`；`spawn()` 把两类启动改写到
发行版内——文件搜索工具随包的 ripgrep 和 git 快照命令（两者都优先走已预热的
常驻 agent——协议 v6 承载 git 调用的 stdin，而一次性调用要付出约 230 ms 的
`wsl.exe` 启动开销，常驻 agent 只需约 2 ms——agent 不在时以一次性的
`wsl.exe --exec` 句柄为回退）。宿主没有 git 时，`resolveExecutable` 对 git
返回一个发行版哨兵路径，快照命令的发现调用（`rev-parse --show-toplevel ...`）
也随之路由，其绝对路径输出再转换回 UNC 形式——因此没有 Windows git 也能完成
完整的 WSL 变更审阅。两个 spawn 决策都是纯坐标函数（`lib/search-route.js`、
`lib/git-route.js`）；其余所有 `spawn()`——包括一次性回退自身的
`wsl.exe -lc <command>`（默认 agent 路径是通过常驻 agent 承载命令，而不是
spawn）——都原样到达随包实现，pwsh 执行器和 LSP 宿主同样如此。

终端的执行世界跟随会话（`hostSessions`，默认开启）：WSL 文件夹上的会话运行
发行版 shell，Windows 文件夹上的会话在其自身目录中运行 `powershell.exe`。
仍然跟随应用配置的是 shell 菜单的 DEFAULT 条目及其标题，两者都来自组合层
唯一的 `WSL` shell profile——所以新标签页无论运行什么，标题都显示 `WSL`，
包括宿主会话的 PowerShell。菜单还列出宿主候选（`powershell`、`cmd`；
`wsl.exe` 去重进默认项），手动选择的 shell 以自身命名。见
[LIMITATIONS.zh.md](LIMITATIONS.zh.md) 和
[UPSTREAM-TERMINAL-TITLE.md](UPSTREAM-TERMINAL-TITLE.md)。

## 路径坐标

代码中出现三种坐标系统：

| 系统 | 示例 | 使用者 |
|---|---|---|
| 发行版内的 Linux | `/home/you/proj/a.ts` | 命令、`ctx.shell` |
| 发行版的 UNC 共享 | `\\wsl.localhost\ubuntu\home\you\proj\a.ts` | harness 的路径标识（`ctx.fs` 目标键）、选择器与终端路由——这是坐标而非 I/O 路径：没有文件工具通过该共享读写 |
| Windows 文件系统 | `C:\Users\you\...`，或在发行版内写作 `/mnt/c/Users/you/...` | 在 Windows 文件夹上打开的会话 |

[`lib/paths.js`](../lib/paths.js) 在它们之间转换。它是纯的：不导入 DSH 包，
也不做 I/O。其包含关系助手判断目标路径是否位于某个可写根之下。文件系统围栏
使用它们。

## 文件系统 substrate

`wsl-fs` 在一个 I/O substrate 上服务 `ctx.fs`：常驻的发行版内 agent。此前的
Windows 侧 share 后端（`substrate: "share"`）已退役——带该值的 profile 在启动
时被拒绝，且没有文件工具跨 9p 共享。该 substrate 的事实如下：

- **读取、写入、标识**都经常驻 agent 在支撑发行版路径的文件系统上执行，
  发行版自有文件通常是 ext4。符号链接与权限位行为同样取决于该文件系统；
  标识使用发行版侧的 `realpath`，发布使用内核的 rename 或 link。
- **受守卫的写入**把意图带到发布环节：`createIfAbsent` 以不可替换的 link
  发布，从根上关掉创建时的“先检查后写入”窗口；覆盖、编辑、patch、删除或移动
  把期望版本带入操作，agent 在 rename 或移除之前重新校验（`moveFile` 校验
  两端）。不匹配返回 `FS_STALE_VERSION`，但该检查之后发生的变更仍可能被覆盖。
- **内核强制**是第二阶段：变更运行在受约束的常驻 agent 上——每个（发行版、
  策略）组合一个长生命周期 agent，其 bwrap profile 恰好绑定该模式授予的内容
  ——因此内核会拒绝检查本应拒绝的操作，检查代码的 bug 不会变成工作区之外的
  写入。升级后的写入（`danger-full-access`）走普通常驻 agent。内核拒绝携带
  `FS_SANDBOX_DENIED`，与命令路径同一方言。
- **新文件**以 0600 发布——与 Linux 宿主上一样，这是宿主后端自身的 POSIX
  发布语义。
- **agent 中断**时失败关闭：报 `FS_IO_ERROR`，指明 substrate 与恢复路径。
  没有回退 I/O；没有可用 bwrap 的发行版会以 bootstrap 命令拒绝受限变更，
  与命令路径相同的关闭式失败。

写入用命令路径沙箱所描述的同一套宿主侧策略做围栏——
`WslFileSystem.checkedTarget`，基于同一份可写列表；命令路径本身由发行版侧
profile 约束，从不调用它——而 substrate 不改变 `sandboxMode` 上报的内容。
substrate 使用的线协议记录在 [`agent/wsl-agent.sh`](../agent/wsl-agent.sh)；
编排层是 [`lib/fsio-agent.js`](../lib/fsio-agent.js)（fsio 在 FS 帧之上的
机制）、[`lib/fs-substrate.js`](../lib/fs-substrate.js)（提供者形态的操作，
包含写入/编辑守卫的编排），以及 [`lib/fsio-text.js`](../lib/fsio-text.js)
（纯文本机制，在上游导出落地前从上游复制，导出提案见
[UPSTREAM-FSIO-EXPORT.md](UPSTREAM-FSIO-EXPORT.md)）。

## 沙箱

### 为什么不能用 Windows runner

在 Windows 上，DSH 用 `dsh-sandbox-windows-acl` 约束命令。它使用受限的
低完整性 Windows 令牌和写入允许列表。

该令牌无法触达 WSL。`wsl.exe` 以 `Wsl/E_ACCESSDENIED` 失败，
`\\wsl.localhost\<distro>` 报告访问被拒绝。两者在沙箱之外都正常工作。

### 插件改用另一种做法

插件在 Windows 侧构建 `bubblewrap` profile，把得到的 argv 交给发行版——默认
经由常驻 agent，或在一次性回退中交给 `wsl.exe --exec`。约束在发行版内创建，
两条路径的 argv 相同：

```text
wsl.exe -d <distro> --cd <linux dir> --exec bwrap \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp --bind <workspace> <workspace> [--bind <root> <root> ...]]  [--tmpfs /mnt]  --  <shell> -lc <cmd>
```

默认情况下，该 profile 只在 `systemd-run --user --scope` 下包裹会话的常驻
agent 一次，命令 argv 就是 shell 行本身：
`bwrap … --die-with-parent --bind /tmp /tmp --bind <workspace> <workspace> -- sh agent.sh`。
这里没有 `--unshare-pid`，也没有按命令的 tmpfs，因此后台进程得以存活，`/tmp`
是发行版真实的 `/tmp`，`ps` 能看到该会话。上面那种按命令的 argv 仍是
`sessionSandbox: false`（以及一次性回退）所运行的。

这些参数与 DSH 的 Linux runner（`dsh-sandbox-local`）所用的一致，因此行为和
错误消息与 Linux 宿主相同。构建它们的是 [`lib/bwrap.js`](../lib/bwrap.js)
中的函数 `bwrapProfileArgs`——每个约束点都组合使用的无 peer 依赖构建器。
末尾的 `[--tmpfs /mnt]` 是 `maskWindowsDrive` 选项：开启时，Windows 盘在每个
受限 profile 中都被一个空 tmpfs 遮蔽，其文件无法被读取或外泄，其可执行文件
也无法通过 interop 启动。该选项默认关闭；
[CONFIGURATION.zh.md](CONFIGURATION.zh.md) 列出了该行的键，
`lib/sandbox-core.js` 说明其真实上限。

可选的 `--bind <root> <root>` 对来自该行的 `writableRoots` 和共享策略的
`additionalWritableRoots`。`lib/writable-roots.js` 负责解析它们（`~` 展开、
UNC/Linux 写法），丢弃已在工作区、`/tmp` 或 `/dev/shm` 下可写的条目，以及
嵌套在另一条授权内的条目，然后每个进程检查一次，确认剩余每个根都是已存在的
物理目录。同一份有效列表会进入命令 profile、受限写入常驻 agent 和会话运行时
——也进入它们的缓存键，因为挂载表在 agent 生命周期内固定。

| 模式 | 发行版内的命令能做什么 |
|---|---|
| `read-only` | 读整个发行版；新的 `/dev` 以可写挂载，因此 `/dev/null` 与 `/dev/shm` 可用，其余不行 |
| `workspace-write` | 上述之外，会话工作区和任何显式授予的根可写；会话运行时中的 `/tmp` 是发行版真实的 `/tmp`，按命令 profile（`sessionSandbox: false`）中是新的 tmpfs |
| `danger-full-access` | 无沙箱；用于获批的更宽权限请求 |

`WslFileSystem` 用同一策略和同一可写列表检查写入，但有一处有意的转换：对
发行版内的会话，临时根是发行版自己的 `/tmp`，Windows 临时目录*不*授予，因为
它位于策略所描述的执行世界之外。这避免了 `bash` 能写 `/tmp` 而写入工具不能
的不一致。在按命令 profile（`sessionSandbox: false`）中，两个 `/tmp` 是不同
的目录——命令侧是新的 tmpfs；随包的会话运行时共享发行版真实的 `/tmp`——见
[LIMITATIONS.zh.md](LIMITATIONS.zh.md)。提供者的变更面是 `writeText`、
`editText`、`patchText`、`deleteFile` 和 `moveFile`；每一项都经
`checkedTarget`，因此围栏覆盖该提供者能服务的每个变更。两个提供者都通过
`sandboxMode` 上报模式。工具层和 Permissions 选择器读取该值。

### 上报的强制程度

`WslSandbox` 上报 `enforcement: partial`，而不是 `full`。发行版内的进程仍可
通过 WSL interop 运行 Windows 程序，例如 `/mnt/c/.../*.exe`。Bubblewrap 并不
管束该进程。

`maskWindowsDrive`，或 `interopVisibility` 的 `masked` 与 `disabled` 立场，会在
受限命令中遮蔽 `/mnt`，这是收窄而非关闭。其他挂载和不受约束的文件读取不在
遮罩覆盖范围内，而 `binfmt` interop 按文件*内容*分派，所以能写工作区的命令
仍可在那里写入 PE 并让它作为 Windows 进程启动。无论哪种方式，提供者都上报
`partial`。禁用 WSL interop 需要发行版层面的另一项改动（`wsl.conf` 中的
`[interop] enabled=false`）；`disabled` 立场不会做这项改动。遮罩在结果的
sandbox fact 上报为 `windowsDrive: "masked"`（或 `"visible"`），但那是本插件
自己的额外字段：被钉死的 harness 版本中，sandbox 类型及其面向模型的注记只
携带 `mode`、`denied`、`enforcement` 和 `runnerFailed`，因此该字段到达结果与
测试，不到模型。

`pnpm run probe:sandbox` 在你的机器上演示该边界，并以 `INFO` 记录。

### 失败模式

两个提供者都失败关闭。发行版内没有可用的 `bwrap` 时，`WslSandbox` 抛出
`SandboxUnavailableError`，每条受限命令都上报 `SANDBOX_UNAVAILABLE`。不会有
任何东西在无约束状态下静默运行。字符串 `read-only file system` 被归为拒绝，
因此工具层能提供放宽权限的路径。

失败的探测**不会**被记住：只有成功才会在进程生命周期内缓存，因此应用运行期间
安装的 `bubblewrap` 在下一条命令就被认可。见
[`lib/probe-cache.js`](../lib/probe-cache.js)。

因发行版本身缺失、已停止或未注册而从未启动的命令，单独上报：
`wsl.exe` 把 `WSL_E_*` 码写在 stdout 上，stderr 为空，`WslShellExecutor`
把它转成点名发行版与补救方法的错误，而不是一个裸的非零退出。它有意不是沙箱
错误码，因为更宽的权限不能创建发行版。

在任一提供者上设置 `sandbox: false` 即可退出。命令随后不受约束地运行，
`sandboxMode` 返回 `undefined`。

## 错误码

插件抛出带错误码的 `FsError`，由工具层映射；`wsl.exe` 自身的失败也有命名。
插件自身抛出的每个 `FsError` 错误码都在下面——模型看到错误码，追问“是什么
拒绝了我”的读者在这里找到答案。盘符路径背后由随包宿主栈抛出的错误码原样
穿过 `lib/fs-routing.js`，属于 peer 而非本表；GUI 文件服务是随包的
`workspace-files` 行，其线协议拒绝使用 peer 自己的方言，在表后说明。

| 错误码 | 抛出方 | 含义 | 如何解除 |
|---|---|---|---|
| `SANDBOX_UNAVAILABLE` | `WslSandbox.confine` | 所请求的模式无法强制：发行版内没有可用的 `bwrap` | 在发行版内安装 `bubblewrap`（失败的探测会重跑，无需重启），或设置 `sandbox: false` |
| `SANDBOX_INVALID_ROOT` | `effectiveWritableRoots`（两个提供者） | `writableRoots` 或 `additionalWritableRoots` 中的条目格式错误、指向另一个世界，或未通过一次性物理目录检查 | 修正该条目；先在发行版内创建目录，使用绝对 Linux 路径或 `~/...`，并使用物理目录而非符号链接 |
| `FS_SANDBOX_DENIED` | `WslFileSystem.checkedTarget`，以及 `lib/fsio-agent.js`（受限常驻 agent 的挂载表拒绝的写入，按内核的 `read-only file system` 归类） | 文件效果策略拒绝了写入：`read-only`，或目标位于可写根之外——或内核在常驻 agent 的 profile 处拒绝了它 | 为那一次调用放宽权限，或让会话工作区包含该目标 |
| `FS_OUTSIDE_DISTRO` | `WslFileSystem.worldPath` | `distro` 被固定（`default` 或某名称），`restrictToDistro` 开启，而该路径指向**另一个发行版**的共享——这是配置围栏，不是沙箱决策。`distro: ''`/`auto` 时，UNC 目标由它自己的发行版服务，围栏没有外来目标可拒 | 把 `distro` 设为 `''`/`auto`（默认），或在该发行版中打开会话。更宽的权限**不能**解除它 |
| `FS_NOT_OBSERVED` | `lib/fs-substrate.js`（`writeText`；agent 的 `exists` 结论，在 `lib/fsio-agent.js` 中映射） | 受守卫的创建（`createIfAbsent`）指向一个已存在且此前未被读取的文件 | 先读取该文件，然后用版本守卫覆盖或编辑它 |
| `FS_STALE_VERSION` | `lib/fs-substrate.js`（`writeText`、`editText`；agent 的 `stale` 结论，在 `lib/fsio-agent.js` 中映射） | 调用方持有的版本不再匹配：文件已变更或已消失 | 重新读取，并以新版本重试 |
| `FS_IO_ERROR` | 文件系统栈：`lib/fs-decisions.js`（substrate 不可用）、`lib/fsio-agent.js`（`perm`/`loop`/`io` 原因或畸形记录）、`lib/wsl-filesystem.js`（无法映射的路径，或 `SandboxUnavailableError`），以及 `WslFileSystem.watch` | 兜底的 I/O 失败——最常见的是常驻 agent 不在，或发行版返回 I/O 错误，即上文的「agent 中断时失败关闭」情形。监视目标落在所选发行版之外则属于较窄的情形 | 恢复常驻 agent（检查 `wsl.exe -l -v`，然后重启会话）；对于监视，把目标指向发行版路径——监视本身运行在文件所在处（`lib/watcher.js`） |
| `FS_NOT_FOUND` | `lib/fsio-agent.js` 与 `lib/fs-substrate.js`（agent 的 `notfound`/`notdir` 结论、空路径，或缺失的编辑目标），以及盘符路径背后的宿主文件系统栈 | 路径不存在——普通的回答 | — |
| `FS_NOT_REGULAR_FILE` | `lib/fsio-agent.js`、`lib/fs-substrate.js` | 目标在要求普通文件处不是普通文件：读取时的目录、符号链接或设备，或写入时的非文件目标 | 把调用指向普通文件 |
| `FS_NOT_DIRECTORY` | `lib/fsio-agent.js`（`listChildren`） | 目标不是目录，因此没有子项可列 | 改为列出目录 |
| `FS_NOT_TEXT` | `lib/fsio-agent.js`、`lib/fsio-text.js` | 内容不是 UTF-8 文本：NUL 样本（二进制）或解码失败 | 不是策略拒绝——请读取文本，或对二进制内容使用命令 |
| `FS_TOO_LARGE` | `lib/fsio-agent.js` | 内容超出调用方操作携带的字节上限 | 改为读取字节范围（`WslFileSystem.readByteRange`），而不是整个文件；或提高上限 |
| `FS_ABORTED` | `lib/fsio-agent.js`、`lib/fsio-text.js` | 调用方的 signal 在操作之前或期间被中止 | 不是拒绝——调用方取消了；重新调用即可清除 |
| `FS_EDIT_NOT_FOUND` | `lib/fsio-text.js`（`applyLiteralEdit`） | `old_string` 为空，或在文件中没有匹配 | 给出文件中确实存在的 `old_string` |
| `FS_AMBIGUOUS_EDIT` | `lib/fsio-text.js`（`applyLiteralEdit`） | `old_string` 匹配多次且未设置 `replace_all` | 让 `old_string` 唯一，或设置 `replace_all` |
| `FS_PATCH_MISMATCH` | `lib/fs-substrate.js`（`patchText`；agent 的记录方言，`docs/AGENT-PROTOCOL-V7.md`） | hunk 的 `oldLines` 在 hunk 指定的行处不再匹配文件——文本在调用方读取与 patch 之间漂移了 | 重新读取文件，并基于新文本重建 hunk |
| `FS_SAME_TARGET` | `lib/fs-substrate.js`（`moveFile`） | `moveFile` 的源和目标解析到同一个文件 | 给出两个不同的路径，或放弃该调用 |

GUI 文件服务保留随包的 `workspace-files` 行，因此其线协议拒绝是 peer 的
`workspace-file/*` 方言（外加畸形分页请求的 `gateway/bad-request`），而不是
本插件的 `FsError` 错误码。插件提供被路由的 `ctx.fs`；agent 中断以
`FS_IO_ERROR` 到达该服务，由 peer 映射。

另有两类失败来自 `wsl.exe` 本身，而不是我们的错误码，它们过去都不可见：

| 失败 | 如何到达 | 插件如何处理 |
|---|---|---|
| 发行版缺失、已停止或未注册 | **stdout** 上的 `Wsl/Service/WSL_E_*` 码，某些构建为 UTF-16，stderr 为空，退出码 255 | `WslShellExecutor` 剥掉 NUL 后读取该码，并以发行版名称和补救方法失败。有意不作为沙箱错误码：更宽的权限不能创建发行版 |
| 无法进入工作目录 | stderr 上的一行中继信息，退出码 **0**，命令实际在 `/` 中运行 | `WslShellExecutor` 以该目录和回退方案失败，而不是报告一次作用在错误目录树上的成功 |


模型在文件系统拒绝时实际看到的是工具层前置的两行：
`[sandbox: file access denied under <mode> mode]`，然后是
`[sandbox: escalation available — retry this exact operation once with
sandbox_permissions (the narrowest wider mode that suffices) + justification; the
approval prompt asks the user]`。不是 `FS_SANDBOX_DENIED` 的错误码则两行都
不会出现——这正是 `FS_OUTSIDE_DISTRO` 拥有独立错误码的原因。

## 运行时镜像

检出目录位于发行版内。DSH profile 只能链接 Windows 路径，而 pnpm 会把
`link:\\wsl.localhost\...` 改写成断链的 `/wsl.localhost/...` 符号链接。因此
harness 无法从发行版内的检出目录加载插件。

`default-workspace/dsh-plugin-wsl` 处的 Windows 副本是运行时镜像。
[`test/probe/sync-to-windows.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/sync-to-windows.sh)
让它与检出目录保持一致，`pnpm run sync:windows` 运行该脚本。

## 测试分层

| 分层 | 位置 | 需要 harness |
|---|---|---|
| 风格与打包检查 | [`test/style.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/style.mjs) | 否 |
| 语法检查 | [`test/syntax.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/syntax.mjs) | 否 |
| 构建一致性 | [`test/build-freshness.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/build-freshness.mjs) | 否；它会重跑真实构建并逐字节比较已提交的 `lib/`，因此也能发现那里的孤立文件 |
| 类型检查 | 对 `test/**` 和 `types/*.d.ts` 运行 `tsc --noEmit`（`src/` 由构建本身检查） | 否 |
| 单元测试 | `test/*.test.mjs` | 否 |
| 需求矩阵 | [`scripts/check-requirements.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/scripts/check-requirements.mjs) | 否；每个被引用的测试都必须存在并保持接线 |
| 文档一致性 | [`scripts/check-doc-consistency.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/scripts/check-doc-consistency.mjs) | 否；覆盖重复事实、doctor 面与双语对完整性 |
| 沙箱探针 | [`test/probe/sandbox.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/sandbox.sh) | 否；它直接应用 profile 参数 |
| Harness 探针 | [`test/probe/run.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/run.sh)、`terminal.sh`、`sandbox-shell.sh`、`interop-shell.sh`、`picker.sh`、`fs-routing.sh`、`missing-wsl.sh`、`sandbox-off.sh`、`native-session.sh` | 是：Windows、WSL2、已挂载的 profile 和链接的检出目录 |
| 发行版探针 | [`test/probe/substrate.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/substrate.sh)、`watch.sh`、`agent.sh`、`exec.sh`、`session-sandbox.sh`、`gui-preview.sh`、`file-reference-9p.sh` | 需要 Windows 和 WSL2，但不需要启动 harness，也不需要 profile：它们在装有 Node 的发行版终端中运行，经 interop 触达 `wsl.exe` |
| 宿主探针 | [`test/probe/mode.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/mode.sh) | Windows Node，无 harness |
| 探针插件 | `test/probe/` 中的 `*-probe.mjs` 与 `*-probe.yml` 文件（以及诸如 `gui-preview.mjs`、`native-session.mjs`、`fs-probe.mjs`、`fs-queue.mjs` 之类的独立测量器） | 由上述脚本加载或调用 |

`pnpm test` 按顺序运行 `lint:style`、`lint:links`、`lint:requirements`、
`lint:docs`、`test:syntax`、`lint:build`、`lint:types` 和 `test:unit`。
[`test/probe/run-all-when-closed.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/run-all-when-closed.sh)
等待应用退出，然后完整运行一次真机套件——`--include-fs` 会把 `run.sh`
放在最前面。

单元测试分两类：多数只导入 Node 内建模块，而
[`test/composition.test.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/composition.test.mjs)、
[`test/fs.boot.test.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/fs.boot.test.mjs)、
[`test/fsio-agent.test.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/fsio-agent.test.mjs) 和
[`test/provider.test.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/provider.test.mjs)
导入钉死的 `@deepseek-ai/*` 开发依赖（组合与启动测试运行加载器真实的 patch
算法）。首次运行前执行一次 `pnpm install` 即可重建该依赖树；运行时包本身仍
零依赖。CI 在 Linux 和 Windows、Node 22 和 24 上运行 `pnpm test`，只在
Node 24 上运行 `pnpm run test:coverage`——阈值标志需要 Node 22.8。Node 20
是有意缺席的：`engines` 要求 `^22.19.0 || >=24.0.0`，即 harness 宿主自身的
下限。harness 探针是手动步骤，因为托管 runner 没有 WSL 发行版，也没有可挂载
的 profile。

探针脚本共用
[`test/probe/env.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/env.sh)，
它从机器推导 Windows 用户、发行版名称和检出目录的 UNC 写法；Node 侧探针则共用
[`test/probe/env.mjs`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/env.mjs)。
没有探针携带用户名，YAML overlay 是带 `@NAME@` 占位符的模板，由脚本替换进
生成的副本。

## 文件布局

`lib/` 是生成产物：每个模块的源码是 `src/<name>.ts`，`pnpm run build` 产出
`lib/<name>.js` 及其 `lib/<name>.d.ts`。绝不要手改 `lib/`——已提交字节与真实
构建漂移时 `lint:build` 失败，任一方向的孤立文件同样使它失败。

```text
src/<name>.ts         the sources — edit THESE; each builds to lib/<name>.{js,d.ts}
agent/wsl-agent.sh    the resident in-distro agent (POSIX sh, coreutils only)
cordis.patch.yml      the bundle configuration layer (dsh.bundle), commented
examples/             one machine-local profile layer, for comparison
locale/               the Plugins-page display metadata (title/description)
scripts/              the build (build.mjs), the release helpers
                      (check-release-tag.mjs, changelog-section.mjs), and the
                      distro-side bootstrap installer (bootstrap.sh)
test/                 unit tests, the style/build/type gates, and the probes
docs/                 this file, the configuration and limitation references,
                      the release checklist, and the archived designs
```

模块按字母顺序排列：

```text
src/agent-confined.ts        the confined residents' factory (one per policy)
src/agent-errors.ts          the error a resident outage rejects with
src/agent-exec.ts            the agent-backed shell execution handle
src/agent-protocol.ts        the wire protocol codecs (pure)
src/agent-shared.ts          the per-distro resident shared by every provider
src/agent.ts                 the resident in-distro agent's host side
src/auto-preset.ts           per-session environment selection
src/bwrap.ts                 the bwrap command line every confinement site
                             assembles (no imports, so a bare checkout can
                             assert it)
src/client-host.ts           the bare-name host half — a deliberate no-op that
                             anchors the browser client
src/cwd-prompt.ts            rewrites the working directory; applies the temporary prompt adapters
                             to the distro's POSIX form
src/cwd-prompt-tool.ts       serves the model's read/cd tool with distro-POSIX
                             cwd output
src/distro-route.ts          the pure distro-mode selector (pinned / workspace /
                             default) shared by shell, fs, preflight and env
src/doctor-live.ts           merges the live resident's status into a collected
                             doctor report
src/file-reference-wsl.ts    the distro-side `@`-completion traversal — built,
                             tested, not yet wired (see above)
src/fs.ts                    the ctx.fs subpath entry point
src/fs-decisions.ts          the filesystem provider's policy decisions (pure,
                             unit-testable in a bare checkout)
src/fs-routing.ts            WslRoutingFileSystem, the root-plane ctx.fs
src/fs-substrate.ts          the agent substrate's provider-shaped operations
src/fsio-agent.ts            fsio's mechanics over the agent's FS frames
src/fsio-text.ts             the peer's pure text mechanics, replicated pending
                             the upstream fsio export (UPSTREAM-FSIO-EXPORT.md)
src/git-exec.ts              the agent-backed execution handle for the
                             git-snapshot spawn
src/git-route.ts             which git spawns belong inside the distro (pure)
src/index.ts                 public provider exports
src/wsl-shell.ts             WslShellExecutor (ctx.shell)
src/wsl-filesystem.ts        WslFileSystem (ctx.fs)
src/doctor-report.ts         in-process doctor collector used by the tool
src/provider-common.ts       distro, home, runtime and writable-root helpers
src/listing.ts               pure directory listing and breadcrumb helpers
src/messages.ts              the en/zh message catalogs and the host-locale wiring
src/native-agent.ts          native binary selection and preparation
src/paths.ts                 pure conversion between the three path formats
src/picker.ts                WslDirectoryPicker (ctx.directoryPicker)
src/ports.ts                 the listening-port snapshot behind DSH_WSL_PORTS
src/preflight.ts             session-start environment advisories
src/preset-choice.ts         whether a new session adopts the WSL preset (pure)
src/probe-cache.ts           which probe verdicts may be remembered (pure)
src/sandbox.ts               the distro-side bwrap confinement shared by both
                             providers, bound to the peer's failure type
src/sandbox-core.ts          the probe-and-confinement core, free of DSH peers
src/search-exec.ts           the agent-backed execution handle for a search
src/search-route.ts          which execution world a search spawn belongs to (pure)
src/session-runtime.ts       shared session runtime and agent lifecycle
src/session-scope.ts         systemd scope creation and cleanup
src/shell.ts                 the ctx.shell subpath entry point
src/shell-env.ts             registers the DSH_WSL_* environment variables
src/subprocess.ts            WslSubprocessRuntime (ctx.subprocess), the GUI
                             terminal window
src/terminal-activity.ts     the distro-side activity probe for idle terminal
                             reclamation
src/terminal-route.ts        which execution world a terminal launch belongs to (pure)
src/update-check.ts          the once-a-day update notice (fact store +
                             host-delegated check)
src/watcher.ts               in-distro file watching for WslFileSystem.watch
src/status.ts                the panel's route (distro list, one distro's
                             quick doctor, and the --fix-owned repair over /api)
src/wsl-doctor-command.ts    the `/wsl-doctor` UI command row (spawns the
                             standalone doctor CLI)
src/wsl-doctor-tool.ts       the `wsl_doctor` model tool row (in-process diagnosis)
src/wsl.ts                   wsl.exe interop primitives (no DSH imports)
```

`package.json` 只发布这棵树的一个子集：`files` 列表就是契约，条目不再匹配
受跟踪内容时 `pnpm run lint:style` 失败。

## 推理记录在哪里

- [`CHANGELOG.md`](../CHANGELOG.md) 记录每次发布的变化，也点名读者本来会照做
  但已不再成立的文档。
- [`REQUIREMENTS.zh.md`](REQUIREMENTS.zh.md) 是需求登记册：每条成文的行为
  承诺都有编号，并注明规定位置与验证方式，另列未完成项（中文，面向维护者，
  随 npm 包发布）。
- [`archive/engineering-record.zh.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/archive/engineering-record.zh.md)
  是完整的工程记录，中文：实测契约、调试回合，以及当时得出的结论。
- [`archive/README.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/archive/README.md) 和
  [`archive/README.en.md`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/docs/archive/README.en.md)
  是同样三份归档文件的两份英文索引；后者让不读中文的读者也能知道其中有什么；
  记录本身是中文。
- [`docs/README.zh.md`](README.zh.md) 与 [`README.md`](../README.md) 是当前状态的
  陈述。

## 诊断

`pnpm run doctor`（以及 `pnpm run diagnose`）是覆盖上述全部内容的运维入口：
它探测 Windows/WSL 版本、发行版及其 shell、bubblewrap、systemd/Linger、
peer 下限、新 agent 握手和陈旧的会话 scope，并报告带版本的 `doctorReport`
结构（`scripts/doctor.mjs`、`lib/doctor-live.js`），每项失败附带补救方法。
同一份报告通过三个界面应答：这个独立 CLI（设计上无 peer 依赖，因此插件自身
运行时损坏时它仍能启动）、`/wsl-doctor` UI 命令（在宿主侧启动 CLI，渲染与
模型历史分离），以及 `wsl_doctor` 模型工具（进程内，通过 `lib/doctor-live.js`
合并活跃常驻 agent 的状态）。侧边栏面板以同样方式渲染快速摘要并提交修复动作
（`--fix-owned`：仅插件自有状态）。运行可以限定范围（CLI 上的 `--quick`、
`--sections <csv>`；工具上的 `depth` / `section`），报告按发行版分组逐项列出
每项检查。各界面与判定契约见 [DIAGNOSTICS.zh.md](DIAGNOSTICS.zh.md)。
