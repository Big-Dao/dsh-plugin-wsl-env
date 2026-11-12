# 贡献指南

_本页是权威版本；英文译本见 [Contributing](CONTRIBUTING.md)。_

本文介绍开发循环、pull request 必须通过的检查，以及本仓库采用的约定。

## 前置条件

| 需求 | 说明 |
|---|---|
| Windows 10 或 11 | 插件仅支持 Windows |
| 带至少一个发行版的 WSL2 | `wsl.exe -l -v` 列出已安装的发行版 |
| 发行版内有 `bubblewrap` | `sudo apt install bubblewrap`。缺少它时沙箱会失败关闭。 |
| Node 22.19+ 或 24 | CI 运行的版本。`engines` 要求 `^22.19.0 \|\| >=24.0.0`，即 harness 宿主自身的最低要求。 |

## 工具链

运行时包刻意不包含任何 `dependencies` 字段：它被加载进 DSH 进程，所需的一切都以 peer 包形式提供。从检出目录运行插件无需安装步骤。

开发过程和运行各项检查则确实需要依赖。测试会 import 固定版本的 `@deepseek-ai/*` 包——组合测试运行 loader 的真实 patch 算法，启动测试通过真实的 Loader 启动一行——因此全新检出在检查通过前需要执行一次 `pnpm install`。

这些固定版本是刻意为之，并按角色区分。`@deepseek-ai/*` 的 `devDependencies` 保持精确版本，使检查和 `docs/PEER-PARITY.md` 审计指向同一条可复现的版本线（工具链依赖——typescript、js-yaml、`@types/*`——使用版本范围并手动升级）。`peerDependencies` 是下限——`@deepseek-ai/dsh-*` 包用 `>=`，`@deepseek-ai/cordis` 和 `@deepseek-ai/schemastery` 用 caret——这样发布较新 harness 的应用无需等待插件发版就能继续安装插件。下限仍是有意抬高的，而不是随版本漂移：它在匹配某次 harness 发版的提交中上移，同时重新运行对拍比较和检查链；每周的 peer-canary（`.github/workflows/peer-canary.yml`）会把 `next` dist-tag 解析到临时树中，当版本线越过下限时发出告警。有一个 semver 限制值得了解：下限范围无法指定未来的预发布版本线——`0.2.2-rc.1` 不满足 `>=0.2.1-rc.3`，因为规范只允许预发布版本与自身 `[major, minor, patch]` 元组上的比较器匹配——因此全新的 rc 线在下限抬高前会告警；同一版本线上的 rc 和所有稳定版本从不会告警。

插件继承 peer 类并镜像 peer 协议，因此版本范围并不能说明对拍声明是否成立：每次抬高下限都会重新验证这些声明。

本仓库的脚本由 pnpm 运行，版本通过 `packageManager` 字段锁定（由 corepack 解析）。请把 `pnpm run <script>` 视为参考工具链。

不要新增运行时依赖——理由见上。风格工具也因同样的理由不引入：这里没有 ESLint，也没有 Prettier。通常需要它们完成的检查改用 Node 内建能力实现。`test/style.mjs` 验证 `.editorconfig` 声明的规则，并检查每个 `files` 条目仍匹配受版本控制的内容、每个 `exports` 目标仍然存在。`pnpm test` 中的语法检查使用 Node 自身的解析器。

恰好有三个依赖会运行安装脚本（`@deepseek-ai/dsh-subprocess-local`、`koffi`、`node-pty`——原生部分）；它们被列入 `pnpm-workspace.yaml` 的允许列表，其余依赖不构建任何内容。

## 类型检查

`lint:types` 在 `strict` 下运行 `tsc --noEmit`，用 `checkJs` 检查非生成的内容——`test/**` 与环境类型声明——类型来自 peer 包自带的 `.d.ts`：不会有任何类型被重复定义。`types/dsh-services.d.ts` 引入服务包随附的 `declare module '@deepseek-ai/cordis'` 增强，因此 `ctx.fs`、`ctx.shell`、`ctx.sandboxPolicy` 等都有类型；该文件自身不声明任何内容，也不会随包发布。

