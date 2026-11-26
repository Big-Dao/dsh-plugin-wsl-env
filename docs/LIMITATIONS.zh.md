# 限制与不承诺

[English](LIMITATIONS.md)

插件不做什么，以及为什么。写进文档的限制是设计边界；
没写进文档的迟早会变成 bug 报告。每一条都说明限制本身和补救方法；
推理过程在 [ARCHITECTURE.md](ARCHITECTURE.md) 及其链接的文档中。

## 文件系统 substrate（`wsl-fs`）

只有一个 substrate：发行版内的常驻 agent（发行版文件用 ext4）。已退役的
Windows 侧 share 后端（`substrate: "share"`）在启动时被拒绝；WSL 路由的
操作永远不会走 9p 共享。

- **新建文件以 0600 权限发布。** 覆盖与编辑保留原有权限位；
  新文件需要可执行时请 `chmod`。
- **agent 不在时，文件操作关闭（fail closed）** —— 报 `FS_IO_ERROR`，指明
  substrate，并附带恢复路径。一次崩溃可用一次重建；重建耗尽后进入有界复活
  （2/4/8 s），共三次尝试；第 4 次死亡才永久退出，直到应用重启。没有回退
  I/O——这是有意为之。
- **native agent 的降级只凭证据，并且会自动重试** —— 每个 distro 只有一个共享
  agent 实例，死亡后由它自己的重建与复活预算恢复，不会被换成一个新实例。
  只有当一次启动里失败的是 native 入口、而随后的 shell 入口在同一发行版上
  启动成功时，读操作才改走 shell agent，5 分钟后再试 native。发行版本身宕机
  时两种入口一样失败，不算在 native 头上；准备失败（复制、校验、执行检查）
  也不会被当成结论缓存，下一次启动会重新准备。
- **变更守卫不是原子的比较并交换。** 创建使用不可替换的 link；覆盖在 rename 前
  会重新校验版本。不匹配时返回 `FS_STALE_VERSION`，但检查与 rename 之间发生的
  变更仍可能被覆盖。
- **被取消的写入结果可能是未知的** —— 重试前先检查文件。
- **写入的崩溃持久性取决于平台的 `sync -d`。** 被暂存的文件会 sync，
  rename 之后所在目录也会尽力 fsync（shell agent）。native agent 目前只有
  文件级 `sync_all` —— 见 peer 对齐文档的分歧注记。拒绝目录 fsync 的
  文件系统保持与对端相同的承诺。
- **shell agent 的工具下限是 GNU 套件。** 它需要 coreutils、GNU `find`
  （`-printf`）、`realpath` 与 `od`；最小化 BusyBox 镜像（未装 `findutils`
  的 Alpine）会在 FSB stat/list 上失败并报 `find: unrecognized: -printf`。
  `auto` 优先使用的打包 native agent 不需要这些工具——只有在钉死
  `agentBackend: shell` 时才需要安装 `findutils`。

- **含反斜杠的 Linux 文件名无法被寻址** —— 反斜杠是 UNC 分隔符，
  `a\b.ts` 会往返成 `a/b.ts`。请把文件名改掉，不要用反斜杠；
  这是坐标系自身的限制。
- **受限写入运行在各自的 bwrap 约束常驻 agent 上** —— 由内核强制，
  工作区之外以 `FS_SANDBOX_DENIED` 拒绝。代价：需要 `bubblewrap`；
  策略变更要付出一次 agent 启动；授予 `/tmp` 的写入落在发行版真实的
  `/tmp` 中。
- **`glob`/`grep` 使用发行版的 rg**；没有 rg 的发行版搜索失败，
  以退出码 127 报出程序名与下面的安装指引——不会静默回退，也不是不可读的
  provider 错误；工作目录缺失同样显式失败（rg 的错误码 2，`1` 只表示"无
  匹配"）。命令与常驻 agent 都继承 `wsl.exe` 的默认 PATH，因此
  `~/.local/bin` 下的用户级安装不可见——请装成系统级，或放在那个 PATH 上。
  安装：`wsl.exe -d <distro> -u root -- sh -c "apt-get update -qq && apt-get install -y --no-install-recommends bubblewrap git ripgrep inotify-tools"`
  （或检测到的包管理族对应的写法）。`--install` 只在
  缺少 `bubblewrap` 时才执行安装。
