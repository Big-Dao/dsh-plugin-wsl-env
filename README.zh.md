# 开发一个让 DeepSeek Harness 打开并运行 WSL 文件夹的插件

本文描述插件**现在的形态**：本机（Windows + WSL2 ubuntu 26.04）实测得到的契约与约束、据此给出的设计、安装与使用方式、已知限制，以及验证手段。被推翻的设计与当时的排查记录见 [`docs/archive/design-history.zh.md`](docs/archive/design-history.zh.md)。

---

## 0. 结论摘要

1. **DSH 没有"远程/WSL 连接"能力，但它的能力缝（capability seam）就是为此设计的。** 你要写的不是"一个新工具"，而是若干 seam provider：模型侧主要是 `ctx.fs` 和 `ctx.shell`（§3），GUI 右侧栏终端窗口则用 `ctx.subprocess`（§17）。模型可见的 `read`/`write`/`edit`/`glob`/`grep`/`bash` 工具全部由 DSH 自带，它们只认 seam。

2. **最大的坑不是 WSL，而是 DSH 自己的沙箱。** 在 Windows 上 DSH 用 `dsh-sandbox-windows-acl` 把命令降权到 *Low 完整性 + 受限令牌*。这个令牌**完全无法访问 WSL**：`wsl.exe` 返回 `Wsl/E_ACCESSDENIED`，`\\wsl.localhost\<distro>` 直接 access denied。沙箱外两者都正常。这是本方案必须替换 `pwsh-sandbox` 的原因。

3. **WSL 的 UNC 共享可以当普通文件系统用，但只能"读"和"改名覆盖"。** 实测：`stat`/版本号、原子 `rename` 覆盖、ripgrep 递归搜索**都可用**；硬链接（`ENOTSUP`）、符号链接（`EPERM`）、POSIX 权限位（宿主侧 `chmod` 无效，发行版内有效且能被 `rename` 保留）**不可用或不可见**。这直接决定了三件事：必须"把 guard 提前、走 rename 发布"（否则**创建新文件**走硬链接发布会失败）、必须换掉 `dsh-fs-local` 的 Windows 描述符分支（否则**改已有文件**全部失败，§16）、以及必须**在发行版内**重新套用模式位（否则每次编辑都静默丢掉可执行位，§16.3）。

4. **"打开 WSL 文件夹"也已经落地，而且不需要写任何客户端代码。** WSL 感知的 `ctx.directoryPicker` 后端（`lib/picker.js`）让 GUI 里那个现成的目录对话框直接在发行版里打开：第一屏就是发行版列表，选中后落到该发行版的 `/`，再往下浏览。它**必须报 `kind: 'browse'`**——wire 协议只认 `native`/`browse` 两种 kind，报第三种会让它自己需要的三个 Remote 动词全部失效。详见 §8。

5. **GUI 右侧栏的终端窗口也接进发行版了，但它必须在"组合层"接，不能在 preset 里接。** 终端窗口的宿主半边是 `dsh-api-terminal-controller`，它用 `agent.ctx.get("subprocess")` 解析执行环境；而 Agent 的 ctx 由 agent loop 建在**根 realm**（`createScope(loopCtx, …)`，`loopCtx` = 根上挂载的 `ctx.agents`），preset 的 isolate realm 则属于 `dsh-agent-preset-registry` 自己的 ctx（`createScope(this.owner, …)`）。两棵子树永不相交，所以挂在 `preset-wsl` 里的 `subprocess` provider 对终端窗口**永远不可见**（registry 为此提供了 `agentPresets.serviceFor(agent, name)`，但 terminal controller 没有用它）。因此补丁层**禁用随包的 `subprocess` 行**并替换成本插件的子类，它只覆写 `spawnTerminal`：把 `wsl.exe` 启动改写成 `wsl.exe -d <distro> --cd <linux dir>`，其余 `spawn()`（所有命令、宿主 ripgrep、pwsh executor、LSP host）原样走随包实现。代价是诚实的：**终端跟随组合，不跟随会话**——Windows 文件夹的会话也会拿到发行版终端，起始目录是它的 `/mnt/<drive>/…`。详见 §17。

> **验证边界**：架构、seam 契约、WSL 行为、UNC 原语、选择器行为（发行版发现、发行版根列目录、面包屑）、**挂接后的运行时行为**、**写/改/权限位的完整发布路径**（`test/probe/`，含负对照，见 §16.5）、以及**终端 provider 的端到端启动**（`test/probe/terminal.sh`，见 §17.6）均已在本机实测；纯函数单测 35 项、文件系统行为探针 14 项、终端探针 3 项全部通过；**插件已装进一个独立 profile 并在 harness 进程内端到端跑通**（`exit=0`，见 §9），**日常 GUI 也已在真实模型回合里验证过 `bash` 与 `read`**（§10），**写侧则由一个只挂 WSL 环境的 headless profile 在真实回合里验证过 `write → chmod → read → edit → 执行`**（§16.5）。

### 0.1 本文的范围与历史留档

本文写**现在的形态**：契约、设计、安装、使用、限制、验证方式。

三条被否掉的"工具命名"路线、per-process 的 `DSH_WSL` 开关、以及当初的排查过程，都移到了
[`docs/archive/design-history.zh.md`](docs/archive/design-history.zh.md) —— 那里按**当时的节号**原样保留，
并标出每个结论现在的对应位置。

仍留在本文的"已修复缺陷"几节（§11、§12、§16）不是历史陈列：它们解释的是**现成代码为什么长这样**
（`--exec` 为什么是必需的、shell 为什么不能硬编码、发布路径为什么绕开 Windows 描述符分支）。

---

## 1. DSH 的插件体系

DSH 本体就是一个 Cordis 应用。它的配置不是一份文件，而是**三层补丁叠加**：

```
profile 根 (空数组)
  └─ package.json 的 dsh.profile.bundles   → 逐个 bundle 的 cordis.patch.yml
       └─ 用户层 cordis.patch.yml          → 你的插件行
            └─ --patch <file> 覆盖层        → 临时实验
```

本机现状（真实文件）：

```jsonc
// C:\Users\andyz\.dsh\profiles\desktop\package.json
{
  "dsh": { "profile": { "bundles": [
    "@deepseek-ai/dsh-base",       // 共享内核：所有 seam、工具、agent loop
    "@deepseek-ai/dsh-web-app"     // Web GUI 外壳
  ] } }
}
```

```yaml
# C:\Users\andyz\.dsh\profiles\desktop\cordis.yml —— 根节点，故意为空
[]
```

```yaml
# C:\Users\andyz\.dsh\profiles\desktop\cordis.patch.yml —— 用户层，改这里
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config: { provider: deepseek-account, model: deepseek-flash }
```

三条规则决定你怎么写：

- 补丁按 `id` 定位行，**后写的层整行覆盖 `config`**（不是 merge），所以一行只能有一个来源。
- 行里的 `name` 是**可被 Node 解析的模块名**；`exports` 的子路径可以用（如 `@deepseek-ai/dsh-plugin-manager/tools`）。
- 行的顺序**没有加载语义**，激活由"服务是否可用"驱动。所以你不必关心谁先谁后。

### Cordis 服务 = 能力缝

一个插件就是一个 `Service` 子类，构造时把自己注册到某个名字上：

```js
import { Service } from "@deepseek-ai/cordis";
class FileSystem extends Service {
  constructor(ctx) { super(ctx, "fs"); }   // 注册为 ctx.fs
}
```

**同一个 context 里一个名字只能有一个实现**，加载第二个会抛 Cordis 标准的 duplicate-service 错误。这就是为什么"替换 WSL 后端"必须 `disabled: true` 掉原来的行，而不是"再挂一个"。

### 相关的缝与包

| 缝 | 契约包 | 宿主实现 | 模型可见工具 |
|---|---|---|---|
| `ctx.fs` | `dsh-fs` | `dsh-fs-local` / `dsh-fs-sandbox` | `dsh-tool-fs`（read/write/edit）、`dsh-tool-fs-search`（glob/grep，内含 ripgrep） |
| `ctx.shell` | `dsh-shell` | `dsh-bash-local` / `dsh-pwsh-local` / `*-sandbox` | `dsh-tool-bash` / `dsh-tool-pwsh` |
| `ctx.sandbox` | `dsh-sandbox` | `dsh-sandbox-local` / `dsh-sandbox-windows-acl` | —（由 `*-sandbox` 消费） |
| `ctx.subprocess` | `dsh-subprocess` | `dsh-subprocess-local` | —（executor 的底座） |
| `ctx.jobs` | `dsh-jobs` | `dsh-jobs-local` | `dsh-tool-jobs`（后台任务） |
| `ctx.workspaceRegistry` | `dsh-workspace` | 同包 | —（GUI 项目列表） |
| `ctx.directoryPicker` | `dsh-host-directory-picker` | `-native` / `-browse` / `-auto` | —（GUI 选目录） |

关键设计：**契约、实现、策略、工具四层分离**。`dsh-fs` 只定义抽象类，`dsh-fs-local` 实现真实 IO，`dsh-fs-sandbox` 只加一道策略围栏，`dsh-tool-fs` 提供模型可见工具。"换后端"对工具层透明——这正是 WSL 插件可行的原因。

---

## 2. 关键实测结论

### 2.1 沙箱阻断 WSL（本方案的核心约束）

同一台机器、同一条命令：

| 探测 | 沙箱内（`workspace-write`） | 沙箱外（`danger-full-access`） |
|---|---|---|
| `wsl.exe -l -v` | ❌ `Wsl/E_ACCESSDENIED` | ✅ `ubuntu  Running  2` |
| `\\wsl.localhost\ubuntu\home` | ❌ Access denied | ✅ 列出 `andy`、`linuxbrew` |
| 发行版内执行 bash | — | ✅ `Linux 6.18.40.1-microsoft-standard-WSL2`，`HOME=/home/andy`，uid 1000 |
| `D:\wsldisk\ext4.vhdx`（229 GB） | ✅ 可读（只读不受限） | ✅ |

沙箱令牌实测（`whoami /groups`、`whoami /priv`）：

```
Mandatory Label\Low Mandatory Level          S-1-16-4096
BUILTIN\Administrators                       Group used for deny only
SeChangeNotifyPrivilege                      Enabled   ← 仅剩这一个特权
```

工作区 ACL 也印证了机制（`icacls`）：

```
Everyone:(CI)(DENY)(DC)
S-1-4-189208278-106033736:(OI)(CI)(W,D,DC)          ← capability SID 写白名单
Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)    ← No-Write
```

`S-1-4-...` 就是受限令牌的 capability SID。**WSLService 拒绝低完整性令牌**，这不是 bug，是设计。

**结论：任何 WSL 插件都必须在"无沙箱"的 provider 上运行。** 而 DSH 的围栏是由 *sandboxing executor*（`pwsh-sandbox`）在 spawn 时包一层 `ctx.sandbox.confine` 施加的——所以继承**不带 sandbox 的 `dsh-bash-local`**，命令就以 harness 宿主进程（正常完整性）的身份运行，`wsl.exe` 自然可用。这是合法的 seam 用法，不是绕过：seam 用 `sandboxMode` 这个 getter 让 provider **诚实地声明**自己是否围栏。

### 2.2 WSL UNC 共享的原语能力

`dsh-fs-local` 依赖哪些原语，在 `\\wsl.localhost\ubuntu\...` 上逐条实测：

| 原语 | 用途 | 结果 |
|---|---|---|
| `stat` 的 `dev/ino/mtimeNs/ctimeNs` 稳定性 | `targetKey` 身份、版本号 | ✅ PASS（`dev=0`，`ino` 稳定） |
| 重写后 `mtimeNs` 前进 | 过期版本检测（`FS_STALE_VERSION`） | ✅ PASS |
| **硬链接** | **`createIfAbsent` 的发布方式** | ❌ **`ENOTSUP`** |
| 原子 `rename` 覆盖 | 普通写入发布 | ✅ PASS |
| POSIX 权限位 | 保留可执行位 | ❌ 建文件 0755 变 **0666** |
| `symlink` | 符号链接 | ❌ `EPERM` |
| 打包的 `ripgrep` 递归搜索 | `glob`/`grep` 工具 | ✅ PASS，`rg 15.0.0` 正确列出 UNC 下的文件 |
| 双向可见性 | Windows 写 → Linux 读 | ✅ PASS（Windows 经 UNC 写入的文件，Linux 侧 `cat` 可见，属主 `andy:andy`） |

**最要命的一条是硬链接。** `dsh-fs-local` 的 `writeText` 里：

```js
await writeFileAtomic(target.targetKey, content, existing?.mode, signal, this.internals,
  expected?.kind === "createIfAbsent" ? { displayPath: target.displayPath } : undefined);
```

带 `createIfAbsent` 的创建走**硬链接发布**（保证并发下不覆盖别人刚建的文件）。在 UNC 上必然 `ENOTSUP` → `FS_IO_ERROR`。也就是说，**直接拿 UNC 当 `ctx.fs`，"新建文件"这个最常见的操作会直接失败。**

