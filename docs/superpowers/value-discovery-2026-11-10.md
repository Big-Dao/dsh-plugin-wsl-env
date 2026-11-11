# 需求发掘记录 — 2026-11-10

状态：带日期的研究记录，不是路线图，也不承诺实现。结论按仓库自己的裁决规则
（[痛点日志](pains.md) 的三问 + [ROADMAP-1.0](../ROADMAP-1.0.md) §0 的两条核心
价值）给出；证据来自本机真机复现、源码核对和现有文档承诺的对照。

环境：Ubuntu 26.04.1 LTS（WSL 2，内核 6.18.58.1-microsoft-standard-WSL2），
插件 `0.24.0`，检出 `784586d`，Node 24.19.0，pnpm 11.7.0。会话策略
`workspace-write`，`sessionSandbox: true`（随包预设）。

> 引用说明：E2 的模块路径已按 `b4c274f` 的拆分改写（`src/index.ts` →
> `wsl-shell.ts` / `wsl-filesystem.ts` / `doctor-report.ts` / `provider-common.ts`），
> 文中行号仍是记录当时的定位、未按当前树逐一校准；结论以当时的复现为准。

> 2026-11-10 后续：R1 的授权与契约修复已落地（`writableRoots` +
> `additionalWritableRoots` 修正，见 CHANGELOG Unreleased）；草案第 5、6 项未做，
> 见「下一步」。R2 及 R3–R7 经当日复核后**暂缓**：R2 的触发场景生僻，且默认
> `interopVisibility: visible` 本就把“用户级写穿”列为 `partial` 的一部分，
> 不值得为它改变默认行为；其余候选没有新增痛感证据。

## 结论

本轮只有一条**有真机证据**的高价值需求（R1）；另有一条已在真机复现、但触发
场景生僻的安全发现（R2，暂缓），以及若干证据不足的候选。

1. **R1 — `workspace-write` 下的工具链写入授权（已修复，见文首后续）。** 当时实现把
   `additionalWritableRoots` 在构建 bwrap profile 之前丢掉，导致 npm / pnpm /
   cargo 的缓存写入全部 `EROFS`；快速开始里 `pnpm install` 这条配方在冷缓存下
   直接失败。它同时是一个契约 bug（上游策略宣称的额外可写目录没有生效）和一个
   每天都会碰到的产品缺口。
2. **R2 — 写围栏之外的套接字逃逸（已暂缓）。** 受限命令可以通过用户级 systemd
   总线启动一个位于 bwrap mount namespace 之外的进程，对 `$HOME` 写入成功。
   它确实是 [SECURITY](../../SECURITY.md) 欢迎报告的一类，但触发需要命令主动
   连总线；默认配置的 interop 逃逸已经把最坏情况定在用户级写穿，为这条路径
   改变默认行为（打断 `systemctl --user`/portal）不划算。留给显式 strict 档，
   不在本轮实现。

其余候选按“证据强度 × 人的时间损失”排序，见下表。

## 证据

### E1 — 包管理器缓存在默认沙箱下不可写

在 `/tmp` 的临时工作区中执行（工作区本身可写，`/tmp` 可写）：

| 命令 | 结果 |
|---|---|
| `npm install is-number` | `npm error code EROFS`，路径 `~/.npm/_cacache/tmp/...` |
| `pnpm add is-number@6.0.0` | `ERR_PNPM_EROFS`，路径 `~/.local/share/pnpm/store/v3/...` |
| `cargo fetch`（`serde = "=1.0.100"`，未缓存版本） | `Read-only file system (os error 30)`，路径 `~/.cargo/registry/cache/...` |
| `touch ~/.cache/...`、`mkdir ~/.npm/...` | `Read-only file system` |
| `touch /tmp/...` | 成功 |

已缓存的包会“碰巧成功”（store 只读、workspace 可写），所以热仓库和冷仓库的
表现不同；这不是网络问题，而是写围栏。`danger-full-access` 下同一命令成功，
单次 `--cache /tmp/...` 也能让 npm 成功——两种绕行都已被观察到。

