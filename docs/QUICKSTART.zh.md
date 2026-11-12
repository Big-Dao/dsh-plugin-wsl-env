# 快速开始

[English](QUICKSTART.md)

从一台 Windows + WSL 2 机器到可用的 WSL 会话，只需以下步骤。
本页是入口；每条说明都链接到负责该主题的文档。

## 0. 需要这个插件吗？

如果 harness 可以整个跑在发行版里，把 CLI 装进去（`npm install -g
@deepseek-ai/dsh`）并跳过本插件会更简单——判断表见
[README](README.zh.md#需要这个插件吗)。本页其余部分假定桌面应用留在 Windows，
由本插件提供 WSL 环境。

## 1. 前置条件

| 需求 | 如何检查 | 缺失时 |
|---|---|---|
| Windows 10/11，启用 WSL 2 | `wsl.exe -l -v` 显示 `VERSION 2` | `wsl.exe --install` |
| 一个发行版 | 上面列表中有一行 | `wsl.exe --install -d Ubuntu` |
| `bubblewrap` | `wsl.exe -d <distro> -- which bwrap` | `wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap` |
| systemd + Linger（会话 runtime 需要） | `node <plugin>/scripts/doctor.mjs`（已安装）或 `pnpm run doctor`（检出目录） | 在 `/etc/wsl.conf` 设置 `[boot] systemd=true`，`wsl --shutdown`，然后 `loginctl enable-linger "$USER"`；或设置 `sessionSandbox: auto`/`false` |
| Node `^22.19.0` 或 `>=24.0.0` | 仅源码/开发工作需要 | 使用已发布的插件时，发行版内不需要 Node |

手边没有终端？有几条不依赖终端的路：侧边栏的 **WSL 环境** 面板按发行版运行
doctor 快速检查，结果以状态徽标、编号的待修项与告警列出，并在存在相应可修复项时把对插件自有状态
（残留 scope、损坏的 agent 缓存）的完整运行标为 **修复**，否则标为 **完整检查**；在输入框里输入
`/wsl-doctor [quick|full|<分区>]` 同样在宿主侧执行、直接渲染在 UI，不进模型
对话、零 token；在会话里请求诊断，模型会运行本插件挂载的 `wsl_doctor` 工具，
判定落在对话里；会话启动预检在每次会话打开时把同样的判定写进日志，只有 blocked
判定同时进入会话上下文。`DSH_WSL_DOCTOR` 还携带一条现成命令，可在发行版内执行 doctor 脚本本身
（`sh -c "$DSH_WSL_DOCTOR --json"`）。

doctor（`scripts/doctor.mjs`，或在检出目录中运行 `pnpm run doctor`）会检查
环境并以裁决收尾：`ready` 表示本次运行覆盖的检查全部通过，不保证每条命令都成功；`blocked` 会列明待修项，
每项附可复制的处理办法。发行版的 WSL 模式由 doctor 自己从 `wsl.exe -l -v`
读取，无需单独确认。doctor 默认只读，除非传入 `--fix`（清理过期 scope、清理损坏的
agent 缓存，两者都会复检；以及确认后的 Windows git 信任）或
`--fix --install`（安装软件包，需确认）；`--fix-owned` 把修复限定在
插件自有状态（面板的“修复”动作）；
`--bundle <路径>` 写出可附加到问题报告的诊断文件（`--redact`
将其中的路径脱敏）。运行可以收窄范围——`--quick` 只探首条命令的前置项
（约 10 秒），`--sections <分区清单>`（逗号分隔）只运行指定分区——
或用 `--all` 扩展到每个已装发行版；报告按 distro 分组逐项列出每个检查，
带显式状态标记。固定骨架按宿主语言渲染（`--locale <标签>` 或
`DSH_WSL_DOCTOR_LOCALE` 可覆盖检测）。

## 2. 安装

桌面应用没有 `dsh` 命令；在侧边栏打开 **插件**，点 **Add plugin**，按精确包名
`dsh-plugin-wsl-env` 安装。这一步写入该 profile 的 `package.json` 与
`dsh.profile.bundles`。

使用 CLI 发行版（`dsh` 在 `PATH` 上）时，在 Windows PowerShell 中：

```powershell
dsh plugin --profile <profile> add dsh-plugin-wsl-env
# 若解析到旧版本（发布当天的元数据缓存），显式指定：
# dsh plugin --profile <profile> add dsh-plugin-wsl-env@<latest>
dsh --profile <profile> --dump-config      # 输出中必须包含插件的行
```

如果 profile 已覆盖 preset，请保持覆盖为完整的
`preset-wsl` 块——当某个层直接按 id 指向 `wsl-shell`/`wsl-fs` 时，
`pnpm run preset --check <patch>` 会明确报错。

## 3. 打开 WSL 工作区

启动桌面应用的方式与它安装的快捷方式一致：`DeepSeek Harness.exe`，不带参数——
它打开的是应用自己配置的 profile（也就是 Plugins 页面写入的那个）。（CLI
发行版：`dsh --profile <名字>` 启动指定名字的 profile。）

在 GUI 中，通过选择器打开文件夹（`\\wsl.localhost\<distro>\home\<you>\proj`），
或直接打开 UNC 路径。会话的命令、文件工具、终端和预览
都在该发行版中运行；打开 Windows 文件夹则保留正常的 Windows 环境。
两个发行版可以同时打开，各自拥有自己的环境。

侧边栏的 **WSL 环境** 面板是诊断页：它列出已安装的发行版，可对单个发行版运行
一次 doctor 快速检查，显示 bwrap、systemd、Linger 等前置项是否正常；已检查的行提供一次完整 doctor（`--fix-owned`）：存在可自动修复项（残留 session
scope 或损坏的 agent 缓存）时标为 **修复**，否则标为 **完整检查**；行内还显示上次
检查时间、来源（手动，或页面加载时的后台复核）与结果结构（通过/告警/失败/
信息/跳过，以及分区分布）；最后一次结果会从本地存档恢复，正在运行的发行版会在
页面加载时后台复核；运行时按需清扫
残留 scope、清理缓存并逐一复检，其余告警保留各自的手动处理办法，不安装软件包、
不改写 Windows 配置（检查会让停止的发行版启动，所以两种动作都只在点击时执行）。工作区仍在 **添加工作区** 里打开；选中发行版内的文件夹时，应用会问一次打开方式：**Remote WSL**（默认，命令、
文件与终端都在发行版内）或 **Windows 访问**（把该文件夹当作普通 Windows 共享，经 9p
读写，没有 Linux 工具链）。选择记录在 `auto-preset` 行的 `windowsWorkspaces` 里，
对该工作区之后新建的会话同样生效。
Windows 访问目录也会在会话内被点明：运行非 WSL preset 的发行版工作区在输入框上方
常驻一条警示；会话尚未开始时一键切换，已开始后修正访问记录。

### 在 VS Code 中打开工作区（Remote-WSL）

把 WSL 文件夹当作 Windows UNC 共享打开也可行，但属于降级模式：
文件走 9p，终端是 PowerShell，扩展运行在 Windows 上。完整的
集成方式是 VS Code 的 Remote-WSL——server 运行在发行版内，集成终端
是发行版的 shell，文件操作直接落在本地 ext4 上：

```powershell
# from the plugin checkout:
scripts/open-wsl-vscode.ps1 -Path "\\wsl.localhost\ubuntu\home\me\proj"
# or by hand:
code --folder-uri "vscode-remote://wsl+ubuntu/home/me/proj"
```

要求 PATH 上有 `code` shim（VS Code 安装器会添加），以及
Remote-WSL 扩展。

桌面 GUI 的会话头部菜单还提供 **在 VS Code 中打开（WSL）**：它把会话工作区
转换成同一个 URI，并在清理过的环境里启动编辑器，因此不依赖打过补丁的
`app.asar`。

![The directory picker listing a WSL distro's folders](screenshots/picker.png)

终端面板运行在同一个发行版中——`uname -a` 返回的是
发行版的内核，而不是 Windows 的：

![The GUI terminal running inside the distro](screenshots/terminal.png)

侧边栏的预览也能就地渲染 WSL 文件：

![The GUI preview rendering a WSL file](screenshots/preview.png)

## 4. 验证

让模型执行一条命令，例如 `pwd && uname -a`。预期结果：Linux 路径和
发行版内核。如果第一条命令失败，错误信息会给出补救方法；
[doctor](CONFIGURATION.md) 和[故障排查表](../README.md#troubleshooting)
覆盖了常见情况。

首次写入说明：沙箱会在会话策略尚未授予的写入前请求许可——提示会写明命令
与目标，允许一次是安全的。在发行版内执行 `loginctl enable-linger <用户>`
可以避免非 lingering 的 user manager 造成的重复弹窗。

下面的探针会实时运行随包的、由内核强制的 bwrap profile——
工作区内的写入生效，测试性的区外写入被以 `EROFS` 拒绝，
严格 profile 则把 `/mnt` 完全隐藏
（[`test/probe/sandbox.sh`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/test/probe/sandbox.sh)）：

这是部分隔离，不是 Windows 安全边界：Windows interop
仍可启动 `/mnt` 之外的可执行文件。见 [LIMITATIONS.md](LIMITATIONS.md)。

![The sandbox probe: every expectation holds, the kernel refuses what the profile does not grant](screenshots/sandbox.png)

## 配方

命令在模型的会话中运行，位于发行版内，从工作区根目录出发。

### Node / TypeScript

```bash
node -v && pnpm -v
pnpm install
pnpm test
pnpm dev            # a dev server survives the command that started it with sessionSandbox: true
```

冷缓存或新增依赖时，`workspace-write` 会拦住 `~/.npm`、pnpm store 等缓存写入
（`EROFS`）。在 `wsl-shell` 和 `wsl-fs` 上配置同一组 `writableRoots`（例如
`~/.npm`、`~/.cache`、`~/.local/share/pnpm`），见
[CONFIGURATION](CONFIGURATION.zh.md#工具链缓存与额外可写目录)。

快照成功后（默认每 10 s 刷新一次），server 的端口可能出现在 `DSH_WSL_PORTS`
中；从 Windows 通过 `http://localhost:<port>` 访问转发的端口。

### Python

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m pytest
```

使用发行版的解释器，而不是 Windows 的：会话的 `python3` 是
发行版 `PATH` 上的那个（包括 pyenv/conda shim）。

### Rust

```bash
cargo build --release
cargo test
```

target 会针对发行版的架构（x86_64 或 aarch64）原生编译；
不要复用 Windows 的 `target/` 目录。

### Go

```bash
go build ./...
go test ./...
```

模块缓存通常位于发行版用户的 `$GOPATH` 下；其实际位置和底层文件系统
取决于 Go 环境和挂载情况。

### Monorepo

把仓库根目录作为工作区打开。每个包的命令都在同一个发行版中运行；
`pnpm -r`、`turbo`、`nx` 和 `make` 看到的是同一个 Linux 文件系统。
当 `inotifywait` 可用时，无上限目录的文件监视使用 inotify；
否则回退到轮询。如果遗漏了某次变更，见
[CONFIGURATION.md](CONFIGURATION.md) 中的监视器边界。

## 兼容性

诚实的现状，不是承诺。"已探针"指本仓库记录了一次真机运行；
"目标"指设计上支持，但这条腿尚未在这里执行过。

| 层级 | 配置 | 状态 |
|---|---|---|
| 1 | Ubuntu / Debian，systemd，x86_64 | 已探针。Debian 的 harness 级探针针对 `wslfs-debian` profile 通过（2026-10-26）。 |
| 2 | Fedora、openSUSE、Arch、Alpine；aarch64 原生 agent | 发行版矩阵见 [COMPATIBILITY.md](COMPATIBILITY.md)。aarch64 的 18 项检查在 CI 中于 qemu 下运行；物理 aarch64 WSL 不在范围内。 |
| 不支持 | WSL 1、Linux/macOS 宿主、无 WSL 2 的 Windows | 不支持；插件依附于 `wsl.exe` |

设置 `sessionSandbox: auto` 时，没有 systemd/Linger 的发行版仍能获得
按命令的 `bubblewrap` 沙箱，且结果会报告更窄的 scope；
`true` 则直接拒绝。沙箱取舍见
[CONFIGURATION.md](CONFIGURATION.md#sandbox-and-preflight)，实测延迟见
[PERFORMANCE.md](PERFORMANCE.md)。

## 演示

上面的截图展示了选择器、终端、预览和沙箱探针。
目前还没有 GIF。[故障排查表](../README.md#troubleshooting)
和探针输出（`pnpm run probe:sandbox`、`pnpm run probe:gui-preview`）
提供了可复现的证据；其余演示工作在
[ROADMAP-1.0.md](ROADMAP-1.0.md#wsl-302--discoverability-and-docs-entry) 中跟踪。