修法很简单：**把 guard 提前到自己的代码里检查，然后走不带 guard 的 rename 发布**（rename 实测可用）。残留的 check-then-act 竞态与 `dsh-fs-sandbox` 自己已声明接受的 TOCTOU 是同一类。

---

## 3. 插件设计

### 3.1 组件

```
                    ┌──────────────────────────────────────────┐
   模型调用 read/write│  dsh-tool-fs   dsh-tool-fs-search   bash  │  DSH 自带
   /edit/glob/grep/  │        │              │              │     │  不需要写
   bash 工具          └────────┼──────────────┼──────────────┼─────┘
                             ▼              ▼              ▼
                       ctx.fs          ripgrep        ctx.shell
                             │          (UNC)             │
              ┌──────────────┴───┐                  ┌────┴─────────────┐
              │ WslFileSystem    │                  │ WslShellExecutor │
              │ 继承 fs-local    │                  │ 继承 bash-local   │
              │ + POSIX↔UNC 映射 │                  │ + 前缀 wsl.exe    │
              │ + guard 提前      │                  │ + cwd 改写        │
              └──────────┬───────┘                  └────────┬─────────┘
                         │ Node fs                          │ ctx.subprocess
                         ▼                                  ▼
        \\wsl.localhost\ubuntu\home\andy\...        wsl.exe -d ubuntu --cd /home/andy
                                                            --exec <shell> -lc "<cmd>"

   右侧栏终端窗口  dsh-api-terminal-controller  (组合层，不在 preset 内)
                          │ agent.ctx.get("subprocess") —— 根 realm
                          ▼
               ┌──────────────────────────┐
               │ WslSubprocessRuntime     │  只覆写 spawnTerminal
               │ 继承 subprocess-local    │  wsl.exe → -d <distro> --cd <linux dir>
               └──────────┬───────────────┘
                          │ node-pty + ConPTY
                          ▼
                  wsl.exe -d ubuntu --cd /home/andy/...   （默认登录 shell）
```

### 3.1.1 三个 provider 的作用域不一样，这不是笔误

| Provider | 挂在哪 | 作用域 | 理由 |
|---|---|---|---|
| `ctx.shell` | `preset-wsl` 的 isolate realm | **按会话** | 工具（`bash`）就挂在 preset 里，自己的 ctx 能解析 realm |
| `ctx.fs` | 同上 | **按会话** | 同上 |
| `ctx.subprocess` | 补丁层根节点（禁用随包行 + insert） | **按组合** | 终端窗口的 controller 在 preset 外，用 Agent 的 ctx 解析，而它落在根 realm，看不到 realm 服务（§17.2） |

### 3.2 三个坐标系

| 坐标系 | 例子 | 谁用 |
|---|---|---|
| Linux/POSIX | `/home/andy/proj/src/a.ts` | 模型看到的、`bash` 里的 |
| WSL UNC | `\\wsl.localhost\ubuntu\home\andy\proj\src\a.ts` | 宿主 Node fs 实际读写的 |
| Windows 盘符 | `C:\Users\andyz\...` → `/mnt/c/Users/andyz/...` | interop 互操作 |

`dsh-fs` 契约明确：`targetKey` 是**不透明**身份（消费者不得解析），只有 `displayPath` 是给模型/UI 用的。所以：**`targetKey` 保持 UNC（真实 IO 用它），`displayPath` 改写成 Linux 路径**——完全符合契约，且改动极小。

### 3.3 为什么不重写 executor

`dsh-pwsh-local` 有 429 行，其中绝大部分是 handle 生命周期：截止时间融合、超时/取消的**首因归类**、有界输出与 spill 文件、后台读取增量合并、`onProcessDone` 落地钩子。自己重写这些只会在边角语义上出错。

`dsh-bash-local` 已经把这些做成可继承的，并留了明确的扩展点（它的 README 就是这么写的：`executeArgv` 是"子类替换 shell argv 的边界"，`dsh-pwsh-sandbox` 就是这么实现的）。所以子类只做两件事：

1. **argv 加前缀**：`['wsl.exe','-d',distro,'--cd',linuxCwd,'--exec',<shell>,...flags,cmd]`
   —— `<shell>` 是**发行版用户的登录 shell**（不是硬编码 bash，见 §12）；`--exec` **不是可选项**，去掉它会让 `$VAR`/`$?`/`$(...)` 在 shell 看到之前就被吃掉（见 §11）。
2. **改写 spawn 的 `cwd`**：`spec.workdir` 是 Linux 路径，Windows 的 CreateProcess 不能拿它当 `cwd`；`wsl.exe` 进程本身要从一个 Windows 目录启动，Linux 目录走 `--cd`。

> 注意 `bash-local` 与 `pwsh-local` 的 `spawnSpec` 签名不同（前者是 `(spec, argv, stdoutMaxBytes, signal)`），覆盖时要对准。

**argv 用数组传，不要拼字符串。** 手工在 PowerShell 里试会踩坑：`wsl.exe -d ubuntu -- wslpath 'C:\Users\...'` 里反斜杠会被 PowerShell 吃掉，得到 `C:UsersandyzDocuments`。Node 的 `argv` 数组是逐元素精确传递的，没有这一层。

### 3.4 安全边界（重要）

这个插件**移除了文件围栏**，必须如实声明：

- 两个 provider 都继承 `sandboxMode === undefined`，即"本 provider 不围栏"。工具层读到这个事实会**诚实地**提示模型"没有沙箱"。
- 但 `dsh-sandbox-policy` 仍会报出会话选定的模式，而**唯一真正对文件写入执行围栏的 `dsh-fs-sandbox` 已被禁用**。所以不要让会话停留在 `workspace-write` 却以为有围栏——**应当显式选择 `danger-full-access` 预设**，让 UI 与实际一致。
- `restrictToDistro: true`（默认）只把 **fs** 限制在目标发行版内；**shell 不受此限**：发行版内 `/mnt/c` 依然能写 Windows 盘，interop 还能直接执行 Windows 程序。这是 WSL 的固有属性，不是插件能关掉的。
- 结论：**"WSL 远程执行"本质上等于"无沙箱的宿主执行"**，与 SSH remote 同类。请当作明确的能力授予来对待。

---

## 4. 本目录文件

| 文件 | 作用 |
|---|---|
| [`lib/paths.js`](lib/paths.js) | 三个坐标系之间的纯函数翻译（可脱离 Cordis 单测） |
| [`lib/wsl.js`](lib/wsl.js) | `wsl.exe` 互操作原语（发行版发现、Linux `$HOME`、UTF-8 捕获），**无 DSH 依赖** |
| [`lib/index.js`](lib/index.js) | `WslShellExecutor`（ctx.shell）+ `WslFileSystem`（ctx.fs） |
| [`lib/picker.js`](lib/picker.js) | `WslDirectoryPicker`（ctx.directoryPicker，报 `kind: 'browse'`） |
| [`lib/listing.js`](lib/listing.js) | 目录列举与面包屑的纯函数（含 UNC 修正），**无 DSH 依赖** |
| [`lib/shell.js`](lib/shell.js) | 默认导出 `WslShellExecutor`，供 `name: 'dsh-plugin-wsl-env'` 使用 |
| [`lib/fs.js`](lib/fs.js) | 默认导出 `WslFileSystem`，供 `name: 'dsh-plugin-wsl-env/fs'` 使用 |
| [`lib/subprocess.js`](lib/subprocess.js) | `WslSubprocessRuntime`（ctx.subprocess，只覆写 `spawnTerminal`），供 `name: 'dsh-plugin-wsl-env/subprocess'` 使用，即 GUI 终端窗口（§17） |
| [`cordis.patch.yml`](cordis.patch.yml) | 挂载用的 profile 补丁层（含逐行注释）；其中两行是**替换**而非新增：`subprocess` 置 `disabled: true` + insert 本插件，外加 `terminal-controller` 的 shell profile |
| [`package.json`](package.json) | ESM + 子路径 exports + peerDependencies |
| [`test/paths.test.mjs`](test/paths.test.mjs) | 路径翻译断言（12 项，纯函数，任意 Node 可跑） |
| [`test/listing.test.mjs`](test/listing.test.mjs) | 列举与面包屑断言（9 项） |
| [`test/shell.test.mjs`](test/shell.test.mjs) | 登录 shell 参数选择断言（5 项） |
| [`test/terminal.test.mjs`](test/terminal.test.mjs) | 终端 argv（是否 `--exec`、`--cd` 何时省略）与 `WSLENV` 的 `/p` 翻译断言（9 项） |
| [`test/probe/`](test/probe/) | **行为探针**：`run.sh` 把 `ctx.fs` 绑到发行版，逐条断言写/改/权限位（见 §16.6）；`terminal.sh` 启动终端 provider 并断言它落到哪个 shell（见 §17.6） |
| [`test/syntax.mjs`](test/syntax.mjs) | 对 `lib/*.js` 逐个 `node --check`。服务类模块缺 DSH peer 时无法 import，这是唯一能覆盖它们的自动化门槛（只查语法，不查求值期错误，见 §15.4） |
| [`README.md`](README.md) | 英文短入口（npm / GitHub 首屏）；本文仍是完整记录 |
| [`CHANGELOG.md`](CHANGELOG.md) | Keep a Changelog 格式的版本记录，每条都指回本文的章节 |
| [`LICENSE`](LICENSE) | MIT（`package.json` 早已声明，本轮才补上文件） |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | 托管 runner 上只跑无依赖的那一半（`npm test`，node 20/22/24） |
| [`docs/archive/`](docs/archive/) | 已废弃设计的留档，含[说明](docs/archive/README.md)（如 per-process 的 `DSH_WSL` 旧补丁） |
| [`.editorconfig`](.editorconfig) / [`.gitattributes`](.gitattributes) / [`.gitignore`](.gitignore) | 2 空格 + LF（跨 WSL/Windows 必须）、忽略 `node_modules/` 与探针产物 |

### 4.1 工程化脚手架

仓库在 2026-10-02 做了第一次 `git init`（此前 32 个文件、4800 余行只有这份 README 作为历史）。几条刻意的取舍：

- **只有纯函数进 CI。** `lib/index.js`、`lib/subprocess.js`、`picker.js`、`auto-preset.js`、`shell-env.js` 都要 import DSH peer，裸检出的 CI 里 `ERR_MODULE_NOT_FOUND` 早于任何断言。所以 CI 跑 `npm test`（= `test:syntax` + `test:unit`），**行为探针留在本机手动跑** —— 它需要 Windows + WSL + 一个挂好的 profile，托管 runner 上装不出来。把跑不了的东西塞进 CI 只会训练人忽略红灯。
- **`npm test` 不装任何依赖**，因为包里本来就没有依赖；`peerDependencies` 全部 `optional`，由挂载它的 profile 提供。
- **peer 声明的判据是"真的要用"，不是"相关"。** 只列 `import` 到的包、`inject` 的服务契约（`dsh-subprocess`）、以及每个 DSH 插件都会声明的 `cordis`。静态检视据此移除了 `dsh-sandbox`、`dsh-shell`、`dsh-tools` —— 它们是为[归档](docs/archive/design-history.zh.md)里那套"在运行时给别人的工具改名"的设计留下的，代码里既没有 import 也没有 `inject`（归档 §15.5 甚至记录过，那套设计只能给沙箱符号塞本地空实现）。判据可以机械核对：

  ```bash
  grep -rho 'from "@deepseek-ai/[^"]*"' lib/ | sort -u
  ```
- **`.gitattributes` 强制 LF。** 检出在发行版内、执行在 Windows 上：CRLF 的 shell 脚本在发行版里会直接失败，CRLF 的 `cordis.patch.yml` 会把 `
` 喂进 plan-mode 那段长文本。
- **两份副本的分工写进了 README。** profile 只能 link Windows 路径（pnpm 会把 `link:\wsl.localhost\…` 写成断链的 `/wsl.localhost/…`，实测），所以 Windows 侧那份是**运行时镜像**，靠 `npm run sync:windows` 显式同步；`.git` 只存在于发行版这份里。
- **归档而不是删除。** 旧设计的补丁移进 `docs/archive/`，并在旁边写清它为什么被推翻 —— 与本文一贯的"留档失败路径"一致。

对照的官方实现抽在 `../dsh-wsl-research/pkgs/` —— **本机目录，不在本仓库内**（由同目录的 `extract.mjs` 从 `app.asar` 抽出，各自带 README）。要点去那里查：

```
dsh-base/cordis.patch.yml        ← 真实的组件装配全貌（529 行）
dsh-fs/README.md                 ← ctx.fs 契约
dsh-fs-local/lib/index.js        ← 本地 IO 实现（resolve 在 780 行，writeText 在 864 行）
dsh-fs-sandbox/lib/index.js      ← 沙箱围栏怎么做的（checkedTarget 在 153 行）
dsh-bash-local/lib/index.js      ← executor 模板（Config 69，resolve 88，spawnSpec 107，execute 140）
dsh-shell/README.md              ← ctx.shell 契约与必须遵守的语义
```

---

## 5. 开发与安装