- **`watch()` 是粗粒度失效，不是逐文件通知**：inotify 事件合并到 0.5 s，
  否则使用 `find -newer` 轮询循环。轮询路径会遗漏原地的 `cp -p`，以及恢复
  较旧 mtime 的 `tar -x`；FILE 目标监视的是 `mtime:size` 指纹。从 Windows
  侧做 9p 监视仍然不支持。
- **`sessionSandbox: false` 时，受限命令的 `/tmp` 与写入工具的 `/tmp`
  不同** —— 请通过会话工作区交接文件。随包 preset（`sessionSandbox: true`）
  共享同一个真实 `/tmp`，不存在这种分裂。
- `editText` 在写回之前把整个文件读进内存。
- 发行版在请求进行中死亡，会耗尽常驻 agent 的唯一一次重建；
  仍未恢复时，常驻 agent 将保持不可用，直到应用重启。

## GUI 的 workspace-files 服务

- GUI 文件树和预览使用随包的 `workspace-files` 行，通过被路由的根文件系统
  读取 WSL 路径——这是有意不替换的（服务端单方面接管会丢掉侧边栏预览
  所依赖的浏览器 `file` 资源提供者）。
- **预期多出几轮往返**（每次 listDir/stat/分页约 4-6 次；实测 p95：
  `stat` 2.7 ms、`listDir` 5.1 ms、1 MiB 读取 63.5 ms/MiB —— 2026-10-19，
  [探针](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/gui-preview.sh)）。
  模型自己的文件操作不受影响。
- `fs-routing` 是接缝：禁用它即可恢复宿主 9p 支撑的根文件系统。
  随包行的上限可以在 `workspace-files` 行上覆盖。

## `@` 补全

- **`@` 引用走 9p 共享**（在已探针的目录树上比 ext4 慢约 56 倍，
  2026-10-19）。发行版侧的遍历已经写好，但尚未挂载——它需要上游的
  `FileReferenceTraversal` 接缝：
  [UPSTREAM-FILE-REFERENCE-SEAM.md](UPSTREAM-FILE-REFERENCE-SEAM.md)。

## 内置 skill

`preset-wsl` 与应用自带的标准模式保持同一份行集，其中 `skill-filesystem`
的 `customSkillDirs` 照搬上游，指向应用安装目录里 agent preset 包自带的
`skills` 目录。该目录在宿主上，而本 preset 的文件系统是发行版的：

- **内置 skill 经发行版的 `/mnt/<盘符>/…` 读取**：`wsl-fs` 把宿主盘符路径
  映射到发行版的挂载点，再由常驻 agent 读取（2026-11-24 实测：未打包的
  宿主目录 `resolve` 与 `listDir` 正常）。发行版把盘符挂在别处
  （`/etc/wsl.conf` 的 `automount.root`）时读不到。
- **Desktop 安装包的 WSL 会话里没有内置 skill**：应用的 `node_modules` 打在
  `app.asar` 归档内，`/mnt/c/…/app.asar/…` 在发行版内不是目录，`wsl-fs`
  以 `FS_NOT_DIRECTORY` 拒绝（2026-11-24 实测）；skill 提供方把这类根按
  「不存在」跳过，所以内置的 `dsh-doc` 不会出现在工具面，其余 skill 根
  （项目目录、用户目录）不受影响。宿主模式由应用进程直接读归档，没有
  这个限制。

## 沙箱

- **一次性回退路径只有宿主截止时间** —— `wsl.exe` 被杀时不会把 kill 传进
  发行版，因此 Linux 进程树可能比调用活得更久。长命令建议
  `agent: true` 并使用会话 runtime。
- **常驻 agent 丢失时已在途的命令不会重跑** —— 命令尚未到达常驻 agent
  （agent 已死、正在退避、握手失败）时回退到一次性 `wsl.exe`。常驻 agent
  在命令执行途中死亡时，命令可能已经生效：它以「状态未知」失败，并提示先
  检查发行版，不会在一次性路径上再执行一遍。
- **批量读取按发行版共享一个原生 agent**（16 个并发调用 2.4-4.1 ms；
  第一次调用要付出约 70 ms 的准备）。
