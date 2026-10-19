# dsh-plugin-wsl-env 价值说明

本文只回答一个问题：**在 Windows 上用 DeepSeek Harness 做 WSL 项目，为什么值得装这个插件。**
功能、安装与逐项行为见 [README](../README.md) 和 [ARCHITECTURE.md](ARCHITECTURE.md)，这里谈收益、代价与适用边界。
文中每条主张都指向仓库内可复核的证据；基线为 v0.9.0（2026-10-17）。

> **一句话**：它把 WSL 发行版变成 DSH 会话真正的执行环境——命令、文件、终端、目录选择器都在发行版内完成，
> 同时保留 DSH 的权限模型和发行版内的 bubblewrap 沙箱；不往发行版里装自己的服务，也不开端口。

## 1. 没有它时，三处错位

DSH 是 Windows 桌面应用，项目在 WSL 的 ext4 里。不做集成，三件事会同时错位：

| 错位 | 具体表现 | 后果 |
|---|---|---|
| 位置 | 应用只认 `\\wsl.localhost\<distro>\...`，工具却期待 `/home/...` | 路径要来回翻译；9p 共享在大量小文件时明显慢；符号链接与权限位经过共享层后不再保真 |
| 环境 | 命令在 Windows 侧执行 | 发行版的 `PATH`、`nvm`、`cargo`、`pyenv`、rc 配置、原生 `rg` 都用不上；脚本要么找不到解释器，要么静默用了另一个二进制 |
| 安全 | Windows 沙箱的受限令牌到不了 WSL（`wsl.exe` 返回 `Wsl/E_ACCESSDENIED`） | 「能操作 WSL」和「命令有边界」通常只能二选一 |

现成的选择各有代价：把 CLI 整个装进 WSL 最干净，但 DSH 是桌面应用，搬不进去；桌面远程（VS Code Remote-WSL、ZCode 一类）成熟，但要在发行版里放一个服务目录、开一个端口，且命令没有沙箱；什么都不做，就是上面三处错位。
本插件补的是这三者之外的组合：**应用留在 Windows，执行世界放进发行版，边界留在命令外面。**

## 2. 六条价值

### 价值一：第一条命令就在正确的环境里

**机制。** 会话打开发行版目录时，`auto-preset` 自动绑上 `wsl` preset；`wsl-shell` 用发行版配置的登录 shell（不写死 bash）执行 `wsl.exe --exec <shell> -lc <cmd>`。`PATH`、版本管理器、rc 文件因此全部生效。

**可感知的差别。** 不需要先 `source` 什么，也不需要把 `nvm`/`pyenv` 的路径手工告诉模型。模型说「跑一下测试」，用的就是你在那个终端里会用的 `node`、`pnpm`、`cargo`。第一条命令已经是对的，不存在「先热身一条命令把环境带起来」。

