# dsh-plugin-wsl-env

[English](../README.md) · **中文**

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](../LICENSE)

这个插件让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 把 WSL 子系统当作工作环境：命令在子系统里执行，模型的文件工具读写子系统里的真实文件，文件夹选择器可以直接打开子系统目录，GUI 终端也开在子系统里。

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

然后在 GUI 里打开 `\\wsl.localhost\<子系统>\...` 下的文件夹。选择器会在根一级列出每个已安装的子系统，**New terminal** 会在子系统里打开 shell。

还需要在子系统里安装 **bubblewrap**：运行 `npm run bootstrap -- <子系统> --install`（只读检测去掉 `--install`），或直接执行 `wsl.exe -d <子系统> -u root -- apt-get install -y bubblewrap`。没有它每条命令都会失败关闭，见[沙箱](#沙箱)。

卸载：`dsh plugin --profile wsl remove dsh-plugin-wsl-env`。升级：再执行一次同样的 `add` 命令。

> **改了 `lib/` 下的任何文件？必须重启应用。** 运行中的进程会缓存 ES module，否则会继续用旧代码。

## 使用

把 `\\wsl.localhost\ubuntu\home\you\project` 作为工作区打开，然后问模型"我在什么内核上，`/etc/os-release` 里有什么"。它会在子系统里执行 `uname -r` 并读取该文件，不经过 `/mnt/c`，也不复制文件。

- **子系统文件夹自动获得子系统环境。** 创建会话时就会绑定 `wsl` preset，所以第一次工具调用就已经正确。
- **命令**以 `wsl.exe -d <子系统> --cd <Linux 目录> --exec <你的登录 shell> -lc <命令>` 执行，所以你的 `PATH`、`nvm`、`cargo`、`pyenv` 和 rc 配置都生效。shell 不是硬编码的 bash。
- **文件就是子系统的真实文件。** `/home/you/x` 与 `\\wsl.localhost\ubuntu\home\you\x` 是同一个文件，`/mnt/c/...` 通向 Windows 磁盘。
- **终端**（右侧栏 → *New terminal*）在子系统里打开会话目录下的 shell。
- **端口可见性**：子系统里监听中的端口经 `DSH_WSL_PORTS` 暴露给模型（约每 10 秒刷新）；子系统内启动的 dev server 可由模型直接告知确切 URL（WSL2 的 localhost 转发是平台行为，Windows 侧直接可达）。
- **模型能看到自己的 shell 环境。** 插件向受管的 `DSH_*` 命名空间注册 `DSH_WSL_DISTRO`、`DSH_WSL_SHELL` 和 `DSH_WSL_HOME`。
- **权限与 Linux 主机一致。** 权限选择器在 `read-only`、`workspace-write`（默认）和 `danger-full-access` 之间切换。被拒绝的命令或写入会带回"放宽权限"的提议；批准后，这一次调用不加沙箱执行。

## 配置

在自己的 profile 层里按 id 覆盖某一行：`$DSH_HOME/profiles/<名字>/cordis.patch.yml`。值得知道的键：

| 行 | 键 | 默认值 | 说明 |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` | 子系统名；空表示用 WSL 的默认子系统 |
| | `sandbox` | `true` | 用 `bubblewrap` 约束命令；`false` 表示不用沙箱 |
| `wsl-fs` | `distro` | `''` | 同上 |
| | `restrictToDistro` | `true` | 拒绝指向**其它子系统**共享的路径；`/mnt/c` 属于本子系统内部，不受影响。拒绝码为 `FS_OUTSIDE_DISTRO`，它不是沙箱拒绝，放宽权限也无法解除 |
| | `sandbox` | `true` | 写入时按策略检查 `writeText` 和 `editText` |
| `directory-picker-wsl` | `includeHostHome` | `true` | 同时列出 Windows 家目录 |
| `subprocess-wsl` | `distro` | `''` | GUI 终端开在哪个子系统 |

[`cordis.patch.yml`](../cordis.patch.yml) 是每个随包值的注释参考。[docs/CONFIGURATION.md](CONFIGURATION.md) 列出其余键，包括 `shell`、`loginShell`、`cwd`、`timeoutMs`、`resolveSymlinks`、`preferredDistro` 和 `maxEntries`；[examples/profile.cordis.patch.yml](../examples/profile.cordis.patch.yml) 是一份可照抄的本机层。

## 沙箱

命令由**子系统内的 `bubblewrap`** 约束，文件写入按同一份策略检查。Windows ACL 沙箱在这里用不了：它的受限令牌完全到不了 WSL。

| 模式 | 子系统里的命令可以做什么 |
|---|---|
| `read-only` | 整个子系统只读；`/dev` 是新建的可写挂载（`/dev/null` 与 `/dev/shm` 可用），其余不可写 |
| `workspace-write` | 在上一行基础上，把会话工作区绑定为可写，并把 `/tmp` 挂成临时目录 |
| `danger-full-access` | 不加沙箱；用于批准后的放宽权限请求 |

**bubblewrap 是必需项，而且失败是关闭的。** 没有它时，每条受限命令都报 `SANDBOX_UNAVAILABLE`，而不是不受约束地运行。要退出约束就在任一 provider 上设 `sandbox: false`，工具层会如实告诉模型这些操作没有沙箱。

**上报的强制程度是 `partial` 而不是 `full`。** 子系统里的进程仍可经 WSL interop 执行 Windows 程序（例如 `/mnt/c/.../*.exe`），bubblewrap 管不到它。`npm run probe:sandbox` 会在你的机器上演示这条边界。

设计见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#sandbox)，插件不做的事情见 [docs/LIMITATIONS.md](LIMITATIONS.md)。

## 配方

- **Git 凭据共享**：让子系统里的 git 使用 Windows 侧的 Git Credential Manager，避免每次输密码：
  `git config --global credential.helper "/mnt/c/Program\ Files/Git/mingw64/bin/git-credential-manager.exe"`
  （路径按 Windows 侧 Git 的安装位置调整；WSL2 的 localhost 转发是平台行为，子系统内监听的端口 Windows 直接可达。）
- **路径与性能**：模型看到并操作的是子系统内的 Linux 路径（`/home/...`），写入子系统自身的 ext4；`/mnt/c` 通向 Windows 磁盘但走 9p，大批量小文件操作明显慢——重 IO 的项目请放在子系统文件系统内。`npm run bootstrap -- <子系统>` 会一并报告 ripgrep / inotifywait（搜索与监视的后端）是否就位。
- **WSLENV 透传**：WSL 只导入 `WSLENV` 中列出的变量。本插件按前缀放行托管的 `DSH_*` 命名空间，其中带 Windows 路径的两个（`DSH_HOME`、`DSH_PROFILE_DIR`）加 `/p` 让 WSL 翻译成 `/mnt/c/...`。`PATH` 故意不透传——否则 Windows 的 PATH 会覆盖子系统自身的 PATH。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 每条命令都报 `SANDBOX_UNAVAILABLE` | 子系统里没有 `bubblewrap` | 执行 `npm run bootstrap -- <子系统> --install`，或在两个 provider 上都设 `sandbox: false` |
| 命令或写入在会话目录之外被拒绝 | `workspace-write` 的预期行为 | 接受工具给出的放宽权限提示，或把会话直接开在需要的目录上 |
| 连工作区内的写入也被拒绝 | 会处在 `read-only` 模式 | 切换权限选择器 |
| `dsh plugin add` 提示"没有激活任何层" | 依赖之前已经装过，`add` 没有需要记录的内容 | 先执行 `dsh plugin --profile wsl remove dsh-plugin-wsl-env`，再装一次 |
| 终端打开后仍然是 `cmd.exe` | 这一层里的 `terminal-controller` 行没有生效 | 用 `dsh --profile wsl --dump-config` 确认能看到 `shell: { path: wsl.exe, name: WSL }` |
| 改了 `lib/` 但不生效 | ES module 缓存 | 重启应用 |
| 用 `link:\\wsl.localhost\...` 安装后符号链接是坏的 | pnpm 无法链接 UNC 路径 | 改成链接 Windows 路径；在子系统内开发时用运行时镜像，见[开发](#开发) |
| `glob`/`grep` 很慢 | Windows 侧的 ripgrep 在 9p 共享上遍历 | 属于预期，收窄搜索路径，或改用 `bash` 调用子系统内的工具 |
| 终端活动显示 `unknown` | 官方 shell 集成只对 POSIX 主机上直接启动的 `bash`/`zsh` 生效 | 关闭标签页以释放进程；空闲回收不会对它触发 |
| 结果里出现 `FS_*` 码 | 码本身说明了是谁拒绝的、以及怎样解除 | 见 [docs/ARCHITECTURE.md](ARCHITECTURE.md#error-codes) 的错误码表 |

## 开发

```bash
npm test                     # 风格与打包检查、语法检查、单元测试
npm run test:coverage        # 带覆盖率阈值的单元测试（需 Node 22.8+）
npm run probe:sandbox        # 在子系统里实测 bubblewrap 能约束什么、不能约束什么
npm run probe                # 文件系统探针，需要真实子系统（仅 Windows + WSL）
npm run probe:sandbox-shell  # 启动真实 harness，驱动受限执行器
npm run probe:terminal       # 通过终端 provider 打开一个 PTY
npm run probe:missing-wsl    # 启动一个 wslPath 无法启动的 profile（仅 Windows + WSL）
npm run probe:picker         # 列出选择器的根级、拒绝路径与上限（仅 Windows + WSL）
npm run probe:mode           # 哪些 POSIX 权限事实能穿过共享层（仅需 Windows node）
npm run probe:sandbox-off    # 验证 sandbox: false 确实解除两侧约束（仅 Windows + WSL）
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
