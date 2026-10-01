# 归档：被推翻的设计与当时的排查记录

本目录保存**不再描述现行形态**的材料。现行文档是 [`README.zh.md`](../../README.zh.md)（仓库根目录）。

这里的文字是**当时写的，按当时的节号原样保留**。两条读法约定：

- **`README §N`** 指现行文档重新编号后的那一节（本文的节号与它已经对不上，凡是指向现行文档的引用都显式写成 `README §N`）。
- **裸 `§N`** 指本文自己的节号，即下面这五节。

| 本文 | 当时是什么 | 为什么被推翻 |
|---|---|---|
| §10 | 挂进日常 GUI：一个 `DSH_WSL` 进程开关，整体替换掉全局 `ctx.fs` / `ctx.shell` | 环境必须属于**会话**而不是进程：DSH 是多工作区并发的，进程级开关强迫所有工作区共享同一环境。`DSH_WSL` 已从 desktop 移除。现行设计见 [README §13](../../README.zh.md) |
| §12 | 同一开关的手动试用 step-by-step | 开关没了，流程也就没了 |
| §15 | 给工具改名的路线：从 `dsh-tool-bash` 派生一个新工具行 | 名字烧死在 `dsh-tool-bash` 的注册期，派生行无法覆盖它 |
| §17 | 同一问题的上游改动（路线 A） | 要改上游才能落地，插件侧无法独立完成 |
| §18 | 同一问题的运行时改名（B′） | 在 agent 创建后改写别人的工具定义，时序上撞上上一代工具尚未退休；最终改用 `ctx.shellEnv` 贡献环境事实（[README §14](../../README.zh.md)） |

§10.8（应用升级后重新生成 `preset-wsl` 段）**不是**被推翻的内容，已单独移入现行文档。

---
## 10. 挂进日常 GUI（desktop profile）—— per-process 的 `DSH_WSL` 开关

> **本节记录的是 per-process 设计** —— 一个 `DSH_WSL` 进程开关，整体替换掉全局 `ctx.fs` / `ctx.shell`。仍成立的只有两件事：插件确实挂在 `desktop` profile 上，以及 §10.8 的"应用升级后要重新生成 preset"。`DSH_WSL` 开关已从 desktop 移除，§10.2 / §10.4 / §10.5 / §10.9 的操作与对照都**不再适用**；§10.7 那两个 YAML 教训与具体设计无关，依然有效。现行设计见 README §13。

### 10.1 已完成的改动

| 项 | 值 |
|---|---|
| 补丁层 | `$DSH_HOME/profiles/desktop/cordis.patch.yml`（当时是"原 4 行逐字保留 + 新增 5 行"；现在是 259 行，且包含生成的 `preset-wsl` 段） |
| 备份 | `cordis.patch.yml.bak-20261001-200621`（已校验与原文件一致） |
| 插件 | 以 junction 装进 desktop（`link:`），`downloaded 0` |
| bundle 列表 | 未改动 |

**默认行为一字未改。** `DSH_WSL` 未设置时，所有新增行都是惰性的，desktop 仍是原来的 `SandboxPwshExecutor` + `SandboxedFileSystem`（`sandboxMode: workspace-write`）+ Permissions 选择器 + 原生目录选择器。

### 10.2 开 / 关

```powershell
setx DSH_WSL 1     # 开启 WSL 模式
setx DSH_WSL ""    # 关闭，回到沙箱模式
```

`setx` 写的是**用户级**环境变量，只对之后启动的进程生效——**必须完全退出并重启应用**。当前已运行的进程读不到，所以你现在这个 GUI 仍是普通模式。

### 10.3 为什么必须重启

provider 是**启动时**按服务可用性选择的，而 `ctx.shell` / `ctx.fs` 每个 context 只能有一个实现。改环境变量不影响已启动的进程。

### 10.4 两种模式实机对照

| | Mode A（`DSH_WSL` 未设） | Mode B（`DSH_WSL=1`） |
|---|---|---|
| `ctx.shell` | `SandboxPwshExecutor` | `WslShellExecutor` |
| `ctx.fs` | `SandboxedFileSystem` | `WslFileSystem` |
| `sandboxMode` | `workspace-write` | `undefined`（不围栏） |
| Permissions 选择器 | 有 | 无（`permission` 行禁用） |
| 目录选择器 | 原生 OS 选择器 | WSL 对话框（第一屏是发行版列表） |
| preset 的 shell 工具 | `pwsh` | `bash`（在 WSL 内执行） |

