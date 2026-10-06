<!--
上游 discussion 草稿。
提交入口：https://github.com/deepseek-ai/deepseek-harness/discussions （分类 Ideas）。
Discussions 标题栏用「标题」一节；正文从「动机」开始整段复制。
提交语言：本文是中文工作稿，而同族的上游草稿（docs/UPSTREAM-TERMINAL-TITLE.md、docs/UPSTREAM-SPAWN-SEAM.md、docs/UPSTREAM-FSIO-EXPORT.md、docs/upstream/issue-unc-validation.md、docs/upstream/rfc-wsl-workspaces.md）都以英文投递。提交前先把「动机」起的正文译成英文，以译文投递；本文件保留中文，作为缺口记录。
提交后：把下面 Status 行替换为讨论链接，本文件即成为缺口记录（惯例见 docs/UPSTREAM-TERMINAL-TITLE.md）。
-->

# Upstream proposal: a terminal font that follows the design system

Status: draft — 待提交

## 标题

GUI 终端 fontFamily 硬编码为 `ui-monospace` 字面量，不消费 `--ds-font-family-code`，JetBrains Mono 永不参与（Windows 上恒渲染 Consolas）

## 动机

### 现状

`@deepseek-ai/dsh-client-ui-sidebar-terminal`（`lib/client.terminal.js`）在创建 xterm 实例时把字体写死为字面量，不读取任何设计令牌，也没有对应的设置项：

```js
const xterm = new Terminal({
    minimumContrastRatio: 4.5,
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    scrollback: current.current.state.environment?.scrollback ?? 0
});
```

三点问题：

- **栈里没有 JetBrains Mono。** 用户装了它也不会生效；`ui-monospace` 在 Windows/Chromium 下解析为 Consolas，所以 Windows 上这个终端**永远是 Consolas**。（macOS 上 `SFMono-Regular` 存在，会命中 SF Mono —— 所以 mac 用户无感，症状集中在 Windows。）
- **设计系统已有等宽令牌却没被消费。** bundle 里的 `--ds-font-family-code: "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"` 用于聊天代码块等处；终端组件没有用它，两处等宽字体栈已经不是同一个事实来源。
- **应用没有给 UI/终端捆绑等宽 webfont。** 打包的字体里品牌 webfont 只有 Montserrat；另有整套 KaTeX 公式字体（59 个文件，含等宽的 `KaTeX_Typewriter`，在 web 前端 CSS 里有 `@font-face`），但那服务的是公式排版，不是 UI 或终端可用的家族。JetBrains Mono 不在其中，终端字体完全取决于系统装了什么。

证据位置（`dsh-desktop 0.2.0-rc.2`，Electron 44.0.0）：`resources/app.asar` → `/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.terminal.js`，chunk 内第 13406 行。可排除的干扰项：整个 asar 里 `new …Terminal(` 共 9 处，除这一处外分别落在 `@xterm/xterm` 自身的内部构造（`CoreBrowserTerminal`）、`@xterm/headless` 自身、`dsh-api-terminal-controller`（经 `requireHeadless()` 建的两处 headless `Terminal`，以及该包自己的 `BrowserTerminal` 类 —— 类定义在 `lib/types/terminal.js:9`，内部同样用 headless xterm）、`dsh-terminal-bash`（`HeadlessTerminal`），以及 `@xterm/addon-serialize` 的 README 示例，全都没有渲染概念。导入渲染版 `@xterm/xterm` 并加载 `FitAddon` 的只有 `dsh-client-ui-sidebar-terminal`，所以唯一面向用户的 xterm 就是这一处。取数命令见「复现与验证」。

> 顺带说明：这与 WSL 无关 —— 这个组件服务所有会话，Windows 目录会话的终端同样渲染 Consolas。最初是在 WSL 工作区里被注意到的。

### 影响场景

- Windows 上装了 JetBrains Mono / JetBrainsMono Nerd Font 的用户，GUI 终端显示的仍是 Consolas；与聊天里的代码块（若装了 `JetBrains Mono` 家族则走 JetBrains Mono）同屏不同字体，观感割裂。
- Consolas 没有 powerline / Nerd Font 私有区字形。用户 shell 提示符（starship、oh-my-zsh、nerd 图标）的图标靠 Chromium 逐字符回退到系统里的 Nerd Font 渲染，字形宽度和 Consolas 格宽不一致，出现错位与替换字形 —— 这正是「终端字体显示不正确」最直观的来源。
- 硬编码栈末尾没有任何 CJK fallback（设计令牌里有 PingFang SC / Microsoft YaHei，它没有）。终端里的中文依赖 Chromium 全局回退，宽度同样与格宽不一致。

