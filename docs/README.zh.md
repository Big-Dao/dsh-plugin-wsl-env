# dsh-plugin-wsl-env

[English](../README.md) · **中文**

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](../LICENSE)

这个插件让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 把 WSL 子系统当作工作环境：命令在子系统里执行，模型的文件工具读写子系统里的真实文件，文件夹选择器可以直接打开子系统目录，GUI 终端也开在子系统里。

**只支持 Windows + WSL2。** 安装只需一条命令，插件自身没有依赖。环境按会话生效：打开 Windows 文件夹的会话继续使用原来的 Windows 环境。

[安装](#安装) · [使用](#使用) · [方案对比](#方案对比) · [配置](#配置) · [配方](#配方) · [架构](#架构) · [沙箱](#沙箱) · [常见问题](#常见问题) ·
[开发](#开发) · [文档](#文档)

## 安装

在 Windows 终端里执行这四条命令：

```powershell
dsh wsl --from-default-profile web --dump-config   # 1. 用 Web 模板创建 profile
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 2. 安装代码和配置层
dsh --profile wsl --dump-config                    # 3. 只做组合检查，不启动（最快）
dsh --profile wsl                                  # 4. 启动
```

第 3 步应该打印出名为 `# == dsh-plugin-wsl-env` 的层，并且 `- id: terminal-controller` 上应出现 `shell: { path: wsl.exe, name: WSL }`。这个包是 DSH bundle，所以第 2 步会把 [`cordis.patch.yml`](../cordis.patch.yml) 作为配置层施加进去，没有任何需要手工合并的补丁。

**第一条命令之前，先给子系统装上 bubblewrap。** 每条命令都由 [bubblewrap](#沙箱) 约束执行，而多数子系统不预装它；没有它每条命令都会失败关闭——这是设计，绝不放行为不受限执行：

```powershell
wsl.exe -d <子系统> -u root -- apt-get install -y bubblewrap    # Debian/Ubuntu
```

在本插件的检出目录里，`pnpm run bootstrap -- <子系统>` 会检查插件用到的全部四个工具（bubblewrap、ripgrep、git、inotify-tools），并按子系统自己的包管理器家族打印对应的安装命令；加 `--install` 则直接执行（`bootstrap` 是包内 pnpm 脚本，需要 `pnpm` 与 `bash`）。漏了这一步它会自己找上门：distro 会话打开时插件会探测 bubblewrap 并带完整修复指引发出警告——第一条命令不必再充当发现时刻。

然后在 GUI 里打开 `\\wsl.localhost\<子系统>\...` 下的文件夹。选择器会在根一级列出每个已安装的子系统，**New terminal** 会在子系统里打开 shell。

卸载：`dsh plugin --profile wsl remove dsh-plugin-wsl-env`。升级：再执行一次同样的 `add` 命令。

> **改了 `lib/` 下的任何文件？先 `pnpm run sync:windows`，再重启应用。** 应用加载的是 Windows 侧运行时镜像，不先同步，重启也只是重新载入旧代码；运行中的进程还会缓存 ES module。

## 使用

把 `\\wsl.localhost\ubuntu\home\you\project` 作为工作区打开，然后问模型"我在什么内核上，`/etc/os-release` 里有什么"。它会在子系统里执行 `uname -r` 并读取该文件，不经过 `/mnt/c`，也不复制文件。

- **子系统文件夹自动获得子系统环境。** 创建会话时就会绑定 `wsl` preset，所以第一次工具调用就已经正确。
- **命令**在子系统里由你的登录 shell 执行，所以 `PATH`、`nvm`、`cargo`、`pyenv` 和 rc 配置都生效；shell 不是硬编码的 bash。默认走常驻子系统内代理（每个子系统一个长驻进程）；代理不可用时（或设了 `agent: false`）同一条命令回退为一次性 `wsl.exe -d <子系统> --cd <Linux 目录> --exec <你的登录 shell> -lc <命令>` 进程。
- **文件就是子系统的真实文件。** `/home/you/x` 与 `\\wsl.localhost\ubuntu\home\you\x` 是同一个文件，`/mnt/c/...` 通向 Windows 磁盘。
- **终端**（右侧栏 → *New terminal*）在子系统里打开会话目录下的 shell。
- **端口可见性**：子系统里监听中的端口经 `DSH_WSL_PORTS` 暴露给模型（约每 10 秒刷新）；子系统内启动的 dev server 可由模型直接告知确切 URL（WSL2 的 localhost 转发是平台行为，Windows 侧直接可达）。
- **模型能看到自己的 shell 环境。** 插件向受管的 `DSH_*` 命名空间注册 `DSH_WSL_DISTRO`、`DSH_WSL_SHELL`、`DSH_WSL_HOME` 和端口快照 `DSH_WSL_PORTS`。
- **权限与 Linux 主机一致。** 权限选择器在 `read-only`、`workspace-write`（默认）和 `danger-full-access` 之间切换。被拒绝的命令或写入会带回"放宽权限"的提议；批准后，这一次调用不加沙箱执行。

## 方案对比

Windows 编程工具对 WSL 项目做的每件事都要跨一条边界，业界给出三种形态，本插件是第三种。

**把工具装进子系统。** Codex CLI、Claude Code、ZCode CLI 在 Windows 上的官方建议正是如此：CLI 住在项目所在的地方，边界根本不存在。如果一款 CLI 工具能覆盖你的工作流，它仍是最简单的正确答案——本插件不与它竞争。它不适用于"界面与执行都在 Windows 侧"的 harness，而那正是本插件服务的场景。

**由桌面端铺设远程 runtime。** IDE 的答案——VS Code 的 Remote-WSL 及其开源镜像 [open-remote-wsl](https://github.com/jeanp413/open-remote-wsl)——与 agent 桌面端的答案——[ZCode](https://github.com/zai-org/ZCode) 的 SSH/WSL/Docker 模式——都把界面留在 Windows，在子系统里启动一个 server。两者都是成熟可用的设计，但架构在用户可感知的地方不同：

| | Remote-WSL 家族 | ZCode 桌面端 | 本插件 |
|---|---|---|---|
| 通道 | TCP 走 WSL2 localhost 转发，token 鉴权 | 一根 `wsl.exe` stdio 管道 | 一根 `wsl.exe` stdio 管道 |
| 目标侧足迹 | `~/.vscode-server`——每个构建一个 daemon，跨连接保留 | `~/.zcode/server`——node 运行时、server bundle 与 agent，跨连接复用 | 无：agent 脚本就是安装包自己的文件，每次握手都校验摘要 |
| 进程生命周期 | daemon 比连接活得久 | 前台 server，随连接消亡 | 宿主进程拥有的常驻 agent，空闲自退休，失败自重建或回退 |
| 沙箱 | 无 | 无 | 子系统内的 `bubblewrap`，enforcement 如实上报为 `partial` |
| 卸载残留 | server 目录树，需手动清理 | server 目录树，需手动清理 | 无 |

**这种形态带给 DSH 用户的是：** 没有监听端口、没有 token——管道不携带任何地址，TCP 形态的著名故障（localhost 转发失效）在这里无从发生；没有需要供给、追版本、清理的 server 目录树；每条受限命令都有隔离，且 `bubblewrap` 缺失时会在会话打开时就收到带修复指引的警告；工作区是 Windows 文件夹的会话完全不进入这一切——环境属于会话，不属于进程。

**别人赢的地方也照实说。** daemon 让工作区重开即达、可跨窗口共享；Remote-WSL 五年的生产打磨是本插件拿不出来的；ZCode 自带的代理翻译与服务管道是本插件不需要的；而装进子系统的 CLI 根本不需要这套机器。这里的比较说的是 Windows 侧 harness 可以采用的架构——不是产品之间的比较：本插件只存在于 DeepSeek Harness 会话之中。

## 配置

在自己的 profile 层里按 id 覆盖某一行：`$DSH_HOME/profiles/<名字>/cordis.patch.yml`。值得知道的键：

| 行 | 键 | 默认值 | 说明 |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | 子系统名；空表示用 WSL 的默认子系统 |
| | `sandbox` | `true` | 用 `bubblewrap` 约束命令；`false` 表示不用沙箱 |
| | `maskWindowsDrive` | `false` | 用空 tmpfs 遮蔽 `/mnt`，收窄 interop 洞（`wsl-fs`、`fs-routing` 上同名）；只是收窄、不是关闭，见[沙箱](#沙箱) |
| `wsl-fs` | `distro` | `''` | 同上 |
| | `restrictToDistro` | `true` | 拒绝指向**其它子系统**共享的路径；`/mnt/c` 属于本子系统内部，不受影响。拒绝码为 `FS_OUTSIDE_DISTRO`，它不是沙箱拒绝，放宽权限也无法解除 |
| | `sandbox` | `true` | 写入时按策略检查 `writeText` 和 `editText` |
| | `substrate` | `agent` | 文件工具使用哪种 I/O 基座。只剩常驻子系统内代理一种：读写与路径解析直接在 ext4 上完成（原生符号链接、原生权限位，写入 guard 存活到发布时刻，受限策略下由内核强制）。原 `"share"` 退出项——Windows 侧宿主文件栈走 9p 共享——已在启动时拒绝，文件工具不再经过共享 |
| `directory-picker-wsl` | `includeHostHome` | `true` | 同时列出 Windows 家目录 |
| `subprocess-wsl` | `distro` | `''` | GUI 终端开在哪个子系统 |

`wsl-shell` 与 `wsl-fs` 恰恰是**按 id 覆盖不到**的两行：它们是 `wsl` agent preset 的插件，嵌在 `preset-wsl` 行的 `config.plugins` 里，所以在自己的层里写 `- id: wsl-shell` 不会生效——loader 只会警告 `patch: entry "wsl-shell" not found`，实际值仍是随包的那份。要改就整块改写 `preset-wsl` 行；配方见 [docs/CONFIGURATION.md](CONFIGURATION.md#overriding-the-rows-inside-preset-wsl)。

[`cordis.patch.yml`](../cordis.patch.yml) 是每个随包值的注释参考。[docs/CONFIGURATION.md](CONFIGURATION.md) 列出其余键，包括 `shell`、`loginShell`、`cwd`、`timeoutMs`、`preferredDistro` 和 `maxEntries`；[examples/profile.cordis.patch.yml](../examples/profile.cordis.patch.yml) 是一份可照抄的本机层。

## 配方

- **Git 凭据共享**：让子系统里的 git 使用 Windows 侧的 Git Credential Manager，避免每次输密码：
  `git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"`
  （路径按 Windows 侧 Git 的安装位置调整。）
- **路径与性能**：模型看到并操作的是子系统内的 Linux 路径（`/home/...`），写入子系统自身的 ext4；`/mnt/c` 通向 Windows 磁盘但走 9p，大批量小文件操作明显慢——重 IO 的项目请放在子系统文件系统内。`pnpm run bootstrap <子系统>` 会一并报告 ripgrep、git、inotifywait（搜索、快照与监视的后端）是否就位。
- **WSLENV 透传**：WSL 只导入 `WSLENV` 中列出的变量。本插件按前缀放行托管的 `DSH_*` 命名空间，其中带 Windows 路径的两个（`DSH_HOME`、`DSH_PROFILE_DIR`）加 `/p` 让 WSL 翻译成 `/mnt/c/...`。`PATH` 故意不透传——否则 Windows 的 PATH 会覆盖子系统自身的 PATH。

## 架构

一个 DSH 进程同时服务两类会话：工作区开在 Windows 目录的，和工作区在子系统内的。能做到这一点，是因为 provider 分两层挂载：

```text
组合层（composition，每个进程一份）
├─ subprocess-wsl        GUI 终端的执行世界
│                          子系统目录会话   → 子系统 shell，落在会话的 Linux 目录
│                          Windows 目录会话 → powershell.exe，落在会话自己的目录
├─ directory-picker-wsl  在 Windows 家目录旁列出已安装的子系统
├─ workspace-files-wsl   GUI 文件树与预览由子系统内提供，供子系统工作区使用
├─ fs-routing            根级文件系统，按坐标路由
│                          子系统 UNC → 常驻代理；盘符路径 → 宿主后端
├─ wsl-shell-env         向模型暴露 DSH_WSL_DISTRO / _SHELL / _HOME / _PORTS
└─ auto-preset           会话打开子系统目录时自动绑定 wsl preset

preset-wsl（wsl agent preset；其服务运行在 isolate realm 内）
├─ wsl-shell   ctx.shell — wsl.exe --exec <登录 shell>，在子系统内经 bubblewrap 约束
└─ wsl-fs      ctx.fs    — 子系统的真实文件；常驻代理基座落在 ext4
```

**为什么分两层。** `wsl-shell` 和 `wsl-fs` 位于 `wsl` agent preset 内，`auto-preset` 在会话工作区位于子系统内时自动绑定它：Windows 目录的会话继续使用原生 provider，子系统会话拿到 WSL provider——环境是会话的属性，而不是进程的。终端控制器是例外：它经根上下文解析执行世界，永远看不到 preset 的 isolate realm，所以 `subprocess-wsl` 必须挂在组合层。反过来，`workspace-files-wsl` 与 `fs-routing` 挂在组合层是同样的道理：GUI 文件树与根级 `ctx.fs` 没有会话，无法从 preset 内提供服务。二者直接替换随包的 `workspace-files` 与根级 `fs-sandbox` 行；根级路由的设计见 [docs/root-fs-routing.md](root-fs-routing.md)。

**命令与文件。** 默认情况下命令走常驻子系统内代理——每个子系统一个长驻进程，cwd 随请求下发，不再逐命令 `--cd`。它执行的仍是 `<登录 shell> -lc <命令>`，外层是子系统内的 bubblewrap profile，参数与 DSH 自家 Linux runner 完全一致——约束语义与报错文案都和 Linux 主机相同；代理不可用时（或设了 `agent: false`）回退为一次性 `wsl.exe -d <子系统> --cd <Linux 目录> --exec <登录 shell> -lc <命令>` 进程。文件工具读写子系统的真实文件，基座只有常驻子系统内代理一种——读写与路径解析落在 ext4，原生符号链接与权限位；文件搜索的 spawn 以同样的方式改写：子系统工作区的搜索跑子系统自己的 `rg`（`wsl.exe --exec`），绝不让 Windows 侧二进制走 9p 共享。写入与命令沙箱使用同一份策略检查。

## 沙箱

命令由**子系统内的 `bubblewrap`** 约束，文件写入按同一份策略检查。Windows ACL 沙箱在这里用不了：它的受限令牌完全到不了 WSL。

| 模式 | 子系统里的命令可以做什么 |
|---|---|
| `read-only` | 整个子系统只读；`/dev` 是新建的可写挂载（`/dev/null` 与 `/dev/shm` 可用），其余不可写 |
| `workspace-write` | 在上一行基础上，把会话工作区绑定为可写，并把 `/tmp` 挂成临时目录 |
| `danger-full-access` | 不加沙箱；用于批准后的放宽权限请求 |

**bubblewrap 是必需项，缺失即失败关闭。** 没有它时，每条受限命令都报 `SANDBOX_UNAVAILABLE`，而不是不受约束地运行。要退出约束：把 `sandbox` 设为 `false` 的行要选对——命令归 `wsl-shell`，写入栅栏归 `wsl-fs`，根级路由的 `fs-routing` 行另有自己的一份；注意前两行要经 `preset-wsl` 整块改写，按 id 改不到（见[配置](#配置)）。工具层会如实告诉模型这些操作没有沙箱。

**上报的强制程度是 `partial` 而不是 `full`。** 子系统里的进程仍可经 WSL interop 执行 Windows 程序（例如 `/mnt/c/.../*.exe`），bubblewrap 管不到它。`pnpm run probe:sandbox` 会在你的机器上演示这条边界。

`maskWindowsDrive`（在 `wsl-shell`、`wsl-fs` 与 `fs-routing` 三个行上，默认 `false`）是这套 profile 能给出的唯一收窄手段：它为每个受限 profile 用空 tmpfs 遮蔽 `/mnt`，Windows 磁盘上的文件读不到也带不走，其上的可执行文件也无法经 interop 启动；但这只是收窄而非关闭——命令仍可把可执行文件写进工作区再运行（`binfmt` 按内容分发），所以 enforcement 仍是 `partial`，结果里如实上报 `windowsDrive: "masked"`。完全关闭是子系统级的：`wsl.conf` 里的 `[interop] enabled=false`，见 [docs/CONFIGURATION.md](CONFIGURATION.md)。

设计见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#sandbox)，插件不做的事情见 [docs/LIMITATIONS.md](LIMITATIONS.md)。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 每条命令都报 `SANDBOX_UNAVAILABLE` | 子系统里没有 `bubblewrap`（或存在但不可用，错误消息会区分这两种情况并给出对应处置） | 按 `wsl-shell`（命令）与 `wsl-fs`（写入）错误消息里的指引安装，或 `pnpm run bootstrap -- <子系统> --install`，或在两个 provider 上都设 `sandbox: false`（根级路由的 `fs-routing` 行另有自己的一份；前两行怎么改见[配置](#配置)） |
| 命令或写入在会话目录之外被拒绝 | `workspace-write` 的预期行为 | 接受工具给出的放宽权限提示，或把会话直接开在需要的目录上 |
| 连工作区内的写入也被拒绝 | 会处在 `read-only` 模式 | 切换权限选择器 |
| 重复执行 `dsh plugin add` 没有任何输出，`--dump-config` 里也没有变化 | 依赖之前已经装过；`add` 对已存在的依赖是静默 no-op，没有需要记录的内容 | 无需任何操作——层已经就位，`dsh --profile wsl --dump-config` 仍能看到 `# == dsh-plugin-wsl-env` |
| 终端打开后仍然是 `cmd.exe` | 这一层里的 `terminal-controller` 行没有生效 | 用 `dsh --profile wsl --dump-config` 确认能看到 `shell: { path: wsl.exe, name: WSL }` |
| 改了 `lib/` 但不生效 | 应用加载的是 Windows 侧运行时镜像，且运行中的进程会缓存 ES module | 先 `pnpm run sync:windows` 同步到镜像，再重启应用 |
| 用 `link:\\wsl.localhost\...` 安装后符号链接是坏的 | pnpm 无法链接 UNC 路径 | 改成链接 Windows 路径；在子系统内开发时用运行时镜像，见[开发](#开发) |
| `glob`/`grep` 很慢 | 子系统内没有 rg 时，搜索只能报 rg 自己的 "command not found"；Windows 目录的搜索走宿主原生 rg，不受影响 | 运行 `pnpm run bootstrap -- <子系统> --install`（安装 ripgrep）；子系统工作区的搜索始终跑子系统内的 rg，绝不遍历 9p 共享 |
| 终端活动显示 `unknown` | 仅在常驻代理不可用时出现——distro 终端从子系统内部观测（`/proc` 中扫描 `DSH_TERMINAL_ID` 标记：shell 独处为 `idle`，运行任何命令为 `busy`） | 确认子系统在运行；空闲终端会在控制器的无人值守超时（默认 2 小时）后自动回收，`terminalIdleReclaim: false` 恢复手动关闭 |
| 结果里出现 `FS_*` 码 | 码本身说明了是谁拒绝的、以及怎样解除 | 见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#error-codes) 的错误码表 |

## 开发

```bash
pnpm run build                # 从 src/ 生成 lib/（产物提交进仓，改 src/ 后必须重新构建）
pnpm test                     # 风格、语法、构建一致性、类型检查与单元测试
pnpm run sync:windows         # 把 lib/ 同步到 Windows 侧运行时镜像（改 lib/ 后必跑，再重启应用）
pnpm run test:coverage        # 带覆盖率阈值的单元测试（需 Node 22.8+）
pnpm run diagnose             # 只读诊断报告（可直接贴进 issue）：版本、工具、bwrap 探测
pnpm run bootstrap -- <子系统> # 检查四个子系统侧工具；加 --install 安装缺失项
pnpm run probe:sandbox        # 在子系统里实测 bubblewrap 能约束什么、不能约束什么
pnpm run probe                # 文件系统探针，需要真实子系统（仅 Windows + WSL）
pnpm run probe:sandbox-shell  # 启动真实 harness，驱动受限执行器
pnpm run probe:terminal       # 通过终端 provider 打开一个 PTY
pnpm run probe:substrate      # 用真实 wsl.exe 传输驱动 agent 文件基座（在子系统内运行）
pnpm run probe:watch          # 在真实目录上装上 distro 内轮询 watcher（在子系统内运行）
pnpm run probe:agent          # resident 与 one-shot 的回退不变量对比腿（在子系统内运行）
pnpm run probe:exec           # agent 执行句柄：超时、杀停、cwd 失败（在子系统内运行）
pnpm run probe:missing-wsl    # 启动一个 wslPath 无法启动的 profile（仅 Windows + WSL）
pnpm run probe:picker         # 列出选择器的根级、拒绝路径与上限（仅 Windows + WSL）
pnpm run probe:mode           # 哪些 POSIX 权限事实能穿过共享层（需 Windows node 与已安装的 harness，不启动 profile）
pnpm run probe:sandbox-off    # 验证 sandbox: false 确实解除两侧约束（仅 Windows + WSL）
```

应用加载的是 Windows 侧运行时镜像，不是仓库检出：改了 `lib/` 要先 `pnpm run sync:windows` 同步过去，再重启应用才会生效（`pnpm run build` 负责从 `src/` 生成 `lib/`，`pnpm test` 里的构建一致性检查会校验它）。首次运行前先 `pnpm install` 一次，复原钉版的开发依赖：测试会 import 钉版的 `@deepseek-ai/*` 包（组合与启动测试跑的是 loader 的真实 patch 算法），运行时包本身仍然保持零依赖。pnpm 由 `packageManager` 字段解析，任何开了 corepack 的 Node 都能直接用。CI 在 Linux 和 Windows 上用 Node 22、24 运行 `pnpm test`，并在 Node 24 上运行 `pnpm run test:coverage`；`engines` 与 harness 宿主自身的下限（`^22.19.0 || >=24.0.0`）保持一致。

[docs/ARCHITECTURE.md](ARCHITECTURE.md) 有文件布局、挂载方式和沙箱设计；[CONTRIBUTING.md](../CONTRIBUTING.md) 有开发循环、运行时镜像、完整质量门清单和已验证内容。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/CONFIGURATION.md](CONFIGURATION.md) | 每个配置键，以及如何覆盖 |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | provider、挂载方式、路径坐标、沙箱、测试分层、文件布局 |
| [docs/LIMITATIONS.md](LIMITATIONS.md) | 插件不做的事情，以及原因 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 开发循环、质量门、约定、已验证内容 |
| [SECURITY.md](../SECURITY.md) | 如何私下上报漏洞 |
| [SUPPORT.md](../SUPPORT.md) | 支持范围，以及去哪里提问 |
| [docs/RELEASING.md](RELEASING.md) | 发布检查单 |
| [docs/archive/README.en.md](archive/README.en.md) | 归档工程记录的英文索引 |

## 许可

MIT，见 [LICENSE](../LICENSE)。