> **⚠️ 本节与 §9–§10 里的 `--profile wsl` / `wsltest` 是当时的验证 profile，后来在工程化清理中删除了。**
> 那些命令记录的是真实跑过的路径，本身仍然有效，只是 profile 要先建出来：
> `dsh wsl --from-default-profile web`（完整三步见 §9.4）。
> 当前目录里是日常的 `desktop`，以及两个**按需重建**的探针 profile `wslfs` / `wslmodel`（§16.6）。

`desktop` profile 由 Electron 应用独占（`--dump-config` 会报 `profile "desktop" is managed exclusively by the Electron application`），**不要在外部改它**。开发走自定义 profile：

```powershell
# 1) 从随包的 web 模板新建一个自定义 profile，并启动它
dsh wsl --from-default-profile web

# 2) 把插件装进这个 profile（dsh plugin 转发给 profile 内的 pnpm）
dsh plugin --profile wsl add file:C:\Users\andyz\Documents\deepseek-harness\default-workspace\dsh-plugin-wsl-env

# 3) 编辑用户补丁层，把 cordis.patch.yml 的内容并进去
notepad $env:DSH_HOME\profiles\wsl\cordis.patch.yml

# 4) 只看装配结果，不启动 —— 这是最快的排错手段
dsh --profile wsl --dump-config

# 5) 启动
dsh wsl
```

`cordis.patch.yml` 支持 `!!js` 表达式，可以按平台条件化：

```yaml
- id: wsl-shell
  name: 'dsh-plugin-wsl-env'
  disabled: !!js process.platform !== 'win32'
```

**选择器那两行只适用于 web 系 profile。** `- id: directory-picker` 覆盖的是 **web app bundle 里的那一行**（`dsh-web-app` 把 `directory-picker` 挂成 `@deepseek-ai/dsh-host-directory-picker-auto`）。若 profile 不是从 `web` 模板建的，就没有这一行，要改成 `- insert:` 新增而非覆盖。另外 `directory-picker-surface` 引用的 `@deepseek-ai/dsh-client-ui-directory-picker-browse` 是 `dsh-web-app` 的依赖，从 web 模板建的 profile 里应当已可解析——这一点同样要在 `--dump-config` 与启动日志里确认。

**终端那三行是"替换 + 配置"，不是新增。** `- id: subprocess` 置 `disabled: true` 后 insert `dsh-plugin-wsl-env/subprocess`，并给 `- id: terminal-controller` 配上 `shell: { path: wsl.exe }` / `shellCandidates: []`。它们同样只适用于 web 系 profile（`terminal-controller` 是 `dsh-web-app` 的行；headless profile 里没有这一行，覆盖会被 warn 后跳过，终端窗口本来也不存在）。已存在行的 `name` 只是断言，**不能靠它改包名**，所以换 provider 必须 disable + insert。详见 §17。

**在 GUI 里给当前 profile 装插件**走 Plugins 页面（`dsh-plugin-manager` + `dsh-client-ui-settings-plugins`）；`dsh plugin --profile <name> <pnpm-args>` 是同一机制的命令行入口。

**第一个要验证的点**：`@deepseek-ai/dsh-bash-local` 这些 peer 依赖能否在 profile 内解析。它们以 `publishConfig.access: public` 发布，pnpm 会从 npm 拉取；若 profile 无法联网或版本不匹配（本机是 `0.2.0-rc.2`、`cordis ~4.0.4`），需要改成随包版本或调整版本范围。`dsh --profile wsl --dump-config` 与启动日志会立刻暴露这个问题。

---

## 6. 验证

分三层，从便宜到贵：

**a) 路径翻译单测**（不需要 DSH、不需要 WSL）：

```powershell
node --input-type=module -e "
import { toLinuxPath, toWorldPath, toDisplayPath } from './dsh-plugin-wsl-env/lib/paths.js';
console.log(toLinuxPath('\\\\wsl.localhost\\ubuntu\\home\\andy\\p', { distro: 'ubuntu' }));  // /home/andy/p
console.log(toWorldPath('/home/andy/p', { distro: 'ubuntu' }));                              // \\wsl.localhost\ubuntu\home\andy\p
console.log(toDisplayPath('\\\\wsl.localhost\\ubuntu\\home\\andy\\p', 'ubuntu'));            // /home/andy/p
"
```

**b) 发行版发现与选择器端到端**（沙箱外；`lib/wsl.js`、`lib/listing.js`、`lib/paths.js` 都不依赖 DSH，可被 node 直接导入）：

```powershell
# 发行版列表 + 该发行版的 Linux $HOME
node --input-type=module -e "
import { listDistros, linuxHome } from './dsh-plugin-wsl-env/lib/wsl.js';
const d = await listDistros();
console.log(d, await linuxHome(d[0]));
"

# 选择器完整行为：根层级、真实列目录、面包屑
node ./dsh-wsl-research/probe-picker.mjs
```

`dsh-wsl-research/` 是**本机的对照目录，不在本仓库内**（§4 末尾列了它保存的官方包副本）。仓库自己的单测入口是 §5 的 `npm test`，不需要 DSH 也不需要 WSL。

不要直接 `import './dsh-plugin-wsl-env/lib/index.js'` 或 `lib/picker.js`：它们会导入 `@deepseek-ai/*` 这些 peer，只有在装好的 profile 里才解析得到。纯逻辑（`paths.js`、`listing.js`、`wsl.js`）刻意与它们分离，就是为了让这一步不需要 DSH。

**c) 端到端**：启动 profile 后，让模型在 WSL 工作区里 `bash` 跑 `pwd`/`id`，`read` 一个发行版内的文件，`write` **新建**一个文件（这条最关键，它验证 guard 提前是否生效），再 `glob`/`grep`。

**d) 行为探针**（需要 Windows + WSL + 一个挂好的 profile；一次性建法见 §16.6）：

```bash
npm run probe            # ctx.fs：创建/读取/版本 guard/编辑/覆盖/权限位 + 负对照
npm run probe:terminal   # ctx.subprocess：真开一个 PTY，断言 distro、初始目录、DSH_* 转发（§17.6）
```

排错入口：`dsh-tool-cordis`（"Read-only runtime API inspection for Harness plugin development"）可以只读地检查运行时的服务与 API，默认未挂载，排错时加到补丁层。

---

## 7. 已知限制

- **必须无沙箱运行。** 沙箱内的受限低完整性令牌够不到 WSL（`Wsl/E_ACCESSDENIED`），这是硬约束。
- **新建文件拿不到可执行位**：宿主侧 `chmod` 在 9p 共享上**被静默忽略**，宿主侧 `stat` 又恒报 0666，所以新建文件只能是发行版 umask 的结果（0644）。需要可执行位时从发行版内 `chmod +x`。**但覆盖/编辑不会再把位弄丢**——`WslFileSystem` 会在发行版内把原模式套到暂存文件上（见 §16）。
- **UNC 上不能建符号链接**（`EPERM`）。读取已存在的符号链接没问题（`realpath` 身份可用）。
- **UNC 上的 `watch` 不可靠**，`WslFileSystem.watch()` 直接以 `FS_IO_ERROR` 拒绝，而不是挂一个可能永不触发的 watcher。
- **9p 性能**：大批量小文件读写明显慢于本地盘。`glob`/`grep` 或可改为在发行版内跑 `rg`（还能拿到正确的 `.gitignore` 语义与 Linux 路径）。
- **环境变量不自动透传**：WSL 只导入 `WSLENV` 里列出的名字。`PATH` **故意不列**——列了会用 Windows 的 PATH 覆盖发行版的 PATH；WSL 自己会把 Windows PATH 追加为 interop 条目。托管的 `DSH_*` 命名空间按**前缀**整体放行，其中带 Windows 路径的两个（`DSH_HOME`、`DSH_PROFILE_DIR`）加 `/p` 让 WSL 翻成 `/mnt/c/...`（§14.7）。
- **`distro: ''` 需要一次额外调用**：默认发行版靠 `wsl.exe -l -q` 解析并缓存；首次 IO 有一次性开销。
- **`editText` 整文件进出内存**（继承自 `fs-local`），大文件编辑代价高。
- **改一次就慢一点**：覆盖/编辑要额外起一个 `wsl.exe`（发行版内 `chmod`）——这是保住权限位的代价。新建不走这条路。
- **终端跟随"组合"，不跟随"会话"**：终端窗口的 controller 用 `agent.ctx.get("subprocess")` 解析执行环境，而 Agent 的 ctx 落在根 realm，看不到 preset 的 isolate realm（§17.2）。所以补丁层替换的是根上的 `subprocess` 行：在这个 profile 里，**Windows 文件夹的会话也会拿到发行版终端**，起始目录是该文件夹的 `/mnt/<drive>/…`。这是"按会话的执行环境"在终端这条路上够不到时的诚实取舍；想要宿主 shell 的会话得另开一个 profile。
- **终端的活动探测止步于 `wsl.exe`**：随包实现只为 POSIX 宿主上直接启动的 `bash`/`zsh` 装 shell 活动钩子（`prepareShellActivity` 在 `platform === "win32"` 时直接返回 `undefined`），所以这类终端对 controller 报 `unknown`，**"无人值守空闲回收"永远不会触发**——要释放进程就关掉那个 tab。
- **终端 shell 菜单被刻意缩到一项**：`terminalEnvironment()` / `resolveExecutable()` 同样从根 realm 解析且拿不到任何目录，若把可执行查找改成"先查发行版"，会连带改掉 pwsh executor、LSP host、ripgrep 查找的语义；所以补丁层只给 controller 配了唯一一个 shell profile（`shell: { path: wsl.exe }` + `shellCandidates: []`）。想固定成别的发行版 shell 时，把 provider 的 `shell` 配成发行版内绝对路径即可（此时 `-l` 只对认它的 shell 家族生效）。

---

## 8. 已实现的 "Remote-WSL" 体验：目录选择器

§4 的骨架已经能让会话在 WSL 文件夹里跑；`lib/picker.js` 补上了"打开"这一半——在 GUI 里选发行版、在发行版内浏览、把目录作为工作区打开。

### 8.1 关键约束：只能报 `kind: 'browse'`，不能新增 `wsl` kind

seam 的能力是合并可扩展的判别联合，所以"加一个 `wsl` kind"看起来天经地义。**但这行不通**，原因值得写清楚：能力本身**不过 wire**。

`dsh-api-workspace-controller` 只暴露三个 Remote 动词，并把每个**钉死在字面量 kind 上**：

```
pick(signal)          -> requireCapability('native', 'pick')
list(path, signal)    -> requireCapability('browse', 'list')
createDirectory(...)  -> requireCapability('browse', 'createDirectory')
```

其余一律以 `directory-picker/unavailable` 拒绝。所以一个报 `{ kind: 'wsl', ... }` 的后端**会让它自己需要的三个动词全部失效**——`requireCapability('browse', ...)` 不再匹配。而 wire 词汇表位于 `app.asar` 里的已发布包中，加第三种 kind 等于改 asar 包，下次应用更新即被覆盖。

报 `browse` 不是绕过，而是恰好合适：`browse` 的两个原语就是"列出一层绝对目录"和"建一个子目录"，正是浏览发行版所需要的。shipped browse 后端唯一缺的是 **WSL 的可发现性**（它开在 Windows 主目录），`lib/picker.js` 补的就是这一点：

- 根层级用 `wsl.exe -l -q` 列出**发行版**，WSL 成为入口，而不是要你先知道一个 UNC 路径；
- 面包屑首行 `WSL` 跳回发行版列表；
- 对话框的 Home 指向首选发行版的 Linux `$HOME`；
- 其余层级就是普通目录列举，由宿主经 UNC 共享完成。

**客户端一行代码都不用写。** `directory-picker-auto` 的行为是"挂一对 Loader 条目：host 后端 + client 界面"，其 README 明确写"钉住某个交互就是直接组合这一对"。所以保留 shipped 的 browse 界面、只换后端即可：

```yaml
- id: directory-picker
  name: 'dsh-plugin-wsl-env/picker'
- id: directory-picker-surface
  name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
```

### 8.2 实测（真实发行版）

`dsh-wsl-research/probe-picker.mjs` 在沙箱外驱动真实 `wsl.exe`，输出：

```
distros: ["ubuntu"]
home (Home affordance target): \\wsl.localhost\ubuntu\home\andy

--- 根层级（对话框第一屏）---
  path: \\wsl.localhost\ubuntu
  crumbs: WSL
  row  C:\Users\andyz  ->  C:\Users\andyz
  row  ubuntu  ->  \\wsl.localhost\ubuntu

--- \\wsl.localhost\ubuntu（38 个目录）---
  bin / boot / dev / Docker / etc / home / lib / lib32 / lib64 / lost+found / media / mnt ...

--- 面包屑 ---
  WSL  ->  \\wsl.localhost
  ubuntu  ->  \\wsl.localhost\ubuntu

--- 面包屑（五层）---
  WSL / ubuntu / home / andy / project
```

### 8.3 过程中修掉的两个真实 bug