`test/probe/` 下的探针脚本也在检查范围内。`src/` 下的源码由构建程序本身检查（`strict`、`noEmitOnError`），这比检查它们生成的 JavaScript 严格得多。先检查已发布的产物，因为与固定 peer 的协议漂移会在那里造成实际损害；随后检查测试和探针，它们暴露的错误都是真实的——一个把原始数字固定进 argv 的测试，若干手写的 JSDoc 契约比代码更宽（`wslErrorCode`、`gitSpawnRewrite`）或比其接缝更窄，以及发行版路由文件服务中一个被接受但从未执行的字节窗口上限，发现它是因为某个 fake 向隔离接缝传入了 `"full"` enforcement，而核心自身从不报告该值。

三种做法让检查保持诚实：

- 子类自己的 config 键声明为一个镜像其 `static Config` schema 的类型，并通过一次显式转换读取——这样 schema 与类型只可能以可见的方式发生偏移。
- 测试替身按其模拟的接缝切片（一个 duck `@typedef`）标注类型，并在注入点通过一次有注释的转换到达接缝声明的类型——该转换说明替身代表哪份契约，而不是用 `any` 压掉不匹配。
- 只有在被抑制的错误确实指向真实的上游接缝缺口、行内带有原因，并且该缺口已写成文档时，才允许使用 `@ts-expect-error`——当修复需要上游处理时，写在 `docs/UPSTREAM-*.md` 跟踪文档中（`LocalBashExecutor.spawnSpec` 接缝就有一份）；当诚实修复需要本包做出协议决策时，写在源码注释本身。当前例外是 `spawnSpec` 接缝；它是一项已公开的发现，而不是消音器。

## 构建

插件必须能从裸检出目录加载：harness 没有转译层，Windows 运行时镜像是整棵树的副本，测试运行的是 `lib/*.js`——已发布的产物——而不是源码。源码位于 `src/`，构建出的 JavaScript 与声明位于 `lib/`，产物保持提交进仓。`pnpm run build`（`scripts/build.mjs`）执行一遍 `tsc -p tsconfig.build.json`，把每个 `src/*.ts` 生成为 JavaScript 及其声明，并使用与它所替代的手写模块相同的导出路径。import 指向产物（`./x.js`）；`nodenext` 会通过 TypeScript 源码解析它。随后构建会清理没有源码归属的声明（重命名遗留），因此 `lib/` 恰好是 `src/` 的产物。

让这一点保持诚实的规则：

- 绝不要编辑 `lib/` 下的生成文件——其模块文档会指明应编辑的源码，两者一旦偏移，`lint:build` 就会失败。生成产物保持 tsc 的规范格式（四空格缩进、紧凑格式）；审查每个模块时看 `src/`。
- `lint:build`（`test/build-freshness.mjs`）强制文件集合闭合——每个 `lib/*.js` 都有对应的 `src/<name>.ts`，每个源码都有两个产物——然后为每个生成文件做快照，运行真实构建，逐字节比较并还原快照：这是一次检查，不是重建；偏移的补救办法是 `pnpm run build` 加一次提交。它位于 `test:syntax` 之后的检查链中。
- 生成文件完全不进入 `checkJs` 检查（`tsconfig.json` 覆盖 `test/**` 和环境类型声明）；它们的源码由构建程序以 `noEmitOnError` 做类型检查，因此损坏的构建永远不会覆盖 `lib/`。
- 每个 JavaScript 导出都带有 `types` 条件（由 `lint:style` 强制），因此下游能解析这些声明；不存在第二套手写类型表面。
- 协议消息联合体及相关类型现在是唯一的定义处：使用方直接 import 它们（`@typedef {import("./agent-protocol.js").AgentMessage} AgentMessage`），而不是重新声明；`lib/agent.js` 和脚本驱动的测试就是这样读取它们。

### 新增模块

1. 编写 `src/<name>.ts`；import 指向产物（`./x.js`），`nodenext` 会通过 TypeScript 源码解析它。把所有类型移入签名，保留说明文字，并保留每一个导出的名称——包括类型，因为使用方会 import 它们（`import("./paths.js").DistroPath`）。在模块文档末尾写上说明，指明生成的产物。
2. 运行 `pnpm run build`，再运行 `pnpm test`。无需维护排除列表，也没有注册步骤：构建和 `lint:build` 从 `src/` 推导一切，`lib/` 是生成输出——绝不要手工编辑。
3. 如果模块在 Plugins 页面拥有自己的一行，把它的显示元数据添加为 `locale/<name>/en.json` 和 `locale/<name>/zh.json`——各含一对 `meta.title` / `meta.description`——并通过 `exports` 暴露两者（`./<name>/locale/en.json`、`./<name>/locale/zh.json`），该页面会先读取它们，再回退到包的 `description`。bundle 自己的那一对是 `locale/en.json` / `locale/zh.json`，`subprocess`、`picker`、`shell-env` 和 `auto-preset` 各自带有自己的那一对。有一组运行时 catalog 不是 `exports` 条目：`locale/doctor/*.json` 为独立 CLI 的固定骨架提供本地化，由脚本自身从包根目录读取。`files` 已随包发布 `locale/**/*.json`，而 `lint:style` 会让不存在的 `exports` 目标失败。