## 复现与验证

下列命令在 WSL 内即可跑完，不必打开应用（`APP` 取 Windows 侧默认安装目录的 WSL 挂载路径）：

```bash
APP="/mnt/c/Users/<用户名>/AppData/Local/Programs/DeepSeek Harness"

# 版本锚点：应用版本在 asar 根的 package.json，44.0.0 是根目录 version 文件里的 Electron 运行时版本
grep -a -A2 '"name": "@deepseek-ai/dsh-desktop"' "$APP/resources/app.asar"   # -> "version": "0.2.0-rc.2"
cat "$APP/version"                                                           # -> 44.0.0

# 硬编码的字体栈 —— 唯一一处面向用户的 xterm 配置
grep -ao 'fontFamily: "ui-monospace[^"]*"' "$APP/resources/app.asar"
# -> fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

# 设计系统令牌确实存在（定义在 dsh-client-ui-theme；bundle 里引号是转义的）
grep -ao -- '--ds-font-family-code:[^;]\{0,220\}' "$APP/resources/app.asar" | head -1

# 目前没有终端专用令牌
grep -ac -- '--dsh-terminal-font-family' "$APP/resources/app.asar"           # -> 0

# 面向用户的那一处之外还有什么：全 asar 的 Terminal 构造共 9 处，逐处核对见上文「证据位置」
grep -ao 'new [A-Za-z_$.]\{0,40\}Terminal(' "$APP/resources/app.asar" | sort | uniq -c
# -> 2 new BrowserTerminal( / 1 new HeadlessTerminal( / 1 new import_xterm.Terminal( /
#    1 new o.Terminal( / 1 new r.CoreBrowserTerminal( / 3 new Terminal(
```

坐标：

- 桌面侧：`resources/app.asar` → `/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.terminal.js`（`@deepseek-ai/dsh-client-ui-sidebar-terminal@0.2.0-rc.2`），chunk 内第 13406 行。
- 上游源码树：`packages/client/ui-sidebar-terminal/src/client/` —— 同一 chunk 的 rolldown 区段标记把它写作 `\0dsh-css:…\packages\client\ui-sidebar-terminal\src\client\terminal.module.css.mjs`，本组件的编译产物则是 `lib/types/client/terminal.js`。报此问题时请按上游源码树里的实际文件与行号复述一次。

验收：修好之后，上面读硬编码字体栈那条 grep 的结果应与 `--ds-font-family-code` 同源（或指向终端自己的令牌），且在装了 JetBrains Mono / JetBrainsMono Nerd Font 的 Windows 机器上终端实际渲染该家族 —— 在 renderer devtools 里读 xterm 实例的 `options.fontFamily` 与终端的计算样式 `font-family` 即可确认。判别点是 `ui-monospace` 在 Windows/Chromium 上落不到 JetBrains Mono，任何一项验到 JetBrains Mono 就算修复生效。

`var()` 不能直接喂给 xterm 另有一条独立证据：字符测量走 canvas，而 canvas 的 `font` setter 会整串拒绝 `var()`。在 renderer devtools 里跑：

```js
const c = document.createElement("canvas").getContext("2d");
c.font = "10px serif";
c.font = "13px var(--ds-font-family-code)";
c.font   // -> "10px serif"，未被接受（带兜底的 var(--x, monospace) 同样被拒）
c.font = "13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
c.font   // -> 原样读回，字面量栈被接受
```

本文件核实时在 Chromium（Edge headless）上取得同样结果：`var()` 两种写法都被拒、读回仍是上一次的值，字面量栈原样接受。

## 插件/设置侧为何无法自救

