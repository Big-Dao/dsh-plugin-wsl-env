# Proposal: remote workspaces with a POSIX identity (WSL and SSH)

Status: draft for upstream, **not filed**. Target: `deepseek-ai/deepseek-harness`
Discussion, category Ideas. The English half is the filing body; the Chinese
half is the same content for review.

---

## English

### Summary

The Windows desktop app is a major DSH surface, but every way to use a Linux
environment from it today keeps the **host** as the session's centre of gravity.
The WSL plugin swaps `ctx.fs` / `ctx.shell` / sandbox providers, yet the
workspace identity stays a Windows path (`\\wsl.localhost\<distro>\...`), and the
model therefore sees a mixture of Windows aliases and POSIX paths. On Windows,
a POSIX-only remote workspace cannot even be opened: `fullyQualifiedWorkspacePath`
rejects `/home/...` and `realpathNormalize` calls the **host** `node:fs`.

This proposal asks for a small seam: let a workspace be **remote**, with a
POSIX identity that the model and the tool layer see, and a host-side handle
that only the GUI and transport need. With it, a WSL or SSH plugin can present
what VS Code Remote already presents — a pure Linux world — while the desktop
UI keeps working.

### The problem, concretely

Observed in DSH 0.13.0 on Windows 11 + WSL 2 with the WSL plugin (all paths
below are from one session):