自测（`test/listing.test.mjs`）逼出了 shipped browse 后端在 UNC 上同样会犯的两个错——它的原生选择器从不需要处理 UNC：

1. **`win32.basename('\\\\wsl.localhost\\ubuntu')` 返回空串**，面包屑会渲染出一个**空白行**。修法：根层回退用自己的路径作名字。
2. **`win32.dirname` 把 `\\server\share` 当卷根**，永远不会返回共享根本身，于是链里根本没有 `\\wsl.localhost` 这一层，也就没有回到发行版列表的入口；并且它返回的共享根**带尾部分隔符**（`\\wsl.localhost\ubuntu\`），与 `distroRoot()` 的规范形式不一致。修法：`breadcrumbs()` 合成 `WSL` 行，并把发行版行规范化为 `distroRoot()`。

### 8.4 选中之后

选中的 UNC 路径交给工作区流程 → `ctx.workspaceRegistry`。它以 `fs.realpath` 规范化路径作唯一性判据；`\\wsl.localhost\ubuntu\home\andy\proj` 是真实存在的目录，且 `\\server\share` 形式的完整 UNC 能通过 `fullyQualified()` 校验（而裸共享根 `\\wsl.localhost` 不能——这正是根层级的 `path` 取首选发行版根、而不是共享根的原因）。会话按所在目录归入该项目，此后的 `bash`/`read`/`write`/`glob` 都由 §3 的 WSL provider 服务。

### 8.5 仍未做的部分

- **没有专用 UI**：发行版列表借用的是通用目录对话框，外观是"一层目录"，而非 VS Code 那种带 WSL 图标的分组下拉。做成那样就得改 client 界面，并因此需要新的 wire kind——见 §8.1。
- **切换发行版只能翻到根层级**，没有快捷入口；发行版列表带 5 秒缓存（`distroCacheMs`）。
- **`createDirectory` 经 UNC**（`mkdir`），建出的目录是 755，而不是发行版 `umask` 的结果；属主正确（9p 服务以发行版用户身份运行）。
- **发行版内 9p 不暴露的路径**（例如某些权限受限目录）在对话框里也看不到；这种情况可改用 `runInDistro()` 走 `wsl.exe` 列举。

---

## 9. 挂接实录（已在真机完成并端到端验证）

### 9.1 结果

| 项 | 值 |
|---|---|
| profile | `wsl`（`$DSH_HOME/profiles/wsl`，从 `web` 模板建立；**没有动 desktop**） |
| 插件安装 | `dsh plugin --profile wsl add link:<源目录>`，**完全离线**（`downloaded 0`） |
| 补丁层 | `$DSH_HOME/profiles/wsl/cordis.patch.yml` |
| 组合校验 | `dsh --profile wsl --dump-config` → 187 个顶层行，`preset-standard` 的 19 个插件条目完整 |
| 端到端自检 | `exit=0`，除 Node 自身的 DEP0180 外零告警 |

### 9.2 三个必须知道的坑（都是实测踩出来的）

**1. 按绝对路径挂载行不通——必须按包名挂载。**
loader 确实会把绝对路径的行名转成 `file://` 并导入，但插件内部的裸 `@deepseek-ai/*` 说明符会 `ERR_MODULE_NOT_FOUND`：只有 profile / installation 作用域内的模块才走运行时解析层。所以必须 `dsh plugin ... add`。
另外：**`file:` 安装是拷贝**，改源码不生效（表现为反复报同一个已修好的错）；开发必须用 **`link:`**，它建 junction 指向源码目录，改动即时生效。profile 的 `autoInstallPeers: false` 是刻意的——peer 依赖由 installation 作用域在运行时提供，不复制进 profile。

**2. DSH 会主动拒绝"不围栏的 executor"。**
`dsh-permission-presets` 直接 fail-loud：

```
permission: the mounted bash executor does not confine (no sandboxMode) —
presets bundle a sandbox mode, so composing this plugin over an unconfined
executor is a misconfiguration
```

这正是 §3.4 那条契约在起作用：框架不允许把"声称带沙箱模式"的预设架在不围栏的执行器上，因此也堵死了"用假 `sandboxMode` 蒙混过关"这条路。补丁里因此禁用了 `permission` 行（Permissions 选择器消失）；`approval`（ask/never）与围栏无关，保留。

**3. UNC 共享无法跟随 Linux 符号链接。** 实测：

| 路径类型 | `lstat` | `stat` | `realpath` | `read` |
|---|---|---|---|---|
| 普通文件 `/etc/hostname` | OK | OK | OK | OK |
| 目录 `/etc` | OK | OK | OK | `EISDIR`（正常）|
| **符号链接文件 `/etc/os-release`** | `EISDIR` | `ENOENT` | `ENOENT` | `ENOENT` |
| **符号链接目录 `/lib`** | `EISDIR` | `ENOENT` | `ENOENT` | `ENOENT` |

共享把符号链接暴露成 Windows reparse point，而它的**相对 POSIX 目标对 Windows 路径解析没有意义**。Ubuntu 上 `/lib`、`/bin`、`/etc/os-release` 全是符号链接，只读工具会大面积 `FS_NOT_FOUND`。
已在插件里修掉（`resolveSymlinks`，默认开）：读侧操作遇到 `FS_NOT_FOUND` 时，用 `readlink -f` 在**发行版内**求出真实路径后重试一次并缓存；`displayPath` 保留用户请求的路径，`targetKey` 指向真实文件——契约允许，因为 `targetKey` 是不透明的。顺带修了 `listDir` 子项泄漏 UNC `displayPath` 的问题。

### 9.3 自检输出（harness 进程内，不是沙箱子进程）

```
--- providers ---
ctx.shell constructor: WslShellExecutor
ctx.fs constructor:    WslFileSystem
ctx.shell.sandboxMode: undefined          ← 诚实声明：不围栏
ctx.fs.sandboxMode:    undefined
ctx.directoryPicker:   browse
--- ctx.shell: 在发行版内执行命令 ---
exitCode=0 timedOut=false aborted=false
stdout="/home/andy\nuser=andy\n6.18.40.1-microsoft-standard-WSL2\nHOME=/home/andy"
--- ctx.fs: 读符号链接路径 ---
read /etc/os-release: displayPath=/etc/os-release
         first line="PRETTY_NAME=\"Ubuntu 26.04.1 LTS\""     ← 符号链接修复生效
--- ctx.fs: 新建文件（guard 提前路径）---
operation=create  readback="hello-from-harness"              ← guard 提前 + rename 发布生效
--- ctx.fs: guard 仍然拒绝第二次新建 ---
FS_NOT_OBSERVED (expected)                                   ← guard 语义正确
--- ctx.fs: 列出 Linux 主目录 ---
listDir /home/andy: 184 entries
--- ctx.fs: 符号链接目录（/lib -> usr/lib）---
listDir /lib: displayPath=/lib  entries=112  child displayPath=/usr/lib/7zip
```

### 9.4 复现命令

```powershell
# 1) 建立独立 profile（--dump-config 只组合、不启动服务）
dsh wsl --from-default-profile web --dump-config

# 2) 安装插件（离线；开发用 link: 让源码改动即时生效）
dsh plugin --profile wsl add link:C:\Users\andyz\Documents\deepseek-harness\default-workspace\dsh-plugin-wsl-env

# 3) 写入补丁层（本仓库 cordis.patch.yml 的内容 + preset 覆盖）

# 4) 组合校验
dsh --profile wsl --dump-config

# 5) 端到端自检：挂载探针，探针跑完即退出
dsh --profile wsl --patch <repo>\dsh-wsl-research\selftest-overlay.yml --no-open --port 0
```

仓库自身的两个入口（不需要装任何依赖）：

```bash
npm test          # test:syntax + test:unit，纯函数，任意 Node ≥ 20 可跑
npm run probe     # 行为探针，必须从发行版内跑（它自己通过 interop 调 Windows 侧的 Node）
```

`dsh` 未加入 PATH 时，直接调安装目录里的 CLI：

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "C:\Users\andyz\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" --expose-internals `
  "C:\Users\andyz\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  --profile wsl --dump-config
```

### 9.5 模型侧验证

已完成，见 §10。这里保留一条结构性事实：基座 bundle 的顶层 `tool-bash`/`tool-pwsh` 在 web 系 profile 里**都是关的**（工具选择权交给 agent preset），所以只替换 `ctx.shell` 而不覆盖 preset，模型就完全没有 shell 工具。§9.1 的 preset 覆盖就是为此而写，且它是**从随包的 preset 文件机械转换**而来（`dsh-wsl-research/append-preset-override.mjs`），以免手抄 146 行 YAML 时破坏内嵌的 plan-mode 长文本。

### 9.6 独立 `wsl` profile（已删除）

挂接最初在独立 `wsl` profile 上完成，**当时没有碰 desktop**。§9 的全部结论都出自它。

工程化清理时它和 §10 的 `wsltest` 一起被删了 —— 两者都是一次性的验证台，留着只会变成第二份会腐烂的配置。要重跑 §9 的记录，一条命令就能重建：

```powershell
dsh wsl --from-default-profile web      # 再按 §9.4 的第 2、3 步装插件、写补丁层
```

现在目录里保留的是日常 `desktop` 与两个按需重建的探针 profile（`wslfs`、`wslmodel`，见 §16.6）。日常 GUI 的挂接见 §13。

---

## 10. 真正验证：真实模型回合

### 10.1 验证用的 profile

| 项 | 值 |
|---|---|
| profile | `wsltest`（从 `headless` 模板建立：`dsh-base` + `dsh-headless`） |
| 为什么用 headless | 它跑完一个任务就退出，而且 `--json` 会输出 `tool_call` / `tool_result` 事件——这是唯一能拿到**真实工具调用记录**的入口 |
| 模型 | `deepseek-account` / `deepseek-flash`（与 desktop 一致，走本机已登录账号） |
| 工具行 | `tool-bash: disabled: false`、`tool-pwsh: disabled: true` |

headless profile 没有 agent preset，所以工具选择回到基座 bundle 自己的平台门控行——正好是干净的最小验证面。

### 10.2 命令

```powershell
dsh --profile wsltest --json "Do exactly two things ... first call the bash tool with: uname -r; id -un; pwd . second use the read tool on /etc/os-release"
```

### 10.3 结果：两条工具调用，两个 seam 都被证明

```json
{"type":"tool_call","tool":"bash","input":{"command":"uname -r; id -un; pwd"}}
{"type":"tool_result","status":"completed","result":"6.18.40.1-microsoft-standard-WSL2\nandy\n/home/andy\n"}

{"type":"tool_call","tool":"read","input":{"file_path":"/etc/os-release","limit":1}}
{"type":"tool_result","status":"completed","result":"<path>/etc/os-release</path>\n<type>file</type>\n<content>\n1: PRETTY_NAME=\"Ubuntu 26.04.1 LTS\"\n\n(Showing lines 1-1 of 13. Use offset=2 to continue.)\n</content>"}
```

结论：

- **工具名就是 `bash`**（不是 `pwsh`）→ preset 的工具切换生效。
- `6.18.40.1-microsoft-standard-WSL2` 是**本机内核版本，我没有告诉过模型**，Windows 上不可能产出 → `ctx.shell` 确实在发行版内执行。
- `read /etc/os-release` 成功，且结果里 `<path>` 就是 `/etc/os-release`（POSIX 路径，**没有泄漏 `\\wsl.localhost`**）→ `ctx.fs` 的路径改写与符号链接修复在模型可见层面都成立。
- `exit=0`，无告警。

### 10.4 这次真实回合抓出的一个 bug（进程内自检抓不到）

第一次真实回合里 `bash` 成功、**`read /etc/os-release` 却失败**：

```
tool_result  status="error"  result="Error: cannot read \"/etc/os-release\": not found"
```

而 §9.3 的进程内自检明明是过的。差别在调用序列。`dsh-tool-fs` 的 read 是：

```js
const target = await ctx.fs.resolve(requestedPath, ...)
const info   = await ctx.fs.stat(target, ...)
if (info === undefined) throw new FsError(`cannot read "...": not found`, "FS_NOT_FOUND")
```

`stat` 对"不存在"是**返回 `undefined`，不是抛异常**（`fs-local` 里 `if (!info) return void 0`）。而无法跟随的符号链接走的正是这条静默路径。我原来的重试只捕 `throw`，所以从未触发；自检直接调 `readText`（那条路会抛），因此掩盖了问题。

修法：`withCanonicalRetry` 除了捕获 `FS_NOT_FOUND` 抛出，也要在**返回 `undefined`** 时重试一次规范化路径。

这是一次很好的教训：**进程内直调服务 ≠ 模型真实调用**。工具层在服务之上还有自己的分支判断（这里就是 `undefined` 与异常的差别），只有真实回合才走得到。

### 10.5 复现 / 清理

```powershell
# 复现（会消耗一次模型调用）
dsh --profile wsltest --json "Call the bash tool with: uname -r; id -un; pwd ; then report it."

# 不再需要时删除
Remove-Item "$env:USERPROFILE\.dsh\profiles\wsltest" -Recurse -Force
```