### 10.5 WSL 模式下的取舍（用之前必须知道）

- **文件围栏消失**：`dsh-fs-sandbox` 是唯一真正执行写入围栏的组件，WSL 模式下它被禁用。Windows 路径（`C:\...`）仍可读写——`restrictToDistro` 只挡"别的发行版"，不挡 Windows 盘。
- **Permissions 选择器消失**：因为框架拒绝把"声称带沙箱模式"的预设架在不围栏的执行器上（README §9.2 的 fail-loud）。这不是配置疏忽，是无解的结构约束。
- **`bash` 只在 WSL 里跑**：Windows 原生命令要么走 `/mnt/c/...`，要么靠 interop 直接执行 `.exe`。
- 想要回到完全受沙箱保护的日常使用：取消 `DSH_WSL` 并重启。两者可随时来回切。

### 10.6 校验记录

- 写入 desktop 的补丁与**我在临时 profile 上双模式验证过的产物 SHA256 完全一致**（`1C63F848…89CADF`）。
- Mode A 实机启动：确认仍是 `SandboxPwshExecutor` + `sandboxMode: workspace-write`——即原行为未被破坏。
- Mode B 实机启动：`WslShellExecutor` / `WslFileSystem` / `directoryPicker: browse`，且 README §9.3 的全部自检项通过、`exit=0`。
- 临时 profile 已删除；`DSH_WSL` 确认在用户级/机器级都为空。

### 10.7 校验过程拦下的两个真实错误（都发生在写 desktop 之前）

1. `disabled: !!js !!process.env.DSH_WSL` —— **非法 YAML**。`!!js` 标签之后的第二个 `!!` 会被当作**另一个 tag**，报 `duplication of a tag property`。
2. `disabled: !!js !process.env.DSH_WSL` —— **同样非法**。未加引号、以 `!` 开头的标量也会被解析成 tag。随包补丁一直是加引号的（`!!js "!ctx.get('profileContext')"`），我漏了这一层。

正确写法：**`Boolean(...)` + 引号**，即 `disabled: !!js "Boolean(process.env.DSH_WSL)"`。

这正是坚持"先在临时 profile 上验证"的价值：这两个错误若直接写进 desktop，应用会在启动时 `failed to parse` **直接起不来**。另外要记住 **`--dump-config` 不执行 `!!js`**（只回显组合后的补丁文本），所以门控逻辑无法用 dump 验证，只能靠实机启动看 provider 究竟是谁。

### 10.8 应用升级后注意

> 这一条**今天仍然有效**，因此已移入现行文档：[README §13.9](../../README.zh.md)（重新生成 `preset-wsl` 段）。

### 10.9 回滚

```powershell
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-20261001-200621" `
          "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" -Force
