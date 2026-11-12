# 兼容性矩阵

[English](COMPATIBILITY.md)

以下是 [`ROADMAP-1.0.md`](ROADMAP-1.0.md)（WSL-202）中支持分级的实测证据。
下表的每一行都于 **2026-10-26** 在同一台机器的真实 WSL2 发行版上执行
（x86_64、Windows 11、WSL 2、内核 6.18），探针套件位于
[`test/probe/`](https://github.com/Big-Dao/dsh-plugin-wsl-env/tree/main/test/probe/)，
从每个发行版内部针对全新的 `--depth 1` 克隆运行。aarch64 原生 agent 另在 CI
中每次 push 于 qemu 下执行——见
[`.github/workflows/ci.yml`](https://github.com/Big-Dao/dsh-plugin-wsl-env/blob/main/.github/workflows/ci.yml)
中的 `native-package` 作业；仅 VM 验证是既定决策——见下文“范围决策”。

## 矩阵

| | Ubuntu（宿主，Tier 1） | Debian 13.5 | Fedora 44 | openSUSE Tumbleweed | Arch | Alpine 3.22 |
|---|---|---|---|---|---|---|
| init | systemd | systemd | systemd | systemd | systemd | busybox/OpenRC |
| libc | glibc | glibc | glibc | glibc | glibc | musl |
| bwrap | 0.12 | 0.12 | 0.12 | 0.13.1 | 0.13.1 | 0.12 |
| node | 24 | 20.19 | 22.23 | 26.12 | 26.12 | 22.23 |
| `sandbox.sh` | 14/14 | 14/14 | 14/14 | 14/14 | 14/14 | 15/15 |
| `agent.sh` | 11/11 | 11/11 | 11/11 | 11/11 | 11/11 | 11/11 |
| `exec.sh` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `substrate.sh` | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 |
| `watch.sh` | 7/7 | 7/7 | 7/7 | 7/7 | 7/7 | 5/5 |
| `session-sandbox.sh` | 10p 1s | 10p 1s | 3p 1r 1s | 3p 1r 1s | 3p 1r 1s | 3p 1d 1s |

`p` = 通过，`s` = 跳过，`r` = 竞态，`d` = 已声明限制。每行结论依据
[`ROADMAP-1.0.md`](ROADMAP-1.0.md)：Ubuntu、Debian、Fedora、openSUSE 和
Arch 为**已支持**；Alpine 在非 systemd 范围声称的全部内容上为**已支持**，
但 `sessionSandbox: auto` 范围更窄。

**Debian 已端到端验证**：除发行版内部套件外，四个 harness 级探针
（`run.sh`、`terminal.sh`、`picker.sh`、`fs-routing.sh`）也针对
`wslfs-debian` profile 通过（2026-10-26）——是完整技术栈，而非只有发行版内
那一半。

## 首次运行发现的陷阱：工作区根目录缺失

Debian 的 harness 级运行暴露出一个真实发现：**当工作区根目录尚不存在时，
受限常驻进程拒绝启动**。bwrap profile 绑定工作区根目录
（`--bind <root> <root>`），bwrap 要求绑定源存在，而在刚导入的发行版上，
探针的工作区（`~/.dsh-fsprobe`）并不存在。对该根目录执行 `mkdir -p` 后，
十个失败步骤全部变绿。此前每次 Ubuntu 运行都因早期探针留下了该目录，所以
这个陷阱从未在那里触发。任何工作区，只要其目录由首次写入惰性创建，在全新
发行版上都会撞上同一堵墙。已在 aa12b49 修复：受限工厂的 prepare 钩子现在
在 bwrap 运行前创建根目录（`mkdir -p`），握手失败时若仍发生，会携带常驻
进程的 stderr，`substrate.sh` 还新增一条全新根目录分支，每次运行都针对不
存在的工作区根目录启动常驻进程，并已在 Debian（glibc）和 Alpine（musl）上
验证。

## 两处已解释的差异

- **`session-sandbox.sh`，后台存活分支（Fedora、openSUSE、Arch）。**
  同为 systemd 的发行版在通过 `wsl.exe` 驱动时对该检查出现分化（Debian
  通过，另外三个不通过）：探针只给 0.5 s 窗口，而 WSL 会话拆除与之竞态。
  这是探针上下文造成的假象，不是插件的主张——插件的后台进程保证依托
  systemd 瞬态 scope，而该分支探针自身标注为“从 WSL 终端运行”。在 Alpine
  上，同一分支**按声明**失败：没有 systemd 时插件不承诺后台存活，
  `sessionSandbox: auto` 改为报告更窄的按命令范围。

- **`watch.sh` 在 Alpine 上（5/5）。** 两项检查在其他发行版上走 inotify
  快速路径，在那里走轮询回退；两种行为都已发布且都有断言，所以计数更低
  反映的是该内核/libc 上被覆盖的路径更少，而不是承诺更弱。

## Tier 2 安装说明（那些陷阱，免得下一次导入重新踩坑）

| 发行版 | 关键的安装步骤 |
|---|---|
| Debian | 首次启动可能在 OOBE 完成前卡死（`wsl.exe` exec 和 `--terminate` 都会挂起）。等状态变为 Stopped 后执行一次 `wsl --terminate <distro>`，再以 root 启动以跳过 OOBE。systemd 开箱即 PID 1。 |
| Alpine | 导入 **minirootfs** tarball（`wsl --import`），不要用 standard/cloud 镜像。创建普通用户并在 `/etc/wsl.conf` 中设置 `[user] default=…`——导入后的默认用户是 root，而 root agent 写出的 0600 文件探针用户无法读取。安装 `coreutils util-linux`（busybox 的 `mktemp`/`ps` 缺少所用选项）以及用于 `useradd` 的 `shadow`。 |
| Fedora / openSUSE / Arch | systemd 开箱即 PID 1。openSUSE：用 `zypper --non-interactive`（裸 `-y` 仍会提示）；Arch：`pacman -Sy --needed`。 |

在最小 Alpine 镜像上，**shell** agent 的 FSB 枚举需要 GNU `findutils`
（BusyBox 的 `find` 缺少 `-printf`）；随包的原生 agent 不需要，`auto` 会
优先选择它。仅在锁定 `agentBackend: shell` 时才安装 `findutils`——doctor
会解码该失败并指出这个包。

各处使用的依赖：`bash bubblewrap git nodejs`（node 20–26 均通过；插件的
`engines` 下限针对 harness 宿主，而非探针节点）。每个发行版的探针运行方式，
在发行版内部执行：

```sh
git clone --depth 1 https://github.com/Big-Dao/dsh-plugin-wsl-env.git
cd dsh-plugin-wsl-env
for p in sandbox session-sandbox agent exec substrate watch; do bash test/probe/$p.sh; done
```

harness 级探针（`run.sh`、`terminal.sh`、`picker.sh`、`fs-routing.sh`）还
需要关闭应用，并使用 `run.sh` 头部给出的临时 `wslfs` profile；在第二个
发行版上，复制该 profile 并设置其 `distro:` 键。

## 范围决策

- **aarch64 仅在 VM 中验证；物理硬件不在范围内（决定日期 2026-10-27）。**
  qemu-user CI 分支每次 push 都对随包二进制执行完整的 18 项检查套件，覆盖
  agent 自身的代码路径；真实硬件唯一能补充的，是对 aarch64 芯片边缘案例的
  暴露，而本项目可触及的 Windows-on-ARM 设备都无法提供这种暴露。支持表将 aarch64
  标记为“supported (executed in CI)”，并保持如此。

- **Windows 10 未单独验证（决定日期 2026-10-27）。** 插件的全部表面是
  `wsl.exe`、发行版和 UNC 共享；在 WSL2 上，这些组件在 Windows 10 与
  Windows 11 上相同，版本相关行为位于上游 WSL 本身，而不在本插件挂载的
  任何内容中。上表测量的是 Windows 11；欢迎通过支持渠道提交 Win10 报告，
  但不计划单独验证。

## 尚未测量

- 由真实 WSL 终端会话驱动的非 systemd 会话范围（探针跳过的分支）。
- ~~容器镜像~~——2026-10-27 关闭：`test/agent-container.mjs` 在 CI 中于
  `debian:stable-slim`、`alpine:3`、`fedora:latest`、
  `opensuse/tumbleweed` 和 `archlinux` 容器内运行真实的 shell agent
  （`agent-containers` 作业，每个镜像一个），各 7 项检查——与就地 digest
  的握手、PING、带退出码和两个流的 EXEC、SETENV，以及在各系列实际有差异处
  检查 `sha256sum`/`base64` 是否存在（Alpine 上是 busybox，其他地方是
  coreutils）。首次执行 35/35。