`wsltest` 当时作为随时可重跑的验证台留着，工程化清理时已删除（理由同 §9.6）。上面这两条命令仍然是复现方式，只要先用 `dsh wsltest --from-default-profile headless` 把它建回来。

---

## 11. 实测缺陷：bash 命令里的 `$` 全被吃掉（已修复）

这是手工试用时暴露出来的**最严重缺陷**，而且在之前的自动验证里完全没被发现。

### 11.1 症状

任何带变量的 bash 命令都拿不到值：

```
$ bash -lc 'x=1; echo "x=[$x]"; false; echo "q=[$?]"'
x=[]        ← 应为 x=[1]
q=[0]       ← 应为 q=[1]
```

而且**连写进文件的 heredoc 内容也被展开**：

```bash
cat > v.sh <<'SCRIPT'
x=1
echo "x=[$x]"
SCRIPT
```
结果 `/tmp/v.sh` 里存的就是 `echo "x=[]"`。

连 `EXE=/path; "$EXE"` 这种「先赋值后引用」都会变成 `: command not found`。凡是 `$VAR`、`$?`、`$1`、`$(...)`、`${...}`、`$((...))`、反引号，全废。

### 11.2 根因

**`wsl.exe` 不带 `--exec` 时，会把命令行交给发行版的默认 shell 再解析一遍。**

关键在于这一次重解析会**破坏我们原本的引号**：命令字符串是以**一个** argv 元素传给 `wsl.exe` 的，`wsl.exe` 把它重新拼成命令行交给 guest shell，我精心写的 `'...'` / `<<'EOF'` 到那一层已经失去保护作用，于是 `$x` 被展开掉。之后 `bash` 收到的已经是展开后的文本。

对照实验（Node 直接用 argv 数组 spawn `wsl.exe`，中间没有任何 shell，所以差异只可能来自 `wsl.exe` 自己）：

| 形态 | 结果 |
|---|---|
| `--cd /tmp -- bash -lc "<cmd>"`（插件原形态） | ❌ `x=[]` `q=[0]` |
| `--cd /tmp --exec bash -lc "<cmd>"` | ✅ `x=[1]` `q=[1]` |
| `--cd /tmp -- bash -c "<cmd>"` | ❌ |
| `--cd /tmp --exec bash -c "<cmd>"` | ✅ |
| `--cd /tmp -e bash -lc "<cmd>"`（`--exec` 短形式） | ✅ |
| `--cd /tmp -- bash script.sh`（文件名里没有 `$`） | ✅ |

最后一行解释了**为什么之前的验证全绿**：`uname -r; id -un; pwd` 里一个 `$` 都没有，恰好绕开了这个缺陷。也解释了为什么 `echo "$PATH"` 看起来正常——外层 shell 和 bash 的 `PATH` 本来就一样，展开一次看不出来。

### 11.3 修复

`argv` 里用 `--exec` 取代 `--`（两者不能同时用：`--` 之后 `--exec` 会被当成要执行的命令名）：

```js
this.config.wslPath,
...distroArgs,
"--cd", toLinuxPath(spec.workdir, { distro }),
"--exec",                                       // ← 关键
shell, ...shellArgs(shell, this.config.loginShell),
spec.command,
```

同样的修正也加到了 `lib/wsl.js` 的 `runInDistro` / `linuxHome` / `canonicalLinuxPath`（这三处也会把命令交给 guest shell）。

### 11.4 真实模型回合验证

```
tool_call    tool="bash"   command: x=7; echo "x=[$x]"; false; echo "q=[$?]"
tool_result  completed    "x=[7]\nq=[1]\n"
```

修复前同一条是 `x=[]`、`q=[0]`。

### 11.5 顺带澄清：脚本的执行位不是缺陷

Windows 侧写入的脚本是 `-rw-r--r--`，所以 `./script.sh` 会 `Permission denied`（exit 126）。但这**和原生 Linux 行为一致**——`echo ... > script.sh` 同样是 644。要点：

- `bash script.sh` 照常可用；
- 需要直接执行就先 `chmod +x script.sh`（**在发行版内 chmod 有效**，实测 `chmod +x && ./sh.sh` → exit 0）；
- 插件没有"自动给 shebang 脚本加执行位"这种行为——`fs` seam 本身没有 mode 参数，宿主后端 `fs-local` 也不会这么做，加上去反而与宿主后端不一致。

### 11.6 教训

**进程内自检和「没有 `$` 的简单命令」都会漏掉这类缺陷。** 真正暴露它的是人手工写的、带变量的脚本。自动验证里至少应该包含一条 `x=1; echo "$x"; false; echo "$?"` 形态的用例——已在 §10 的验证台里补上这一类。

### 11.7 修复后必须重启

模块代码**不走 HMR**（基座里 `dsh-hmr` 的 `root: []` 表示模块根是 opt-in，只有 profile 配置会热重载）。所以改完插件要**完全退出应用再启动**才生效。这一点有个现成的自证：修完之后，本会话（未重启）里 `EXE=/path; "$EXE"` 依然报 `: command not found`，而新进程里同一条已经正常。

---

## 12. shell 不再硬编码 bash（用户指出的问题）

### 12.1 问题

第一版把 shell 写死成 `bash`。但**这台机器的发行版用户登录 shell 根本不是 bash**：

```
SHELL=/usr/bin/zsh
passwd: andy:x:1000:1000:,,,:/home/andy:/usr/bin/zsh
```

于是用户的 zsh 环境（PATH 追加、`~/.zshenv` / `~/.zprofile`、工具链初始化）全都没生效，而模型却在一个"看起来像 bash"的壳里跑命令。这不是风格问题，是**忽略了用户的实际配置**。

### 12.2 修复

解析顺序（`lib/wsl.js` 的 `defaultShell`）：

1. `passwd` 里当前 uid 的第 7 个字段 —— **权威来源**，因为用户可以导出不同的 `SHELL` 而不改登录 shell：
   `--exec sh -c 'getent passwd "$(id -u)" | cut -d: -f7'`
2. `printf %s "$SHELL"` —— `getent` 不存在时（busybox 系）的兜底
3. `bash` —— 最后兜底

配置里新增 `shell`（空 = 自动解析，填绝对路径 = 钉死一个）。解析结果**只做一次**并缓存，不会每条命令都 spawn。

注意这里必须**由我们自己指定 shell**：`--exec` 会绕过发行版默认 shell，而不用 `--exec` 又会引入 §11 的双重解析 —— 两者只能二选一，所以只能自己解析。

### 12.3 `-l` 不是所有 shell 都认

`shellArgs()` 按 shell 家族决定 flag：

| shell | 请求 login 时 |
|---|---|
| `sh` `bash` `dash` `zsh` `ksh` `mksh` `ash` `busybox` | `-lc` |
| `csh` `tcsh`（login 靠 argv[0] 表示） | `-c` |
| `fish` `nu` `xonsh` `pwsh` 及其他 | `-c` |

宁可不给 login 语义，也不给一个含义不同或根本不存在的 flag。已由 `test/shell.test.mjs` 覆盖。

### 12.4 真实模型回合验证

```
tool_call    bash: echo "argv0=$0"; echo "SHELL=$SHELL"; echo "zsh_version=${ZSH_VERSION:-none}"; x=7; echo "x=[$x]"
tool_result  completed
             argv0=/usr/bin/zsh
             SHELL=/usr/bin/zsh
             zsh_version=5.9
             x=[7]
```

`zsh_version=5.9` 是决定性证据（bash 里这个变量不存在）；同时 `x=[7]` 说明 §11 的 `--exec` 修复依然成立。

### 12.5 两个必须知道的残余细节

**工具名仍然叫 `bash`。** DSH 的模型可见工具由 `dsh-tool-bash` 提供，名字是固定的。所以模型看到的工具名是 `bash`，实际跑的却是 zsh。zsh 与 bash 在常用命令上兼容，但 `[[ ]]`、数组下标、`set -o` 选项等有细微差异，模型偶尔可能写出 bash 特有写法。这是工具层命名，不是执行层问题。

**非交互的 `-c` 不加载交互式 rc。** `zsh -lc` 会走 `~/.zshenv` 和 `~/.zprofile`（login），但**不会**加载 `~/.zshrc`（那是交互式 shell 的），所以 `.zshrc` 里的 alias / 插件对 agent 不可见——这是 shell 自身的语义，不是插件能改变的。想让某段配置对 agent 生效，放进 `~/.zshenv` 或 `~/.zprofile`。

### 12.6 老规矩：改完要重启

依然因为模块代码不走 HMR。**完全退出应用 → 重新启动**才会用上新的 shell 解析。

---

## 13. 环境属于**会话**，不属于进程

> **本节是当前生效的设计。** 早期的 `DSH_WSL` 进程开关**已被取代并从 desktop 移除**（归档 §10）；§11/§12 关于 shell 与工具本身的修复依然有效。

### 13.1 为什么不是进程开关

`DSH_WSL` 是进程级、启动时的开关，而 DSH 是多工作区并发的：一个进程里多个 agent，各有自己的 ctx。把环境绑到进程上，等于强迫所有工作区共享同一环境 —— 与产品前提冲突。那条路线的完整记录在归档 §10。

### 13.2 机制（均有代码或实测依据）

| 能力 | 依据 |
|---|---|
| 服务可按 entry 隔离 | `cordis-plugin-loader` 的 `isolate` 用 `Context.isolate` 符号表建 realm，子树内注册/解析走私有符号，子树外仍走全局 |
| preset 就是"每会话一份组合" | `AgentPreset` 是 `EntryGroup`（`static [EntryGroup.key] = true`）；`dsh-agent` 文档明确 per-agent 差异与并发 |
| realm 必须写在 **preset 内部** | registry 的 `register()` 里 `const context = this.ctx`（registry 自身 ctx），挂载用 `createScope(this.owner, key)` —— 所以 preset 行上的 `isolate` 覆盖不到它的插件 |
| 缺少隔离会被拒挂 | registry 代码：`Preset services require isolate realms: …` |

### 13.3 组成

```
全局（宿主环境，完全随包）
  pwsh-sandbox / fs-sandbox / permission   ← 全部保持启用（沙箱 + Permissions 都在）
  directory-picker                          ← 禁用，换成 WSL 感知的 picker（两种世界共用）

preset-wsl（新；隔离组 isolate: {shell, fs}）
  组内：wsl-shell + wsl-fs + tool-wsl-shell + 官方 preset 的整张插件表
  组内：tool-bash / tool-pwsh 均 disabled（本 preset 两个都不用）

auto-preset（新）
  按会话工作区目录自动选环境，见 16.4
```

**工具名不再有歧义**：宿主 preset 用 `pwsh`，wsl preset 用 `zsh`（由 shell 路径推导），二者从不出现在同一个 agent 的工具集里 —— 这正是"彻底解决工具层命名"的终局。

### 13.4 auto-preset 的两个关键细节（都由实验确定）

**① 尊重显式选择。** 事件触发时 preset 已按"请求值或默认值"挂载，无法区分二者 —— 所以只在**挂载值等于 registry 默认值**时才改写（说明客户端没指定）。操作者的显式选择永不被覆盖。

**② 必须在创建之后切换，不能在创建过程中。** 监听器里立即切换会撞上上一代工具尚未退休：

```
Error: tool "subagent" is already registered in this scope
```

延后到创建返回之后即可（会话此时仍为空，`select()` 依然合法）。插件用短重试吸收剩余时序余量，并把 `agent-preset/locked`（已开首轮）与 `agent-preset/not-found`（preset 未组合）当终态而非错误。

### 13.5 实测

**① GUI 端到端（决定性）** —— 在 WSL 文件夹里新建会话，让模型执行 `uname -r`：

```
6.18.40.1-microsoft-standard-WSL2
```

这条输出只能在发行版内核里取到，所以它一次性证明了完整链路：auto-preset 识别 WSL 工作区 → 绑定 `wsl` preset → **模型可见的工具变成 `zsh`** → 在发行版内真实执行并回传。Windows 工作区则保持在宿主 preset（沙箱 + Permissions 都在）。

**② 进程内验证（用已安装的补丁文件本身）**

```
全局              : SandboxPwshExecutor / SandboxedFileSystem  sandboxMode=workspace-write
permissionPresets : mounted（Permissions 选择器可用）
WSL 工作区        : preset=wsl  shell=WslShellExecutor  uname -r → 6.18.40.1-microsoft-standard-WSL2
Windows 工作区    : preset=standard（正确保持不动）
```

**③ 决策轨迹**（`DSH_WSL_TRACE` 打开时）

```
consider cwd="\\\\wsl.localhost\\ubuntu\\home\\andy"  current=standard
  -> acting: fallback=standard isWsl=true          ← WSL 工作区：动手
consider cwd="C:\\Users\\andyz\\Documents\\..."      current=standard
  （无 "-> acting"）                                ← Windows 工作区：正确不动
```

### 13.6 怎么用

**什么都不用切。** 打开 WSL 里的文件夹时，新会话自动进入 wsl preset；打开 Windows 文件夹时留在宿主 preset。两者可在同一进程内并行。想手动指定就用 GUI 的 preset 选择器。