## 开发循环

1. 在发行版内克隆仓库。多数贡献者在那里开发。
2. 修改代码。
3. 运行下面的检查。
4. 如果改动了 `lib/` 下的任何内容，先运行 `pnpm run sync:windows`，再重启 DSH 应用。应用加载 Windows 镜像（见下文），因此不同步就重启只会重新加载旧代码；运行中的进程还会缓存 ES 模块。

### 运行时镜像

DSH profile 只能链接 Windows 路径。pnpm 会把 `link:\\wsl.localhost\...` 重写成损坏的 `/wsl.localhost/...` 符号链接，因此 harness 无法从发行版检出目录加载插件。

`default-workspace/dsh-plugin-wsl` 下的 Windows 副本是运行时镜像。启动应用前先同步它：

```bash
pnpm run sync:windows
```

镜像目标位于会话工作区之外。在受限 shell 中运行同步的 agent 会被 `workspace-write` 策略拒绝，必须为这一条命令批准更宽的权限。如果不想看到该提示，请从普通发行版终端运行同步。

## pull request 前的检查

| 命令 | 覆盖范围 | 需要 harness |
|---|---|---|
| `pnpm test` | 风格检查、相对链接、需求引用、文档一致性、语法检查、构建一致性、类型检查和单元测试 | 否 |
| `pnpm run lint:links` | README、CONTRIBUTING、AGENTS 和 `docs/**` 中的相对 Markdown 链接 | 否 |
| `pnpm run test:coverage` | 带覆盖率的单元测试，然后逐模块检查：每个 `lib/*.js` 都被测量或列入允许列表，逐模块下限 85/70/60 | 否 |
| `pnpm run test:browser` | 在无头 Chromium 中渲染的 web 客户端：布局、可见性、点击、badge 效果时序、面板列表 | 否；需先执行一次 `pnpm exec playwright install chromium` |
| `pnpm run lint:style` | 风格与 lint 规则 | 否 |
| `pnpm run lint:build` | 构建新鲜度检查：每个源码都有产物，且提交的字节匹配真实构建 | 否 |
| `pnpm run lint:types` | 对 `test/**` 和环境类型声明的 TypeScript 检查（`tsc --noEmit`） | 否 |
| `pnpm run e2e:install` | 在临时 `DSH_HOME` 中安装/升级/卸载打包 tarball | 是；Windows + WSL |
| `pnpm run doctor` | 环境前置项、peer 和缓存（脚本使用 `--json`；`diagnose` 是只读别名） | 否；在发行版内 |
| `pnpm run probe` | 针对真实发行版的文件系统行为 | 是 |
| `pnpm run probe:sandbox` | bubblewrap 隔离了什么、没有隔离什么 | 否 |
| `pnpm run probe:sandbox-shell` | 通过真实启动验证受限执行器 | 是 |
| `pnpm run probe:interop-shell` | 对盘符可执行文件和复制出的可执行文件进行驻留式与一次性互操作，含/不含 `/mnt` 掩码 | 是 |
| `pnpm run probe:terminal` | 终端 provider | 是 |
| `pnpm run probe:substrate` | 通过真实 `wsl.exe` 传输验证 agent 文件系统 substrate | 否；在发行版内 |
| `pnpm run probe:watch` | 针对真实目录的发行版内 watcher | 否；在发行版内 |
| `pnpm run probe:agent` | 驻留式与一次性回退的对拍分支 | 否；在发行版内 |
| `pnpm run probe:exec` | agent 支撑的执行句柄：超时、kill、cwd 失败 | 否；在发行版内 |
| `pnpm run probe:missing-wsl` | 无法启动的 `wslPath` 如何报告 | 是 |
| `pnpm run probe:picker` | 选择器的根层级、拒绝行为和上限 | 是 |
| `pnpm run probe:gui-preview` | 路由后端的 stat、列表与 1 MiB 页读取延迟（p50/p95 预算） | 否；在发行版内 |
| `pnpm run probe:file-reference` | `@` 引用遍历：9p 遍历 vs 发行版的 ext4 | 否；在发行版内 |
| `pnpm run probe:fs-routing` | 根平面路由器：发行版坐标、宿主平面、跨发行版围栏 | 是 |
| `pnpm run probe:mode` | 哪些 POSIX 模式事实能在共享中保留 | 否；Windows Node |
| `pnpm run probe:sandbox-off` | 两个 provider 上文档说明的退出选项 | 是 |