| Surface | What the model sees |
|---|---|
| Runtime context, every turn | `Current working directory: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj"` |
| `read` result | `<path>\\wsl.localhost\ubuntu\home\andy\proj\package.json</path>` |
| Shell (`pwd`, git, compiler) | `/home/andy/proj` |
| `grep` given an absolute POSIX path | `C:\home\andy\Projects\...\package.json` (the host's win32 normalization of `/home/...`) |
| `glob`/`grep` with a relative path | `test/packaging.test.mjs`, `./test/...` |

So one session presents four dialects: UNC, a Windows drive path that does not
exist, POSIX, and relative. The model can usually infer Linux from command
output, but its workspace identity and several tool results still say Windows.
For SSH the same design gets worse: a drive-letter mount would make the model
believe it is on Windows while every command runs in Linux.

The root cause is not the providers. It is the workspace contract:

- `packages/workspace/workspace/src/paths.ts` requires a **host-fully-qualified**
  path and canonicalizes it with the host `realpath`; on win32 it rejects a
  POSIX root and cannot see a remote POSIX path at all.
- The model-visible runtime context and the file tools are derived from that
  one host path, so a remote world can only ever appear as a host alias.

VS Code Remote solves this by moving the **tool host** into the remote world:
its workspace is a `vscode-remote://wsl+Ubuntu/home/andy/proj` URI whose
`fsPath` is `/home/andy/proj`, and extensions (including Copilot) run inside
WSL. The model sees POSIX paths and Linux toolchain output; the Windows UI is
only a shell. DSH can reach the same result without moving the whole harness by
giving the workspace a remote descriptor.

### Proposed seam

A remote workspace descriptor, owned by the workspace package, plus provider
bindings:

```ts
interface RemoteWorkspace {
  scheme: 'wsl' | 'ssh'          // extensible; a plugin supplies the providers
  host: string                    // distro name or OpenSSH alias
  root: string                    // POSIX absolute path — the model-visible identity
  cwd: string                     // POSIX absolute path
}
```

Requirements, in order of importance:

1. **Model-visible coordinates are the remote POSIX coordinates.** The runtime
   context, `cwd`, fs results, `grep`/`glob` results and error messages use
   `root`/`cwd` (or workspace-relative paths), never a host alias.
2. **Validation happens in the remote world.** For a remote descriptor,
   `realpath`/containment checks go through the paired filesystem provider, not
   the host `node:fs`. A local workspace keeps today's semantics.
3. **A host handle is separate.** The GUI may still need a handle for window
   titles, recents or a mount; keep it out of the model-visible path set.
4. **Providers are paired by contract, not by package.** The existing
   `packages/ssh/*` family already defines the remote fs + subprocess + sandbox
   triple for POSIX hosts. A Windows transport (plugin or upstream) can satisfy
   the same contract; the workspace seam should not hard-code SSH.
5. **Tool-layer normalization follows the workspace.** The `C:\home\...`
   observation above is one symptom; with a remote descriptor the tool layer
   must normalize to the workspace coordinate rather than the host platform.

Non-goals: no Windows mount requirement, no change to local-workspace path
semantics, no automatic remote provisioning or reconnect. The desktop app may
keep starting a local host; only the workspace identity and its providers become
remote.

### What it enables

- A WSL or SSH plugin can present a pure Linux world on Windows: POSIX
  workspace, POSIX shell, POSIX file tools, Linux toolchain and debuggers, and
  GUI file tree/preview through the paired provider.
- The model stops having to translate between coordinate systems, which is the
  failure mode this proposal is about.
- The SSH family gains a Windows consumer without inventing a second workspace
  model; a Windows SSH transport can stay a plugin, or be upstreamed later.

### Alternatives considered

| Alternative | Why it is not enough |
|---|---|
| Provider-only plugin with a drive letter or UNC | The model sees a Windows alias; paths, toolchain and error messages keep crossing worlds |
| Require SSHFS-Win / WinFsp mount | Adds a native dependency, degrades I/O, and still presents `S:\` to the model |
| Run `dsh web` on the remote and tunnel | Works today and is the right workaround, but the desktop app cannot attach to it; it is a second harness, not the desktop experience |
| Move the whole harness into WSL | Same as the previous row; loses the desktop session model |

### Questions for maintainers

1. Is a `RemoteWorkspace` descriptor acceptable in the workspace package, or is
   there an existing session-environment seam to extend (the promotion map in
   `Big-Dao/dsh-plugin-wsl-env` calls it a "session environment resolver")?
2. Which layer owns model-visible path normalization — the workspace, the tool
   layer, or each provider?
3. For SSH on Windows, would you prefer a Windows transport in `dsh-ssh` or a
   community plugin that satisfies the same contract? The current README lists
   "No Windows endpoint" as a limitation, not a decision.

### References

- `packages/workspace/workspace/src/paths.ts` (`fullyQualifiedWorkspacePath`,
  `realpathNormalize`), checked against `0.2.1-rc.2`.
- `docs/subsystems/ssh.md` and `packages/ssh/README.md` — the POSIX-only local
  endpoint and the paired-provider contract.
- VS Code Remote Development: `vscode-remote://wsl+<distro>/<posix-path>` URIs,
  remote extension host.
- This repository's evidence: `docs/UPSTREAM-FILE-REFERENCE-SEAM.md`,
  `docs/upstream/promotion-map.md`, `docs/ROADMAP-1.0.md` (WSL-202/WSL-301).

---

## 中文版

### 摘要

Windows 桌面应用是 DSH 的重要使用面，但目前从它使用 Linux 环境的所有方式，
都把**宿主**放在会话中心：WSL 插件替换了 `ctx.fs` / `ctx.shell` / 沙箱
provider，但 workspace 身份仍是 Windows 路径（`\\wsl.localhost\<distro>\...`），
模型因此同时看到 Windows 别名和 POSIX 路径。在 Windows 上，纯 POSIX 的远程
workspace 甚至无法打开：`fullyQualifiedWorkspacePath` 拒绝 `/home/...`，
`realpathNormalize` 调用的是**宿主**的 `node:fs`。

本提案请求一个小 seam：让 workspace 可以是**远程**的，模型和工具层看到
**POSIX 身份**，宿主侧只保留一个 GUI/传输用的句柄。这样 WSL 或 SSH 插件就能
呈现 VS Code Remote 已有的效果——一个纯 Linux 世界——同时桌面 UI 照常工作。

### 具体问题

在 Windows 11 + WSL 2、DSH 0.13.0 + 本插件下实测（同一会话）：

| 入口 | 模型看到 |
|---|---|
| 每轮运行时上下文 | `Current working directory: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj"` |
| `read` 结果 | `<path>\\wsl.localhost\ubuntu\home\andy\proj\package.json</path>` |
| shell（`pwd`、git、编译器） | `/home/andy/proj` |
| 给 `grep` 传绝对 POSIX 路径 | `C:\home\andy\Projects\...\package.json`（宿主把 `/home/...` 做了 win32 规范化） |
| `glob`/`grep` 传相对路径 | `test/packaging.test.mjs`、`./test/...` |

一个会话里出现四种方言：UNC、并不存在的 Windows 盘符路径、POSIX、相对路径。
模型通常能从命令输出推断出 Linux，但它的 workspace 身份和部分工具结果仍是
Windows。SSH 若沿用同样设计会更糟：盘符挂载会让模型以为自己在 Windows 上，
而所有命令都跑在 Linux。

根因不在 provider，而在 workspace 契约：

- `packages/workspace/workspace/src/paths.ts` 要求**宿主 fully-qualified**
  路径，并用宿主 `realpath` 规范化；win32 上拒绝 POSIX root，也看不到远程
  POSIX 路径。
- 模型可见的运行时上下文和文件工具都由这一个宿主路径派生，所以远程世界只能
  以宿主别名的形式出现。

VS Code Remote 的做法是把**工具宿主**搬进远程世界：workspace 是
`vscode-remote://wsl+Ubuntu/home/andy/proj` URI，`fsPath` 是
`/home/andy/proj`，扩展（包括 Copilot）跑在 WSL 里。模型看到 POSIX 路径和
Linux 工具链输出，Windows UI 只是壳。DSH 不必搬走整个 harness，只要给
workspace 一个远程描述符，就能达到同样效果。

### 提议的 seam

由 workspace 包拥有的远程 workspace 描述符，加上 provider 绑定：

```ts
interface RemoteWorkspace {
  scheme: 'wsl' | 'ssh'          // 可扩展；provider 由插件提供
  host: string                    // 发行版名或 OpenSSH alias
  root: string                    // POSIX 绝对路径——模型可见的身份
  cwd: string                     // POSIX 绝对路径
}
```

按重要性排序的要求：

1. **模型可见坐标就是远程 POSIX 坐标。** 运行时上下文、`cwd`、fs 结果、
   `grep`/`glob` 结果、错误信息都用 `root`/`cwd`（或 workspace 相对路径），
   绝不出现宿主别名。
2. **校验发生在远程世界。** 远程描述符的 `realpath`/包含检查走配对的 fs
   provider，而不是宿主 `node:fs`。本地 workspace 保持现有语义。
3. **宿主句柄独立。** GUI 仍可能需要一个句柄（窗口标题、最近列表、挂载），
   但它不进入模型可见路径集合。
4. **provider 按契约配对，而不是按包配对。** 现有 `packages/ssh/*` 已为
   POSIX 宿主定义了远程 fs + subprocess + sandbox 三元组；Windows 传输
   （插件或上游）可满足同一契约，workspace seam 不应写死 SSH。
5. **工具层规范化跟随 workspace。** 上面的 `C:\home\...` 是一个症状；有了
   远程描述符后，工具层应按 workspace 坐标规范化，而不是按宿主平台。

非目标：不要求 Windows 挂载、不改变本地 workspace 路径语义、不做自动远端
provisioning/reconnect。桌面应用可以继续启动本地 host；只是 workspace 身份
和它配对的 provider 变成远程。

### 它能带来什么

- WSL/SSH 插件可以在 Windows 上呈现纯 Linux 世界：POSIX workspace、POSIX
  shell、POSIX 文件工具、Linux 工具链与调试器，GUI 文件树/预览走配对 provider。
- 模型不再需要做坐标翻译——这正是本提案要解决的失败模式。
- SSH 家族获得 Windows 消费者，而不用发明第二套 workspace 模型；Windows SSH
  传输可以先是插件，之后再上游化。

### 考虑过的替代方案

| 方案 | 为什么不够 |
|---|---|
| 只有 provider 的盘符/UNC 插件 | 模型看到 Windows 别名，路径、工具链、报错继续跨世界 |
| 要求 SSHFS-Win / WinFsp 挂载 | 引入原生依赖、I/O 变差，且模型仍看到 `S:\` |
| 远端跑 `dsh web` + 隧道 | 今天可用且是正确 workaround，但桌面应用无法接入；它是第二个 harness，不是桌面体验 |
| 把整个 harness 搬进 WSL | 同上；丢失桌面会话模型 |

### 想请维护者回答的问题

1. workspace 包是否接受 `RemoteWorkspace` 描述符？还是已有可扩展的
   session-environment seam（本仓库 promotion map 里称作 "session environment
   resolver"）？
2. 模型可见路径规范化归哪一层——workspace、工具层，还是各 provider？
3. Windows 上的 SSH，是希望加到 `dsh-ssh` 的 Windows transport，还是接受一个
   满足同一契约的社区插件？当前 README 把 "No Windows endpoint" 列为限制，
   不是决定。

### 参考

- `packages/workspace/workspace/src/paths.ts`（`fullyQualifiedWorkspacePath`、
  `realpathNormalize`），核对版本 `0.2.1-rc.2`。
- `docs/subsystems/ssh.md`、`packages/ssh/README.md`：POSIX-only 本地端与
  配对 provider 契约。
- VS Code Remote Development：`vscode-remote://wsl+<distro>/<posix-path>` URI、
  远程扩展宿主。
- 本仓库证据：`docs/UPSTREAM-FILE-REFERENCE-SEAM.md`、
  `docs/upstream/promotion-map.md`、`docs/ROADMAP-1.0.md`（WSL-202/WSL-301）。