- **aarch64 只在 CI 中于 qemu 下运行**（身边没有 Windows-on-ARM 机器——
  [COMPATIBILITY.md](COMPATIBILITY.md#scope-decisions)）。`auto` 仍会选择
  包内二进制；`native` 在准备失败时拒绝；`shell` 强制使用 shell agent。
- **托管的 cloud WSL 门禁以发行版的 root 用户跑完整探针套件** ——
  `.github/workflows/cloud-wsl-gate.yml` 以 `-u root` 执行
  `run-all-when-closed.sh`，并只为 root 开启 linger。真实部署使用普通 distro
  用户：非特权 user namespace、用户级 systemd 与 linger 是另一条路径，root
  下通过不等于普通用户下通过。普通用户路径仍以真机探针为准，该门禁不声称
  覆盖它（见 #88）。
- **会话 runtime 需要 systemd 和带 linger 的 user manager** —— 否则在
  第一条命令时被拒绝并给出补救方法；把 `sessionSandbox` 设为 `auto`
  （无 systemd 时即按命令形态）或 `false` 保留旧的按命令形态。应用硬崩溃
  可能留下过期的 `dsh-wsl-*.scope`；预检会在下一个
  WSL 会话时清扫过期 scope（从不清扫其他活跃会话的）。
- **会话 runtime 随会话的 agent 释放** —— 会话的 agent 被处置（上游的
  `agent/disposed`）时，两个 provider 各自放掉该会话的引用，scope 被停止，
  其中的后台进程一并回收。当前 Harness（≤ 0.2.2-rc.5）在关闭会话视图时并不
  处置 agent，而是保留到应用退出，所以在此之前每个跑过命令的会话各有一个
  runtime。另有一层兜底清扫：runtime 连续 10 分钟没有任何交换、且已没有活跃
  agent 属于该会话（或它从未指明会话）时，该会话结束；会话仍活跃的 runtime
  不设空闲时限。
- **沙箱不管辖 WSL interop** —— 上报为 `enforcement: partial`。
  `maskWindowsDrive` 和 `interopVisibility` 收窄 `/mnt` 但不是关闭；即使是
  `interopVisibility: "disabled"` 也只是给出 `wsl.conf` 中
  `[interop] enabled=false` 的补救命令（由 `doctor` 打印）——发行版级设置
  仍需手工执行。
  [ARCHITECTURE.md](ARCHITECTURE.md#reported-enforcement)。
- **挂载 profile 不管辖进程权限** —— 受限进程仍可触达围栏外的 socket：
  用户 systemd 管理器（已记录的逃逸）、系统总线与容器守护进程。
  受限行的 `socketIsolation: "session-bus"` 把 `/dev/null` 绑到
  `$XDG_RUNTIME_DIR/bus` 与 `$XDG_RUNTIME_DIR/systemd/private`；`"strict"`
  追加 `/run/dbus/system_bus_socket`、发行版用户可触达的容器 socket，以及
  `/run/WSL` 上的 tmpfs（interop 传输），复制出的 PE 因此连不上 host bridge。
  默认 `off`；遮蔽是收窄而非关闭（同用户 `/proc` 与其他 IPC 仍在；整发行版
  interop 开关仍是 `[interop] enabled=false`），`enforcement` 仍是
  `partial`。`strict` 会打断受限命令内的 `systemctl --user`、D-Bus、容器
  客户端与 Windows 程序启动。由 `pnpm run probe:sandbox` 实测。
- **必须安装 `bubblewrap`**，否则两个提供者都会带着安装命令失败；
  会话启动预检会以建议性警告的形式给出同样的文本。
- **`workspace-write` 默认不授予 `$HOME` 下的包管理器缓存** —— npm 的
  `~/.npm`、pnpm 的 store、cargo 的 `~/.cargo/registry` 都在工作区之外，
  安装一个尚未缓存的依赖会以 `EROFS` 失败。用 `writableRoots` 显式授权
  （见 [CONFIGURATION](CONFIGURATION.zh.md#工具链缓存与额外可写目录)）；
  授权目录里的可执行内容可被后续构建使用，这是收窄沙箱，不是关闭它，
  `enforcement` 仍是 `partial`。条目必须是已存在的物理目录；已被工作区、
  `/tmp`、`/dev/shm` 覆盖或嵌套在另一条授权内的条目不绑定。
- **消息本地化按设计只覆盖一部分** —— 预检判定、`bwrap` 修复提示与
  发行版/工作目录错误跟随应用的语言设置
  （[CONFIGURATION.zh.md](CONFIGURATION.zh.md#消息语言)）；`fs-decisions`
  中的 `FS_*` 拒绝文本与 fsio 复刻保持逐字节英文，因为工具层按这些字符串
  匹配。独立的 `scripts/doctor.mjs` 只本地化其固定骨架——裁决、状态标记、
  汇总、提示——经自带 catalog 按检测到的 Windows 区域设置渲染
  （`--locale <标签>` / `DSH_WSL_DOCTOR_LOCALE` 可覆盖）；逐项检查的标题、
  详情与修复保持英文，因为修复文本携带可复制的命令；`--json` 保持语言无关。
- 会话中途被删除的工作区目录会以 runner 错误失败；插件不会重建它。
  配置的 `cwd` 不存在时，报错会指明该目录。

## shell 启动语义（`wsl-shell`）

命令以 `<shell> -lc <command>` 运行——登录 shell（会 source profile 脚本，
因此版本管理器可用）且**非交互**（模型的输出流中没有提示符/插件输出）。
设置 `loginShell: false` 后去掉登录旗标（`<shell> -c <command>`）。

`<shell>` 是 distro 用户的登录 shell（先 `getent passwd`，再 `$SHELL`）。
两条探测都失败时——冷启动的 distro、首个 `wsl.exe` 调用抖动、没有 `getent`
的 musl 系——命令**直接报错**，而不是静默落到 bash；失败不缓存，重试即重探测。
需要钉死就用 `shell:` 指定绝对路径。

- **`~/.zshrc` / `~/.bashrc` 永远不会被读取。** 把机器级的 PATH 设置
  （`fnm`、nvm、cargo）移进 `~/.zprofile` 或 `~/.zshenv`；提示符和补全
  留在 rc 文件里。
- **fnm 的 multishell PATH 在沙箱内无法形成**（`/run` 只读）——
  使用 [Configuration](CONFIGURATION.md#zshfnm-recipe-for-model-run-commands)
  中的回退配方。
- **shell agent 的 stdin 载荷不保留 NUL 字节与末尾换行。** 载荷经命令替换
  解码，dash/bash 的变量无法持有 NUL，末尾换行也会被剥掉；native agent
  逐字节原样传递。依赖 NUL 分隔的输入（如 `git check-ignore -z`）需要
  native 后端——默认的 `agentBackend: auto` 在可用时即选 native。

## Agent 诊断

- **doctor 的 `agent.handshake` 探测的是一个新起的常驻 agent**，而不是
  在跑的那个——存在共享 agent 时，doctorReport 会经
  `mergeLiveResidentStatus` 合入 `WslAgent.status()` 的在驻视角（0.18.0），
  但 CLI 的握手检查仍会标注其探测来源（`probed: a fresh resident`）；
  没有应用侧调用时，`lastError` 仍留在应用日志里。已经死亡的常驻 agent
  会让合并后的检查失败，报告的 verdict 随之变为 blocked；恢复后的常驻
  agent 沿用新探测的结论，读操作不在 native agent 上时合并详情会写明原因。
- **`dsh-wsl-*.scope` 计数是某一时刻的快照**；`--fix` 会执行预检的清扫。
- **取消信号存在残余投递窗口。** 请求被取消后，宿主先等宽限期、确认它
  尚未被应答且没有更新的 ACK，再经第二个 `wsl.exe` 递送 `SIGUSR1`。
  这个 `wsl.exe` 自身的启动需要数百毫秒；若旧命令恰在窗口内完成、下一条
  命令已开始执行，信号可能落在下一条命令上。序列号守卫排除了绝大多数
  误发，但投递延迟无法在宿主侧消除；KILL 帧是不依赖信号的兜底路径。
- **doctor 的 `git.win-safe` 探针通过 interop 的 `git.exe` 报告 Windows git
  的信任状态** —— 装了 Windows git 时，WSL 变更审查需要那份
  `safe.directory` 白名单（见下文"终端"）。

## doctor 的裁决与补救边界

doctor 的 `verdict` 在生效配置（应用加载的 profile 层叠加在随包 preset
之上）下给出——但它是对机器与配置的裁决，不是对某个会话的：**policy** 与
**data** 类的错误码（见 [DIAGNOSTICS.zh.md](DIAGNOSTICS.zh.md#地图)）是
逐次调用的决策，doctor 无法预知，`ready` 也不为它们背书。

**无法解析出发行版时，`/wsl-doctor` 仍会按配置全量扫描。** 命令从会话工作
目录取发行版；会话开在 Windows 文件夹上、或 cwd 无法解析时，目标交给生效
配置，而随包预设的 `auto` 会逐个检查所有已安装发行版——在开发机上实测八个
发行版约 4 分钟，而收窄到单个发行版只需数秒。不想要这个结果就传
`--distro <名称>`（CLI 的 `--all` 是同一件事的显式写法）。handler 给未收窄
的运行设 60 秒时限（已解析出发行版时 120 秒），让它带着收窄提示收尾，而不是
一直显示「执行中」直到命令面的整个预算耗尽。

侧边栏保存的是上一次运行的结果，不是实时裁决：时间戳与来源标明它是哪次运行，
后台也不会为已停止的发行版启动探测。doctor 只读取和报告，从不改写用户或发行版
所有的文件。`.wslconfig`、
`/etc/wsl.conf`、WSL1 转换和发行版安装只以补救命令的形式出现——补救文本
携带确切的命令；可自动修复的集合仅限安全且可逆的部分（过期 scope、插件自有的
agent 缓存、`--install` 加确认后的可选软件包、以及同一道确认门后的
Windows git `safe.directory` 白名单）。`--fix-owned` 把运行收窄到插件自有
的两类（过期 scope 与缓存）；侧边栏面板的“修复插件状态”动作正是这次运行，
完整诊断本身只读。因此它永远不会安装软件包或改写 Windows 所有的配置，也不会暗示仅能手动处理的告警
可被自动修复。裁决从不升级沙箱的安全声明：
`enforcement: partial` 不受影响。

## 会话启动建议

- **DSH 0.2.1 没有会话 UI 通知接缝。** `wsl-preflight` 的阻塞裁决进入宿主日志
  和会话的 runtime context（下次组装时对模型可见）——仅供参考，从不安装、
  从不取消。ready 裁决只写日志：“前置项可用”不是模型的动作。对上游的请求见：
  [UPSTREAM-SESSION-NOTICE.md](UPSTREAM-SESSION-NOTICE.md)。
- **runtime context 条目是重复的快照，不是可关闭的通知。**
  移除 `wsl-preflight` 行即可让该探针完全静音。阻塞消息把修复标记为用户操作；
  ready 裁决不再发送。
- **访问方式提醒是插件自有 UI，不是通知接缝。** 只要客户端的会话列表带有
  `agentPreset` 投影，它就渲染在输入框上方；`auto-preset` 设置行提供目标 preset
  与已记录目录，读取失败或抛错时回退到 `wsl` 且视为无记录——显示警示，绝不静默。
  它绝不只凭路径猜测环境。没有 Web 客户端时（CLI、headless），同一状态只通过
  日志到达操作者，通过 runtime context 条目到达模型。
- **创建期环境绑定依赖宿主私有的 controller 形状。** `auto-preset` 包装
  `sessionController.agents.createSession`，使发行版工作区的首次挂载就是 WSL
  preset；0.2.1 用这个请求对象替换了更早的
  `ensureSession(sessionId, cwd, …, presetId)` 帧。宿主将来再改形状时包装会
  失效：会话仍会经 `agent/created` 在创建后切换到 WSL preset，但落在这个窗口内
  开始的首轮可能在宿主环境里运行（Windows ACL 沙箱无法承载
  `\\wsl.localhost` 路径）。挂载时会告警，doctor 的 `session.preset-seam`
  行报告 active/inactive——只在应用内界面可见，独立 CLI 看不到宿主进程状态。

## 端口

- **端口轮询让常驻 agent 在使用它的发行版上保持保温** —— 只要有存活
  会话在该发行版里工作，就每 `portsRefreshMs`（默认 10 s）刷新一次；会话
  都结束后停止轮询，agent 才会空闲关停。每个周期先向 WSL 确认哪些发行版
  在运行：已停止的发行版不会被探测（探测会把它重新启动起来），
  `DSH_WSL_PORTS` 读作空。把 `portsRefreshMs` 调到超过 agent 的空闲超时可以
  提早恢复空闲关停，代价是端口事实更陈旧。

## 目录选择器

- 发行版层级从发行版内部一次往返完成列举（NUL 分隔，因此含换行的
  目录名也能精确列出——WSL-306）；常驻 agent 不在时用一次性的
  `wsl.exe --exec find`。

## 终端

- 终端路由按会话的工作区坐标进行：WSL 文件夹会话获得发行版 shell，
  Windows 文件夹会话在其自身目录获得 `powershell.exe`。shell 菜单的
  默认条目保持为配置的 profile；不带目录的启动落在发行版内。
- **Windows git 必须信任该共享**（`safe.directory`），否则 WSL 工作区的
  changed-files 卡片会无声消失（发现调用返回 `detected dubious ownership`）。
  Windows 上的一次性补救：
  `git config --global --add safe.directory "//wsl.localhost/*"`，然后重启
  应用。两个替代方案：doctor 的 `git.win-safe` 探针可报告该状态；而
  **没有** Windows git 的机器什么都不用做——提供者把发现请求路由进
  发行版，并把输出转写成 UNC 形式。
- **没有系统级 git 的发行版不会把变更审阅伪装成“无变更”**：快照调用以退出码
  127 报出 git 无法启动、agent PATH 的成因（`~/.local/bin` 下的安装不可见）
  与 bootstrap 安装指引；快照目录缺失则用 git 自身的
  `fatal: cannot change to ...`（退出码 128）失败，而不是静默返回空结果。
  一次性回退路径上的同类 relay 文本（`execvpe(git) failed`、`chdir(...) failed`）
  做同样的翻译。
- **多目录 `GIT_*` 值会被转写而不是跳过——Windows 形态的列表会译坏。**
  git 环境转写对每个 `GIT_*` 值无条件套用单值翻译，列表被折叠进首个盘符的
  挂载点（`C:\a;D:\b` 变成 `/mnt/c/a;D:/b`）；只有 POSIX 形态的冒号列表
  （`/a:/b`）原样透传（当前没有调用方设置列表值）。
- **NEW 标签页的标题显示 `WSL`**，无论它实际运行什么——控制器是在
  `spawnTerminal` 返回之后（即提供者的改写已经执行完之后）才按 composition
  的 profile 盖上 `title: shell.name`，且从不回读启动真正运行的程序
  （spawn spec 没有 display-name 字段），插件因此无法纠正这个默认值
  （[UPSTREAM-TERMINAL-TITLE.md](UPSTREAM-TERMINAL-TITLE.md)）。
  菜单附带宿主候选（`powershell`、`cmd`）：手动选择的 shell 会以自身命名；
  双击重命名也可行。
- **发行版终端空闲时确实会被回收** —— 通过常驻 agent 对被标记的进程计数
  （提示符处恰好一个进程 = `idle`；嵌套 shell 或启动文件拉起的
  `ssh-agent` 按设计读作 `busy`）。阈值是控制器的
  `unattendedTimeoutMs`（2 h）。`terminalIdleReclaim: false` 恢复手动关闭。
  Windows 文件夹的宿主终端保持随包的不回收行为。

## 在运行中的 profile 上启用本插件

- **在运行中的 profile 上启用本 bundle 时，接管会推迟到旧提供者释放，而不是
  失败。** 三个根面接管行（`subprocess`、`fs`、`directoryPicker`）以同名替换
  随包服务。运行中的重组里旧提供者可能仍持有服务注册；本插件的行保持激活，
  等 `internal/service` 报告槽位释放后再注册（`src/service-takeover.ts`），
  所以 cordis 的重复服务错误不再让启用失败。释放之前随包 provider 继续服务，
  `/wsl-doctor` 的 `providers.takeover` 行会点名它；依赖方始终不释放时，重启
  应用即可完成接管（冷启动组合是正确的）。机制与复现：
  [UPSTREAM-SERVICE-SWAP.md](UPSTREAM-SERVICE-SWAP.md)。
- **通过插件管理器升级不再自动回滚；接管可能推迟到重启。** 有 HMR 时
  `updateBundle` 先 `removeBundle` 再安装目标版本：移除旧层的那一刻，本 patch
  里的 `- id: subprocess / disabled: true` 等接管条目随之消失，随包行重新激活
  并注册服务；新层到达时，本插件的行检测到槽位占用后等待释放，管理器看到的是
  成功，不会删除目标版本。若随包 provider 因依赖方未释放而一直不释放，接管在
  下次重启完成，期间 `providers.takeover` 报告仍在服务的随包 provider。宿主侧
  的 remove→install 窗口仍是上游问题
  （[deepseek-harness#12510](https://github.com/deepseek-ai/deepseek-harness/discussions/12510)），
  其他 bundle 仍可能失败；本插件不再触发回滚。
  [#39](https://github.com/Big-Dao/dsh-plugin-wsl-env/issues/39) 记录了
  `0.24.0 → 0.26.2` 的实际表现。
- **面板的一键升级需要宿主的插件管理器提供 `updateBundle`，且从不自动执行。**
  链接安装（linked checkout）或没有 registry 来源的包会被宿主以 `not-updatable`
  拒绝；面板仍显示已安装版本，并指向 Plugins 页。检查本身只读（`listVersions`），
  只有面板的显式 POST 才调用 `updateBundle`。宿主可能回答 `restart-required`
  （无 HMR，或变更触及宿主模块），也可能回滚失败的目标版本；面板会报告这两种结果。
  若升级期间宿主进程重启或连接中断，浏览器可能丢失响应，即使安装已经完成——
  请刷新页面、读取版本卡片后再决定是否重试。

## 宿主的"在应用中打开"

- **插件的"在 VS Code 中打开（WSL）"菜单项可用；随包的"在应用中打开"仍然
  失败。** `wsl-open-in-app` 行按宿主 `scrubbedParentEnv()` 的同一规则清理
  **编辑器子进程**的环境——剔除名含 `KEY`/`PASSWORD`/`SECRET`/`TOKEN`
  （不区分大小写）的变量和 `DSH_*` 命名空间——并删除
  `ELECTRON_RUN_AS_NODE`，VS Code 因此按应用启动；路由把 WSL UNC 工作区转换为
  `vscode-remote` URI，编辑器直接进入 Remote-WSL。这个清理刻意只作用于子进程：
  从 Host 进程环境删除会破坏 Windows Job runner 这类需要继承该变量的
  Node 模式辅助进程。随包入口仍继承该变量，所以仍然失败；那一半属于上游：
  [UPSTREAM-OPEN-IN-APP.md](UPSTREAM-OPEN-IN-APP.md)。两半都不修改
  `app.asar`，应用升级不会丢掉插件这一半。
- **WSL 文件可以正常打开，但预览里的相对 Markdown 图片不再渲染** ——
  路由的 `processPath` 现在返回 UNC 宿主拼写，这是
  `session.openWorkspacePath` / `workspacePathApplications` 校验所要求的形态
  （issue #37）；客户端 `fileMediaUrl` 拒绝 `\\` 开头的路径，因此 Markdown
  预览中的相对图片无法解析。聊天侧因 cwd 本就是 UNC，此前已有同一缺口。
  GUI change feed、`stat.absolutePath` 与预览头部的路径标签的 UNC 形态也源于同一拼写。

## 侧栏终端字体

- **终端字体是 DSH 用户设置，不是插件设置。** 在 `0.2.2-rc.2` 上，侧栏终端渲染
  `ui-theme.terminalFontFamily`（空值回退到内置 `ui-monospace`/Consolas 栈），
  该字段存放在 profile 的 `cordis.patch.yml`。请在
  **设置 → 通用 → 字体 → 终端字体** 里设置一次，不要手改 profile；Desktop 的
  致命错误恢复会把 profile patch 改名为 `.bak-*` 兄弟文件，手加的行随之丢失。
  若该选择必须熬过这次恢复，请把完整的 `ui-theme` 行镜像到
  `$DSH_HOME/cordis.patch.yml`：home 层不会被改名，但 patch 会替换该行的整个
  config，因此要重述所有保留字段。插件不拥有渲染层字体，也从不写这项设置。