```

然后重启应用。也可以只删掉 `$DSH_HOME/profiles/desktop/package.json` 里的 `dsh-plugin-wsl-env` 依赖（或把补丁里 `- insert:` 那一段整体删掉）——两者都不影响普通模式。

---

## 12. 手动试用（step by step）—— 同一开关的操作流程

> **⚠️ 本节整套流程建立在已被移除的 `DSH_WSL` 进程开关上，照做不会有任何效果。** 现在的试用方式短得多：**重启应用 → 在 GUI 里直接打开一个 WSL 文件夹 → 新建会话**，环境按会话自动选择（README §13.6）。下面仍然有用的是第 4、5 步（怎么在对话框里进发行版、怎么确认文件工具也在发行版里）和"出问题怎么办"里的排查思路。

### 前提

provider 是**启动时**按服务可用性选定的，所以每次切换都必须**完全退出应用再启动**。另外应用是单实例：如果已经有一个实例在跑，你再启动一次只会激活旧窗口，新环境变量**不会**生效。这是最容易踩的一步。

### 第 1 步：确认应用已完全退出

托盘图标右键 → 退出（Quit）。找不到托盘图标就用任务管理器结束 `DeepSeek Harness`：

```powershell
Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue | Select-Object Id,StartTime
```

**必须为空**才能继续。

### 第 2 步：用终端带环境变量启动（推荐）

这种方式**不改任何持久设置**，关掉应用就自动恢复普通模式，最适合试用：

```powershell
$env:DSH_WSL = '1'
Start-Process "C:\Users\andyz\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
```

`Start-Process` 会让子进程继承当前会话的环境变量，同时把应用脱离终端（关掉终端不会杀掉应用）。

> 如果你更希望它持久生效，用 `setx DSH_WSL 1`，但 `setx` 写的是用户环境变量，**已经运行的 Explorer 可能不会把新值传给之后启动的进程**——保险做法是注销再登录（或重启 Explorer）。相比之下第 2 步的终端方式没有这个坑。

### 第 3 步：确认真的进了 WSL 模式（三个可见信号）

| 信号 | 普通模式 | WSL 模式 |
|---|---|---|
| **Permissions 选择器** | 在（General 设置 + `/permission`） | **消失**——因为框架拒绝把"声称带沙箱模式"的预设架在不围栏的执行器上 |
| **工作区目录选择器** | Windows 原生文件夹对话框 | **应用内对话框**：面包屑首行是 `WSL`，列表里有 `C:\Users\andyz` 和 `ubuntu` |
| **shell 工具** | `pwsh` | `bash`（在发行版内执行） |

最省事的一句话确认：**新开一个会话，让模型跑 `uname -r`**。回 `6.18.40.1-microsoft-standard-WSL2` 就是在 WSL 模式；回 Windows 相关内容就是没切过去。

### 第 4 步：打开一个 WSL 里的文件夹

1. 新建会话 → 打开工作区选择器；
2. 对话框第一屏应看到 `ubuntu`（还有 `C:\Users\andyz` 作为回到 Windows 的入口）——这就是 `WSL` 面包屑下的发行版列表；
3. 点 `ubuntu` → 落到发行版根 `/`；
4. 依次进 `home` → `andy` → 你的项目目录；
5. 需要新目录就用 **New folder**（建在发行版里，属主是 `andy`）；
6. **Open** 确认。

选中后那个目录成为会话工作区，之后的 `bash` / `read` / `write` / `glob` / `grep` 都在发行版里工作。模型看到的路径是 Linux 形式（`/home/andy/...`），不是 `\\wsl.localhost\...`。

### 第 5 步：验证文件工具也在发行版里

在同一会话里让模型：

```
use the read tool on /etc/os-release and report the first line
```

第一行应是 `PRETTY_NAME="Ubuntu 26.04.1 LTS"`。这条路径是**符号链接**，能读到说明 `ctx.fs` 的符号链接修复也生效了。

### 第 6 步：切回普通模式

关掉应用，正常方式启动（或 `$env:DSH_WSL` 不设、`setx DSH_WSL ""` 后注销/登录再启动）。回到普通模式后 Permissions 选择器和原生目录选择器都会回来。

### 不想动日常 GUI 的替代路径

当时另有独立 `wsl` profile（同样已挂接验证，现已删除 —— 见 README §9.6），用它启动就是 WSL 模式，desktop 完全不受影响：

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "C:\Users\andyz\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe" --expose-internals `
  "C:\Users\andyz\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  wsl --no-open
```

它会打印一个带 token 的 URL，用浏览器打开即可（**不会**顶掉你正在用的桌面应用）。

### 出问题怎么办

**应用起不来** → 立刻回滚补丁再启动：

```powershell
Copy-Item "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml.bak-20261001-200621" `
          "$env:USERPROFILE\.dsh\profiles\desktop\cordis.patch.yml" -Force
```

**应用起来了但三个信号都没变** → 环境变量没传进应用（几乎总是单实例没退干净，或用了 `setx` 而 Explorer 没刷新）。退回第 1、2 步。

**目录对话框里没有 `ubuntu`** → 说明 `WSL` 那层没出现。在终端确认 `wsl.exe -l -q` 能列出发行版；如果列出为空，说明该进程环境够不到 WSL（沙箱没换掉），把三个信号再核一遍。

**`bash` 报 `Wsl/E_ACCESSDENIED`** → 说明旧 provider 还在（`pwsh-sandbox` 没被替换），即没真正进 WSL 模式。

