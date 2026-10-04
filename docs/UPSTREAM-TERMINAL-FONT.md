<!--
上游 discussion 草稿。
提交入口：https://github.com/deepseek-ai/deepseek-harness/discussions （分类 Ideas）。
Discussions 标题栏用「标题」一节；正文从「动机」开始整段复制。
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
    scrollback: environment.scrollback ?? 0
});
```

三点问题：

- **栈里没有 JetBrains Mono。** 用户装了它也不会生效；`ui-monospace` 在 Windows/Chromium 下解析为 Consolas，所以 Windows 上这个终端**永远是 Consolas**。（macOS 上 `SFMono-Regular` 存在，会命中 SF Mono —— 所以 mac 用户无感，症状集中在 Windows。）
- **设计系统已有等宽令牌却没被消费。** bundle 里的 `--ds-font-family-code: "SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"` 用于聊天代码块等处；终端组件没有用它，两处等宽字体栈已经不是同一个事实来源。
- **应用未捆绑等宽 webfont。** 打包的 webfont 只有 Montserrat（品牌字体），JetBrains Mono 不在其中，终端字体完全取决于系统装了什么。

证据位置（dsh-desktop 44.0.0）：`resources/app.asar` → `/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-terminal/lib/client.terminal.js`。可排除的干扰项：其余 `new Terminal(` 均为 headless 实例（序列化回放、模型侧 terminal-bash 服务），没有渲染概念，唯一面向用户的 xterm 就是这一处。

> 顺带说明：这与 WSL 无关 —— 这个组件服务所有会话，Windows 目录会话的终端同样渲染 Consolas。最初是在 WSL 工作区里被注意到的。

### 影响场景

- Windows 上装了 JetBrains Mono / JetBrainsMono Nerd Font 的用户，GUI 终端显示的仍是 Consolas；与聊天里的代码块（若装了 `JetBrains Mono` 家族则走 JetBrains Mono）同屏不同字体，观感割裂。
- Consolas 没有 powerline / Nerd Font 私有区字形。用户 shell 提示符（starship、oh-my-zsh、nerd 图标）的图标靠 Chromium 逐字符回退到系统里的 Nerd Font 渲染，字形宽度和 Consolas 格宽不一致，出现错位与替换字形 —— 这正是「终端字体显示不正确」最直观的来源。
- 硬编码栈末尾没有任何 CJK fallback（设计令牌里有 PingFang SC / Microsoft YaHei，它没有）。终端里的中文依赖 Chromium 全局回退，宽度同样与格宽不一致。

## 插件/设置侧为何无法自救

- 没有设置项可改：检索整个 bundle，`fontFamily` 的运行时读取只有 pdf.js 内部（XFA 字体）与 xterm 自身实现，用户侧没有任何 terminal font 配置面；`fontSize: 13` 同为字面量。
- 插件无法触及：以 `dsh-plugin-wsl-env` 为例，它替换的是 composition 级 `subprocess` 服务的 `spawnTerminal`，只能重写启动 argv/cwd/env（`wsl.exe -d <distro> --cd …`）；字体是浏览器端渲染属性，provider 拿不到 renderer。
- CSS 注入类 workaround（devtools、用户样式扩展）不可分发，等于没修。

## 建议的修复

**方案 A（最小，推荐）：让终端消费 `--ds-font-family-code`，恢复单一事实来源。** 两个落地细节值得注意：

1. xterm 的 `fontFamily` 是传给渲染器的字符串。当前 bundle 未加载 webgl/canvas addon（DOM renderer），直接传 `var(--ds-font-family-code)` 可以渲染；但 DOM renderer 测量与 canvas `ctx.font` 对 `var()` 的容忍度不同 —— 一旦将来为性能引入 WebGL renderer，`var()` 会在 canvas 测量处整体失效。稳妥做法是 JS 侧解析成具体值再传入（`getComputedStyle(root).getPropertyValue('--ds-font-family-code')`），或由 design-system 包导出同一常量。
2. 顺手补齐 Windows 生态的等宽家族，让栈在「没装 JetBrains Mono」的机器上也有合理落点：`"Cascadia Mono"`（Windows Terminal 自带）与 `"JetBrainsMono Nerd Font"`（大量用户装的是 Nerd 变体，家族名与 `"JetBrains Mono"` 不同 —— 本机实测即如此，装了 Nerd 全家桶却匹配不上令牌）。

**方案 B（可选增强）：** 引入终端专用令牌（如 `--dsh-terminal-font-family`，默认值 = code 栈），为将来在设置里暴露 `terminal.fontFamily` 留缝；`fontSize` 一并处理。

## 环境

- dsh-desktop 44.0.0（Electron，Windows 11 + WSL2）
- `@deepseek-ai/dsh-client-ui-sidebar-terminal` 0.2.0-rc.2
- 本机字体：装有 `JetBrainsMono Nerd Font` 全家族（`C:\Windows\Fonts`），未装家族名 `JetBrains Mono` 的官方字体；应用内 webfont 仅 Montserrat
- 关联讨论：#8769（同一包 0.2.0-rc.2，composition 级 `shell.name` 与 renderer 实际启动之间的另一个缝）