上述每个脚本都在 `package.json` 中定义。`pnpm test` 按顺序运行 `lint:style`、`lint:links`、`lint:requirements`、`lint:docs`、`test:syntax`、`lint:build`、`lint:types` 和 `test:unit`。`prepublishOnly` 在发布时再次运行 `pnpm test`，因此损坏的检查会在上传前阻止发布。

CI 在 `ubuntu-latest` 和 `windows-latest` 上，用 Node 22 和 24 运行 `pnpm test`；在 Node 24 上运行 `pnpm run test:coverage`，并在安装 Chromium 后于一个 Ubuntu runner 上运行 `pnpm run test:browser`。Windows runner 的存在是因为插件面向 Windows；覆盖率门槛需要 Node 22.8 或更新版本，因此该任务只在一个版本上运行。

标记为“是”的探针需要 Windows、WSL2、一个已挂载的 harness profile 和一个已链接的检出，托管 runner 不具备这些条件。请在自己的机器上运行，并把输出粘贴到 pull request 中。

标记为“否；在发行版内”的行（`substrate`、`watch`、`agent`、`exec`）仍需要 Windows 和 WSL2，但不需要启动 harness，也不需要 profile：在有 Node 的发行版终端中运行它们，它们会通过互操作访问 `wsl.exe`。

真机测试集有两个便利工具。`test/probe/run-all-when-closed.sh --include-fs` 在应用退出后运行全部十七项探针。互操作 shell 矩阵使用 `wslfs` profile、systemd 和 lingering 的用户管理器；当 Windows 互操作或其临时标记无法验证时，它会失败。`ci.yml` 有一个定时和手动触发的 `probes` 任务：只要默认发行版实际启动，`sandbox` 就会运行；随后在安装了 harness 应用的环境中运行 `mode`、`terminal`、`picker` 和 `missing-wsl`。该任务以一个自托管 Windows runner 命名，尽管其 `runs-on` 携带的是 GitHub 托管的 `windows-latest` 标签；当托管 runner 没有可用的发行版时，该任务是一次绿色的空操作（`skip all`）。如果默认发行版启动时没有 bubblewrap，`sandbox` 分支会失败，而不是跳过。

**自托管 runner 标签冲突——已知暴露面。** 开发机的自托管 runner 满足了 GitHub 托管的 `windows-latest` 标签，因此单元矩阵的 Windows 分支在每次 push 和 PR 时都在那里执行。来自 fork 的 PR 代码会在这些分支上被跳过（`ci.yml` 的步骤级 fork 门），但持久的修复是在 runner 设置中把其标签重命名为无歧义的名称（例如 `self-hosted-wsl`），并把 `ci.yml` 中两个 `windows-latest` 使用方重新指向它——在此之前，请把该标签视为共享基础设施，而不是托管容量。还要注意安装步骤带有 `--config.minimum-release-age=0`（pnpm 11.7 的 lockfile 重新验证会忽略 `minimumReleaseAgeExclude`；该标志是 `release.yml` 中记录的补救办法）。

## 新增测试

按测试所需选择层次。

| 层次 | 位置 | 用于 |
|---|---|---|
| 单元测试 | `test/*.test.mjs` | 纯逻辑：路径转换、列表、shell 参数构建、终端辅助函数 |
| 探针 | `test/probe/` | 需要真实发行版、真实 profile 或 bubblewrap 的行为 |

单元测试在 `node --test` 下运行。`package.json` 中的 `test:unit` 和 `test:coverage` 列表显式列出各自的文件；只涉及本仓库的测试应同时出现在两者中。保持两个列表同步且没有重复条目。