**`bash` 里变量取不到值**（`x=[]`、`$?` 恒为 0、heredoc 内容被展开、`EXE=/p; "$EXE"` 报 `: command not found`）→ 这是 README §11 的缺陷，**已修复**；因为模块代码不走 HMR，需要**完全退出应用再启动**才会生效。

### 试用期间要记住的取舍

WSL 模式下**没有文件沙箱**（`dsh-fs-sandbox` 被禁用），**也没有 Permissions 选择器**。Windows 路径（`C:\...`）仍然能读写——`restrictToDistro` 只挡"别的发行版"，不挡 Windows 盘。所以试用时按"无围栏"来对待，试完切回去即可。

---

## 15. 工具层命名，路线：派生 dsh-tool-bash

> **本节描述的 fork 方案已删除**（`lib/shell-tool.js` 与 `fork-shell-tool.mjs` 都不在了）。工具名现由上游从挂载的 shell 推导，见 §17。保留此节仅作决策记录。

README §12 修好了"跑哪个 shell"，但**工具名还是 `bash`** —— 模型看到 `bash`、实际跑 zsh。这一章把它彻底解决。

### 15.1 问题不在配置层

`@deepseek-ai/dsh-tool-bash` 把名字写死在源码里：

```js
return defineTool({
  name: "bash",                    // ← 字面量
  description: bashDescription(),  // ← 也写死了
```

而且**没有任何 `toolName` 配置**（`Config` 只有 `enableRunInBackground` / `promoteOnTimeout`）。官方描述还有三个更严重的问题：

1. 说 `Execute a bash command (\`bash -c\`)` —— shell 说错了；
2. **完全没提运行环境是 WSL 里的 Linux**（不说 POSIX 路径、不说 `/mnt/c`）——模型不知道自己在 Linux 上；
3. 仍声称 `Commands may run under a file sandbox` —— WSL 模式下**根本没有沙箱**（`sandboxMode === undefined`）。

另外 `bash` 这个名字还出现在三处模型可见的地方：system prompt 段（`tool:bash` + "on every bash result"）、job 的 `kind`、审批记录的 `toolName`。

### 15.2 为什么不能"原地改名"

`ctx.tools.register(definition)` **只返回本次注册的 disposer**，没有 `unregister(name)`：

```js
register(definition) {
  const name = definition.name;
  return this.layers.effect(this.ctx, (layer) => layer.tools.insert(name, definition), ...);
}
```

拿不到 `dsh-tool-bash` 手里那个 disposer，就没法注销它；再注册一个改名副本只会让模型同时看到两个做同一件事的 shell 工具。所以唯一干净的做法是：**不挂官方那个，提供自己的**。

### 15.3 派生而不是重写

官方工具 713 行，绝大部分是 jobs 注册/超时提升、有界输出、渲染、终端卡片、`[exit code: N]` 标记契约。重写这些只会在边角语义上出错。

做法与处理 preset 时一致：**写生成器机械派生 + 精确改写**，不手抄。

```
dsh-wsl-research/fork-shell-tool.mjs  →  dsh-plugin-wsl-env/lib/shell-tool.js
```

生成器对每个替换点断言"恰好命中一次"，共 12 处改写：

| 改写点 | 内容 |
|---|---|
| 插件名 | `tool-bash` → `tool-wsl-shell` |
| **工具名** | `name: "bash"` → 由 shell 路径推导（`/usr/bin/zsh` → `zsh`） |
| **工具描述** | 换成说明发行版、真实 shell、Linux 环境、无沙箱的版本 |
| system prompt 段 | `tool:bash` → `` tool:${toolName} ``，正文也改成 `every ${toolName} result` |
| job kind | `"bash"` → `"shell"` |
| 审批 toolName | `"bash"` → `toolName` |
| `Config` | 新增 `distro` / `shell` / `toolName` / `wslPath` |
| `apply` | 改为 async，挂载时解析一次 distro+shell（名字和描述在注册时就必须确定） |

`toolName` 可显式覆盖；留空则按 shell 名推导。

### 15.4 过程中撞到的真实障碍：三个包"看不见"

派生后第一次运行直接失败：

