# dsh-plugin-wsl-env

[English](../README.md) · **中文**

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](../LICENSE)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，让会话在 Windows 的 WSL 2 发行版中运行。

Harness 进程仍在 Windows 上。命令、文件操作、文件夹选择器和 GUI 终端都使用发行版环境。发行版内不安装辅助服务或守护进程，也不开放端口，受限命令在 `bubblewrap` 中运行。

仅支持 Windows + WSL 2。

## 为什么用这个插件

Windows 上的编程工具要在 WSL 项目中工作，有三条路：把整个工具装进发行版、连接发行版内的辅助服务，或由插件直接提供发行版环境。本插件是第三条。两类会话共用一套流程，同时保留发行版的真实工具和命令沙箱。

- **真实的 Linux 环境。** 命令在发行版自己的登录 shell 中运行，`PATH`、`nvm`、`cargo`、`pyenv` 和 rc 文件都生效。文件工具直接读写发行版 ext4 上的真实文件。
- **发行版内没有服务。** 没有辅助服务、没有守护进程、没有监听端口。唯一持久化的内容是 `~/.cache/dsh-wsl/agent/` 下按内容寻址的原生 agent 副本。
- **默认有沙箱。** 受限命令在发行版内的 `bubblewrap` 中运行。缺少 `bubblewrap` 时命令直接失败，不会脱箱运行。
- **按会话生效。** 打开发行版文件夹的会话获得发行版环境；打开 Windows 文件夹的会话保留 Windows 工具。两者可同时运行在一个 harness 进程中。
- **与 GUI 集成。** 文件夹选择器列出已安装的发行版，终端在发行版内打开 shell，模型能看到监听端口。

### 为什么是 Linux，而不是 PowerShell

多数编程 agent 的训练材料以 Linux 为主，开源工具链也大多先在 Linux 上构建和测试。让 agent 在 Windows shell 里工作，等于要求它在每次调用时做一层翻译：

- **训练先验。** 示例、CI 脚本、Dockerfile 和大多数公开答案用的是 POSIX shell 和 GNU 工具；模型的第一反应是 `bash`，不是 PowerShell。
- **工具链支持。** Node、Python、Rust、Go、C/C++ 和多数构建系统先在 Linux 上验证。Windows 支持往往是移植，引号、路径、换行和文件锁都不一样。
- **Shell 语义。** PowerShell 和 `cmd` 在引号、转义、管道、环境变量、退出码和路径分隔符上都与 POSIX 不同。混用两套语法，很容易产生看起来像模型犯的低级错误。
- **环境漂移。** Windows 侧的 PowerShell 版本、执行策略、PATH 和已装工具因人而异；Linux 环境更容易复现和容器化。

结果是更多失败的命令、更多重试，以及更多时间花在语法而不是任务上。生成的代码也一样：shell 片段、构建命令和 CI 风格的一行命令通常按 POSIX 编写，发行版才是它们原样运行的地方。真实的 Linux 登录 shell 去掉了这层翻译。现代 PowerShell 和 Windows 原生工具在缩小差距，但默认先验和多数项目脚本仍然假设 POSIX。

本插件把 GUI 留在 Windows，只把执行环境移进发行版，让 agent 得到它的训练和工具链都假设的那个 shell。

## 方案对比

| | 桌面远程（VS Code、ZCode） | 本插件 |
|---|---|---|
| 发行版内 | 辅助服务 | 一个缓存的 agent 可执行文件 |
| 网络 | 监听端口 | 无 |
| 命令沙箱 | 无 | `bubblewrap` |
| 卸载 | 删除服务 | 删除缓存 |

桌面远程重连更快、更成熟。如果 CLI agent 能覆盖你的工作，直接装进 WSL 更简单。本插件面向的场景是：harness 留在 Windows，同时要求命令有沙箱。

## 要求

- Windows 10 或 11，启用 WSL 2，并至少有一个发行版。
- 发行版内安装 `bubblewrap`，必需。
- 默认的会话沙箱需要 systemd：在 `/etc/wsl.conf` 设置 `[boot] systemd=true`，重启 WSL，然后执行一次 `loginctl enable-linger "$USER"`。没有 systemd 时，在 `wsl-shell` 和 `wsl-fs` 上都设置 `sessionSandbox: false`。
- 可选：`ripgrep` 用于搜索，`git` 用于变更快照，`inotify-tools` 用于文件监视。