两个脚本都在 `scripts/test-watchdog.mjs` 下运行各自的列表，该 watchdog 把整次运行限制在 180 秒内（可用 `DSH_TEST_WATCHDOG_MS` 覆盖）。`node --test` 没有逐文件截止时间，因此一个脚本式文件如果在尚未完成的顶层 await 背后留下活动句柄，就会让检查挂起，直到调用方杀掉它；到达截止时间时，包装器会中断运行，node 的 “Interrupted while running” 列表会指出从未完成的文件。脚本还会传入 `--test-timeout=60000`，它只限制文件用 `test()` 注册的测试——watchdog 才覆盖模块求值阶段的挂起。

`test:coverage` 还会通过 `scripts/coverage-gate.mjs` 运行该列表。Node 的覆盖率基于加载——没有测试 import 的模块不会有一行记录，因此全局百分比会静默地只衡量一个子集——所以该检查要求每个 `lib/*.js` 都被测量，或在 `test/coverage-allowlist.json` 中列出并说明为何无法被受检查的测试套件加载；每个被测量的模块都要满足 85 行 / 70 分支 / 60 函数的下限。没有测试的新模块会让检查失败，已不存在模块的允许列表条目同样如此。新增测试是首选修复；允许列表让其余仅由探针覆盖的行保持可见，而不是让它们从分母中消失。

import 固定版本 `@deepseek-ai/*` 包的测试也进入同样的列表，无需额外防护——CI 在 `pnpm test` 之前对锁定树运行 `pnpm install --frozen-lockfile`。例如，`test/provider.test.mjs` 覆盖装配后的服务行，`test/composition.test.mjs` 运行 loader 的真实 patch 算法。

凡是存在无 peer 的接缝，优先使用它。`test/sandbox.test.mjs` 针对 `lib/sandbox-core.js` 运行，并用一个替身代替 peer 的 `SandboxUnavailableError` 契约，这样 `lib/sandbox.js` 中只剩一行 peer 绑定。那一行由 harness 探针覆盖——它们启动插件，从而通过 `lib/index.js` 到达 `WslSandbox`——而不是由 `probe:sandbox` 覆盖，后者只从 `lib/bwrap.js` 读取参数构建器。无法在所有环境运行的测试必须自行跳过——打印一行 `SKIP` 并以 0 退出——就像该文件在 `win32` 上的做法，在那里它的 fake `wsl.exe`（一个 POSIX 脚本）无法执行。

### 浏览器 E2E

`test/browser/e2e.test.mjs` 用 React 打包 `client.js`，并在无头 Chromium 中挂载真实的 slot 组件。它负责 Node 测试套件看不到的内容：计算后的布局、可见性、真实点击，以及跨两个已挂载组件的效果时序（从 banner 到 header badge 的“收起”交接）。它不启动 Desktop shell；失败指向插件的 web bundle，而不是宿主。

先运行一次 `pnpm exec playwright install chromium`，再运行测试套件：`pnpm run test:browser`。CI 的 `browser` 任务在 `ubuntu-latest` 上做同样的事；`pnpm test` 不依赖浏览器，因此没有浏览器的检出仍能运行常规检查。

探针是 shell 脚本，外加它们加载的小型插件文件：同目录下的 `*-probe.mjs` 和 `*-probe.yml`。harness 探针包括 `run.sh`、`terminal.sh`、`sandbox-shell.sh`、`interop-shell.sh`、`picker.sh`、`fs-routing.sh`、`missing-wsl.sh` 和 `sandbox-off.sh`，它们使用一次性 profile，其设置记录在 `test/probe/run.sh` 的文件头中。发行版探针（`substrate.sh`、`watch.sh`、`agent.sh`、`exec.sh`）不启动 harness：它们从发行版终端运行，并通过 `wsl.exe` 互操作传输驱动驻留 agent。`sandbox.sh` 和 `mode.sh` 既不需要启动 harness，也不需要 profile。

保持探针输出幂等。若干探针会在开始时删除自己的临时文件，因为早先运行遗留的文件会改变结果。

## 已验证的内容