```
tool-wsl-shell (dsh-plugin-wsl-env/tool): failed to import
```

加载器只报 "failed to import"，**不保留底层错误**（`entry.fiber === undefined`，连 fiber 都没建）。用探针把真实错误挖出来后，得到一条反直觉的规则：

从**同一个文件**里导入，`dsh-tools`、`dsh-fs`、`schemastery` 全部正常，而 `dsh-llm`、`dsh-sandbox`、`dsh-shell` 一律 `ERR_MODULE_NOT_FOUND` —— 尽管六个包都**物理存在于** `app.asar/dsh/node_modules/@deepseek-ai/`。

进一步探明：解析层只为**从入口模块可达的模块**路由裸说明符。同一个探针里 `./wsl.js`（在 `lib/index.js` 的导入子图内）能解析，而 `./shell-tool.js`（当时不在任何入口的子图里）就不能——它连 `schemastery` 都解析不了。所以行必须**恰好把该文件作为入口**导入，而这正是 `dsh-plugin-wsl-env/tool` 在做的事。

### 15.5 `HarnessError` 绝不能伪造

`dsh-tools` 用 `instanceof` 提取结构化错误码：

```js
return error instanceof HarnessError ? { name: code } : undefined;
```

所以本地复制一个 `HarnessError` 会让 `new HarnessError("tool call aborted", TOOL_ABORTED)` **不再被识别为 ABORTED**，中断语义静默失效。

出口是：**`FsError extends HarnessError`**，而 `@deepseek-ai/dsh-fs` 我本来就能解析。于是

```js
const HarnessError = Object.getPrototypeOf(FsError);
```

就是运行时那个**同一个类对象**。用探针跨包验证过：

```
from FsError        : HarnessError
from ToolArgsError  : HarnessError
SAME CLASS OBJECT   : true          ← 决定性
also matches JsonSchemaError's parent : true
also matches ToolOutputError's parent : true
constructed: message="tool call aborted" code="ABORTED" isError=true
```

沙箱那批符号则直接给了**本地空实现**：executor 永远报 `sandboxMode === undefined`，所以 `escalationModes` 恒为空、所有升级分支都是死代码，不存在 `instanceof` 或线格式契约依赖它们。`parseExitStatus` 是从 `dsh-shell` **逐字符复制**的（终端的退出码 pill 依赖它）。

### 15.6 工具可见性：全局行确实会下发

web 系 profile 里 agent 的工具来自 preset，所以我一开始不确定顶层注册的工具会不会被 preset 滤掉。查了 `dsh-tools` 的可见性算法：

```js
const inherited = new Map(this.layers.global.tools.entries());   // 全局层
for (const layer of layers) { ...inherited.set(name, definition) }
for (const [name, definition] of inherited)
  if (layers.every((layer) => layer.admits(name))) visible.set(name, definition);
```

`admits()` 只在有 `allow`/`deny` 过滤时返回 false，而**整个组合里没有任何地方调用 `tools.restrict()`** —— 也就是说全局工具对所有 agent 可见。

并从实验确认：在一个**带 preset** 的 profile 里（preset 只列了 `tool-bash`/`tool-pwsh`，**没有**列我的工具），agent 依然拿到了它：

```
tool_call    tool="zsh"
tool_result  completed   "x=[7]\nq=[1]\n"
```

### 15.7 最终验证（真实模型回合）

```
tool_call    tool="zsh"   {"command":"x=7; echo \"x=[$x]\"; false; echo \"q=[$?]\""}
tool_result  completed    "x=[7]\nq=[1]\n"
```

工具名就是 `zsh`，变量与 `$?` 都正确，**零告警**。回归：8 个 lib 文件语法通过、24 项单元断言通过。

### 15.8 代价与维护

- `lib/shell-tool.js` 是官方工具在**当前版本**上的派生副本（735 行）。应用升级后若官方改了工具逻辑，需要重跑生成器跟进：官方 `lib/index.js` 用 `extract.mjs` 重新抽出，再执行 `fork-shell-tool.mjs`。生成器的每个替换点都有断言，官方结构一旦变化会**立即报错而不是悄悄产出错文件**。
- 派生副本对 `/tool` 之外的行为与官方一致（jobs、超时提升、渲染、终端卡片都没动）。
- `Config` 里 `toolName` 可随时覆盖工具名。

