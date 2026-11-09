# Configuration

_本页是权威版本；英文译本见 [CONFIGURATION](CONFIGURATION.md)。_

## Profile patch

profile 设置存放在 `$DSH_HOME/profiles/<name>/cordis.patch.yml`。可以用
[`examples/profile.cordis.patch.yml`](../examples/profile.cordis.patch.yml)
作为起点。随包的
[`cordis.patch.yml`](../cordis.patch.yml) 列出了本插件附带的行和值。

profile 层可以按 `id` 指向顶层行。这一层的插件行包括 `fs-routing`、
`directory-picker-wsl`、`subprocess-wsl`、`wsl-shell-env`、`wsl-preflight`、
`auto-preset` 和 `preset-wsl`。`wsl-shell` 和 `wsl-fs`
两行嵌套在 `preset-wsl.config.plugins` 内；直接按这两个 id 配置的
profile 条目会被忽略，并产生 `patch: entry <id> not found` 警告。

一行的 `config` 是整体替换。如果你想保留随包行中的非默认值，
必须把它们一并写入。这对 `preset-wsl` 尤其重要：
它的 config 包含完整的 preset 及其嵌套插件。

在下表中，**shipped** 表示该值在随包行中被显式设置。
其他值是 schema 默认值。省略的键使用 schema 默认值。

## 配置 `wsl-shell` 和 `wsl-fs`

这两行嵌套在 `preset-wsl` 内。使用辅助脚本修改它们的设置：

```bash
pnpm run preset --distro Ubuntu --session-sandbox false
```

支持的修改是 `--distro`、`--session-sandbox`、`--sandbox`、
`--mask-windows-drive` 和 `--agent-backend`。不带 `--out` 时，辅助脚本
把完整的 `preset-wsl` 块打印出来，供你手动合并进 profile。
使用 `pnpm run preset --check <file>` 可以检测直接指向嵌套行的
profile 层；检测到时会打印应使用的块。`--out` 会整体替换目标文件，
包括其中的其他覆盖，即使它已经包含 `preset-wsl` 行。
在不包含该行的文件已存在时，替换会被拒绝，除非传入 `--force`。
对已有 profile 建议手动合并。

要手动编辑 preset，需替换整个 `preset-wsl` 行。它的 config
不做深度合并：保留 `id`、`order` 以及 `plugins` 中的每一项。
从 `cordis.patch.yml` 或 `dsh --profile <name> --dump-config`
（CLI 发行版；桌面应用没有 `dsh` 命令）
复制当前块，再修改嵌套的值。插件升级改变了 preset 后要重新复制。

### `wsl-shell`

