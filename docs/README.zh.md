# dsh-plugin-wsl-env

[English](../README.md) · **中文**

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](../LICENSE)

这个插件让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 在 WSL 子系统里干活：模型的命令在子系统里执行，文件工具读写的是子系统的真实文件，文件夹选择器能打开子系统目录，GUI 终端开的也是子系统里的 shell。

**只支持 Windows + WSL2。** 安装只需一条命令，插件自身没有依赖。环境按会话生效：打开 Windows 文件夹的会话，用的还是原来的 Windows 工具。

[安装](#安装) · [使用](#使用) · [方案对比](#方案对比) · [配置](#配置) · [配方](#配方) · [架构](#架构) · [沙箱](#沙箱) · [常见问题](#常见问题) ·
[开发](#开发) · [文档](#文档)

## 安装

在 Windows 终端里执行这四条命令：

```powershell
dsh wsl --from-default-profile web --dump-config   # 1. 创建 profile（dsh 的一套命名配置），模板用 Web
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 2. 安装插件，配置自动带上
dsh --profile wsl --dump-config                    # 3. 快速检查：不启动，只看拼好的配置
dsh --profile wsl                                  # 4. 启动
```

第 3 步应该能看到一行 `# == dsh-plugin-wsl-env`——那就是插件的配置已经进了你的 profile。插件自带配置，第 2 步会自动接好，基本安装不需要手动改任何文件。

**第一条命令之前，先给子系统安装 bubblewrap。** 每条命令都运行在 bubblewrap 沙箱内，而多数子系统不预装它。缺失时，命令直接失败，不会脱箱运行：

```powershell
wsl.exe -d <子系统> -u root -- apt-get install -y bubblewrap    # Debian/Ubuntu
```

在插件检出目录里，`pnpm run bootstrap -- <子系统>` 检查插件用到的四个工具（bubblewrap、ripgrep、git、inotify-tools），并按子系统的包管理器打印安装命令；加 `--install` 直接执行。若跳过此步，会话打开时会报告缺失的包及确切的安装命令。

然后在 GUI 里打开一个 `\\wsl.localhost\<子系统>\...` 下的文件夹。选择器会列出每个已安装的子系统，**New terminal** 开的也是子系统里的 shell。

卸载：`dsh plugin --profile wsl remove dsh-plugin-wsl-env`。升级：再执行一次同样的 `add` 命令。

> **改了 `lib/` 下的文件？先同步，再重启应用。** 应用加载的是 Windows 侧那份代码副本，所以先跑 `pnpm run sync:windows`。不同步就重启，加载的还是旧代码；运行中的进程还会缓存模块。见[开发](#开发)。

## 使用

把一个子系统文件夹作为工作区打开——比如 `\\wsl.localhost\ubuntu\home\you\project`——然后问模型："我现在在什么内核上，`/etc/os-release` 里写了什么？" 它会在子系统里执行 `uname -r` 并读取这个文件。不复制文件，也不经过 `/mnt/c`。

- **子系统文件夹自动获得子系统环境。** 会话一打开子系统文件夹，就会被自动配上 WSL 环境。第一条命令就已经是对的。
- **命令在你期望的地方运行。** 命令在子系统里、用你自己的登录 shell 执行——所以你的 `PATH`、`nvm`、`cargo`、`pyenv` 和 rc 配置全部生效。shell 用的是子系统配置的那个，不是写死的 bash。
- **文件就是真实的文件。** `/home/you/x` 和 `\\wsl.localhost\ubuntu\home\you\x` 是同一个文件。`/mnt/c/...` 照常通向 Windows 磁盘。
- **终端也是。** 右侧栏 → *New terminal*：子系统里的 shell，落在会话所在目录。
- **端口可见性。** 模型能看到子系统内正在监听的端口（约每 10 秒刷新），并给出它启动的 dev server 的确切地址。WSL2 将 localhost 转发给 Windows，浏览器直接可访问。
- **权限和 Linux 主机一致。** 权限选择器有三档：`read-only`、`workspace-write`（默认）和 `danger-full-access`。有操作被拒绝时，模型会收到一次"用刚好够用的权限重试"的提议。只有 `danger-full-access` 是不带沙箱运行的。

## 方案对比

Windows 上的编程工具要在 WSL 项目上干活，一共三条路：

1. **把工具装进 WSL。** Codex CLI、Claude Code、ZCode CLI 的官方建议都是这条，而且没错——如果一款 CLI 能覆盖你的工作，它就是最简单的路。前提是整个工具都能搬进 WSL；DeepSeek Harness 搬不进去，所以只剩下面两条。
2. **桌面应用远程连进 WSL。** VS Code（Remote-WSL，开源镜像 [open-remote-wsl](https://github.com/jeanp413/open-remote-wsl)）和 [ZCode](https://github.com/zai-org/ZCode) 这类 agent 桌面端把应用留在 Windows，往子系统里装一个服务程序。很成熟。代价：服务目录（`~/.vscode-server`、`~/.zcode/server`）、一个端口，命令无沙箱。
3. **本插件。** Harness 留在 Windows。子系统内不安装任何内容、不监听端口，命令运行在 bubblewrap 沙箱内。缺失时，会话打开即报告缺失项与安装命令。

| | 第二条（桌面远程） | 第三条（本插件） |
|---|---|---|
| 往子系统里装了什么 | 一个服务目录 | 什么都不装 |
| 是否监听端口 | 是 | 否 |
| 命令沙箱 | 无 | bubblewrap |
| 卸载之后 | 手动删除服务目录 | 无残留 |
| WSL 升级出了问题 | 服务可能需要修复 | 下一条命令自动恢复 |

**各方案的取舍。** 桌面远程重开工作区是即时的——其服务常驻运行；VS Code 的远程有多年生产打磨。装进 WSL 的 CLI 不需要任何额外机制。本插件只针对一种场景：DeepSeek Harness 运行在 Windows 上，同时要求 WSL 内的工作在沙箱中执行。

## 配置

每个设置都挂在一个有名字的"行"上。想改哪个，就在 `$DSH_HOME/profiles/<名字>/cordis.patch.yml` 里加一行同 id 的覆盖。值得知道的键：

| 行 | 键 | 默认值 | 说明 |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | 用哪个子系统；空表示 WSL 的默认子系统 |
| | `sandbox` | `true` | 命令跑在 `bubblewrap` 沙箱里；`false` 关掉沙箱 |
| | `maskWindowsDrive` | `false` | 让沙箱里的命令看不到 `/mnt`，收窄互操作这个洞（只是收窄，关不死，见[沙箱](#沙箱)） |
| `wsl-fs` | `distro` | `''` | 同上 |
| | `restrictToDistro` | `true` | 拒绝属于**别的子系统**的路径（`/mnt/c` 属于本子系统，不受影响）。拒绝码是 `FS_OUTSIDE_DISTRO`，放宽权限也解不开 |
| | `sandbox` | `true` | 文件写入按同一份策略检查 |
| | `substrate` | `agent` | 文件操作如何到达子系统。只剩一种：子系统内的 agent，读写直接落在子系统自己的文件系统上（原生符号链接与权限位）。旧 `"share"` 选项走 9p 共享，启动时即被拒绝 |
| `directory-picker-wsl` | `includeHostHome` | `true` | 选择器里同时列出 Windows 家目录 |
| `subprocess-wsl` | `distro` | `''` | GUI 终端开在哪个子系统 |

`wsl-shell` 和 `wsl-fs` 这两行**按 id 覆盖不到**：它们嵌在 `wsl` preset 自己的配置里（preset 是 dsh 能发给会话的一套命名环境），在自己的覆盖文件里写 `- id: wsl-shell` 不会生效——loader 只会警告 `patch: entry "wsl-shell" not found`，实际值不变。要改，就把整个 `preset-wsl` 行复制过去改写；配方见 [docs/CONFIGURATION.md](CONFIGURATION.md#overriding-the-rows-inside-preset-wsl)。

[`cordis.patch.yml`](../cordis.patch.yml) 是每个随包值的注释参考。[docs/CONFIGURATION.md](CONFIGURATION.md) 列出其余键（`shell`、`loginShell`、`cwd`、`timeoutMs`、`preferredDistro`、`maxEntries` 等）；[examples/profile.cordis.patch.yml](../examples/profile.cordis.patch.yml) 是一份可以照抄修改的本机配置。

## 配方

- **让子系统里的 git 用 Windows 的已存凭据**：`git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"`（路径按你 Windows 侧 Git 的安装位置调整）。设置后，子系统里 `git push` 用的就是 Windows 保存的那份凭据，不用再输密码。
- **项目放在子系统的磁盘上。** 模型操作的是子系统自己磁盘上的 Linux 路径（`/home/...`），快。它也能通过 `/mnt/c` 访问 Windows 文件，但那条桥在大量小文件时明显慢。`pnpm run bootstrap <子系统>` 会告诉你 ripgrep、git、inotifywait（分别用于搜索和文件监视）装没装。
- **环境变量**：WSL 只转发 `WSLENV` 里点名的变量。本插件转发自己的 `DSH_*` 值，其中两个装着 Windows 路径的（`DSH_HOME`、`DSH_PROFILE_DIR`）会被翻译成 Linux 路径。你的 `PATH` 永远不转发——转发了会盖住子系统自己的 PATH。

## 架构

一个 DSH 进程可以同时服务两类会话：工作区在 Windows 目录的，和工作区在子系统里的。插件的部件分两层放置，原因很简单——有的东西属于某一个会话，有的属于整个应用：

```text
组合层（composition，每个进程一份）
├─ subprocess-wsl        GUI 终端的执行环境
│                          子系统目录会话   → 子系统 shell，落在会话的 Linux 目录
│                          Windows 目录会话 → powershell.exe，落在会话自己的目录
├─ directory-picker-wsl  在 Windows 家目录旁列出已安装的子系统
├─ workspace-files-wsl   子系统工作区的 GUI 文件树与预览，由子系统内部提供
├─ fs-routing            根级文件系统，按路径坐标分流
│                          子系统 UNC → 常驻助手；盘符路径 → 宿主原生后端
├─ wsl-shell-env         向模型暴露 DSH_WSL_DISTRO / _SHELL / _HOME / _PORTS
└─ auto-preset           会话打开子系统目录时，自动绑定 wsl preset

preset-wsl（wsl agent preset；这个环境里的服务相互独立）
├─ wsl-shell   ctx.shell — wsl.exe --exec <登录 shell>，在子系统内经 bubblewrap 约束
└─ wsl-fs      ctx.fs    — 子系统的真实文件，经常驻助手落在 ext4
```

**为什么分两层。** `wsl-shell` 和 `wsl-fs` 是随会话变化的两件事，所以放在 `wsl` preset 里：会话打开子系统目录时，`auto-preset` 给它绑上这个 preset；打开 Windows 目录的会话继续用原生 Windows 工具。一个进程，每个会话各有各的环境。GUI 终端是例外：它读的是应用层的配置，永远看不到 preset，所以 `subprocess-wsl` 挂在应用层。GUI 文件树和根级文件系统正好反过来——每个会话都用它们，单个 preset 拥有不了——所以 `workspace-files-wsl` 和 `fs-routing` 也挂在应用层。它们替换了随包的两行；根级路由的设计见 [docs/root-fs-routing.md](root-fs-routing.md)。

**命令的执行路径。** 命令通常由一个常驻子系统内的 agent 进程执行（每个子系统一个）。agent 在你的登录 shell 中、bubblewrap 沙箱内运行命令并回传输出。agent 不可用时（或设了 `agent: false`），同一条命令改由新开的 `wsl.exe` 进程执行——结果一致，开销略高。

**文件操作的执行路径。** 读、写、搜索同样发生在子系统内部：使用子系统自己的磁盘与工具。子系统工作区的搜索运行子系统内的 `rg`，不使用 Windows 侧副本走 9p 共享。文件写入与命令沙箱使用同一份策略检查。

## 沙箱

命令跑在子系统内的 `bubblewrap` 沙箱里，文件写入按同一份策略检查。Windows 自带的沙箱在这里用不上：它的受限账户根本连不到 WSL。

| 模式 | 子系统里的命令可以做什么 |
|---|---|
| `read-only` | 整个子系统只读；会挂一个新建的 `/dev`，`/dev/null` 和 `/dev/shm` 可用，其余不可写 |
| `workspace-write` | 上面全部，加上会话工作区可写，`/tmp` 是临时目录 |
| `danger-full-access` | 不加沙箱；用于你批准的放宽权限请求 |

**bubblewrap 是必需项，缺了就宁可不做。** 没有它，每条受限命令都报 `SANDBOX_UNAVAILABLE`——命令不会脱着沙箱运行。想关掉沙箱，在管这件事的行上设 `sandbox: false`：命令归 `wsl-shell`，文件写入归 `wsl-fs`，根级写入归顶层的 `fs-routing`（应用自己用的那套文件系统）。（前两行要经 `preset-wsl` 改，见[配置](#配置)。）关掉后，模型会如实收到"这些操作没有沙箱"的说明。

**已知边界。** 子系统内的命令仍可启动 Windows 程序（`/mnt/c/.../*.exe`），bubblewrap 不覆盖 Windows 进程。`pnpm run probe:sandbox` 会在你的机器上演示这条边界。在三个行上设 `maskWindowsDrive: true` 能收窄它：`/mnt` 会从命令的视野里消失，Windows 磁盘的文件读不到、程序启动不了。但并未完全关闭——命令仍可将 Windows 程序复制进工作区后运行——因此上报仍为 `partial`。彻底关闭的方法在子系统层面：`wsl.conf` 里设 `[interop] enabled=false`（见 [docs/CONFIGURATION.md](CONFIGURATION.md)）。

设计见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#sandbox)，插件不做的事情见 [docs/LIMITATIONS.md](LIMITATIONS.md)。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 每条命令都报 `SANDBOX_UNAVAILABLE` | 子系统里没有 `bubblewrap`，或者装了但坏的——错误消息会告诉你是哪种、该怎么办 | 按错误消息里的指引处理，或 `pnpm run bootstrap -- <子系统> --install`，或在 `wsl-shell`（命令）与 `wsl-fs`（写入）上都设 `sandbox: false`（根级写入的 `fs-routing` 行另有一份；前两行怎么改见[配置](#配置)） |
| 命令或写入在会话目录外被拒绝 | 正常现象：`workspace-write` 只允许写会话目录 | 接受工具给出的放宽权限提示，或把会话开在你需要的目录上 |
| 会话目录内的写入也被拒绝 | 会话处于 `read-only` 模式 | 切换权限选择器 |
| 重复执行 `dsh plugin add` 没有任何输出，`--dump-config` 也没变化 | 插件已经装过了，没有新东西可报告——这是成功，不是失败 | 不用做任何事：层已经就位，`dsh --profile wsl --dump-config` 仍能看到 `# == dsh-plugin-wsl-env` |
| 终端打开后还是 `cmd.exe` | 这一层里的 `terminal-controller` 行没有生效 | 用 `dsh --profile wsl --dump-config` 确认能看到 `shell: { path: wsl.exe, name: WSL }` |
| 改了 `lib/` 但不生效 | 应用跑的是 Windows 侧那份代码副本，运行中的进程还会缓存模块 | 先 `pnpm run sync:windows` 更新副本，再重启应用 |
| 用 `link:\\wsl.localhost\...` 安装后符号链接是坏的 | pnpm 无法链接 UNC 路径 | 改链接 Windows 路径；在子系统里开发请用运行时镜像，见[开发](#开发) |
| `glob`/`grep` 很慢 | 子系统里没装 `rg`；Windows 目录的搜索不受影响 | 运行 `pnpm run bootstrap -- <子系统> --install`（装 ripgrep）；子系统工作区的搜索永远用子系统里的 rg，不走慢桥 |
| 终端活动显示 `unknown` | 仅在子系统内 agent 暂时不可用时出现——distro 终端是从子系统内部观察的（`/proc` 里扫 `DSH_TERMINAL_ID` 标记：只有 shell 是 `idle`，在跑任何命令是 `busy`） | 确认子系统在运行；空闲终端会在控制器的空闲超时（默认 2 小时）后自动关闭，`terminalIdleReclaim: false` 可以改成手动关 |
| 结果里出现 `FS_*` 码 | 码本身说明了是谁拒绝的、怎么解除 | 见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#error-codes) 的错误码表 |

## 开发

```bash
pnpm run build                # 从 src/ 生成 lib/（产物提交进仓，改了 src/ 必须重新构建）
pnpm test                     # 风格、语法、构建一致性、类型检查、单元测试
pnpm run sync:windows         # 把检出复制到应用加载的 Windows 侧副本（改 lib/ 后必跑，再重启应用）
pnpm run test:coverage        # 带覆盖率阈值的单元测试（需 Node 22.8+）
pnpm run diagnose             # 只读诊断报告（可直接贴进 issue）：版本、工具、bwrap 探测
pnpm run bootstrap -- <子系统> # 检查四个子系统侧工具；加 --install 安装缺失项
pnpm run probe:sandbox        # 在子系统里实测 bubblewrap 能管什么、管不了什么
pnpm run probe                # 文件系统探针，需要真实子系统（仅 Windows + WSL）
pnpm run probe:sandbox-shell  # 启动真实 harness，驱动受限执行器
pnpm run probe:terminal       # 通过终端 provider 打开一个 PTY
pnpm run probe:substrate      # 用真实 wsl.exe 驱动文件助手（在子系统内运行）
pnpm run probe:watch          # 在真实目录上装子系统内监视器（在子系统内运行）
pnpm run probe:agent          # 常驻路径与回退路径的对比（在子系统内运行）
pnpm run probe:exec           # agent 执行：超时、杀停、cwd 失败（在子系统内运行）
pnpm run probe:missing-wsl    # 启动一个 wslPath 无法启动的 profile（仅 Windows + WSL）
pnpm run probe:picker         # 列出选择器的根级、拒绝路径与上限（仅 Windows + WSL）
pnpm run probe:mode           # 哪些 POSIX 权限信息能穿过共享层（需 Windows node 与已装的 harness，不启动 profile）
pnpm run probe:sandbox-off    # 验证 sandbox: false 确实关掉两侧沙箱（仅 Windows + WSL）
```

应用跑的是 Windows 侧的代码副本，不是你的检出。改了 `lib/` 下任何文件，先 `pnpm run sync:windows` 再重启应用——否则重启加载的还是旧代码。`pnpm run build` 负责从 `src/` 生成 `lib/`；产物提交进仓，`pnpm test` 会检查两者一致。

首次运行前 `pnpm install` 一次装好开发依赖。测试用到钉版的 `@deepseek-ai/*` 包；插件本身发布时不带任何依赖。CI 在 Linux 和 Windows 上用 Node 22、24 跑测试，Node 24 另跑覆盖率。

[docs/ARCHITECTURE.md](ARCHITECTURE.md) 有文件布局、挂载方式和沙箱设计；[CONTRIBUTING.md](../CONTRIBUTING.md) 有开发循环、镜像、完整质量门清单和已验证内容。

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
