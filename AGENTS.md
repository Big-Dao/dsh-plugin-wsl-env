# AGENTS.md — dsh-plugin-wsl-env

DeepSeek Harness 的 WSL 集成插件：把一个 WSL 发行版配置为会话的执行环境。通过子类替换 Harness 的服务实现——`ctx.shell`（命令执行）、`ctx.fs`（文件系统）、子进程与终端、目录选择器、GUI 文件服务——使这些操作发生在 distro 内；受限命令在 distro 内经 `bwrap` 沙箱执行。只提供服务实现，不新增模型工具。深度文档：`CONTRIBUTING.md`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm test` | 完整检查链：风格 → 语法 → 构建一致性 → 类型检查 → 单测。提交前必须通过 |
| `pnpm run build` | 用 `tsc` 把 `src/*.ts` 编译为 `lib/*.js` + `.d.ts`，并删除无源码对应的 `.d.ts` |
| `pnpm run test:coverage` | 覆盖率阈值：行 85 / 分支 84 / 函数 70（分支线刻意定低，见 `docs/RELEASING.md`） |
| `pnpm run sync:windows` | 同步到 Windows 侧应用加载的副本；改 `lib/` 后必跑，并重启 DSH 应用（ESM 缓存） |
| `test/probe/run-all-when-closed.sh --include-fs` | 真机探针全套 12 项（仅 Windows+WSL；CI 跳过） |

工具链：Node `^22.19.0 || >=24.0.0`（`engines`，即 harness 宿主自身的下限；Node 20 有意不支持）；pnpm 由 `packageManager` 字段锁定（corepack 解析）；CI 在 Node 22 与 24 上跑（Linux + Windows 两平台）。

## 硬性规则

- `lib/` 整体是 `src/<name>.ts` 的编译产物，产物提交进仓（克隆后免构建即可加载——Harness 无转译层）。改 `src/` 后重新构建；`lint:build` 自动校验逐字节一致与 `lib/`↔`src/` 一一对应。
- peer 版本与 harness 同步升级，不单独动：`@deepseek-ai/dsh-*` 锁定为 0.2.0-rc.2，另两条 `@deepseek-ai/cordis` 为 `~4.0.4`、`@deepseek-ai/schemastery` 为 `~3.18.4`。本插件以子类扩展 peer：`WslShellExecutor extends LocalBashExecutor`、fs 提供者继承 `LocalFileSystem`、`WorkspaceFilesWsl` 继承 `WorkspaceFiles`。
- 代码风格：双引号、2 空格、LF、禁 tab/BOM；包根只有一个 README（中文版在 `docs/`）。
- 类型收窄用 `assert.ok` 或带注释的 `as`；不用 `any` 与 `!` 非空断言。`.ts` 里 JSDoc `@type` 不是类型断言，必须用 `as`。
- 类型检查分工：`tsc --noEmit`（checkJs）查 `test/**` 与 `types/*.d.ts`；`src/` 由构建程序查（strict + `noUncheckedIndexedAccess` + `noUnusedLocals`，`noEmitOnError`）；`lib/**` 不参与。
- 单元测试直接运行 `lib/*.js`（发布产物），运行器为 `node --test`；测试文件多为可直接 `node test/<name>.test.mjs` 执行的 `node:assert` 脚本，只有个别文件用 `node:test` 模块（取 `mock` / `it`）。
- `@ts-expect-error` 仅用于已记录的上游接口缺口：行内注明原因，并在 `docs/UPSTREAM-*.md` 或源码注释中记录缺口。现存两处：`src/index.ts` 那处引用 `docs/UPSTREAM-SPAWN-SEAM.md`；`src/workspace-files-wsl.ts` 的 exit-4 relay 缺口只在同文件注释中说明——relay 不上报条目类型（kind 只能猜），如实修复需要改协议，故有意保留可见。

## 架构边界

- 组合层按路径坐标路由：根级 fs 是 `WslRoutingFileSystem`（distro UNC → agent 实现，盘符路径 → 宿主后端）；GUI 文件服务 `WorkspaceFilesWsl` 的宿主路径走父类实现。服务装配在 `cordis.patch.yml`。
- 默认命令路径与全部文件操作都走常驻 agent（`agent/wsl-agent.sh` + `lib/agent.ts`）。命令执行另有一条并行的回退路径：agent 失效（`AgentUnavailableError`）或配置 `agent: false` 时改走一次性 `wsl.exe`（`src/index.ts` 的 `executeOneShot`）——两条路径的隔离、输出预算与结果装饰一致，真机探针逐项对拍，改命令执行时两条都要同步。文件操作没有回退：agent 失效即 fail closed（`FS_IO_ERROR`）。shell 脚本本身是协议：stderr 侧信道（`dsh-fs|reason|base64`、退出码约定）与 `lib/agent-protocol.ts` 的帧编解码必须同步修改。
- agent 实例按 distro 缓存为全局单例（`lib/agent-shared.ts`），有意不注册为 ctx 服务——根上下文与会话级隔离上下文必须共享同一常驻进程。
- 命令隔离在 distro 内由 `bwrap` 执行（`lib/sandbox-core.ts`）。`enforcement: "partial"` 与如实上报的 `sandboxMode` 是对外契约，不得声称未执行的隔离。

## 提交纪律

- 一次提交一个逻辑变更；正文叙述改动内容与原因，并记录检查结果（如 style 9/9、tsc 0、单测 29/29、覆盖率）。
- 推送后用 `git ls-remote` 确认远端已前进再看 CI。发版按 `docs/RELEASING.md`：打 tag 触发 `release.yml`（版本校验 → 检查链 → `npm publish --provenance` → GitHub Release），发布后同步镜像。

## 常见错误

- **在 WSL 内启动 Windows 程序时环境变量丢失**：Linux 环境变量只有列在 `WSLENV` 中才会传入 Windows 进程。`test/probe/env.sh` 已导出 `WSLENV=ELECTRON_RUN_AS_NODE`；缺失时 harness 以图形模式启动，探针等不到 CLI。
- **改了 `lib/` 但应用行为没变**：应用加载的是 Windows 镜像——先 `sync:windows`，再重启应用（ESM 缓存）。
- **镜像里有 `lib/` 下未知文件**：同步只增不删（有意设计），且加载入口是 `package.json` 的 `exports`，遗留文件无影响。

## 修改前先读

- `CONTRIBUTING.md` —— 构建、类型检查、新增模块。
- `docs/root-fs-routing.md` —— 根级文件系统按坐标路由的设计。
- `docs/upstream/promotion-map.md` —— 与 harness ssh 插件家族对照的架构。
- `docs/LIMITATIONS.md`、`docs/PEER-PARITY.md`、`docs/RELEASING.md`、`docs/UPSTREAM-SPAWN-SEAM.md`。
- `SECURITY.md` —— 漏洞报告渠道：走 GitHub 私有漏洞报告，利用细节不要写进公开 issue。涉及沙箱与 `enforcement` 契约的改动尤其先读。