| 键 | 默认 / shipped 值 | 说明 |
|---|---|---|
| `distro` | `''`（shipped） | 空或 `auto` 跟随请求工作目录所属的发行版。`default` 选择 WSL 默认发行版；给出名字则把命令固定到该发行版。 |
| `shell` | `''` | 空则解析发行版用户的登录 shell（先 `getent passwd`，再 `$SHELL`）。两条探测都失败时命令直接报错，而不是落到另一个 shell——在此设置绝对 Linux 路径可固定一个。 |
| `loginShell` | `true`（shipped） | 对 POSIX shell 使用登录语义。非 POSIX shell 使用各自的命令形式。 |
| `agent` | `true` | 使用常驻 agent。不可用时，命令走一次性的 `wsl.exe` 路径。设为 `false` 则总是走该路径。Cwd 与沙箱拒绝会被直接返回。 |
| `agentBackend` | `auto`（shipped） | `auto` 选择包内 `agent/native/linux-<arch>/dsh-wsl-agent` 的静态 musl 二进制或 `DSH_WSL_AGENT_NATIVE` 覆盖；否则使用 shell agent。`native` 在准备失败时报错；`shell` 强制使用 shell agent。适用于命令、受限写入和共享读取。 |
| `sessionSandbox` | `false`；shipped 为 `true` | `true` 把会话跑在一个持久的 systemd user scope 中。要求 `agent: true`、systemd 为 PID 1（`/etc/wsl.conf` 中 `[boot] systemd=true`）、一个 user manager、`systemd-run` 和 Linger（`loginctl enable-linger <user>`）。`false` 使用按命令的沙箱。`auto` 在可用时使用 scope，否则按命令约束。结果会报告 `sessionScope: 'session'` 或 `'per-command'`。 |
| `sandbox` | `true` | 用 `bwrap` 约束命令。`bwrap` 缺失或不可用时关闭（fail closed）。`false` 则不加约束地运行命令。 |
| `interopVisibility` | 未设置；有效默认值为 `visible` | `visible`、`masked` 或 `disabled`。设置后优先于 `maskWindowsDrive`。见 [Windows interop](#windows-interop)。 |
| `maskWindowsDrive` | `false` | 对受限命令，在 `/mnt` 上挂载空的 tmpfs。见 [Windows interop](#windows-interop)。 |
| `cwd` | `''` | 默认工作目录。空则使用发行版用户家目录。 |
| `timeoutMs` / `maxTimeoutMs` | `120000` / `600000`（shipped） | 默认的单次调用超时，以及一次调用可请求的最大超时。 |
| `wslPath` | `wsl.exe` | `wsl.exe` 的路径。 |
| `hostCwd` | 未设置 | `wsl.exe` 进程的 Windows 工作目录。可用时默认为 `%SystemRoot%`。 |
| `forwardEnv` | `[]` | 额外通过 `WSLENV` 转发的宿主环境变量名。见 [环境变量转发](#环境变量转发)。 |

### `wsl-fs`

| 键 | 默认 / shipped 值 | 说明 |
|---|---|---|
| `distro` | `''`（shipped） | 空或 `auto` 跟随目标路径所属的发行版。`default` 选择 WSL 默认发行版；给出名字则固定文件系统。 |
| `restrictToDistro` | `true`（shipped） | 固定发行版时，以 `FS_OUTSIDE_DISTRO` 拒绝属于其他发行版共享的路径。 |
| `sandbox` | `true` | 按沙箱策略检查写入。`bwrap` 不可用时，受限写入关闭（fail closed）。 |
| `sessionSandbox` | `false`；shipped 为 `true` | 使用与 `wsl-shell` 相同的会话 runtime。`auto` 在会话 runtime 不可用时回退到按策略约束的常驻 agent。 |
| `maskWindowsDrive` | `false` | 对受限变更隐藏 `/mnt`。读取不受影响。 |
| `substrate` | `agent`（shipped） | 文件操作使用发行版内 agent。旧值 `share` 在启动时被拒绝。 |
| `cwd` | `''` | 相对路径的基准目录。空则使用发行版用户家目录。 |
| `watchMaxDepth` | `0` | 监视整棵树。正值深度使用有界轮询，可能遗漏边界以下的变更，直到边界之上发生变更触发回调。 |
| `wslPath` | `wsl.exe` | `wsl.exe` 的路径。 |
| `diffBasisMaxBytes` | `10485760` | 覆盖写入 diff 每一侧的 UTF-8 字节上限。更大的文件不带 diff 直接写入。 |

### `fs-routing`

这个顶层行为根级 `ctx.fs` 调用提供服务。它把发行版 UNC 路径
路由到 agent 支撑的文件系统，把盘符路径路由到宿主文件系统。它的
发行版设置独立于 `wsl-fs`。
Loader 在挂载该行之前会校验宿主和发行版设置；
被 schema 拒绝的值会阻止路由器启动。字段值为 `null`
时使用其 schema 默认值。

| 键 | 默认 / shipped 值 | 说明 |
|---|---|---|
| `distro` | `''`（shipped） | 空或 `auto` 把每条 UNC 路径路由到其命名的发行版。`default` 选择 WSL 默认发行版；给出名字则固定路由。 |
| `wslPath` | `wsl.exe`（shipped） | `wsl.exe` 的路径，用于解析默认发行版。 |
| `sandbox` | `true`（shipped） | 按 `ctx.sandboxPolicy` 检查被路由的变更；`bwrap` 不可用时关闭（fail closed）。无论该围栏启用与否，该行都报告 `sandboxMode: undefined`。 |
| `maskWindowsDrive` | `false`（shipped） | 对受限的被路由变更隐藏 `/mnt`。 |
| `restrictToDistro` | `true`（shipped） | `distro` 被固定时，拒绝属于其他发行版共享的路径。 |
| `watchMaxDepth` | `0`（shipped） | 监视整棵树。正值深度使用有界轮询。 |
| `distroCwd` | `''` | 默认发行版工作目录；空则使用发行版用户家目录。 |
| `cwd` | `process.cwd()` | 宿主文件系统后端的工作目录。 |
| `diffBasisMaxBytes` | `10485760` | 宿主与被路由后端共享的覆盖写入 diff 上限。 |

根路由器是应用层的，不属于会话，因此不使用
`sessionSandbox`。

### 选择器与终端行

| 行 | 键 | 默认 / shipped 值 | 说明 |
|---|---|---|---|
| `directory-picker-wsl` | `preferredDistro` | `''`（shipped） | 首位展示的发行版，也是 Home 位置使用的发行版。 |
| | `includeHostHome` | `true`（shipped） | 包含 Windows 家目录。 |
| | `maxEntries` | `1000`（shipped） | 单个目录返回的最大条目数。 |
| | `wslPath` | `wsl.exe` | `wsl.exe` 的路径。 |
| | `distroCacheMs` | `5000` | 发行版列表的缓存时长。 |
| `subprocess-wsl` | `distro` | `''`（shipped） | 空或 `auto` 跟随启动目录所属的发行版。`default` 选择 WSL 默认；给出名字则固定发行版。 |
| | `shell` | `''` | 在发行版内固定的 shell。空则由 `wsl.exe` 选择登录 shell。 |
| | `loginShell` | `true` | 固定 shell 时的登录语义。 |
| | `hostSessions` | `true` | 在 Windows 文件夹上打开的会话，会在该文件夹中获得宿主 PowerShell。WSL 文件夹会话使用发行版 shell。设为 `false` 则所有会话都使用 composition 拥有的终端。 |
| | `terminalIdleReclaim` | `true` | 依据被标记的进程回收空闲的发行版终端。活动状态未知时暂停回收。 |
| | `cwd` | `''` | 未提供启动目录时的回退目录。 |
| | `wslPath` | `wsl.exe` | `wsl.exe` 的路径。 |
| | `hostCwd` | 未设置 | `wsl.exe` 进程的 Windows 工作目录。可用时默认为 `%SystemRoot%`。 |
| | `forwardEnv` | `[]` | 额外通过 `WSLENV` 转发的宿主环境变量名。 |

### 其他顶层行

| 行 | 键 | 默认值 | 说明 |
|---|---|---|---|
| `auto-preset` | `preset` | `wsl` | 会话工作区位于发行版内时绑定的 preset。操作者的显式选择会被保留。 |
| | `attempts` | `6` | 绑定 preset 的尝试次数。 |
| | `retryMs` | `150` | 两次尝试之间的延迟，单位毫秒。 |
| `wsl-preflight` | `distro` | `''` | 要检查的发行版。空或 `auto` 跟随会话工作区。 |
| | `wslPath` | `wsl.exe` | `wsl.exe` 的路径。 |
| | `sandbox` | `true` | 运行会话启动时的 `bwrap` 检查。 |
| | `sessionSandbox` | `true` | 同时检查 systemd、user manager、`systemd-run` 和 Linger。profile 不使用会话 runtime 时设为 false。 |
| | `startup` | `true` | 插件加载时（即安装 + 重启后）对 pin 的或 WSL 默认发行版预先运行同一组检查，让判定在任何会话打开之前就出现在日志里。 |
| `wsl-shell-env` | `distro` | `''` | 用于填充 `DSH_WSL_*` 环境事实的发行版。 |
| | `portsRefreshMs` | `10000` | 监听端口快照的刷新间隔，单位毫秒。 |
| `wsl-update-check` | `enabled` | `true` | 插件是否向应用的插件管理器查询更新的稳定版。结果经 `DSH_WSL_PLUGIN_UPDATE` 送达；该检查从不安装。 |
| | `intervalMs` | `86400000` | 检查间隔，单位毫秒（启动后 2–10 分钟首查）；下限一分钟。 |

GUI 文件树和预览通过 `fs-routing` 使用随包的 `workspace-files` 行；
它们不使用单独的 WSL 提供者行。要修改其 peer 定义的限额，
在 profile 层按 id 覆盖 `workspace-files`。

## 共享的命令设置

shell 行从 `@deepseek-ai/dsh-bash-local` 继承输出与进程设置：

| 键 | 默认值 | 说明 |
|---|---|---|
| `maxOutputBytes` | `64000` | 每条流的捕获输出上限。agent 在发行版内执行该限制，并标记被截断的结果。 |
| `maxSpillBytes` | `67108864` | 一次性路径上每条流的 spill 文件上限。 |
| `graceMs` | `3000` | SIGTERM 与 SIGKILL 之间的宽限期。 |

`agent: true` 时，输出在发行版内被限制，且不写 spill 文件。
`maxSpillBytes` 和 `graceMs` 适用于 `agent: false`，或常驻 agent
不可用而改走一次性 `wsl.exe` 的情况。

### 模型运行命令的 zsh/fnm 配方

命令以 `<shell> -lc` 运行，因此 `~/.zshrc` 永远不会被读取——原因见
[LIMITATIONS](LIMITATIONS.md#shell-startup-semantics-wsl-shell)。把 fnm 的
hook 放进 `~/.zprofile`，并为沙箱准备一个回退——沙箱中 `/run` 是只读的，
fnm 无法创建它的 multishell 符号链接目录：

```zsh
# ~/.zprofile — fnm for non-interactive login shells (mirrors the ~/.zshrc hook)
path=("$HOME/.local/share/fnm" $path)  # the fnm binary itself
_fnm_env="$(command -v fnm &>/dev/null && fnm env --shell zsh 2>/dev/null)" && eval "$_fnm_env"
if [[ -z "${FNM_MULTISHELL_PATH:-}" || ! -e "${FNM_MULTISHELL_PATH}/bin/node" ]]; then
  path=("$HOME/.local/share/fnm/aliases/default/bin" $path)  # sandbox fallback
fi
unset _fnm_env
```

交互式终端仍使用 `~/.zshrc` 中的 hook，不受影响；
`aliases/default` 回退只在 multishell 链接无法存在时接管。

## 环境变量转发

只有名字列在 `WSLENV` 中的宿主环境变量才会被 WSL 导入。各提供者
默认转发 `NO_COLOR`、`TERM`、`PAGER`、`GIT_PAGER`、`LANG`、`LC_ALL`
以及托管的 `DSH_*` 名字。`forwardEnv` 向该列表追加名字；
`PATH` 永远不会被转发。

对 `wsl-shell` 而言，`forwardEnv` 只作用于一次性 `wsl.exe` 路径。
常驻 agent 只接收托管的 `DSH_*` 环境，因此 `forwardEnv` 里的自定义名字
不会到达经由该 agent 运行的命令。`subprocess-wsl` 的设置
作用于它的 WSL 启动。

## 发行版选择

对命令与终端行而言，空的 `distro` 或 `distro: auto` 跟随
请求的 UNC 工作目录。当请求未指明发行版时，使用 WSL 的
默认发行版。对 `wsl-fs`，`auto` 跟随每个目标路径。对
`fs-routing`，每条 UNC 目标各自选择自己的发行版。

`distro: default` 总是选择 WSL 的默认发行版。给出发行版名字则把该行
固定到那个发行版。`restrictToDistro: true` 时，属于其他发行版共享的路径
会被以 `FS_OUTSIDE_DISTRO` 拒绝。挂载在 `/mnt/c` 的 Windows 盘
位于所选发行版之内，不会被这个围栏拒绝。

## Windows interop

`interopVisibility` 控制是否对受限命令遮蔽 `/mnt`；
它本身不会禁用 Windows interop。未设置时，`maskWindowsDrive: false`
给出 `visible` 行为。

| 值 | 效果 |
|---|---|
| `visible` | 保持 `/mnt` 可见。受限命令可以读取 Windows 文件，并通过 WSL interop 启动 Windows 可执行文件。 |
| `masked` | 在受限 profile 中，把空的 tmpfs 挂载到 `/mnt` 上。命令无法访问 `/mnt` 下的路径；其他挂载与不受限的文件读取不在覆盖范围内。 |
| `disabled` | 施加与 `masked` 相同的 `/mnt` 遮蔽；它不会禁用 interop，也不会修改 `wsl.conf`。请按下文单独配置发行版。 |

`maskWindowsDrive: true` 等价于 `interopVisibility: masked`。
设置了 `interopVisibility` 时，它优先于
`maskWindowsDrive`。

### 三个场景 × 四个作用面

设置改变什么，取决于哪个面在起作用。受限命令运行在 `wsl-shell`
沙箱中；受限写入由 `wsl-fs` 的写入沙箱检查；非受限文件读取走共享读
agent，不受沙箱管辖；Windows 侧宿主操作指最终在 Windows 上执行的任何
东西。

| 作用面 | `visible`（默认） | `masked` | 发行版级 `enabled=false` |
|---|---|---|---|
| 受限命令（`wsl-shell`） | 可读 Windows 文件、经 `/mnt` 启动 Windows 可执行文件 | profile 中 `/mnt` 是空 tmpfs：其下的路径操作失败 | interop 由发行版自身拒绝；`/mnt` 可见性仍遵循上方的遮蔽设置 |
| 受限写入（`wsl-fs`） | 写入策略检查目标；`/mnt` 可见性不起作用 | 同样的遮蔽作用于写入 profile | 不变——写入边界从来不依赖 interop |
| 非受限读取（共享读 agent） | 自由读 `/mnt` | **不在覆盖范围**：遮蔽只存在于受限 profile 中，读 agent 仍能看到 `/mnt` | **不归插件管辖** |
| Windows 侧宿主操作 | 可经 `/mnt` 到达 | **仍然可达**：`binfmt_misc` 按文件内容分发，被拷进工作区的 Windows 可执行文件照样运行（`enforcement: partial`） | 唯一真正的关闭手段——且是手工的 `wsl.conf` 步骤 |

遮蔽刻意影响真实工作流：放在 Windows 路径下的脚本（`/mnt/c` 下的
检出、Windows `PATH` 上的工具）不再能被受限命令读取或执行——把它移进
发行版，或改用 `visible` 姿态。遮蔽不会删除任何东西：tmpfs 只遮蔽单个
受限 profile 内的视图，`/mnt/c` 上的文件原样保留。

遮蔽只是收窄访问，并不关闭 interop。WSL 仍能运行被写入工作区的
Windows 可执行文件，因为 `binfmt_misc` 按文件内容分发。
因此强制级别仍是 `partial`，结果会报告 `windowsDrive: 'masked'`。
要在该发行版上禁用 interop，把下面这段加进 `/etc/wsl.conf`：

```ini
[interop]
enabled=false
```

然后运行 `wsl.exe --shutdown`。要关闭 interop，必须做这一发行版级修改。

要对两个嵌套行都应用 masked profile：

```bash
pnpm run preset --sandbox true --mask-windows-drive true
```

把打印出的块合并进 profile。`visible` 与 `masked` 的行为
由 `test/probe/interop-shell.sh` 对常驻与一次性两种命令都有覆盖。
发行版级的 disabled 状态需要手动检查，因为它会改动 WSL 配置。

## 沙箱与预检

`wsl-shell`、`wsl-fs` 和 `fs-routing` 的默认值都是 `sandbox: true`。
受限命令与变更要求发行版内有可用的 `bwrap`。缺失或不可用时，
命令以 `SANDBOX_UNAVAILABLE` 失败，写入以 `FS_IO_ERROR` 失败；
两种操作都不会回退到无约束运行。错误信息会区分
包缺失与 `bwrap` 存在但不可用两种情况。

用 bootstrap 辅助脚本安装该前置依赖：

```bash
scripts/bootstrap.sh <distro> --install
```

不带 `--install` 时，辅助脚本只做只读检查。在基于 apt 的
发行版上，直接安装命令是：

```bash
wsl.exe -d <distro> -u root -- apt-get install -y bubblewrap
```

会话打开时，`wsl-preflight` 行会运行这些检查；`startup: true`（默认）时，
插件加载阶段还会对 pin 的或 WSL 默认发行版预先运行同一组检查，因此安装加
重启之后判定就已经出现在日志里，该发行版上的会话只会重复注入运行时上下文条目。
`sessionSandbox: true` 时，它还会检查会话 runtime 的前置条件。
该警告仅供参考：它不会安装软件包，也不会改变提供者关闭（fail-closed）
的行为。在该行设置 `sandbox: false` 或移除该行可让沙箱警告静音。
profile 不使用会话 runtime 时，设置 `sessionSandbox: false`。

在 `wsl-shell` 或 `wsl-fs` 上设置 `sandbox: false` 后，命令或写入
将无约束地运行；其 `sandboxMode` 变为 `undefined`。工具层
会报告没有沙箱生效。在 `fs-routing` 上，该设置会禁用变更围栏；
无论开关如何，该行都报告 `sandboxMode: undefined`。

### 消息语言

插件的拒绝与修复消息（`sessionSandbox` 预检判定、`bwrap` 的安装与修复提示、
发行版/工作目录命令错误）跟随 harness 应用的语言设置：偏好经宿主 settings
服务从 `locale` 条目的 `preference` 字段读取，切换语言无需重启应用。
内置中文（`zh`，含 `zh-CN`、`zh-Hans` 标签）与英文；其他语言渲染英文。
没有 settings 服务的 profile、或用户从未在设置中选过语言的情况，回退到
进程的 ICU 默认区域设置——桌面应用中即操作系统 UI 语言——因此临时渲染为
中文界面的 zh-CN Windows 仍显示中文；显式的设置选择始终优先于该回退。
消息内的命令、配置键与文件路径一律不翻译。两组消息按设计保持英文：
`fs-decisions` 中的 `FS_*` 拒绝文本与 fsio 复刻（工具层按字节匹配这些
字符串）。独立运行的 `scripts/doctor.mjs` 自带 catalog：固定骨架按宿主
语言渲染——从 Windows 区域设置检测，可用 `--locale <标签>` 或
`DSH_WSL_DOCTOR_LOCALE` 覆盖——而逐项检查的标题、详情与修复保持英文
（修复文本携带可复制的命令），`--json` 保持语言无关。

## 诊断配置问题与拒绝

在会话中模型可以自行运行诊断：`wsl_doctor` 工具（挂载在 `preset-wsl` 内）
进程内调用 doctor，以逐项清单返回判定——每个检查带显式状态标记、按 distro
分组、失败项下附可复制的修复——用户只要请求诊断即可。该工具按设计是交互式
的：`depth: "quick"`（默认）只跑前置项（单 distro 约 10 秒：宿主事实、会话
沙箱四件套、bubblewrap——无冒烟、无 registry 查询、无端口勘察），是正确的
首次调用；`section` 把跟进收窄到一个区域（`host`、`sandbox`、`session`、
`conf`、`net`、`agent`）；`depth: "full"` 是完整扫描，对所有检查负责。
`/wsl-doctor` 命令（`wsl-doctor-command` 行，部署具有命令注册表时注册）在
宿主侧运行同样的诊断——语法 `[quick|full|<分区>] [--distro <名称>]`——并把
同样的清单渲染在 UI 上，不进模型历史。CLI 镜像同样的范围控制：`--quick` 与
`--sections <csv>` 限定一次运行探测什么，范围化的 `--json` 报告携带其
`scope`，裁决总是指明它回答的范围（`--fix` 仍要求完整运行）。
`DSH_WSL_DOCTOR` 还携带一条现成命令，可在发行版内执行 doctor 脚本（以应用
自身的运行时当 Node、经 interop）——运行方式为 `sh -c "$DSH_WSL_DOCTOR --json"`。
`pnpm run doctor` 是一键环境体检：Windows/WSL 版本、每个发行版的 WSL 模式、
`.wslconfig` 与 `/etc/wsl.conf` 交叉核对、磁盘、时钟、DNS、发行版及其 shell、
bubblewrap、systemd/Linger、peer 下限、新 agent 握手、残留会话 scope、已知的
profile 补丁与废弃键陷阱——每个失败附可复制的修复。运行以生效配置下计算的
裁决（`ready` 或 `blocked`）收尾：`--json` 是机器契约（schemaVersion 2），
`--fix` 复核它修过的项（安装软件包需要 `--fix --install` 并显式确认），
`--all` 检查每个已装发行版，`--bundle <路径>` 写出可附加的诊断文件
（`--redact` 脱敏路径），`--locale <标签>`（或 `DSH_WSL_DOCTOR_LOCALE`）
无需重新探测即可选择骨架语言。`--yes` 跳过确认提示（不跳过确认门本身），
`--read-only` 拒绝与 `--fix` 或 `--install` 同用。按需的 registry 更新
查询可用 `DSH_UPDATE_REGISTRIES` 覆盖（逗号分隔；置空即跳过，气隙机器适用）。
判定契约与错误码地图见 [DIAGNOSTICS.zh.md](DIAGNOSTICS.zh.md)。
CLI 发行版可用 `dsh --profile <name> --dump-config` 检查合成后的 profile，
无需真正启动；输出会显示某行的覆盖是否生效。桌面应用没有 `dsh` 命令，
请直接查看 `cordis.patch.yml` 与 Plugins 页面。
使用 `scripts/bootstrap.sh <distro>` 检查发行版前置依赖。

| 现象 | 结果 | 处理 |
|---|---|---|
| 命令沙箱不可用 | `SANDBOX_UNAVAILABLE`；消息区分 `bwrap` 缺失或不可用。 | 安装 `bubblewrap`、修复用户命名空间，或在 `wsl-shell` 上设置 `sandbox: false`。 |
| 受限写入不可用 | `FS_IO_ERROR`，附带 `bwrap` 补救方法。 | 安装或修复 `bubblewrap`；要禁用围栏，在 `wsl-fs` 或 `fs-routing` 上设置 `sandbox: false`。 |
| 发行版已停止时文件操作失败 | `FS_IO_ERROR`：发行版 substrate 不可用。 | 启动该发行版。若 agent 仍不可用，重启会话。 |
| 命令无法在所选发行版中启动 | `WSL_E_*` 错误码，指明发行版。 | 启动该发行版或修改 `distro`。更宽的权限无法解决发行版已停止的问题。 |
| `wsl.exe` 无法启动 | 错误指明可执行文件与该行的 `wslPath`。 | 修正 `wslPath`，并确认已安装 WSL。 |
| 命令执行中 WSL 挂起 | 命令到达截止时间仍未完成。 | 重试一次；仍不行则运行 `wsl.exe --shutdown` 并重新打开会话。 |
| 被监视的变更没有通知 | 轮询可能遗漏保留所观察元数据的变更；不保证报错。 | 查看 [LIMITATIONS.md](LIMITATIONS.md) 中的监视器限制。 |
| 其他发行版的路径被拒绝 | `FS_OUTSIDE_DISTRO`。 | 使用 `distro: ''` 或 `auto` 跟随工作区，或在目标发行版中打开会话。 |

完整错误参考见 [ARCHITECTURE.md — Error codes](ARCHITECTURE.md#error-codes)，
设计边界见 [LIMITATIONS.md](LIMITATIONS.md)。