这套隔离就是在日常 `desktop` profile 上验证的 —— §13.5 的三行输出来自同一进程里的三个会话。当时另外建的 `wslverify`、`envweb` 两个临时 profile 已在工程化清理中删除。

### 13.7 踩过的坑

1. **裸 `- id:` 永远不能新增行** —— 它只能覆盖已存在的行，找不到就 `patch: entry "X" not found` 然后**静默跳过**。新增必须包 `- insert:`。我曾因此在"没报错"的基础上得出完全错误的结论。
2. **`--dump-config` 不求值 `!!js`** —— 只能看组合文本，门控逻辑必须实机启动才能验证。（新设计已无 `!!js`，dump 因此变得完全可信。）
3. **`ctx.tools.get(name, scope)` 的 scope 参数我传错过**，导致连 `read`/`write` 都报不存在；不要据此判断工具缺失。
4. **服务是异步激活的** —— 插件 `apply` 里立刻 `ctx.get(name)` 可能读到"还没挂上"，要在流程末尾重读（`permissionPresets` 就是这样从 ABSENT 变 mounted 的）。
5. **进程内直调服务 ≠ 模型真实调用** —— 工具层在服务之上还有自己的分支（例如 `stat` 用返回 `undefined` 而不是抛异常表示"不存在"），只有真实回合走得到。

### 13.8 headless 环境的两条限制（不影响 GUI）

用 `dsh-headless` 做端到端验证时会撞上这两条，**它们都不是插件缺陷**：

1. **`wsl` preset 在 headless 组合里挂不上** —— 它的插件表搬自 **web** preset，其中 `tool-subagent` 在 headless 里报
   `\`modelSelectionSettings\` requires @deepseek-ai/dsh-tool-subagent/model-selection-settings in the Host scope`。
   补上那一行 host 域配套行即可挂载。
2. **headless 是"创建即提交"** —— 首轮工具集在创建 agent 时就组装完了，而 auto-preset 必须在创建**之后**才能切换（见 16.4 ②），所以切换落在组装之后，模型看到的是旧工具集。
   **GUI 不受影响**，因为它是「先建会话 → 用户打字 → 才发首轮」，窗口足够大；16.5 ① 已实测通过。
   若将来出现"建会话与首轮同一个请求"的客户端，就必须把决定挪到挂载**之前**（给 `composeAgent(presetId, cwd)` 传入 cwd，或对 asar 打最小补丁）。

排查手段：设 `DSH_WSL_TRACE=<文件路径>`，插件会把每一步判断写进去。这是加出来的，因为 `ctx.logger` 在本插件里不可注入 —— 早期它整体静默失败，把真实异常吞掉了，害我多绕了一圈；现在 `warn` 会在 logger 不可用时回退 stderr。


### 13.9 应用升级后：重新生成 `preset-wsl` 段

`cordis.patch.yml` 里的 `preset-wsl` 那一整段，是从随包 preset **生成**的固定副本（生成器在本机对照目录里，见 §4 末尾），它钉住当前的 preset 形态 —— 包括内嵌的 plan-mode 长文本和每一层嵌套分组。应用升级后若官方改了 preset，必须重新生成：

```powershell
# 1) 用 extract.mjs 从新版 app.asar 重新抽出官方包（对照目录，见 §4 末尾）
# 2) 重新生成 preset-wsl 段：<随包 preset 文件> -> <输出文件>
node dsh-wsl-research/build-preset-wsl.mjs `
  dsh-wsl-research/pkgs/dsh-web-app/presets/standard.patch.yml `
  dsh-wsl-research/preset-wsl.yml
# 3) 把生成的 - insert: 段替换进 profile 补丁，在一个临时 profile 上双模式验证后再覆盖 desktop
```

不重新生成也能继续跑，但那份副本会与新版 preset 悄悄脱节 —— §15.5 的"升级后要做的事"因此不是"无"。

---

## 14. 用 `DSH_*` 环境事实告诉模型它的 shell

### 14.1 为什么这才是"现成的机制"

`dsh-shell-env` 拥有 **`ctx.shellEnv`** —— 一个在**每次模型 shell 调用**时重建的、受信任的 `DSH_*` 变量注册表。工具自己的描述就指引导模型去看它：

> "Managed `$DSH_*` variables expose current harness environment facts."

而且它开放了插件扩展点：

```js
ctx.shellEnv.register({
  name: "…",
  variables: { DSH_SOMETHING: { description: "非空，必填" } },
  resolve: (execution) => ({ DSH_SOMETHING: "…" }),   // 必须【同步】返回
});
```

约束：key 必须以 `DSH_` 开头、形如 `[A-Z][A-Z0-9_]*`、每 key 全局唯一所有者、**不可占用保留键**。

### 14.2 `DSH_SHELL` 不是 shell 路径（容易误判）

```js
collect(execution) {
  const values = { [DSH_HOME_ENV]: this.dshHome, [DSH_SHELL_KEY]: "1" };  // ← 标记位
```

`DSH_SHELL=1` 是一个**标记**（让脚本判断"我在 DSH 的 shell 调用里"），且它在 `RESERVED_BASH_ENV_KEYS` 里，插件无法拥有。所以"把真实 shell 写进 `DSH_SHELL`"这条路不存在 —— 正确做法是**用自己的 `DSH_WSL_*` 键**。

### 14.3 本插件贡献的三个事实

`lib/shell-env.js`（`inject = ["shellEnv"]`），挂载在 profile 顶层（全局一个实例）：

| 变量 | 值 | 说明 |
|---|---|---|
| `DSH_WSL_DISTRO` | `ubuntu` | 工作区所在发行版 |
| `DSH_WSL_SHELL` | `/usr/bin/zsh` | 模型 shell 调用实际使用的登录 shell（描述里明确"不是 bash"） |
| `DSH_WSL_HOME` | `/home/andy` | 发行版内用户家目录（**POSIX 路径**，不是 UNC） |

两个实现要点：

1. **`resolve` 必须同步** —— 注册表对它的返回值直接做 `Object.entries`，返回 Promise 会**静默变成空**。所以三个事实在 `apply` 时一次性解析并缓存（各需一次 `wsl.exe` 调用）。
2. **`DSH_WSL_HOME` 必须转成 POSIX**。`linuxHome()` 返回的是宿主侧 world 路径（`\\wsl.localhost\...`），而消费者是**发行版里的 shell** —— 第一版就是这样错的，实测才发现，现经 `toLinuxPath()` 转换。
3. 用 `ctx.effect(() => dispose)` 释放注册：配置热重载会重跑 `apply`，而注册表**拒绝**第二个声明相同 key 的贡献者。

### 14.4 作用域判据：与 `auto-preset` 同一个

```js
resolve: (execution) => {
  const cwd = execution?.agent?.session?.header?.cwd;
  if (!isWslUnc(cwd)) return {};
  …
}
```

工作区在发行版内 ⇔ 该会话的 shell 调用在发行版里执行。所以宿主会话**完全看不到**这三个变量（实测：Windows 会话只有 `DSH_HOME`/`DSH_PROFILE`/`DSH_SESSION_ID`/`DSH_SHELL=1`/`DSH_WEB_URL`）。

### 14.5 实测（`ctx.shellEnv.collect({ agent })`）

```
WSL     preset=wsl
  {…,"DSH_WSL_DISTRO":"ubuntu","DSH_WSL_HOME":"/home/andy","DSH_WSL_SHELL":"/usr/bin/zsh"}
Windows preset=standard
  {…}                        ← 无任何 DSH_WSL_*
```

### 14.6 代价：工具名与描述仍是上游的（`bash`）

`shellEnv` 注入的是**环境变量**，改不了**注册期烧死**在 `dsh-tool-bash` 里的工具名与描述。所以 WSL 会话的 shell 工具仍自称 `bash`、描述写 `` bash -c ``。

这是**有意接受的取舍**：模型从 `$DSH_WSL_SHELL` 就能知道真实 shell（而且比工具名更可靠 —— 它随环境自动更新），不必再靠运行时改写别人的工具定义。若将来上游采纳归档 §17 的改动（让工具按挂载的 shell 自我命名），工具名也会自动如实，届时无需任何插件侧动作。

### 14.7 跨边界转发：一个静默失效点（实测发现）

`DSH_*` 的注入发生在**工具层**（`dsh-tool-bash`：`const dshEnv = ctx.shellEnv.collect(exec)`），而这些名字只存在于 **Windows 侧进程**。WSL 只导入 `WSLENV` 中列出的名字 —— 所以一个"只转发白名单"的执行器会把整组 `DSH_*` **静默丢掉**。

本插件第一版正是如此：`SAFE_FORWARD = [NO_COLOR, TERM, PAGER, GIT_PAGER, LANG, LC_ALL]`，结果 WSL 会话里 `env | grep -i '^DSH'` **一个都没有**（连 `DSH_SHELL=1` 都没过去）。诊断线索就藏在 `WSLENV` 自身：`WSLENV=NO_COLOR:TERM:PAGER:GIT_PAGER`。

修法：按**前缀**放行整个托管命名空间，任何新增事实都自动跟随：

    const forwarded = Object.keys(base.env ?? {}).filter(
      (name) => forward.has(name) || name.startsWith(DSH_ENV_PREFIX),
    );
    // 然后 WSLENV = forwarded.join(":")

**为什么进程内探针抓不到**：`DSH_*` 由工具层注入，而探针走 `shell.resolve/execute` 直连服务、绕过工具层 —— 结构上不可能观察到。只有真实会话能验证。（这正是"进程内直调服务 ≠ 模型真实调用"那条教训的又一次实例。）

**实测（WSL 工作区，真实会话）**：

    DSH_HOME=C:\Users\andyz\.dsh
    DSH_PROFILE=desktop
    DSH_PROFILE_DIR=C:\Users\andyz\.dsh\profiles\desktop
    DSH_SESSION_ID=session-…
    DSH_SHELL=1
    DSH_WEB_URL=http://127.0.0.1:19387
    DSH_WSL_DISTRO=ubuntu
    DSH_WSL_HOME=/home/andy
    DSH_WSL_SHELL=/usr/bin/zsh

**路径类事实的 `/p` 翻译（已实现）**：`WSLENV` 支持对单个名字加 `/p`，WSL 会在导入时把 Windows 路径翻成 `/mnt/c/...`。`lib/index.js` 的 `PATH_TRANSLATED` 只放了 `DSH_HOME` 与 `DSH_PROFILE_DIR` 两个 —— 它们本来就是 Windows 路径。**不可**对 `DSH_WSL_HOME` 加 `/p`：它已经是 POSIX 路径，翻译会破坏它。

实测（就是本次会话本身，`env` 原样）：`DSH_HOME=/mnt/c/Users/andyz/.dsh`、`DSH_PROFILE_DIR=/mnt/c/Users/andyz/.dsh/profiles/desktop`，`ls $DSH_HOME` 可用。

---

## 15. 让**初次**挂载就是正确的环境

### 15.1 为什么必须发生在创建期

宿主 preset 带着 **Windows ACL 沙箱**。当一个 WSL 工作区（`\\wsl.localhost\…`）落在宿主 preset 上时，沙箱会尝试为该工作区配置授权，而 **9p 重定向路径不承载 Windows 安全描述符**：

    GetNamedSecurityInfoW failed (Win32 1): \\wsl.localhost\ubuntu\home\andy\…

shell 工具在**准备阶段**即失败，工作区**不可用** —— 不是"名字不实"这种表观问题。而"创建后再切换 preset"（见 §13.4）只要首轮不等它就来不及。沙箱侧的诊断结论也确认：从工作区逐级上溯到 `\\wsl.localhost\ubuntu`，`Get-Acl` 全部报 `0x80131509 / win32=5385`，**不存在可修复的 ACL 问题**，唯一正确的做法是让该工作区根本不进入那个沙箱。

### 15.2 接缝

控制器的 preset 解析在 `composeAgent(presetId)` —— **它的签名里没有 cwd**。但它由这一帧调用：

    async create(request) {
      const cwd = workspace?.path ?? request.cwd ?? this.defaultCwd;
      adopted = await this.agents.ensureSession(sessionId, cwd, request.sessionId !== void 0, request.agentPreset);
    }

`ensureSession(sessionId, cwd, …, presetId)` **同时握着 cwd 与 presetId**，而 `this.agents`（`ApiSessionAgentController`）是**普通自有属性**，可以包裹。于是 `lib/auto-preset.js` 在该帧补齐 preset：

    ctx.inject(["sessionController"], (controllerCtx) => {
      const facade = controllerCtx.sessionController?.agents;
      const original = facade.ensureSession;
      facade.ensureSession = async function (sessionId, cwd, checkPersistedIdentity, presetId) {
        if (presetId !== void 0 || !isWslUnc(cwd)) return original.call(this, …);
        try { return await original.call(this, sessionId, cwd, checkPersistedIdentity, target); }
        catch (error) {
          // 已按别的 preset 存档的会话会拒绝更换：回退，而不是把"收养"变成新的失败面
          if (!String(error?.message ?? "").includes("agent preset")) throw error;
          return original.call(this, sessionId, cwd, checkPersistedIdentity, presetId);
        }
      };
      controllerCtx.effect(() => () => { facade.ensureSession = original; });
    });

