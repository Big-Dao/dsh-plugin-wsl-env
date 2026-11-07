# Proposal: a per-plugin diagnostics action on the Plugins page

Status: proposal, filed 2026-11-07 as [deepseek-harness discussion #12499](https://github.com/deepseek-ai/deepseek-harness/discussions/12499). Companion to the session-notice ask
(#10263) and the background-job kill report (#12433). Not a release promise.

## The ask

GUI users have no diagnostics entry. When a WSL session misbehaves, the
diagnosis exists — the plugin's doctor — but reaching it requires a terminal
and Node, which is exactly what a desktop-app user chose not to deal with.
The support loop breaks at its first step: the setup-report template asks for
`doctor --json`, and the user cannot produce it.

**The request:** a per-plugin "Run diagnostics" action on the Plugins page
that runs the plugin's diagnostic and shows the result, with copy-to-
clipboard. Design freedom in how the seam is shaped; three options, cheapest
first:

1. **No new API.** The Plugins page gains a generic action that spawns
   `<plugin>/scripts/doctor.mjs` with the app's own runtime in Node mode
   (`ELECTRON_RUN_AS_NODE=1` — the mechanism the CLI's headless runs already
   use) and renders the JSON. Works for any plugin that ships a
   `scripts/doctor.mjs`; nothing to declare.
2. **A tiny declared surface.** A plugin row/service can declare a
   diagnostics entry (name + an async function returning a JSON value); the
   Plugins page lists and renders it. Generalizes beyond the doctor (any
   plugin's self-check), costs the app one registry walk.
3. **A "collect diagnostics" bundle.** One action that runs every installed
   plugin's diagnostics and hands the user a single file for a support
   report.

## What is already in place (dsh-plugin-wsl-env)

- `doctorReport()` is an exported API (since WSL-313) that collects the
  report in-process and merges the live resident's state — the app side can
  call it without spawning anything.
- The report is versioned (`schemaVersion: 2`): `verdict: ready | blocked`,
  `blockers`, per-distro verdicts, per-check `status/detail/remedy` (every
  failure carries a copy-paste remedy), and `timingsMs`.
- The doctor is honest about its boundary: the verdict answers under the
  effective configuration; the remedy-only boundary (it never rewrites
  user- or distro-owned files) is documented.

A Plugins-page action could render `verdict` and the failing checks'
remedies directly — no schema work needed on your side beyond displaying a
JSON value.

## Reproduce the pain

Windows 11 + the desktop app; a WSL session fails with
`SANDBOX_UNAVAILABLE`. The user's paths today: open a terminal, find the
plugin directory, have Node on PATH, run the doctor — four steps a GUI user
should never need. The session transcript carries the preflight advisory
(the plugin's available channel today), but the full verdict, the per-distro
breakdown and the fix loop live behind the CLI.

## Expected

Any of the three shapes removes the break: the user clicks one button,
reads a verdict, and either applies a copy-paste remedy or attaches the
bundle to a setup report. Option 1 is a day of work; option 2 is the
honest API; option 3 is the support-desk dream.

---

（中文摘要：GUI 用户没有任何诊断入口——doctor 是 CLI 优先的，而桌面 App
用户恰恰没有终端和 Node。请求在 Plugins 页加一个按插件的"运行诊断"动作，
跑诊断并以可复制方式展示结果。给出三档形态：① 无需新 API——用 App 自身
runtime 以 `ELECTRON_RUN_AS_NODE=1` 跑 `<plugin>/scripts/doctor.mjs` 并渲染
JSON；② 插件声明式诊断条目（名称 + 返回 JSON 的异步函数），通用化到任何
插件的自检；③ 一键收集全部插件的诊断并出单个文件。dsh-plugin-wsl-env 侧
已备好：`doctorReport()` 导出 API（含 live resident 合并）、schemaVersion 2
报告（verdict/blockers/每条失败带可复制修复）、remedy-only 边界文档化。复现
痛点：WSL 会话报 `SANDBOX_UNAVAILABLE` 时，用户要开终端、找插件目录、有
Node、跑 doctor——四步 GUI 用户不该走。三档任一都消除断点，①一天工作量，
②是诚实的 API，③是支持流程的终点形态。）