在上面那一次 `pnpm install` 获取固定包之后，`pnpm test` 会运行整个单元测试套件：静态 import 这些包的文件会通过 loader 及其声明类型实际运行服务，`test:syntax` 对每个随包模块执行一遍 `node --check`。Linux 分支上的任何测试都无法触及 Windows + WSL2 拓扑本身：真实的 `wsl.exe`、真实的发行版、真实的 harness 启动。这正是探针填补的缺口；归档记录 §15.4 记录了它曾导致的五轮误诊。

`test/probe/sandbox.sh` 不需要 harness：它使用 `lib/sandbox.js` 构建的相同参数，断言 bubblewrap 隔离了什么、没有隔离什么，并把互操作逃逸记为 `INFO`，因为 Linux 沙箱无法管辖 Windows 进程。harness 探针启动一个绑定到该发行版的一次性 profile：

- 文件系统探针断言写入路径和写入检查——在策略根之外写入以及在 `read-only` 模式下写入都返回 `FS_SANDBOX_DENIED`，而 `danger-full-access` 是获准的升级方式，其写入被断言确实落地；
- shell 探针通过 `ctx.shell` 驱动全部三种模式，并检查工具层返回的拒绝分类；
- 终端探针断言发行版、起始目录，以及通过 `WSLENV` 转发的 `DSH_*` 变量。

该一次性 profile 的设置步骤位于 `test/probe/run.sh` 的文件头；harness 探针共享它创建的那一个 profile。

在 Windows 11 + WSL2（Ubuntu 26.04）上已验证以下内容：

- 各服务的接线、UNC 路径处理和选择器行为；
- 插件在真实 profile 中端到端挂载；
- 仅 WSL 的无头 profile 中一次真实的模型回合：`write → chmod → read → edit → execute`，可执行位在编辑后保留；
- 在一次性 Web 启动和日常 GUI profile 中的终端 provider；
- 沙箱的四种方式：在发行版内测量参数、文件系统写入检查、shell 路径（`enforcement: partial`，拒绝分类正确），以及日常 GUI profile——在那里，agent 自身会话在会话工作区之外的写入会在发行版内被拒绝，随后更宽权限的请求成功。

当前的单元测试和覆盖率测试列表在 `package.json` 中；探针断言和前置条件在各脚本中。验证结果描述的是已测试的环境，不能替代重新运行适用的检查。

## Good first issue 与贡献者路径

仓库会用 `good first issue` 标记自包含的改动。典型形式：

- 在 README 与 QUICKSTART 的中英两侧添加一条配方或排障条目（链接检查会守护它；一次提交）；
- 在 `test/probe/` 下新增遵循现有 `*-report.txt` 形式的探针报告夹具；
- 修复 issue 模板措辞、交叉引用，或补上 `docs/ARCHITECTURE.md` 中缺失的错误码行。

要认领一个 issue，请在 issue 下评论。打开 PR 前运行 `pnpm test`（若改动 `lib/`，再运行 `pnpm run test:coverage`），然后做一次逻辑提交，并在提交正文中记录检查结果——约定见下文。探针需要真实的 Windows + WSL 机器；单元测试、文档和打包改动不需要。

## 提交与 pull request 约定

- 使用祈使句主题行：`Fix the npm readme`，而不是 `Fixed` 或 `Fixes`。
- 不要使用 conventional-commit 前缀。不要写 `feat:`、`fix:` 或 `chore:`。
- 在正文中解释原因。改了什么在 diff 中已经可见。
- 行为变更需在 `## [Unreleased]` 下添加 `CHANGELOG.md` 条目。文档或注释改动不需要。
- 一次提交只包含一个主题。
- 在 pull request 中说明你如何测试。相关时粘贴探针输出。
- 社区常用文档成对存在，中文版是权威：先改 `.zh.md`，再对齐英文译本。范围包括 README、QUICKSTART、CONFIGURATION、LIMITATIONS、DIAGNOSTICS、COMPATIBILITY、PERFORMANCE、MIGRATION、API、ARCHITECTURE、CONTRIBUTING、SECURITY、SUPPORT、CODE_OF_CONDUCT、VALUE。改动影响用法时，先更新中文 README 和受影响的中文文档，再对齐英文译本；两侧逐节对应。

## 报告缺陷与安全问题

缺陷请开 GitHub issue：

https://github.com/Big-Dao/dsh-plugin-wsl-env/issues

安全问题请私下报告。请遵循 [SECURITY.zh.md](SECURITY.zh.md)，不要开公开 issue。