事后切换（§13.4）**保留为兜底**：手动改 preset、以及此前已存档的会话仍走它。

### 15.3 实测

    WSL    : 创建即刻 preset = wsl        shell = WslShellExecutor
    Windows: 创建即刻 preset = standard   shell = undefined
    WSL 实跑: "6.18.40.1-microsoft-standard-WSL2"

**GUI 端到端（用户实测）**：直接打开 WSL 文件夹 → 新建会话 → `uname -r` → `6.18.40.1-microsoft-standard-WSL2`，命令确认运行在发行版内核上，**不再需要手动选 preset，也不再出现沙箱错误**。

### 15.4 ⚠️ 一次严重的自我误判（必须留档）

排查路 C 时我连续"证伪"了四个假设（绝对路径 vs 裸标识符、首次 ESM 导入竞态、官方 `diagnostic`/`compositionInventory` 为空、Loader entry 无 fiber），并一度建议**放弃路 C**。

**四个实验全部无效** —— 因为它们共用一个前提：provider 模块是好的。而实际上，我在加 `/p` 路径翻译时用正则插入代码，把顺序写反了：

    const PATH_TRANSLATED = new Set([`${DSH_ENV_PREFIX}HOME`, …]);  // 先用
    const DSH_ENV_PREFIX = "DSH_";                                  // 后声明

`DSH_ENV_PREFIX` 处于**暂时性死区**，模块求值即抛 `ReferenceError` → `lib/shell.js` 加载失败 → preset 的两行拿不到 fiber → 报 `never started`。**这个错误让 `wsl` preset 在任何路径下都挂不上**，于是我把自己的回归误读成了框架的结构性限制。

**教训（比结论更重要）**：

1. **动手改代码用正则插入时，必须回头读一遍插入结果。** 本次若在插入后打印那两行，五轮实验可以省掉。
2. **实验前先证明实验环境本身是干净的。** 一个"意外的共同前提"会让所有证伪都失去意义 —— 而我当时的推理恰恰是"四个假设都被证伪，所以机制不可观测"，这正是最危险的一步。
3. **诊断接口返回空对象，未必是"没有答案"，也可能是"问错了对象"**：`diagnostic`/`compositionInventory` 不含 Loader 导入失败的细节，真实错误在那里根本没有被记录。

### 15.5 现在的完整形态

| 能力 | 机制 |
|---|---|
| 环境按会话隔离、Windows 与 WSL 并行 | `preset-wsl` 的 `isolate: { shell, fs }`（§13） |
| **初次挂载即正确**，宿主沙箱永不接触发行版路径 | `ensureSession` 帧内补齐 preset（§15） |
| 模型知道真实 shell / 发行版 / 家目录 | `ctx.shellEnv` 贡献 `DSH_WSL_*`（§14） |
| 跨边界转发托管 `DSH_*` 命名空间 | 执行器按前缀放行 + 路径类变量加 `/p`（§14.7） |
| 无 fork、无上游改动、无 app 改动 | §15/§17/§18 的路线均已废弃（见归档） |
| 升级 app 后要做的事 | 插件本身**无**；只有官方改了 preset 时才需要重新生成 `preset-wsl` 段（§13.9） |
---

## 16. 写与编辑：9p 上没有 Windows 安全描述符（已修复）

### 16.1 症状

WSL 会话里**新建文件可以，改已有文件一律失败**：

```
write  →  Error: GetFileSecurityW EIO (Win32 1): \\wsl.localhost\ubuntu\home\andy\…\file
edit   →  Error: GetFileSecurityW EIO (Win32 1): \\wsl.localhost\ubuntu\home\andy\…\file
```

这次是在 GUI 里直接复现的（本次会话就跑在 `wsl` preset 上）：`write` 一个**已存在**的文件报上面的错，`edit` 同一个文件同样报错，文件内容保持原样（写入是原子的，失败发生在落盘之前）。

危险之处在于它不像坏了：`read` 正常、`write` 建新文件正常、`bash` 正常，于是"这个环境能用"的错觉会一直维持到第一次真正改文件为止 —— 而改文件正是写代码的主要动作。

### 16.2 根因：`dsh-fs-local` 的 win32 分支

`dsh-fs-local/lib/index.js` 的 `writeFileAtomic` 在**目标已存在**时走 Windows 分支 —— 这段分支的用意是"替换要继承被替换文件的 DACL"：

```js
const platform  = internals.platform ?? process.platform;      // win32
const copyFileDacl = internals.copyFileDacl ?? copyFileDaclWin32;
...
if (platform === "win32" && mode !== void 0) await copyFileDacl(absolutePath, tempPath);
...
else if (platform === "win32" && mode !== void 0) await replaceFile(absolutePath, tempPath);
```

`mode !== void 0` 在这里的含义是"**目标存在**"（模式从 `probe()` 的 `lstat` 来）。而 `copyFileDaclWin32` 第一步就是

```js
api.getFileSecurityW(nativePath, DACL_SECURITY_INFORMATION, descriptor, descriptor.length, needed)
```

在 `\\wsl.localhost\...` 上返回 `Win32 1`（`ERROR_INVALID_FUNCTION`），被映射成 `EIO`。**9p 共享不承载 Windows 安全描述符**，所以这一步没有"修好"的可能 —— 只能不走它。同一个分支的 `ReplaceFileW` 也不是 9p 原语。

为什么之前没撞上：§10 的真实回合只调了 `read`；§2.2 的 UNC 原语实验是裸 Node 直接 `rename`，**绕过了 `dsh-fs-local`**；§9.3 的进程内自检也只测读。写侧唯一被测过的是"新建"，而那正是 `mode === undefined`、不进这条分支的情况。

### 16.3 第二个缺陷更隐蔽：权限位会被静默丢掉

把 DACL 那一步拿掉以后，写/编辑能成功了，但**每改一次可执行文件就把它变成不可执行**。实测（`test/probe/mode-probe.mjs`，Windows Node 直连 UNC）：

| 问题 | 实测结果 |
|---|---|
| 宿主侧 `stat` 能读到真实模式吗 | ❌ 恒报 `666`（发行版内是 `755`） |
| 宿主侧 `chmod` 生效吗 | ❌ 不生效（`chmod 700` 之后发行版内仍是 `755`） |
| 发行版内 `chmod` 生效吗 | ✅ |
| 发行版内对**暂存文件** chmod，再被宿主 `rename` 覆盖，模式还在吗 | ✅ 还在（`rename` 保留 inode 的模式） |

也就是说 `fs-local` 传下来的那个 `mode`（宿主读到的 `666`）在这里毫无意义，而真正的模式只有发行版知道。

### 16.4 修复

`lib/index.js` 的 `WslFileSystem` 用继承实现留出的 `internals` 测试缝换掉这两个 win32 回调 —— 它们恰好就是"模式/描述符沿袭"这一步，也正是 POSIX 等价物该待的位置：

```js
this.internals = {
  ...this.internals,
  copyFileDacl: async () => {},                                       // 9p 没有描述符可读
  replaceFile: (replaced, replacement) => this.publish(replaced, replacement),
};
```

```js
async publish(replaced, replacement) {
  const source = uncToPosix(replaced);
  const staged = uncToPosix(replacement);
  if (source !== undefined && staged !== undefined) {
    await copyModeInDistro(source.distro, source.linuxPath, staged.linuxPath, { wslPath: this.config.wslPath });
  }
  await rename(replacement, replaced);      // 暂存文件 → 目标
}
```

`lib/wsl.js` 新增：

```js
export async function copyModeInDistro(distro, sourceLinux, targetLinux, options = {}) {
  const script = 'if [ -e "$1" ]; then mode=$(stat -c %a "$1") && chmod "$mode" "$2"; fi';
  await runCapture(
    [options.wslPath ?? DEFAULT_WSL_PATH, "-d", distro, "--exec", "sh", "-c", script, "sh", sourceLinux, targetLinux],
    options.signal,
  );
}
```

两个刻意的选择：

1. **在 rename 之前对暂存文件 chmod**，而不是发布之后再 chmod 目标。发布后再 chmod 会让 `writeText`/`editText` 返回的 version（`dev:ino:size:mtime:ctime`）被那次 chmod 的 ctime 改动**改旧** —— 下一次带 guard 的编辑就会莫名 `FS_STALE_VERSION`。放在 rename 前，`probe()` 读到的就是最终状态。
2. **路径走 argv 位置参数**（`sh -c '<script>' sh "$1" "$2"`），不拼进脚本文本。发行版里的路径可以有空格、引号、`$`。

### 16.5 验证：探针 + 负对照

`test/probe/` 把 `ctx.fs` 绑到发行版，逐条驱动 `writeText`/`editText`（**走的是 seam，不是裸 Node**），报告写在探针旁边。修复后全绿：

```
PASS  writeText createIfAbsent (new file)      — operation=create version=0:881592:6:…
PASS  readText returns the created content      — "alpha\n"
PASS  chmod 755 inside the distro               — 755
PASS  editText with the version guard           — version=0:881595:5:…
PASS  content after edit is the edited text     — "beta\n"
PASS  edit preserved the executable bit         — 755
PASS  writeText with the version guard          — operation=update version=0:881592:6:…
PASS  content after overwrite is the new text   — "gamma\n"
PASS  overwrite preserved the executable bit    — 755
PASS  createIfAbsent on an existing file is still refused  — FS_NOT_OBSERVED
PASS  a stale version is still refused                     — FS_STALE_VERSION

RESULT: all steps passed
```

修之前，同一份探针在同样的两行上失败（这是修复前的基线，不是推测）：

```
FAIL  editText with the version guard   — EIO: GetFileSecurityW EIO (Win32 1): \\wsl.localhost\ubuntu\home\andy\.dsh-fsprobe\probe.txt
FAIL  writeText with the version guard  — EIO: GetFileSecurityW EIO (Win32 1): \\wsl.localhost\ubuntu\home\andy\.dsh-fsprobe\probe.txt
RESULT: 4 step(s) failed
```

**负对照**（只留 DACL 修复、关掉发行版内 chmod 那一步）证明第二半是必需的，而不是顺手加的：

```
FAIL  edit preserved the executable bit      — Error: mode is 644, expected 755
FAIL  overwrite preserved the executable bit — Error: mode is 644, expected 755
```

**真实模型回合**（§10 那条标准，本机实测）：一个 headless、只挂 WSL 环境的 profile（补丁见 `test/probe/wslmodel-profile.patch.yml`），让模型自己走完 `write → chmod → read → edit → 执行`：

```
{"tool":"write","input":{"file_path":"/home/andy/.dsh-modelprobe/run.sh","content":"#!/usr/bin/env bash\necho alpha\n"}}
  result status=completed            "Created file"
{"tool":"bash","input":{"command":"chmod 755 /home/andy/.dsh-modelprobe/run.sh; stat -c %a /home/andy/.dsh-modelprobe/run.sh"}}
  result status=completed            "755\n"
{"tool":"read","input":{"file_path":"/home/andy/.dsh-modelprobe/run.sh"}}
  result status=completed            "1: #!/usr/bin/env bash\n2: echo alpha\n"
{"tool":"edit","input":{"old_string":"alpha","new_string":"beta"}}
  result status=completed            "The file /home/andy/.dsh-modelprobe/run.sh has been updated successfully."
{"tool":"bash","input":{"command":"stat -c %a /home/andy/.dsh-modelprobe/run.sh; /home/andy/.dsh-modelprobe/run.sh"}}
  result status=completed            "755\nbeta\n"
```

第 4 步就是修复前必然报 `GetFileSecurityW EIO` 的那一步；第 5 步证明**编辑之后可执行位还在，脚本还能跑**。`turn_end.reason = completed`。

同一回合还暴露了一个与主题无关但值得记的装配事实：`dsh-permission-presets` 要求所挂的 executor 是 **confined** 的（它要在沙箱模式之间切换），所以"把 WSL executor 挂到顶层"这种最小验证环境会被它拒绝并报 `did not activate`。补丁里显式 `disabled: true` 掉它即可 —— 这也解释了 §13 为什么要把 WSL 环境放进 preset 的 isolate 域，而不是替换全局 provider。

### 16.6 复现

两个 profile 都是一次性的，补丁原样放在仓库里：

| 文件 | 用途 |
|---|---|
| [`test/probe/wslfs-profile.patch.yml`](test/probe/wslfs-profile.patch.yml) | 把顶层 `ctx.fs` 换成本插件的 `fs`（web 模板） |
| [`test/probe/wslmodel-profile.patch.yml`](test/probe/wslmodel-profile.patch.yml) | headless、只挂 WSL 环境、工具行翻成 bash/file（真实回合用） |

建法与运行都写在 `test/probe/run.sh` 头部；装好之后：

```bash
npm run probe            # = test/probe/run.sh：先同步到 Windows 侧副本，再跑探针并打印报告
```

