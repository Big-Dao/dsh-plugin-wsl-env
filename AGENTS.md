# AGENTS.md — dsh-plugin-wsl-env

DeepSeek Harness 的 WSL 服务插件：将会话的 shell、文件系统、子进程、终端和目录选择器接入指定 distro；受限命令由 distro 内的 `bwrap` 沙箱执行。插件只替换服务实现，不新增模型工具。开发流程见 `CONTRIBUTING.md`。

## 沟通风格

- 使用规范、准确、简洁的技术语言；优先采用明确术语。
- 先给结论，再说明必要依据；不确定时标明假设。
- 不复述已知信息，不加客套或冗余过渡。

## 开始前与验证

按改动范围阅读相关资料：

- 构建、类型检查和测试：`CONTRIBUTING.md`。
- 架构与路由：`docs/root-fs-routing.md`、`docs/upstream/promotion-map.md`。
- 行为边界与版本兼容：`docs/LIMITATIONS.md`、`docs/PEER-PARITY.md`。
- 发布、上游接口缺口与安全：`docs/RELEASING.md`、`docs/UPSTREAM-SPAWN-SEAM.md`、`SECURITY.md`。

| 命令 | 用途 |
|---|---|
| `pnpm test` | 完整检查链：风格、链接、语法、构建一致性、类型和单测；提交前必须通过。 |
| `pnpm run build` | 将 `src/*.ts` 编译到 `lib/`；修改源码后运行。 |
| `pnpm run test:coverage` | 覆盖率门槛：行 85%、分支 84%、函数 70%。 |
| `pnpm run sync:windows` | 修改 `lib/` 后同步 Windows 运行副本；使用新代码前重启 DSH。 |
| `test/probe/run-all-when-closed.sh --include-fs` | Windows + WSL 真机全套 14 项探针；须在 Harness 关闭后运行。 |

工具链：Node `^22.19.0 || >=24.0.0`（Harness 宿主版本，不支持 Node 20）；pnpm 版本由 `packageManager` 锁定并通过 Corepack 解析。CI 在 Node 22、24 的 Linux 和 Windows 环境运行。新克隆后先执行 `pnpm install`。

## 硬性规则

- `src/` 是源码，`lib/` 是提交进仓的构建产物；禁止手改 `lib/`。源码变更后运行 `pnpm run build`。`lint:build` 会检查产物逐字节一致，以及 `src/` 与 `lib/` 一一对应。
- 代码风格：双引号、2 空格、LF；禁止 tab 和 BOM。包根目录只保留一个 README，中文版放在 `docs/`。
- peer 版本分层：`devDependencies` 使用精确版本；`peerDependencies` 对 `@deepseek-ai/dsh-*` 声明 `>=0.2.1-rc.3`，对 `@deepseek-ai/cordis` 声明 `^4.0.5`，对 `@deepseek-ai/schemastery` 声明 `^3.18.5`。仅在匹配 Harness 发版的提交中抬高下限，并重跑对拍和完整检查；周度 `peer-canary` 用于发现 `next` 线变化。
- 类型收窄使用 `assert.ok` 或附注释的 `as`；禁止 `any` 和 `!` 非空断言。`.ts` 中 JSDoc `@type` 不能替代类型断言。
- 类型检查分工：`tsc --noEmit`（`checkJs`）覆盖 `test/**` 与 `types/*.d.ts`；`src/` 由构建程序以 `strict`、`noUncheckedIndexedAccess`、`noUnusedLocals` 和 `noEmitOnError` 检查；`lib/**` 不参与该检查。
- 单测直接运行发布产物 `lib/*.js`，由 `node --test` 驱动。新增或调整测试时，保持这一边界。
- 仅在记录上游接口缺口时使用 `@ts-expect-error`：同一行说明原因，并在 `docs/UPSTREAM-*.md` 或源码注释中记录。当前例外位于 `src/index.ts`，详见 `docs/UPSTREAM-SPAWN-SEAM.md`。

## 架构边界

- 组合层按路径坐标路由：根级 `WslRoutingFileSystem` 将 distro UNC 路径交给 agent，将盘符路径交给宿主 `LocalFileSystem`。GUI 文件服务沿用随包的 `workspace-files` 行，通过根级路由访问 WSL 路径；服务在 `cordis.patch.yml` 中装配。
- 默认命令执行和受限写入使用 session runtime agent：`agentBackend: auto` 按 distro 的 `uname -m` 选择 `agent/native/linux-<arch>/dsh-wsl-agent`；shell agent（`agent/wsl-agent.sh`、`src/agent.ts`，构建产物为 `lib/agent.js`）用于回退及 `agentBackend: shell`。两者共用 v5 协议；变更 stderr 侧信道（`dsh-fs|reason|base64`）、退出码或帧格式时，须同步核对 `src/agent-protocol.ts` 与两种 agent 的实现，并重建相关产物。
- 无约束文件读取使用 `src/agent-shared.ts`（构建产物 `lib/agent-shared.js`）中的共享 agent：默认 native，配置为 shell 或 native 不可用时回退 shell。agent 按 distro 缓存为全局单例，不注册为 ctx 服务，以便根上下文与会话隔离上下文共享进程。
- 命令执行还有一次性 `wsl.exe` 路径：agent 不可用（`AgentUnavailableError`）或设置 `agent: false` 时使用 `src/index.ts` 的 `executeOneShot`。维护命令执行时，须保持驻留和一次性路径的隔离、输出预算及结果装饰一致，并同步验证两条路径。
- 文件操作没有 agent 回退；agent 不可用时以 `FS_IO_ERROR` 失败关闭。沙箱在 distro 内由 `bwrap` 执行；`enforcement: "partial"` 和实际 `sandboxMode` 是对外契约，禁止声称未执行的隔离。

## 提交、发布与排障

- 一次提交只包含一个逻辑变更；提交说明写明改动、原因和检查结果。推送后用 `git ls-remote` 确认远端已前进，再查看 CI。
- 发布流程见 `docs/RELEASING.md`：推送 tag 触发版本校验、完整检查、`npm publish --provenance` 和 GitHub Release；发布后同步运行镜像。
- 漏洞报告通过 GitHub 私有漏洞报告提交；不要在公开 issue 写利用细节。
- WSL 内启动 Windows 程序时，环境变量必须列入 `WSLENV` 才会传入。`test/probe/env.sh` 已导出 `ELECTRON_RUN_AS_NODE`；缺失时 Harness 会以 GUI 模式启动，探针无法使用 CLI。
- 应用加载 Windows 镜像中的代码。改动未生效时，先运行 `pnpm run sync:windows`，再重启 DSH；运行中的进程还会缓存 ESM 模块。
- 镜像同步只增不删；遗留文件只要不在 `package.json` 的 `exports` 中，就不会成为加载入口。