- 没有设置项可改：检索整个 bundle，`fontFamily` 的其余出现全都不是配置面 —— pdf.js 内部（XFA 字体）、电子表格的字体映射、web 前端的数学字体表，以及 xterm 自身实现；用户侧没有任何 terminal font 配置面，`fontSize: 13` 同为字面量。
- 插件无法触及：以 `dsh-plugin-wsl-env` 为例，它替换的是 composition 级 `subprocess` 服务的 `spawnTerminal`，只能重写启动 argv/cwd/env（`wsl.exe -d <distro> --cd …`）；字体是浏览器端渲染属性，provider 拿不到 renderer。
- CSS 注入类 workaround（devtools、用户样式扩展）不可分发，等于没修。

## 建议的修复

**方案 A（最小，推荐）：让终端消费 `--ds-font-family-code`，恢复单一事实来源。** 两个落地细节值得注意：

1. xterm 的 `fontFamily` 是传给渲染器的字符串，**不能直接传 `var(--ds-font-family-code)`**。原因不是渲染器，而在字符测量：`CharSizeService` 优先用 OffscreenCanvas 策略（bundle 里 `new OffscreenCanvas(100, 100)`，随后 ``this._ctx.font = `${fontSize}px ${fontFamily}` ``），DOM span 策略只是 canvas 字体指标不可用时的 catch 回退 —— 也就是说测量走 canvas 与用哪种 renderer 作画无关，当前构建（未加载 webgl/canvas addon，DOM renderer）就已如此。而 Chromium 的 canvas `font` setter 会整串拒绝 `var()`：设成 `13px var(--ds-font-family-code)` 后读回仍是上一次的值，测量会静默退回默认字体（实测见「复现与验证」）。稳妥做法是 JS 侧解析成具体值再传入（`getComputedStyle(root).getPropertyValue('--ds-font-family-code')`），或由 design-system 包导出同一常量。
2. 补齐的家族要写进哪个栈，先定下来。方案 A 之下终端消费的就是共享令牌，所以这一步动的是**共享的 `--ds-font-family-code` 本身**（定义在 `dsh-client-ui-theme`，bundle 里另有 18 个文件引用它 —— 聊天代码块、JSON 树、diff 统计、审批卡片等），这些引用方会跟着一起变；这是 design-system 包的改动，需要该包接受。若共享改动不可接受，就别在方案 A 里动它：把追加的家族放进方案 B 的终端专用令牌（见下），只在终端生效。要补的两个家族：`"Cascadia Mono"`（Windows Terminal 自带）与 `"JetBrainsMono Nerd Font"`（大量用户装的是 Nerd 变体，家族名与 `"JetBrains Mono"` 不同 —— 本机实测即如此，装了 Nerd 全家桶却匹配不上令牌）。

**方案 B（可选增强）：** 引入终端专用令牌（如 `--dsh-terminal-font-family`，默认值 = code 栈，必要时在其上追加 Windows 家族），为将来在设置里暴露 `terminal.fontFamily` 留缝；`fontSize` 一并处理。与 A 的边界：A 改的是共享令牌、影响全部等宽消费方；B 只在终端生效、不动其他消费方。方案 A 第 2 点的家族若被 design-system 拒绝，就落到 B 的令牌默认值里。

## 环境

- dsh-desktop `0.2.0-rc.2`（Electron 44.0.0，Windows 11 + WSL2）。`44.0.0` 是安装目录根下 `version` 文件里的 Electron 运行时版本，不是应用版本；应用版本取自 asar 根 `package.json` 的 `@deepseek-ai/dsh-desktop`。
- `@deepseek-ai/dsh-client-ui-sidebar-terminal` 0.2.0-rc.2
- 本机字体：装有 `JetBrainsMono Nerd Font` 全家族（`C:\Windows\Fonts`），未装家族名 `JetBrains Mono` 的官方字体；应用内 webfont 只有 Montserrat，另有整套 KaTeX 公式字体（含等宽的 `KaTeX_Typewriter`，仅供公式排版，不是给 UI 或终端的家族）
- 版本范围：以上行为在 `0.2.0-rc.2` 上核实，更早或更晚的构建未逐一核对，该硬编码实际跨越哪些版本未确证
- 关联讨论：#8769 —— 它的目标包是 `packages/api/terminal-controller`（版本线 `0.2.0-rc.x`），**不是**本文所指的 `@deepseek-ai/dsh-client-ui-sidebar-terminal`。两者是同一桌面构建上相邻的两处接缝：一处在 composition 级 `shell.name` 与 renderer 实际启动之间，一处在 renderer 内的字体栈；修一处不影响另一处。
