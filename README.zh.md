# dsh-plugin-wsl-env

[English](README.md) · **中文**

[![CI](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml/badge.svg)](https://github.com/Big-Dao/dsh-plugin-wsl-env/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-plugin-wsl-env)](https://www.npmjs.com/package/dsh-plugin-wsl-env)
[![license](https://img.shields.io/npm/l/dsh-plugin-wsl-env)](LICENSE)

这个插件让 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 直接把 WSL 发行版当作工作环境使用。命令在发行版里执行，模型的文件工具读写发行版里的真实文件，打开文件夹时可以直接选择发行版目录，GUI 终端也开在发行版里，而不是开在 UNC 路径下的 `cmd.exe`。

**只支持 Windows + WSL2。** 安装只有一条命令，插件自身没有依赖。WSL 环境按会话生效：会话如果打开的是 Windows 文件夹，它继续使用原来的 Windows 环境，不受影响。

目录：[能做什么](#能做什么) · [安装](#安装) · [使用](#使用) · [配置](#配置) · [沙箱](#沙箱) · [常见问题](#常见问题) · [已知限制](#已知限制) · [开发](#开发) · [设计说明](#设计说明)

## 能做什么

| 原来的行为 | 现在的行为 |
|---|---|
| 命令在 Windows 上执行 | 命令在**你的发行版里**执行，使用你的登录 shell，起始目录是会话的 Linux 目录 |
| `read`/`write`/`edit`/`glob`/`grep` 操作 Windows 路径 | 这些工具直接操作**发行版里的真实文件**，路径经由 `\\wsl.localhost\<发行版名>` 共享访问 |
| 文件夹选择器看不到 WSL | 同一个选择器既列出 Windows 家目录，也列出每个已安装的发行版，可以直接打开 `/home/you/project` |
| 终端开在 UNC 目录下的 `cmd.exe` | 终端开在**发行版里**的会话目录，身份是你的发行版用户 |
| 命令没有沙箱约束 | 命令由**发行版内的 bubblewrap** 约束，见[沙箱](#沙箱)一节 |

如果会话打开的是发行版里的文件夹，WSL 环境会自动生效：创建会话时就会绑定 `wsl` preset，所以第一次调用工具时环境已经正确，不需要手动切换。

**怎么确认它在工作？** 让模型执行 `uname -r`，输出的应该是 WSL2 内核，例如 `6.18.40.1-microsoft-standard-WSL2`。也可以执行 `echo $WSL_DISTRO_NAME`。

## 安装

在 Windows 终端里执行这四条命令：

```powershell
dsh wsl --from-default-profile web --dump-config   # 1. 用 Web 模板创建 profile
dsh plugin --profile wsl add dsh-plugin-wsl-env    # 2. 安装代码和配置层
dsh --profile wsl --dump-config                    # 3. 只做组合检查，不启动（最快）
dsh --profile wsl                                  # 4. 启动
```

第 3 步应该能看到 `# == dsh-plugin-wsl-env` 这一层，以及被它覆盖的行，其中最关键的是 `- id: terminal-controller` 上的 `shell: { path: wsl.exe, name: WSL }`。

然后在 GUI 里打开 `\\wsl.localhost\<发行版名>\...` 下的文件夹（选择器会在根一级列出每个发行版），或者直接点 **New terminal**。

这个包是一个 DSH bundle：`package.json` 里声明了 `dsh.bundle.patch`，所以第 2 步会把 [`cordis.patch.yml`](cordis.patch.yml) 作为配置层加入，不需要手工合并补丁。第 1 步用 Web 模板创建 profile，原因是这一层要覆盖几个只有 Web 界面才有的行：组合层的 `subprocess` provider、终端控制器和文件夹选择器。

还需要在发行版里安装 **bubblewrap**（`sudo apt install bubblewrap`）。没有它时每条命令都会直接失败，原因见[沙箱](#沙箱)。

卸载：`dsh plugin --profile wsl remove dsh-plugin-wsl-env`。

升级：再执行一次 `dsh plugin --profile wsl add dsh-plugin-wsl-env`，新版本会用自带的配置层替换旧层。

> **如果改的是 checkout 里的 `lib/`，必须重启应用。** 运行中的进程会缓存 ES module，不重启就还在用旧代码。

## 使用

一个典型用法：把 `\\wsl.localhost\ubuntu\home\you\project` 作为工作区打开，然后问"当前内核版本是什么，`/etc/os-release` 里有什么"。模型会直接在发行版里执行 `uname -r` 并读取该文件，不需要经过 `/mnt/c`，也不需要复制文件。

- **打开发行版文件夹**：选择器列出 Windows 家目录和每个发行版。选择 `\\wsl.localhost\ubuntu\home\you\project` 之后，会话工作区、shell 的起始目录和终端都会跟着它。
- **命令**以 `wsl.exe -d <发行版> --cd <Linux 目录> --exec <你的登录 shell> -lc <命令>` 的形式执行，所以你的 `PATH`、`nvm`、`cargo`、`pyenv` 和 rc 配置都会生效，而不是固定使用 bash。
- **文件**就是发行版里的真实文件：`/home/you/x` 和 `\\wsl.localhost\ubuntu\home\you\x` 指向同一个文件，`/mnt/c/...` 指向 Windows 磁盘。
- **终端**（右侧栏 → New terminal）在发行版里打开会话目录下的 shell。
- **模型知道自己的 shell 环境**：插件向受管的 `DSH_*` 命名空间注册了 `DSH_WSL_DISTRO`、`DSH_WSL_SHELL` 和 `DSH_WSL_HOME`，shell 工具会引导模型读取这些变量。
- **权限**和在 Linux 主机上一致：权限选择器可在 `read-only`、`workspace-write`（默认）和 `danger-full-access` 之间切换。命令或写入被拒绝时，工具会给出放宽权限的提示；批准后，这一次调用会在不加沙箱的情况下执行。

## 配置

修改配置的方式是在自己的 profile 层里按 id 覆盖某一行。文件是 `$DSH_HOME/profiles/<名字>/cordis.patch.yml`，示例见 [`examples/profile.cordis.patch.yml`](examples/profile.cordis.patch.yml)。下表中标了 *(shipped)* 的值是 [`cordis.patch.yml`](cordis.patch.yml) 里实际设置的值，其余是 schema 的默认值，列出来是因为它们比较常用。

| 行 | 键 | 默认值 | 说明 |
|---|---|---|---|
| `wsl-shell` | `distro` | `''` *(shipped)* | 发行版名；空表示用 WSL 的默认发行版 |
| | `shell` | `''` | 指定发行版内的 shell；空表示用该用户的登录 shell |
| | `loginShell` | `true` *(shipped)* | 用 `<shell> -lc`（会加载你的 profile），而不是裸 `-c` |
| | `sandbox` | `true` | 用 `bubblewrap` 约束命令；`false` 表示不用沙箱 |
| | `cwd` | `''` | 默认工作目录；空表示发行版用户的家目录 |
| | `timeoutMs` / `maxTimeoutMs` | `120000` / `600000` *(shipped)* | 单次调用的时限，以及调用方可以申请的上限 |
| `wsl-fs` | `distro` | `''` *(shipped)* | 同上 |
| | `restrictToDistro` | `true` *(shipped)* | 拒绝发行版之外的路径（包括 `/mnt/c`） |
| | `sandbox` | `true` | 写入时按策略检查 `writeText` 和 `editText` |
| | `resolveSymlinks` | `true` | 跟随共享层无法穿越的 Linux 符号链接，例如 `/etc/os-release`、`/bin` |
| | `cwd` | `''` | 相对路径的基准目录；空表示发行版用户的家目录 |
| `directory-picker-wsl` | `preferredDistro` | `''` *(shipped)* | 在选择器里排在第一位的发行版 |
| | `includeHostHome` | `true` *(shipped)* | 同时列出 Windows 家目录 |
| | `maxEntries` | `1000` *(shipped)* | 单个目录最多列出多少条 |
| `subprocess-wsl` | `distro` | `''` *(shipped)* | GUI 终端开在哪个发行版 |
| | `shell` | `''` | 指定 shell；空表示由 `wsl.exe` 决定 |
| | `loginShell` | `true` | 指定 shell 时是否使用登录语义 |

其余键也可以用同样的方式覆盖，默认值不变：shell 和终端行的 `wslPath`、`hostCwd`、`forwardEnv`；`wsl-fs` 的 `diffBasisMaxBytes`；选择器的 `distroCacheMs`。

## 沙箱

**简单说：** 命令在发行版内由 `bubblewrap` 约束，文件写入按同一份策略检查。但约束范围报为 `partial`（部分生效），因为发行版里的进程仍然可以通过 WSL interop 访问 Windows。bubblewrap 必须安装；缺少它时插件会直接拒绝执行，而不是静默地不加约束。

在 Windows 上，DSH 用 `dsh-sandbox-windows-acl` 约束命令：它使用受限的低完整性令牌和写入白名单。这个令牌**完全无法访问 WSL**：`wsl.exe` 会报 `Wsl/E_ACCESSDENIED`，`\\wsl.localhost\<发行版名>` 会报拒绝访问，而在沙箱之外两者都正常。所以 WSL 执行环境无法沿用 Windows 沙箱，改用 Linux 沙箱：插件在 Windows 侧拼出 bubblewrap 的参数，交给 `wsl.exe --exec` 在发行版内执行。

```text
wsl.exe -d <发行版> --cd <Linux 目录> --exec bwrap \
  --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent \
  [--tmpfs /tmp --bind <工作区> <工作区>]  --  <shell> -lc <命令>
```

这套参数与 DSH 自带的 Linux 方案（`dsh-sandbox-local`）逐参数一致，所以行为和错误信息都与在 Linux 主机上运行相同。

| 模式 | 发行版里的命令得到什么 |
|---|---|
| `read-only` | 整个发行版只读，只有 `/dev/null` 可写，这是 shell 必需的 |
| `workspace-write` | 在上一行基础上，把会话工作区绑定为可写，并把 `/tmp` 挂成临时目录 |
| `danger-full-access` | 完全不加包装，用于批准后的放宽权限请求 |

`WslFileSystem` 在写入路径上使用同一份策略和同一批可写目录，所以不会出现"bash 能写 `/tmp`，但写工具不能"这种不一致。两个 provider 都通过 `sandboxMode` 上报当前模式，权限选择器和"被拒绝 → 申请放宽权限"的流程因此恢复。

**约束范围是 `partial`，不是 `full`，这一点必须说明。** 发行版里的进程仍然可以通过 interop 执行 Windows 程序（`/mnt/c/.../*.exe`）。那不是 Linux 进程，bubblewrap 管不到它；它以你平常的 Windows 令牌运行，能写你有权限写的任何位置。`npm run probe:sandbox` 会实际演示这一点，并且以后每次运行都会再确认一次。要堵住这个缺口，就必须禁止执行 `/mnt` 下的程序，而那会同时切断 `/mnt/c/...` 会话，所以这里如实说明，不做掩盖。网络和进程可见性在所有平台上都不属于这个模式的管辖范围。

**bubblewrap 是必需项，缺少时会直接失败。** 没有它时，每条受约束的命令都会报 `SANDBOX_UNAVAILABLE`，不会退化成不加约束地执行；同时 `sandboxMode` 也不再上报，避免出现"声称有沙箱、实际没有"的情况。确实不想用沙箱时，可以在任一 provider 上设 `sandbox: false`：命令会不加约束地执行，`sandboxMode` 返回 `undefined`，工具层会如实告诉模型这些操作没有沙箱。

**GUI 终端不受沙箱约束。** 它是给人用的交互式 shell，与官方终端 provider 的行为一致。

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

## 已知限制

- **沙箱管不到 WSL interop**，见[沙箱](#沙箱)：受约束的命令仍然可以运行 Windows 程序，从而超出 Linux 侧的约束范围。插件把这种情况报为 `enforcement: partial`。
- **必须安装 `bubblewrap`**，否则两个 provider 都会直接失败。
- `workspace-write` 会把工作区根目录绑定为可写，而 bubblewrap 不允许绑定的源目录不存在。所以如果会话的工作区目录被删掉，命令会因 runner 报错而失败，插件不会替你重建目录。
- 新建文件的权限是发行版的 umask 默认值（0644）。在 Windows 侧对共享路径执行 `chmod` 会被静默忽略；覆盖和编辑会保留原有权限位。需要可执行权限时，请在发行版内执行 `chmod +x`。
- 写入前的检查是"先检查再写入"，不是原子操作。本后端自己检查调用方的守卫，因为 Windows 后端发布受守卫保护的新建文件时使用硬链接，而共享层不支持硬链接。这是 `dsh-fs-sandbox` 已经记录过的竞态。
- 不提供 `watch()`（文件变更监视）。9p 共享上的监视不可靠，所以直接拒绝，而不是勉强启用。
- `glob`/`grep` 使用 Windows 侧的 ripgrep 在共享路径上搜索：结果正确，但速度不快，`.gitignore` 规则也按 Windows 侧的规则处理。`editText` 会把整个文件读入内存后再写回。
- 终端属于整个应用（组合层），不属于单个会话。所以工作在 Windows 文件夹的会话也会打开发行版终端，起始目录是 `/mnt/<盘符>/...`，并且它的 shell 菜单被有意缩减为配置里的那一个。
- 终端活动状态的上报止步于 `wsl.exe`，所以控制器不会对这些终端触发空闲回收。

## 开发

```bash
npm test                     # 语法检查 + 单元测试，无依赖，任何平台都能跑
npm run probe:sandbox        # 在发行版里实测 bubblewrap 能约束什么、不能约束什么
npm run probe                # 文件系统探针，需要真实发行版（仅 Windows + WSL）
npm run probe:sandbox-shell  # 启动真实 harness，驱动受限执行器
npm run probe:terminal       # 通过终端 provider 打开一个 PTY
```

目录结构：

```text
lib/paths.js        三套路径写法之间的纯转换函数
lib/wsl.js          wsl.exe 互操作原语（不 import DSH）
lib/listing.js      目录列举与面包屑的纯函数（不 import DSH）
lib/index.js        WslShellExecutor（ctx.shell）和 WslFileSystem（ctx.fs）
lib/sandbox.js      两个 provider 共用的发行版内 bwrap 约束
lib/picker.js       WslDirectoryPicker（ctx.directoryPicker）
lib/subprocess.js   WslSubprocessRuntime（ctx.subprocess），即终端窗口
lib/auto-preset.js  按会话选择环境
lib/shell-env.js    注册 DSH_WSL_* 环境变量
lib/{shell,fs}.js   各一行的子路径入口
cordis.patch.yml    bundle 配置层（dsh.bundle），带逐行注释
examples/           一份本机 profile 层，作为对照
test/               单元测试和行为探针
docs/archive/       被本设计替换掉的方案，以及原因
```

`npm test` 覆盖纯模块，并对每个随包模块执行一次 `--check` 语法检查。它无法 import 服务类模块，因为这些模块需要 DSH 的 peer 包，而裸 checkout 里没有。这个缺口只有在真正启动 harness 时才会暴露；归档记录 §15.4 记录了它曾经导致的五轮误诊。

`test/probe/sandbox.sh` 不需要 harness：它使用 `lib/sandbox.js` 生成的同一套参数，断言 bubblewrap 能约束什么、不能约束什么，并把 interop 逃逸记为 `INFO`，因为 Linux 沙箱管不了 Windows 进程。

其余探针会启动绑定到发行版的一次性 profile：

- 文件系统探针断言写入路径和写入检查。策略根目录之外、以及 `read-only` 模式下的写入都会返回 `FS_SANDBOX_DENIED`，`danger-full-access` 不做检查。
- shell 探针通过 `ctx.shell` 驱动三种模式，并检查工具层返回的拒绝分类。
- 终端探针断言发行版、起始目录，以及经 `WSLENV` 转发的 `DSH_*` 变量。

一次性 profile 的搭建步骤写在 `test/probe/run.sh` 的头部；`terminal.sh` 和 `sandbox-shell.sh` 复用它。

**已验证**（Windows 11 + WSL2，Ubuntu 26.04）：与各服务接入点的对接、UNC 路径处理和选择器行为；插件在真实 profile 里端到端挂载；在仅 WSL 的 headless profile 里完成一次真实模型回合（`write → chmod → read → edit → execute`，编辑后可执行权限仍然保留）；终端 provider 在一次性 Web 启动和日常 GUI profile 中都成立；沙箱用四种方式验证：在发行版里实测参数、文件系统写入检查、shell 路径（`enforcement: partial`，拒绝被正确分类）、以及日常 GUI profile 里 agent 自己的会话在会话工作区之外写入时被发行版内拒绝、随后的放宽权限请求成功。数量：42 条单元测试断言、18 条文件系统探针断言、10 条 shell 探针检查、10 条沙箱预期另加被记录的逃逸、3 条终端断言。

**运行时镜像。** checkout 在发行版内开发，但 harness 是 Windows 进程，而 profile 只能链接 Windows 路径：pnpm 会把 `link:\\wsl.localhost\...` 改写成坏掉的 `/wsl.localhost/...` 符号链接。所以 `default-workspace/dsh-plugin-wsl` 这份 Windows 副本是运行时镜像，启动应用前用 `test/probe/sync-to-windows.sh` 同步。该目标目录不在任何会话工作区内，所以 agent 在受限 shell 里执行同步时会被 `workspace-write` 拒绝，需要为这一条命令批准 `danger-full-access`。这是沙箱的预期行为，不是脚本坏了；不想看到提示就在普通 distro 终端里执行。

**CI** 在 Linux 上用 Node 20、22、24 运行 `npm test`。

## 设计说明

有两处设计从 profile YAML 里看不出来。完整推理、实测数据和所有被放弃的方案都在归档工程记录里：[docs/archive/engineering-record.zh.md](docs/archive/engineering-record.zh.md)。它是历史文档，不是第二份 README；如果它与本文冲突，以本文为准。

**为什么终端 provider 放在组合层。** `ctx.shell` 和 `ctx.fs` 是按会话提供的，位于 `wsl` agent preset 的 isolate realm 中。因此宿主工作区继续使用官方受限的 PowerShell 环境，WSL 工作区使用发行版，两者可以在同一个进程里同时存在。

终端无法这样提供。`dsh-api-terminal-controller` 通过 `agent.ctx.get("subprocess")` 查找执行环境。Agent 的 context 由 agent loop 创建在**根** realm 之下；preset 的 isolate realm 则由 `dsh-agent-preset-registry` 创建在**注册表自身的** context 之下。这两条作用域链不会相交，所以挂在 `preset-wsl` 里的 `subprocess` provider 对终端窗口不可见。

因此 [`cordis.patch.yml`](cordis.patch.yml) 替换的是**组合层**的 `subprocess` 行，换成一个只覆写 `spawnTerminal` 的子类。普通的 `spawn()`、Windows 侧的 ripgrep 搜索、pwsh 执行器和 LSP 宿主都仍然走官方实现。代价是终端跟着组合走，而不是跟着会话走，见[已知限制](#已知限制)。

**为什么沙箱放在 Linux 侧。** Windows ACL runner 的受限令牌完全到不了 WSL，所以约束只能在 Windows 侧构造、在发行版内执行。`lib/sandbox.js` 因此照搬 `dsh-sandbox-local` 的 Linux `bwrap` 方案，而不是去用 `ctx.sandbox`；后者 `dsh-tool-bash` 从来不用，它读的是执行器的 `sandboxMode` 和 `ctx.sandboxPolicy`，这两样都由本插件提供。

## 许可

MIT，见 [LICENSE](LICENSE)。
