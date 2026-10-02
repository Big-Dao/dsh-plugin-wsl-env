# dsh-plugin-wsl-env

[English](README.md) · **中文**

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](LICENSE)

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 会话跑在 WSL 发行版里：命令在**发行版内**执行，模型的文件工具读写发行版的**真实文件**，文件夹选择器能直接打开发行版目录，GUI 终端也开在发行版里，而不是 UNC 目录下的 `cmd.exe`。

**仅限 Windows + WSL2。** 一条安装命令，自身零依赖；WSL 环境**按会话**绑定——工作在 Windows 文件夹上的会话保持原有的 Windows 环境，完全不受影响。

[你能得到什么](#你能得到什么) · [安装](#安装) · [怎么用](#怎么用) · [配置](#配置) · [沙箱](#沙箱) · [排错](#排错) · [已知限制](#已知限制) · [开发](#开发) · [设计注记](#设计注记)

## 你能得到什么

| 不再是 | 而是 |
|---|---|
| 命令在 Windows 上执行 | 命令在**你的发行版里**执行，用你的登录 shell，落在会话的 Linux 目录 |
| `read`/`write`/`edit`/`glob`/`grep` 操作 Windows 路径 | 同一批工具操作**发行版的真实文件**，经由 `\\wsl.localhost\<distro>` 共享 |
| 选择器看不到 WSL | 一个选择器同时列出 Windows 家目录**和每个已装发行版**，会话可直接打开 `/home/you/project` |
| 终端开在 UNC 目录的 `cmd.exe` | 终端开在**发行版内**、会话所在目录，身份是你的发行版用户 |
| 命令没有边界 | 命令被**发行版内的 `bubblewrap`** 约束——见 [沙箱](#沙箱) |

打开发行版文件夹的会话会**自动**获得 WSL 环境：`wsl` agent preset 在会话创建过程中就已绑定，所以第一次工具调用就已经是对的。

**怎么知道它在工作？** 让模型跑 `uname -r`，应看到 WSL2 内核（例如 `6.18.40.1-microsoft-standard-WSL2`）；或 `echo $WSL_DISTRO_NAME`。

## 安装

在 Windows 终端里四条命令：

```powershell
dsh wsl --from-default-profile web --dump-config   # 1. 用 Web 模板建 profile
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 2. 装代码 + 装配置层
dsh --profile wsl --dump-config                    # 3. 只组合不启动（最快的一道检查）
dsh --profile wsl                                  # 4. 启动
```

第 3 步应当看到 `# == dsh-plugin-wsl-env` 这一层，以及被它覆盖的行——尤其是 `- id: terminal-controller` 带着 `shell: { path: wsl.exe, name: WSL }`。

然后回到 GUI：打开 `\\wsl.localhost\<distro>\…` 下的文件夹（选择器在根一级列出每个发行版），或直接按 **New terminal**。

这个包是一个 DSH **bundle**：`package.json` 声明了 `dsh.bundle.patch`，所以第 2 步会把 [`cordis.patch.yml`](cordis.patch.yml) 作为配置层施加进去，**没有任何需要手工合并的补丁**。第 1 步之所以从 Web 模板起步，是因为这一层会**替换** Web 界面的若干行——组合层的 `subprocess` provider、终端控制器、文件夹选择器。

另外还需要：**发行版内安装 `bubblewrap`**（`sudo apt install bubblewrap`）。没有它，每条命令都会失败关闭——见 [沙箱](#沙箱)。

卸载：`dsh plugin --profile wsl remove dsh-plugin-wsl-env`。

以后升级就再装一次，新版本会用 bundle 当前的层替换旧的：`dsh plugin --profile wsl add dsh-plugin-wsl-env`。

> **在 checkout 里改了 `lib/`？必须重启应用。** 运行中的进程缓存 ES module，否则会继续用旧代码。

## 怎么用

一个典型会话：把 `\\wsl.localhost\ubuntu\home\you\project` 作为工作区打开，问一句"我在什么内核上，`/etc/os-release` 说了什么"，模型就会**在发行版内**跑 `uname -r` 并读取该文件——不绕 `/mnt/c`，不复制文件。

- **打开发行版文件夹。** 选择器显示 Windows 家目录，外加每个发行版一项。选 `\\wsl.localhost\ubuntu\home\you\project`，会话工作区、shell 的工作目录、终端都跟着它走。
- **命令**以 `wsl.exe -d <distro> --cd <linux 目录> --exec <你的登录 shell> -lc <cmd>` 执行，所以你的 `PATH`、`nvm`、`cargo`、`pyenv` 和 rc 文件都生效——不是硬编码的 `bash`。
- **文件就是发行版的真实文件。** `/home/you/x` 与 `\\wsl.localhost\ubuntu\home\you\x` 是同一个文件，`/mnt/c/…` 则通向 Windows 磁盘。
- **终端**（右侧栏 → *New terminal*）在发行版内开会话目录下的 shell。
- **模型知道自己的 shell 是什么**：`DSH_WSL_DISTRO`、`DSH_WSL_SHELL`、`DSH_WSL_HOME` 被贡献进受管的 `DSH_*` 命名空间，而 shell 工具会引导模型去看它。
- **权限与 Linux 主机一致。** 权限选择器在 `read-only`、`workspace-write`（默认）、`danger-full-access` 之间切换；被拒绝的命令或写入会带回升级提示，批准后这一次调用以不受约束的方式执行。

## 配置

在你自己的 profile 层里按 id 覆盖行：`$DSH_HOME/profiles/<name>/cordis.patch.yml`（[`examples/profile.cordis.patch.yml`](examples/profile.cordis.patch.yml) 就是一个例子）。标 *(shipped)* 的是 [`cordis.patch.yml`](cordis.patch.yml) 实际设置的值；其余是 schema 默认值，列出来因为它们值得知道。

| 行 | 键 | 默认值 | 含义 |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` *(shipped)* | 发行版名；空表示用 WSL 的默认发行版 |
| | `shell` | `''` | 钉住发行版内的某个 shell；空表示解析该用户的登录 shell |
| | `loginShell` | `true` *(shipped)* | `<shell> -lc`（会加载你的 profile）而非裸 `-c` |
| | `sandbox` | `true` | 用 `bubblewrap` 约束命令；`false` 表示退出约束 |
| | `cwd` | `''` | 默认工作目录；空表示发行版用户的家目录 |
| | `timeoutMs` / `maxTimeoutMs` | `120000` / `600000` *(shipped)* | 单次调用时限与可申请的上限 |
| `wsl-fs` | `distro` | `''` *(shipped)* | 同上 |
| | `restrictToDistro` | `true` *(shipped)* | 拒绝发行版之外的路径（含 `/mnt/c`） |
| | `sandbox` | `true` | 用策略围栏 `writeText`/`editText` |
| | `resolveSymlinks` | `true` | 跟随共享层无法穿越的 Linux 符号链接（`/etc/os-release`、`/bin`） |
| | `cwd` | `''` | 相对路径的基准；空表示发行版用户的家目录 |
| `directory-picker-wsl` | `preferredDistro` | `''` *(shipped)* | 在选择器里排在最前的发行版 |
| | `includeHostHome` | `true` *(shipped)* | 同时列出 Windows 家目录 |
| | `maxEntries` | `1000` *(shipped)* | 单个目录列出条数上限 |
| `subprocess-wsl` | `distro` | `''` *(shipped)* | GUI 终端开在哪个发行版 |
| | `shell` | `''` | 钉住 shell；空表示交给 `wsl.exe` 决定 |
| | `loginShell` | `true` | 钉住 shell 时的登录语义 |

其余 schema 键同样可以覆盖，且各自保留默认值：shell 与终端行的 `wslPath`、`hostCwd`、`forwardEnv`；`wsl-fs` 的 `diffBasisMaxBytes`；选择器的 `distroCacheMs`。

## 沙箱

**一句话版本：** 命令被**发行版内的 `bubblewrap`** 约束，文件工具由同一份策略围栏，而强制程度如实报告为 `partial`——因为发行版进程仍可经 WSL interop 触达 Windows。`bubblewrap` 必须安装，失败模式是**关闭**而不是静默放行。

在 Windows 上，DSH 用 `dsh-sandbox-windows-acl` 约束命令：受限的**低完整性令牌**加写入白名单。**那个令牌根本到不了 WSL**——`wsl.exe` 报 `Wsl/E_ACCESSDENIED`，`\\wsl.localhost\<distro>` 报拒绝访问，而沙箱之外两者都正常。所以 WSL 执行世界无法继承 Windows 沙箱，它改为获得 **Linux 沙箱**：插件在宿主侧构造 `bubblewrap` profile，交给 `wsl.exe --exec`，于是约束在**发行版内**建立并执行：

```text
wsl.exe -d <distro> --cd <linux 目录> --exec bwrap \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp --bind <workspace> <workspace>]  --  <shell> -lc <cmd>
```

这就是 DSH 自己的 Linux 档，逐参数一致（`dsh-sandbox-local`），所以语义与诊断信息都和 Linux 主机对齐：

| 模式 | 发行版内的命令得到什么 |
|---|---|
| `read-only` | 整个发行版只读，仅 `/dev/null` 可写——shell 需要的那个接收器 |
| `workspace-write` | 上述之外，会话工作区被绑为可写，且 `/tmp` 是临时挂载 |
| `danger-full-access` | 完全不加包装；审批通过的升级路径 |

`WslFileSystem` 在它自己的改动路径上围栏同一份策略、同一批可写根，所以不会出现"bash 能写 `/tmp` 而写工具不能"这种不对称。两个 provider 都通过 `sandboxMode` 这个能力事实上报模式，权限选择器和"被拒 → 申请升级"流程就是靠它回来的。

**强制程度是 `partial` 而不是 `full`，这正是诚实之处。** 发行版进程仍可经 interop 执行 **Windows 程序**（`/mnt/c/…/*.exe`）。那不是 Linux 进程：bubblewrap 管不到它，它以你平常的 Windows 令牌运行，能写你所能写的任何位置。`npm run probe:sandbox` 会演示这一点，并会持续演示。堵住它意味着禁止 `/mnt` 下的执行，那同时会打断 `/mnt/c/…` 会话——所以选择如实说明而不是掩盖。网络与进程可见性在所有平台上都不在模式词汇的定义范围内。

**`bubblewrap` 是必需的，而且失败是关闭的。** 没有它时，每条受限命令都报 `SANDBOX_UNAVAILABLE`，而不是悄悄不受约束地运行；能力事实也会随强制一同消失——不可用的 runner 不会留下"已受约束"的宣称。想退出约束就在任一 provider 上设 `sandbox: false`：命令随即不受约束运行，且 `sandboxMode` 返回 `undefined`，于是工具层会如实告诉模型这些操作没有沙箱。

**GUI 终端不受沙箱包装**——它是人的交互式 shell，与官方终端 provider 的行为一致。

## 排错

| 症状 | 原因 | 处理 |
|---|---|---|
| 每条命令都报 `SANDBOX_UNAVAILABLE` | 发行版里没有 `bubblewrap` | `sudo apt install bubblewrap`，或在两个 provider 上都设 `sandbox: false` |
| 命令/写入在会话目录之外被拒 | `workspace-write`，这正是设计行为 | 接受工具给出的升级提示，或直接把会话开在你需要的目录上 |
| 连工作区内写入也被拒 | 会话处于 `read-only` | 切换权限选择器 |
| `dsh plugin add` 警告"没有激活任何层" | 依赖已经装过，`add` 没有可记录的东西 | 先 `dsh plugin --profile wsl remove dsh-plugin-wsl-env`，再装一次 |
| 终端开出来还是 `cmd.exe` | 这一层的 `terminal-controller` 行没生效 | `dsh --profile wsl --dump-config` 应能看到 `shell: { path: wsl.exe, name: WSL }` |
| 改了 `lib/` 却不生效 | ES module 缓存 | 重启应用 |
| `link:\\wsl.localhost\…` 装出一个坏符号链接 | pnpm 无法链接 UNC 路径 | 改为链接 Windows 路径；在发行版内开发需要运行时镜像（见 [开发](#开发)） |
| `glob`/`grep` 很慢 | 宿主 ripgrep 在 9p 共享上遍历 | 属预期——收窄路径，或改用 `bash` 调用发行版内工具 |
| 终端活动显示 `unknown` | 官方 shell 集成只对 POSIX 主机上直接启动的 `bash`/`zsh` 生效 | 关掉标签页释放进程；空闲回收不会对它触发 |

## 已知限制

- **沙箱管不到 WSL interop**（见 [沙箱](#沙箱)）：受限命令仍可运行 Windows 程序，从而越出 Linux 边界。这一点被如实报告为 `enforcement: partial`。
- **必须安装 `bubblewrap`**，否则两个 provider 都会失败关闭。
- `workspace-write` 会把工作区根绑为可写，而 bubblewrap 拒绝源路径不存在的绑定——工作区目录被删掉的会话会因 runner 诊断而失败，而不是被重建。
- 新建文件拿到的是发行版的 umask 默认值（0644）；宿主侧对共享路径 `chmod` 会被静默忽略，而覆盖与编辑**会**保留原权限位。需要可执行位时在发行版内 `chmod +x`。
- 改动护栏是"先检查后使用"，不是原子的：本后端自己检查调用方的护栏，因为宿主后端发布受护栏保护的创建时用的是共享层拒绝的硬链接。这就是 `dsh-fs-sandbox` 已经记录过的那处竞态。
- `watch()` 直接拒绝，而不是在 9p 上不可靠地布防。
- `glob`/`grep` 用宿主 ripgrep 跑在共享层上：结果正确但不快，且 `.gitignore` 语义是宿主的。`editText` 会把整个文件读入内存后重写。
- 终端是**组合**属性，不是会话属性：工作在 Windows 文件夹的会话同样得到发行版终端，只不过起始目录是 `/mnt/<drive>/…`，并且它的 shell 菜单被有意缩减为那一个 profile。
- 终端活动上报止步于 `wsl.exe`，所以控制器针对这些终端的空闲回收永远不会触发。

## 开发

```bash
npm test                     # 语法检查 + 单测——零依赖，任意平台可跑
npm run probe:sandbox        # 在发行版内实测 bubblewrap 到底管住什么
npm run probe                # 针对真实发行版的文件系统探针（仅 Windows + WSL）
npm run probe:sandbox-shell  # 启动真实 harness，驱动受限执行器
npm run probe:terminal       # 经终端 provider 打开一个 PTY
```

目录结构：

```text
lib/paths.js        三套坐标系统之间的纯路径翻译
lib/wsl.js          wsl.exe 互操作原语（不 import DSH）
lib/listing.js      纯目录列举与面包屑助手（不 import DSH）
lib/index.js        WslShellExecutor (ctx.shell) + WslFileSystem (ctx.fs)
lib/sandbox.js      两个 provider 共用的 distro 侧 bwrap 约束
lib/picker.js       WslDirectoryPicker (ctx.directoryPicker)
lib/subprocess.js   WslSubprocessRuntime (ctx.subprocess)——终端窗口
lib/auto-preset.js  按会话选择环境
lib/shell-env.js    DSH_WSL_* 环境事实
lib/{shell,fs}.js   各一行的子路径入口
cordis.patch.yml    bundle 补丁层（dsh.bundle），带逐行注释
examples/           一份机器本地 profile 层，作对照
test/               单测与行为探针
docs/archive/       被本设计替换掉的方案，以及原因
```

`npm test` 覆盖纯模块，并对每个随包模块做一遍 `--check` 语法解析。它无法 import 服务类模块——那些需要裸 checkout 没有的 DSH peer——所以只有真正启动 harness 才能弥合这个求值期缺口；归档记录 §15.4 记下了它曾经导致的五轮误诊。

`test/probe/sandbox.sh` 完全不需要 harness：它施加 `lib/sandbox.js` 构造的精确 profile 参数，断言 bubblewrap 管住什么、管不住什么，并把 interop 逃逸记为 `INFO`——因为 Linux 沙箱无法管辖 Windows 进程。其余探针启动绑定到发行版的一次性 profile：文件系统探针断言发布路径与围栏（策略根之外、以及 `read-only` 下的写入都以 `FS_SANDBOX_DENIED` 被拒，`danger-full-access` 不受围栏），shell 探针经 `ctx.shell` 驱动三种模式并检查工具层渲染的拒绝分类，终端探针断言发行版、初始目录，以及经 `WSLENV` 转发的 `DSH_*` 事实。一次性 profile 的搭建步骤写在 `test/probe/run.sh` 头部；`terminal.sh` 与 `sandbox-shell.sh` 复用它。

**已验证**（Windows 11 + WSL2，Ubuntu 26.04）：seam 接线、UNC 原语与选择器行为；插件在真实 profile 里端到端挂载；WSL-only headless profile 里的**真实模型回合**（`write → chmod → read → edit → execute`，可执行位在编辑后仍然保留）；终端 provider 在一次性 Web 启动与日常 GUI profile 中都成立；沙箱四种方式——发行版内实测 profile 参数、文件系统围栏、shell 路径（`enforcement: partial`，拒绝被正确分类）、以及日常 GUI profile 里 agent 自己的会话在会话工作区之外写入被发行版内拒绝，随后的升级审批成功。数字：42 条单测断言、18 条文件系统探针断言、10 条 shell 探针检查、10 条沙箱预期外加被记录的逃逸、3 条终端断言。

**运行时镜像。** checkout 在发行版内开发，但 harness 是 Windows 进程，而 profile 只能链接 Windows 路径（`link:\\wsl.localhost\…` 会被 pnpm 改写成坏掉的 `/wsl.localhost/…` 符号链接）。因此 `default-workspace/dsh-plugin-wsl` 那份 Windows 副本是**运行时镜像**；启动应用前用 `test/probe/sync-to-windows.sh` 保持同步。那个目标位置在每个会话工作区之外，所以 agent 在受限 shell 里跑同步会被 `workspace-write` 拒绝，需要为这一条命令批准 `danger-full-access`——这是沙箱在按设计工作，不是脚本坏了。不喜欢这个提示就从普通 distro 终端里跑。

**CI** 在 Linux 上以 Node 20、22、24 跑 `npm test`。

## 设计注记

有两处决策在 profile YAML 里看不出来；完整推理、实测数据以及每一个被丢弃的设计都在归档工程记录里——[docs/archive/engineering-record.zh.md](docs/archive/engineering-record.zh.md)。它是历史，不是第二份 README：当它与本文冲突时，以本文为准。

**为什么终端 provider 在组合层。** `ctx.shell` 与 `ctx.fs` 是**按会话**提供的，位于 `wsl` agent preset 的 isolate realm 里，所以宿主工作区保留官方受限的 PowerShell 环境，而 WSL 工作区拿到发行版——同一个进程里并发共存。终端无法这样提供：`dsh-api-terminal-controller` 用 `agent.ctx.get("subprocess")` 解析它的执行世界，而 Agent 的 context 由 agent loop 建在**根** realm 之下，preset 的 isolate realm 则由 `dsh-agent-preset-registry` 建在**注册表自身**的 context 之下。两棵子树永不相交，所以挂在 `preset-wsl` 里的 `subprocess` provider 对终端窗口不可见。于是 [`cordis.patch.yml`](cordis.patch.yml) 替换的是**组合层**的 `subprocess` 行，用一个只覆写 `spawnTerminal` 的子类：普通 `spawn()`、宿主 ripgrep 搜索、pwsh 执行器与 LSP 宿主都原样走官方实现。代价是终端跟着**组合**走而不是跟着会话走（见[已知限制](#已知限制)）。

**为什么沙箱在 Linux 侧。** Windows ACL runner 的受限令牌根本到不了 WSL，所以约束只能在宿主侧构造、在发行版内执行。`lib/sandbox.js` 因此镜像 `dsh-sandbox-local` 的 Linux `bwrap` 档，而不是去消费 `ctx.sandbox`——后者 `dsh-tool-bash` 也从来不问：它读的是执行器的 `sandboxMode` 事实和 `ctx.sandboxPolicy`，而这两样都由本插件提供。

## License

MIT —— 见 [LICENSE](LICENSE)。