本机的缓存体量（`du -sh`）：`~/.npm` 7.7G、`~/.cache` 6.3G、
`~/.local/share/pnpm` 8.6G、`~/.cargo` 1.0G。这不是边缘配置。

### E2 — 策略宣称的额外可写目录没有到达 bwrap

> 本节记录的是修复前的状态。R1 已在 `86f1933` 落地（`3a02ada` 把物理检查挪到
> fence 时点）：`bwrap.ts:109` 逐个 `--bind` 额外根，`agent-confined.ts:146/160`
> 与 `session-runtime.ts:226/233` 的 key 和 prefix 都带上了 `writableRoots`。下面
> 的定位过程与行号都保留修复前的原样，不代表当前实现。

`ctx.sandboxPolicy` 的 `additionalWritableRoots` 是上游公开的部署配置
（`@deepseek-ai/dsh-sandbox-policy` README：`workspace-write` 下额外可写的显式
绝对目录）。插件的处理断在三处：

- [`src/provider-common.ts`](../../src/provider-common.ts) 的 `wslWritableRoots` 只接受**同发行版的
  UNC** 额外根；Linux 拼写（执行世界里的正确拼写）被拒绝为
  `SandboxInvalidRootError`（`src/provider-common.ts:49`）。
- 命令路径把完整 policy 交给 `WslSandbox.confine`，但
  [`src/bwrap.ts`](../../src/bwrap.ts) 的 `bwrapProfileArgs` 只绑定
  `workspaceRoot`，从不绑定额外根（`src/bwrap.ts:80-95`）。
- 写入路径在 [`src/wsl-filesystem.ts`](../../src/wsl-filesystem.ts) `mutationAgent` 里把 policy
  收窄成 `{ mode, workspaceRoot, sessionId }`（`src/wsl-filesystem.ts:468`），
  [`src/agent-confined.ts`](../../src/agent-confined.ts)（key `:140`，prefix
  `:154`）和 [`src/session-runtime.ts`](../../src/session-runtime.ts)
  （key `:220-221`，prefix `:241-243`）同样只拿 workspace。

结果是：围栏判定允许（`wslWritableRoots` 加了额外根），内核挂载不允许
（bwrap 没绑定），写操作以 `EROFS` / `FS_IO_ERROR` 失败；模型看到的策略上下文
却写着 “Additional writable directories: [...]”。这是三方不一致，不只是缺口。

### E3 — 现有文档把失败路径当作成功配方

> 本节记录的同样是修复前的状态。R1 落地后 `CONFIGURATION.zh.md:68/84/102` 已
> 记录 `writableRoots` 与 npm/pnpm/cargo 的缓存配方，`QUICKSTART.zh.md:150` 的
> `pnpm install` 配方后已补 `EROFS` 提醒与 CONFIGURATION 链接。下面两条结论
> 描述的是当时的文档状态。

[`docs/QUICKSTART.zh.md:146`](../QUICKSTART.zh.md) 在 Node/TypeScript 配方里给出
`pnpm install`；[README](../README.zh.md) 把“真实的 Linux 环境、PATH、pnpm、
cargo”列为核心价值。冷缓存下这条配方失败。`CONFIGURATION` 没有提到
`additionalWritableRoots`，用户没有可发现的授权入口。

### E4 — 套接字逃逸（安全，需私下处理）

在当前默认会话（session runtime，bwrap mount profile）内，一个受限命令可以经
用户级服务管理器的套接字请求启动一个 unit；该 unit 在 mount fence 之外运行，
对 `$HOME` 的写入成功（已复现），而对同一路径的直接写入是 `EROFS`。用手工
bwrap 把 `/dev/null` 绑到该套接字后，同一请求被拒绝——修复方向已验证；具体
路径与复现步骤留给私密报告。

同类面还有容器守护进程套接字（本机存在 `/var/run/docker.sock ->
/run/podman/podman.sock`；未逐个实测）。这类逃逸不依赖 interop，落在
[SECURITY](../../SECURITY.md) 的 in-scope 描述内；复现命令不写进本记录，按
`SECURITY.md` 的私密渠道处理。

