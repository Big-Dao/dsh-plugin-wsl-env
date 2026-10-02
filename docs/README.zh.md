# dsh-plugin-wsl-env

[English](../README.md) · **中文**

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](../LICENSE)

这个插件让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 把 WSL 发行版当作工作环境：命令在发行版里执行，模型的文件工具读写发行版里的真实文件，文件夹选择器可以直接打开发行版目录，GUI 终端也开在发行版里。

**只支持 Windows + WSL2。** 安装只需一条命令，插件自身没有依赖。环境按会话生效：打开 Windows 文件夹的会话继续使用原来的 Windows 环境。

[安装](#安装) · [使用](#使用) · [配置](#配置) · [沙箱](#沙箱) · [常见问题](#常见问题) ·
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

然后在 GUI 里打开 `\\wsl.localhost\<发行版>\...` 下的文件夹。选择器会在根一级列出每个已安装的发行版，**New terminal** 会在发行版里打开 shell。

还需要在发行版里安装 **bubblewrap**：`sudo apt install bubblewrap`。没有它每条命令都会失败关闭，见[沙箱](#沙箱)。

卸载：`dsh plugin --profile wsl remove dsh-plugin-wsl-env`。升级：再执行一次同样的 `add` 命令。

> **改了 `lib/` 下的任何文件？必须重启应用。** 运行中的进程会缓存 ES module，否则会继续用旧代码。

## 使用

把 `\\wsl.localhost\ubuntu\home\you\project` 作为工作区打开，然后问模型"我在什么内核上，`/etc/os-release` 里有什么"。它会在发行版里执行 `uname -r` 并读取该文件，不经过 `/mnt/c`，也不复制文件。

- **发行版文件夹自动获得发行版环境。** 创建会话时就会绑定 `wsl` preset，所以第一次工具调用就已经正确。
- **命令**以 `wsl.exe -d <发行版> --cd <Linux 目录> --exec <你的登录 shell> -lc <命令>` 执行，所以你的 `PATH`、`nvm`、`cargo`、`pyenv` 和 rc 配置都生效。shell 不是硬编码的 bash。
- **文件就是发行版的真实文件。** `/home/you/x` 与 `\\wsl.localhost\ubuntu\home\you\x` 是同一个文件，`/mnt/c/...` 通向 Windows 磁盘。
- **终端**（右侧栏 → *New terminal*）在发行版里打开会话目录下的 shell。
- **模型能看到自己的 shell 环境。** 插件向受管的 `DSH_*` 命名空间注册 `DSH_WSL_DISTRO`、`DSH_WSL_SHELL` 和 `DSH_WSL_HOME`。
- **权限与 Linux 主机一致。** 权限选择器在 `read-only`、`workspace-write`（默认）和 `danger-full-access` 之间切换。被拒绝的命令或写入会带回"放宽权限"的提议；批准后，这一次调用不加沙箱执行。

## 配置

在自己的 profile 层里按 id 覆盖某一行：`$DSH_HOME/profiles/<名字>/cordis.patch.yml`。值得知道的键：

| 行 | 键 | 默认值 | 说明 |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | 发行版名；空表示用 WSL 的默认发行版 |
| | `sandbox` | `true` | 用 `bubblewrap` 约束命令；`false` 表示不用沙箱 |
| `wsl-fs` | `distro` | `''` | 同上 |
| | `restrictToDistro` | `true` | 拒绝指向**其它发行版**共享的路径；`/mnt/c` 属于本发行版内部，不受影响。拒绝码为 `FS_OUTSIDE_DISTRO`，它不是沙箱拒绝，放宽权限也无法解除 |
| | `sandbox` | `true` | 写入时按策略检查 `writeText` 和 `editText` |
| `directory-picker-wsl` | `includeHostHome` | `true` | 同时列出 Windows 家目录 |
| `subprocess-wsl` | `distro` | `''` | GUI 终端开在哪个发行版 |

[`cordis.patch.yml`](../cordis.patch.yml) 是每个随包值的注释参考。[docs/CONFIGURATION.md](CONFIGURATION.md) 列出其余键，包括 `shell`、`loginShell`、`cwd`、`timeoutMs`、`resolveSymlinks`、`preferredDistro` 和 `maxEntries`；[examples/profile.cordis.patch.yml](../examples/profile.cordis.patch.yml) 是一份可照抄的本机层。

## 沙箱

命令由**发行版内的 `bubblewrap`** 约束，文件写入按同一份策略检查。Windows ACL 沙箱在这里用不了：它的受限令牌完全到不了 WSL。

| 模式 | 发行版里的命令可以做什么 |
|---|---|
| `read-only` | 整个发行版只读；`/dev` 是新建的可写挂载（`/dev/null` 与 `/dev/shm` 可用），其余不可写 |
| `workspace-write` | 在上一行基础上，把会话工作区绑定为可写，并把 `/tmp` 挂成临时目录 |
| `danger-full-access` | 不加沙箱；用于批准后的放宽权限请求 |

**bubblewrap 是必需项，而且失败是关闭的。** 没有它时，每条受限命令都报 `SANDBOX_UNAVAILABLE`，而不是不受约束地运行。要退出约束就在任一 provider 上设 `sandbox: false`，工具层会如实告诉模型这些操作没有沙箱。

**上报的强制程度是 `partial` 而不是 `full`。** 发行版里的进程仍可经 WSL interop 执行 Windows 程序（例如 `/mnt/c/.../*.exe`），bubblewrap 管不到它。`npm run probe:sandbox` 会在你的机器上演示这条边界。

设计见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#sandbox)，插件不做的事情见 [docs/LIMITATIONS.md](LIMITATIONS.md)。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 每条命令都报 `SANDBOX_UNAVAILABLE` | 发行版里没有 `bubblewrap` | 执行 `sudo apt install bubblewrap`，或在两个 provider 上都设 `sandbox: false` |
| 命令或写入在会话目录之外被拒绝 | `workspace-write` 的预期行为 | 接受工具给出的放宽权限提示，或把会话直接开在需要的目录上 |
| 连工作区内的写入也被拒绝 | 会处在 `read-only` 模式 | 切换权限选择器 |
| `dsh plugin add` 提示"没有激活任何层" | 依赖之前已经装过，`add` 没有需要记录的内容 | 先执行 `dsh plugin --profile wsl remove dsh-plugin-wsl-env`，再装一次 |
| 终端打开后仍然是 `cmd.exe` | 这一层里的 `terminal-controller` 行没有生效 | 用 `dsh --profile wsl --dump-config` 确认能看到 `shell: { path: wsl.exe, name: WSL }` |
| 改了 `lib/` 但不生效 | ES module 缓存 | 重启应用 |
| 用 `link:\\wsl.localhost\...` 安装后符号链接是坏的 | pnpm 无法链接 UNC 路径 | 改成链接 Windows 路径；在发行版内开发时用运行时镜像，见[开发](#开发) |
| `glob`/`grep` 很慢 | Windows 侧的 ripgrep 在 9p 共享上遍历 | 属于预期，收窄搜索路径，或改用 `bash` 调用发行版内的工具 |
| 终端活动显示 `unknown` | 官方 shell 集成只对 POSIX 主机上直接启动的 `bash`/`zsh` 生效 | 关闭标签页以释放进程；空闲回收不会对它触发 |

## 开发

```bash
npm test                     # 风格与打包检查、语法检查、单元测试
npm run test:coverage        # 带覆盖率阈值的单元测试（需 Node 22.8+）
npm run probe:sandbox        # 在发行版里实测 bubblewrap 能约束什么、不能约束什么
npm run probe                # 文件系统探针，需要真实发行版（仅 Windows + WSL）
npm run probe:sandbox-shell  # 启动真实 harness，驱动受限执行器
npm run probe:terminal       # 通过终端 provider 打开一个 PTY
```

这个包没有依赖，被测模块只 import Node 内置模块，所以不需要先安装任何东西。CI 在 Linux 和 Windows 上用 Node 20、22、24 运行 `npm test`，并在 Node 24 上运行 `npm run test:coverage`。

[docs/ARCHITECTURE.md](ARCHITECTURE.md) 有文件布局、挂载方式和沙箱设计；[CONTRIBUTING.md](../CONTRIBUTING.md) 有开发循环、完整质量门清单和已验证内容。

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