发行版内不需要 Node.js。

## 安装

在 Windows 终端执行：

```powershell
dsh wsl --from-default-profile web --dump-config   # 创建 profile
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 安装插件及其配置
dsh --profile wsl --dump-config                    # 检查：输出 "# == dsh-plugin-wsl-env"
dsh --profile wsl                                  # 启动
```

第一条命令之前安装 `bubblewrap`：

```powershell
wsl.exe -d <发行版> -u root -- apt-get install -y bubblewrap
```

在插件检出目录中，`pnpm run bootstrap -- <发行版>` 检查四个发行版工具，并按包管理器打印安装命令；加 `--install` 直接执行。

升级：再次执行 `add` 命令。卸载：`dsh plugin --profile wsl remove dsh-plugin-wsl-env`；之后可删除 `~/.cache/dsh-wsl`。如果你为了恢复预览在 profile 里加过 `workspace-files-wsl` 的临时覆盖，升级后请删掉：插件不再挂载该行。

## 使用

打开一个发行版文件夹作为工作区，例如 `\\wsl.localhost\ubuntu\home\you\project`。

- 命令在发行版登录 shell 中运行。`/home/you/x` 与 `\\wsl.localhost\ubuntu\home\you\x` 是同一个文件。
- **New terminal** 在同一发行版、同一目录打开 shell。
- 模型能看到监听端口，并返回 dev server 的 URL。WSL 2 会把 localhost 转发到 Windows。
- 权限选择器：`read-only`、`workspace-write`（默认）、`danger-full-access`。只有 `danger-full-access` 不经过沙箱。

## 配置

配置写在 `$DSH_HOME/profiles/<名字>/cordis.patch.yml` 的命名行上。主要设置：

| 行 | 键 | 默认值 | 作用 |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | 使用的发行版；空表示 WSL 默认 |
| | `sandbox` | `true` | 用 `bubblewrap` 约束命令 |
| | `sessionSandbox` | `true` | 会话命令跑在同一个 systemd user scope 中 |
| | `agentBackend` | `auto` | 发行版内 agent：`auto`、`native` 或 `shell` |
| | `maskWindowsDrive` | `false` | 让受限命令看不到 `/mnt` |
| `wsl-fs` | `distro` | `''` | 文件操作使用的发行版 |
| | `restrictToDistro` | `true` | 拒绝属于其他发行版的路径 |
| | `sandbox` | `true` | 按策略检查受限写入 |
| | `sessionSandbox` | `true` | 受限写入跑在会话 runtime 中 |
| | `substrate` | `agent` | 发行版内 agent；`share` 在启动时被拒绝 |
| `directory-picker-wsl` | `includeHostHome` | `true` | 同时列出 Windows 家目录 |
| `subprocess-wsl` | `distro` | `''` | GUI 终端使用的发行版 |

`wsl-shell` 和 `wsl-fs` 位于随包的 `wsl` preset 中，按 id 覆盖无效。要改就覆盖整个 `preset-wsl` 行；配方和其余键见 [docs/CONFIGURATION.md](CONFIGURATION.md)。[`cordis.patch.yml`](../cordis.patch.yml) 是随包值的注释参考。

## 架构

一个 harness 进程可同时服务 Windows 文件夹会话和发行版文件夹会话。服务分两层挂载：

```text
应用层（每个进程一份）
├─ directory-picker-wsl、workspace-files、subprocess-wsl
├─ fs-routing：根级文件系统，按路径分流
└─ auto-preset：会话打开发行版文件夹时绑定 wsl preset

wsl preset（每个会话）
├─ wsl-shell：命令
└─ wsl-fs：文件操作
```

- `wsl-shell` 通过 systemd user scope 内的一个常驻 agent 执行命令。agent 默认是发行版架构（`x86_64` 或 `aarch64`）对应的包内静态 musl `dsh-wsl-agent`，shell agent 作为回退。每条命令在登录 shell 中、`bubblewrap` mount profile 下运行。scope 比命令活得久，所以后台服务存活，`ps` 能看到整个会话。设置 `sessionSandbox: false` 后，agent 仍按发行版常驻，但每条命令使用自己的 profile。
- `wsl-fs` 通过同一个发行版内 agent 提供读写。受限写入运行在 mount profile 与策略一致的常驻 agent 中，由内核执行写入边界。没有宿主机侧的文件回退：agent 不可用时文件操作直接失败。
- GUI 文件树和预览使用随包的 `workspace-files` 行，而不是插件的替换行：它的客户端半边是浏览器的 `file` 资源提供者。WSL 路径经根级路由读取，仍在发行版内，但会多几次 agent 往返。
- 应用层服务按路径分流：发行版 UNC 路径走发行版，Windows 盘符路径留在宿主。见 [docs/root-fs-routing.md](root-fs-routing.md)。