### E5 — 预览的相对媒体路径（回归）

open-in-app 修复（issue #37）让 `processPath` 返回宿主拼写 UNC；同一拼写也进入
`stat.absolutePath`，而客户端 `fileMediaUrl` 拒绝 `\\` 前缀，于是 WSL 预览里的
相对 Markdown 图片不再渲染。已在 [LIMITATIONS](../LIMITATIONS.zh.md) 记录；它是
可见回归，但根因在客户端，插件侧只能加回归测试或提供替代媒体路由。

## 候选与三问

| ID | 候选 | 核心价值 | 谁在痛 | 量级 | 不做的后果 | 成本 | 裁决 |
|---|---|---|---|---|---|---|---|
| R1 | `workspace-write` 工具链写入授权：修 `additionalWritableRoots`，加 `writableRoots` / 缓存配方 | 1 | 每个装依赖的用户；快速开始的读者 | 每装一个包一次升级确认 + 失沙箱，或任务失败 | 核心配方在冷仓库失败，用户被迫 `danger-full-access` | M | **采纳（最高）** |
| R2 | 关闭/隔离写围栏外的套接字逃逸（至少用户 systemd 总线；strict 档覆盖容器 socket） | 2（安全） | 需要命令主动连总线的不可信脚本；普通开发流程不碰 | 一次逃逸绕过写围栏，但默认 interop 已提供同类用户级写穿 | 默认仍是 `partial`；strict 档可加固 | S/M | **暂缓（低价值；strict 档再议）** |
| R3 | 预览相对媒体在 UNC 拼写下恢复 | 2 | 写文档/看预览的用户 | 图片不显示，内容仍可读 | 回归持续；每次预览都要手工开文件 | S（上游）/ M（插件兜底） | 暂缓；上游有解再跟 |
| R4 | headless / CI 一次性运行验证与支持 | 1、2 | 脚本、CI、无 UI 用户 | 功能缺失 | 插件实际上 GUI-bound；自动化故事缺失 | S spike / M 修复 | 暂缓；记录到脚本/CI 需求再做 |
| R5 | WSL 会话里的 `/mnt/<drive>` 走宿主平面 | 2 | 同时读写 Windows 文件的用户 | 9p 延迟（目录遍历可达 56×） | 慢，但可用 | M | 暂缓；无测量需求 |
| R6 | 凭据路径（git push / gh / aws）文档 + 探针 | 1 | 第一次推送的用户 | 认证失败或挂起 | 可绕行，但首次体验差 | S（文档+探针） | 暂缓 |
| R7 | 把工具可用性（rg/git/inotify/bwrap/scope）放进 `DSH_WSL_*` 或预检行 | 1 | 最小发行版用户 | 一次 127 加一次重试 | 模型不知道 rg 缺失 | S | 暂缓 |

**2026-11-10 裁决：** 只推进 R1。R2 的机制已确认，但触发场景生僻、默认
`interopVisibility: visible` 已把用户级写穿含在 `enforcement: partial` 里，且
默认屏蔽用户总线会打断 `systemctl --user`/portal；留给未来的 strict 档，不改变
默认行为。R3–R7 没有新增痛感证据，暂缓。

已否决/不重开（保留理由，避免反复讨论）：

- `@` 补全的 9p 遍历：人体扫描候选列表的时间远大于 84.7 ms 的机器差；
  [痛点日志](pains.md) 已记录为“不是事件”。
- 逐文件 watch 事件：`fs.watch` 没有 payload，唯一消费者本来也只 stat 一次。
- 干净机器首跑计时：缺可重置环境，是测量不是功能。
- LSP：上游 composition 未挂载；物理 aarch64：无机器；WSL 1：已是非目标。
- 再次替换随包 `workspace-files`：会丢浏览器 `file` 资源提供者。

## R1 设计草案（供裁决，不是实现）

目标：在不把整条命令提升到 `danger-full-access` 的前提下，允许工具链写入它本来
就拥有的缓存/状态目录；默认仍然只有 workspace + `/tmp`。