**证据。** [README「Using it」](../README.md#using-it)；`test/shell.test.mjs`、`test/preset-choice.test.mjs`；`pnpm run probe:sandbox-shell`。

### 价值二：文件是发行版的真实文件

**机制。** 读、写、搜索都经常驻 agent 落在 ext4 上：原生符号链接、原生 mode 位、发行版自己的 `rg`。GUI 文件树与预览同样由发行版内部提供。搜索参数逐字转发给发行版的 `rg`，结果、输出格式、退出码都是 rg 自己的，且遵守该目录的 `.gitignore`。

**可感知的差别。** `chmod +x`、`ln -s`、git hook、按内容分发的工具，行为与 Linux 主机一致；`glob`/`grep` 不再跨 9p 慢桥，也不再用 Windows 侧那份 rg 去读 Linux 目录。文件夹里的 `/home/you/x` 与 GUI 里的 `\\wsl.localhost\ubuntu\home\you\x` 是同一个文件，不是副本。

**证据。** [ARCHITECTURE「The filesystem substrate」](ARCHITECTURE.md#the-filesystem-substrate)、[LIMITATIONS](LIMITATIONS.md)；`test/search-route.test.mjs`、`test/search-exec.test.mjs`、`test/fs-substrate.test.mjs`；`pnpm run probe:substrate`（8/8）。已知极限见第 4 节：新文件 0600、含反斜杠的文件名、watch 为轮询。

### 价值三：沙箱是默认，失败是响亮的

**机制。** 一个会话的受限命令在同一个 systemd user scope 内经 `bubblewrap` mount profile 执行（后台进程、真实 `/tmp`、`ps` 可见），scope 随会话结束停止；三档权限（`read-only` / `workspace-write` / `danger-full-access`）逐档生效；文件写入按同一份策略检查，受限策略下的写入还由内核在 bwrap 配置内二次拒绝。没有可用的 bwrap 时，命令报 `SANDBOX_UNAVAILABLE` 而不是脱箱运行。

**可感知的差别。** 可以把一个会自己跑命令的 agent 放进真实仓库，同时知道它写不出工作区。被拒绝时，模型收到一次「用刚好够用的权限重试」的提议，而不是直接要 `danger-full-access`。审计时能拿到当时实际执行的模式和拒绝原因；在显式 pin 发行版的配置里，文件工具遇到跨发行版路径时由 `FS_OUTSIDE_DISTRO` 拒绝，且放宽权限也解不开。

**诚实边界。** 上报是 `enforcement: partial`，因为发行版内的进程仍可通过 interop 启动 Windows 程序；`maskWindowsDrive` 收窄这个洞（`/mnt` 在受限视图里消失），但 binfmt 按内容分发，所以它仍不是闭合；完全关闭要在发行版层面设 `[interop] enabled=false`。插件不把 partial 说成 full。

**证据。** [ARCHITECTURE「Sandbox」](ARCHITECTURE.md#sandbox)、[SECURITY](../SECURITY.md)；`test/sandbox.test.mjs`、`test/fs-decisions.test.mjs`；`pnpm run probe:sandbox`、`pnpm run probe:sandbox-off`。

### 价值四：一个进程，两种会话，工具箱不变

**机制。** 组合层按路径坐标路由：发行版 UNC 路径交给 agent 实现，盘符路径留给宿主后端；GUI 终端按会话路由，WSL 目录会话得到发行版 shell，Windows 目录会话仍是 PowerShell；`wsl-shell`/`wsl-fs` 挂在 preset 层，所以环境按会话生效。

**可感知的差别。** 不需要为 WSL 单开一个应用或 profile，也不需要把整个应用切成「WSL 模式」。同一个窗口里，开 Windows 文件夹的会话不受影响，开 `\\wsl.localhost\...` 的会话自动进入发行版。换项目只是换一个打开的文件夹。模型侧尤其重要：插件不新增任何模型工具，现有工具的名字、参数、返回语义不变，变的只是它们实际作用的世界。

**证据。** [README「Architecture」](../README.md#architecture)、[docs/root-fs-routing.md](root-fs-routing.md)；`test/composition.test.mjs`、`test/terminal.test.mjs`、`test/fs.boot.test.mjs`。

### 价值五：不装服务、不开端口、没有残留

**机制。** 发行版里没有安装任何服务，也没有监听端口；插件只替换 DSH 的服务实现。文件操作与命令走发行版内按 distro 缓存的常驻 agent——它是传输层，不注册系统服务，agent 脚本在握手时校验 sha256。

**可感知的差别。** 不会多出 `~/.vscode-server` 这类目录，不会和本机端口冲突，卸载后发行版里没有需要手动清理的服务端目录。WSL 升级或发行版重启后，下一次调用重建传输；只有 agent 在「有请求在飞」时死亡才可能耗尽它的一次重建额度（见 [LIMITATIONS](LIMITATIONS.md)），这是已声明的边界，不是日常路径。

**注意区分。** 「不装服务」不等于「零依赖」：bubblewrap 是默认路径的硬依赖；会话 runtime 还需要 systemd 为 PID 1 且 user manager 已 `enable-linger`（临时 scope，不是安装的常驻服务）。ripgrep、git、inotify-tools 由 `pnpm run bootstrap` 体检。插件不把这些工具打包进来，也不在发行版里安装常驻服务。

**证据。** [README「How it compares」](../README.md#how-it-compares)；`agent/wsl-agent.sh`、`test/agent.test.mjs`；`scripts/bootstrap.sh`。

### 价值六：模型拿到事实，不用猜

**机制。** 会话环境向模型暴露 `DSH_WSL_DISTRO`、`DSH_WSL_SHELL`、`DSH_WSL_HOME`、`DSH_WSL_PORTS`；端口按约 10 秒的节奏刷新。错误码按抛出者分门别类（`FS_OUTSIDE_DISTRO`、`SANDBOX_UNAVAILABLE`、`FS_STALE_VERSION` 等），每条都说明谁拒绝、怎么解除。会话打开时若缺工具，直接给出该发行版的安装命令。

**可感知的差别。** 模型能说出它启动的 dev server 的确切地址（WSL2 把 localhost 转发给 Windows，浏览器可直接打开）；路径拒绝、沙箱缺失、文件过期各有各的码，排错不用从「命令失败了」开始猜。这减少的是往返次数，不只是错误信息的好看程度。

**证据。** [ARCHITECTURE「Error codes」](ARCHITECTURE.md#error-codes)、[README「Troubleshooting」](../README.md#troubleshooting)；`test/ports.test.mjs`、`test/preflight.test.mjs`、`test/terminal.test.mjs`。

## 3. 和替代方案的价值对照

| | 不做集成（Windows 侧开 UNC） | 桌面远程（VS Code Remote-WSL 等） | 把 CLI 装进 WSL | 本插件 |
|---|---|---|---|---|
| 命令环境 | Windows | 发行版 | 发行版 | 发行版 |
| 文件语义 | 9p 共享，慢且丢 POSIX 细节 | 发行版内，原生 | 发行版内，原生 | 发行版内，原生（ext4） |
| 命令沙箱 | Windows 沙箱到不了 WSL | 无 | 取决于 CLI | 发行版内 bubblewrap + systemd 会话 scope |
| 发行版内安装 | 无 | 一个服务目录 | 整个工具 | 无自有服务（依赖系统工具） |
| 端口 | 无 | 监听一个端口 | 无 | 无 |
| 卸载残留 | 无 | 手动删服务目录 | 删工具 | 无 |
| 适用前提 | 能接受慢与语义丢失 | 用 VS Code / 对应桌面端 | 工具能整个搬进 WSL | Windows + DSH GUI + WSL2 |

**别人更强的地方要直说。** 桌面远程重开工作区是即时的，服务常驻；VS Code 的远程有多年生产打磨。CLI 装进 WSL 则完全不需要桥接。本插件不试图在这些维度取胜，它只解决一个组合：**DSH 在 Windows 上，项目在 WSL 里，命令要有沙箱。**

## 4. 代价、边界与不适用

价值是收益减代价。下面这些是安装前就该知道的：

- **bubblewrap 是硬依赖。** 默认路径没有它，每条受限命令都失败（这是有意的 fail-closed）；受限的文件写入同样需要它。会话 runtime 还要求 systemd 为 PID 1、user manager 已 `enable-linger`；预检失败会带修复命令拒绝。`pnpm run bootstrap -- <distro>` 会体检并给出安装命令。
- **enforcement 是 partial。** interop 让发行版内的进程仍能启动 Windows 程序。`maskWindowsDrive` 只是收窄；完全关闭要靠 `wsl.conf` 的 `[interop] enabled=false`。需要「对 Windows 侧也绝对隔离」的场景，本插件给不了。
- **两套 `/tmp`。** `workspace-write` 下命令看到的是临时 tmpfs，文件工具写的是发行版真实的 `/tmp`；两边都成功，但互相看不见。跨边界的文件要走会话工作区。
- **watch 优先 inotify，轮询回退。** 无界目录且装了 `inotify-tools` 时用递归 inotify，按 0.5s 合并为粗粒度失效；文件目标、限深目录或缺少工具时回退轮询，原地 `cp -p`、恢复目录 mtime 的解包等极端情形仍可能漏报。
- **文件名含反斜杠无法寻址**，因为 UNC 显示形式就是身份。改名是唯一工作法。
- **新文件发布为 0600**（宿主后端的发布语义）；需要可执行时自己 `chmod`。写入的发布对进程死亡持久，但不 fsync 父目录，机器崩溃可能丢 rename。
- **平台与版本。** 仅 Windows + WSL2；Node `^22.19.0 || >=24.0.0`；peer 与 harness 同步钉版，升级要跟着走。
- **不适合的情况。** 工作流本来就能整个装进 WSL 的 CLI；需要 VS Code 远程的编辑器能力（IntelliSense、调试器、扩展）；需要企业级强隔离或多租户；项目主要在 Windows 盘上（插件能用，但价值不在这里）。

这些不是「以后会修」的清单，而是设计边界：每一条都在 [LIMITATIONS.md](LIMITATIONS.md) 里写明原因。**把边界写清楚本身也是价值**——它让「没做到」不被误读成「已经做到」。

## 5. 价值如何被证明

| 层面 | 证据 |
|---|---|
| 每次提交 | `pnpm test`：风格、语法、构建逐字节一致、`tsc --noEmit`、单测全过 |
| 覆盖率 | `pnpm run test:coverage`，门限 85/84/70（行/分支/函数） |
| 真机 | 12 项探针（`test/probe/run-all-when-closed.sh --include-fs`），含沙箱边界演示、agent/one-shot 双路径对拍、文件基座、终端、选择器 |
| CI | Node 22 / 24 × Linux / Windows 跑 `pnpm test`；覆盖率在 Node 24 |
| 上游接缝 | peer 钉版逐字节比对，[PEER-PARITY.md](PEER-PARITY.md)、[upstream/promotion-map.md](upstream/promotion-map.md) |
| 行为承诺 | [REQUIREMENTS.zh.md](REQUIREMENTS.zh.md) 的 24 条登记与追溯矩阵 |

真机探针是手动步骤（托管 runner 没有 WSL 发行版），这是已记录的验证缺口（REQUIREMENTS 的 OI-2），不是隐性遗漏。

## 6. 决策规则

**装它，如果同时满足：**

1. 你在 Windows 上用 DeepSeek Harness 的 GUI；
2. 项目在 WSL2 发行版的 ext4 上，且你希望模型用 Linux 路径工作；
3. 你希望命令有边界，并且接受为它安装 bubblewrap。

**别装它，如果满足任意一条：**

- 你的工作流是一款能整个装进 WSL 的 CLI——直接装进去更简单；
- 你需要编辑器级远程能力（调试、IntelliSense、扩展）；
- 你需要对 Windows interop 也绝对隔离；
- 你的项目主要在 Windows 盘上，且不需要 Linux 工具链。

## 7. 证据索引

| 想知道 | 看 |
|---|---|
| 功能、安装、配置 | [README](../README.md) / [中文 README](README.zh.md) |
| 部件如何挂载、路径坐标、沙箱设计 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 不做什么、为什么 | [LIMITATIONS.md](LIMITATIONS.md) |
| 每个配置键 | [CONFIGURATION.md](CONFIGURATION.md) |
| 与 VS Code Remote-WSL 的 parity 审计 | [PARITY.md](PARITY.md) |
| 与上游 fsio 的逐字节合同 | [PEER-PARITY.md](PEER-PARITY.md) |
| 安全边界与上报渠道 | [SECURITY.md](../SECURITY.md) |
