# Limitations

_本文是 [LIMITATIONS](LIMITATIONS.md) 的中文译本，以英文版为准。_

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
  （2/4/8 s）；三次死亡则永久退出，直到应用重启。没有回退 I/O——这是有意为之。
- **变更守卫不是原子的比较并交换。** 创建使用不可替换的 link；覆盖在 rename 前
  会重新校验版本。不匹配时返回 `FS_STALE_VERSION`，但检查与 rename 之间发生的
  变更仍可能被覆盖。
- **被取消的写入结果可能是未知的** —— 重试前先检查文件。
- **写入的崩溃持久性取决于平台的 `sync -d`。** 被暂存的文件会 sync，
  rename 之后所在目录也会尽力 fsync（shell agent）。native agent 目前只有
  文件级 `sync_all` —— 见 peer 对齐文档的分歧注记。拒绝目录 fsync 的
  文件系统保持与对端相同的承诺。
- **含反斜杠的 Linux 文件名无法被寻址** —— 反斜杠是 UNC 分隔符，
  `a\b.ts` 会往返成 `a/b.ts`。请把文件名改掉，不要用反斜杠；
  这是坐标系自身的限制。
- **受限写入运行在各自的 bwrap 约束常驻 agent 上** —— 由内核强制，
  工作区之外以 `FS_SANDBOX_DENIED` 拒绝。代价：需要 `bubblewrap`；
  策略变更要付出一次 agent 启动；授予 `/tmp` 的写入落在发行版真实的
  `/tmp` 中。
- **`glob`/`grep` 使用发行版的 rg**；没有 rg 的发行版搜索失败
  （退出码 127）。安装：`wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap
  git ripgrep inotify-tools`（或检测到的包管理族对应的写法）。`--install` 只在
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

## 沙箱

- **一次性回退路径只有宿主截止时间** —— `wsl.exe` 被杀时不会把 kill 传进
  发行版，因此 Linux 进程树可能比调用活得更久。长命令建议
  `agent: true` 并使用会话 runtime。
- **批量读取按发行版共享一个原生 agent**（16 个并发调用 2.4-4.1 ms；
  第一次调用要付出约 70 ms 的准备）。
- **aarch64 只在 CI 中于 qemu 下运行**（身边没有 Windows-on-ARM 机器——
  [COMPATIBILITY.md](COMPATIBILITY.md#scope-decisions)）。`auto` 仍会选择
  包内二进制；`native` 在准备失败时拒绝；`shell` 强制使用 shell agent。
- **会话 runtime 需要 systemd 和带 linger 的 user manager** —— 否则在
  第一条命令时被拒绝并给出补救方法；`sessionSandbox: false` 保留旧的
  按命令形态。应用硬崩溃可能留下过期的 `dsh-wsl-*.scope`；预检会在下一个
  WSL 会话时清扫过期 scope（从不清扫其他活跃会话的）。
- **沙箱不管辖 WSL interop** —— 上报为 `enforcement: partial`。
  `maskWindowsDrive` 和 `interopVisibility` 收窄 `/mnt` 但不是关闭；即使是
  `interopVisibility: "disabled"` 也只是给出 `wsl.conf` 中
  `[interop] enabled=false` 的补救命令（由 `doctor` 打印）——发行版级设置
  仍需手工执行。
  [ARCHITECTURE.md](ARCHITECTURE.md#reported-enforcement)。
- **必须安装 `bubblewrap`**，否则两个提供者都会带着安装命令失败；
  会话启动预检会以建议性警告的形式给出同样的文本。
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

## Agent 诊断

- **doctor 的 `agent.handshake` 探测的是一个新起的常驻 agent**，而不是
  在跑的那个——存在共享 agent 时，doctorReport 会经
  `mergeLiveResidentStatus` 合入 `WslAgent.status()` 的在驻视角（0.18.0），
  但 CLI 的握手检查仍会标注其探测来源（`probed: a fresh resident`）；
  没有应用侧调用时，`lastError` 仍留在应用日志里。
- **`dsh-wsl-*.scope` 计数是某一时刻的快照**；`--fix` 会执行预检的清扫。
- **doctor 的 `git.win-safe` 探针通过 interop 的 `git.exe` 报告 Windows git
  的信任状态** —— 装了 Windows git 时，WSL 变更审查需要那份
  `safe.directory` 白名单（见下文"终端"）。

## 会话启动建议

- **DSH 0.2.1 没有会话 UI 通知接缝。** `wsl-preflight` 的失败进入宿主日志
  和会话的 runtime context（下次组装时对模型可见）——仅供参考，从不安装、
  从不取消。对上游的请求见：
  [UPSTREAM-SESSION-NOTICE.md](UPSTREAM-SESSION-NOTICE.md)。
- **runtime context 条目是重复的快照，不是可关闭的通知。**
  移除 `wsl-preflight` 行即可让该探针完全静音。

## 端口

- **端口轮询让常驻 agent 在每个活跃发行版上永久保温**
  （10 s 刷新）。把 `portsRefreshMs` 调到超过 agent 的空闲超时即可恢复
  空闲关停，代价是端口事实更陈旧。

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
- **冒号分隔的多目录 `GIT_*` 值不做转写直接透传。** git 环境转写只改写单个
  Windows 目录值；冒号分隔的列表（当前没有调用方设置这种形态）原样转发。
- **NEW 标签页的标题显示 `WSL`**，无论它实际运行什么——控制器在提供者
  改写启动命令之前就按 composition 的 profile 命名了，而插件无法纠正
  这个默认值（[UPSTREAM-TERMINAL-TITLE.md](UPSTREAM-TERMINAL-TITLE.md)）。
  菜单附带宿主候选（`powershell`、`cmd`）：手动选择的 shell 会以自身命名；
  双击重命名也可行。
- **发行版终端空闲时确实会被回收** —— 通过常驻 agent 对被标记的进程计数
  （提示符处恰好一个进程 = `idle`；嵌套 shell 或启动文件拉起的
  `ssh-agent` 按设计读作 `busy`）。阈值是控制器的
  `unattendedTimeoutMs`（2 h）。`terminalIdleReclaim: false` 恢复手动关闭。
  Windows 文件夹的宿主终端保持随包的不回收行为。

## 在运行中的 profile 上启用本插件

- **在繁忙的 profile 上通过 GUI 启用本 bundle 可能失败，重启应用即可生效。**
  三个根面接管行（`subprocess`、`fs`、`directoryPicker`）以同名替换随包服务。
  在应用 `0.2.2-rc.1`（cordis 4.1.0）上，正在销毁的提供者在全部依赖方释放之前
  一直持有服务注册，因此会话存活期间替换行会与随包提供者相撞，启用操作将它们
  报告为失败。无论如何选择都会持久化；**重启应用即可加载插件**（冷启动组合是
  正确的）。启用前先关闭会话通常能让热路径成功——没有依赖方时，随包提供者会在
  重组期间释放。机制与复现：
  [UPSTREAM-SERVICE-SWAP.md](UPSTREAM-SERVICE-SWAP.md)。

## 宿主的"在应用中打开"

- **从"在应用中打开"启动 VS Code 可能独立于本插件而失败** ——
  宿主带着 `ELECTRON_RUN_AS_NODE=1` 运行，启动器会继承它，于是
  `Code.exe` 以 Node 身份启动并以退出码 1 结束。不属于本仓库管：
  [UPSTREAM-OPEN-IN-APP.md](UPSTREAM-OPEN-IN-APP.md)。