1. **修契约。** `bwrapProfileArgs` 接受一组 Linux 路径的 `writableRoots`，在
   `workspace-write` 下逐个 `--bind root root`；命令、受限写入 agent、session
   runtime 三条路径都传入；三个缓存 key 都包含排序后的根列表。
2. **统一拼写。** 对 `additionalWritableRoots`：同发行版 UNC → Linux 路径；
   Linux 绝对路径原样；其他发行版 UNC / Windows 盘符路径 → 具名 fail-closed
   （`SandboxInvalidRootError`），不再“围栏允许、内核拒绝”。
3. **用户入口。** 在 `wsl-shell` 与 `wsl-fs` 上新增 `writableRoots`（发行版绝对
   路径，允许 `~/`），两行写同一列表；`preset` helper 打印它；默认空。也可以
   只修 `additionalWritableRoots` 并文档化，但共享 policy 里的 Linux 路径会让同
   profile 的 Windows 会话失败，所以插件自己的键更安全。
4. **配方与边界。** CONFIGURATION 给出 npm / pnpm / cargo / uv 的最小列表
   （如 `~/.npm`、`~/.cache`、`~/.local/share/pnpm`、`~/.cargo/registry`、
   `~/.cargo/git`），并写明代价：这些目录可持久化可执行内容，授权等于收窄
   沙箱，不是关闭它；`enforcement` 仍是 `partial`。
5. **验证。** 单测覆盖 bwrap argv、UNC/Linux 转换、三个 key、围栏与挂载一致；
   真机 `probe:cache-write`：临时工作区 + 授予的临时缓存目录，写成功；未授予的
   目录仍 `EROFS`；`sessionSandbox` 开/关各一条；app-closed 全套加一条。
6. **错误面。** EROFS 命中 workspace 之外的路径时，结果里给出“沙箱只授予
   workspace；见 `writableRoots`”的一行提示（或在 doctor 增加
   `sandbox.grants` 检查，列出已配置根与可写性）。

## R2 设计草案（安全）

1. 每个受限 profile 用 `--ro-bind /dev/null <XDG_RUNTIME_DIR>/bus` 屏蔽用户总线；
   UID 按发行版探测一次并缓存。验证命令：总线屏蔽后 `systemd-run --user` 失败，
   正常命令、git、node、pnpm 不受影响。
2. `socketIsolation: "session-bus" | "strict" | "off"`（或等价键）：默认屏蔽用户
   总线；`strict` 额外屏蔽容器/系统总线路径（`/run/podman`、
   `/var/run/docker.sock`、`/run/containerd` 等），与 `interopVisibility` 的
   严格档并列。默认不屏蔽容器 socket 的理由：`docker compose` 是真实开发流程，
   但必须在文档里写明它本就在文件围栏之外。
3. `probe:sandbox` 增加“总线不可达、封锁后写入被拒”的腿；doctor 报告机器上
   存在的逃逸面（用户总线、容器 socket、interop）而不自动修改。
4. 先走私密报告/修复渠道，再在 release notes 里描述类别，不写利用细节。

## 下一步

已完成：

- E1 已写进[痛点日志](pains.md)（按日志规则，只记录事件，不写方案）。
- R1 的授权与契约修复已落地（`86f1933`、`3a02ada`）：新键、契约修复、
  CONFIGURATION 配方与 CHANGELOG Unreleased 条目齐备。

待办：

- R1 草案第 5 项：真机 `probe:cache-write` —— 授予的临时缓存目录写成功、未授予
  的目录仍 `EROFS`，`sessionSandbox` 开/关各一条。
- R1 草案第 6 项：`EROFS` 命中 workspace 之外的路径时给出 `writableRoots` 提示，
  或在 doctor 增加 `sandbox.grants` 检查。两者目前都不存在。
- R2 作为安全修复并行处理，先走私密渠道；R3 先给上游补一条回归报告；R4 只在
  记录到脚本/CI 需求后做 spike。
- 后续任何落地都按仓库规则先改 `CONFIGURATION.zh`、再同步 `LIMITATIONS`/README/
  CHANGELOG，跑 `pnpm test` 与真机探针。