两句必须知道的：**探针只能由 Windows 侧的 Node 跑**（`wsl.exe` 与 UNC 都是宿主概念），本仓库从发行版内通过 interop 调用它；profile 里的插件指向的是 **Windows 侧那份副本**，所以 `run.sh` 会先 `test/probe/sync-to-windows.sh` —— 见 §16.7。

### 16.7 开发在发行版内，跑在 Windows 上（现在的分工）

源码现在住在 `/home/andy/Projects/dsh/plugins/dsh-plugin-wsl-env`（发行版内），但 DSH 是 Windows 进程，`profile/node_modules/dsh-plugin-wsl-env` 只能 link 到 Windows 路径 —— `pnpm add 'link:\\wsl.localhost\…'` 会把路径写成 `/wsl.localhost/…` 并留下断链（实测）。所以两边靠 `sync-to-windows.sh`（`npm run sync:windows`）显式同步，Windows 侧那份是**运行时副本**。

### 16.8 老规矩：改完要重启

插件是被 Node 以 ESM 缓存加载的，正在跑的 GUI 进程里还是旧代码。**改完 `lib/` 必须重启应用**才会生效 —— 包括这次：本次会话本身就是旧代码的最后一个受害者，`edit`/`write`（改已有文件）在这个进程里仍然会报 `GetFileSecurityW EIO`。

---

## 17. GUI 终端窗口：必须在组合层挂，不能在 preset 里挂

§13 的结论是"环境属于会话"：`ctx.shell` 与 `ctx.fs` 都挂在 `preset-wsl` 的 isolate realm 里，宿主会话与 WSL 会话在一个进程里并存。终端窗口看起来应该照抄这套 —— 在同一个 realm 里再挂一个 `ctx.subprocess` provider 就行了。**实测不行**，而且失败方式很隐蔽：补丁能装上、preset 能通过审计、boot 不报任何错，只是终端窗口当作没这回事。

### 17.1 终端窗口用的是哪个 seam

右侧栏终端窗口不是 `ctx.terminals`。`ctx.terminals`（`dsh-terminal` + `dsh-terminal-bash`）是**给模型用的**持久终端服务，靠 backend 注册类型、由 terminal 工具驱动；窗口用的完全是另一套：

| 角色 | 包 | 说明 |
|---|---|---|
| 客户端 | `@deepseek-ai/dsh-client-ui-sidebar-terminal` | 右侧栏的 tab、shell 菜单、xterm 渲染 |
| 宿主 controller | `@deepseek-ai/dsh-api-terminal-controller`（`ctx.terminalController`，namespace `terminal`） | 分配 PTY、保留屏幕、`remote.terminal` 的 9 个动词 |
| 真正干活的 seam | **`ctx.subprocess.spawnTerminal`** | controller 拿到的 `cwd` 是 `agent.session.header.cwd ?? sandboxPolicy.workspaceRoot` |

controller 解析执行环境的方式（`dsh-api-terminal-controller/lib/index.js:987`）：

```js
execution(agent) {
	const subprocess = agent.ctx.get("subprocess");
	const sandboxPolicy = agent.ctx.get("sandboxPolicy");
	if (subprocess === void 0 || sandboxPolicy === void 0) throw new Error("The Session execution environment requires subprocess and sandbox policy providers");
	return { subprocess, sandboxPolicy };
}
```

注意是 **`agent.ctx`**，不是 controller 自己的 `this.ctx`。

### 17.2 为什么 `agent.ctx` 看不到 preset 的 realm

三条源码事实合起来就是结论（均为随包代码，路径在 asar 内）：

```js
// dsh-agent-preset-registry/lib/index.js:527,534
// preset 树挂在 registry **服务自己**的 ctx 下
const scope = createScope(this.owner, key);
mount: await mountPreset(scope.ctx.extend({ baseUrl: record.context.baseUrl }), ...)

// dsh-agent-loop/lib/index.js:778
// Agent 的 ctx 是另一棵平行分支，loopCtx = 根上的 ctx.agents
this.scope = createScope(loopCtx, this);
this.ctx = this.scope.ctx;

// dsh-scope/lib/index.js:296（createScope）
// 只是 ctx.plugin(scope) + extend({[kScope]: key})：不碰 Context.isolate，也不是 loader entry
const fiber = ctx.plugin(scope);
const scoped = fiber.ctx.extend({ [kScope]: key });

// cordis/lib/types/context.js:66（extend）
// 只是 Object.create(this)，isolate map 走原型链
```

`Context.isolate` 的 realm symbol 由 loader 在 `loader/patch-context` 里按 entry 注入（`cordis-plugin-loader/lib/index.js:506-553`），只覆盖那棵 loader 子树。所以 `agent.ctx[symbols.isolate]["subprocess"]` 一路原型到**根**的 `Symbol('subprocess')` —— 即随包的 `dsh-subprocess-local`。

随包代码自己也承认这个断层：`dsh-agent-preset-registry/lib/types/mount.js:111-131` 写着 *"Browser RPCs hold the Agent but resolve outside that realm, so they locate its revision through the Agent's scope parent."*，并为此提供了官方通道 `ctx.agentPresets.serviceFor(agent, name)`（`dsh-api-session-controller` 读 preset 内 `skills` 就是这么写的）。**`dsh-api-terminal-controller` 没有用它**，所以 preset 内 isolate 的 `subprocess` provider 只有 preset 内的消费者（`tool-bash` → `ctx.shell`）看得见，终端窗口看不见。

一句话版本：**`shell`/`fs` 能按会话，是因为用它们的工具就长在 preset 里；终端窗口的消费者长在外面。**

### 17.3 替换根上的 `subprocess` 行

补丁层（`cordis.patch.yml`）因此做两件事，都是**替换/配置**而非新增：

```yaml
- id: subprocess
  disabled: true

- id: terminal-controller
  name: '@deepseek-ai/dsh-api-terminal-controller'
  config:
    shell:
      path: wsl.exe
      name: WSL
      args: []
    shellCandidates: []

- insert:
    - id: subprocess-wsl
      name: 'dsh-plugin-wsl-env/subprocess'
      config:
        distro: ''
```

注意 `dsh-app-boot` 的补丁语义：**已存在行的 `name` 只是断言，不能改包名**（`dsh-app-boot/lib/index.js:73,100-103`），所以换 provider 只能 `disabled: true` + `insert`。

`WslSubprocessRuntime extends LocalSubprocessRuntime`，**只覆写 `spawnTerminal`**：

- `argv[0]` 的 basename 去掉 `.exe` 后是 `wsl` → 用请求里的 `cwd` 反推 `{distro, linuxCwd}`：UNC 路径直接给出 distro（`\\wsl.localhost\ubuntu\...` → ubuntu + `/home/...`），Windows 盘符走 `/mnt/<drive>/...`，POSIX 路径原样；然后改写成 `wsl.exe -d <distro> --cd <linux dir>`，进程自身的 `cwd` 换成 Windows 目录（CreateProcess 不能用 Linux 路径当 cwd），并把请求里 `DSH_*` 的名字写进 `WSLENV`。
- **不 pin shell 时到此为止**：`wsl.exe` 自己启动发行版用户的登录 shell —— 和人手敲 `wsl.exe` 完全一致，不需要猜 shell。
- 其余一切请求（`cmd.exe`、`bash -i`、任何别的消费者的终端）原样交给随包实现。

爆炸半径是这次设计的核心考量：根上的 `subprocess` 是**单实例**，`bash-sandbox`、`pwsh-sandbox`、`tool-fs-search`（宿主 ripgrep）、`workspace-changes`、`terminal-controller` 全用它。只覆写终端那一个方法，别的方法逐字继承，命令路径（`WslShellExecutor` 自己拼 `wsl.exe` argv 再交给 `spawn()`）与宿主搜索路径都保持原样。

### 17.4 一个必须记住的坑：`peerDependencies` 决定 linked 插件能不能 import

第一版实现 boot 时报：

```
subprocess-wsl (dsh-plugin-wsl-env/subprocess): failed to import
```

只多了一行 `import { LocalSubprocessRuntime } from "@deepseek-ai/dsh-subprocess-local"`，而 `package.json` 里只声明了 `@deepseek-ai/dsh-subprocess`（**seam**包，不是 local 实现）。原因是运行时的解析拦截（`dsh-app-boot` 的 `installRuntimeInterception` / `readPeerNames`）：**一个 linked 插件的裸 import，只有在它自己的 `peerDependencies` 里列出过，才会被路由到安装目录里的同名包**；没列就等于不存在，且报错只说 `failed to import`，没有 cause。所以 peer 声明在这里不是"整洁问题"，是**能不能加载**的问题。

（`subprocess-local` 是 `subprocess` 的具体实现；provider 必须继承它才能拿到 PTY/进程树/输出那套机制。两者都留在 peer 列表里。）

### 17.5 实测结果

组合校验（在一次性 web profile 上用本仓库补丁做 `--patch` 覆盖层）：

```
- id: subprocess
  name: '@deepseek-ai/dsh-subprocess-local'
  disabled: true
...
- id: subprocess-wsl
  name: dsh-plugin-wsl-env/subprocess
  config:
    distro: ''
```

boot 一次，**零失败、零 pending**（第一版同一命令会打印 `terminal-controller: pending (waiting for service: subprocess)` 与 `subprocess-wsl … failed to import`）。

日常 `desktop` profile 重启后，在右栏点 **New terminal** 的现场取证（`Get-CimInstance Win32_Process` 过滤 `wsl.exe`）：

```
ProcessId 18628   ParentProcessId 14916   ← DeepSeek Harness.exe
wsl.exe -d ubuntu --cd /home/andy/Projects/dsh/plugins/dsh-plugin-wsl-env
```

即窗口里真正跑起来的就是这条命令：由 harness 进程拉起，`-d ubuntu` 与 `--cd <会话工作区的 Linux 路径>` 都按设计生成，**没有 `--exec`** —— 所以 `wsl.exe` 自己启动发行版用户的登录 shell，落地在 zsh。（同一份进程表里另有几条 `--cd "~" --distribution-id {…}`，父进程是 WindowsTerminal.exe，与本插件无关。）

### 17.6 探针：终端到底落在哪个 shell

`test/probe/terminal.sh`（`npm run probe:terminal`）在同一个一次性 profile 上再加一层覆盖补丁，把 provider 换上并挂一个探针插件：探针用**和 GUI 完全相同的请求**开一个 PTY —— `argv: ["wsl.exe"]`、`cwd` 是本仓库的 UNC 路径、`env: { DSH_SESSION_ID }`、`shellActivity: true` —— 然后敲命令、断言输出。本机实测输出（截取）：

```
TERMPROBE | /home/andy/Projects/dsh/plugins/dsh-plugin-wsl-env
TERMPROBE | PROBE-42
TERMPROBE | DISTRO=ubuntu
TERMPROBE | SESSION=wsl-terminal-probe
TERMPROBE | SHELL=/usr/bin/zsh
TERMPROBE PASS arithmetic ran
TERMPROBE PASS cwd translated
TERMPROBE PASS DSHENV forwarded
terminal probe passed
```

四条断言各自证明一件事：会话工作区（UNC）被翻成正确的 Linux 目录、`--cd` 生效；`DSH_SESSION_ID` 经 `WSLENV` 进了发行版；shell 是**发行版用户的登录 shell**（`/usr/bin/zsh`，不是硬编码 bash）；并且这是一个真正的交互式 PTY（能读到 starship 提示符）。

### 17.7 已知限制（终端）

- **终端跟随组合，不跟随会话**：这是 §17.2 的直接后果，没法在一个进程里既让宿主会话拿 `cmd.exe` 又让 WSL 会话拿 zsh —— 终端 controller 拿不到 Session 身份去分流（`terminalEnvironment()`、`resolveExecutable()` 连目录都没有）。本 profile 的选择是"终端就是发行版终端"，宿主文件夹的会话也会落到 `/mnt/<drive>/…`。
- **活动探测止步于 `wsl.exe`**：`prepareShellActivity` 只在 `platform !== "win32"` 且 argv 恰好是 `["<bash|zsh>", "-i"]` 时生效，所以 controller 的 `inspectActivity()` 只会得到 `unknown`，"无人值守空闲回收"永不触发；关 tab 才会释放进程。这是能力事实，不粉饰。
- **shell 菜单被缩到一项**：`shellCandidates: []`。把候选留给宿主的 `resolveExecutable` 会列出一堆这个终端根本不会启动的 shell（§17.7 上一条同理）。
- **pin 了 `shell` 才有 `-l`**：不 pin 时登录 shell 由 `wsl.exe` 决定，`-l`/`-i` 与插件无关；pin 成发行版内绝对路径时，只有认 `-l` 的 shell 家族会拿到它（`interactiveShellArgs`，与 §12.3 同一判据）。
- **切发行版**：UNC 工作区自带 distro 名，优先于配置；配置里的 `distro` 只用于"请求里没有发行版信息"的情况（宿主盘符、POSIX 路径、无 cwd）。