## 沙箱

| 模式 | 命令可以做什么 |
|---|---|
| `read-only` | 读整个发行版；挂载新的 `/dev`，其余不可写 |
| `workspace-write` | 上面的权限，加上会话工作区；会话 runtime 下 `/tmp` 是发行版真实 `/tmp` |
| `danger-full-access` | 不经过沙箱 |

设置 `sessionSandbox: false` 时，每条命令使用私有的 `/tmp`，而不是发行版的真实 `/tmp`。

`bubblewrap` 是必需项。缺失或损坏时，受限命令报 `SANDBOX_UNAVAILABLE`，不会运行。在对应的行设置 `sandbox: false` 可关闭沙箱；模型会收到"该操作无沙箱"的说明。

隔离上报为 `partial`。发行版内的命令仍可通过 `/mnt/c` 启动 Windows 程序，`bubblewrap` 无法控制 Windows 进程。`maskWindowsDrive: true` 让受限视图看不到 `/mnt`，能收窄这个洞但不能关死。彻底关闭要在发行版层面设置 `[interop] enabled=false`（`/etc/wsl.conf`）。见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#sandbox) 和 [SECURITY.md](../SECURITY.md)。

## 常见问题

| 现象 | 处理 |
|---|---|
| 每条命令都报 `SANDBOX_UNAVAILABLE` | 在发行版内安装 `bubblewrap`，或设置 `sandbox: false` |
| 会话在第一条命令前就被拒绝 | 启用 systemd 和 linger，或在 `wsl-shell`、`wsl-fs` 上设置 `sessionSandbox: false` |
| 发行版内 `glob`、`grep` 很慢 | 运行 `pnpm run bootstrap -- <发行版> --install` 安装 `ripgrep` |
| `dsh plugin add` 没有输出 | 插件已安装；这是成功 |
| 改了 `lib/` 但不生效 | 运行 `pnpm run sync:windows`，然后重启应用 |

更多错误码和拒绝原因见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#error-codes)，插件不做的事见 [docs/LIMITATIONS.md](LIMITATIONS.md)。

## 开发

```bash
pnpm install           # 开发依赖
pnpm run build         # 从 src/ 生成 lib/（lib/ 提交进仓）
pnpm test              # 风格、语法、构建一致性、类型、单元测试
pnpm run test:coverage # 带覆盖率阈值的单元测试
pnpm run sync:windows  # 更新应用加载的 Windows 侧副本
```

工具链跟随 harness 宿主：Node `^22.19.0 || >=24.0.0`。`src/` 是 TypeScript，`lib/` 是生成并提交的产物，必须保持同步。应用加载的是 Windows 侧的 `lib/` 副本，所以构建后要运行 `sync:windows` 并重启应用。

真机探针仅在 Windows + WSL 下运行。见 [CONTRIBUTING.md](../CONTRIBUTING.md) 和 `test/probe/`。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/CONFIGURATION.md](CONFIGURATION.md) | 所有配置键及覆盖方法 |
| [docs/ARCHITECTURE.md](ARCHITECTURE.md) | 服务、路径路由、沙箱、错误码 |
| [docs/LIMITATIONS.md](LIMITATIONS.md) | 插件不做的事 |
| [docs/ROADMAP.md](ROADMAP.md) | 当前计划和推迟项 |
| [docs/VALUE.zh.md](VALUE.zh.md) | 价值与取舍 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 开发循环、质量门、探针 |
| [SECURITY.md](../SECURITY.md) | 私下上报漏洞 |
| [SUPPORT.md](../SUPPORT.md) | 支持范围与提问渠道 |
| [docs/RELEASING.md](RELEASING.md) | 发布检查单 |

## 许可

MIT，见 [LICENSE](../LICENSE)。