### 15.9 重启

模块代码依然不走 HMR。**完全退出应用 → 重新启动**才会用上新工具。

---

## 17. 工具层命名，路线 A：上游改动

> **本节已作废。** 它的前提是"有人能改上游"，而这个前提在你的机器上不成立（没有 DSH 源码树），且实测证明**根本不需要**改上游 —— 见 §18。A 的规格与补丁仍保留在 `dsh-wsl-research/UPSTREAM-A-shell-naming.md` 与 `A-patch.mjs`，留给将来确实能拿到源码的场景。

> **§15 描述的那份 fork 已删除。** `lib/shell-tool.js` 与 `fork-shell-tool.mjs` 都不在了（备份在 `dsh-wsl-research/fork-removed/`）。工具名改由**上游**从挂载的 shell 推导。

### 17.1 为什么必须走上游

fork 之所以存在，是因为工具的**身份在上游是硬编码的**，且插件端没有任何改写缝隙：

| 事实 | 出处 |
|---|---|
| `name: "bash"`、`description`、`command` 参数描述、`kind: "bash"` 全部硬编码 | `dsh-tool-bash/lib/index.js` |
| `Config` 无命名相关字段 | 只有 `enableRunInBackground` / `promoteOnTimeout` |
| 只导出 `{ Config, apply, inject, name }`，无可复用工厂 | 文件末尾 export |
| `dsh-shell` 基类不暴露 shell 身份，只有 `get sandboxMode()` | `pkgs/dsh-shell/lib/index.js:92` |
| `intercept` 是"给派生上下文的服务注入 **config**"，**不是包装方法** | `cordis/lib/index.js:1806-1809` |
| `dsh-tools` 只有 `register / restrict / view / get`，无 rename/update | `dsh-tools/lib/index.js:2878+` |

⇒ 只能复制编译产物并改写字符串 = 版本绑定。故改走上游。

### 17.2 上游改动（两处）

1. `dsh-shell`：`ShellExecutor` 加 `async shellName(): Promise<string> { return "bash"; }`（默认即今天的行为，向后兼容）。
2. `dsh-tool-bash`：`apply` 变 async 并取 `const shellName = await ctx.shell.shellName();`，用它替换 `name`、`bashDescription()`（含 `` bash -c ``）、`command` 参数描述；后台 job 的 `kind` 改为中性的 `"shell"`。

完整规格见 `dsh-wsl-research/UPSTREAM-A-shell-naming.md`；可直接执行的补丁见 `dsh-wsl-research/A-patch.mjs`（锚点驱动，任一步"恰好匹配一次"失败即**拒绝写入**，已对真实文件副本验证 9 处全部应用、重跑被拒）。

### 17.3 插件侧已就位（无需再改）

- 删除了 fork、shim 块、生成器与 `"./tool"` 导出；
- `WslShellExecutor` 实现 `async shellName()` → `toolNameFor(await this.shell())`，实测返回 `"zsh"`；
- `preset-wsl` 不再挂自有工具，改为**启用随包的 `tool-bash`**（`disabled: false`）—— 它读本 preset 隔离 realm 里的 `ctx.shell`，A 落地后自动自称 `zsh`。

### 17.4 ⚠️ 过渡态

A 合入并发版**之前**，wsl preset 的 shell 工具会自称 `bash`、描述写 `` bash -c ``（**执行正确**，只是名字与描述不实）。回退：把 `fork-removed/` 的两个文件放回原位并重新生成。

### 17.5 合入 A 之后的核对清单

1. WSL 工作区会话：工具名为 `zsh`，`uname -r` 返回发行版内核。
2. **向后兼容**：Linux/macOS 宿主（`LocalBashExecutor`）上工具名**仍须是 `bash`**、描述逐字不变 —— 默认实现返回 `"bash"`，这一条必须实测。
3. **job kind 变更的影响面**：`"bash"` → `"shell"` 后，任何按 `kind === "bash"` 过滤/分组的代码或 UI 都要同步改。这是本次改动唯一的跨界影响，合入前先搜一遍。
4. `apply` 变为 async：Cordis 支持 async apply（本插件自己就是），但确认没有地方假设它同步返回。

---

## 18. 工具层命名，路线 B′：运行时改名

> **本节方案已删除**（`lib/shell-rename.js` 已移除，备份在 `dsh-wsl-research/fork-removed/`）。改用 DSH 自带的 `DSH_*` 环境事实通道 —— 见 README §14。保留此节作为决策记录：它证明过"运行时改名在技术上可行且不泄漏"，只是在发现官方机制后不再必要。

> **§17（上游改动 A）已作废**，fork（§15）也已删除。现状是：不改上游、不复制代码、升级 app 后什么都不用做。

### 18.1 机制（全部是公开 API，全部实测）

```
ctx.tools.get(from, agent)                  → 上游已注册的【活定义】（含 execute / output.render / presentCall / presentResult）
agent.ctx.tools.restrict({ deny: [from] })  → 为该 agent 遮掉陈旧名字
agent.ctx.tools.register({ ...def, name, description, parameters })
```

实现见 `lib/shell-rename.js`（约 150 行）。要点：

- **复用活定义**，所以 `execute`、退出码渲染（`output.render`）、终端卡片全部是上游的，且上游改措辞会被自动继承 —— 不再有"副本与上游脱节"的问题；
- 名字来自执行器的 `async shellName()`：`WslShellExecutor` 返回 `zsh`（`toolNameFor(await this.shell())`）；宿主 `SandboxPwshExecutor` 没有该方法，插件**原样不动**（它的名字本来就对）；
- 描述里所有 `description` 字段**递归**改写（`parameters` 是 JSON Schema，逐参数文本在 `properties.command.description`，不是扁平表）；
- `restrict` + `register` 都是同步、不冲突的（新名字与旧名字不同），所以不像预设切换那样有"上一代未退休"的碰撞。

### 18.2 为什么必须监听 `tools/change`，而不是只监听 `agent/created`

preset 是在 agent 创建**之后**才切换的 —— 创建期间切换会撞上上一代工具尚未退休（见 README §13.4 ②）。所以在 `agent/created` 那一刻，agent 还挂在**旧** preset 上，它的 shell 没有 `shellName()`，也根本不是这个工具该据以命名的 shell。

切换 preset 会 emit **`tools/change`**，那一刻"该叫什么"才可知。所以：

- 首次"找不到可用的 shell"时**不记账**，下个信号再试；
- 这同时覆盖了 GUI 里**手动**选择 preset 的情况（手动切换不产生 `agent/created`）。

（这个时序问题我踩过一次：最初只在 `agent/created` 里改名、并立刻把 agent 标记为已处理，结果它永远看到的是宿主执行器、静默什么都不做。轨迹文件里那句 `the mounted executor has no shellName()` 就是它。）

### 18.3 实测

```
A (WSL)     preset = wsl
  get('zsh', A)      = definition "zsh"
  get('bash', A)     = hidden
  description        = "Execute a zsh command (`zsh -c`) and return its stdout/stderr. …"
  parameters(JSON)   = …"description":"The zsh command to execute."…
  残留 "bash"        = no
  execute / output.render = 原样继承
B (Windows) preset = standard
  get('zsh', B)      = absent（无泄漏）    get('pwsh', B) = present（未被动过）
global      get('zsh')    = absent（无全局泄漏）
```

### 18.4 两条教训（都是我的错）

1. **`tools.get(name, scope)` 的第二个参数是 agent 本身，不是 `agent.ctx`。** 传错会对**任何**工具都返回 undefined —— 我拿这个假阴性当证据，几乎推出了错误的设计结论（"restrict 遮不掉 preset 里的工具"）。
2. **`isolate`（loader 的服务 realm）≠ `dsh-scope` 的 scope。** 前者隔离服务实现，后者是 tools 分层的依据。把两者混为一谈之后，就不该再基于代码注释下结论。

**结论：凡"某个 API 做不到"，必须实测再说。** 这一条在本项目里已经三次证明是对的（`- insert:` 那次的教训属于同类）。

### 18.5 为什么这个方案成立

工具的"身份"只在**注册**时存在，而不在执行里 —— `execute` 闭包与 `output.render` 都跟着定义对象走。所以改名不需要碰实现，也就不需要副本。

---
